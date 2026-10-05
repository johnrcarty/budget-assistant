"""Paycheck receipts stay separate from plans, scoped, and safe across bank sync."""
from datetime import date
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import importlib
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
        login = client.post('/api/auth/setup', json={'username': 'owner', 'display_name': 'Owner', 'password': 'a-good-long-password'})
        assert login.status_code == 201
        client.headers['Authorization'] = 'Bearer ' + login.json()['token']
        yield tmp_path / 'budget.sqlite3', client


def entry(client, scope='household', **changes):
    response = client.post('/api/income/entries?scope=' + scope + '&month=2026-10', json={
        'name': 'Paycheck', 'amount_cents': 10000, 'date': '2026-10-09', **changes})
    assert response.status_code == 201, response.text
    return response.json()


def transaction(client, scope='household', **changes):
    response = client.post('/api/transactions?scope=' + scope, json={
        'description': 'Payroll deposit', 'amount_cents': 9500, 'date': '2026-10-08', **changes})
    assert response.status_code == 201, response.text
    return response.json()


def assign(client, transaction_id, **payload):
    return client.put(f'/api/transactions/{transaction_id}/income', json=payload)


def income(client):
    response = client.get('/api/income?month=2026-10')
    assert response.status_code == 200, response.text
    return response.json()


def test_receipts_are_independent_from_plan_pending_and_month_boundary(home):
    _, client = home
    planned = entry(client)
    first = transaction(client, date='2026-09-30', amount_cents=6000)
    second = transaction(client, pending=True, amount_cents=3500)
    for deposit in (first, second):
        response = assign(client, deposit['id'], entry_id=planned['id'])
        assert response.status_code == 200, response.text
        assert response.json()['income_name'] == 'Paycheck'
        assert response.json()['income_month'] == '2026-10'
    result = income(client)
    assert result['total_cents'] == 10000
    assert result['total_actual_received_cents'] == 6000
    assert result['total_pending_received_cents'] == 3500
    assert result['entries'][0]['amount_cents'] == 10000
    assert result['entries'][0]['date'] == '2026-10-09'
    assert len(result['entries'][0]['linked_transactions']) == 2
    assert client.patch(f"/api/transactions/{second['id']}", json={'pending': False}).status_code == 200
    assert income(client)['total_actual_received_cents'] == 9500
    assert assign(client, first['id'], entry_id=None).status_code == 200
    assert income(client)['total_actual_received_cents'] == 3500


def test_assignment_replacement_explicit_and_atomic_create(home):
    _, client = home
    item_response = client.post('/api/budget/items?month=2026-10', json={'name': 'Refunds', 'group_name': 'Other'})
    assert item_response.status_code == 201, item_response.text
    deposit = transaction(client, category_id=item_response.json()['id'])
    response = assign(client, deposit['id'], create_entry={'name': 'New pay', 'amount_cents': 9000})
    assert response.status_code == 409
    assert income(client)['entries'] == []  # failed create cannot leave a duplicate plan
    response = assign(client, deposit['id'], create_entry={'name': 'New pay', 'amount_cents': 9000}, replace_existing=True)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['category_id'] is None
    assert result['income_entry_id'] is not None
    another = entry(client)
    assert assign(client, deposit['id'], entry_id=another['id']).status_code == 409
    assert assign(client, deposit['id'], entry_id=another['id'], replace_existing=True).status_code == 200
    assert client.patch(f"/api/transactions/{deposit['id']}", json={'category_id': item_response.json()['id']}).status_code == 409
    assert client.patch(f"/api/transactions/{deposit['id']}", json={'amount_cents': -1}).status_code == 409
    assert client.post(f"/api/transactions/{deposit['id']}/categorization/reset").status_code == 409


