"""Collateral is a scoped independent asset, never a duplicated valuation."""
import sqlite3

from backend import accounts as account_plans, simplefin
from backend.database import connect, initialize
from test_account_debt_history import account, bill_rows, feed, history, home, net_worth, schedule


def row(client, headers, account_id, scope='household'):
    response = client.get('/api/accounts', headers=headers, params={'scope': scope})
    assert response.status_code == 200, response.text
    return next(value for value in response.json() if value['id'] == account_id)


def link(client, headers, debt_id, *, scope='household', **payload):
    response = client.put(f'/api/accounts/{debt_id}/collateral', headers=headers,
                          params={'scope': scope}, json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def test_asset_create_link_counts_once_and_link_changes_never_invent_history(home, monkeypatch):
    _, client, owner, _, _ = home
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-04T12:00:00.000000+00:00')
    mortgage = account(client, owner, name='Mortgage', balance_cents=200000, debt_type='mortgage')
    second = account(client, owner, name='Home improvement', balance_cents=-50000)
    created = link(client, owner, mortgage, asset={'name': 'Home', 'kind': 'property', 'balance_cents': 350000})
    asset_id = created['collateral_asset_id']
    assert created['collateral']['currency'] == 'USD'
    assert created['collateral']['equity_cents'] == 150000
    before_asset = history(client, owner, asset_id)['points']
    before_debt = history(client, owner, mortgage)['points']
    before_net = net_worth(client, owner)
    assert before_net['USD'][-1]['assets_cents'] == 350000
    assert before_net['USD'][-1]['liabilities_cents'] == 250000
    assert before_net['USD'][-1]['net_worth_cents'] == 100000
    for _ in range(2):
        attached = link(client, owner, second, asset_id=asset_id)
        assert attached['collateral']['secured_debt_count'] == 2
        assert attached['collateral']['secured_debt_total_cents'] == 250000
        assert attached['collateral']['equity_cents'] == 100000
    asset = row(client, owner, asset_id)
    assert asset['equity_cents'] == 100000
    assert {entry['id'] for entry in asset['secured_debts']} == {mortgage, second}
    assert history(client, owner, asset_id)['points'] == before_asset
    assert history(client, owner, mortgage)['points'] == before_debt
    assert net_worth(client, owner) == before_net
    link(client, owner, second, asset_id=None)
    assert row(client, owner, asset_id)['equity_cents'] == 150000
    assert net_worth(client, owner) == before_net
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-05T12:00:00.000000+00:00')
    assert client.patch(f'/api/accounts/{asset_id}', headers=owner, json={'balance_cents': 400000}).status_code == 200
    assert len(history(client, owner, asset_id)['points']) == 2
    assert history(client, owner, asset_id)['points'][0] == before_asset[0]
    assert history(client, owner, mortgage)['points'] == before_debt
    assert net_worth(client, owner)['USD'][-1]['net_worth_cents'] == 150000


def test_payoff_and_debt_archive_keep_asset_paid_facts_schedule_and_history(home, monkeypatch):
    _, client, owner, _, _ = home
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-04T12:00:00.000000+00:00')
    debt = account(client, owner, debt_type='auto', balance_cents=25000)
    vehicle = link(client, owner, debt, asset={'name': 'Car', 'kind': 'vehicle', 'balance_cents': 30000})['collateral_asset_id']
    schedule(client, owner, debt, cadence='monthly', anchor_date='2026-10-02', day1=2)
    bill = bill_rows(client, owner)[0]
    assert client.patch(f"/api/bills/{bill['id']}", headers=owner, json={'paid': True}).status_code == 200
    original_asset_history = history(client, owner, vehicle)['points']
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-05T12:00:00.000000+00:00')
    paid_off = client.patch(f'/api/accounts/{debt}', headers=owner, json={'balance_cents': 0})
    assert paid_off.status_code == 200
    assert paid_off.json()['payoff_status'] == 'paid_off'
    assert paid_off.json()['payment_schedule']['active'] is True
    assert paid_off.json()['collateral_asset_id'] == vehicle
    assert row(client, owner, vehicle)['equity_cents'] == 30000
    assert history(client, owner, vehicle)['points'] == original_asset_history
    assert next(entry for entry in bill_rows(client, owner) if entry['id'] == bill['id'])['paid'] is True
    credit = account(client, owner, kind='credit', balance_cents=0)
    assert row(client, owner, credit)['payoff_status'] is None
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-06T12:00:00.000000+00:00')
    assert client.delete(f'/api/accounts/{debt}', headers=owner).status_code == 204
    retained = row(client, owner, vehicle)
    assert retained['active'] is True and retained['balance_cents'] == 30000
    assert retained['secured_debts'][0]['id'] == debt and retained['secured_debts'][0]['active'] is False
    assert retained['equity_cents'] == 30000
    assert net_worth(client, owner)['USD'][-1]['net_worth_cents'] == 30000
    assert history(client, owner, vehicle)['points'] == original_asset_history
    assert history(client, owner, debt)['points'][-1]['balance_cents'] == 0


def test_invalid_links_and_atomic_create_failures_leave_accounts_and_observations_unchanged(home):
    app, client, owner, _, _ = home
    debt = account(client, owner)
    eur = account(client, owner, kind='property', currency='EUR', balance_cents=100000)
    negative = account(client, owner, kind='checking', balance_cents=-1)
    archived = account(client, owner, kind='vehicle', balance_cents=10000)
    assert client.delete(f'/api/accounts/{archived}', headers=owner).status_code == 204
    nondebt = account(client, owner, kind='savings')
    with connect(app.state.db_path) as db:
        before = (db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0],
                  db.execute('SELECT COUNT(*) FROM account_balance_observations').fetchone()[0])
    for payload, status in (({'asset_id': debt}, 422), ({'asset_id': eur}, 422),
                            ({'asset_id': negative}, 422), ({'asset_id': archived}, 404),
                            ({'asset_id': 999999}, 404), ({}, 422), ({'asset_id': True}, 422),
                            ({'asset_id': None, 'asset': {'name': 'Two choices', 'balance_cents': 1000}}, 422),
                            ({'asset': None}, 422),
                            ({'asset': {'name': 'Wrong currency', 'balance_cents': 1000, 'currency': 'EUR'}}, 422),
                            ({'asset': {'name': 'Negative value', 'balance_cents': -1}}, 422),
                            ({'asset': {'name': 'Wrong type', 'kind': 'loan', 'balance_cents': 1000}}, 422)):
        response = client.put(f'/api/accounts/{debt}/collateral', headers=owner, json=payload)
        assert response.status_code == status, response.text
    assert client.put(f'/api/accounts/{nondebt}/collateral', headers=owner,
                      json={'asset': {'name': 'Never inserted', 'balance_cents': 1000}}).status_code == 422
    with connect(app.state.db_path) as db:
        assert (db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0],
                db.execute('SELECT COUNT(*) FROM account_balance_observations').fetchone()[0]) == before
        assert db.execute('SELECT collateral_asset_id FROM accounts WHERE id=?', (debt,)).fetchone()[0] is None


