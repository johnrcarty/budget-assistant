from datetime import datetime, timezone

import pytest

from backend import bank_handlers, simplefin
from backend.database import connect, initialize


@pytest.fixture
def db_path(tmp_path):
    path = tmp_path / "bank-handlers.sqlite3"
    initialize(path)
    with connect(path) as db:
        db.execute("INSERT INTO households(id,name,timezone) VALUES(1,'Home','America/New_York')")
        db.execute("INSERT INTO users(id,username,display_name,household_id) VALUES(1,'one','One',1)")
        db.execute("INSERT INTO users(id,username,display_name,household_id) VALUES(2,'two','Two',1)")
    return path


def feed(*, domain="fidelity.com", v2=False):
    account = {
        "id": "cash-account", "conn_id": "fidelity-login", "name": "Cash Management (Joint)",
        "currency": "USD", "balance": "1000.00",
        "org": {"name": "Fidelity Investments", "domain": domain},
        "transactions": [
            {"id": "real-purchase", "amount": "-18.93", "description": "DEBIT CARD PURCHASE BURGER SHOP",
             "posted": int(datetime(2026, 10, 1, 18, tzinfo=timezone.utc).timestamp())},
            {"id": "core-redemption", "amount": "18.93", "description": "REDEMPTION FROM CORE ACCOUNT FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash)",
             "posted": int(datetime(2026, 10, 1, 18, tzinfo=timezone.utc).timestamp())},
            {"id": "check", "amount": "2000.00", "description": "DIRECT DEPOSIT PAYROLL",
             "posted": int(datetime(2026, 10, 2, 18, tzinfo=timezone.utc).timestamp())},
            {"id": "core-purchase", "amount": "-2000.00", "description": "PURCHASE INTO CORE ACCOUNT FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash)",
             "posted": int(datetime(2026, 10, 2, 18, tzinfo=timezone.utc).timestamp())},
        ],
    }
    result = {"accounts": [account]}
    if v2:
        del account["org"]
        result["connections"] = [{"conn_id": "fidelity-login", "name": "My shared login", "org_name": "Fidelity Investments", "org_url": "https://www.fidelity.com"}]
    return result


def test_fidelity_sweeps_do_not_cancel_real_purchase_or_paycheck(db_path):
    data = feed()
    simplefin.import_accounts(db_path, 1, "household", data)
    simplefin.import_accounts(db_path, 1, "household", data)
    with connect(db_path) as db:
        rows = {row["description"]: row for row in db.execute("SELECT * FROM transactions")}
        assert len(rows) == 4  # idempotent, with every raw row retained
        real = rows["DEBIT CARD PURCHASE BURGER SHOP"]
        paycheck = rows["DIRECT DEPOSIT PAYROLL"]
        redemption = next(row for name, row in rows.items() if name.startswith("REDEMPTION"))
        purchase = next(row for name, row in rows.items() if name.startswith("PURCHASE INTO"))
        assert (real["amount_cents"], real["provider_role"]) == (-1893, "ordinary")
        assert (paycheck["amount_cents"], paycheck["provider_role"]) == (200000, "ordinary")
        assert (redemption["amount_cents"], redemption["provider_role"]) == (1893, "bank_transfer")
        assert (purchase["amount_cents"], purchase["provider_role"]) == (-200000, "bank_transfer")
        assert redemption["provider_handler"] == purchase["provider_handler"] == "fidelity_core_v1"
        assert real["provider_handler"] is None


def test_v2_connection_metadata_selects_handler_and_initial_institution(db_path):
    simplefin.import_accounts(db_path, 1, "personal", feed(v2=True))
    with connect(db_path) as db:
        assert db.execute("SELECT institution FROM accounts").fetchone()[0] == "Fidelity Investments"
        assert db.execute("SELECT COUNT(*) FROM transactions WHERE provider_role='bank_transfer'").fetchone()[0] == 2
        assert all(row["owner_id"] == 1 and row["scope"] == "personal" for row in db.execute("SELECT * FROM transactions"))


@pytest.mark.parametrize("domain", ["other-bank.example", "fidelity.com.evil.example", "notfidelity.com", "https://fidelity.com@evil.example", "ftp://fidelity.com"])
def test_conflicting_or_lookalike_domain_does_not_classify(domain):
    data = feed(domain=domain)
    account = data["accounts"][0]
    identity = bank_handlers.institution_for(account, {})
    assert bank_handlers.classify(identity, account["transactions"][1], 1893).role == "ordinary"