def test_currency_direction_transfer_and_scope_guards(home):
    path, client = home
    planned = entry(client)
    personal = entry(client, 'personal')
    ordinary = transaction(client)
    assert assign(client, ordinary['id'], entry_id=personal['id']).status_code == 404
    assert client.put(f"/api/transactions/{ordinary['id']}/income?scope=personal", json={'entry_id': personal['id']}).status_code == 404
    negative = transaction(client, amount_cents=-100)
    assert assign(client, negative['id'], entry_id=planned['id']).status_code == 422
    transfer = transaction(client, provider_role_override='bank_transfer')
    assert assign(client, transfer['id'], entry_id=planned['id']).status_code == 409
    assert transfer['id'] not in [row['id'] for row in client.get('/api/transactions?month=2026-10').json()]
    assert transfer['id'] in [row['id'] for row in client.get('/api/transactions?month=2026-10&include_transfers=true').json()]
    assert client.patch(f"/api/transactions/{transfer['id']}", json={'provider_role_override': 'ordinary'}).status_code == 200
    assert assign(client, transfer['id'], entry_id=planned['id']).status_code == 200
    assert client.patch(f"/api/transactions/{transfer['id']}", json={'provider_role_override': 'bank_transfer'}).status_code == 409
    account = client.post('/api/accounts', json={'name': 'Euros', 'currency': 'EUR', 'kind': 'checking'}).json()
    foreign = transaction(client)
    # The importer can retain non-USD bank records even though manual entry
    # creation and account reassignment currently accept USD only.
    with connect(path) as db:
        db.execute('UPDATE transactions SET account_id=? WHERE id=?', (account['id'], foreign['id']))
    assert assign(client, foreign['id'], entry_id=planned['id']).status_code == 422
    assert client.patch(f"/api/transactions/{transfer['id']}", json={'account_id': account['id']}).status_code == 422


def test_received_schedule_entries_survive_stop_and_edit_and_require_unlink_before_delete(home):
    _, client = home
    response = client.post('/api/income/sources?month=2026-10', json={
        'name': 'Work', 'amount_cents': 10000, 'cadence': 'biweekly', 'anchor_date': '2026-10-09'})
    assert response.status_code == 201
    source_id = response.json()['id']
    planned = income(client)['entries'][0]
    deposit = transaction(client)
    assert assign(client, deposit['id'], entry_id=planned['id']).status_code == 200
    assert client.delete(f"/api/income/entries/{planned['id']}").status_code == 409
    # Same cadence edits preserve receipt identity and its original expected plan.
    response = client.patch(f'/api/income/sources/{source_id}?month=2026-10', json={'amount_cents': 11000, 'effective_from': '2026-10-01'})
    assert response.status_code == 200, response.text
    received = next(row for row in income(client)['entries'] if row['id'] == planned['id'])
    assert received['amount_cents'] == 10000
    assert received['actual_received_cents'] == 9500
    assert client.patch(f'/api/income/sources/{source_id}', json={'cadence': 'weekly', 'effective_from': '2026-10-01'}).status_code == 409
    assert client.delete(f'/api/income/sources/{source_id}?effective_from=2026-10-01').status_code == 204
    assert income(client)['entries'][0]['id'] == planned['id']
    assert income(client)['total_actual_received_cents'] == 9500
    assert assign(client, deposit['id'], entry_id=None).status_code == 200
    assert client.delete(f"/api/income/entries/{planned['id']}").status_code == 204


def test_receipt_invalid_import_keeps_link_and_can_be_cleared(home):
    path, client = home
    planned = entry(client)
    deposit = transaction(client)
    assert assign(client, deposit['id'], entry_id=planned['id']).status_code == 200
    with connect(path) as db:
        db.execute('UPDATE transactions SET amount_cents=-9500 WHERE id=?', (deposit['id'],))
    result = income(client)
    assert result['total_actual_received_cents'] == 0
    receipt = result['entries'][0]['linked_transactions'][0]
    assert receipt['income_link_invalid']
    assert receipt['income_entry_id'] == planned['id']
    assert client.get('/api/dashboard?month=2026-10').json()['spent_cents'] == 9500
    assert assign(client, deposit['id'], entry_id=None).status_code == 200


def test_legacy_replacement_protects_received_line(home):
    _, client = home
    assert client.post('/api/budget/income', json={'month': '2026-10', 'amount_cents': 10000}).status_code == 200
    legacy = income(client)['entries'][0]
    deposit = transaction(client)
    assert assign(client, deposit['id'], entry_id=legacy['id']).status_code == 200
    response = client.post('/api/income/entries?month=2026-10', json={'name': 'Other', 'amount_cents': 100, 'replace_legacy': True})
    assert response.status_code == 409
    assert income(client)['entries'][0]['id'] == legacy['id']
    assert income(client)['total_actual_received_cents'] == 9500


