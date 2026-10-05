"""Regression checks for identity trust and personal-budget isolation."""
from datetime import date

from fastapi.testclient import TestClient
import pytest

from backend.app import create_app


@pytest.fixture
def local_home(tmp_path, monkeypatch):
    monkeypatch.setenv('BUDGET_AUTH_MODE', 'local')
    monkeypatch.setenv('BUDGET_LOCAL_AUTH', 'true')
    monkeypatch.setenv('BUDGET_DEMO', '0')
    app = create_app(tmp_path, today=lambda zone: date(2026, 10, 4))
    with TestClient(app) as client:
        response = client.post('/api/auth/setup', json={
            'username': 'owner', 'display_name': 'Owner',
            'password': 'long-owner-password', 'household_name': 'Test home',
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
        yield client, owner, member


@pytest.mark.parametrize('collection,payload,patch', [
    ('budget/items', {'name': 'Private hobby', 'group_name': 'Private group', 'planned_cents': 1234}, {'planned_cents': 9999}),
    ('bills', {'name': 'Private provider', 'amount_cents': 1234, 'due_date': '2026-10-04'}, {'paid': True}),
    ('transactions', {'description': 'Private merchant', 'amount_cents': -1234, 'date': '2026-10-04'}, {'description': 'Changed'}),
    ('accounts', {'name': 'Private savings', 'balance_cents': 1234}, {'balance_cents': 9999}),
])
def test_guessed_personal_ids_cannot_be_mutated_or_recast_as_household(local_home, collection, payload, patch):
    client, owner, member = local_home
    response = client.post('/api/' + collection, params={'scope': 'personal'}, headers=owner, json=payload)
    assert response.status_code == 201
    item_id = response.json()['id']
    path = f'/api/{collection}/{item_id}'
    for headers, scope in ((member, 'personal'), (member, 'household'), (owner, 'household')):
        assert client.patch(path, params={'scope': scope}, headers=headers, json=patch).status_code == 404
        assert client.delete(path, params={'scope': scope}, headers=headers).status_code == 404
    # Unrecognised owner_id query parameters cannot select someone else's scope.
    visible = client.get('/api/' + collection, params={
        'scope': 'personal', 'month': '2026-10', 'owner_id': 1,
    }, headers=member)
    assert visible.status_code == 200
    assert all(row['id'] != item_id for row in visible.json())


def test_foreign_category_assignment_is_rejected_and_existing_transaction_survives(local_home):
    client, owner, member = local_home
    category = client.post('/api/budget/items', params={'scope': 'personal', 'month': '2026-10'},
                           headers=owner, json={'name': 'Secret category', 'group_name': 'Secret group'}).json()['id']
    payload = {'description': 'Member purchase', 'amount_cents': -500, 'date': '2026-10-04', 'category_id': category}
    assert client.post('/api/transactions', params={'scope': 'personal'}, headers=member, json=payload).status_code == 404
    payload.pop('category_id')
    transaction = client.post('/api/transactions', params={'scope': 'personal'}, headers=member, json=payload).json()['id']
    assert client.patch(f'/api/transactions/{transaction}', params={'scope': 'personal'}, headers=member,
                        json={'category_id': category}).status_code == 404
    rows = client.get('/api/transactions', params={'scope': 'personal', 'month': '2026-10'}, headers=member).json()
    assert rows[0]['category_id'] is None
    assert rows[0]['description'] == 'Member purchase'


def test_machine_token_is_household_only_scoped_and_rotatable(local_home):
    client, owner, member = local_home
    assert client.post('/api/integrations/ha-token', headers=member).status_code == 403
    private = {'name': 'Private medical provider', 'amount_cents': 9000, 'due_date': '2026-10-04'}
    client.post('/api/bills', params={'scope': 'personal'}, headers=owner, json=private)
    client.post('/api/bills', headers=owner, json={**private, 'name': 'Household bill', 'amount_cents': 4500})
    first_token = client.post('/api/integrations/ha-token', headers=owner).json()['token']
    machine = {'Authorization': 'Bearer ' + first_token}
    result = client.get('/api/ha/bills', headers=machine)
    assert result.status_code == 200
    assert result.json()['today'] == {'count': 1, 'total_cents': 4500}
    assert 'Private medical provider' not in result.text and 'Household bill' not in result.text
    assert client.get('/api/ha/bills', headers=owner).status_code == 401
    for path in ('/api/me', '/api/settings', '/api/members', '/api/dashboard', '/api/accounts'):
        assert client.get(path, headers=machine).status_code == 401
    second_token = client.post('/api/integrations/ha-token', headers=owner).json()['token']
    assert first_token != second_token
    assert client.get('/api/ha/bills', headers=machine).status_code == 401
    assert client.get('/api/ha/bills', headers={'Authorization': 'Bearer ' + second_token}).status_code == 200


def test_shared_totals_can_be_revoked_without_item_leakage(local_home):
    client, owner, member = local_home
    client.post('/api/budget/items', params={'scope': 'personal', 'month': '2026-10'}, headers=owner,
                json={'name': 'Private violin lessons', 'group_name': 'Private instruments', 'planned_cents': 8765})
    client.post('/api/transactions', params={'scope': 'personal'}, headers=owner,
                json={'description': 'Secret merchant', 'amount_cents': -1234, 'date': '2026-10-04'})
    client.patch('/api/settings', headers=owner, json={'share_personal_totals': True})
    response = client.get('/api/dashboard', params={'scope': 'household', 'month': '2026-10'}, headers=member)
    assert response.json()['shared_personal']['planned_cents'] == 8765
    assert response.json()['shared_personal']['spent_cents'] == 1234
    for secret in ('Private violin lessons', 'Private instruments', 'Secret merchant'):
        assert secret not in response.text
    client.patch('/api/settings', headers=owner, json={'share_personal_totals': False})
    response = client.get('/api/dashboard', params={'scope': 'household', 'month': '2026-10'}, headers=member)
    assert response.json()['shared_personal'] == {
        'income_cents': 0, 'planned_cents': 0, 'spent_cents': 0, 'contributors': 0,
    }


def ingress_app(tmp_path, monkeypatch):
    monkeypatch.setenv('BUDGET_AUTH_MODE', 'ingress')
    monkeypatch.setenv('BUDGET_LOCAL_AUTH', 'false')
    monkeypatch.setenv('BUDGET_DEMO', '0')
    monkeypatch.setenv('BUDGET_INGRESS_PROXY', '172.30.32.2')
    return create_app(tmp_path, today=lambda zone: date(2026, 10, 4))


def test_ingress_cannot_invent_admin_claims_or_legacy_identity(tmp_path, monkeypatch):
    app = ingress_app(tmp_path, monkeypatch)
    with TestClient(app, client=('172.30.32.2', 50000)) as client:
        assert client.get('/api/me', headers={'X-Remote-User-Id': 'initial-ha-user'}).json()['is_admin'] is True
        response = client.get('/api/me', headers={
            'X-Remote-User-Id': 'second-ha-user',
            'X-Remote-User-Is-Admin': 'true', 'X-Hass-Is-Admin': 'true',
        })
        assert response.status_code == 200
        assert response.json()['is_admin'] is False
        assert client.post('/api/integrations/ha-token', headers={
            'X-Remote-User-Id': 'second-ha-user', 'X-Remote-User-Is-Admin': 'true',
        }).status_code == 403
        assert client.get('/api/me', headers={'X-Hass-User-Id': 'initial-ha-user'}).status_code == 401


def test_ingress_checks_socket_peer_instead_of_forwarded_headers(tmp_path, monkeypatch):
    app = ingress_app(tmp_path, monkeypatch)
    with TestClient(app, client=('172.30.32.2', 50000)) as supervisor:
        assert supervisor.get('/api/me', headers={'X-Remote-User-Id': 'real-ha-user'}).status_code == 200
    with TestClient(app, client=('192.168.1.55', 50000)) as direct:
        response = direct.get('/api/me', headers={
            'X-Remote-User-Id': 'real-ha-user',
            'X-Forwarded-For': '172.30.32.2', 'Forwarded': 'for=172.30.32.2',
        })
        assert response.status_code == 401
        assert direct.post('/api/auth/setup', json={
            'username': 'attacker', 'display_name': 'Attacker', 'password': 'long-attacker-password',
        }).status_code == 403
