"""Observed account values and managed debt plans preserve money and privacy."""
import sqlite3
from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app, password_hash
from backend.database import connect, initialize
from backend import accounts as account_plans, simplefin


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv('BUDGET_AUTH_MODE', 'local')
    monkeypatch.setenv('BUDGET_LOCAL_AUTH', 'true')
    monkeypatch.setenv('BUDGET_DEMO', '0')
    app = create_app(tmp_path, today=lambda zone: date(2026, 10, 4))
    with TestClient(app) as client:
        response = client.post('/api/auth/setup', json={
            'username': 'owner', 'display_name': 'Owner', 'password': 'long-owner-password',
            'household_name': 'Fixture home', 'timezone': 'America/New_York',
        })
        assert response.status_code == 201
        owner = {'Authorization': 'Bearer ' + response.json()['token']}
        assert client.post('/api/members', headers=owner, json={
            'username': 'member', 'display_name': 'Member', 'password': 'long-member-password',
        }).status_code == 201
        response = client.post('/api/auth/login', json={'username': 'member', 'password': 'long-member-password'})
        member = {'Authorization': 'Bearer ' + response.json()['token']}
        with connect(app.state.db_path) as db:
            hid = db.execute("INSERT INTO households(name,timezone) VALUES ('Other fixture','America/New_York')").lastrowid
            db.execute('INSERT INTO users(username,display_name,password_hash,household_id,is_admin) VALUES (?,?,?,?,1)',
                       ('outsider', 'Outsider', password_hash('long-outside-password'), hid))
        response = client.post('/api/auth/login', json={'username': 'outsider', 'password': 'long-outside-password'})
        outsider = {'Authorization': 'Bearer ' + response.json()['token']}
        yield app, client, owner, member, outsider


def account(client, headers, *, scope='household', **changes):
    response = client.post('/api/accounts', headers=headers, params={'scope': scope}, json={
        'name': 'Fixture loan', 'kind': 'loan', 'balance_cents': 90000, 'currency': 'USD', **changes,
    })
    assert response.status_code == 201, response.text
    return response.json()['id']


def schedule(client, headers, account_id, *, scope='household', **changes):
    response = client.put(f'/api/accounts/{account_id}/payment-schedule', headers=headers,
                          params={'scope': scope}, json={
                              'amount_cents': 5000, 'cadence': 'biweekly', 'anchor_date': '2026-10-02',
                              'day1': 1, 'day2': 'last', 'active': True,
                              'effective_from': '2026-10-01', **changes,
                          })
    assert response.status_code == 200, response.text
    return response.json()


def items(client, headers, month='2026-10', scope='household'):
    response = client.get('/api/budget/items', headers=headers, params={'scope': scope, 'month': month})
    assert response.status_code == 200, response.text
    return response.json()


def managed_item(client, headers, account_id, month='2026-10', scope='household'):
    matches = [row for row in items(client, headers, month, scope) if row.get('managed_account_id') == account_id]
    assert len(matches) == 1
    assert matches[0]['managed'] is True and matches[0]['source'] == 'debt_payment'
    return matches[0]


def detail(client, headers, item_id, scope='household'):
    response = client.get(f'/api/budget/items/{item_id}/details', headers=headers, params={'scope': scope})
    assert response.status_code == 200, response.text
    return response.json()


def dashboard(client, headers, month='2026-10', scope='household'):
    response = client.get('/api/dashboard', headers=headers, params={'scope': scope, 'month': month})
    assert response.status_code == 200, response.text
    return response.json()


def bill_rows(client, headers, scope='household'):
    response = client.get('/api/bills', headers=headers, params={'scope': scope})
    assert response.status_code == 200, response.text
    return response.json()


def history(client, headers, account_id, scope='household'):
    response = client.get(f'/api/accounts/{account_id}/history', headers=headers, params={'scope': scope})
    assert response.status_code == 200, response.text
    return response.json()


def net_worth(client, headers, scope='household'):
    response = client.get('/api/accounts/net-worth/history', headers=headers, params={'scope': scope})
    assert response.status_code == 200, response.text
    return {row['currency']: row['points'] for row in response.json()['series']}


def feed(*, balance='123.45', as_of='2026-10-02T12:00:00+00:00', currency='USD', transaction_id='fixture-transaction'):
    return {'errlist': [], 'accounts': [{
        'conn_id': 'fixture-connection', 'id': 'fixture-account', 'name': 'Fixture imported account',
        'currency': currency, 'balance': balance,
        'balance-date': int(datetime.fromisoformat(as_of).timestamp()),
        'transactions': [{'id': transaction_id, 'description': 'Fixture imported payment', 'amount': '-20.00',
                          'posted': int(datetime(2026, 10, 2, 15, tzinfo=timezone.utc).timestamp())}],
    }]}


