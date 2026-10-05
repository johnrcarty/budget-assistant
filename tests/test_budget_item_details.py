"""Monthly item identity, reminders, payment facts, and ledger privacy."""
import sqlite3
from datetime import date

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app, password_hash
from backend.database import connect, initialize


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv('BUDGET_AUTH_MODE', 'local')
    monkeypatch.setenv('BUDGET_LOCAL_AUTH', 'true')
    monkeypatch.setenv('BUDGET_DEMO', '0')
    app = create_app(tmp_path, today=lambda zone: date(2026, 1, 15))
    with TestClient(app) as client:
        response = client.post('/api/auth/setup', json={
            'username': 'owner', 'display_name': 'Owner',
            'password': 'long-owner-password', 'household_name': 'First home',
        })
        assert response.status_code == 201
        owner = {'Authorization': 'Bearer ' + response.json()['token']}
        assert client.post('/api/members', headers=owner, json={
            'username': 'member', 'display_name': 'Member',
            'password': 'long-member-password',
        }).status_code == 201
        response = client.post('/api/auth/login', json={
            'username': 'member', 'password': 'long-member-password',
        })
        member = {'Authorization': 'Bearer ' + response.json()['token']}
        with connect(app.state.db_path) as db:
            hid = db.execute("INSERT INTO households(name,timezone) VALUES ('Other home','America/New_York')").lastrowid
            db.execute('INSERT INTO users(username,display_name,password_hash,household_id,is_admin) VALUES (?,?,?,?,1)',
                       ('outsider', 'Outsider', password_hash('long-outside-password'), hid))
        response = client.post('/api/auth/login', json={
            'username': 'outsider', 'password': 'long-outside-password',
        })
        outsider = {'Authorization': 'Bearer ' + response.json()['token']}
        yield app, client, owner, member, outsider


def budget_item(client, headers, month='2026-01', scope='household', name='Utility', amount=10000):
    categories = client.get('/api/budget/categories', headers=headers, params={'scope': scope, 'month': month})
    assert categories.status_code == 200
    if categories.json():
        cid = categories.json()[0]['id']
    else:
        response = client.post('/api/budget/categories', headers=headers,
                               params={'scope': scope}, json={'name': 'Home services'})
        assert response.status_code == 201
        cid = response.json()['id']
    response = client.post('/api/budget/items', headers=headers,
                           params={'scope': scope, 'month': month},
                           json={'name': name, 'budget_category_id': cid, 'planned_cents': amount})
    assert response.status_code == 201, response.text
    return response.json()['id']


def details(client, headers, item_id, scope='household'):
    response = client.get(f'/api/budget/items/{item_id}/details', headers=headers, params={'scope': scope})
    assert response.status_code == 200, response.text
    return response.json()


def set_due(client, headers, item_id, day, scope='household', **extra):
    response = client.put(f'/api/budget/items/{item_id}/due', headers=headers,
                          params={'scope': scope}, json={'due_day': day, **extra})
    assert response.status_code == 200, response.text
    return response.json()


def mark_paid(client, headers, item_id, paid=True, scope='household'):
    response = client.patch(f'/api/budget/items/{item_id}/payment', headers=headers,
                            params={'scope': scope}, json={'paid': paid})
    assert response.status_code == 200, response.text
    return response.json()


def copy_item(client, headers, previous, target, scope='household'):
    response = client.post('/api/budget/copy', headers=headers,
                           json={'scope': scope, 'from_month': previous, 'to_month': target})
    assert response.status_code == 201, response.text
    rows = client.get('/api/budget/items', headers=headers, params={'scope': scope, 'month': target})
    assert rows.status_code == 200
    assert len(rows.json()) == 1
    return rows.json()[0]['id']


def transaction(client, headers, when='2026-01-20', amount=-2500, item_id=None, scope='household', pending=False):
    response = client.post('/api/transactions', headers=headers, params={'scope': scope}, json={
        'description': 'Local fixture payment', 'amount_cents': amount, 'date': when,
        'category_id': item_id, 'pending': pending,
    })
    assert response.status_code == 201, response.text
    return response.json()['id']


