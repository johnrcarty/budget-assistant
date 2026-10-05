"""Read-only SimpleFIN Bridge ingestion. Credentials never leave the service.

Amounts use the protocol sign: deposits positive, withdrawals negative.
The first sync fetches 85 days; subsequent syncs overlap five days.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from urllib.parse import unquote, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx
from cryptography.fernet import Fernet, InvalidToken


class SimpleFINError(Exception):
    """Safe user-facing error; contains neither tokens nor request URLs."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code

    @property
    def safe_message(self):
        return str(self)


def cipher(secret: str | bytes) -> Fernet:
    key = secret.encode() if isinstance(secret, str) else secret
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(key).digest()))


def checked_url(value: str, *, access: bool = False):
    try:
        parsed = urlsplit(value.strip())
        hosts = {h.strip().lower() for h in os.environ.get(
            "BUDGET_SIMPLEFIN_HOSTS", "bridge.simplefin.org,beta-bridge.simplefin.org"
        ).split(",") if h.strip()}
        if (parsed.scheme != "https" or parsed.hostname not in hosts
                or parsed.port not in (None, 443) or parsed.fragment or parsed.query
                or not parsed.path or "\\" in value):
            raise ValueError()
        if access and (not parsed.username or not parsed.password):
            raise ValueError()
        if not access and (parsed.username is not None or parsed.password is not None):
            raise ValueError()
        return parsed
    except (ValueError, TypeError):
        raise SimpleFINError("Use a valid HTTPS SimpleFIN Bridge setup token.") from None


async def claim_token(setup_token: str, secret: str | bytes) -> str:
    try:
        url = base64.b64decode(setup_token.strip(), validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        raise SimpleFINError("The setup token is invalid. Create a new token in SimpleFIN Bridge.") from None
    checked_url(url)
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False, trust_env=False) as client:
            response = await client.post(url)
        if response.status_code == 403:
            raise SimpleFINError("This setup token was already claimed or is invalid. Disable it in SimpleFIN Bridge and create a new token.")
        if response.status_code != 200:
            raise SimpleFINError("SimpleFIN could not connect. Try again with a new setup token.")
        access_url = response.text.strip()
        checked_url(access_url, access=True)
        return cipher(secret).encrypt(access_url.encode()).decode()
    except httpx.HTTPError:
        raise SimpleFINError("SimpleFIN Bridge could not be reached. Check your connection and try again.") from None


def cents(value) -> int:
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or abs(amount) > Decimal("100000000000"):
            raise InvalidOperation()
        return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    except (InvalidOperation, ValueError, TypeError):
        raise SimpleFINError("SimpleFIN returned an invalid amount. No data was imported.") from None


def external_key(*parts) -> str:
    # JSON framing avoids collisions between strings containing delimiters.
    return hashlib.sha256(json.dumps(parts, separators=(",", ":")).encode()).hexdigest()


def safe_warning(value) -> str:
    value = str(value)
    value = re.sub(r"https?://\S+", "[link removed]", value)
    value = re.sub(r"[<>\x00-\x1f]", "", value)
    return value[:350]


@contextmanager
def get_db(path):
    db = sqlite3.connect(str(path), timeout=20)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        with db:
            yield db
    finally:
        db.close()


async def fetch_accounts(credential: str, secret, start: datetime):
    try:
        access_url = cipher(secret).decrypt(credential.encode()).decode()
    except (InvalidToken, UnicodeDecodeError):
        raise SimpleFINError("The saved connection cannot be read. Reconnect SimpleFIN in Settings.") from None
    parsed = checked_url(access_url, access=True)
    endpoint = urlunsplit((parsed.scheme, parsed.netloc.rsplit("@", 1)[-1],
                          parsed.path.rstrip("/") + "/accounts", "", ""))
    auth = (unquote(parsed.username), unquote(parsed.password))
    try:
        async with httpx.AsyncClient(timeout=90, follow_redirects=False, trust_env=False) as client:
            response = await client.get(endpoint, auth=auth, params={
                "version": "2", "start-date": int(start.timestamp()),
                "end-date": int(datetime.now(timezone.utc).timestamp()), "pending": 1,
            })
        if response.status_code == 403:
            raise SimpleFINError("SimpleFIN access was revoked. Reconnect using a new setup token.")
        if response.status_code != 200:
            raise SimpleFINError("SimpleFIN did not return account data. Try again later.")
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("accounts"), list):
            raise ValueError()
        if any(e.get("code") == "gen.auth" for e in payload.get("errlist", []) if isinstance(e, dict)):
            raise SimpleFINError("SimpleFIN authentication failed. Reconnect using a new setup token.")
        return payload
    except httpx.HTTPError:
        raise SimpleFINError("SimpleFIN Bridge could not be reached. Your saved data is unchanged.") from None
    except (ValueError, TypeError):
        raise SimpleFINError("SimpleFIN returned an unreadable response. Your saved data is unchanged.") from None


