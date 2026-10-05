"""Persistence, migration, historical spending, and category privacy invariants."""
from datetime import date
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app, password_hash
from backend.database import connect, initialize


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv('BUDGET_AUTH_MODE', 'local')
    monkeypatch.setenv('BUDGET_LOCAL_AUTH', 'true')
    monkeypatch.setenv('BUDGET_DEMO', '0')
    app = create_app(tmp_path, today=lambda zone: date(2026, 10, 7))
    with TestClient(app) as client:
        response = client.post('/api/auth/setup', json={
            'username': 'owner', 'display_name': 'Owner',
            'password': 'long-owner-password', 'household_name': 'First home',
        })
        assert response.status_code == 201, response.text
        owner = {'Authorization': 'Bearer ' + response.json()['token']}
        assert client.post('/api/members', headers=owner, json={
            'username': 'member', 'display_name': 'Member',
            'password': 'long-member-password',
        }).status_code == 201
        response = client.post('/api/auth/login', json={
            'username': 'member', 'password': 'long-member-password',
        })
        assert response.status_code == 200
        member = {'Authorization': 'Bearer ' + response.json()['token']}
        # A second household exercises membership, not merely owner_id isolation.
        with connect(app.state.db_path) as db:
            hid = db.execute("INSERT INTO households(name,timezone) VALUES ('Other home','America/New_York')").lastrowid
            db.execute('INSERT INTO users(username,display_name,password_hash,household_id,is_admin) VALUES (?,?,?,?,1)',
                       ('outsider', 'Outsider', password_hash('long-outside-password'), hid))
        response = client.post('/api/auth/login', json={
            'username': 'outsider', 'password': 'long-outside-password',
        })
        assert response.status_code == 200
        outsider = {'Authorization': 'Bearer ' + response.json()['token']}
        yield app, client, owner, member, outsider


def category(client, headers, name='Housing', scope='household', **changes):
    response = client.post('/api/budget/categories', params={'scope': scope},
                           headers=headers, json={'name': name, **changes})
    assert response.status_code == 201, response.text
    return response.json()


def item(client, headers, category_id, name='Rent', month='2026-10', scope='household', amount=10000):
    response = client.post('/api/budget/items', params={'scope': scope, 'month': month},
                           headers=headers, json={
                               'name': name, 'budget_category_id': category_id,
                               'planned_cents': amount,
                           })
    assert response.status_code == 201, response.text
    return response.json()


def categories(client, headers, month='2026-10', scope='household'):
    response = client.get('/api/budget/categories', headers=headers,
                          params={'scope': scope, 'month': month})
    assert response.status_code == 200, response.text
    return response.json()


def dashboard(client, headers, month='2026-10', scope='household'):
    response = client.get('/api/dashboard', headers=headers,
                          params={'scope': scope, 'month': month})
    assert response.status_code == 200, response.text
    return response.json()


def transaction(client, headers, item_id, amount=-2500, when='2026-10-07', scope='household'):
    response = client.post('/api/transactions', headers=headers, params={'scope': scope}, json={
        'description': 'Payment', 'amount_cents': amount, 'date': when,
        'category_id': item_id,
    })
    assert response.status_code == 201, response.text
    return response.json()


