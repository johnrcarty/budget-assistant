"""Built-in Saved identity, adoption, ordinary items, and scoped ownership."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.categories import ensure_saved_category
from backend.database import connect, initialize
from test_categories import categories, category, dashboard, home, item, transaction


def saved(client, headers, month='2026-10', scope='household'):
    rows = categories(client, headers, month, scope)
    assert rows[0]['source'] == 'saved'
    assert sum(row['source'] == 'saved' for row in rows) == 1
    assert rows[0]['name'] == 'Saved' and rows[0]['managed'] is True and rows[0]['active'] is True
    return rows[0]


def test_saved_exists_for_new_users_without_monthly_placeholders_and_stays_first(home):
    app, client, owner, member, _ = home
    # Setup/member creation provisions both identities before any budget read.
    with connect(app.state.db_path) as db:
        identities = [tuple(row) for row in db.execute('''SELECT household_id,owner_id,scope
                                                         FROM budget_categories WHERE managed_source='saved'
                                                         ORDER BY id''')]
        assert identities == [(1, 0, 'household'), (1, 1, 'personal'), (1, 2, 'personal')]
        for table in ('budget_items', 'budget_item_lineages', 'bills', 'budget_months'):
            assert db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0
    household = saved(client, owner)
    assert household['items'] == []
    assert household['planned_cents'] == household['spent_cents'] == household['historical_item_spent_cents'] == 0
    assert saved(client, member)['id'] == household['id']
    first = category(client, owner, 'Zulu')['id']
    second = category(client, owner, 'Alpha')['id']
    for month in ('2026-10', '2026-11', '2027-01'):
        rows = categories(client, owner, month)
        assert [row['id'] for row in rows] == [household['id'], first, second]
        assert rows[0]['items'] == []
    initialize(app.state.db_path)
    restarted = create_app(app.state.db_path.parent, today=lambda zone: date(2026, 10, 7))
    with TestClient(restarted) as next_client:
        assert saved(next_client, owner)['id'] == household['id']
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT COUNT(*) FROM budget_items').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM budget_months').fetchone()[0] == 0


def test_saved_name_and_active_state_are_protected_and_duplicates_rejected(home):
    _, client, owner, _, _ = home
    cid = saved(client, owner)['id']
    for method in ('patch', 'put'):
        for changes in ({'name': 'Emergency fund'}, {'name': 'SAVED'}, {'active': False},
                        {'active': False, 'color': '#123456'}):
            response = getattr(client, method)(f'/api/budget/categories/{cid}', headers=owner, json=changes)
            assert response.status_code == 409, response.text
    assert saved(client, owner)['color'] == '#4f766b'
    for name in ('Saved', ' saved ', 'SAVED'):
        assert client.post('/api/budget/categories', headers=owner, json={'name': name}).status_code == 409
    other = category(client, owner, 'Other')['id']
    assert client.patch(f'/api/budget/categories/{other}', headers=owner, json={'name': 'Saved'}).status_code == 409
    assert client.delete(f'/api/budget/categories/{cid}', headers=owner).status_code == 405
    # A color preference does not rename/archive the built-in category.
    response = client.patch(f'/api/budget/categories/{cid}', headers=owner,
                            json={'name': 'Saved', 'active': True, 'color': '#123456'})
    assert response.status_code == 200 and response.json()['id'] == cid
    assert saved(client, owner)['color'] == '#123456'


def test_saved_items_are_ordinary_and_copy_totals_lineage_rules_without_duplicates(home):
    _, client, owner, _, _ = home
    cid = saved(client, owner)['id']
    entry = item(client, owner, cid, name='Travel fund', amount=5000)
    assert entry['managed'] is False and entry['source'] == 'manual'
    legacy = client.post('/api/budget/items', headers=owner, params={'month': '2026-10'},
                         json={'name': 'Reserve', 'group_name': ' sAvEd ', 'planned_cents': 1000})
    assert legacy.status_code == 201 and legacy.json()['budget_category_id'] == cid
    assert client.patch(f"/api/budget/items/{entry['id']}", headers=owner,
                        json={'name': 'Holiday fund', 'planned_cents': 6000}).status_code == 200
    rule = client.post('/api/categorization/rules', headers=owner, params={'month': '2026-10'}, json={
        'name': 'Fund transfers', 'merchant_text': 'Fund transfer', 'budget_item_id': entry['id'],
    })
    assert rule.status_code == 201, rule.text
    automatic = client.post('/api/transactions', headers=owner, json={
        'description': 'Fund transfer', 'amount_cents': -300, 'date': '2026-10-07',
    })
    assert automatic.status_code == 201 and automatic.json()['category_id'] == entry['id']
    assert automatic.json()['category_source'] == 'automatic'
    transaction(client, owner, entry['id'], amount=-700)
    result = dashboard(client, owner)
    assert result['planned_cents'] == 7000 and result['spent_cents'] == 1000
    assert result['groups'][0]['id'] == cid and result['groups'][0]['spent_cents'] == 1000
    response = client.post('/api/budget/copy', headers=owner,
                           json={'from_month': '2026-10', 'to_month': '2026-11'})
    assert response.status_code == 201, response.text
    copied = saved(client, owner, '2026-11')
    assert copied['id'] == cid and copied['planned_cents'] == 7000 and copied['spent_cents'] == 0
    assert all(row['managed'] is False for row in copied['items'])
    next_entry = next(row for row in copied['items'] if row['name'] == 'Holiday fund')
    assert next_entry['id'] != entry['id'] and next_entry['lineage_id'] == entry['lineage_id']
    for month in ('2026-10', '2026-11'):
        for row in saved(client, owner, month)['items']:
            assert client.delete(f"/api/budget/items/{row['id']}", headers=owner).status_code == 204
        assert saved(client, owner, month)['items'] == []
    assert saved(client, owner)['id'] == cid


def test_saved_scopes_keep_personal_items_private_and_reject_foreign_membership(home):
    _, client, owner, member, outsider = home
    household = saved(client, owner)['id']
    personal = saved(client, owner, scope='personal')['id']
    other_personal = saved(client, member, scope='personal')['id']
    foreign = saved(client, outsider)['id']
    assert len({household, personal, other_personal, foreign}) == 4
    assert saved(client, member)['id'] == household
    entry = item(client, owner, personal, name='Private instrument', scope='personal', amount=8765)
    transaction(client, owner, entry['id'], amount=-1234, scope='personal')
    assert client.patch('/api/settings', headers=owner, json={'share_personal_totals': True}).status_code == 200
    shared = dashboard(client, member)
    assert shared['shared_personal']['planned_cents'] == 8765 and shared['shared_personal']['spent_cents'] == 1234
    assert shared['groups'][0]['id'] == household and shared['groups'][0]['items'] == []
    assert shared['groups'][0]['planned_cents'] == shared['groups'][0]['spent_cents'] == 0
    assert 'Private instrument' not in str(shared)
    for actor, scope, cid in ((member, 'personal', personal), (owner, 'household', personal),
                              (outsider, 'household', household), (owner, 'household', foreign)):
        assert client.patch(f'/api/budget/categories/{cid}', headers=actor,
                            params={'scope': scope}, json={'color': '#123456'}).status_code == 404
        response = client.post('/api/budget/items', headers=actor, params={'scope': scope},
                               json={'name': 'Wrong scope', 'budget_category_id': cid, 'group_name': 'Saved'})
        assert response.status_code == 404
    token = client.post('/api/integrations/ha-token', headers=owner).json()['token']
    assert client.get('/api/budget/categories', headers={'Authorization': 'Bearer ' + token}).status_code == 401


def test_legacy_saved_adoption_precedes_null_membership_backfill_and_preserves_history(tmp_path):
    path = tmp_path / 'legacy.sqlite3'
    initialize(path)
    with connect(path) as db:
        db.execute("INSERT INTO households(id,name,timezone) VALUES (1,'Legacy home','America/New_York')")
        db.execute("INSERT INTO users(id,username,display_name,household_id) VALUES (1,'legacy','Legacy',1)")
        db.executemany('''INSERT INTO budget_categories
                          (id,household_id,owner_id,scope,name,name_key,color,active)
                          VALUES (?,?,?,?,?,?,?,?)''', [
            (3, 1, 0, 'household', 'Housing', 'housing', '#abcdef', 1),
            (9, 1, 0, 'household', ' sAvEd ', 'legacy-saved-key', '#123456', 0),
            (10, 1, 1, 'personal', 'SAVED', 'saved', '#654321', 0),
        ])
        db.execute("INSERT INTO budget_item_lineages(id,household_id,owner_id,scope) VALUES (40,1,0,'household')")
        db.executemany('''INSERT INTO budget_items
                          (id,household_id,owner_id,scope,month,name,group_name,color,planned_cents,budget_category_id,lineage_id)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?)''', [
            (77, 1, 0, 'household', '2026-10', 'Existing reserve', ' sAvEd ', '#112233', 5000, 9, 40),
            (78, 1, 0, 'household', '2026-11', 'Late reserve', 'Saved', '#445566', 6000, None, None),
        ])
        db.execute('''INSERT INTO transactions
                      (id,household_id,owner_id,scope,description,amount_cents,date,category_id,pending,external_id,amount_override_cents,category_source)
                      VALUES (91,1,0,'household','Legacy bank entry',-1234,'2026-10-07',77,1,'bank:91',-1234,'manual')''')
        db.execute('''INSERT INTO bills
                      (id,household_id,owner_id,scope,name,amount_cents,due_date,paid,recurrence,recurrence_key,
                       recurrence_day,budget_item_lineage_id,item_month)
                      VALUES (34,1,0,'household','Paid reserve',5000,'2026-10-31',1,'monthly','legacy-reminder',31,40,'2026-10')''')
        original_items = [tuple(row) for row in db.execute('''SELECT id,household_id,owner_id,scope,month,name,group_name,color,planned_cents
                                                              FROM budget_items ORDER BY id''')]
        original_transaction = dict(db.execute('SELECT * FROM transactions WHERE id=91').fetchone())
        original_bill = dict(db.execute('SELECT * FROM bills WHERE id=34').fetchone())
    initialize(path)
    with connect(path) as db:
        adopted = db.execute('SELECT * FROM budget_categories WHERE id=9').fetchone()
        assert (adopted['name'], adopted['name_key'], adopted['active'], adopted['managed_source'], adopted['color']) == (
            'Saved', 'saved', 1, 'saved', '#123456')
        personal = db.execute('SELECT * FROM budget_categories WHERE id=10').fetchone()
        assert personal['managed_source'] == 'saved' and personal['active'] == 1 and personal['color'] == '#654321'
        assert [tuple(row) for row in db.execute('''SELECT id,household_id,owner_id,scope,month,name,group_name,color,planned_cents
                                                   FROM budget_items ORDER BY id''')] == original_items
        assert [tuple(row) for row in db.execute('SELECT id,budget_category_id FROM budget_items ORDER BY id')] == [(77, 9), (78, 9)]
        assert dict(db.execute('SELECT * FROM transactions WHERE id=91').fetchone()) == original_transaction
        assert dict(db.execute('SELECT * FROM bills WHERE id=34').fetchone()) == original_bill
        assert db.execute("SELECT COUNT(*) FROM budget_categories WHERE household_id=1 AND owner_id=0 AND scope='household' AND name_key='saved'").fetchone()[0] == 1
        before = [dict(row) for row in db.execute('SELECT * FROM budget_categories ORDER BY id')]
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
    initialize(path)
    with connect(path) as db:
        assert [dict(row) for row in db.execute('SELECT * FROM budget_categories ORDER BY id')] == before
        assert db.execute('SELECT lineage_id FROM budget_items WHERE id=77').fetchone()[0] == 40


def test_ingress_provisioning_creates_saved_in_shared_and_individual_identity(tmp_path, monkeypatch):
    monkeypatch.setenv('BUDGET_AUTH_MODE', 'ingress')
    monkeypatch.setenv('BUDGET_LOCAL_AUTH', 'false')
    monkeypatch.setenv('BUDGET_DEMO', '0')
    monkeypatch.setenv('BUDGET_INGRESS_PROXY', '172.30.32.2')
    app = create_app(tmp_path)
    with TestClient(app, client=('172.30.32.2', 50000)) as client:
        for remote_id in ('first-person', 'second-person'):
            response = client.get('/api/me', headers={'X-Remote-User-Id': remote_id})
            assert response.status_code == 200
        with connect(app.state.db_path) as db:
            rows = [tuple(row) for row in db.execute('''SELECT household_id,owner_id,scope FROM budget_categories
                                                       WHERE managed_source='saved' ORDER BY id''')]
            assert rows == [(1, 0, 'household'), (1, 1, 'personal'), (1, 2, 'personal')]
            assert db.execute('SELECT COUNT(*) FROM budget_items').fetchone()[0] == 0


def test_concurrent_saved_ensure_keeps_one_category_identity(tmp_path):
    path = tmp_path / 'concurrent.sqlite3'
    initialize(path)
    with connect(path) as db:
        db.execute("INSERT INTO households(id,name,timezone) VALUES (1,'Concurrent home','America/New_York')")

    def ensure(_):
        with connect(path) as db:
            return ensure_saved_category(db, (1, 0, 'household'))['id']

    with ThreadPoolExecutor(max_workers=8) as pool:
        ids = list(pool.map(ensure, range(16)))
    assert len(set(ids)) == 1
    with connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM budget_categories').fetchone()[0] == 1
        assert db.execute('SELECT COUNT(*) FROM budget_items').fetchone()[0] == 0
