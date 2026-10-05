from backend.database import connect, initialize


def test_legacy_transaction_migration_preserves_data_and_manual_choices(tmp_path):
    path = tmp_path / 'legacy.sqlite3'
    initialize(path)
    with connect(path) as db:
        db.execute("INSERT INTO households(id,name,timezone) VALUES(1,'Test home','America/New_York')")
        db.execute("INSERT INTO users(id,username,display_name,household_id) VALUES(1,'one','One',1)")
        db.execute("""INSERT INTO budget_categories(id,household_id,owner_id,scope,name,name_key)
                      VALUES(5,1,0,'household','Food','food')""")
        db.execute("INSERT INTO budget_item_lineages(id,household_id,owner_id,scope) VALUES(6,1,0,'household')")
        db.execute("""INSERT INTO budget_items(id,household_id,owner_id,scope,month,name,group_name,
                      budget_category_id,lineage_id) VALUES(7,1,0,'household','2026-10','Groceries','Food',5,6)""")
        db.execute("""INSERT INTO accounts(id,household_id,owner_id,scope,name,kind,currency,balance_cents)
                      VALUES(3,1,0,'household','Test checking','checking','USD',5499)""")
        # Reproduce the pre-rules transaction table in this temporary database.
        db.execute('DROP TABLE transactions')
        db.execute("""CREATE TABLE transactions (
            id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
            owner_id INTEGER NOT NULL, scope TEXT NOT NULL,
            description TEXT NOT NULL, amount_cents INTEGER NOT NULL, date TEXT NOT NULL,
            account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
            account_name TEXT NOT NULL DEFAULT 'Manual entry',
            category_id INTEGER REFERENCES budget_items(id) ON DELETE SET NULL,
            pending INTEGER NOT NULL DEFAULT 0, external_id TEXT, amount_override_cents INTEGER,
            UNIQUE(household_id,owner_id,scope,external_id)
        )""")
        db.executemany("""INSERT INTO transactions(id,household_id,owner_id,scope,description,
            amount_cents,date,account_id,account_name,category_id,pending,external_id,amount_override_cents)
            VALUES (?,1,0,'household',?,-1999,'2026-10-04',3,'Test checking',?,1,?,-1999)""",
            [(11, 'Manually assigned purchase', 7, 'bank:assigned'),
             (12, 'Legacy uncategorized purchase', None, 'bank:unmatched')])
        original = [dict(row) for row in db.execute('SELECT * FROM transactions ORDER BY id')]

    initialize(path)
    with connect(path) as db:
        migrated = [dict(row) for row in db.execute('SELECT * FROM transactions ORDER BY id')]
        for before, after in zip(original, migrated, strict=True):
            assert {key: after[key] for key in before} == before
            assert after['categorization_rule_id'] is None
        assert migrated[0]['category_source'] == 'manual'
        assert migrated[1]['category_source'] == 'unmatched'
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        # A deliberate clear recorded after migration must survive later boots.
        db.execute("UPDATE transactions SET category_source='manual' WHERE id=12")

    initialize(path)
    with connect(path) as db:
        assert db.execute('SELECT id,category_id,category_source FROM transactions ORDER BY id').fetchall()[0][:] == (11, 7, 'manual')
        assert db.execute('SELECT id,category_id,category_source FROM transactions ORDER BY id').fetchall()[1][:] == (12, None, 'manual')
        assert db.execute('SELECT balance_cents FROM accounts WHERE id=3').fetchone()[0] == 5499