def test_real_legacy_migration_preserves_rows_associations_and_scope(tmp_path):
    path = tmp_path / 'legacy.sqlite3'
    # Build the old schema directly so the test cannot accidentally start from
    # the current schema and skip the additive migration it is meant to verify.
    with sqlite3.connect(path) as db:
        db.executescript('''
            CREATE TABLE households (id INTEGER PRIMARY KEY,name TEXT NOT NULL,timezone TEXT NOT NULL,
                                     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE users (id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,
                                password_hash TEXT,household_id INTEGER NOT NULL REFERENCES households(id),
                                is_admin INTEGER NOT NULL DEFAULT 0,share_personal_totals INTEGER NOT NULL DEFAULT 0,
                                ingress_id TEXT UNIQUE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE budget_items (id INTEGER PRIMARY KEY,household_id INTEGER NOT NULL REFERENCES households(id),
                                       owner_id INTEGER NOT NULL,scope TEXT NOT NULL,month TEXT NOT NULL,
                                       name TEXT NOT NULL,group_name TEXT NOT NULL,color TEXT NOT NULL,
                                       planned_cents INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE transactions (id INTEGER PRIMARY KEY,household_id INTEGER NOT NULL REFERENCES households(id),
                                       owner_id INTEGER NOT NULL,scope TEXT NOT NULL,description TEXT NOT NULL,
                                       amount_cents INTEGER NOT NULL,date TEXT NOT NULL,account_id INTEGER,
                                       account_name TEXT NOT NULL DEFAULT 'Manual entry',
                                       category_id INTEGER REFERENCES budget_items(id) ON DELETE SET NULL,
                                       pending INTEGER NOT NULL DEFAULT 0,external_id TEXT);
        ''')
        db.executemany('INSERT INTO households(id,name,timezone) VALUES (?,?,?)',
                       [(1, 'First', 'America/New_York'), (2, 'Other', 'America/New_York')])
        db.executemany('INSERT INTO users(id,username,display_name,household_id) VALUES (?,?,?,?)',
                       [(1, 'one', 'One', 1), (2, 'two', 'Two', 1), (3, 'three', 'Three', 2)])
        db.executemany('INSERT INTO budget_items VALUES (?,?,?,?,?,?,?,?,?)', [
            (41, 1, 0, 'household', '2026-09', 'Rent', 'Housing', '#123456', 95000),
            (42, 1, 0, 'household', '2026-10', 'Rent', ' housing ', '#654321', 98000),
            (43, 1, 0, 'household', '2026-10', 'Groceries', 'Food', '#abcdef', 30000),
            (44, 1, 1, 'personal', '2026-10', 'Private rent', 'Housing', '#fedcba', 5000),
            (45, 1, 2, 'personal', '2026-10', 'Other private rent', 'Housing', '#aaaabb', 9000),
            (46, 2, 0, 'household', '2026-10', 'Other rent', 'Housing', '#bbccdd', 70000),
            (47, 1, 0, 'household', '2026-10', 'Bus', 'Transportation', '#ccddee', 15000),
        ])
        db.executemany('INSERT INTO transactions(id,household_id,owner_id,scope,description,amount_cents,date,category_id) VALUES (?,?,?,?,?,?,?,?)', [
            (91, 1, 0, 'household', 'Rent payment', -18000, '2026-10-07', 42),
            (92, 1, 1, 'personal', 'Private payment', -900, '2026-10-07', 44),
        ])
        original_items = db.execute('SELECT * FROM budget_items ORDER BY id').fetchall()
        original_transactions = db.execute('SELECT id,category_id,amount_cents FROM transactions ORDER BY id').fetchall()
    initialize(path)
    with connect(path) as db:
        columns = 'id,household_id,owner_id,scope,month,name,group_name,color,planned_cents'
        assert [tuple(row) for row in db.execute(f'SELECT {columns} FROM budget_items ORDER BY id')] == original_items
        assert [tuple(row) for row in db.execute('SELECT id,category_id,amount_cents FROM transactions ORDER BY id')] == original_transactions
        links = {row['id']: row['budget_category_id'] for row in db.execute('SELECT id,budget_category_id FROM budget_items')}
        assert links[41] == links[42]
        assert len({links[index] for index in (41, 43, 44, 45, 46, 47)}) == 6
        migrated = [dict(row) for row in db.execute('SELECT * FROM budget_categories ORDER BY id')]
        housing = next(row for row in migrated if row['id'] == links[41])
        assert housing['name'] == 'Housing' and housing['color'] == '#123456'
        assert all(row['active'] for row in migrated)
    initialize(path)
    initialize(path)
    with connect(path) as db:
        assert [dict(row) for row in db.execute('SELECT * FROM budget_categories ORDER BY id')] == migrated
        assert {row['id']: row['budget_category_id'] for row in db.execute('SELECT id,budget_category_id FROM budget_items')} == links
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def test_empty_categories_survive_last_item_deletion_other_months_and_restart(home):
    app, client, owner, _, _ = home
    cid = category(client, owner, 'Future projects', color='#123456')['id']
    entry = item(client, owner, cid)
    assert client.delete(f"/api/budget/items/{entry['id']}", headers=owner).status_code == 204
    for month in ('2026-10', '2026-11', '2027-01'):
        row = next(row for row in categories(client, owner, month) if row['id'] == cid)
        assert row['name'] == 'Future projects' and row['color'] == '#123456'
        assert row['active'] is True and row['items'] == []
        assert row['planned_cents'] == row['spent_cents'] == 0
    restarted = create_app(app.state.db_path.parent, today=lambda zone: date(2026, 10, 7))
    with TestClient(restarted) as next_client:
        row = next(row for row in categories(next_client, owner) if row['id'] == cid)
        assert row['name'] == 'Future projects' and row['items'] == []