@pytest.mark.parametrize("description,amount", [
    ("REDEMPTION FROM CORE ACCOUNT", -100),
    ("PURCHASE INTO CORE ACCOUNT", 100),
    ("REDEMPTION FROM CORE ACCOUNT", 0),
    ("REDEMPTION FROM CORE ACCOUNTING SERVICE", 100),
    ("PURCHASE INTO CORE ACCOUNTING SERVICE", -100),
    ("FIDELITY PAYROLL", 100),
    ("DIVIDEND RECEIVED FIDELITY GOVERNMENT MONEY MARKET", 100),
    ("REDEMPTION FROM ANOTHER FUND", 100),
])
def test_unfamiliar_patterns_and_signs_remain_ordinary(description, amount):
    identity = bank_handlers.Institution(("fidelity.com",), (), True)
    result = bank_handlers.classify(identity, {"description": description}, amount)
    assert result == bank_handlers.Classification()


def test_canonical_metadata_name_fallback_but_not_editable_account_name():
    transaction = {"description": "  redemption   from CORE account (Cash) "}
    identity = bank_handlers.institution_for({"name": "Fidelity", "org": {"name": "Fidelity Investments"}}, {})
    assert bank_handlers.classify(identity, transaction, 100).role == "bank_transfer"
    for account in ({"name": "Fidelity", "institution": "Fidelity Investments"},
                    {"org": {"name": "Fidelity Payroll LLC"}},
                    {"conn_name": "Fidelity"},
                    {"conn_name": "Fidelity - My login"}):
        assert bank_handlers.classify(bank_handlers.institution_for(account, {}), transaction, 100).role == "ordinary"
    account = {"conn_id": "one"}
    identity = bank_handlers.institution_for(account, {"one": {"name": "Fidelity"}})
    assert identity.display_name == "Fidelity"
    assert bank_handlers.classify(identity, transaction, 100).role == "ordinary"


def test_v2_connection_is_authoritative_and_ambiguous_connection_ids_do_not_guess():
    data = feed(v2=True)
    account = data["accounts"][0]
    account["org"] = {"domain": "fidelity.com", "name": "Fidelity"}
    data["connections"][0]["org_url"] = "https://other-bank.example"
    index = bank_handlers.connection_index(data)
    assert bank_handlers.classify(bank_handlers.institution_for(account, index), account["transactions"][1], 1893).role == "ordinary"
    data["connections"].append({"conn_id": "fidelity-login", "org_url": "https://fidelity.com", "name": "Fidelity"})
    index = bank_handlers.connection_index(data)
    assert bank_handlers.classify(bank_handlers.institution_for(account, index), account["transactions"][1], 1893).role == "ordinary"


def test_manual_choices_deletion_and_amount_override_survive_new_handler(db_path):
    data = feed(domain="other-bank.example")
    simplefin.import_accounts(db_path, 1, "household", data)
    with connect(db_path) as db:
        redemption = db.execute("SELECT * FROM transactions WHERE description LIKE 'REDEMPTION%'").fetchone()
        core_purchase = db.execute("SELECT * FROM transactions WHERE description LIKE 'PURCHASE INTO%'").fetchone()
        db.execute("INSERT INTO income_entries(id,household_id,owner_id,scope,month,name,amount_cents,date,kind) VALUES(1,1,0,'household','2026-10','Existing explicit income',1893,'2026-10-01','manual')")
        db.execute("UPDATE transactions SET income_entry_id=1 WHERE id=?", (redemption["id"],))
        db.execute("INSERT INTO budget_items(id,household_id,owner_id,scope,month,name,group_name) VALUES(1,1,0,'household','2026-10','Manual expense','Food')")
        db.execute("UPDATE transactions SET category_id=1,category_source='manual' WHERE id=?", (core_purchase["id"],))
        paycheck = db.execute("SELECT * FROM transactions WHERE description='DIRECT DEPOSIT PAYROLL'").fetchone()
        db.execute("INSERT INTO transaction_exclusions(household_id,owner_id,scope,external_id) VALUES(1,0,'household',?)", (paycheck["external_id"],))
        db.execute("DELETE FROM transactions WHERE id=?", (paycheck["id"],))
        # An amount correction alone does not assert that a sweep is income.
        db.execute("UPDATE transactions SET amount_cents=2000,amount_override_cents=2000 WHERE id=?", (redemption["id"],))
        db.execute("UPDATE accounts SET name='Our own account label'")
    data["accounts"][0]["org"]["domain"] = "fidelity.com"
    simplefin.import_accounts(db_path, 1, "household", data)
    with connect(db_path) as db:
        assert db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 3
        redemption = db.execute("SELECT * FROM transactions WHERE description LIKE 'REDEMPTION%'").fetchone()
        core_purchase = db.execute("SELECT * FROM transactions WHERE description LIKE 'PURCHASE INTO%'").fetchone()
        assert redemption["provider_role"] == "bank_transfer"
        assert redemption["provider_role_override"] == "ordinary"
        assert redemption["income_entry_id"] == 1
        assert redemption["amount_cents"] == redemption["amount_override_cents"] == 2000
        assert redemption["account_name"] == "Our own account label"
        assert core_purchase["provider_role_override"] == "ordinary"
        assert core_purchase["category_id"] == 1 and core_purchase["category_source"] == "manual"


