"""Explicit student-loan valuation, grouping, coverage, and immutable facts."""
import sqlite3

from backend import accounts as account_plans, simplefin
from backend.database import connect, initialize
from test_account_debt_history import account, bill_rows, feed, history, home, net_worth, schedule


def loan(client, headers, **changes):
    return account(client, headers, debt_type='student', **changes)


def view(client, headers, scope='household'):
    response = client.get('/api/accounts', headers=headers, params={'scope': scope})
    assert response.status_code == 200, response.text
    return {row['id']: row for row in response.json()}


def body(**changes):
    return {'name': 'Student loans', 'borrower': 'Fixture borrower', 'servicer': 'Fixture servicer',
            'currency': 'USD', 'valuation_mode': 'individual_loans',
            'reported_account_id': None, 'child_account_ids': [], **changes}


def create_group(client, headers, scope='household', **changes):
    response = client.post('/api/student-loan-groups', headers=headers, params={'scope': scope}, json=body(**changes))
    assert response.status_code == 201, response.text
    return response.json()


def groups(client, headers, scope='household'):
    response = client.get('/api/student-loan-groups', headers=headers, params={'scope': scope, 'month': '2026-10'})
    assert response.status_code == 200, response.text
    return response.json()


def replace_group(client, headers, group, scope='household', **changes):
    payload = {key: group[key] for key in ('name', 'borrower', 'servicer', 'currency', 'valuation_mode', 'reported_account_id')}
    payload['child_account_ids'] = [row['id'] for row in group['children']]
    response = client.put(f"/api/student-loan-groups/{group['id']}", headers=headers,
                          params={'scope': scope}, json=payload | changes)
    assert response.status_code == 200, response.text
    return response.json()


def test_partial_servicer_total_counts_once_and_coverage_is_truthful(home):
    _, client, owner, _, _ = home
    total = loan(client, owner, balance_cents=100000)
    first = loan(client, owner, balance_cents=20000, apr_basis_points=500,
                 accrued_interest_cents=2000, accrued_interest_as_of='2026-10-02')
    second = loan(client, owner, balance_cents=30000, apr_basis_points=700, accrued_interest_cents=3000)
    group = create_group(client, owner, valuation_mode='servicer_total', reported_account_id=total,
                         child_account_ids=[first, second])
    assert group['balance_cents'] == 100000 and group['child_balance_cents'] == 50000
    assert group['balance_difference_cents'] == 50000 and group['breakdown_complete'] is False
    assert group['weighted_apr_basis_points'] == 620 and group['apr_covered_balance_cents'] == 50000
    assert group['apr_complete'] is False and group['apr_reported_count'] == 2
    assert group['accrued_interest_cents'] == 5000 and group['interest_complete'] is False
    current = view(client, owner)
    assert current[total]['net_worth_included'] is True
    assert current[first]['net_worth_included'] is current[second]['net_worth_included'] is False
    assert sum(abs(row['balance_cents']) for row in current.values() if row['net_worth_included']) == 100000
    latest = net_worth(client, owner)['USD'][-1]
    assert latest['net_worth_cents'] == -100000
    assert latest['observed_accounts'] == latest['total_accounts'] == 1 and latest['complete'] is True
    # Equality of known-rate balance and authoritative total is insufficient.
    assert client.patch(f'/api/accounts/{first}', headers=owner, json={'balance_cents': 100000}).status_code == 200
    assert client.patch(f'/api/accounts/{second}', headers=owner, json={'apr_basis_points': None}).status_code == 200
    changed = groups(client, owner)[0]
    assert changed['apr_covered_balance_cents'] == 100000 and changed['child_balance_cents'] == 130000
    assert changed['apr_complete'] is False