def test_invalid_receipt_currency_or_foreign_account_never_counts_as_usd_spending(home):
    path, client = home
    planned = entry(client)
    account = client.post('/api/accounts', json={'name': 'Payroll bank', 'kind': 'checking', 'currency': 'USD'}).json()
    deposit = transaction(client, account_id=account['id'])
    assert assign(client, deposit['id'], entry_id=planned['id']).status_code == 200
    with connect(path) as db:
        db.execute('UPDATE transactions SET amount_cents=-9500 WHERE id=?', (deposit['id'],))
    assert client.get('/api/dashboard?month=2026-10').json()['spent_cents'] == 9500
    with connect(path) as db:
        db.execute("UPDATE accounts SET currency='EUR' WHERE id=?", (account['id'],))
    assert client.get('/api/dashboard?month=2026-10').json()['spent_cents'] == 0
    assert income(client)['total_actual_received_cents'] == 0
    with connect(path) as db:
        db.execute("UPDATE accounts SET currency='USD',owner_id=1,scope='personal' WHERE id=?", (account['id'],))
    assert client.get('/api/dashboard?month=2026-10').json()['spent_cents'] == 0
    assert income(client)['entries'][0]['linked_transactions'][0]['account_unavailable']


def test_transfer_rows_do_not_affect_spending_and_restore_is_reversible(home):
    _, client = home
    deposit = transaction(client, amount_cents=-900, provider_role_override='bank_transfer')
    assert client.get('/api/dashboard?month=2026-10').json()['spent_cents'] == 0
    assert client.patch(f"/api/transactions/{deposit['id']}", json={'provider_role_override': 'ordinary'}).status_code == 200
    assert client.get('/api/dashboard?month=2026-10').json()['spent_cents'] == 900
    assert client.patch(f"/api/transactions/{deposit['id']}", json={'provider_role_override': 'bank_transfer'}).status_code == 200
    assert client.get('/api/dashboard?month=2026-10').json()['spent_cents'] == 0


def test_income_migration_is_additive_and_preserves_links(home):
    path, client = home
    planned = entry(client)
    deposit = transaction(client)
    assert assign(client, deposit['id'], entry_id=planned['id']).status_code == 200
    initialize(path)
    initialize(path)
    assert income(client)['total_actual_received_cents'] == 9500


def test_assignment_member_and_household_privacy(home):
    path, client = home
    owner_header = {'Authorization': client.headers['Authorization']}
    own = entry(client, 'personal', name='Owner salary')
    own_household = entry(client)
    assert client.post('/api/members', json={'username': 'member', 'display_name': 'Member', 'password': 'another-long-password'}).status_code == 201
    member_login = client.post('/api/auth/login', json={'username': 'member', 'password': 'another-long-password'})
    member_header = {'Authorization': 'Bearer ' + member_login.json()['token']}
    private = client.post('/api/income/entries?scope=personal&month=2026-10', headers=member_header,
                          json={'name': 'Secret employer', 'amount_cents': 12000, 'date': '2026-10-08'}).json()
    receipt = client.post('/api/transactions?scope=personal', headers=member_header,
                          json={'description': 'Secret payroll', 'amount_cents': 11500, 'date': '2026-10-08'}).json()
    response = client.put(f"/api/transactions/{receipt['id']}/income?scope=personal", headers=member_header,
                          json={'entry_id': private['id']})
    assert response.status_code == 200
    for scope in ('personal', 'household'):
        assert client.get(f"/api/transactions/{receipt['id']}?scope={scope}", headers=owner_header).status_code == 404
        for payload in ({'entry_id': own['id']}, {'entry_id': None}, {'create_entry': {'name': 'Stolen', 'amount_cents': 1}}):
            assert client.put(f"/api/transactions/{receipt['id']}/income?scope={scope}", headers=owner_header, json=payload).status_code == 404
    ordinary = transaction(client)
    assert assign(client, ordinary['id'], entry_id=private['id']).status_code == 404
    for path_query in ('/api/transactions?scope=personal&month=2026-10', '/api/income?scope=personal&month=2026-10', '/api/dashboard?month=2026-10'):
        result = client.get(path_query, headers=owner_header)
        assert result.status_code == 200
        assert 'Secret employer' not in result.text and 'Secret payroll' not in result.text
    with connect(path) as db:
        db.execute("INSERT INTO households(id,name,timezone) VALUES (2,'Elsewhere','America/New_York')")
        db.execute("INSERT INTO users(username,display_name,password_hash,household_id) VALUES ('outsider','Other',?,2)",
                   (password_hash('another-long-password'),))
    outsider_login = client.post('/api/auth/login', json={'username': 'outsider', 'password': 'another-long-password'})
    outsider_header = {'Authorization': 'Bearer ' + outsider_login.json()['token']}
    for scope in ('household', 'personal'):
        assert client.get(f"/api/transactions/{ordinary['id']}?scope={scope}", headers=outsider_header).status_code == 404
        assert client.put(f"/api/transactions/{ordinary['id']}/income?scope={scope}", headers=outsider_header,
                          json={'entry_id': own_household['id']}).status_code == 404
    assert client.get('/api/income?month=2026-10', headers=outsider_header).json()['entries'] == []
    assert client.get(f"/api/transactions/{receipt['id']}?scope=personal", headers=member_header).status_code == 200