def test_category_ownership_and_household_membership_protect_reads_and_mutations(home):
    _, client, owner, member, outsider = home
    household = category(client, owner)['id']
    private = category(client, owner, 'Private hobby', scope='personal')['id']
    foreign = category(client, outsider, 'Other household')['id']
    assert {row['id'] for row in categories(client, member) if row['source'] != 'saved'} == {household}
    for actor, scope, target in (
        (member, 'personal', private), (member, 'household', private),
        (owner, 'household', private), (outsider, 'household', household),
        (owner, 'household', foreign),
    ):
        for method in ('patch', 'put'):
            result = getattr(client, method)(f'/api/budget/categories/{target}',
                                            params={'scope': scope}, headers=actor,
                                            json={'name': 'Guessed', 'active': False})
            assert result.status_code == 404, result.text
        result = client.post('/api/budget/items', headers=actor,
                             params={'scope': scope, 'month': '2026-10'},
                             json={'name': 'Wrong membership', 'budget_category_id': target,
                                   'group_name': 'Fallback must not bypass ID'})
        assert result.status_code == 404, result.text
        rows = client.get('/api/budget/categories', headers=actor,
                          params={'scope': scope, 'month': '2026-10', 'owner_id': 1, 'household_id': 1})
        assert rows.status_code == 200 and all(row['id'] != target for row in rows.json())
    assert next(row for row in categories(client, owner) if row['id'] == household)['active'] is True
    assert next(row for row in categories(client, owner, scope='personal') if row['id'] == private)['name'] == 'Private hobby'


def test_shared_personal_aggregate_never_exposes_category_metadata_or_ids(home):
    _, client, owner, member, _ = home
    public = category(client, owner, 'Household needs')['id']
    item(client, owner, public, amount=6000)
    private = category(client, owner, 'Secret instruments', scope='personal', color='#123abc')['id']
    entry = item(client, owner, private, name='Private violin', scope='personal', amount=8765)
    transaction(client, owner, entry['id'], amount=-1234, scope='personal')
    assert client.patch('/api/settings', headers=owner, json={'share_personal_totals': True}).status_code == 200
    result = dashboard(client, member)
    assert result['shared_personal']['planned_cents'] == 8765
    assert result['shared_personal']['spent_cents'] == 1234
    assert result['planned_cents'] == 14765
    assert sum(row['planned_cents'] for row in result['groups']) == 6000
    assert {row['id'] for row in result['groups'] if row['source'] != 'saved'} == {public}
    for path in ('/api/dashboard', '/api/budget/categories', '/api/budget/items'):
        response = client.get(path, headers=member, params={'scope': 'household', 'month': '2026-10'})
        assert response.status_code == 200
        assert all(secret not in response.text for secret in ('Secret instruments', 'Private violin', '#123abc'))
    private_groups = categories(client, member, scope='personal')
    assert len(private_groups) == 1 and private_groups[0]['source'] == 'saved'
    assert private_groups[0]['items'] == [] and private_groups[0]['planned_cents'] == private_groups[0]['spent_cents'] == 0
    assert client.patch('/api/settings', headers=owner, json={'share_personal_totals': False}).status_code == 200
    assert dashboard(client, member)['planned_cents'] == 6000