def test_biweekly_three_payment_month_reconciles_budget_and_ha_once(home):
    app, client, owner, _, _ = home
    aid = account(client, owner)
    schedule(client, owner, aid)
    planned = managed_item(client, owner, aid)
    assert planned['payment_dates'] == ['2026-10-02', '2026-10-16', '2026-10-30']
    assert planned['planned_cents'] == 15000  # payment amounts, never the account balance
    assert client.post('/api/budget/items?month=2026-10', headers=owner, json={
        'name': 'Other household plan', 'group_name': 'Home', 'planned_cents': 1000,
    }).status_code == 201
    result = dashboard(client, owner)
    assert result['planned_cents'] == 16000
    assert sum(group['planned_cents'] for group in result['groups']) == 16000
    occurrence_rows = detail(client, owner, planned['id'])['payment_occurrences']
    assert [row['due_date'] for row in occurrence_rows] == planned['payment_dates']
    assert sum(row['amount_cents'] for row in occurrence_rows) == planned['planned_cents']
    original = bill_rows(client, owner)
    assert bill_rows(client, owner) == original
    assert len(original) == 3 and len({row['id'] for row in original}) == 3
    app.state.today = lambda zone: date(2026, 10, 7)
    token = client.post('/api/integrations/ha-token', headers=owner).json()['token']
    response = client.get('/api/ha/bills', headers={'Authorization': 'Bearer ' + token})
    assert response.status_code == 200
    assert response.json()['past_due']['count'] == 1
    assert response.json()['next_week']['count'] == 1
    assert sum(response.json()[key]['count'] for key in ('past_due', 'today', 'this_week', 'next_week')) == 2


def test_current_month_phase_edit_cannot_duplicate_retained_overdue_debt(home):
    _, client, owner, _, _ = home
    aid = account(client, owner)
    schedule(client, owner, aid)
    before = bill_rows(client, owner)
    assert before[0]['due_date'] == '2026-10-02' and before[0]['paid'] is False
    response = client.put(f'/api/accounts/{aid}/payment-schedule', headers=owner, json={
        'amount_cents': 5000, 'cadence': 'biweekly', 'anchor_date': '2026-10-03',
        'day1': 1, 'day2': 'last', 'active': True, 'effective_from': '2026-10-01',
    })
    assert response.status_code == 409
    assert bill_rows(client, owner) == before
    schedule(client, owner, aid, amount_cents=6000)
    after = bill_rows(client, owner)
    assert len(after) == 3
    retained = next(row for row in after if row['id'] == before[0]['id'])
    assert retained['due_date'] == '2026-10-02' and retained['amount_cents'] == 5000
    assert managed_item(client, owner, aid)['planned_cents'] == 17000


