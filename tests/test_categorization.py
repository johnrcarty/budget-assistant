"""Rule engine, bank overlap, manual choices, and reviewed backfills."""
from datetime import datetime, timezone

from backend import simplefin
from backend.database import connect
from test_account_debt_history import home, feed


def target(client, actor, name='Coffee'):
    response = client.post('/api/budget/items?month=2026-10', headers=actor,
                           json={'name': name, 'group_name': 'Daily spending'})
    assert response.status_code == 201, response.text
    return response.json()


def rule(client, actor, item, **changes):
    response = client.post('/api/categorization/rules', headers=actor, json={
        'name': 'Coffee rule', 'merchant_text': 'coffee',
        'budget_item_id': item['id'], **changes})
    assert response.status_code == 201, response.text
    return response.json()


def purchase(client, actor, **changes):
    response = client.post('/api/transactions', headers=actor, json={
        'description': 'Coffee bar', 'amount_cents': -999,
        'date': '2026-10-02', **changes})
    assert response.status_code == 201, response.text
    return response.json()


def preview(client, actor):
    response = client.post('/api/categorization/preview', headers=actor,
                           json={'month': '2026-10'})
    assert response.status_code == 200, response.text
    return response.json()


def ledger(client, actor, month='2026-10'):
    return client.get('/api/transactions', headers=actor,
                      params={'month': month}).json()


def test_literal_normalization_priority_direction_and_exact_account_filter(home):
    _, client, owner, _, _ = home
    a, b = target(client, owner, 'First'), target(client, owner, 'Second')
    account = client.post('/api/accounts', headers=owner,
                          json={'name': 'Checking'}).json()['id']
    broad = rule(client, owner, a)
    exact = rule(client, owner, b, merchant_text=' COFFEE   BAR ',
                 match_type='exact', account_id=account)
    assert purchase(client, owner, account_id=account,
                    description='Coffee\tbar')['category_id'] == a['id']
    reordered = client.post('/api/categorization/rules/reorder', headers=owner,
                            json={'rule_ids': [exact['id'], broad['id']]})
    assert reordered.status_code == 200
    selected = purchase(client, owner, account_id=account)
    assert selected['category_id'] == b['id']
    assert selected['category_source'] == 'automatic'
    assert purchase(client, owner)['category_id'] == a['id']
    assert purchase(client, owner, amount_cents=100)['category_id'] is None
    rule(client, owner, b, merchant_text='.*MARKET.*', direction='inflow')
    assert purchase(client, owner, description='MARKET',
                    amount_cents=100)['category_id'] is None
    assert purchase(client, owner, description='.*market.*',
                    amount_cents=100)['category_id'] == b['id']
    assert client.delete(f"/api/categorization/rules/{exact['id']}",
                         headers=owner).status_code == 204
    preserved = next(row for row in ledger(client, owner)
                     if row['id'] == selected['id'])
    assert preserved['category_id'] == b['id']
    assert preserved['category_source'] == 'automatic'
    assert preserved['categorization_rule_id'] is None