def test_new_group_child_is_excluded_from_first_observation_even_older_provider_date(home, monkeypatch):
    app, client, owner, _, _ = home
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-04T12:00:00.000000+00:00')
    total = loan(client, owner, balance_cents=100000)
    group = create_group(client, owner, valuation_mode='servicer_total', reported_account_id=total)
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-05T12:00:00.000000+00:00')
    child = loan(client, owner, balance_cents=20000, student_loan_group_id=group['id'])
    assert view(client, owner)[child]['net_worth_included'] is False
    with connect(app.state.db_path) as db:
        row = db.execute('SELECT * FROM accounts WHERE id=?', (child,)).fetchone()
        assert row['initial_net_worth_included'] == 0
        assert account_plans.import_balance(db, row, 20000, 'USD', '2026-10-01T12:00:00.000000+00:00') is True
    points = net_worth(client, owner)['USD']
    assert all(point['net_worth_cents'] == -100000 for point in points)
    assert all(point['observed_accounts'] == point['total_accounts'] == 1 for point in points)
    assert history(client, owner, child)['points'][0]['provider_as_of'] == '2026-10-01T12:00:00.000000+00:00'


def test_source_switch_changes_valuation_at_decision_time_preserves_observations_and_collateral(home, monkeypatch):
    _, client, owner, _, _ = home
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-04T12:00:00.000000+00:00')
    total = loan(client, owner, balance_cents=100000)
    first = loan(client, owner, balance_cents=20000, apr_basis_points=500)
    second = loan(client, owner, balance_cents=30000, apr_basis_points=700)
    asset = account(client, owner, kind='property', balance_cents=200000)
    for aid in (total, first, second):
        assert client.put(f'/api/accounts/{aid}/collateral', headers=owner, json={'asset_id': asset}).status_code == 200
    original = {aid: history(client, owner, aid)['points'] for aid in (total, first, second, asset)}
    assert net_worth(client, owner)['USD'][-1]['net_worth_cents'] == 50000
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-05T12:00:00.000000+00:00')
    group = create_group(client, owner, valuation_mode='servicer_total', reported_account_id=total, child_account_ids=[first, second])
    assert view(client, owner)[asset]['equity_cents'] == 100000
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-06T12:00:00.000000+00:00')
    changed = replace_group(client, owner, group, valuation_mode='individual_loans')
    assert changed['balance_cents'] == 50000 and changed['apr_complete'] is True
    assert view(client, owner)[asset]['equity_cents'] == 150000
    assert [point['net_worth_cents'] for point in net_worth(client, owner)['USD']] == [50000, 100000, 150000]
    for aid, points in original.items():
        assert history(client, owner, aid)['points'] == points
    assert all('net_worth_included' in row for row in view(client, owner)[asset]['secured_debts'])


def test_detach_and_archive_preserve_exclusion_until_explicit_ungrouped_restore(home):
    _, client, owner, _, _ = home
    total = loan(client, owner, balance_cents=100000)
    child = loan(client, owner, balance_cents=20000)
    group = create_group(client, owner, valuation_mode='servicer_total', reported_account_id=total, child_account_ids=[child])
    assert client.patch(f'/api/accounts/{child}', headers=owner, json={'net_worth_included': True}).status_code == 409
    group = replace_group(client, owner, group, child_account_ids=[])
    detached = view(client, owner)[child]
    assert detached['student_loan_group_id'] is None and detached['net_worth_included'] is False
    assert net_worth(client, owner)['USD'][-1]['net_worth_cents'] == -100000
    assert client.patch(f'/api/accounts/{child}', headers=owner, json={'net_worth_included': True}).status_code == 200
    assert net_worth(client, owner)['USD'][-1]['net_worth_cents'] == -120000
    group = replace_group(client, owner, group, child_account_ids=[child])
    assert client.delete(f"/api/student-loan-groups/{group['id']}", headers=owner).status_code == 204
    archived = groups(client, owner)[0]
    assert archived['active'] is False
    current = view(client, owner)
    assert current[child]['student_loan_group_id'] is None and current[child]['net_worth_included'] is False
    assert current[total]['net_worth_included'] is True
    assert client.patch(f'/api/accounts/{child}', headers=owner, json={'net_worth_included': True}).status_code == 200