@pytest.mark.parametrize('cadence,anchor,day1,day2,month,expected', [
    ('weekly', '2026-10-02', 1, 'last', '2026-10', ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']),
    ('semimonthly', '2028-02-01', 15, 'last', '2028-02', ['2028-02-15', '2028-02-29']),
    ('semimonthly', '2026-02-01', 15, 'last', '2026-02', ['2026-02-15', '2026-02-28']),
])
def test_debt_calendar_counts_real_occurrences(home, cadence, anchor, day1, day2, month, expected):
    app, client, owner, _, _ = home
    app.state.today = lambda zone: date.fromisoformat(month + '-01')
    aid = account(client, owner)
    schedule(client, owner, aid, cadence=cadence, anchor_date=anchor, day1=day1, day2=day2,
             effective_from=month + '-01', amount_cents=1234)
    row = managed_item(client, owner, aid, month)
    assert row['payment_dates'] == expected
    assert row['planned_cents'] == len(expected) * 1234


def test_monthly_day31_clamps_without_drifting_to_march29(home):
    app, client, owner, _, _ = home
    app.state.today = lambda zone: date(2028, 1, 1)
    aid = account(client, owner)
    schedule(client, owner, aid, cadence='monthly', anchor_date='2028-01-31', day1=31,
             effective_from='2028-01-01')
    for month, expected in [('2028-01', '2028-01-31'), ('2028-02', '2028-02-29'), ('2028-03', '2028-03-31')]:
        row = managed_item(client, owner, aid, month)
        assert row['payment_dates'] == [expected]
        assert detail(client, owner, row['id'])['payment_occurrences'][0]['due_date'] == expected


def test_copy_regenerates_debt_rows_and_keeps_target_paid_facts(home):
    _, client, owner, _, _ = home
    aid = account(client, owner)
    schedule(client, owner, aid)
    original = managed_item(client, owner, aid)
    target = managed_item(client, owner, aid, '2026-11')
    target_bill = detail(client, owner, target['id'])['payment_occurrences'][0]
    assert client.patch(f"/api/bills/{target_bill['id']}", headers=owner, json={'paid': True}).status_code == 200
    assert client.post('/api/budget/items?month=2026-10', headers=owner, json={
        'name': 'Manual expense', 'group_name': 'Home', 'planned_cents': 1000,
    }).status_code == 201
    response = client.post('/api/budget/copy', headers=owner, json={
        'scope': 'household', 'from_month': '2026-10', 'to_month': '2026-11',
    })
    assert response.status_code == 201, response.text
    copied = managed_item(client, owner, aid, '2026-11')
    assert copied['id'] == target['id'] and copied['id'] != original['id']
    assert copied['planned_cents'] == 10000 and copied['payment_dates'] == ['2026-11-13', '2026-11-27']
    target_rows = detail(client, owner, copied['id'])['payment_occurrences']
    assert next(row for row in target_rows if row['id'] == target_bill['id'])['paid'] is True
    assert dashboard(client, owner, '2026-11')['planned_cents'] == 11000
    assert len(items(client, owner, '2026-11')) == 2


def test_managed_plan_is_read_only_but_ledger_links_are_explicit(home):
    _, client, owner, _, _ = home
    aid = account(client, owner)
    schedule(client, owner, aid)
    row = managed_item(client, owner, aid)
    path = f"/api/budget/items/{row['id']}"
    assert client.patch(path, headers=owner, json={'planned_cents': 1, 'name': 'Bypass'}).status_code == 409
    assert client.delete(path, headers=owner).status_code == 409
    assert client.put(path + '/due', headers=owner, json={'due_day': 31}).status_code == 409
    assert client.patch(path + '/payment', headers=owner, json={'paid': True}).status_code == 409
    response = client.post(path + '/transactions', headers=owner, json={
        'description': 'Actual payment', 'amount_cents': -5000, 'date': '2026-10-02',
    })
    assert response.status_code == 201, response.text
    assert response.json()['item']['spent_cents'] == 5000
    assert not any(occurrence['paid'] for occurrence in response.json()['payment_occurrences'])
    bill = response.json()['payment_occurrences'][0]
    assert client.patch(f"/api/bills/{bill['id']}", headers=owner, json={'paid': True}).status_code == 200
    assert client.patch(f"/api/bills/{bill['id']}", headers=owner, json={'due_date': '2026-10-03'}).status_code == 409
    assert client.delete(f"/api/bills/{bill['id']}", headers=owner).status_code == 409
    assert managed_item(client, owner, aid)['planned_cents'] == 15000
    manual = client.post('/api/budget/items?month=2026-10', headers=owner, json={
        'name': 'Manual fixture', 'group_name': 'Home', 'planned_cents': 1000,
    }).json()['id']
    assert bill['id'] not in {candidate['id'] for candidate in detail(client, owner, manual)['available_bills']}
    assert client.put(f'/api/budget/items/{manual}/due', headers=owner, json={
        'due_day': 2, 'existing_bill_id': bill['id'],
    }).status_code == 409


def test_schedule_changes_preserve_past_debt_and_paid_facts_and_stop_future(home):
    app, client, owner, _, _ = home
    aid = account(client, owner)
    schedule(client, owner, aid)
    october = managed_item(client, owner, aid)
    old_rows = detail(client, owner, october['id'])['payment_occurrences']
    assert client.patch(f"/api/bills/{old_rows[1]['id']}", headers=owner, json={'paid': True}).status_code == 200
    november = managed_item(client, owner, aid, '2026-11')
    next_rows = detail(client, owner, november['id'])['payment_occurrences']
    assert client.patch(f"/api/bills/{next_rows[0]['id']}", headers=owner, json={'paid': True}).status_code == 200
    app.state.today = lambda zone: date(2026, 11, 5)
    response = client.put(f'/api/accounts/{aid}/payment-schedule', headers=owner, json={
        'amount_cents': 5000, 'cadence': 'biweekly', 'anchor_date': '2026-10-03',
        'day1': 1, 'day2': 'last', 'active': True, 'effective_from': '2026-11-01',
    })
    assert response.status_code == 409
    schedule(client, owner, aid, amount_cents=6000, effective_from='2026-11-01')
    revised = detail(client, owner, november['id'])['payment_occurrences']
    paid = next(row for row in revised if row['id'] == next_rows[0]['id'])
    assert paid['paid'] and paid['amount_cents'] == 5000 and paid['due_date'] == '2026-11-13'
    assert next(row for row in revised if row['due_date'] == '2026-11-27')['amount_cents'] == 6000
    assert managed_item(client, owner, aid, '2026-11')['planned_cents'] == 11000
    schedule(client, owner, aid, amount_cents=6000, active=False, effective_from='2026-11-01')
    rows = {row['id']: row for row in bill_rows(client, owner)}
    assert all(row['id'] in rows for row in old_rows)
    assert rows[old_rows[0]['id']]['due_date'] == '2026-10-02' and not rows[old_rows[0]['id']]['paid']
    assert rows[old_rows[1]['id']]['paid']
    assert paid['id'] in rows and rows[paid['id']]['paid']
    assert not any(row['due_date'] > '2026-11-05' and not row['paid'] for row in rows.values())
    app.state.today = lambda zone: date(2027, 2, 1)
    assert {row['id'] for row in bill_rows(client, owner)} == set(rows)


def test_same_effective_monthly_day_edits_keep_paid_occurrence_identity(home):
    app, client, owner, _, _ = home
    aid = account(client, owner)
    schedule(client, owner, aid, cadence='monthly', anchor_date='2026-10-31', day1=31)
    october = managed_item(client, owner, aid)
    october_bill = detail(client, owner, october['id'])['payment_occurrences'][0]
    assert client.patch(f"/api/bills/{october_bill['id']}", headers=owner, json={'paid': True}).status_code == 200
    schedule(client, owner, aid, cadence='monthly', anchor_date='2026-10-15', day1=15, amount_cents=6000)
    november = managed_item(client, owner, aid, '2026-11')
    november_bill = detail(client, owner, november['id'])['payment_occurrences'][0]
    assert november_bill['due_date'] == '2026-11-15' and november_bill['amount_cents'] == 6000
    assert client.patch(f"/api/bills/{november_bill['id']}", headers=owner, json={'paid': True}).status_code == 200
    schedule(client, owner, aid, cadence='monthly', anchor_date='2026-10-20', day1=20, amount_cents=7500)
    october_rows = detail(client, owner, october['id'])['payment_occurrences']
    november_rows = detail(client, owner, november['id'])['payment_occurrences']
    assert len(october_rows) == len(november_rows) == 1
    assert october_rows[0]['id'] == october_bill['id'] and october_rows[0]['due_date'] == '2026-10-31'
    assert october_rows[0]['amount_cents'] == 5000 and october_rows[0]['paid']
    assert november_rows[0]['id'] == november_bill['id'] and november_rows[0]['due_date'] == '2026-11-15'
    assert november_rows[0]['amount_cents'] == 6000 and november_rows[0]['paid']
    assert managed_item(client, owner, aid)['planned_cents'] == 5000
    assert managed_item(client, owner, aid, '2026-11')['planned_cents'] == 6000
    december = managed_item(client, owner, aid, '2026-12')
    assert december['payment_dates'] == ['2026-12-20'] and december['planned_cents'] == 7500
    app.state.today = lambda zone: date(2026, 12, 5)
    schedule(client, owner, aid, cadence='monthly', anchor_date='2026-10-20', day1=20,
             amount_cents=7500, active=False, effective_from='2026-12-01')
    retained = bill_rows(client, owner)
    assert {row['id'] for row in retained} == {october_bill['id'], november_bill['id']}


def test_private_and_foreign_debt_accounts_are_hidden_from_all_entry_points(home):
    _, client, owner, member, outsider = home
    private = account(client, owner, scope='personal', name='Secret medical loan')
    schedule(client, owner, private, scope='personal')
    shared = account(client, owner, name='Household loan')
    schedule(client, owner, shared)
    private_item = managed_item(client, owner, private, scope='personal')
    token = client.post('/api/integrations/ha-token', headers=owner).json()['token']
    machine = {'Authorization': 'Bearer ' + token}
    for actor, scope, target, code in [
        (member, 'personal', private, 404), (member, 'household', private, 404),
        (owner, 'household', private, 404), (outsider, 'household', shared, 404),
        (machine, 'household', shared, 401),
    ]:
        base = f'/api/accounts/{target}'
        assert client.get(base + '/history', headers=actor, params={'scope': scope}).status_code == code
        assert client.patch(base, headers=actor, params={'scope': scope}, json={'notes': 'Bypass'}).status_code == code
        assert client.delete(base, headers=actor, params={'scope': scope}).status_code == code
        assert client.put(base + '/payment-schedule', headers=actor, params={'scope': scope}, json={
            'amount_cents': 1, 'cadence': 'monthly', 'anchor_date': '2026-10-31',
            'day1': 31, 'day2': 'last', 'active': True, 'effective_from': '2026-10-01',
        }).status_code == code
    assert client.get(f"/api/budget/items/{private_item['id']}/details", headers=member).status_code == 404
    assert client.patch('/api/settings', headers=owner, json={'share_personal_totals': True}).status_code == 200
    for path in ('/api/accounts', '/api/accounts/net-worth/history', '/api/dashboard?month=2026-10'):
        response = client.get(path, headers=member)
        assert response.status_code == 200
        assert 'Secret medical loan' not in response.text
    assert client.get('/api/accounts/net-worth/history', headers=machine).status_code == 401
    exported = client.get('/api/ha/bills', headers=machine)
    assert exported.status_code == 200 and 'Secret medical loan' not in exported.text
    assert exported.json()['past_due']['count'] == 1  # household only


def test_non_debt_and_non_usd_accounts_cannot_start_managed_usd_payments(home):
    _, client, owner, _, _ = home
    for changes in ({'kind': 'checking'}, {'currency': 'EUR'}):
        aid = account(client, owner, **changes)
        response = client.put(f'/api/accounts/{aid}/payment-schedule', headers=owner, json={
            'amount_cents': 5000, 'cadence': 'monthly', 'anchor_date': '2026-10-31',
            'day1': 31, 'day2': 'last', 'active': True, 'effective_from': '2026-10-01',
        })
        assert response.status_code == 422, response.text
    assert items(client, owner) == []


def test_metadata_does_not_fabricate_balance_history_and_currency_epochs_remain_distinct(home, monkeypatch):
    _, client, owner, _, _ = home
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-04T12:00:00.000000+00:00')
    aid = account(client, owner, opened_date='2000-01-01', original_balance_cents=150000)
    original = history(client, owner, aid)
    assert len(original['points']) == 1
    assert original['history_starts_at'] == '2026-10-04T12:00:00.000000+00:00'
    assert original['points'][0]['net_worth_cents'] == -90000
    assert client.patch(f'/api/accounts/{aid}', headers=owner, json={
        'name': 'Renamed fixture', 'apr_basis_points': 625, 'term_months': 360,
        'debt_type': 'mortgage', 'notes': 'Local synthetic notes',
    }).status_code == 200
    assert history(client, owner, aid)['points'] == original['points']
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-05T12:00:00.000000+00:00')
    assert client.patch(f'/api/accounts/{aid}', headers=owner, json={'balance_cents': 70000}).status_code == 200
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-06T12:00:00.000000+00:00')
    assert client.patch(f'/api/accounts/{aid}', headers=owner, json={
        'currency': 'EUR', 'balance_cents': 200000, 'original_balance_cents': None,
    }).status_code == 200
    rows = history(client, owner, aid)['points']
    assert [row['currency'] for row in rows] == ['USD', 'USD', 'EUR']
    assert [row['balance_cents'] for row in rows] == [90000, 70000, 200000]
    assert rows[0] == original['points'][0]
    series = net_worth(client, owner)
    assert set(series) == {'USD', 'EUR'}
    assert series['EUR'][-1]['net_worth_cents'] == -200000
    assert not any(row['net_worth_cents'] == -270000 for points in series.values() for row in points)


def test_kind_change_is_a_valuation_event_without_rewriting_observed_facts(home, monkeypatch):
    _, client, owner, _, _ = home
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-04T12:00:00.000000+00:00')
    aid = account(client, owner, kind='checking', balance_cents=20000)
    before = history(client, owner, aid)['points']
    assert before[0]['net_worth_cents'] == 20000 and before[0]['kind'] == 'checking'
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-05T12:00:00.000000+00:00')
    assert client.patch(f'/api/accounts/{aid}', headers=owner, json={'kind': 'credit'}).status_code == 200
    assert history(client, owner, aid)['points'] == before
    values = net_worth(client, owner)['USD']
    assert values[0]['net_worth_cents'] == 20000
    assert values[-1]['net_worth_cents'] == -20000 and values[-1]['liabilities_cents'] == 20000


def test_bank_observations_dedup_use_provider_as_of_and_stale_balance_does_not_drop_transactions(home, monkeypatch):
    app, client, owner, _, _ = home
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-04T12:00:00.000000+00:00')
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed())
    aid = client.get('/api/accounts', headers=owner).json()[0]['id']
    original = history(client, owner, aid)['points']
    assert len(original) == 1
    assert original[0]['observed_at'] == '2026-10-04T12:00:00.000000+00:00'
    assert original[0]['provider_as_of'] == original[0]['effective_at'] == '2026-10-02T12:00:00.000000+00:00'
    assert original[0]['balance_cents'] == 12345
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed())
    assert history(client, owner, aid)['points'] == original
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed(
        balance='999.00', as_of='2026-10-01T12:00:00+00:00', transaction_id='late-arriving-transaction',
    ))
    assert client.get('/api/accounts', headers=owner).json()[0]['balance_cents'] == 12345
    assert history(client, owner, aid)['points'] == original
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT COUNT(*) FROM transactions WHERE account_id=?', (aid,)).fetchone()[0] == 2