async def sync_accounts(db_path, user_id: int, scope: str, secret):
    """Claim one refresh slot, fetch outside the lock, atomically upsert a scope."""
    now = datetime.now(timezone.utc)
    owner = 0 if scope == "household" else user_id
    with get_db(db_path) as db:
        user = db.execute("SELECT household_id FROM users WHERE id=?", (user_id,)).fetchone()
        if not user:
            raise SimpleFINError("The connection owner no longer exists.")
        hid = user["household_id"]
        db.execute("BEGIN IMMEDIATE")
        state = db.execute("SELECT * FROM integration_state WHERE household_id=? AND owner_id=? AND scope=?",
                           (hid, owner, scope)).fetchone()
        if not state or not state["connected"] or not state["credential"]:
            raise SimpleFINError("Connect SimpleFIN first.")
        if state["last_attempt"]:
            previous = datetime.fromisoformat(state["last_attempt"])
            if previous.tzinfo is None:
                previous = previous.replace(tzinfo=timezone.utc)
            if now - previous < timedelta(hours=1):
                raise SimpleFINError("A refresh was recently attempted. Automatic sync will continue; try again in an hour.", 429)
        db.execute("UPDATE integration_state SET last_attempt=? WHERE household_id=? AND owner_id=? AND scope=?",
                   (now.isoformat(), hid, owner, scope))
        credential = state["credential"]
        last_sync = state["last_sync"]
    start = now - timedelta(days=85)
    if last_sync:
        last = datetime.fromisoformat(last_sync)
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        start = max(now - timedelta(days=45), last - timedelta(days=5))
    try:
        payload = await fetch_accounts(credential, secret, start)
        result = import_accounts(db_path, user_id, scope, payload)
        stamp = datetime.now(timezone.utc).isoformat()
        with get_db(db_path) as db:
            db.execute("UPDATE integration_state SET last_sync=?,sync_error=NULL,warnings=? WHERE household_id=? AND owner_id=? AND scope=?",
                       (stamp, json.dumps(result["warnings"]), hid, owner, scope))
        return {**result, "last_sync": stamp}
    except SimpleFINError as exc:
        with get_db(db_path) as db:
            db.execute("UPDATE integration_state SET sync_error=? WHERE household_id=? AND owner_id=? AND scope=?",
                       (exc.safe_message, hid, owner, scope))
        raise