def test_source_switch_rejects_dropped_counted_total_without_mutation(home, monkeypatch):
    app, client, owner, _, _ = home
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-04T12:00:00.000000+00:00')
    total = loan(client, owner, balance_cents=100000)
    child = loan(client, owner, balance_cents=20000)
    group = create_group(client, owner, valuation_mode='servicer_total', reported_account_id=total,
                         child_account_ids=[child])
    before = net_worth(client, owner)
    with connect(app.state.db_path) as db:
        before_events = [dict(row) for row in db.execute('SELECT * FROM account_net_worth_events ORDER BY id')]
    payload = body(valuation_mode='individual_loans', child_account_ids=[child])
    response = client.put(f"/api/student-loan-groups/{group['id']}", headers=owner, json=payload)
    assert response.status_code == 409, response.text
    assert groups(client, owner)[0]['valuation_mode'] == 'servicer_total'
    assert view(client, owner)[total]['net_worth_included'] is True
    assert view(client, owner)[child]['net_worth_included'] is False
    assert net_worth(client, owner) == before
    with connect(app.state.db_path) as db:
        assert [dict(row) for row in db.execute('SELECT * FROM account_net_worth_events ORDER BY id')] == before_events
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-05T12:00:00.000000+00:00')
    switched = replace_group(client, owner, group, valuation_mode='individual_loans')
    assert view(client, owner)[total]['net_worth_included'] is False
    assert view(client, owner)[child]['net_worth_included'] is True
    # After the dated switch, removing the excluded reference is safe and keeps
    # the source decision. Its original history remains available separately.
    replace_group(client, owner, switched, reported_account_id=None)
    assert view(client, owner)[total]['student_loan_group_id'] is None
    assert view(client, owner)[total]['net_worth_included'] is False
    assert net_worth(client, owner)['USD'][-1]['net_worth_cents'] == -20000
    with connect(app.state.db_path) as db:
        changed = db.execute('SELECT * FROM account_net_worth_events WHERE observed_at=?',
                             ('2026-10-05T12:00:00.000000+00:00',)).fetchall()
        assert {(row['account_id'], row['included']) for row in changed} == {(total, 0), (child, 1)}


def test_source_switch_rejects_dropped_counted_child_and_replaced_authority(home):
    _, client, owner, _, _ = home
    total = loan(client, owner, balance_cents=100000)
    child = loan(client, owner, balance_cents=20000)
    group = create_group(client, owner, reported_account_id=total, child_account_ids=[child])
    response = client.put(f"/api/student-loan-groups/{group['id']}", headers=owner,
                          json=body(valuation_mode='servicer_total', reported_account_id=total))
    assert response.status_code == 409, response.text
    assert view(client, owner)[child]['net_worth_included'] is True
    assert view(client, owner)[total]['net_worth_included'] is False
    switched = replace_group(client, owner, group, valuation_mode='servicer_total')
    replacement = loan(client, owner, balance_cents=110000)
    response = client.put(f"/api/student-loan-groups/{group['id']}", headers=owner,
                          json=body(valuation_mode='servicer_total', reported_account_id=replacement,
                                    child_account_ids=[child]))
    assert response.status_code == 409, response.text
    assert groups(client, owner)[0]['reported_account_id'] == total
    # Keep the old total among the references for its atomic exclusion, then it
    # may be detached in a normal membership edit without re-entering net worth.
    changed = replace_group(client, owner, switched, reported_account_id=replacement,
                            child_account_ids=[child, total])
    assert view(client, owner)[total]['net_worth_included'] is False
    assert view(client, owner)[replacement]['net_worth_included'] is True
    replace_group(client, owner, changed, child_account_ids=[child])
    assert view(client, owner)[total]['net_worth_included'] is False
    assert net_worth(client, owner)['USD'][-1]['net_worth_cents'] == -110000