def link(client, headers, item_id, transaction_id, scope='household', replace=False):
    return client.post(f'/api/budget/items/{item_id}/transactions/{transaction_id}/link',
                       headers=headers, params={'scope': scope}, json={'replace_existing': replace})


def bills(client, headers, scope='household'):
    response = client.get('/api/bills', headers=headers, params={'scope': scope})
    assert response.status_code == 200
    return response.json()


def test_copies_share_identity_without_copying_payment_or_creating_spending(home):
    _, client, owner, _, _ = home
    first = budget_item(client, owner)
    before = details(client, owner, first)
    assert before['due']['paid'] is False and before['due']['bill_id'] is None
    paid = mark_paid(client, owner, first)
    assert paid['due']['paid'] is True and paid['due']['bill_id'] is None
    assert bills(client, owner) == []
    next_item = copy_item(client, owner, '2026-01', '2026-02')
    copied = details(client, owner, next_item)
    assert copied['item']['lineage_id'] == before['item']['lineage_id']
    assert copied['due']['paid'] is False and copied['due']['bill_id'] is None
    assert details(client, owner, first)['due']['paid'] is True
    assert copied['item']['spent_cents'] == 0
    assert client.get('/api/transactions?month=2026-01', headers=owner).json() == []
    initialize(client.app.state.db_path)
    assert details(client, owner, first)['due']['paid'] is True
    assert details(client, owner, next_item)['due']['paid'] is False


@pytest.mark.parametrize('months,day,expected', [
    (('2026-01', '2026-02', '2026-03'), 31, ['2026-01-31', '2026-02-28', '2026-03-31']),
    (('2028-01', '2028-02', '2028-03'), 31, ['2028-01-31', '2028-02-29', '2028-03-31']),
    (('2026-02', '2026-03', '2026-04'), 'last', ['2026-02-28', '2026-03-31', '2026-04-30']),
])
def test_recurring_calendar_anchor_clamps_without_drift_or_month_duplicates(home, months, day, expected):
    app, client, owner, _, _ = home
    app.state.today = lambda zone: date.fromisoformat(months[0] + '-15')
    ids = [budget_item(client, owner, month=months[0])]
    set_due(client, owner, ids[0], day)
    for previous, target in zip(months, months[1:]):
        ids.append(copy_item(client, owner, previous, target))
    for item_id, due in zip(ids, expected):
        value = details(client, owner, item_id)
        assert value['due']['due_day'] == day and value['due']['due_date'] == due
    app.state.today = lambda zone: date.fromisoformat(months[-1] + '-20')
    first = bills(client, owner)
    assert bills(client, owner) == first
    for due in expected:
        assert sum(row['due_date'] == due for row in first) == 1
    assert len({details(client, owner, item_id)['due']['bill_id'] for item_id in ids}) == 3


def listed_items(client, headers, month, scope='household'):
    """Exercise the three public representations of a selected month's plan."""
    result = []
    for path in ('budget/items', 'budget/categories', 'dashboard'):
        response = client.get('/api/' + path, headers=headers, params={'scope': scope, 'month': month})
        assert response.status_code == 200, response.text
        payload = response.json()
        if path == 'budget/items':
            rows = payload
        else:
            groups = payload['groups'] if path == 'dashboard' else payload
            rows = [item for group in groups for item in group['items']]
        result.append({row['id']: row for row in rows})
    return result


