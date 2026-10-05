"""Receipts and bank sweeps remain outside expense rules and rollups."""
from backend.database import connect
from test_account_debt_history import home
from test_categorization import target, rule, purchase, preview, ledger


def receipt(client, actor, amount=25000):
    planned = client.post('/api/income/entries?month=2026-10', headers=actor,
                          json={'name': 'Paycheck', 'amount_cents': amount, 'date': '2026-10-02'})
    assert planned.status_code == 201, planned.text
    return planned.json()


def test_income_assignment_protects_rules_and_item_drawer(home):
    _, client, owner, _, _ = home
    item = target(client, owner, 'Refunds')
    entry = receipt(client, owner)
    tx = purchase(client, owner, description='Payroll deposit', amount_cents=24000)
    rule(client, owner, item, merchant_text='Payroll', direction='inflow')
    reviewed = preview(client, owner)
    assert reviewed['counts']['matched'] == 1
    linked = client.put(f"/api/transactions/{tx['id']}/income", headers=owner,
                        json={'entry_id': entry['id']})
    assert linked.status_code == 200, linked.text
    assert client.post('/api/categorization/apply', headers=owner,
                       json={'preview_token': reviewed['preview_token']}).status_code == 409
    assert preview(client, owner)['matches'] == []
    assert client.post(f"/api/transactions/{tx['id']}/categorization/reset",
                       headers=owner).status_code == 409
    assert client.post(f"/api/budget/items/{item['id']}/transactions/{tx['id']}/link",
                       headers=owner, json={'replace_existing': True}).status_code == 409
    income = client.get('/api/income?month=2026-10', headers=owner).json()
    assert income['total_cents'] == 25000
    assert income['total_actual_received_cents'] == 24000
    assert client.put(f"/api/transactions/{tx['id']}/income", headers=owner, json={}).status_code == 200
    reset = client.post(f"/api/transactions/{tx['id']}/categorization/reset", headers=owner)
    assert reset.status_code == 200
    assert reset.json()['category_id'] == item['id']


def test_transfer_override_visibility_and_expense_guard(home):
    _, client, owner, _, _ = home
    item = target(client, owner)
    entry = receipt(client, owner)
    tx = purchase(client, owner, description='Coffee internal movement', amount_cents=1000,
                  provider_role_override='bank_transfer')
    rule(client, owner, item, direction='inflow')
    assert tx['id'] not in {row['id'] for row in ledger(client, owner)}
    full = client.get('/api/transactions?month=2026-10&include_transfers=true', headers=owner).json()
    assert next(row for row in full if row['id'] == tx['id'])['transaction_role'] == 'bank_transfer'
    assert preview(client, owner)['matches'] == []
    assert client.put(f"/api/transactions/{tx['id']}/income", headers=owner,
                      json={'entry_id': entry['id']}).status_code == 409
    assert client.post(f"/api/budget/items/{item['id']}/transactions/{tx['id']}/link",
                       headers=owner, json={}).status_code == 409
    restored = client.patch(f"/api/transactions/{tx['id']}", headers=owner,
                            json={'provider_role_override': 'ordinary'})
    assert restored.status_code == 200
    assert restored.json()['category_id'] == item['id']
    assert client.patch(f"/api/transactions/{tx['id']}", headers=owner,
                        json={'provider_role_override': 'bank_transfer'}).status_code == 409
    transfer = client.patch(f"/api/transactions/{tx['id']}", headers=owner,
                            json={'provider_role_override': 'bank_transfer', 'category_id': None})
    assert transfer.status_code == 200
    assert transfer.json()['category_id'] is None


def test_sweep_reclassification_clears_automatic_target_and_rollups_defend_links(home):
    app, client, owner, _, _ = home
    item = target(client, owner)
    rule(client, owner, item)
    automatically_assigned = purchase(client, owner)
    real = purchase(client, owner, amount_cents=-700, category_id=item['id'])
    assert automatically_assigned['category_id'] == item['id']
    # Model a newly shipped bank handler identifying an old automatic row.
    from backend.categorization import apply_automatic
    with connect(app.state.db_path) as db:
        db.execute("UPDATE transactions SET provider_role='bank_transfer' WHERE id=?", (automatically_assigned['id'],))
        row = db.execute('SELECT household_id,owner_id,scope FROM transactions WHERE id=?', (automatically_assigned['id'],)).fetchone()
        apply_automatic(db, tuple(row), automatically_assigned['id'], reconcile=True)
        assert db.execute('SELECT category_id FROM transactions WHERE id=?', (automatically_assigned['id'],)).fetchone()[0] is None
        # Even a retained inconsistent historical association cannot pollute a
        # category, its item chart, or household spending.
        db.execute('UPDATE transactions SET category_id=? WHERE id=?', (item['id'], automatically_assigned['id']))
    dashboard = client.get('/api/dashboard?month=2026-10', headers=owner).json()
    assert dashboard['spent_cents'] == 700
    groups = client.get('/api/budget/categories?month=2026-10', headers=owner).json()
    group = next(group for group in groups if any(row['id'] == item['id'] for row in group['items']))
    assert group['spent_cents'] == 700
    assert next(row for row in group['items'] if row['id'] == item['id'])['spent_cents'] == 700
    detail = client.get(f"/api/budget/items/{item['id']}/details", headers=owner).json()
    assert detail['item']['spent_cents'] == 700
    assert detail['history'][-1]['spent_cents'] == 700
    assert real['id'] in {row['id'] for row in detail['linked_transactions']}


def test_account_currency_change_does_not_mix_old_amounts_into_usd_budget(home):
    app, client, owner, _, _ = home
    item = target(client, owner)
    account = client.post('/api/accounts', headers=owner,
                          json={'name': 'Local checking', 'currency': 'USD', 'kind': 'checking'}).json()
    tx = purchase(client, owner, amount_cents=-700, category_id=item['id'], account_id=account['id'])
    response = client.patch(f"/api/accounts/{account['id']}", headers=owner,
                            json={'currency': 'EUR', 'balance_cents': 12300})
    assert response.status_code == 200, response.text
    assert client.get('/api/dashboard?month=2026-10', headers=owner).json()['spent_cents'] == 0
    groups = client.get('/api/budget/categories?month=2026-10', headers=owner).json()
    group = next(group for group in groups if any(row['id'] == item['id'] for row in group['items']))
    assert group['spent_cents'] == 0
    detail = client.get(f"/api/budget/items/{item['id']}/details", headers=owner).json()
    assert detail['item']['spent_cents'] == 0
    assert detail['history'][-1]['spent_cents'] == 0
    retained = next(row for row in detail['linked_transactions'] if row['id'] == tx['id'])
    assert retained['currency'] == 'EUR'