def test_machine_token_cannot_read_or_change_categories(home):
    _, client, owner, _, _ = home
    cid = category(client, owner)['id']
    token = client.post('/api/integrations/ha-token', headers=owner).json()['token']
    machine = {'Authorization': 'Bearer ' + token}
    for scope in ('household', 'personal'):
        assert client.get('/api/budget/categories', headers=machine, params={'scope': scope}).status_code == 401
        assert client.post('/api/budget/categories', headers=machine, params={'scope': scope}, json={'name': 'Injected'}).status_code == 401
        assert client.patch(f'/api/budget/categories/{cid}', headers=machine, params={'scope': scope}, json={'active': False}).status_code == 401
    assert next(row for row in categories(client, owner) if row['id'] == cid)['active'] is True


def test_duplicate_names_are_normalized_scoped_and_include_archived(home):
    _, client, owner, member, outsider = home
    food = category(client, owner, ' Food ')['id']
    travel = category(client, owner, 'Travel')['id']
    for name in ('Food', ' food ', 'FOOD'):
        assert client.post('/api/budget/categories', headers=owner, json={'name': name}).status_code == 409
    conflict = client.patch(f'/api/budget/categories/{travel}', headers=owner, json={'name': ' fOoD '})
    assert conflict.status_code == 409
    assert next(row for row in categories(client, owner) if row['id'] == travel)['name'] == 'Travel'
    assert client.patch(f'/api/budget/categories/{food}', headers=owner, json={'active': False}).status_code == 200
    assert client.post('/api/budget/categories', headers=owner, json={'name': 'food'}).status_code == 409
    # Casefold, unlike SQLite's ASCII-only NOCASE, handles this equivalent name.
    category(client, owner, 'Straße')
    assert client.post('/api/budget/categories', headers=owner, json={'name': 'STRASSE'}).status_code == 409
    category(client, owner, 'Food', scope='personal')
    category(client, member, 'Food', scope='personal')
    category(client, outsider, 'Food')
    for payload in ({'name': '   '}, {'name': 'Valid', 'color': 'url(secret)'}):
        assert client.post('/api/budget/categories', headers=owner, json=payload).status_code == 422


def test_archive_retains_history_blocks_new_membership_and_restores_same_id(home):
    _, client, owner, _, _ = home
    cid = category(client, owner)['id']
    entry = item(client, owner, cid)
    payment = transaction(client, owner, entry['id'])
    assert client.patch(f'/api/budget/categories/{cid}', headers=owner, json={'active': False}).status_code == 200
    row = next(row for row in categories(client, owner) if row['id'] == cid)
    assert row['active'] is False
    assert [value['id'] for value in row['items']] == [entry['id']]
    assert (row['planned_cents'], row['spent_cents']) == (10000, 2500)
    assert client.post('/api/budget/items', headers=owner, json={'name': 'New', 'budget_category_id': cid}).status_code == 409
    assert client.patch(f"/api/budget/items/{entry['id']}", headers=owner,
                        json={'budget_category_id': cid, 'planned_cents': 12000}).status_code == 200
    other = category(client, owner, 'Other')['id']
    active_item = item(client, owner, other, name='Active item')
    assert client.patch(f"/api/budget/items/{active_item['id']}", headers=owner,
                        json={'budget_category_id': cid, 'name': 'Must roll back'}).status_code == 409
    assert client.delete(f'/api/budget/categories/{cid}', headers=owner).status_code == 405
    assert client.patch(f'/api/budget/categories/{cid}', headers=owner, json={'active': True}).status_code == 200
    item(client, owner, cid, name='Added after restore', amount=800)
    row = next(row for row in categories(client, owner) if row['id'] == cid)
    assert row['active'] is True and row['planned_cents'] == 12800 and row['spent_cents'] == 2500
    transactions = client.get('/api/transactions?month=2026-10', headers=owner).json()
    assert next(value for value in transactions if value['id'] == payment['id'])['category_id'] == entry['id']
    assert next(value for value in row['items'] if value['id'] == entry['id'])['planned_cents'] == 12000