@pytest.mark.parametrize('year,expected', [(2026, '2026-02-28'), (2028, '2028-02-29')])
def test_item_lists_use_selected_month_actual_due_date_and_keep_paid_clamp(home, year, expected):
    app, client, owner, _, _ = home
    january_month, february_month = f'{year}-01', f'{year}-02'
    app.state.today = lambda zone: date(year, 1, 15)
    january = budget_item(client, owner, month=january_month)
    set_due(client, owner, january, 31)
    february = copy_item(client, owner, january_month, february_month)
    undated = budget_item(client, owner, month=february_month, name='No reminder')
    for rows in listed_items(client, owner, february_month):
        assert rows[february]['due_date'] == expected
        assert rows[undated]['due_date'] is None
    for rows in listed_items(client, owner, january_month):
        assert rows[january]['due_date'] == f'{year}-01-31'
    mark_paid(client, owner, february)
    app.state.today = lambda zone: date(year, 2, 15)
    assert set_due(client, owner, february, 10)['due']['due_day'] == 10
    with connect(app.state.db_path) as db:
        before = [tuple(row) for row in db.execute('SELECT id,due_date,paid,amount_cents FROM bills ORDER BY id')]
    for _ in range(2):
        for rows in listed_items(client, owner, february_month):
            # The existing paid fact wins over the edited recurrence rule.
            assert rows[february]['due_date'] == expected
            assert rows[undated]['due_date'] is None
    lineage_id = details(client, owner, february)['item']['lineage_id']
    with connect(app.state.db_path) as db:
        assert [tuple(row) for row in db.execute('SELECT id,due_date,paid,amount_cents FROM bills ORDER BY id')] == before
        assert db.execute('SELECT COUNT(*) FROM bills WHERE budget_item_lineage_id=? AND item_month=?',
                          (lineage_id, february_month)).fetchone()[0] == 1


def test_item_lists_keep_all_managed_payment_dates_and_show_earliest_actual_date(home):
    app, client, owner, _, _ = home
    app.state.today = lambda zone: date(2026, 10, 4)
    response = client.post('/api/accounts', headers=owner, json={
        'name': 'Fixture loan', 'kind': 'loan', 'balance_cents': 90000,
    })
    assert response.status_code == 201
    aid = response.json()['id']
    assert client.put(f'/api/accounts/{aid}/payment-schedule', headers=owner, json={
        'amount_cents': 5000, 'cadence': 'biweekly', 'anchor_date': '2026-10-02',
        'active': True, 'effective_from': '2026-10-01',
    }).status_code == 200
    first = next(row for row in bills(client, owner) if row['debt_account_id'] == aid)
    assert client.patch(f"/api/bills/{first['id']}", headers=owner, json={'paid': True}).status_code == 200
    for rows in listed_items(client, owner, '2026-10'):
        managed = [row for row in rows.values() if row.get('managed_account_id') == aid]
        assert len(managed) == 1
        assert managed[0]['due_date'] == '2026-10-02'
        assert managed[0]['payment_dates'] == ['2026-10-02', '2026-10-16', '2026-10-30']
        assert managed[0]['planned_cents'] == 15000


def test_item_list_due_dates_remain_private_even_when_personal_totals_are_shared(home):
    _, client, owner, member, outsider = home
    private = budget_item(client, owner, scope='personal', name='Private dated fixture')
    set_due(client, owner, private, 27, scope='personal')
    own = budget_item(client, member, scope='personal', name='Member dated fixture')
    set_due(client, member, own, 18, scope='personal')
    assert client.patch('/api/settings', headers=owner, json={'share_personal_totals': True}).status_code == 200
    for rows in listed_items(client, owner, '2026-01', scope='personal'):
        assert set(rows) == {private} and rows[private]['due_date'] == '2026-01-27'
    for rows in listed_items(client, member, '2026-01', scope='personal'):
        assert set(rows) == {own} and rows[own]['due_date'] == '2026-01-18'
    for actor in (owner, member, outsider):
        assert all(not rows for rows in listed_items(client, actor, '2026-01'))
    shared = client.get('/api/dashboard?month=2026-01', headers=member)
    assert shared.json()['shared_personal']['planned_cents'] == 10000
    assert 'Private dated fixture' not in shared.text and '2026-01-27' not in shared.text


