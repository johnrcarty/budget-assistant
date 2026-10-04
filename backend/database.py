"""Small SQLite persistence layer. Money is stored in integer cents."""
import sqlite3
from pathlib import Path


SCHEMA = """
CREATE TABLE IF NOT EXISTS households (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, timezone TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL, password_hash TEXT,
    household_id INTEGER NOT NULL REFERENCES households(id),
    is_admin INTEGER NOT NULL DEFAULT 0,
    share_personal_totals INTEGER NOT NULL DEFAULT 0,
    ingress_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS budget_months (
    household_id INTEGER NOT NULL REFERENCES households(id), owner_id INTEGER NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('household','personal')), month TEXT NOT NULL,
    income_cents INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(household_id,owner_id,scope,month)
);
CREATE TABLE IF NOT EXISTS budget_categories (
    id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    owner_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('household','personal')),
    name TEXT NOT NULL, name_key TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#4f766b', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(household_id,owner_id,scope,name_key)
);
CREATE TABLE IF NOT EXISTS budget_items (
    id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    owner_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('household','personal')),
    month TEXT NOT NULL, name TEXT NOT NULL, group_name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#4f766b', planned_cents INTEGER NOT NULL DEFAULT 0,
    budget_category_id INTEGER REFERENCES budget_categories(id)
);
CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    owner_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('household','personal')),
    name TEXT NOT NULL, amount_cents INTEGER NOT NULL, due_date TEXT NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0, autopay INTEGER NOT NULL DEFAULT 0,
    recurrence TEXT NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none','monthly')),
    recurrence_key TEXT, recurrence_day INTEGER,
    UNIQUE(household_id,owner_id,scope,recurrence_key,due_date)
);
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    owner_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('household','personal')),
    name TEXT NOT NULL, institution TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'checking',
    balance_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
    source TEXT NOT NULL DEFAULT 'manual', simplefin_id TEXT,
    UNIQUE(household_id,owner_id,scope,simplefin_id)
);
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    owner_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('household','personal')),
    description TEXT NOT NULL, amount_cents INTEGER NOT NULL, date TEXT NOT NULL,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    account_name TEXT NOT NULL DEFAULT 'Manual entry',
    category_id INTEGER REFERENCES budget_items(id) ON DELETE SET NULL,
    pending INTEGER NOT NULL DEFAULT 0, external_id TEXT,
    amount_override_cents INTEGER,
    UNIQUE(household_id,owner_id,scope,external_id)
);
CREATE TABLE IF NOT EXISTS transaction_exclusions (
    household_id INTEGER NOT NULL REFERENCES households(id), owner_id INTEGER NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('household','personal')), external_id TEXT NOT NULL,
    PRIMARY KEY(household_id,owner_id,scope,external_id)
);
CREATE TABLE IF NOT EXISTS integration_state (
    household_id INTEGER NOT NULL REFERENCES households(id), owner_id INTEGER NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('household','personal')), credential TEXT,
    connected INTEGER NOT NULL DEFAULT 0, last_sync TEXT, sync_error TEXT,
    warnings TEXT NOT NULL DEFAULT '[]', sync_interval_hours INTEGER NOT NULL DEFAULT 6,
    last_attempt TEXT,
    PRIMARY KEY(household_id,owner_id,scope)
);
CREATE TABLE IF NOT EXISTS machine_tokens (
    id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS income_sources (
    id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    owner_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('household','personal')),
    name TEXT NOT NULL, stopped_from TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS income_source_versions (
    id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES income_sources(id),
    name TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
    cadence TEXT NOT NULL CHECK(cadence IN ('once','weekly','biweekly','semimonthly','monthly')),
    anchor_date TEXT NOT NULL, day1 TEXT NOT NULL DEFAULT '15', day2 TEXT NOT NULL DEFAULT 'last',
    effective_from TEXT NOT NULL, effective_to TEXT, superseded INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS income_entries (
    id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    owner_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('household','personal')),
    month TEXT NOT NULL, name TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
    date TEXT, scheduled_date TEXT, source_id INTEGER REFERENCES income_sources(id),
    version_id INTEGER REFERENCES income_source_versions(id), occurrence_key TEXT,
    overridden INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL CHECK(kind IN ('manual','scheduled','legacy')),
    UNIQUE(source_id,occurrence_key)
);
CREATE TABLE IF NOT EXISTS income_exclusions (
    household_id INTEGER NOT NULL REFERENCES households(id), owner_id INTEGER NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('household','personal')),
    source_id INTEGER NOT NULL REFERENCES income_sources(id), occurrence_key TEXT NOT NULL,
    version_id INTEGER REFERENCES income_source_versions(id), scheduled_date TEXT,
    PRIMARY KEY(household_id,owner_id,scope,source_id,occurrence_key)
);
CREATE TABLE IF NOT EXISTS income_migrations (
    household_id INTEGER NOT NULL REFERENCES households(id), owner_id INTEGER NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('household','personal')), month TEXT NOT NULL,
    PRIMARY KEY(household_id,owner_id,scope,month)
);
CREATE INDEX IF NOT EXISTS idx_income_scope_month ON income_entries(household_id,scope,owner_id,month);
CREATE INDEX IF NOT EXISTS idx_income_versions ON income_source_versions(source_id,effective_from);
CREATE INDEX IF NOT EXISTS idx_budget_scope ON budget_items(household_id,scope,owner_id,month);
CREATE INDEX IF NOT EXISTS idx_bill_scope_due ON bills(household_id,scope,owner_id,due_date);
CREATE INDEX IF NOT EXISTS idx_transaction_scope_date ON transactions(household_id,scope,owner_id,date);
"""


class ManagedConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def connect(path: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(path), timeout=15, factory=ManagedConnection)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys=ON')
    connection.execute('PRAGMA busy_timeout=15000')
    return connection


def initialize(path: str | Path) -> None:
    with connect(path) as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript(SCHEMA)
        # Forward migration for early local previews. No destructive data rebuilds.
        item_columns = {row['name'] for row in db.execute('PRAGMA table_info(budget_items)')}
        if 'budget_category_id' not in item_columns:
            db.execute('ALTER TABLE budget_items ADD COLUMN budget_category_id INTEGER REFERENCES budget_categories(id)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_item_category ON budget_items(budget_category_id,month)')
        from .categories import ensure_categories
        ensure_categories(db)
        columns = {row['name'] for row in db.execute('PRAGMA table_info(transactions)')}
        if 'amount_override_cents' not in columns:
            db.execute('ALTER TABLE transactions ADD COLUMN amount_override_cents INTEGER')
        exclusion_columns = {row['name'] for row in db.execute('PRAGMA table_info(income_exclusions)')}
        for name, definition in (('version_id', 'INTEGER REFERENCES income_source_versions(id)'), ('scheduled_date', 'TEXT')):
            if name not in exclusion_columns:
                db.execute(f'ALTER TABLE income_exclusions ADD COLUMN {name} {definition}')
        from .income import migrate_legacy_income
        migrate_legacy_income(db)
