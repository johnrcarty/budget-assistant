import asyncio
import base64
import json
from datetime import datetime, timezone

import httpx
import pytest

from backend.database import connect, initialize
from backend import simplefin


@pytest.fixture
def db_path(tmp_path):
    path = tmp_path / "budget.sqlite3"
    initialize(path)
    with connect(path) as db:
        db.execute("INSERT INTO households(id,name,timezone) VALUES(1,'Test home','America/New_York')")
        db.execute("INSERT INTO users(id,username,display_name,household_id) VALUES(1,'one','One',1)")
        db.execute("INSERT INTO users(id,username,display_name,household_id) VALUES(2,'two','Two',1)")
    return path


def payload():
    return {"errlist": [], "accounts": [
        {"conn_id": conn, "id": "same-account", "name": conn, "currency": "USD", "balance": "123.45",
         "transactions": [{"id": "same-txn", "amount": "-19.99", "description": "A purchase",
                           "posted": int(datetime(2026, 10, 4, 1, tzinfo=timezone.utc).timestamp())}]}
        for conn in ("connection-a", "connection-b")
    ]}


def test_connections_dedup_categorization_and_private_scope(db_path):
    result = simplefin.import_accounts(db_path, 1, "personal", payload())
    assert result["imported_transactions"] == 2
    with connect(db_path) as db:
        db.execute("INSERT INTO budget_items(id,household_id,owner_id,scope,month,name,group_name) VALUES(1,1,1,'personal','2026-10','Groceries','Food')")
        db.execute("UPDATE transactions SET category_id=1 WHERE id=1")
    data = payload()
    data["accounts"][0]["transactions"][0]["description"] = "A settled purchase"
    simplefin.import_accounts(db_path, 1, "personal", data)
    with connect(db_path) as db:
        rows = db.execute("SELECT * FROM transactions ORDER BY id").fetchall()
        assert len(rows) == 2
        assert rows[0]["category_id"] == 1
        assert rows[0]["date"] == "2026-10-03"  # household timezone, not UTC
        assert rows[0]["amount_cents"] == -1999
        assert all(r["scope"] == "personal" and r["owner_id"] == 1 for r in rows)
    simplefin.import_accounts(db_path, 2, "personal", data)
    with connect(db_path) as db:
        assert db.execute("SELECT COUNT(*) FROM transactions WHERE owner_id=2").fetchone()[0] == 2


def test_invalid_data_rolls_back_whole_import(db_path):
    data = payload()
    data["accounts"][1]["balance"] = "NaN"
    with pytest.raises(simplefin.SimpleFINError):
        simplefin.import_accounts(db_path, 1, "household", data)
    with connect(db_path) as db:
        assert db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0


def test_deletion_amount_override_and_account_edits_survive_refresh(db_path):
    data = payload()
    simplefin.import_accounts(db_path, 1, "household", data)
    with connect(db_path) as db:
        row = db.execute("SELECT * FROM transactions WHERE id=1").fetchone()
        db.execute("INSERT INTO transaction_exclusions(household_id,owner_id,scope,external_id) VALUES(1,0,'household',?)", (row['external_id'],))
        db.execute("DELETE FROM transactions WHERE id=1")
        db.execute("UPDATE transactions SET amount_cents=1999,amount_override_cents=1999 WHERE id=2")
        db.execute("UPDATE accounts SET name='My card',kind='credit' WHERE id=2")
    data['accounts'][1]['balance'] = '-500.00'
    simplefin.import_accounts(db_path, 1, "household", data)
    with connect(db_path) as db:
        assert db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 1
        row = db.execute("SELECT * FROM transactions WHERE id=2").fetchone()
        assert row['amount_cents'] == 1999
        assert row['account_name'] == 'My card'
        account = db.execute("SELECT * FROM accounts WHERE id=2").fetchone()
        assert account['kind'] == 'credit'
        assert account['name'] == 'My card'
        assert account['balance_cents'] == 50000


def test_non_usd_does_not_mix_budget_currency(db_path):
    data = payload()
    data["accounts"][0]["currency"] = "EUR"
    result = simplefin.import_accounts(db_path, 1, "household", data)
    assert result["imported_transactions"] == 1
    assert result["warnings"]


@pytest.mark.parametrize("url", [
    "http://bridge.simplefin.org/claim/one", "https://127.0.0.1/claim/one",
    "https://bridge.simplefin.org.attacker.test/claim/one", "https://bridge.simplefin.org:8443/claim/one",
    "https://bridge.simplefin.org/claim/one#ignored", "https://user:pass@bridge.simplefin.org/claim/one",
])
def test_claim_destinations_restricted(url):
    with pytest.raises(simplefin.SimpleFINError):
        simplefin.checked_url(url)


def test_claim_encrypts_and_uses_verified_nonredirecting_client(monkeypatch):
    original = httpx.AsyncClient
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, text="https://example:secret@bridge.simplefin.org/simplefin")

    def client(**kwargs):
        assert kwargs["follow_redirects"] is False
        assert kwargs["trust_env"] is False
        return original(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(simplefin.httpx, "AsyncClient", client)
    token = base64.b64encode(b"https://bridge.simplefin.org/simplefin/claim/test").decode()
    credential = asyncio.run(simplefin.claim_token(token, "test-secret"))
    assert "secret@" not in credential
    assert simplefin.cipher("test-secret").decrypt(credential.encode()).decode().startswith("https://example:secret@")
    assert seen[0].method == "POST"


def test_claim_used_token_is_actionable_and_safe(monkeypatch):
    original = httpx.AsyncClient
    monkeypatch.setattr(simplefin.httpx, "AsyncClient", lambda **kwargs: original(
        transport=httpx.MockTransport(lambda _: httpx.Response(403, text="secret details")), **kwargs))
    token = base64.b64encode(b"https://bridge.simplefin.org/simplefin/claim/test").decode()
    with pytest.raises(simplefin.SimpleFINError, match="Disable it") as exc:
        asyncio.run(simplefin.claim_token(token, "secret"))
    assert "secret details" not in exc.value.safe_message


def test_sync_cooldown_and_no_secret_return(db_path, monkeypatch):
    credential = simplefin.cipher("secret").encrypt(b"https://one:two@bridge.simplefin.org/simplefin").decode()
    with connect(db_path) as db:
        db.execute("INSERT INTO integration_state(household_id,owner_id,scope,connected,credential) VALUES(1,0,'household',1,?)", (credential,))
    async def fetch(*args):
        return payload()
    monkeypatch.setattr(simplefin, "fetch_accounts", fetch)
    result = asyncio.run(simplefin.sync_accounts(db_path, 1, "household", "secret"))
    assert "credential" not in json.dumps(result)
    with pytest.raises(simplefin.SimpleFINError) as exc:
        asyncio.run(simplefin.sync_accounts(db_path, 1, "household", "secret"))
    assert exc.value.status_code == 429


def test_fetch_auth_and_overlap_params(monkeypatch):
    original = httpx.AsyncClient
    def handler(request):
        assert "@" not in str(request.url)
        assert request.headers["authorization"].startswith("Basic ")
        assert request.url.params["version"] == "2"
        assert request.url.params["start-date"] == "1790985600"
        return httpx.Response(200, json=payload())
    monkeypatch.setattr(simplefin.httpx, "AsyncClient", lambda **kwargs: original(
        transport=httpx.MockTransport(handler), **kwargs))
    credential = simplefin.cipher("secret").encrypt(b"https://one:two@bridge.simplefin.org/simplefin").decode()
    asyncio.run(simplefin.fetch_accounts(credential, "secret", datetime(2026,10,3,tzinfo=timezone.utc)))