def test_paid_bill_is_authoritative_and_paid_history_and_old_debt_survive_due_edits(home):
    app, client, owner, _, _ = home
    january = budget_item(client, owner)
    first = set_due(client, owner, january, 31)['due']['bill_id']
    february = copy_item(client, owner, '2026-01', '2026-02')
    second = details(client, owner, february)['due']['bill_id']
    assert client.patch(f'/api/bills/{second}', headers=owner, json={'paid': True}).status_code == 200
    assert details(client, owner, february)['due']['paid'] is True
    march = copy_item(client, owner, '2026-02', '2026-03')
    original_march = details(client, owner, march)['due']['bill_id']
    app.state.today = lambda zone: date(2026, 3, 20)
    edited = set_due(client, owner, march, 15)
    assert edited['due']['bill_id'] == original_march and edited['due']['due_date'] == '2026-03-15'
    rows = {row['id']: row for row in bills(client, owner)}
    assert rows[first]['due_date'] == '2026-01-31' and not rows[first]['paid']
    assert rows[second]['due_date'] == '2026-02-28' and rows[second]['paid']
    assert sum(row['due_date'].startswith('2026-03') for row in rows.values()) == 1
    set_due(client, owner, february, 10)
    assert details(client, owner, february)['due']['bill_id'] == second
    assert details(client, owner, february)['due']['due_date'] == '2026-02-28'
    assert details(client, owner, february)['due']['paid'] is True


def test_due_removal_keeps_paid_and_overdue_facts_but_cancels_future_reminders(home):
    app, client, owner, _, _ = home
    january = budget_item(client, owner)
    january_bill = set_due(client, owner, january, 31)['due']['bill_id']
    february = copy_item(client, owner, '2026-01', '2026-02')
    february_bill = mark_paid(client, owner, february)['due']['bill_id']
    march = copy_item(client, owner, '2026-02', '2026-03')
    details(client, owner, march)
    app.state.today = lambda zone: date(2026, 3, 20)
    cleared = set_due(client, owner, march, None)
    assert cleared['due']['due_day'] is None
    rows = {row['id']: row for row in bills(client, owner)}
    assert rows[january_bill]['due_date'] == '2026-01-31' and not rows[january_bill]['paid']
    assert rows[february_bill]['paid'] is True
    assert not any(row['due_date'] > '2026-03-20' and not row['paid'] for row in rows.values())
    app.state.today = lambda zone: date(2026, 5, 20)
    assert bills(client, owner) == list(rows.values())


def test_last_plan_deletion_stops_future_but_other_plans_keep_series_and_debts(home):
    app, client, owner, _, _ = home
    january = budget_item(client, owner)
    jan_bill = set_due(client, owner, january, 31)['due']['bill_id']
    february = copy_item(client, owner, '2026-01', '2026-02')
    feb_bill = mark_paid(client, owner, february)['due']['bill_id']
    march = copy_item(client, owner, '2026-02', '2026-03')
    app.state.today = lambda zone: date(2026, 3, 20)
    assert client.delete(f'/api/budget/items/{january}', headers=owner).status_code == 204
    assert client.delete(f'/api/budget/items/{february}', headers=owner).status_code == 204
    assert details(client, owner, march)['due']['due_date'] == '2026-03-31'
    assert client.delete(f'/api/budget/items/{march}', headers=owner).status_code == 204
    rows = {row['id']: row for row in bills(client, owner)}
    assert jan_bill in rows and not rows[jan_bill]['paid']
    assert feb_bill in rows and rows[feb_bill]['paid']
    assert not any(row['due_date'] > '2026-03-20' and not row['paid'] for row in rows.values())
    assert client.patch(f'/api/bills/{jan_bill}', headers=owner, json={'paid': True}).status_code == 200
    app.state.today = lambda zone: date(2026, 6, 20)
    assert len(bills(client, owner)) == len(rows)


