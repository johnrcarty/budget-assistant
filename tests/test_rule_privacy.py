"""Rule access follows budget ownership, not aggregate sharing or HA tokens."""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app, password_hash
from backend.database import connect


MONTH = '2026-10'


@pytest.fixture
def rule_home(tmp_path, monkeypatch):
    monkeypatch.setenv('BUDGET_AUTH_MODE', 'local')
    monkeypatch.setenv('BUDGET_LOCAL_AUTH', 'true')
    monkeypatch.setenv('BUDGET_DEMO', '0')
    app = create_app(tmp_path, today=lambda zone: date(2026, 10, 4))
    with TestClient(app) as client:
        response = client.post('/api/auth/setup', json={
            'username': 'owner', 'display_name': 'Owner',
            'password': 'long-owner-password', 'household_name': 'Rule home',
        })
        assert response.status_code == 201, response.text
        owner = {'Authorization': 'Bearer ' + response.json()['token']}
        response = client.post('/api/members', headers=owner, json={
            'username': 'member', 'display_name': 'Member',
            'password': 'long-member-password',
        })
        assert response.status_code == 201, response.text
        # Exercise actual household membership in addition to personal ownership.
        with connect(app.state.db_path) as db:
            household = db.execute(
                "INSERT INTO households(name,timezone) VALUES ('Other home','America/New_York')"
            ).lastrowid
            db.execute('''INSERT INTO users(username,display_name,password_hash,household_id,is_admin)
                          VALUES (?,?,?,?,1)''',
                       ('outsider', 'Outsider', password_hash('long-outside-password'), household))
        identities = []
        for username, password in [('member', 'long-member-password'),
                                   ('outsider', 'long-outside-password')]:
            response = client.post('/api/auth/login', json={
                'username': username, 'password': password,
            })
            assert response.status_code == 200, response.text
            identities.append({'Authorization': 'Bearer ' + response.json()['token']})
        yield client, owner, *identities


def params(scope='household'):
    return {'scope': scope, 'month': MONTH}


def target(client, headers, scope='household', name='Groceries', group='Food'):
    response = client.post('/api/budget/items', headers=headers, params=params(scope), json={
        'name': name, 'group_name': group, 'planned_cents': 9000,
    })
    assert response.status_code == 201, response.text
    return response.json()


def purchase(client, headers, scope='household', manual=False):
    body = {'description': 'Private merchant purchase', 'amount_cents': -1200,
            'date': '2026-10-04'}
    if manual:
        body['category_id'] = None
    response = client.post('/api/transactions', headers=headers, params=params(scope), json=body)
    assert response.status_code == 201, response.text
    return response.json()


def rule_body(item_id, name='Private merchant rule'):
    return {'name': name, 'merchant_text': 'Private merchant', 'match_type': 'contains',
            'direction': 'outflow', 'budget_item_id': item_id, 'active': True}


def rule(client, headers, item, scope='household'):
    response = client.post('/api/categorization/rules', headers=headers, params=params(scope),
                           json=rule_body(item['id']))
    assert response.status_code == 201, response.text
    return response.json()


def preview(client, headers, scope='household'):
    response = client.post('/api/categorization/preview', headers=headers, params=params(scope),
                           json={'month': MONTH})
    assert response.status_code == 200, response.text
    return response.json()


def test_household_members_share_rules_but_other_households_cannot_use_them(rule_home):
    client, owner, member, outsider = rule_home
    item = target(client, owner)
    transaction = purchase(client, owner)
    saved = rule(client, owner, item)
    response = client.get('/api/categorization/rules', headers=member, params=params())
    assert response.status_code == 200
    assert [row['id'] for row in response.json()] == [saved['id']]
    response = client.patch(f"/api/categorization/rules/{saved['id']}", headers=member,
                            params=params(), json={'name': 'Household edited rule'})
    assert response.status_code == 200
    assert response.json()['name'] == 'Household edited rule'
    reviewed = preview(client, owner)
    assert reviewed['matches'][0]['transaction_id'] == transaction['id']
    # Household ownership allows a different member to apply its reviewed token.
    response = client.post('/api/categorization/apply', headers=member, params=params(),
                           json={'preview_token': reviewed['preview_token']})
    assert response.status_code == 200
    assert response.json()['applied'] == 1

    response = client.get('/api/categorization/rules', headers=outsider, params=params())
    assert response.status_code == 200 and response.json() == []
    assert preview(client, outsider)['matches'] == []
    assert client.patch(f"/api/categorization/rules/{saved['id']}", headers=outsider,
                        params=params(), json={'active': False}).status_code == 404
    assert client.delete(f"/api/categorization/rules/{saved['id']}", headers=outsider,
                         params=params()).status_code == 404
    assert client.post('/api/categorization/rules', headers=outsider, params=params(),
                       json=rule_body(item['id'])).status_code == 404