def test_group_constraints_privacy_and_authoritative_account_guards(home):
    app, client, owner, member, outsider = home
    total = loan(client, owner)
    child = loan(client, owner)
    private = loan(client, owner, scope='personal')
    eur = loan(client, owner, currency='EUR')
    other = account(client, owner, kind='checking')
    group = create_group(client, owner, valuation_mode='servicer_total', reported_account_id=total, child_account_ids=[child])
    for payload, code in ((body(child_account_ids=[child]), 409),
                           (body(child_account_ids=[private]), 404),
                           (body(child_account_ids=[eur]), 422),
                           (body(child_account_ids=[other]), 422),
                           (body(reported_account_id=child, child_account_ids=[child]), 422),
                           (body(child_account_ids=[True]), 422),
                           (body(child_account_ids=[child, child]), 422),
                           (body(valuation_mode='servicer_total'), 422)):
        response = client.post('/api/student-loan-groups', headers=owner, json=payload | {'name': 'Other group'})
        assert response.status_code == code, response.text
    for changes in ({'kind': 'credit'}, {'debt_type': 'personal'}, {'currency': 'EUR', 'balance_cents': 90000}):
        assert client.patch(f'/api/accounts/{total}', headers=owner, json=changes).status_code == 409
    assert client.delete(f'/api/accounts/{total}', headers=owner).status_code == 409
    assert groups(client, member)[0]['id'] == group['id']
    for actor, scope in ((outsider, 'household'), (member, 'personal')):
        assert client.put(f"/api/student-loan-groups/{group['id']}", headers=actor, params={'scope': scope}, json=body()).status_code == 404
        assert client.delete(f"/api/student-loan-groups/{group['id']}", headers=actor, params={'scope': scope}).status_code == 404
    private_group = create_group(client, owner, scope='personal', name='Secret borrower', child_account_ids=[private])
    assert client.patch('/api/settings', headers=owner, json={'share_personal_totals': True}).status_code == 200
    assert 'Secret borrower' not in client.get('/api/student-loan-groups', headers=member).text
    token = client.post('/api/integrations/ha-token', headers=owner).json()['token']
    machine = {'Authorization': 'Bearer ' + token}
    assert client.get('/api/student-loan-groups', headers=machine).status_code == 401
    assert client.post('/api/student-loan-groups', headers=machine, json=body()).status_code == 401
    assert client.delete(f"/api/student-loan-groups/{group['id']}", headers=machine).status_code == 401
    # Corrupt legacy cross-owner relations must not leak or mutate foreign rows.
    with connect(app.state.db_path) as db:
        db.execute('UPDATE student_loan_groups SET reported_account_id=? WHERE id=?', (private, group['id']))
        db.execute('UPDATE accounts SET student_loan_group_id=? WHERE id=?', (group['id'], private))
    public_group = groups(client, member)[0]
    assert public_group['reported_account_id'] is None and public_group['reported_account'] is None
    assert client.delete(f"/api/student-loan-groups/{group['id']}", headers=member).status_code == 204
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT student_loan_group_id FROM accounts WHERE id=?', (private,)).fetchone()[0] == group['id']