def test_explicit_bill_adoption_keeps_real_paid_facts_and_ha_counts_once(home):
    app, client, owner, _, _ = home
    item_id = budget_item(client, owner)
    response = client.post('/api/bills', headers=owner, json={
        'name': 'Existing utility', 'amount_cents': 4321, 'due_date': '2026-01-31',
        'recurrence': 'monthly', 'paid': True,
    })
    assert response.status_code == 201
    january_bill = response.json()['id']
    february_bill = next(row['id'] for row in bills(client, owner) if row['due_date'] == '2026-02-28')
    assert client.patch(f'/api/bills/{february_bill}', headers=owner, json={'paid': True}).status_code == 200
    unscheduled = set_due(client, owner, item_id, None)
    assert unscheduled['due']['can_adopt_existing_bill'] is True
    adopted = set_due(client, owner, item_id, 31, existing_bill_id=january_bill)
    assert adopted['due']['bill_id'] == january_bill and adopted['due']['paid'] is True
    assert adopted['due']['can_adopt_existing_bill'] is False
    copied = copy_item(client, owner, '2026-01', '2026-02')
    assert details(client, owner, copied)['due']['bill_id'] == february_bill
    assert details(client, owner, copied)['due']['paid'] is True
    assert details(client, owner, copied)['due']['amount_cents'] == 4321
    app.state.today = lambda zone: date(2026, 3, 31)
    token = client.post('/api/integrations/ha-token', headers=owner).json()['token']
    machine = {'Authorization': 'Bearer ' + token}
    result = client.get('/api/ha/bills', headers=machine)
    assert result.status_code == 200
    assert result.json()['today']['count'] == 1
    assert client.get('/api/ha/bills', headers=machine).json() == result.json()
    assert sum(row['due_date'] == '2026-03-31' for row in bills(client, owner)) == 1
    assert client.patch(f'/api/bills/{january_bill}', headers=owner, json={'due_date': '2026-01-15'}).status_code == 409
    assert client.delete(f'/api/bills/{january_bill}', headers=owner).status_code == 409


def test_adoption_never_matches_names_or_accepts_foreign_or_already_attached_bill(home):
    _, client, owner, member, outsider = home
    item_id = budget_item(client, owner, name='Same name')
    own = client.post('/api/bills', headers=owner, json={
        'name': 'Same name', 'amount_cents': 900, 'due_date': '2026-01-31',
    }).json()['id']
    private = client.post('/api/bills?scope=personal', headers=member, json={
        'name': 'Private bill', 'amount_cents': 800, 'due_date': '2026-01-31',
    }).json()['id']
    foreign = client.post('/api/bills', headers=outsider, json={
        'name': 'Other home bill', 'amount_cents': 700, 'due_date': '2026-01-31',
    }).json()['id']
    available = details(client, owner, item_id)['available_bills']
    assert {row['id'] for row in available} == {own}
    for target in (private, foreign):
        response = client.put(f'/api/budget/items/{item_id}/due', headers=owner,
                              json={'due_day': 31, 'existing_bill_id': target})
        assert response.status_code == 404
    newly_created = set_due(client, owner, item_id, 31)['due']['bill_id']
    assert newly_created != own
    assert len([row for row in bills(client, owner) if row['name'] == 'Same name']) == 2
    assert client.put(f'/api/budget/items/{item_id}/due', headers=owner,
                      json={'due_day': 31, 'existing_bill_id': own}).status_code == 409
    another = budget_item(client, owner, name='Other item')
    assert client.put(f'/api/budget/items/{another}/due', headers=owner,
                      json={'due_day': 31, 'existing_bill_id': newly_created}).status_code == 409


