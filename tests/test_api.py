"""Calendar recurrence, authentication, and local-server regressions."""
import json
from datetime import date, datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.database import connect


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv('BUDGET_AUTH_MODE', 'local')
    monkeypatch.setenv('BUDGET_LOCAL_AUTH', 'true')
    monkeypatch.setenv('BUDGET_DEMO', '0')
    app = create_app(tmp_path, today=lambda zone: date(2026, 10, 7))
    with TestClient(app) as client:
        login = client.post('/api/auth/setup', json={
            'username': 'owner', 'display_name': 'Owner', 'password': 'a-good-long-password',
            'household_name': 'Test household', 'timezone': 'America/New_York',
        })
        assert login.status_code == 201
        client.headers['Authorization'] = 'Bearer ' + login.json()['token']
        yield app, client


def add_bill(client, due, **changes):
    response = client.post('/api/bills', json={
        'name': 'Test bill', 'amount_cents': 1234, 'due_date': due, **changes,
    })
    assert response.status_code == 201
    return response.json()['id']


def test_bill_buckets_are_disjoint_and_exclude_paid_or_private(home):
    app, client = home
    for due in ('2026-10-06', '2026-10-07', '2026-10-08', '2026-10-11', '2026-10-12', '2026-10-18', '2026-10-19'):
        add_bill(client, due)
    add_bill(client, '2026-10-07', paid=True)
    client.post('/api/bills?scope=personal', json={'name': 'Private', 'amount_cents': 5000, 'due_date': '2026-10-07'})
    token = client.post('/api/integrations/ha-token').json()['token']
    summary = client.get('/api/ha/bills', headers={'Authorization': 'Bearer ' + token}).json()
    assert [summary[key]['count'] for key in ('past_due', 'today', 'this_week', 'next_week')] == [1, 1, 2, 2]
    assert summary['this_week']['total_cents'] == 2468
    assert summary['boundary_dates'] == {'today': '2026-10-07', 'this_week_end': '2026-10-11', 'next_week_start': '2026-10-12', 'next_week_end': '2026-10-18'}


def test_unpaid_recurrence_materializes_clamped_days_without_duplicates(home):
    app, client = home
    app.state.today = lambda zone: date(2026, 3, 20)
    january = add_bill(client, '2026-01-31', recurrence='monthly')
    rows = client.get('/api/bills').json()
    assert [row['due_date'] for row in rows] == ['2026-01-31', '2026-02-28', '2026-03-31']
    assert not any(row['paid'] for row in rows)
    assert client.patch(f'/api/bills/{january}', json={'paid': True}).status_code == 200
    assert len(client.get('/api/bills').json()) == 3
    assert len(client.get('/api/bills').json()) == 3


def test_ha_read_materializes_next_month_when_previous_bill_is_unpaid(home):
    app, client = home
    app.state.today = lambda zone: date(2026, 10, 28)
    add_bill(client, '2026-09-02', recurrence='monthly')
    token = client.post('/api/integrations/ha-token').json()['token']
    summary = client.get('/api/ha/bills', headers={'Authorization': 'Bearer ' + token}).json()
    assert summary['past_due']['count'] == 2
    assert summary['next_week']['count'] == 1  # Nov 2 generated despite Sept/Oct unpaid
    assert [row['due_date'] for row in client.get('/api/bills').json()] == ['2026-09-02', '2026-10-02', '2026-11-02']


def test_monthly_edits_update_future_unpaid_but_keep_paid_history(home):
    app, client = home
    app.state.today = lambda zone: date(2026, 3, 20)
    january = add_bill(client, '2026-01-31', recurrence='monthly', paid=True)
    rows = client.get('/api/bills').json()
    february = next(row['id'] for row in rows if row['due_date'] == '2026-02-28')
    assert client.patch(f'/api/bills/{february}', json={
        'name': 'Updated bill', 'amount_cents': 2500, 'autopay': True, 'due_date': '2026-02-25',
    }).status_code == 200
    rows = client.get('/api/bills').json()
    january_row = next(row for row in rows if row['id'] == january)
    assert january_row['due_date'] == '2026-01-31' and january_row['amount_cents'] == 1234
    future = next(row for row in rows if row['due_date'] == '2026-03-25')
    assert future['name'] == 'Updated bill' and future['amount_cents'] == 2500 and future['autopay']


def test_full_form_edit_on_clamped_occurrence_preserves_original_day(home):
    app, client = home
    app.state.today = lambda zone: date(2026, 3, 20)
    add_bill(client, '2026-01-31', recurrence='monthly')
    rows = client.get('/api/bills').json()
    february = next(row['id'] for row in rows if row['due_date'] == '2026-02-28')
    response = client.patch(f'/api/bills/{february}', json={
        'name': 'New name', 'amount_cents': 2500, 'autopay': True,
        'due_date': '2026-02-28', 'recurrence': 'monthly', 'paid': False,
    })
    assert response.status_code == 200
    rows = client.get('/api/bills').json()
    march = next(row for row in rows if row['due_date'] == '2026-03-31')
    assert march['name'] == 'New name' and march['amount_cents'] == 2500