def test_preview_stale_rules_new_rows_one_time_and_explicit_manual_clear_reset(home):
    app, client, owner, _, _ = home
    item = target(client, owner)
    old = purchase(client, owner)
    assigned = purchase(client, owner, category_id=item['id'])
    kept = purchase(client, owner, category_id=None)
    saved = rule(client, owner, item)
    assert next(row for row in ledger(client, owner)
                if row['id'] == old['id'])['category_id'] is None
    p = preview(client, owner)
    assert {row['transaction_id'] for row in p['matches']} == {old['id']}
    assert p['counts']['protected_manual'] == 2
    assert client.patch(f"/api/categorization/rules/{saved['id']}",
                        headers=owner, json={'merchant_text': 'other'}).status_code == 200
    assert client.post('/api/categorization/apply', headers=owner,
                       json={'preview_token': p['preview_token']}).status_code == 409
    client.patch(f"/api/categorization/rules/{saved['id']}", headers=owner,
                 json={'merchant_text': 'coffee'})
    p = preview(client, owner)
    purchase(client, owner, description='An unrelated new receipt')
    assert client.post('/api/categorization/apply', headers=owner,
                       json={'preview_token': p['preview_token']}).status_code == 409
    p = preview(client, owner)
    applied = client.post('/api/categorization/apply', headers=owner,
                          json={'preview_token': p['preview_token']})
    assert applied.status_code == 200 and applied.json()['applied'] == 1
    assert client.post('/api/categorization/apply', headers=owner,
                       json={'preview_token': p['preview_token']}).status_code == 409
    reset = client.post(f"/api/transactions/{kept['id']}/categorization/reset", headers=owner)
    assert reset.status_code == 200 and reset.json()['category_id'] == item['id']
    assert reset.json()['category_source'] == 'automatic'
    assert client.post(f"/api/transactions/{assigned['id']}/categorization/reset",
                       headers=owner).status_code == 409
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT amount_cents,date,pending FROM transactions WHERE id=?',
                          (old['id'],)).fetchone()[:] == (-999, '2026-10-02', 0)
        assert db.execute('SELECT COUNT(*) FROM bills').fetchone()[0] == 0


def test_bank_overlap_month_repair_preserves_override_manual_clear_and_exclusion(home):
    app, client, owner, _, _ = home
    item = target(client, owner)
    payload = feed()
    payload['accounts'][0]['transactions'][0]['pending'] = True
    simplefin.import_accounts(app.state.db_path, 1, 'household', payload)
    rule(client, owner, item, merchant_text='fixture')
    simplefin.import_accounts(app.state.db_path, 1, 'household', payload)
    old = ledger(client, owner)[0]
    assert old['category_id'] == item['id'] and old['category_source'] == 'automatic'
    assert client.patch(f"/api/transactions/{old['id']}", headers=owner,
                        json={'amount_cents': -321}).status_code == 200
    with connect(app.state.db_path) as db:
        external = db.execute('SELECT external_id FROM transactions WHERE id=?',
                              (old['id'],)).fetchone()[0]
    incoming = payload['accounts'][0]['transactions'][0]
    incoming.update(posted=int(datetime(2026, 11, 1, 15, tzinfo=timezone.utc).timestamp()),
                    pending=False, amount='200.00')
    simplefin.import_accounts(app.state.db_path, 1, 'household', payload)
    missing = ledger(client, owner, '2026-11')[0]
    assert missing['category_id'] is None and missing['amount_cents'] == -321
    assert client.post('/api/budget/copy', headers=owner,
                       json={'from_month': '2026-10', 'to_month': '2026-11'}).status_code == 201
    november = client.get('/api/budget/items?month=2026-11', headers=owner).json()[0]['id']
    simplefin.import_accounts(app.state.db_path, 1, 'household', payload)
    moved = ledger(client, owner, '2026-11')[0]
    assert moved['id'] == old['id'] and moved['category_id'] == november
    assert moved['amount_cents'] == -321 and moved['pending'] is False
    assert client.patch(f"/api/transactions/{old['id']}", headers=owner,
                        json={'category_id': None}).json()['manual_category_lock']
    simplefin.import_accounts(app.state.db_path, 1, 'household', payload)
    assert ledger(client, owner, '2026-11')[0]['category_id'] is None
    with connect(app.state.db_path) as db:
        row = db.execute('SELECT external_id,amount_override_cents FROM transactions WHERE id=?',
                         (old['id'],)).fetchone()
        assert row[:] == (external, -321)
    assert client.delete(f"/api/transactions/{old['id']}", headers=owner).status_code == 204
    simplefin.import_accounts(app.state.db_path, 1, 'household', payload)
    assert ledger(client, owner, '2026-11') == []
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT COUNT(*) FROM transaction_exclusions').fetchone()[0] == 1