def test_history_tracks_lineage_across_copies_renames_and_refunds_not_equal_names(home):
    _, client, owner, _, _ = home
    origin = budget_item(client, owner, month='2025-10', name='Original')
    transaction(client, owner, when='2025-10-31', item_id=origin, amount=-9999)
    november = copy_item(client, owner, '2025-10', '2025-11')
    transaction(client, owner, when='2025-11-01', item_id=november, amount=-300)
    transaction(client, owner, when='2025-11-30', item_id=november, amount=-200, pending=True)
    january = copy_item(client, owner, '2025-11', '2026-01')
    assert client.patch(f'/api/budget/items/{january}', headers=owner,
                        json={'name': 'Renamed', 'planned_cents': 12000}).status_code == 200
    transaction(client, owner, item_id=january, amount=-1000)
    transaction(client, owner, item_id=january, amount=1200)
    october = copy_item(client, owner, '2026-01', '2026-10')
    transaction(client, owner, when='2026-10-31', item_id=october, amount=-400)
    duplicate_name = budget_item(client, owner, month='2026-10', name='Renamed', amount=9000)
    transaction(client, owner, when='2026-10-07', item_id=duplicate_name, amount=-777)
    result = details(client, owner, october)
    assert result['item']['lineage_id'] == details(client, owner, origin)['item']['lineage_id']
    assert result['item']['lineage_id'] != details(client, owner, duplicate_name)['item']['lineage_id']
    assert [row['month'] for row in result['history']] == [
        '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
        '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
    ]
    history = {row['month']: row for row in result['history']}
    assert history['2025-11']['spent_cents'] == 500 and history['2025-11']['pending_cents'] == 200
    assert history['2026-01']['spent_cents'] == -200 and history['2026-01']['planned_cents'] == 12000
    assert history['2026-10']['spent_cents'] == 400
    assert history['2025-12']['spent_cents'] == 0 and not history['2025-12']['has_plan']
    assert sum(row['spent_cents'] for row in result['history']) == 700


def test_link_reassignment_is_explicit_and_unlink_preserves_imported_record(home):
    app, client, owner, _, _ = home
    first = budget_item(client, owner, name='First')
    second = budget_item(client, owner, name='Second')
    tx = transaction(client, owner, item_id=first, pending=True)
    with connect(app.state.db_path) as db:
        db.execute("UPDATE transactions SET external_id='fixture-bank-id',amount_override_cents=-2500 WHERE id=?", (tx,))
    assert link(client, owner, second, tx).status_code == 409
    assert details(client, owner, first)['linked_transactions'][0]['id'] == tx
    moved = link(client, owner, second, tx, replace=True)
    assert moved.status_code == 200
    assert moved.json()['due']['paid'] is False
    assert moved.json()['item']['spent_cents'] == moved.json()['item']['pending_cents'] == 2500
    assert details(client, owner, first)['linked_transactions'] == []
    stale = client.delete(f'/api/budget/items/{first}/transactions/{tx}/link', headers=owner)
    assert stale.status_code == 409
    cleared = client.delete(f'/api/budget/items/{second}/transactions/{tx}/link', headers=owner)
    assert cleared.status_code == 200 and cleared.json()['linked_transactions'] == []
    with connect(app.state.db_path) as db:
        row = db.execute('SELECT * FROM transactions WHERE id=?', (tx,)).fetchone()
        assert row['external_id'] == 'fixture-bank-id' and row['amount_override_cents'] == -2500
        assert row['category_id'] is None and row['pending'] == 1
        assert db.execute('SELECT COUNT(*) FROM transaction_exclusions').fetchone()[0] == 0


def test_link_and_create_validate_month_and_known_account_currency(home):
    app, client, owner, _, _ = home
    item_id = budget_item(client, owner)
    wrong_month = transaction(client, owner, when='2026-02-01')
    assert link(client, owner, item_id, wrong_month).status_code == 422
    account = client.post('/api/accounts', headers=owner, json={
        'name': 'Euro fixture', 'currency': 'EUR', 'balance_cents': 1000,
    }).json()['id']
    euro = transaction(client, owner)
    with connect(app.state.db_path) as db:
        db.execute('UPDATE transactions SET account_id=? WHERE id=?', (account, euro))
    assert link(client, owner, item_id, euro).status_code == 422
    for change in ({'date': '2026-02-01'}, {'account_id': account}):
        response = client.post(f'/api/budget/items/{item_id}/transactions', headers=owner, json={
            'description': 'Missing payment', 'amount_cents': -800, 'date': '2026-01-20', **change,
        })
        assert response.status_code == 422
    response = client.post(f'/api/budget/items/{item_id}/transactions', headers=owner, json={
        'description': 'Missing payment', 'amount_cents': -800, 'date': '2026-01-20', 'pending': True,
    })
    assert response.status_code == 201, response.text
    result = response.json()
    assert result['item']['spent_cents'] == result['item']['pending_cents'] == 800
    assert result['due']['paid'] is False and result['due']['bill_id'] is None
    created = next(row for row in result['linked_transactions'] if row['description'] == 'Missing payment')
    assert created['category_id'] == item_id and created['amount_cents'] == -800