@pytest.mark.parametrize('method', ['cancel', 'delete'])
def test_cancel_or_delete_stops_series_and_preserves_other_history(home, method):
    app, client = home
    app.state.today = lambda zone: date(2026, 3, 20)
    january = add_bill(client, '2026-01-31', recurrence='monthly', paid=True)
    rows = client.get('/api/bills').json()
    february = next(row['id'] for row in rows if row['due_date'] == '2026-02-28')
    if method == 'cancel':
        assert client.patch(f'/api/bills/{february}', json={'recurrence': 'none'}).status_code == 200
    else:
        assert client.delete(f'/api/bills/{february}').status_code == 204
    app.state.today = lambda zone: date(2026, 6, 20)
    rows = client.get('/api/bills').json()
    assert any(row['id'] == january and row['paid'] for row in rows)
    assert not any(row['due_date'] >= '2026-03-01' for row in rows)
    assert all(row['recurrence'] == 'none' for row in rows)


def test_last_calendar_month_paid_does_not_overflow(home):
    _, client = home
    final = add_bill(client, '9999-12-31', recurrence='monthly')
    assert client.patch(f'/api/bills/{final}', json={'paid': True}).status_code == 200


def test_expired_jwt_and_repeat_setup_fail(home):
    app, client = home
    claims = {'sub': '1', 'iat': datetime.now(timezone.utc) - timedelta(days=2),
              'exp': datetime.now(timezone.utc) - timedelta(days=1),
              'iss': 'budget-assistant', 'aud': 'budget-assistant-users'}
    expired = jwt.encode(claims, app.state.secret, algorithm='HS256')
    assert client.get('/api/me', headers={'Authorization': 'Bearer ' + expired}).status_code == 401
    assert client.post('/api/auth/setup', json={'username': 'another', 'display_name': 'Another', 'password': 'another-good-password'}).status_code == 409
    with connect(app.state.db_path) as db:
        saved = db.execute('SELECT password_hash FROM users WHERE id=1').fetchone()[0]
        assert saved.startswith('scrypt$') and 'a-good-long-password' not in saved


def test_settings_warnings_are_sanitized_and_scope_filtered(home):
    app, client = home
    with connect(app.state.db_path) as db:
        db.execute("INSERT INTO integration_state(household_id,owner_id,scope,credential,warnings) VALUES (1,0,'household','secret-credential',?)",
                   (json.dumps(['Reconnect at https://user:secret@bridge.simplefin.org/path <tag>']),))
        db.execute("INSERT INTO integration_state(household_id,owner_id,scope,warnings) VALUES (1,1,'personal',?)", (json.dumps(['Personal notice']),))
    response = client.get('/api/settings')
    assert response.json()['warnings'] == ['Reconnect at [link removed] tag']
    assert 'secret' not in response.text and 'Personal notice' not in response.text


def test_demo_entrance_never_requires_setup_or_touches_live_db(tmp_path, monkeypatch):
    monkeypatch.setenv('BUDGET_AUTH_MODE', 'local')
    monkeypatch.setenv('BUDGET_LOCAL_AUTH', 'true')
    monkeypatch.setenv('BUDGET_DEMO', '1')
    app = create_app(tmp_path, today=lambda zone: date(2026, 10, 7))
    with TestClient(app) as client:
        assert client.get('/api/auth/status').json()['setup_required'] is False
        login = client.post('/api/auth/demo')
        assert login.status_code == 200
        client.headers['Authorization'] = 'Bearer ' + login.json()['token']
        assert client.get('/api/dashboard?month=2026-10').status_code == 200
        assert not (tmp_path / 'budget.sqlite3').exists()


def test_optional_local_fallback_in_ingress_requires_explicit_enable(tmp_path, monkeypatch):
    monkeypatch.setenv('BUDGET_AUTH_MODE', 'ingress')
    monkeypatch.setenv('BUDGET_LOCAL_AUTH', 'true')
    monkeypatch.setenv('BUDGET_DEMO', '0')
    app = create_app(tmp_path)
    with TestClient(app) as client:
        login = client.post('/api/auth/setup', json={'username': 'fallback', 'display_name': 'Owner', 'password': 'a-good-long-password'})
        assert login.status_code == 201
        assert client.get('/api/me', headers={'Authorization': 'Bearer ' + login.json()['token']}).status_code == 200