def test_transaction_account_allowlist_is_display_only_and_keeps_imports_and_budget_totals(home):
    app, client, owner, _, _ = home
    visible = []
    hidden = []
    for kind in ('checking', 'savings', 'credit', 'loan', 'investment', 'property', 'other'):
        aid = account(client, owner, kind=kind, name=kind)
        response = client.post('/api/transactions', headers=owner, json={
            'description': kind + ' fixture', 'amount_cents': -100, 'date': '2026-10-02',
        })
        tx = response.json()['id']
        with connect(app.state.db_path) as db:
            db.execute('UPDATE transactions SET account_id=?,external_id=? WHERE id=?', (aid, kind + '-bank-id', tx))
        (visible if kind in ('checking', 'savings', 'credit') else hidden).append(tx)
    manual = client.post('/api/transactions', headers=owner, json={
        'description': 'Unlinked manual fixture', 'amount_cents': -100, 'date': '2026-10-02',
    }).json()['id']
    response = client.get('/api/transactions?month=2026-10', headers=owner)
    assert response.status_code == 200
    assert {row['id'] for row in response.json()} == {*visible, manual}
    assert dashboard(client, owner)['spent_cents'] == 800
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT COUNT(*) FROM transactions').fetchone()[0] == 8
        assert db.execute('SELECT COUNT(*) FROM transaction_exclusions').fetchone()[0] == 0
    # A loan feed continues importing even though its transactions are hidden.
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed())
    with connect(app.state.db_path) as db:
        imported = db.execute("SELECT * FROM accounts WHERE source='simplefin'").fetchone()
        db.execute("UPDATE accounts SET kind='loan' WHERE id=?", (imported['id'],))
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed(transaction_id='second-hidden-payment'))
    assert len(client.get('/api/transactions?month=2026-10', headers=owner).json()) == 4
    assert dashboard(client, owner)['spent_cents'] == 4800
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT COUNT(*) FROM transactions').fetchone()[0] == 10
        assert db.execute('SELECT COUNT(*) FROM transaction_exclusions').fetchone()[0] == 0