def test_detail_and_every_mutation_hide_other_owners_households_and_machine_tokens(home):
    _, client, owner, member, outsider = home
    public = budget_item(client, owner)
    private = budget_item(client, owner, scope='personal', name='Private medical item')
    private_tx = transaction(client, owner, scope='personal', item_id=private)
    public_tx = transaction(client, owner)
    token = client.post('/api/integrations/ha-token', headers=owner).json()['token']
    machine = {'Authorization': 'Bearer ' + token}
    for actor, scope, target, code in (
        (member, 'personal', private, 404), (member, 'household', private, 404),
        (owner, 'household', private, 404), (outsider, 'household', public, 404),
        (machine, 'household', public, 401),
    ):
        base = f'/api/budget/items/{target}'
        assert client.get(base + '/details', headers=actor, params={'scope': scope}).status_code == code
        assert client.put(base + '/due', headers=actor, params={'scope': scope}, json={'due_day': 15}).status_code == code
        assert client.patch(base + '/payment', headers=actor, params={'scope': scope}, json={'paid': True}).status_code == code
        assert client.post(base + '/transactions', headers=actor, params={'scope': scope}, json={
            'description': 'Wrong', 'amount_cents': -100, 'date': '2026-01-20',
        }).status_code == code
        assert link(client, actor, target, public_tx, scope=scope, replace=True).status_code == code
        assert client.delete(base + f'/transactions/{public_tx}/link', headers=actor, params={'scope': scope}).status_code == code
    assert link(client, member, public, private_tx, replace=True).status_code == 404
    assert details(client, owner, public)['linked_transactions'] == []
    assert details(client, owner, private, scope='personal')['linked_transactions'][0]['id'] == private_tx


def test_private_due_occurrences_and_detail_history_never_enter_shared_exports(home):
    _, client, owner, member, _ = home
    private = budget_item(client, owner, scope='personal', name='Secret treatment')
    set_due(client, owner, private, 15, scope='personal')
    transaction(client, owner, scope='personal', item_id=private, amount=-4567)
    assert client.patch('/api/settings', headers=owner, json={'share_personal_totals': True}).status_code == 200
    response = client.get('/api/dashboard?month=2026-01', headers=member)
    assert response.status_code == 200 and response.json()['shared_personal']['spent_cents'] == 4567
    assert response.json()['groups'] == []
    assert all(value not in response.text for value in ('Secret treatment', 'lineage_id', 'linked_transactions'))
    token = client.post('/api/integrations/ha-token', headers=owner).json()['token']
    export = client.get('/api/ha/bills', headers={'Authorization': 'Bearer ' + token})
    assert export.status_code == 200
    assert all(export.json()[bucket]['count'] == 0 for bucket in ('past_due', 'today', 'this_week', 'next_week'))
    assert 'Secret treatment' not in export.text