def test_personal_rule_targets_tokens_and_reset_remain_owner_scoped(rule_home):
    client, owner, member, outsider = rule_home
    item = target(client, owner, 'personal', 'Private lessons', 'Private music')
    transaction = purchase(client, owner, 'personal')
    locked = purchase(client, owner, 'personal', manual=True)
    saved = rule(client, owner, item, 'personal')
    reviewed = preview(client, owner, 'personal')
    assert [row['transaction_id'] for row in reviewed['matches']] == [transaction['id']]
    assert reviewed['counts']['protected_manual'] == 1

    for headers, scope in [(member, 'personal'), (member, 'household'),
                           (outsider, 'personal'), (owner, 'household')]:
        query = params(scope) | {'owner_id': 1}
        response = client.get('/api/categorization/rules', headers=headers, params=query)
        assert response.status_code == 200 and response.json() == []
        assert client.patch(f"/api/categorization/rules/{saved['id']}", headers=headers,
                            params=query, json={'name': 'Leaked edit'}).status_code == 404
        assert client.delete(f"/api/categorization/rules/{saved['id']}", headers=headers,
                             params=query).status_code == 404
        assert client.post('/api/categorization/rules', headers=headers, params=query,
                           json=rule_body(item['id'])).status_code == 404
        assert client.post('/api/categorization/rules/reorder', headers=headers, params=query,
                           json={'rule_ids': [saved['id']]}).status_code == 409
        assert client.post('/api/categorization/apply', headers=headers, params=query,
                           json={'preview_token': reviewed['preview_token']}).status_code == 404
        assert client.post(f"/api/transactions/{locked['id']}/categorization/reset",
                           headers=headers, params=query).status_code == 404
        denied_preview = preview(client, headers, scope)
        assert denied_preview['matches'] == denied_preview['skipped'] == []

    # Rule PATCH also validates newly selected target/account IDs against ownership.
    member_item = target(client, member, 'personal', 'Member plan')
    member_rule = rule(client, member, member_item, 'personal')
    assert client.patch(f"/api/categorization/rules/{member_rule['id']}", headers=member,
                        params=params('personal'), json={'budget_item_id': item['id']}).status_code == 404
    account = client.post('/api/accounts', headers=owner, params=params('personal'), json={
        'name': 'Private checking', 'kind': 'checking', 'currency': 'USD',
    })
    assert account.status_code == 201
    assert client.patch(f"/api/categorization/rules/{member_rule['id']}", headers=member,
                        params=params('personal'), json={'account_id': account.json()['id']}).status_code == 404
    retained = client.get('/api/categorization/rules', headers=owner,
                          params=params('personal')).json()
    assert retained[0]['name'] == saved['name'] and retained[0]['active'] is True
    # Denied applies do not consume or invalidate the owner's unchanged preview.
    response = client.post('/api/categorization/apply', headers=owner, params=params('personal'),
                           json={'preview_token': reviewed['preview_token']})
    assert response.status_code == 200 and response.json()['applied'] == 1
    rows = client.get('/api/transactions', headers=owner, params=params('personal')).json()
    protected = next(row for row in rows if row['id'] == locked['id'])
    assert protected['category_id'] is None and protected['manual_category_lock'] is True


def test_sharing_aggregate_amounts_does_not_share_rule_or_transaction_metadata(rule_home):
    client, owner, member, _ = rule_home
    item = target(client, owner, 'personal', 'Private lessons', 'Private music')
    rule(client, owner, item, 'personal')
    transaction = purchase(client, owner, 'personal')
    assert transaction['category_id'] == item['id']
    response = client.patch('/api/settings', headers=owner, json={'share_personal_totals': True})
    assert response.status_code == 200
    dashboard = client.get('/api/dashboard', headers=member, params=params())
    assert dashboard.status_code == 200
    assert dashboard.json()['shared_personal'] == {
        'income_cents': 0, 'planned_cents': 9000, 'spent_cents': 1200, 'contributors': 1,
    }
    public_rules = client.get('/api/categorization/rules', headers=member, params=params())
    assert public_rules.status_code == 200 and public_rules.json() == []
    public_preview = preview(client, member)
    assert public_preview['matches'] == public_preview['skipped'] == []
    for secret in ('Private lessons', 'Private music', 'Private merchant',
                   'categorization_rule_id', 'budget_item_lineage_id'):
        assert secret not in dashboard.text
    own_rules = client.get('/api/categorization/rules', headers=owner,
                           params=params('personal')).json()
    assert len(own_rules) == 1 and own_rules[0]['target_name'] == 'Private lessons'


def test_home_assistant_machine_token_cannot_read_or_mutate_categorization(rule_home):
    client, owner, _, _ = rule_home
    item = target(client, owner)
    purchase(client, owner)
    locked = purchase(client, owner, manual=True)
    saved = rule(client, owner, item)
    reviewed = preview(client, owner)
    response = client.post('/api/integrations/ha-token', headers=owner)
    assert response.status_code == 200
    machine = {'Authorization': 'Bearer ' + response.json()['token']}
    assert client.get('/api/ha/bills', headers=machine).status_code == 200
    calls = [
        ('GET', '/api/categorization/rules', None),
        ('POST', '/api/categorization/rules', rule_body(item['id'])),
        ('PATCH', f"/api/categorization/rules/{saved['id']}", {'active': False}),
        ('DELETE', f"/api/categorization/rules/{saved['id']}", None),
        ('POST', '/api/categorization/rules/reorder', {'rule_ids': [saved['id']]}),
        ('POST', '/api/categorization/preview', {'month': MONTH}),
        ('POST', '/api/categorization/apply', {'preview_token': reviewed['preview_token']}),
        ('POST', f"/api/transactions/{locked['id']}/categorization/reset", None),
    ]
    for method, path, body in calls:
        response = client.request(method, path, headers=machine, params=params(), json=body)
        assert response.status_code == 401, (method, path, response.text)
    retained = client.get('/api/categorization/rules', headers=owner, params=params()).json()
    assert len(retained) == 1 and retained[0]['active'] is True
    response = client.post('/api/categorization/apply', headers=owner, params=params(),
                           json={'preview_token': reviewed['preview_token']})
    assert response.status_code == 200 and response.json()['applied'] == 1