def test_archive_stops_future_payments_preserves_bank_records_and_own_history(home):
    app, client, owner, _, _ = home
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed())
    aid = client.get('/api/accounts', headers=owner).json()[0]['id']
    assert client.patch(f'/api/accounts/{aid}', headers=owner, json={'kind': 'loan'}).status_code == 200
    schedule(client, owner, aid)
    october = managed_item(client, owner, aid)
    rows = detail(client, owner, october['id'])['payment_occurrences']
    assert client.patch(f"/api/bills/{rows[1]['id']}", headers=owner, json={'paid': True}).status_code == 200
    before = history(client, owner, aid)['points']
    assert client.delete(f'/api/accounts/{aid}', headers=owner).status_code == 204
    assert client.get('/api/accounts', headers=owner).json() == []
    assert history(client, owner, aid)['points'] == before
    retained = bill_rows(client, owner)
    assert any(row['id'] == rows[0]['id'] and not row['paid'] for row in retained)
    assert any(row['id'] == rows[1]['id'] and row['paid'] for row in retained)
    assert not any(row['due_date'] > '2026-10-04' and not row['paid'] for row in retained)
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed(balance='999.00', transaction_id='must-not-resurrect'))
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0] == 1
        assert db.execute('SELECT archived FROM accounts WHERE id=?', (aid,)).fetchone()[0] == 1
        assert db.execute('SELECT COUNT(*) FROM transactions').fetchone()[0] == 1
        assert db.execute('SELECT account_id FROM transactions').fetchone()[0] == aid
    assert history(client, owner, aid)['points'] == before