def import_accounts(db_path, user_id: int, scope: str, payload: dict):
    """Implemented against app schema below; refresh keeps manual categorization."""
    warnings = [safe_warning(e.get("msg", e.get("code", "Bank connection needs attention")))
                for e in payload.get("errlist", []) if isinstance(e, dict)]
    warnings += [safe_warning(e) for e in payload.get("errors", [])]
    accounts = transactions = 0
    from . import accounts as account_history
    owner = 0 if scope == "household" else user_id
    try:
        with get_db(db_path) as db:
            user = db.execute("SELECT u.household_id,h.timezone FROM users u JOIN households h ON h.id=u.household_id WHERE u.id=?", (user_id,)).fetchone()
            hid = user["household_id"]
            local_zone = ZoneInfo(user["timezone"])
            account_history.ensure_observations(db, (hid, owner, scope))
            for account in payload["accounts"]:
                conn = str(account.get("conn_id", account.get("org", {}).get("id", account.get("org", {}).get("domain", "legacy"))))
                aid = str(account["id"])
                key = external_key(conn, aid)
                currency = str(account.get("currency", "USD"))
                if len(currency) == 3 and currency.isalpha():
                    currency = currency.upper()
                name = str(account.get("name", "Bank account"))[:180]
                institution = str(account.get("conn_name", account.get("org", {}).get("name", "SimpleFIN")))[:180]
                existing = db.execute("SELECT * FROM accounts WHERE household_id=? AND owner_id=? AND scope=? AND simplefin_id=?",
                                      (hid, owner, scope, key)).fetchone()
                if existing is not None and existing["archived"]:
                    continue
                db.execute("""INSERT INTO accounts(household_id,owner_id,scope,name,institution,kind,balance_cents,currency,source,simplefin_id,created_at)
                    VALUES(?,?,?,?,?,'checking',?,?,'simplefin',?,?)
                    ON CONFLICT(household_id,owner_id,scope,simplefin_id) DO NOTHING""",
                           (hid, owner, scope, name, institution, cents(account["balance"]), currency, key, account_history.now_string()))
                account_row = db.execute("SELECT * FROM accounts WHERE household_id=? AND owner_id=? AND scope=? AND simplefin_id=?",
                                         (hid, owner, scope, key)).fetchone()
                balance = cents(account["balance"])
                if account_row["kind"] in ("credit", "loan"):
                    balance = abs(balance)
                provider_as_of = account_history.provider_timestamp(account.get("balance-date"))
                accepted = account_history.import_balance(db, account_row, balance, currency, provider_as_of)
                if not accepted:
                    warnings.append("An older balance or changed payment-account currency was ignored; transactions were retained.")
                account_row = db.execute("SELECT * FROM accounts WHERE id=?", (account_row["id"],)).fetchone()
                if db.execute("SELECT 1 FROM account_valuation_events WHERE account_id=?", (account_row["id"],)).fetchone() is None:
                    db.execute("INSERT INTO account_valuation_events(account_id,observed_at,kind) VALUES (?,?,?)", (account_row["id"], account_history.now_string(), account_row["kind"]))
                accounts += 1
                if account_row['currency'] != currency:
                    warnings.append('Transactions for an account with a changed currency were skipped until its currency is reviewed.')
                    continue
                if currency != "USD":
                    warnings.append(f"{currency} transactions were skipped: budgets currently use USD.")
                    continue
                for transaction in account.get("transactions", []):
                    ext = external_key(conn, aid, str(transaction["id"]))
                    if db.execute("SELECT 1 FROM transaction_exclusions WHERE household_id=? AND owner_id=? AND scope=? AND external_id=?",
                                  (hid, owner, scope, ext)).fetchone():
                        continue
                    timestamp = transaction.get("posted") or transaction.get("transacted_at")
                    if not timestamp:
                        warnings.append("A pending transaction without a date was skipped until it posts.")
                        continue
                    when = datetime.fromtimestamp(float(timestamp), local_zone).date().isoformat()
                    db.execute("""INSERT INTO transactions(household_id,owner_id,scope,description,amount_cents,date,account_name,account_id,pending,external_id)
                        VALUES(?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT(household_id,owner_id,scope,external_id) DO UPDATE SET
                        description=excluded.description,amount_cents=COALESCE(transactions.amount_override_cents,excluded.amount_cents),date=excluded.date,
                        account_name=excluded.account_name,pending=excluded.pending""",
                               (hid, owner, scope, str(transaction.get("description", "Transaction"))[:300],
                                cents(transaction["amount"]), when, account_row["name"], account_row["id"],
                                int(bool(transaction.get("pending", False))), ext))
                    transactions += 1
        return {"imported_accounts": accounts, "imported_transactions": transactions,
                "warnings": list(dict.fromkeys(warnings))[:30]}
    except SimpleFINError:
        raise
    except (KeyError, ValueError, TypeError, OverflowError):
        raise SimpleFINError("SimpleFIN returned incomplete account data. No data was imported.") from None