def test_scoped_receipt_payload_sanitizes_foreign_references(home):
    path, client = home
    planned = entry(client)
    ordinary = transaction(client)
    own_bad_account = transaction(client)
    assert assign(client, own_bad_account['id'], entry_id=planned['id']).status_code == 200
    client.post('/api/members', json={'username': 'member', 'display_name': 'Member', 'password': 'another-long-password'})
    member_login = client.post('/api/auth/login', json={'username': 'member', 'password': 'another-long-password'})
    member_header = {'Authorization': 'Bearer ' + member_login.json()['token']}
    private = client.post('/api/income/entries?scope=personal&month=2026-10', headers=member_header,
                          json={'name': 'Secret employer', 'amount_cents': 12000, 'date': '2026-10-08'}).json()
    account = client.post('/api/accounts?scope=personal', headers=member_header,
                          json={'name': 'Secret bank', 'kind': 'checking', 'currency': 'USD'}).json()
    foreign_receipt = client.post('/api/transactions?scope=personal', headers=member_header,
                                  json={'description': 'Secret payroll', 'amount_cents': 11500, 'date': '2026-10-08'}).json()
    with connect(path) as db:
        db.execute('UPDATE transactions SET income_entry_id=? WHERE id=?', (private['id'], ordinary['id']))
        db.execute("UPDATE transactions SET account_id=?,account_name='Secret bank' WHERE id=?", (account['id'], own_bad_account['id']))
        db.execute('UPDATE transactions SET income_entry_id=? WHERE id=?', (planned['id'], foreign_receipt['id']))
    result = client.get('/api/transactions?month=2026-10').json()
    public_row = next(row for row in result if row['id'] == ordinary['id'])
    assert public_row['income_entry_id'] is None
    assert public_row['income_name'] is None and public_row['income_date'] is None and public_row['income_month'] is None
    single = client.get(f"/api/transactions/{ordinary['id']}").json()
    assert single['income_entry_id'] is None and single['income_name'] is None
    unknown_account = client.get(f"/api/transactions/{own_bad_account['id']}").json()
    assert unknown_account['account_id'] is None and unknown_account['account_unavailable']
    assert unknown_account['account_name'] == 'Unavailable account'
    result = income(client)
    assert result['total_actual_received_cents'] == 0
    receipt = result['entries'][0]['linked_transactions'][0]
    assert receipt['income_link_invalid'] and receipt['account_unavailable']
    assert receipt['account_id'] is None and receipt['account_name'] == 'Unavailable account'
    assert 'Secret employer' not in str(result) and 'Secret payroll' not in str(result) and 'Secret bank' not in str(result)