def test_managed_category_identity_does_not_capture_an_existing_manual_name(home):
    _, client, owner, _, _ = home
    response = client.post('/api/budget/categories', headers=owner, json={'name': 'Debt payments'})
    assert response.status_code == 201
    manual_category = response.json()['id']
    ordinary = client.post('/api/budget/items?month=2026-10', headers=owner, json={
        'name': 'Ordinary fixture', 'budget_category_id': manual_category, 'planned_cents': 1000,
    }).json()['id']
    aid = account(client, owner)
    schedule(client, owner, aid)
    managed = managed_item(client, owner, aid)
    assert managed['budget_category_id'] != manual_category
    categories = client.get('/api/budget/categories?month=2026-10', headers=owner).json()
    generated_category = next(row for row in categories if row['id'] == managed['budget_category_id'])
    assert generated_category['managed'] is True and generated_category['source'] == 'debt_payment'
    for body in ({'name': 'Moved by metadata'}, {'color': '#123456'}, {'active': False}):
        assert client.patch(f"/api/budget/categories/{generated_category['id']}", headers=owner, json=body).status_code == 409
    assert client.post('/api/budget/items?month=2026-10', headers=owner, json={
        'name': 'Cannot enter managed category', 'budget_category_id': generated_category['id'], 'planned_cents': 1,
    }).status_code == 409
    assert client.patch(f'/api/budget/items/{ordinary}', headers=owner, json={
        'budget_category_id': generated_category['id'],
    }).status_code == 409
    assert client.patch(f'/api/budget/categories/{manual_category}', headers=owner, json={'name': 'My ordinary category'}).status_code == 200
    assert managed_item(client, owner, aid)['group_name'] == generated_category['name']
    assert dashboard(client, owner)['planned_cents'] == 16000