def test_date_patch_and_item_drawer_explicit_actions_preserve_manual_provenance(home):
    _, client, owner, _, _ = home
    item = target(client, owner)
    rule(client, owner, item)
    row = purchase(client, owner)
    assert client.post('/api/budget/copy', headers=owner,
                       json={'from_month': '2026-10', 'to_month': '2026-11'}).status_code == 201
    november = client.get('/api/budget/items?month=2026-11', headers=owner).json()[0]['id']
    changed = client.patch(f"/api/transactions/{row['id']}", headers=owner,
                           json={'date': '2026-11-01'})
    assert changed.status_code == 200 and changed.json()['category_id'] == november
    assert changed.json()['amount_cents'] == -999 and changed.json()['category_source'] == 'automatic'
    linked = client.post(f"/api/budget/items/{november}/transactions/{row['id']}/link",
                         headers=owner, json={})
    assert linked.status_code == 200
    assert linked.json()['linked_transactions'][0]['category_source'] == 'manual'
    assert client.delete(f"/api/budget/items/{november}/transactions/{row['id']}/link",
                         headers=owner).status_code == 200
    assert ledger(client, owner, '2026-11')[0]['manual_category_lock']
    created = client.post(f"/api/budget/items/{item['id']}/transactions", headers=owner,
                          json={'description': 'Coffee linked', 'amount_cents': -1,
                                'date': '2026-10-02'})
    assert created.status_code == 201
    assert created.json()['linked_transactions'][0]['category_source'] == 'manual'
    manual = purchase(client, owner, category_id=item['id'])
    assert client.patch(f"/api/transactions/{manual['id']}", headers=owner,
                        json={'date': '2026-11-01'}).status_code == 422


def test_first_matching_archived_missing_target_is_skipped_without_creating_plans(home):
    app, client, owner, _, _ = home
    first, fallback = target(client, owner, 'First'), target(client, owner, 'Fallback')
    leading = rule(client, owner, first)
    rule(client, owner, fallback)
    assert client.patch(f"/api/budget/categories/{first['budget_category_id']}",
                        headers=owner, json={'active': False}).status_code == 200
    assert purchase(client, owner)['category_id'] is None
    p = preview(client, owner)
    assert p['matches'] == [] and p['skipped'][0]['reason'] == 'target_category_archived'
    client.patch(f"/api/categorization/rules/{leading['id']}", headers=owner,
                 json={'active': False})
    # Both items share one category, so restoring it makes the fallback available.
    client.patch(f"/api/budget/categories/{first['budget_category_id']}", headers=owner,
                 json={'active': True})
    assert purchase(client, owner)['category_id'] == fallback['id']
    assert purchase(client, owner, date='2026-11-02')['category_id'] is None
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT COUNT(*) FROM budget_items').fetchone()[0] == 2
        assert db.execute('SELECT COUNT(*) FROM bills').fetchone()[0] == 0


def test_models_reject_blank_and_coerced_order_ids_and_non_budget_account_filters(home):
    _, client, owner, _, _ = home
    item = target(client, owner)
    assert client.post('/api/categorization/rules', headers=owner, json={
        'name': 'Blank', 'merchant_text': '   ', 'budget_item_id': item['id']}).status_code == 422
    for ids in ([True], ['1'], [-1]):
        assert client.post('/api/categorization/rules/reorder', headers=owner,
                           json={'rule_ids': ids}).status_code == 422
    for body in ({'name': 'Loan', 'kind': 'loan'}, {'name': 'EUR', 'currency': 'EUR'}):
        account = client.post('/api/accounts', headers=owner, json=body).json()['id']
        assert client.post('/api/categorization/rules', headers=owner, json={
            'name': 'Invalid account', 'merchant_text': 'coffee',
            'budget_item_id': item['id'], 'account_id': account}).status_code == 422