def test_linked_currency_kind_value_and_archive_guards_require_explicit_unlink(home):
    _, client, owner, _, _ = home
    debt = account(client, owner)
    asset = link(client, owner, debt, asset={'name': 'Asset', 'balance_cents': 150000})['collateral_asset_id']
    for aid, changes, code in ((debt, {'kind': 'checking'}, 409),
                               (debt, {'currency': 'EUR', 'balance_cents': 90000}, 409),
                               (asset, {'kind': 'loan'}, 409),
                               (asset, {'currency': 'EUR', 'balance_cents': 150000}, 409),
                               (asset, {'balance_cents': -1}, 422)):
        assert client.patch(f'/api/accounts/{aid}', headers=owner, json=changes).status_code == code
    assert client.delete(f'/api/accounts/{asset}', headers=owner).status_code == 409
    # Payoff never implicitly unlinks; the user can explicitly detach at any time.
    assert client.patch(f'/api/accounts/{debt}', headers=owner, json={'balance_cents': 0}).status_code == 200
    assert client.delete(f'/api/accounts/{asset}', headers=owner).status_code == 409
    assert row(client, owner, asset)['balance_cents'] == 150000
    link(client, owner, debt, asset_id=None)
    assert client.patch(f'/api/accounts/{asset}', headers=owner,
                        json={'currency': 'EUR', 'balance_cents': 150000}).status_code == 200
    assert client.delete(f'/api/accounts/{asset}', headers=owner).status_code == 204
    assert row(client, owner, debt)['collateral'] is None