def test_missing_rate_interest_zero_balance_and_stale_provider_reports(home, monkeypatch):
    app, client, owner, _, _ = home
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-04T12:00:00.000000+00:00')
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed())
    imported = client.get('/api/accounts', headers=owner).json()[0]['id']
    assert client.patch(f'/api/accounts/{imported}', headers=owner, json={
        'kind': 'loan', 'debt_type': 'student', 'apr_basis_points': 500,
        'accrued_interest_cents': 2000, 'accrued_interest_as_of': '2026-10-02',
    }).status_code == 200
    missing = loan(client, owner, balance_cents=10000)
    paid_off = loan(client, owner, balance_cents=0, apr_basis_points=99999, accrued_interest_cents=0)
    create_group(client, owner, child_account_ids=[imported, missing, paid_off])
    group = groups(client, owner)[0]
    assert group['weighted_apr_basis_points'] == 500 and group['apr_complete'] is False
    assert group['interest_complete'] is False and group['interest_reported_count'] == 2
    assert client.patch(f'/api/accounts/{missing}', headers=owner, json={'accrued_interest_cents': 10001}).status_code == 422
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed(balance='10.00', as_of='2026-10-03T12:00:00+00:00'))
    stale = view(client, owner)[imported]
    assert stale['balance_cents'] == 1000 and stale['accrued_interest_cents'] == 2000
    assert stale['accrued_interest_as_of'] == '2026-10-02' and stale['accrued_interest_stale'] is True
    assert client.patch(f'/api/accounts/{imported}', headers=owner, json={'notes': 'Preserve old report'}).status_code == 200
    group = groups(client, owner)[0]
    assert group['interest_stale_count'] == 1 and group['accrued_interest_cents'] == 0
    assert group['interest_complete'] is False
    result = simplefin.import_accounts(app.state.db_path, 1, 'household', feed(
        currency='EUR', balance='999.00', as_of='2026-10-04T12:00:00+00:00', transaction_id='wrong-currency'))
    assert result['imported_transactions'] == 0 and view(client, owner)[imported]['currency'] == 'USD'


def test_schedule_aggregate_preserves_paid_amounts_and_archived_members_without_virtual_payments(home):
    _, client, owner, _, _ = home
    total = loan(client, owner)
    child = loan(client, owner)
    overdue_child = loan(client, owner)
    schedule(client, owner, total, cadence='monthly', anchor_date='2026-10-10', day1=10, amount_cents=4000)
    schedule(client, owner, child, cadence='monthly', anchor_date='2026-10-12', day1=12, amount_cents=2000)
    schedule(client, owner, overdue_child, cadence='monthly', anchor_date='2026-10-02', day1=2, amount_cents=1000)
    child_bill = next(row for row in bill_rows(client, owner) if row.get('debt_account_id') == child)
    assert client.patch(f"/api/bills/{child_bill['id']}", headers=owner, json={'paid': True}).status_code == 200
    before = bill_rows(client, owner)
    group = create_group(client, owner, valuation_mode='servicer_total', reported_account_id=total,
                         child_account_ids=[child, overdue_child])
    assert group['scheduled_payment_cents'] == 7000 and group['duplicate_schedule_sources'] is True
    assert bill_rows(client, owner) == before
    schedule(client, owner, child, cadence='monthly', anchor_date='2026-10-12', day1=12, amount_cents=9999)
    assert groups(client, owner)[0]['scheduled_payment_cents'] == 7000
    assert client.delete(f'/api/accounts/{child}', headers=owner).status_code == 204
    assert client.delete(f'/api/accounts/{overdue_child}', headers=owner).status_code == 204
    renamed = replace_group(client, owner, group, name='Renamed loans')
    assert renamed['children'][0]['active'] is False and renamed['child_balance_cents'] == 0
    assert renamed['scheduled_payment_cents'] == 7000
    retained_bills = bill_rows(client, owner)
    archived_paid = next(row for row in retained_bills if row.get('debt_account_id') == child)
    archived_overdue = next(row for row in retained_bills if row.get('debt_account_id') == overdue_child)
    assert archived_paid['paid'] is True and archived_paid['amount_cents'] == 2000
    assert archived_overdue['paid'] is False and archived_overdue['due_date'] == '2026-10-02'
    assert archived_overdue['amount_cents'] == 1000
    renamed = replace_group(client, owner, renamed, valuation_mode='individual_loans')
    assert client.delete(f'/api/accounts/{total}', headers=owner).status_code == 204
    retained = replace_group(client, owner, renamed, name='Retained references')
    assert retained['reported_account']['active'] is False