def test_automatic_category_removed_but_amount_only_override_is_retained(db_path):
    data = feed(domain="other-bank.example")
    simplefin.import_accounts(db_path, 1, "household", data)
    with connect(db_path) as db:
        db.execute("INSERT INTO budget_items(id,household_id,owner_id,scope,month,name,group_name) VALUES(1,1,0,'household','2026-10','Automatic expense','Food')")
        db.execute("UPDATE transactions SET category_id=1,category_source='automatic',amount_override_cents=1900,amount_cents=1900 WHERE description LIKE 'REDEMPTION%'")
    data["accounts"][0]["org"]["domain"] = "fidelity.com"
    simplefin.import_accounts(db_path, 1, "household", data)
    with connect(db_path) as db:
        row = db.execute("SELECT * FROM transactions WHERE description LIKE 'REDEMPTION%'").fetchone()
        assert row["provider_role"] == "bank_transfer"
        assert row["provider_role_override"] is None
        assert row["amount_cents"] == row["amount_override_cents"] == 1900
        assert row["category_id"] is None and row["category_source"] == "unmatched"


def test_explicit_transfer_override_survives_provider_not_recognizing_row(db_path):
    data = feed()
    simplefin.import_accounts(db_path, 1, "household", data)
    with connect(db_path) as db:
        db.execute("UPDATE transactions SET provider_role_override='bank_transfer' WHERE description='DIRECT DEPOSIT PAYROLL'")
        db.execute("UPDATE transactions SET provider_role_override='ordinary' WHERE description LIKE 'REDEMPTION%'")
    data["accounts"][0]["org"]["domain"] = "other-bank.example"
    simplefin.import_accounts(db_path, 1, "household", data)
    with connect(db_path) as db:
        paycheck = db.execute("SELECT * FROM transactions WHERE description='DIRECT DEPOSIT PAYROLL'").fetchone()
        redemption = db.execute("SELECT * FROM transactions WHERE description LIKE 'REDEMPTION%'").fetchone()
        assert paycheck["provider_role"] == "ordinary" and paycheck["provider_role_override"] == "bank_transfer"
        assert redemption["provider_role"] == "ordinary" and redemption["provider_role_override"] == "ordinary"
        assert redemption["provider_handler"] is None