def test_legacy_identical_names_backfill_independent_lineages_and_keep_transaction_ids(home):
    app, client, owner, _, _ = home
    first = budget_item(client, owner, month='2025-12', name='Same name')
    second = budget_item(client, owner, name='Same name')
    first_tx = transaction(client, owner, when='2025-12-20', item_id=first, amount=-111)
    second_tx = transaction(client, owner, item_id=second, amount=-222)
    # Simulate legacy rows entering through an old client/seed after initialize.
    with connect(app.state.db_path) as db:
        db.execute('UPDATE budget_items SET lineage_id=NULL WHERE id IN (?,?)', (first, second))
    initialize(app.state.db_path)
    initialize(app.state.db_path)
    old = details(client, owner, first)
    current = details(client, owner, second)
    assert old['item']['lineage_id'] != current['item']['lineage_id']
    assert sum(row['spent_cents'] for row in old['history']) == 111
    assert sum(row['spent_cents'] for row in current['history']) == 222
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT category_id FROM transactions WHERE id=?', (first_tx,)).fetchone()[0] == first
        assert db.execute('SELECT category_id FROM transactions WHERE id=?', (second_tx,)).fetchone()[0] == second
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def test_old_schema_migration_preserves_paid_bills_and_independent_item_history(tmp_path):
    path = tmp_path / 'legacy.sqlite3'
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
            CREATE TABLE bills (id INTEGER PRIMARY KEY,household_id INTEGER NOT NULL REFERENCES households(id),
                                owner_id INTEGER NOT NULL,scope TEXT NOT NULL,name TEXT NOT NULL,
                                amount_cents INTEGER NOT NULL,due_date TEXT NOT NULL,paid INTEGER NOT NULL DEFAULT 0,
                                autopay INTEGER NOT NULL DEFAULT 0,recurrence TEXT NOT NULL DEFAULT 'none',
                                recurrence_key TEXT,recurrence_day INTEGER,
                                UNIQUE(household_id,owner_id,scope,recurrence_key,due_date));
            CREATE TABLE transactions (id INTEGER PRIMARY KEY,household_id INTEGER NOT NULL REFERENCES households(id),
                                       owner_id INTEGER NOT NULL,scope TEXT NOT NULL,description TEXT NOT NULL,
                                       amount_cents INTEGER NOT NULL,date TEXT NOT NULL,account_id INTEGER,
                                       account_name TEXT NOT NULL DEFAULT 'Manual entry',
                                       category_id INTEGER REFERENCES budget_items(id) ON DELETE SET NULL,
                                       pending INTEGER NOT NULL DEFAULT 0,external_id TEXT);
            INSERT INTO households(id,name,timezone) VALUES (1,'Fixture home','America/New_York');
            INSERT INTO users(id,username,display_name,household_id) VALUES (1,'fixture','Fixture',1);
            INSERT INTO budget_items VALUES (41,1,0,'household','2025-12','Utility','Home','#123456',10000);
            INSERT INTO budget_items VALUES (42,1,0,'household','2026-01','Utility','Home','#123456',12000);
            INSERT INTO transactions(id,household_id,owner_id,scope,description,amount_cents,date,category_id)
                VALUES (91,1,0,'household','Old payment',-3456,'2025-12-31',41);
            INSERT INTO bills VALUES (71,1,0,'household','Utility',3456,'2025-12-31',1,1,'monthly','legacy-key',31);
            INSERT INTO bills VALUES (72,1,0,'household','Utility',3456,'2026-01-31',0,1,'monthly','legacy-key',31);
        ''')
        original_bills = db.execute('SELECT * FROM bills ORDER BY id').fetchall()
    initialize(path)
    with connect(path) as db:
        columns = 'id,household_id,owner_id,scope,name,amount_cents,due_date,paid,autopay,recurrence,recurrence_key,recurrence_day'
        assert [tuple(row) for row in db.execute(f'SELECT {columns} FROM bills ORDER BY id')] == original_bills
        lineages = {row['id']: row['lineage_id'] for row in db.execute('SELECT id,lineage_id FROM budget_items')}
        assert lineages[41] is not None and lineages[42] is not None and lineages[41] != lineages[42]
        assert db.execute('SELECT category_id FROM transactions WHERE id=91').fetchone()[0] == 41
        assert all(row['budget_item_lineage_id'] is None and row['item_month'] is None
                   for row in db.execute('SELECT * FROM bills'))
        assert db.execute('SELECT COUNT(*) FROM budget_item_due_versions').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM budget_item_payment_facts').fetchone()[0] == 0
    initialize(path)
    with connect(path) as db:
        assert {row['id']: row['lineage_id'] for row in db.execute('SELECT id,lineage_id FROM budget_items')} == lineages
        assert [tuple(row) for row in db.execute(f'SELECT {columns} FROM bills ORDER BY id')] == original_bills
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
