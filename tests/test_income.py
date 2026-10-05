"""Income migration, calendar projection, replacement, and privacy regressions."""
from datetime import date
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.database import connect, initialize
from backend.income import planned_occurrences


def version(cadence, anchor='2026-01-01', **changes):
    return {'cadence': cadence, 'anchor_date': anchor, 'effective_from': '2026-01-01',
            'effective_to': None, 'superseded': 0, 'day1': '15', 'day2': 'last', **changes}


@pytest.mark.parametrize('plan,month,expected', [
    (version('weekly', '2026-10-02'), '2026-10', ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']),
    (version('biweekly', '2026-10-02'), '2026-10', ['2026-10-02', '2026-10-16', '2026-10-30']),
    (version('biweekly', '2026-10-02'), '2026-11', ['2026-11-13', '2026-11-27']),
    (version('biweekly', '2026-12-25'), '2027-01', ['2027-01-08', '2027-01-22']),
    (version('semimonthly'), '2027-02', ['2027-02-15', '2027-02-28']),
    (version('semimonthly'), '2028-02', ['2028-02-15', '2028-02-29']),
    (version('semimonthly', day1='10', day2='last'), '2026-11', ['2026-11-10', '2026-11-30']),
    (version('semimonthly', day1='30', day2='31'), '2027-02', ['2027-02-28', '2027-02-28']),
    (version('monthly', '2026-01-31'), '2026-02', ['2026-02-28']),
    (version('monthly', '2026-01-31'), '2026-03', ['2026-03-31']),
    (version('once', '2026-10-14'), '2026-10', ['2026-10-14']),
    (version('once', '2026-10-14'), '2026-11', []),
    (version('weekly', '2026-10-02', effective_from='2026-10-15', effective_to='2026-10-25'), '2026-10', ['2026-10-16', '2026-10-23']),
    (version('weekly', '9999-12-25', effective_from='9999-12-31'), '9999-12', []),
])
def test_calendar_dates_are_stable(plan, month, expected):
    occurrences = planned_occurrences(plan, month)
    assert [when.isoformat() for _, when in occurrences] == expected
    assert len({key for key, _ in occurrences}) == len(expected)


def test_additive_migration_preserves_amounts_zero_ids_and_deleted_marker(tmp_path):
    path = tmp_path / 'old-budget.sqlite3'
    initialize(path)
    with connect(path) as db:
        db.execute("INSERT INTO households(id,name,timezone) VALUES (1,'Home','America/New_York')")
        db.execute("INSERT INTO users(id,username,display_name,household_id) VALUES (1,'one','One',1)")
        db.execute("INSERT INTO users(id,username,display_name,household_id) VALUES (2,'two','Two',1)")
        db.execute("INSERT INTO budget_months VALUES (1,0,'household','2026-10',123456)")
        db.execute("INSERT INTO budget_months VALUES (1,1,'personal','2026-10',0)")
        db.execute("INSERT INTO budget_months VALUES (1,2,'personal','2026-10',98765)")
    initialize(path)
    with connect(path) as db:
        rows = [dict(row) for row in db.execute('SELECT * FROM income_entries ORDER BY id')]
        assert [row['amount_cents'] for row in rows] == [123456, 0, 98765]
        assert all(row['kind'] == 'legacy' and row['date'] is None for row in rows)
        ids = [row['id'] for row in rows]
        db.execute('DELETE FROM income_entries WHERE id=?', (ids[1],))
    initialize(path)
    with connect(path) as db:
        assert [row['id'] for row in db.execute('SELECT id FROM income_entries ORDER BY id')] == [ids[0], ids[2]]
        assert db.execute('SELECT COUNT(*) FROM income_migrations').fetchone()[0] == 3
        assert db.execute("SELECT income_cents FROM budget_months WHERE owner_id=0").fetchone()[0] == 123456


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv('BUDGET_AUTH_MODE', 'local')
    monkeypatch.setenv('BUDGET_LOCAL_AUTH', 'true')
    monkeypatch.setenv('BUDGET_DEMO', '0')
    app = create_app(tmp_path, today=lambda zone: date(2026, 10, 7))
    with TestClient(app) as client:
        login = client.post('/api/auth/setup', json={'username': 'owner', 'display_name': 'Owner', 'password': 'a-good-long-password'})
        assert login.status_code == 201
        client.headers['Authorization'] = 'Bearer ' + login.json()['token']
        yield app, client


def source(client, **changes):
    response = client.post('/api/income/sources?month=2026-10', json={
        'name': 'Salary', 'amount_cents': 10000, 'cadence': 'biweekly',
        'anchor_date': '2026-10-02', **changes,
    })
    assert response.status_code == 201, response.text
    return response.json()['id']


def income(client, month='2026-10', scope='household', headers=None):
    response = client.get('/api/income', params={'month': month, 'scope': scope}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_totals_use_entries_only_and_legacy_replacement_is_explicit(home):
    _, client = home
    assert client.post('/api/budget/income', json={'month': '2026-10', 'amount_cents': 60000}).status_code == 200
    previous = income(client)['entries'][0]['id']
    source(client)
    result = income(client)
    assert result['total_cents'] == 90000  # old60k + explicitly-added30k, never scalar again
    assert income(client)['total_cents'] == 90000
    assert any(row['id'] == previous for row in result['entries'])
    response = client.post('/api/income/entries?month=2026-10', json={'name': 'Side work', 'amount_cents': 1000, 'replace_legacy': True})
    assert response.status_code == 201
    assert income(client)['total_cents'] == 31000
    assert all(row['kind'] != 'legacy' for row in income(client)['entries'])
    assert client.get('/api/dashboard?month=2026-10').json()['income_cents'] == 31000


def test_source_replacement_removes_only_its_effective_month_legacy(home):
    _, client = home
    for month in ('2026-09', '2026-10'):
        client.post('/api/budget/income', json={'month': month, 'amount_cents': 60000})
    source(client, replace_legacy=True)
    assert income(client)['total_cents'] == 30000
    assert income(client, '2026-09')['total_cents'] == 60000


def test_schedule_changes_preserve_past_snapshots_and_zero_overrides(home):
    app, client = home
    sid = source(client)
    october = income(client)
    november = income(client, '2026-11')
    october_id = october['entries'][1]['id']
    november_id = november['entries'][0]['id']
    client.patch(f'/api/income/entries/{october_id}', json={'amount_cents': 0})
    client.patch(f'/api/income/entries/{november_id}', json={'amount_cents': 777})
    patch = client.patch(f'/api/income/sources/{sid}', json={'amount_cents': 20000})
    assert patch.status_code == 200 and patch.json()['effective_from'] == '2026-11-01'
    assert income(client)['total_cents'] == 20000
    assert income(client, '2026-11')['total_cents'] == 20777
    preserved = next(row for row in income(client, '2026-11')['entries'] if row['id'] == november_id)
    assert preserved['overridden'] and preserved['amount_cents'] == 777
    reset = client.post(f'/api/income/entries/{november_id}/reset')
    assert reset.status_code == 200 and reset.json()['amount_cents'] == 20000 and not reset.json()['overridden']
    assert income(client, '2026-11')['total_cents'] == 40000
    app.state.today = lambda zone: date(2026, 11, 4)
    assert client.patch(f'/api/income/sources/{sid}', json={'effective_from': '2026-10-01', 'amount_cents': 99999}).status_code == 422
    assert income(client)['total_cents'] == 20000


def test_moved_paycheck_is_preserved_and_reset_restores_original_date(home):
    _, client = home
    source(client)
    first = income(client)['entries'][0]
    changed = client.patch(f"/api/income/entries/{first['id']}", json={'date': '2026-11-01', 'amount_cents': 0})
    assert changed.status_code == 200
    assert income(client)['total_cents'] == 20000
    moved = next(row for row in income(client, '2026-11')['entries'] if row['id'] == first['id'])
    assert moved['date'] == '2026-11-01' and moved['scheduled_date'] == '2026-10-02' and moved['amount_cents'] == 0
    assert client.post(f"/api/income/entries/{first['id']}/reset").json()['date'] == '2026-10-02'
    assert income(client)['total_cents'] == 30000


def test_deleted_paycheck_stays_suppressed_and_schedule_stop_keeps_override(home):
    _, client = home
    sid = source(client)
    october = income(client)['entries']
    assert client.delete(f"/api/income/entries/{october[0]['id']}").status_code == 204
    assert income(client)['total_cents'] == 20000
    assert income(client)['total_cents'] == 20000
    november = income(client, '2026-11')['entries']
    override = november[0]['id']
    client.patch(f'/api/income/entries/{override}', json={'amount_cents': 4321})
    assert client.delete(f'/api/income/sources/{sid}').status_code == 204
    assert income(client)['total_cents'] == 20000
    assert income(client, '2026-11')['total_cents'] == 4321
    assert income(client, '2026-12')['total_cents'] == 0


def test_semimonthly_clamped_slots_materialize_as_two_distinct_entries(home):
    _, client = home
    source(client, cadence='semimonthly', anchor_date='2026-01-01', day1=30, day2=31)
    result = income(client, '2027-02')
    assert len(result['entries']) == 2
    assert len({row['id'] for row in result['entries']}) == 2
    assert {row['date'] for row in result['entries']} == {'2027-02-28'}
    assert result['total_cents'] == 20000


@pytest.mark.parametrize('target_manual', [False, True])
def test_copy_only_undated_manual_income_and_regenerates_payday_count(home, target_manual):
    _, client = home
    source(client, cadence='weekly', amount_cents=1000)
    client.post('/api/budget/items?month=2026-10', json={'name': 'Groceries', 'group_name': 'Food', 'planned_cents': 5000})
    client.post('/api/income/entries?month=2026-10', json={'name': 'Monthly plan', 'amount_cents': 10000})
    client.post('/api/income/entries?month=2026-10', json={'name': 'One-time bonus', 'amount_cents': 5000, 'date': '2026-10-19'})
    assert income(client, '2026-11')['total_cents'] == 4000  # viewing projection is not a plan conflict
    if target_manual:
        client.post('/api/income/entries?month=2026-11', json={'name': 'Already planned', 'amount_cents': 9000})
    copied = client.post('/api/budget/copy', json={'scope': 'household', 'from_month': '2026-10', 'to_month': '2026-11'})
    assert copied.status_code == 201, copied.text
    result = income(client, '2026-11')
    assert result['total_cents'] == (13000 if target_manual else 14000)
    assert len([row for row in result['entries'] if row['kind'] == 'scheduled']) == 4
    assert len([row for row in result['entries'] if row['kind'] == 'manual']) == 1
    assert all(row['name'] != 'One-time bonus' for row in result['entries'])
    assert client.get('/api/budget/items?month=2026-11').json()[0]['name'] == 'Groceries'


def test_legacy_month_copy_preserves_amount_without_adding_zero_placeholder(home):
    _, client = home
    client.post('/api/budget/income', json={'month': '2026-10', 'amount_cents': 123456})
    response = client.post('/api/budget/copy', json={'scope': 'household', 'from_month': '2026-10', 'to_month': '2026-11'})
    assert response.status_code == 201
    assert income(client, '2026-11')['total_cents'] == 123456
    assert len(income(client, '2026-11')['entries']) == 1


def test_income_privacy_all_mutations_and_shared_aggregate(home):
    _, client = home
    owner = dict(client.headers)
    client.post('/api/members', json={'username': 'member', 'display_name': 'Member', 'password': 'another-long-password'})
    login = client.post('/api/auth/login', json={'username': 'member', 'password': 'another-long-password'})
    member = {'Authorization': 'Bearer ' + login.json()['token']}
    created = client.post('/api/income/sources?scope=personal&month=2026-10', json={'name': 'Private employer', 'amount_cents': 10000, 'cadence': 'weekly', 'anchor_date': '2026-10-02'})
    assert created.status_code == 201
    sid = created.json()['id']
    eid = income(client, scope='personal')['entries'][0]['id']
    for scope, headers in [('personal', member), ('household', member), ('household', owner)]:
        assert client.patch(f'/api/income/sources/{sid}?scope={scope}', headers=headers, json={'amount_cents': 1}).status_code == 404
        assert client.delete(f'/api/income/sources/{sid}?scope={scope}', headers=headers).status_code == 404
        assert client.post(f'/api/income/sources/{sid}/restore-skipped?scope={scope}', headers=headers).status_code == 404
        assert client.patch(f'/api/income/entries/{eid}?scope={scope}', headers=headers, json={'amount_cents': 1}).status_code == 404
        assert client.delete(f'/api/income/entries/{eid}?scope={scope}', headers=headers).status_code == 404
        assert client.post(f'/api/income/entries/{eid}/reset?scope={scope}', headers=headers).status_code == 404
    assert income(client, scope='personal', headers=member)['entries'] == []
    client.patch('/api/settings', json={'share_personal_totals': True})
    response = client.get('/api/dashboard?scope=household&month=2026-10', headers=member)
    assert response.json()['shared_personal']['income_cents'] == 50000
    assert response.json()['income_cents'] == 50000
    assert 'Private employer' not in response.text and '2026-10-02' not in response.text


def test_manual_zero_and_invalid_schedule_dates_validate(home):
    _, client = home
    row = client.post('/api/income/entries?month=2026-10', json={'name': 'Not this month', 'amount_cents': 0}).json()
    assert row['date'] is None and row['amount_cents'] == 0
    assert income(client)['total_cents'] == 0 and len(income(client)['entries']) == 1
    base = {'name': 'Invalid', 'amount_cents': 10000, 'cadence': 'semimonthly', 'anchor_date': '2026-10-01'}
    assert client.post('/api/income/sources?month=2026-10', json={**base, 'day1': 15, 'day2': 15}).status_code == 422
    assert client.post('/api/income/sources?month=2026-10', json={**base, 'day1': 32}).status_code == 422
    assert client.post('/api/income/sources?month=2026-09', json=base).status_code == 422


def test_concurrent_projection_and_schedule_edit_do_not_recreate_stale_income(home):
    _, client = home
    sid = source(client)
    barrier = Barrier(6)

    def read_month():
        barrier.wait()
        return client.get('/api/income?month=2026-11')

    def edit_schedule():
        barrier.wait()
        return client.patch(f'/api/income/sources/{sid}?month=2026-11', json={'amount_cents': 25000, 'effective_from': '2026-11-01'})

    with ThreadPoolExecutor(max_workers=6) as workers:
        pending = [workers.submit(read_month) for _ in range(5)] + [workers.submit(edit_schedule)]
        assert all(operation.result(timeout=15).status_code == 200 for operation in pending)
    result = income(client, '2026-11')
    assert result['total_cents'] == 50000
    assert len(result['entries']) == 2
    assert all(row['amount_cents'] == 25000 for row in result['entries'])


def test_stopped_future_only_source_keeps_override_visible_and_can_resume(home):
    _, client = home
    sid = source(client, effective_from='2026-11-01')
    first = income(client, '2026-11')['entries'][0]
    client.patch(f"/api/income/entries/{first['id']}", json={'amount_cents': 777})
    assert client.delete(f'/api/income/sources/{sid}?effective_from=2026-11-01').status_code == 204
    stopped = income(client, '2026-11')
    assert stopped['total_cents'] == 777
    assert stopped['sources'][0]['id'] == sid and not stopped['sources'][0]['active']
    assert stopped['sources'][0]['stopped_from'] == '2026-11-01'
    resumed = client.patch(f'/api/income/sources/{sid}', json={'effective_from': '2026-12-01', 'amount_cents': 20000})
    assert resumed.status_code == 200
    assert income(client, '2026-11')['total_cents'] == 777
    assert income(client, '2026-12')['total_cents'] == 40000


def test_cadence_change_cannot_duplicate_existing_paycheck_override(home):
    _, client = home
    sid = source(client, cadence='monthly', anchor_date='2026-10-01')
    first = income(client, '2026-11')['entries'][0]
    client.patch(f"/api/income/entries/{first['id']}", json={'amount_cents': 777})
    patch = client.patch(f'/api/income/sources/{sid}?month=2026-11', json={
        'cadence': 'biweekly', 'anchor_date': '2026-11-01', 'effective_from': '2026-11-01',
    })
    assert patch.status_code == 409
    assert income(client, '2026-11')['total_cents'] == 777
    assert len(income(client, '2026-11')['entries']) == 1
    client.post(f"/api/income/entries/{first['id']}/reset")
    assert client.patch(f'/api/income/sources/{sid}?month=2026-11', json={
        'cadence': 'biweekly', 'anchor_date': '2026-11-01', 'effective_from': '2026-11-01',
    }).status_code == 200
    assert income(client, '2026-11')['total_cents'] == 30000


def test_changing_earlier_revision_cannot_duplicate_later_revision_override(home):
    _, client = home
    sid = source(client, cadence='weekly')
    assert client.patch(f'/api/income/sources/{sid}?month=2026-12', json={
        'cadence': 'monthly', 'anchor_date': '2026-12-04', 'effective_from': '2026-12-01',
    }).status_code == 200
    december = income(client, '2026-12')['entries'][0]
    client.patch(f"/api/income/entries/{december['id']}", json={'amount_cents': 777})
    response = client.patch(f'/api/income/sources/{sid}?month=2026-11', json={
        'cadence': 'weekly', 'anchor_date': '2026-10-02', 'effective_from': '2026-11-01',
    })
    assert response.status_code == 409
    assert income(client, '2026-12')['total_cents'] == 777
    assert len(income(client, '2026-12')['entries']) == 1


def test_cadence_change_cannot_silently_restore_deleted_paycheck(home):
    _, client = home
    sid = source(client, cadence='monthly', anchor_date='2026-10-01')
    november = income(client, '2026-11')['entries'][0]
    client.delete(f"/api/income/entries/{november['id']}")
    assert income(client, '2026-11')['total_cents'] == 0
    response = client.patch(f'/api/income/sources/{sid}?month=2026-11', json={
        'cadence': 'biweekly', 'anchor_date': '2026-11-01', 'effective_from': '2026-11-01',
    })
    assert response.status_code == 409
    assert income(client, '2026-11')['entries'] == []
    assert income(client)['sources'][0]['skipped_count'] == 1
    restored = client.post(f'/api/income/sources/{sid}/restore-skipped?month=2026-11')
    assert restored.status_code == 200 and restored.json()['restored_count'] == 1
    assert income(client, '2026-11')['total_cents'] == 10000
    assert income(client)['sources'][0]['skipped_count'] == 0
    assert client.patch(f'/api/income/sources/{sid}?month=2026-11', json={
        'cadence': 'biweekly', 'anchor_date': '2026-11-01', 'effective_from': '2026-11-01',
    }).status_code == 200
    assert income(client, '2026-11')['total_cents'] == 30000