def test_ungrouped_reported_interest_currency_guard_and_zero_interest_annotation(home, monkeypatch):
    app, client, owner, _, _ = home
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-04T12:00:00.000000+00:00')
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed())
    aid = client.get('/api/accounts', headers=owner).json()[0]['id']
    assert client.patch(f'/api/accounts/{aid}', headers=owner, json={
        'kind': 'loan', 'debt_type': 'student', 'accrued_interest_cents': 0,
    }).status_code == 200
    result = simplefin.import_accounts(app.state.db_path, 1, 'household', feed(
        currency='EUR', as_of='2026-10-03T12:00:00+00:00', transaction_id='foreign-interest'))
    assert result['imported_transactions'] == 0 and view(client, owner)[aid]['currency'] == 'USD'
    assert client.patch(f'/api/accounts/{aid}', headers=owner, json={'currency': 'EUR', 'balance_cents': 1000}).status_code == 422
    assert client.patch(f'/api/accounts/{aid}', headers=owner, json={
        'currency': 'EUR', 'balance_cents': 1000, 'accrued_interest_cents': None, 'accrued_interest_as_of': None,
    }).status_code == 200


def test_additive_group_migration_defaults_legacy_inclusion_and_preserves_facts(tmp_path):
    path = tmp_path / 'legacy.sqlite3'
    with sqlite3.connect(path) as db:
        db.executescript('''
          CREATE TABLE households(id INTEGER PRIMARY KEY,name TEXT NOT NULL,timezone TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
          CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL,password_hash TEXT,
             household_id INTEGER NOT NULL,is_admin INTEGER DEFAULT 0,share_personal_totals INTEGER DEFAULT 0,ingress_id TEXT UNIQUE,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
          CREATE TABLE accounts(id INTEGER PRIMARY KEY,household_id INTEGER NOT NULL,owner_id INTEGER NOT NULL,scope TEXT NOT NULL,
             name TEXT NOT NULL,institution TEXT DEFAULT '',kind TEXT DEFAULT 'checking',balance_cents INTEGER DEFAULT 0,currency TEXT DEFAULT 'USD',source TEXT DEFAULT 'manual',simplefin_id TEXT,
             UNIQUE(household_id,owner_id,scope,simplefin_id));
          INSERT INTO households(id,name,timezone) VALUES (1,'Old home','America/New_York');
          INSERT INTO users(id,username,display_name,household_id) VALUES (1,'legacy','Legacy',1);
          INSERT INTO accounts(id,household_id,owner_id,scope,name,kind,balance_cents,source,simplefin_id)
             VALUES (41,1,0,'household','Old loan','loan',10000,'simplefin','old-provider-id');
        ''')
    initialize(path)
    with connect(path) as db:
        account_row = dict(db.execute('SELECT * FROM accounts WHERE id=41').fetchone())
        assert account_row['net_worth_included'] == account_row['initial_net_worth_included'] == 1
        assert account_row['student_loan_group_id'] is None and account_row['simplefin_id'] == 'old-provider-id'
        original = [dict(row) for row in db.execute('SELECT * FROM account_balance_observations')]
        account_plans.student_loans if False else None  # no history migration through name matching
        from backend.student_loans import set_inclusion
        set_inclusion(db, account_row, False, timestamp='2026-10-06T12:00:00.000000+00:00')
    initialize(path)
    with connect(path) as db:
        assert [dict(row) for row in db.execute('SELECT * FROM account_balance_observations')] == original
        assert db.execute('SELECT net_worth_included FROM accounts WHERE id=41').fetchone()[0] == 0
        assert db.execute('SELECT initial_net_worth_included FROM accounts WHERE id=41').fetchone()[0] == 1
        assert db.execute('SELECT COUNT(*) FROM account_net_worth_events').fetchone()[0] == 1
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
