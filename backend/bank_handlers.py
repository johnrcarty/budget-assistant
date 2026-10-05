"""Small, institution-specific SimpleFIN classifications.

Handlers annotate provider records; they never change identities, descriptions,
amounts, dates, or user decisions. Add a named handler and mocked fixtures for a
new bank rather than teaching the generic importer fuzzy merchant rules.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Protocol
from urllib.parse import urlsplit


ORDINARY = "ordinary"
BANK_TRANSFER = "bank_transfer"


def normalized(value: object) -> str:
    return " ".join(str(value).split()).casefold()


def _domain(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        parsed = urlsplit(text if "://" in text else "https://" + text)
        if parsed.scheme not in ("http", "https") or parsed.username or parsed.password:
            return None
        host = parsed.hostname
        return host.lower().rstrip(".") if host else None
    except ValueError:
        return None


@dataclass(frozen=True)
class Institution:
    """Institution identity from provider metadata, never the editable account."""

    domains: tuple[str, ...] = ()
    names: tuple[str, ...] = ()
    supplied_domain: bool = False
    display_name: str = "SimpleFIN"


def connection_index(payload: Mapping) -> dict[str, Mapping | None]:
    """V2 accounts refer to their actual connection by conn_id.

    Duplicate connection IDs are ambiguous and deliberately cannot select a
    handler. Legacy payloads without connections still use account.org.
    """
    result = {}
    for connection in payload.get("connections", []) or []:
        if not isinstance(connection, dict) or connection.get("conn_id") is None:
            continue
        key = str(connection["conn_id"])
        result[key] = connection if key not in result else None
    return result


def institution_for(account: Mapping, connections: Mapping[str, Mapping | None]) -> Institution:
    conn_id = account.get("conn_id")
    if conn_id is not None and str(conn_id) in connections:
        connection = connections[str(conn_id)]
        if connection is None:
            return Institution()
        domain_values = [connection.get("org_url")]
        # org_name is a Bridge extension; name is an editable human-friendly
        # connection label and can only supply the display label.
        name_values = [connection.get("org_name")]
        display = next((value for value in [*name_values, connection.get("name")] if isinstance(value, str) and value.strip()), "SimpleFIN")
    else:
        org = account.get("org")
        org = org if isinstance(org, dict) else {}
        domain_values = [org.get("domain"), org.get("url")]
        name_values = [org.get("name")]
        display = next((value for value in [*name_values, account.get("conn_name")] if isinstance(value, str) and value.strip()), "SimpleFIN")
    domains = tuple(dict.fromkeys(host for value in domain_values if (host := _domain(value))))
    names = tuple(dict.fromkeys(normalized(value) for value in name_values if isinstance(value, str) and value.strip()))
    return Institution(domains, names, any(value is not None and value != "" for value in domain_values), str(display)[:180])


@dataclass(frozen=True)
class Classification:
    role: str = ORDINARY
    handler: str | None = None


class BankHandler(Protocol):
    id: str

    def supports(self, institution: Institution) -> bool: ...

    def classify(self, institution: Institution, transaction: Mapping, amount_cents: int) -> Classification | None: ...


class FidelityCoreHandler:
    """Separate Fidelity core movement from the real purchase or deposit.

    Fidelity's core position holds cash and redeems to satisfy debits. These
    literal provider descriptions identify the bookkeeping movement itself;
    neither equal amounts nor the name of a user's account select this rule.
    Unexpected signs and unfamiliar descriptions remain ordinary for review.
    """

    id = "fidelity_core_v1"
    _names = frozenset(("fidelity", "fidelity investments"))

    def supports(self, institution: Institution) -> bool:
        if institution.supplied_domain:
            # A conflicting institution domain does not become Fidelity just
            # because a connection label happens to contain that word.
            return bool(institution.domains) and all(
                domain == "fidelity.com" or domain.endswith(".fidelity.com")
                for domain in institution.domains
            )
        return any(name in self._names for name in institution.names)

    def classify(self, institution: Institution, transaction: Mapping, amount_cents: int) -> Classification | None:
        if not self.supports(institution):
            return None
        description = normalized(transaction.get("description", ""))
        patterns = (("redemption from core account", amount_cents > 0),
                    ("purchase into core account", amount_cents < 0))
        for prefix, expected_sign in patterns:
            if expected_sign and (description == prefix or description.startswith(prefix + " ")):
                return Classification(BANK_TRANSFER, self.id)
        return None


# Ordering is intentional: the first specific handler that recognizes a row
# wins. A bank handler returning None leaves generic import behavior intact.
HANDLERS: tuple[BankHandler, ...] = (FidelityCoreHandler(),)


def supports(institution: Institution) -> bool:
    return any(handler.supports(institution) for handler in HANDLERS)


def classify(institution: Institution, transaction: Mapping, amount_cents: int) -> Classification:
    for handler in HANDLERS:
        result = handler.classify(institution, transaction, amount_cents)
        if result is not None:
            return result
    return Classification()
