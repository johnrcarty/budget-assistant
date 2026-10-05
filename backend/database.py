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
    color TEXT NOT NULL DEFAULT '#4f766b', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), managed_source TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(household_id,owner_id,scope,name_key)
);
CREATE TABLE IF NOT EXISTS budget_item_lineages (
    id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    owner_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('household','personal')),
    bill_recurrence_key TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS budget_item_due_versions (
    id INTEGER PRIMARY KEY, lineage_id INTEGER NOT NULL REFERENCES budget_item_lineages(id),
    due_day TEXT, effective_from TEXT NOT NULL, effective_to TEXT,
    UNIQUE(lineage_id,effective_from)
);
CREATE TABLE IF NOT EXISTS budget_item_payment_facts (
    lineage_id INTEGER NOT NULL REFERENCES budget_item_lineages(id), month TEXT NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0 CHECK(paid IN (0,1)),
    PRIMARY KEY(lineage_id,month)
);
CREATE TABLE IF NOT EXISTS budget_items (
    id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    owner_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('household','personal')),
    month TEXT NOT NULL, name TEXT NOT NULL, group_name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#4f766b', planned_cents INTEGER NOT NULL DEFAULT 0,
    budget_category_id INTEGER REFERENCES budget_categories(id),
    lineage_id INTEGER REFERENCES budget_item_lineages(id)
);
CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    owner_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('household','personal')),
    name TEXT NOT NULL, amount_cents INTEGER NOT NULL, due_date TEXT NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0, autopay INTEGER NOT NULL DEFAULT 0,
    recurrence TEXT NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none','monthly')),
    recurrence_key TEXT, recurrence_day INTEGER,
    budget_item_lineage_id INTEGER REFERENCES budget_item_lineages(id), item_month TEXT,
    UNIQUE(household_id,owner_id,scope,recurrence_key,due_date)
);
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    owner_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('household','personal')),
    name TEXT NOT NULL, institution TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'checking',
    balance_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
    source TEXT NOT NULL DEFAULT 'manual', simplefin_id TEXT,
    original_balance_cents INTEGER, apr_basis_points INTEGER, debt_type TEXT,
    opened_date TEXT, term_months INTEGER, notes TEXT,
    archived INTEGER NOT NULL DEFAULT 0, archived_at TEXT, created_at TEXT,
    balance_as_of TEXT, debt_lineage_id INTEGER REFERENCES budget_item_lineages(id),
    UNIQUE(household_id,owner_id,scope,simplefin_id)
);
CREATE TABLE IF NOT EXISTS account_balance_observations (
    id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id),
    observed_at TEXT NOT NULL, provider_as_of TEXT, effective_at TEXT NOT NULL,
    balance_cents INTEGER NOT NULL, currency TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_valuation_events (
    id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id),
    observed_at TEXT NOT NULL, kind TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS debt_payment_versions (
    id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id),
    amount_cents INTEGER NOT NULL, cadence TEXT NOT NULL, anchor_date TEXT NOT NULL,
    day1 TEXT NOT NULL DEFAULT '15', day2 TEXT NOT NULL DEFAULT 'last', active INTEGER NOT NULL DEFAULT 1,
    effective_from TEXT NOT NULL, effective_to TEXT
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
    category_source TEXT NOT NULL DEFAULT 'unmatched',
    categorization_rule_id INTEGER REFERENCES categorization_rules(id) ON DELETE SET NULL,
    UNIQUE(household_id,owner_id,scope,external_id)
);
CREATE TABLE IF NOT EXISTS categorization_rules (
    id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    owner_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('household','personal')),
    name TEXT NOT NULL, merchant_text TEXT NOT NULL, match_type TEXT NOT NULL CHECK(match_type IN ('contains','exact')),
    direction TEXT NOT NULL DEFAULT 'outflow' CHECK(direction IN ('outflow','inflow','any')),
    account_id INTEGER REFERENCES accounts(id),
    budget_item_lineage_id INTEGER NOT NULL REFERENCES budget_item_lineages(id),
    active INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS categorization_previews (
    token_hash TEXT PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    owner_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('household','personal')),
    month TEXT NOT NULL, fingerprint TEXT NOT NULL, expires_at TEXT NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_categorization_rule_scope ON categorization_rules(household_id,owner_id,scope,priority,id);