def test_collateral_reads_and_mutations_are_scoped_and_machine_token_cannot_access(home):
    app, client, owner, member, outsider = home
    public = account(client, owner)
    private = account(client, owner, scope='personal', name='Private debt')
    private_asset = link(client, owner, private, scope='personal',
                         asset={'name': 'Private vehicle', 'kind': 'vehicle', 'balance_cents': 123456})['collateral_asset_id']
    foreign = account(client, outsider, kind='property', name='Foreign home')
    for actor, scope, debt_id, payload in (
        (member, 'personal', private, {'asset_id': None}),
        (owner, 'household', private, {'asset_id': None}),
        (outsider, 'household', public, {'asset_id': None}),
        (owner, 'household', public, {'asset_id': private_asset}),
        (owner, 'household', public, {'asset_id': foreign}),
    ):
        response = client.put(f'/api/accounts/{debt_id}/collateral', headers=actor,
                              params={'scope': scope}, json=payload)
        assert response.status_code == 404
    public_asset = link(client, member, public, asset={'name': 'Shared home', 'balance_cents': 200000})['collateral_asset_id']
    assert row(client, owner, public)['collateral_asset_id'] == public_asset
    assert client.patch('/api/settings', headers=owner, json={'share_personal_totals': True}).status_code == 200
    response = client.get('/api/accounts', headers=member)
    assert all(label not in response.text for label in ('Private debt', 'Private vehicle', 'Foreign home'))
    token = client.post('/api/integrations/ha-token', headers=owner).json()['token']
    machine = {'Authorization': 'Bearer ' + token}
    assert client.put(f'/api/accounts/{public}/collateral', headers=machine, json={'asset_id': None}).status_code == 401
    assert client.get('/api/accounts', headers=machine).status_code == 401
    # A damaged legacy FK must not make the nested reader bypass identity guards.
    with connect(app.state.db_path) as db:
        db.execute('UPDATE accounts SET collateral_asset_id=? WHERE id=?', (private_asset, public))
    visible = row(client, member, public)
    assert visible['collateral_asset_id'] is None and visible['collateral'] is None


def test_bank_sync_preserves_links_and_overrides_rejects_invalid_asset_valuation_and_currency(home, monkeypatch):
    app, client, owner, _, _ = home
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-04T12:00:00.000000+00:00')
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed())
    asset = client.get('/api/accounts', headers=owner).json()[0]['id']
    assert client.patch(f'/api/accounts/{asset}', headers=owner,
                        json={'kind': 'property', 'name': 'Classified home'}).status_code == 200
    debt = account(client, owner, balance_cents=5000)
    link(client, owner, debt, asset_id=asset)
    with connect(app.state.db_path) as db:
        tx = db.execute('SELECT * FROM transactions WHERE account_id=?', (asset,)).fetchone()
        tx_id, external_id = tx['id'], tx['external_id']
        db.execute('UPDATE transactions SET amount_override_cents=-777,amount_cents=-777,category_source=? WHERE id=?', ('manual', tx_id))
    before = history(client, owner, asset)['points']
    result = simplefin.import_accounts(app.state.db_path, 1, 'household', feed(balance='-5.00', as_of='2026-10-03T12:00:00+00:00'))
    assert result['imported_transactions'] == 1 and result['warnings']
    assert row(client, owner, asset)['balance_cents'] == 12345
    assert history(client, owner, asset)['points'] == before
    changed = simplefin.import_accounts(app.state.db_path, 1, 'household', feed(
        balance='999.00', currency='EUR', as_of='2026-10-03T12:00:00+00:00', transaction_id='wrong-currency'))
    assert changed['imported_transactions'] == 0
    assert row(client, owner, asset)['currency'] == 'USD'
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed(balance='456.00', as_of='2026-10-03T12:00:00+00:00'))
    retained = row(client, owner, asset)
    assert retained['kind'] == 'property' and retained['name'] == 'Classified home' and retained['balance_cents'] == 45600
    assert retained['secured_debts'][0]['id'] == debt
    assert row(client, owner, debt)['collateral_asset_id'] == asset
    with connect(app.state.db_path) as db:
        updated = db.execute('SELECT * FROM transactions WHERE id=?', (tx_id,)).fetchone()
        assert (updated['external_id'], updated['amount_cents'], updated['amount_override_cents'], updated['category_source']) == (
            external_id, -777, -777, 'manual')
        assert db.execute('SELECT COUNT(*) FROM transactions WHERE account_id=?', (asset,)).fetchone()[0] == 1