def test_idempotent_create_replays_lost_response_without_duplicate_plan(home):
    path, client = home
    previous = entry(client, name='Previous income')
    deposit = transaction(client)
    assert assign(client, deposit['id'], entry_id=previous['id']).status_code == 200
    payload = {'create_entry': {'name': 'New paycheck', 'amount_cents': 9600, 'date': '2026-10-09'},
               'replace_existing': True, 'idempotency_key': '28b6f551-2b13-49ad-b4f9-54db773a1d12'}
    first = assign(client, deposit['id'], **payload)
    assert first.status_code == 200, first.text
    result_id = first.json()['income_entry_id']
    # A client that lost the response retries precisely the same operation.
    retry = assign(client, deposit['id'], **payload)
    assert retry.status_code == 200, retry.text
    assert retry.json()['income_entry_id'] == result_id
    assert [row['name'] for row in income(client)['entries']].count('New paycheck') == 1
    assert income(client)['total_actual_received_cents'] == 9500
    initialize(path)
    assert assign(client, deposit['id'], **payload).json()['income_entry_id'] == result_id
    with connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM income_transaction_requests').fetchone()[0] == 1
        # A provider sign correction after acknowledgement must not make a
        # replay rewrite the original saved plan or fail before reporting it.
        db.execute('UPDATE transactions SET amount_cents=-9500 WHERE id=?', (deposit['id'],))
    retried_invalid = assign(client, deposit['id'], **payload)
    assert retried_invalid.status_code == 200
    assert retried_invalid.json()['income_link_invalid']
    assert income(client)['total_actual_received_cents'] == 0


def test_idempotency_rejects_modified_request_or_other_transaction(home):
    _, client = home
    deposit = transaction(client)
    payload = {'create_entry': {'name': 'New paycheck', 'amount_cents': 9600},
               'replace_existing': True, 'idempotency_key': 'income-request-key-0001'}
    assert assign(client, deposit['id'], **payload).status_code == 200
    altered = {**payload, 'create_entry': {**payload['create_entry'], 'amount_cents': 9700}}
    assert assign(client, deposit['id'], **altered).status_code == 409
    other = transaction(client)
    assert assign(client, other['id'], **payload).status_code == 409
    assert client.put(f"/api/transactions/{deposit['id']}/income?month=2026-11", json=payload).status_code == 409
    assert len(income(client)['entries']) == 1


def test_concurrent_idempotent_creates_share_one_saved_income_line(home):
    _, client = home
    deposit = transaction(client)
    payload = {'create_entry': {'name': 'One paycheck', 'amount_cents': 9600},
               'replace_existing': True, 'idempotency_key': 'income-request-concurrent'}
    ready = Barrier(2)

    def create():
        ready.wait()
        return assign(client, deposit['id'], **payload)

    with ThreadPoolExecutor(max_workers=2) as workers:
        pending = [workers.submit(create), workers.submit(create)]
        results = [operation.result(timeout=15) for operation in pending]
    assert all(response.status_code == 200 for response in results)
    assert len({response.json()['income_entry_id'] for response in results}) == 1
    assert len(income(client)['entries']) == 1


def test_idempotency_marker_survives_unlink_assignment_change_and_deletion(home):
    path, client = home
    deposit = transaction(client)
    payload = {'create_entry': {'name': 'New paycheck', 'amount_cents': 9600},
               'replace_existing': True, 'idempotency_key': 'income-request-key-0002'}
    first = assign(client, deposit['id'], **payload)
    assert first.status_code == 200
    result_id = first.json()['income_entry_id']
    another = entry(client)
    assert assign(client, deposit['id'], entry_id=another['id'], replace_existing=True).status_code == 200
    assert assign(client, deposit['id'], **payload).status_code == 409
    assert assign(client, deposit['id'], entry_id=None).status_code == 200
    assert assign(client, deposit['id'], **payload).status_code == 409
    assert client.delete(f'/api/income/entries/{result_id}').status_code == 204
    assert assign(client, deposit['id'], **payload).status_code == 409
    assert client.delete(f"/api/transactions/{deposit['id']}").status_code == 204
    with connect(path) as db:
        marker = db.execute('SELECT * FROM income_transaction_requests').fetchone()
        assert marker['transaction_id'] is None and marker['result_entry_id'] is None
    new_deposit = transaction(client)
    assert assign(client, new_deposit['id'], **payload).status_code == 409
    assert all(row['name'] != 'New paycheck' for row in income(client)['entries'])