def test_active_debt_currency_and_kind_edits_cannot_orphan_managed_payments(home):
    _, client, owner, _, _ = home
    aid = account(client, owner, original_balance_cents=100000)
    schedule(client, owner, aid)
    for body in ({'kind': 'checking', 'original_balance_cents': None},
                 {'currency': 'EUR', 'balance_cents': 900, 'original_balance_cents': None}):
        assert client.patch(f'/api/accounts/{aid}', headers=owner, json=body).status_code == 409
    schedule(client, owner, aid, active=False)
    # Even after stopping, an old original amount cannot be silently relabelled.
    assert client.patch(f'/api/accounts/{aid}', headers=owner, json={'currency': 'EUR', 'balance_cents': 900}).status_code == 422
    assert client.patch(f'/api/accounts/{aid}', headers=owner, json={
        'currency': 'EUR', 'balance_cents': 900, 'original_balance_cents': None,
    }).status_code == 200


def test_blocked_provider_currency_change_does_not_attach_wrong_currency_transactions(home):
    app, client, owner, _, _ = home
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed())
    aid = client.get('/api/accounts', headers=owner).json()[0]['id']
    assert client.patch(f'/api/accounts/{aid}', headers=owner, json={
        'kind': 'loan', 'currency': 'EUR', 'balance_cents': 900,
        'original_balance_cents': 1000,
    }).status_code == 200
    before = history(client, owner, aid)['points']
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed(
        balance='999.00', as_of='2026-10-05T12:00:00+00:00',
        transaction_id='wrong-currency-new-payment',
    ))
    with connect(app.state.db_path) as db:
        row = db.execute('SELECT currency,balance_cents,original_balance_cents FROM accounts WHERE id=?', (aid,)).fetchone()
        assert tuple(row) == ('EUR', 900, 1000)
        assert db.execute('SELECT COUNT(*) FROM transactions WHERE account_id=?', (aid,)).fetchone()[0] == 1
        assert db.execute('SELECT COUNT(*) FROM transaction_exclusions').fetchone()[0] == 0
    assert history(client, owner, aid)['points'] == before


def test_foreign_bank_record_cannot_gain_or_change_usd_budget_category(home):
    app, client, owner, _, _ = home
    aid = account(client, owner, kind='checking', currency='EUR')
    first = client.post('/api/budget/items?month=2026-10', headers=owner, json={
        'name': 'Historical fixture plan', 'group_name': 'Home', 'planned_cents': 1000,
    }).json()['id']
    second = client.post('/api/budget/items?month=2026-10', headers=owner, json={
        'name': 'Another USD plan', 'group_name': 'Home', 'planned_cents': 1000,
    }).json()['id']
    tx = client.post('/api/transactions', headers=owner, json={
        'description': 'Legacy imported record', 'date': '2026-10-02',
        'amount_cents': -500, 'category_id': first,
    }).json()['id']
    # Preserve a historical record from before current USD assignment checks.
    with connect(app.state.db_path) as db:
        db.execute('UPDATE transactions SET account_id=?,external_id=? WHERE id=?',
                   (aid, 'legacy-eur-bank-record', tx))
    response = client.patch(f'/api/transactions/{tx}', headers=owner, json={
        'description': 'Corrected historical description', 'category_id': first,
    })
    assert response.status_code == 200
    assert response.json()['account_id'] == aid and response.json()['currency'] == 'EUR'
    assert client.patch(f'/api/transactions/{tx}', headers=owner, json={
        'category_id': second,
    }).status_code == 422
    with connect(app.state.db_path) as db:
        row = db.execute('SELECT account_id,external_id,category_id,amount_cents FROM transactions WHERE id=?', (tx,)).fetchone()
        assert tuple(row) == (aid, 'legacy-eur-bank-record', first, -500)
    assert client.patch(f'/api/transactions/{tx}', headers=owner, json={'category_id': None}).status_code == 200
    assert client.patch(f'/api/transactions/{tx}', headers=owner, json={'category_id': first}).status_code == 422
    with connect(app.state.db_path) as db:
        row = db.execute('SELECT account_id,external_id,category_id,amount_cents FROM transactions WHERE id=?', (tx,)).fetchone()
        assert tuple(row) == (aid, 'legacy-eur-bank-record', None, -500)