CREATE INDEX IF NOT EXISTS idx_categorization_preview_scope ON categorization_previews(household_id,owner_id,scope,expires_at);
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
        if 'lineage_id' not in item_columns:
            db.execute('ALTER TABLE budget_items ADD COLUMN lineage_id INTEGER REFERENCES budget_item_lineages(id)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_item_category ON budget_items(budget_category_id,month)')
        category_columns = {row['name'] for row in db.execute('PRAGMA table_info(budget_categories)')}
        if 'managed_source' not in category_columns:
            db.execute('ALTER TABLE budget_categories ADD COLUMN managed_source TEXT')
        from .categories import ensure_categories
        ensure_categories(db)
        from .item_details import ensure_lineages
        ensure_lineages(db)
        db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_item_lineage_month ON budget_items(lineage_id,month) WHERE lineage_id IS NOT NULL')
        bill_columns = {row['name'] for row in db.execute('PRAGMA table_info(bills)')}
        for name, definition in (('budget_item_lineage_id', 'INTEGER REFERENCES budget_item_lineages(id)'), ('item_month', 'TEXT')):
            if name not in bill_columns:
                db.execute(f'ALTER TABLE bills ADD COLUMN {name} {definition}')
        db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_bill_item_month ON bills(budget_item_lineage_id,item_month) WHERE budget_item_lineage_id IS NOT NULL')
        account_columns = {row['name'] for row in db.execute('PRAGMA table_info(accounts)')}
        for name, definition in (('original_balance_cents', 'INTEGER'), ('apr_basis_points', 'INTEGER'),
                                 ('debt_type', 'TEXT'), ('opened_date', 'TEXT'), ('term_months', 'INTEGER'),
                                 ('notes', 'TEXT'), ('archived', 'INTEGER NOT NULL DEFAULT 0'),
                                 ('archived_at', 'TEXT'), ('created_at', 'TEXT'), ('balance_as_of', 'TEXT'),
                                 ('debt_lineage_id', 'INTEGER REFERENCES budget_item_lineages(id)')):
            if name not in account_columns:
                db.execute(f'ALTER TABLE accounts ADD COLUMN {name} {definition}')
        if 'managed_account_id' not in item_columns:
            db.execute('ALTER TABLE budget_items ADD COLUMN managed_account_id INTEGER REFERENCES accounts(id)')
        for name, definition in (('debt_account_id', 'INTEGER REFERENCES accounts(id)'),
                                 ('debt_version_id', 'INTEGER REFERENCES debt_payment_versions(id)'),
                                 ('debt_occurrence_key', 'TEXT'), ('budget_item_id', 'INTEGER REFERENCES budget_items(id)')):
            if name not in bill_columns:
                db.execute(f'ALTER TABLE bills ADD COLUMN {name} {definition}')
        db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_item_month ON budget_items(managed_account_id,month) WHERE managed_account_id IS NOT NULL')
        db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_bill_occurrence ON bills(debt_account_id,debt_occurrence_key) WHERE debt_account_id IS NOT NULL')
        db.execute('CREATE INDEX IF NOT EXISTS idx_balance_observations_account ON account_balance_observations(account_id,effective_at,id)')
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_account_baseline ON account_balance_observations(account_id) WHERE source='baseline'")
        db.execute('CREATE INDEX IF NOT EXISTS idx_debt_versions_account ON debt_payment_versions(account_id,effective_from)')
        from .accounts import ensure_observations
        ensure_observations(db)
        columns = {row['name'] for row in db.execute('PRAGMA table_info(transactions)')}
        if 'amount_override_cents' not in columns:
            db.execute('ALTER TABLE transactions ADD COLUMN amount_override_cents INTEGER')
        if 'category_source' not in columns:
            db.execute("ALTER TABLE transactions ADD COLUMN category_source TEXT NOT NULL DEFAULT 'unmatched'")
            # Earlier releases did not record provenance or explicit clears.
            # Preserve every existing assignment as a manual decision.
            db.execute("UPDATE transactions SET category_source='manual' WHERE category_id IS NOT NULL")
        if 'categorization_rule_id' not in columns:
            db.execute('ALTER TABLE transactions ADD COLUMN categorization_rule_id INTEGER REFERENCES categorization_rules(id) ON DELETE SET NULL')
        exclusion_columns = {row['name'] for row in db.execute('PRAGMA table_info(income_exclusions)')}
        for name, definition in (('version_id', 'INTEGER REFERENCES income_source_versions(id)'), ('scheduled_date', 'TEXT')):
            if name not in exclusion_columns:
                db.execute(f'ALTER TABLE income_exclusions ADD COLUMN {name} {definition}')
        from .income import migrate_legacy_income
        migrate_legacy_income(db)