def test_idempotency_keys_are_isolated_by_scope_and_owner(home):
    path, client = home
    household_deposit = transaction(client)
    personal_deposit = transaction(client, 'personal')
    client.post('/api/members', json={'username': 'member', 'display_name': 'Member', 'password': 'another-long-password'})
    member_login = client.post('/api/auth/login', json={'username': 'member', 'password': 'another-long-password'})
    member_header = {'Authorization': 'Bearer ' + member_login.json()['token']}
    member_deposit = client.post('/api/transactions?scope=personal', headers=member_header,
                                  json={'description': 'Member paycheck', 'amount_cents': 9500, 'date': '2026-10-08'}).json()
    payload = {'create_entry': {'name': 'Paycheck', 'amount_cents': 9600},
               'replace_existing': True, 'idempotency_key': 'income-request-shared-key'}
    household = assign(client, household_deposit['id'], **payload)
    personal = client.put(f"/api/transactions/{personal_deposit['id']}/income?scope=personal", json=payload)
    member = client.put(f"/api/transactions/{member_deposit['id']}/income?scope=personal", headers=member_header, json=payload)
    assert household.status_code == personal.status_code == member.status_code == 200
    assert len({r.json()['income_entry_id'] for r in (household, personal, member)}) == 3
    with connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM income_transaction_requests').fetchone()[0] == 3
    assert client.put(f"/api/transactions/{member_deposit['id']}/income?scope=personal", json=payload).status_code == 404


def test_single_transaction_final_read_rechecks_scope_after_id_reuse(home, monkeypatch):
    path, client = home
    deposit = transaction(client)
    client.post('/api/members', json={'username': 'member', 'display_name': 'Member', 'password': 'another-long-password'})
    app_module = importlib.import_module('backend.app')
    require = app_module.require_scope_item
    changed = False

    def authorize_then_reuse_id(db, table, item_id, identity):
        nonlocal changed
        result = require(db, table, item_id, identity)
        if table == 'transactions' and item_id == deposit['id'] and not changed:
            changed = True
            # SQLite integer primary keys can be reused after deleting the
            # highest row. Simulate the replacement between the two reads.
            with connect(path) as writer:
                writer.execute('DELETE FROM transactions WHERE id=?', (item_id,))
                writer.execute('''INSERT INTO transactions(id,household_id,owner_id,scope,description,amount_cents,date)
                    VALUES (?,1,2,'personal','Secret replacement paycheck',12345,'2026-10-08')''', (item_id,))
        return result

    monkeypatch.setattr(app_module, 'require_scope_item', authorize_then_reuse_id)
    response = client.get(f"/api/transactions/{deposit['id']}")
    assert changed
    assert response.status_code == 404
    assert 'Secret replacement' not in response.text
    with connect(path) as db:
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as denied:
            app_module.transaction_by_id(db, deposit['id'], (1, 0, 'household'))
        assert denied.value.status_code == 404
        assert app_module.transaction_by_id(db, deposit['id'], (1, 2, 'personal'))['description'] == 'Secret replacement paycheck'


def test_transaction_deletion_locks_authorization_exclusion_and_delete(home, monkeypatch):
    path, client = home
    deposit = transaction(client)
    with connect(path) as db:
        db.execute("UPDATE transactions SET external_id='imported-receipt' WHERE id=?", (deposit['id'],))
    app_module = importlib.import_module('backend.app')
    require = app_module.require_scope_item
    checked = False

    def authorize_under_write_lock(db, table, item_id, identity):
        nonlocal checked
        if table == 'transactions' and item_id == deposit['id']:
            checked = True
            assert db.in_transaction
            competitor = sqlite3.connect(path, timeout=0.01)
            try:
                with pytest.raises(sqlite3.OperationalError, match='locked'):
                    competitor.execute('DELETE FROM transactions WHERE id=?', (item_id,))
            finally:
                competitor.close()
        return require(db, table, item_id, identity)

    monkeypatch.setattr(app_module, 'require_scope_item', authorize_under_write_lock)
    assert client.delete(f"/api/transactions/{deposit['id']}").status_code == 204
    assert checked
    with connect(path) as db:
        assert db.execute('SELECT 1 FROM transactions WHERE id=?', (deposit['id'],)).fetchone() is None
        assert db.execute("SELECT 1 FROM transaction_exclusions WHERE household_id=1 AND owner_id=0 AND scope='household' AND external_id='imported-receipt'").fetchone()