def test_invalid_reassignment_rolls_back_and_valid_move_reconciles_groups(home):
    _, client, owner, member, _ = home
    first = category(client, owner, 'First')['id']
    second = category(client, owner, 'Second')['id']
    private = category(client, member, 'Private', scope='personal')['id']
    entry = item(client, owner, first, amount=7000)
    transaction(client, owner, entry['id'], amount=-2300)
    for target in (private, 999999):
        response = client.patch(f"/api/budget/items/{entry['id']}", headers=owner,
                                json={'budget_category_id': target, 'name': 'Wrong'})
        assert response.status_code == 404
    before = client.get('/api/budget/items?month=2026-10', headers=owner).json()[0]
    assert before['name'] == 'Rent' and before['budget_category_id'] == first
    moved = client.patch(f"/api/budget/items/{entry['id']}", headers=owner,
                         json={'budget_category_id': second})
    assert moved.status_code == 200 and moved.json()['id'] == entry['id']
    rows = {row['id']: row for row in categories(client, owner)}
    assert rows[first]['items'] == [] and rows[first]['planned_cents'] == rows[first]['spent_cents'] == 0
    assert rows[second]['planned_cents'] == 7000 and rows[second]['spent_cents'] == 2300
    result = dashboard(client, owner)
    assert result['planned_cents'] == sum(row['planned_cents'] for row in result['groups']) == 7000
    assert result['spent_cents'] == sum(row['spent_cents'] for row in result['groups']) == 2300


def test_metadata_edits_keep_item_snapshots_and_transaction_links(home):
    app, client, owner, _, _ = home
    cid = category(client, owner, 'Original', color='#123456')['id']
    entry = item(client, owner, cid)
    payment = transaction(client, owner, entry['id'])
    assert client.patch(f'/api/budget/categories/{cid}', headers=owner,
                        json={'name': 'Renamed', 'color': '#abcdef'}).status_code == 200
    with connect(app.state.db_path) as db:
        snapshot = db.execute('SELECT group_name,color FROM budget_items WHERE id=?', (entry['id'],)).fetchone()
        assert tuple(snapshot) == ('Original', '#123456')
        assert db.execute('SELECT category_id FROM transactions WHERE id=?', (payment['id'],)).fetchone()[0] == entry['id']
    row = next(row for row in categories(client, owner) if row['id'] == cid)
    assert (row['name'], row['color'], row['planned_cents'], row['spent_cents']) == ('Renamed', '#abcdef', 10000, 2500)
    current = client.get('/api/budget/items?month=2026-10', headers=owner).json()[0]
    # Current category presentation and original snapshots are both available.
    assert (current['id'], current['group_name'], current['color']) == (entry['id'], 'Renamed', '#abcdef')
    assert (current['snapshot_group_name'], current['snapshot_color']) == ('Original', '#123456')
    nested = row['items'][0]
    assert (nested['group_name'], nested['color']) == ('Renamed', '#abcdef')
    assert (nested['snapshot_group_name'], nested['snapshot_color']) == ('Original', '#123456')