def legacy_accounts(tmp_path, monkeypatch):
    path = tmp_path / 'legacy-accounts.sqlite3'
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-04T12:00:00.000000+00:00')
    with sqlite3.connect(path) as db:
        db.executescript('''
            CREATE TABLE households (id INTEGER PRIMARY KEY,name TEXT NOT NULL,timezone TEXT NOT NULL,
                                     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE users (id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,
                                password_hash TEXT,household_id INTEGER NOT NULL REFERENCES households(id),
                                is_admin INTEGER NOT NULL DEFAULT 0,share_personal_totals INTEGER NOT NULL DEFAULT 0,
                                ingress_id TEXT UNIQUE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE accounts (id INTEGER PRIMARY KEY,household_id INTEGER NOT NULL REFERENCES households(id),
                                   owner_id INTEGER NOT NULL,scope TEXT NOT NULL,name TEXT NOT NULL,
                                   institution TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL DEFAULT 'checking',
                                   balance_cents INTEGER NOT NULL DEFAULT 0,currency TEXT NOT NULL DEFAULT 'USD',
                                   source TEXT NOT NULL DEFAULT 'manual',simplefin_id TEXT,
                                   UNIQUE(household_id,owner_id,scope,simplefin_id));
            INSERT INTO households(id,name,timezone) VALUES (1,'Legacy fixture','America/New_York');
            INSERT INTO users(id,username,display_name,household_id) VALUES (1,'legacy','Legacy',1);
        ''')
        db.execute("INSERT INTO accounts VALUES (41,1,0,'household','Legacy bank','Fixture bank','checking',12345,'USD','simplefin',?)",
                   (simplefin.external_key('fixture-connection', 'fixture-account'),))
        db.execute("INSERT INTO accounts VALUES (42,1,0,'household','Legacy credit','','credit',-5000,'USD','manual',NULL)")
    initialize(path)
    return path


def test_old_accounts_migration_is_idempotent_and_does_not_invent_old_balances(tmp_path, monkeypatch):
    path = legacy_accounts(tmp_path, monkeypatch)
    identity = (1, 0, 'household')
    with connect(path) as db:
        originals = [tuple(row) for row in db.execute('SELECT id,name,kind,balance_cents,currency,source,simplefin_id FROM accounts ORDER BY id')]
        observations = [dict(row) for row in db.execute('SELECT * FROM account_balance_observations ORDER BY id')]
        assert len(observations) == 2 and all(row['source'] == 'baseline' for row in observations)
        assert all(row['effective_at'] == '2026-10-04T12:00:00.000000+00:00' for row in observations)
        assert db.execute('SELECT COUNT(*) FROM debt_payment_versions').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM budget_items WHERE managed_account_id IS NOT NULL').fetchone()[0] == 0
        assert account_plans.net_worth_history(db, identity)['series'][0]['points'][-1]['net_worth_cents'] == 7345
    initialize(path)
    initialize(path)
    with connect(path) as db:
        assert [tuple(row) for row in db.execute('SELECT id,name,kind,balance_cents,currency,source,simplefin_id FROM accounts ORDER BY id')] == originals
        assert [dict(row) for row in db.execute('SELECT * FROM account_balance_observations ORDER BY id')] == observations
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def test_provider_history_before_other_legacy_baseline_has_incomplete_coverage(tmp_path, monkeypatch):
    path = legacy_accounts(tmp_path, monkeypatch)
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-04T13:00:00.000000+00:00')
    simplefin.import_accounts(path, 1, 'household', feed(balance='234.56'))
    with connect(path) as db:
        result = account_plans.net_worth_history(db, (1, 0, 'household'))
        points = next(series['points'] for series in result['series'] if series['currency'] == 'USD')
        prior = next(row for row in points if row['effective_at'] == '2026-10-02T12:00:00.000000+00:00')
        assert prior['observed_accounts'] == 1 and prior['total_accounts'] == 2 and prior['complete'] is False
        assert prior['assets_cents'] == 23456 and prior['liabilities_cents'] == 0
        # A later accepted provider observation must not leave the current chart
        # showing an older cached migration baseline as the latest valuation.
        assert db.execute('SELECT balance_cents FROM accounts WHERE id=41').fetchone()[0] == 23456
        assert points[-1]['net_worth_cents'] == 18456
        raw = account_plans.account_history(db, (1, 0, 'household'), 41)
        baseline = next(point for point in raw['points'] if point['source'] == 'baseline')
        assert baseline['balance_cents'] == 12345
        assert baseline['is_baseline'] is True and baseline['superseded_by_provider'] is True
        assert raw['history_starts_at'] == '2026-10-02T12:00:00.000000+00:00'
        assert db.execute('SELECT COUNT(*) FROM account_balance_observations WHERE account_id=41').fetchone()[0] == 2