def test_verified_sync_backfills_saved_sweeps_outside_overlap_and_preserves_decisions(db_path):
    # Simulate old imported rows. The new sync will contain no transactions.
    data = feed(domain="other-bank.example")
    simplefin.import_accounts(db_path, 1, "personal", data)
    simplefin.import_accounts(db_path, 2, "personal", data)
    with connect(db_path) as db:
        account_id = db.execute("SELECT id FROM accounts WHERE owner_id=1").fetchone()[0]
        rows = {row["description"]: row for row in db.execute("SELECT * FROM transactions WHERE owner_id=1")}
        redemption = next(row for name, row in rows.items() if name.startswith("REDEMPTION"))
        purchase = next(row for name, row in rows.items() if name.startswith("PURCHASE INTO"))
        db.execute("UPDATE transactions SET date='2026-07-01' WHERE owner_id=1")
        db.execute("INSERT INTO income_entries(id,household_id,owner_id,scope,month,name,amount_cents,date,kind) VALUES(1,1,1,'personal','2026-07','Prior paycheck assignment',1893,'2026-07-01','manual')")
        db.execute("UPDATE transactions SET income_entry_id=1 WHERE id=?", (redemption["id"],))
        db.execute("INSERT INTO budget_items(id,household_id,owner_id,scope,month,name,group_name) VALUES(1,1,1,'personal','2026-07','Prior automatic match','Food')")
        db.execute("UPDATE transactions SET category_id=1,category_source='automatic' WHERE id=?", (purchase["id"],))
        db.execute("INSERT INTO transactions(household_id,owner_id,scope,description,amount_cents,date,account_id,external_id,amount_override_cents) VALUES(1,1,'personal','REDEMPTION FROM CORE ACCOUNT',500,'2026-07-01',?,'old-corrected',500)", (account_id,))
        db.execute("INSERT INTO transactions(household_id,owner_id,scope,description,amount_cents,date,account_id) VALUES(1,1,'personal','REDEMPTION FROM CORE ACCOUNT',500,'2026-07-01',?)", (account_id,))
        db.execute("INSERT INTO transactions(household_id,owner_id,scope,description,amount_cents,date,account_id,external_id,provider_role_override) VALUES(1,1,'personal','PURCHASE INTO CORE ACCOUNT',-100,'2026-07-01',?,'explicit-normal','ordinary')", (account_id,))
        db.execute("INSERT INTO transactions(household_id,owner_id,scope,description,amount_cents,date,account_id,external_id,category_id) VALUES(1,1,'personal','PURCHASE INTO CORE ACCOUNT',-200,'2026-07-01',?,'legacy-manual',1)", (account_id,))
        db.execute("INSERT INTO transactions(household_id,owner_id,scope,description,amount_cents,date,account_id,external_id) VALUES(1,1,'personal','REDEMPTION FROM CORE ACCOUNT',200,'2026-07-01',?,'excluded-existing')", (account_id,))
        db.execute("INSERT INTO transaction_exclusions(household_id,owner_id,scope,external_id) VALUES(1,1,'personal','excluded-existing')")
    verified = feed(v2=True)
    verified["accounts"][0]["transactions"] = []
    result = simplefin.import_accounts(db_path, 1, "personal", verified)
    assert result["imported_transactions"] == 0
    with connect(db_path) as db:
        row = db.execute("SELECT * FROM transactions WHERE id=?", (redemption["id"],)).fetchone()
        assert row["provider_role"] == "bank_transfer" and row["provider_role_override"] == "ordinary"
        assert row["income_entry_id"] == 1 and row["date"] == "2026-07-01"
        row = db.execute("SELECT * FROM transactions WHERE id=?", (purchase["id"],)).fetchone()
        assert row["provider_role"] == "bank_transfer" and row["category_id"] is None
        assert row["category_source"] == "unmatched"
        row = db.execute("SELECT * FROM transactions WHERE external_id='old-corrected'").fetchone()
        assert row["provider_role"] == "ordinary" and row["amount_cents"] == row["amount_override_cents"] == 500
        row = db.execute("SELECT * FROM transactions WHERE external_id IS NULL").fetchone()
        assert row["provider_role"] == "ordinary"
        row = db.execute("SELECT * FROM transactions WHERE external_id='explicit-normal'").fetchone()
        assert row["provider_role"] == "bank_transfer" and row["provider_role_override"] == "ordinary"
        row = db.execute("SELECT * FROM transactions WHERE external_id='legacy-manual'").fetchone()
        assert row["provider_role_override"] == "ordinary" and row["category_id"] == 1
        row = db.execute("SELECT * FROM transactions WHERE external_id='excluded-existing'").fetchone()
        assert row["provider_role"] == "ordinary"
        assert db.execute("SELECT COUNT(*) FROM transactions WHERE owner_id=2 AND provider_role='bank_transfer'").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM transactions WHERE owner_id=1 AND description='DIRECT DEPOSIT PAYROLL' AND provider_role='ordinary'").fetchone()[0] == 1