def test_month_copy_preserves_archived_ids_empty_categories_and_exact_totals(home):
    _, client, owner, _, _ = home
    active = category(client, owner, 'Active')['id']
    archived = category(client, owner, 'Historical')['id']
    empty = category(client, owner, 'Future purpose')['id']
    first = item(client, owner, active, amount=10000)
    old = item(client, owner, archived, name='Historical item', amount=3000)
    transaction(client, owner, old['id'])
    assert client.patch(f'/api/budget/categories/{archived}', headers=owner, json={'active': False}).status_code == 200
    assert client.post('/api/budget/income', headers=owner,
                       json={'month': '2026-10', 'amount_cents': 100000}).status_code == 200
    copied = client.post('/api/budget/copy', headers=owner,
                         json={'from_month': '2026-10', 'to_month': '2026-11'})
    assert copied.status_code == 201, copied.text
    original = client.get('/api/budget/items?month=2026-10', headers=owner).json()
    target = client.get('/api/budget/items?month=2026-11', headers=owner).json()
    assert {row['id'] for row in original} == {first['id'], old['id']}
    assert {row['id'] for row in original}.isdisjoint(row['id'] for row in target)
    assert sorted((row['budget_category_id'], row['planned_cents']) for row in target) == sorted([(active, 10000), (archived, 3000)])
    groups = {row['id']: row for row in categories(client, owner, '2026-11')}
    assert {cid for cid, group in groups.items() if group['source'] != 'saved'} == {active, archived, empty}
    assert groups[archived]['active'] is False and groups[archived]['planned_cents'] == 3000
    assert groups[empty]['items'] == []
    copied_totals = dashboard(client, owner, '2026-11')
    assert copied_totals['income_cents'] == 100000
    assert copied_totals['planned_cents'] == sum(row['planned_cents'] for row in copied_totals['groups']) == 13000
    assert copied_totals['spent_cents'] == 0
    assert dashboard(client, owner)['spent_cents'] == 2500


def test_historical_item_associations_count_in_selected_month_category_spending(home):
    app, client, owner, _, _ = home
    cid = category(client, owner)['id']
    previous = item(client, owner, cid, month='2026-09', amount=9000)
    current = item(client, owner, cid, amount=10000)
    old_payment = transaction(client, owner, previous['id'], amount=-2500, when='2026-09-30')
    transaction(client, owner, current['id'], amount=-1800)
    refund = transaction(client, owner, previous['id'], amount=500, when='2026-09-30')
    transaction(client, owner, previous['id'], amount=-9999, when='2026-09-30')
    # Legacy/imported records may retain an old item's ID after their date moves.
    # Existing links must survive; fresh API assignments remain month-validated.
    with connect(app.state.db_path) as db:
        db.execute("UPDATE transactions SET date='2026-10-07' WHERE id IN (?,?)", (old_payment['id'], refund['id']))
    rejected = client.post('/api/transactions', headers=owner, json={
        'description': 'Fresh cross-month assignment', 'amount_cents': -100,
        'date': '2026-10-07', 'category_id': previous['id'],
    })
    assert rejected.status_code == 422
    row = next(row for row in categories(client, owner) if row['id'] == cid)
    assert row['planned_cents'] == 10000 and row['spent_cents'] == 3800
    assert [entry['id'] for entry in row['items']] == [current['id']]
    assert row['items'][0]['spent_cents'] == 1800
    assert row['historical_item_spent_cents'] == 2000
    result = dashboard(client, owner)
    assert result['spent_cents'] == sum(group['spent_cents'] for group in result['groups']) == 3800
    rows = client.get('/api/transactions?month=2026-10', headers=owner).json()
    assert next(entry for entry in rows if entry['id'] == old_payment['id'])['category_id'] == previous['id']


def test_lazy_legacy_backfill_handles_post_initialize_rows_once(home):
    app, client, owner, _, _ = home
    with connect(app.state.db_path) as db:
        hid = db.execute("SELECT household_id FROM users WHERE username='owner'").fetchone()[0]
        entry_id = db.execute('''INSERT INTO budget_items(household_id,owner_id,scope,month,name,group_name,color,planned_cents)
                                 VALUES (?,0,'household','2026-10','Legacy item','Late legacy','#123456',4321)''', (hid,)).lastrowid
    first = categories(client, owner)
    row = next(row for row in first if row['name'] == 'Late legacy')
    assert row['items'][0]['id'] == entry_id and row['planned_cents'] == 4321
    assert categories(client, owner) == first
    initialize(app.state.db_path)
    assert categories(client, owner) == first