def test_imported_debt_payoff_preserves_collateral_and_blocks_unlinked_currency_drift(home, monkeypatch):
    app, client, owner, _, _ = home
    monkeypatch.setattr(account_plans, 'now_string', lambda: '2026-10-04T12:00:00.000000+00:00')
    simplefin.import_accounts(app.state.db_path, 1, 'household', feed())
    debt = client.get('/api/accounts', headers=owner).json()[0]['id']
    assert client.patch(f'/api/accounts/{debt}', headers=owner, json={'kind': 'loan', 'debt_type': 'auto'}).status_code == 200
    asset = link(client, owner, debt, asset={'name': 'Car', 'kind': 'vehicle', 'balance_cents': 20000})['collateral_asset_id']
    before = history(client, owner, asset)['points']
    result = simplefin.import_accounts(app.state.db_path, 1, 'household', feed(balance='0.00', as_of='2026-10-03T12:00:00+00:00'))
    assert result['imported_accounts'] == 1
    assert row(client, owner, debt)['payoff_status'] == 'paid_off'
    assert row(client, owner, debt)['collateral_asset_id'] == asset
    assert row(client, owner, asset)['balance_cents'] == 20000
    assert history(client, owner, asset)['points'] == before
    result = simplefin.import_accounts(app.state.db_path, 1, 'household', feed(
        balance='999.00', currency='EUR', as_of='2026-10-04T12:00:00+00:00', transaction_id='foreign-debt-payment'))
    assert result['imported_transactions'] == 0
    assert row(client, owner, debt)['currency'] == 'USD' and row(client, owner, debt)['balance_cents'] == 0
    assert row(client, owner, asset)['secured_debts'][0]['payoff_status'] == 'paid_off'


def test_additive_collateral_migration_preserves_existing_accounts_history_and_repeated_links(tmp_path):
    path = tmp_path / 'legacy.sqlite3'
    with sqlite3.connect(path) as db:
        db.executescript('''
            CREATE TABLE households(id INTEGER PRIMARY KEY,name TEXT NOT NULL,timezone TEXT NOT NULL,
                                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,
                               password_hash TEXT,household_id INTEGER NOT NULL REFERENCES households(id),
                               is_admin INTEGER NOT NULL DEFAULT 0,share_personal_totals INTEGER NOT NULL DEFAULT 0,
                               ingress_id TEXT UNIQUE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE accounts(id INTEGER PRIMARY KEY,household_id INTEGER NOT NULL REFERENCES households(id),
                                  owner_id INTEGER NOT NULL,scope TEXT NOT NULL,name TEXT NOT NULL,
                                  institution TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL DEFAULT 'checking',
                                  balance_cents INTEGER NOT NULL DEFAULT 0,currency TEXT NOT NULL DEFAULT 'USD',
                                  source TEXT NOT NULL DEFAULT 'manual',simplefin_id TEXT,
                                  UNIQUE(household_id,owner_id,scope,simplefin_id));
            INSERT INTO households(id,name,timezone) VALUES (1,'Old household','America/New_York');
            INSERT INTO users(id,username,display_name,household_id) VALUES (1,'legacy','Legacy',1);
            INSERT INTO accounts(id,household_id,owner_id,scope,name,kind,balance_cents,source,simplefin_id)
              VALUES (41,1,0,'household','Old mortgage','loan',20000,'simplefin','provider:41');
            INSERT INTO accounts(id,household_id,owner_id,scope,name,kind,balance_cents)
              VALUES (42,1,0,'household','Old home','property',50000);
        ''')
        original = db.execute('SELECT id,name,kind,balance_cents,source,simplefin_id FROM accounts ORDER BY id').fetchall()
    initialize(path)
    with connect(path) as db:
        assert [tuple(value) for value in db.execute('SELECT id,name,kind,balance_cents,source,simplefin_id FROM accounts ORDER BY id')] == original
        assert all(value[0] is None for value in db.execute('SELECT collateral_asset_id FROM accounts'))
        observations = [dict(value) for value in db.execute('SELECT * FROM account_balance_observations ORDER BY id')]
        assert len(observations) == 2
        db.execute('UPDATE accounts SET collateral_asset_id=42 WHERE id=41')
    initialize(path)
    initialize(path)
    with connect(path) as db:
        assert db.execute('SELECT collateral_asset_id FROM accounts WHERE id=41').fetchone()[0] == 42
        assert [dict(value) for value in db.execute('SELECT * FROM account_balance_observations ORDER BY id')] == observations
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
