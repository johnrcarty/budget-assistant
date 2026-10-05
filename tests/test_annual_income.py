"""Annual history is scoped, sparse, and independent of monthly cash receipts."""
import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app, password_hash
from backend.database import connect
from backend import annual_income


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


def person(client, name='John', scope='household', **values):
    response = client.post('/api/annual-income/people?scope=' + scope, json={'name': name, **values})
    assert response.status_code == 201, response.text
    return response.json()


def entry(client, person_id, year=2024, amount=10000000, scope='household', **values):
    response = client.post('/api/annual-income/entries?scope=' + scope, json={
        'person_id': person_id, 'year': year, 'source': 'W2', 'amount_cents': amount, **values})
    assert response.status_code == 201, response.text
    return response.json()


def spec(**values):
    return {'name': '2024 estimate', 'model': 'pattern', 'params': {'ratesBps': [350, 350, 350, 1000]},
            'base_year': 2024, 'horizon_year': 2028, **values}


def forecast(client, scope='household', **values):
    payload = spec(**values)
    preview = client.post('/api/annual-income/forecasts/preview?scope=' + scope, json=payload)
    assert preview.status_code == 200, preview.text
    response = client.post('/api/annual-income/forecasts?scope=' + scope,
                           json=payload | {'input_fingerprint': preview.json()['input_fingerprint']})
    assert response.status_code == 201, response.text
    return response.json()


def tracker(client, query=''):
    response = client.get('/api/annual-income' + query)
    assert response.status_code == 200, response.text
    return response.json()


def snapshot():
    return {
        'format': 'budget-assistant-annual-income', 'version': 1,
        'source': {'kind': 'legacy-postgresql', 'household_id': 'old-household-uuid', 'exported_at': '2026-10-05T01:00:00Z'},
        'people': [{'id': 'john-uuid', 'name': 'John', 'color': 'chart-1', 'sort_order': 0, 'active': True},
                   {'id': 'natasha-uuid', 'name': 'Natasha', 'color': None, 'sort_order': 1, 'active': False}],
        'entries': [
            {'id': 'w2-1', 'person_id': 'john-uuid', 'year': 2024, 'source': 'w2', 'amount_cents': 5000000,
             'fed_tax_cents': None, 'state_tax_cents': 0, 'note': 'Two jobs', 'created_at': '2025-01-01T01:02:03.123456', 'updated_at': None},
            {'id': 'w2-2', 'person_id': 'john-uuid', 'year': 2024, 'source': 'w2', 'amount_cents': 5000000,
             'fed_tax_cents': None, 'state_tax_cents': 0, 'note': 'Two jobs', 'created_at': '2025-01-01T01:02:03.123456', 'updated_at': None},
            {'id': 'older-1', 'person_id': 'natasha-uuid', 'year': 2022, 'source': '1099', 'amount_cents': -10000,
             'fed_tax_cents': -400, 'state_tax_cents': None, 'note': None}],
        'forecasts': [{'id': 'vintage-uuid', 'name': 'Old 2024 forecast', 'model': 'future-retired-model',
                       'params': {'old': ['keep', 2, None]}, 'base_year': 2024, 'horizon_year': 2028,
                       'created_at': '2024-12-20T09:08:07.123456Z',
                       'points': [{'id': 'point-uuid-2025', 'person_id': 'john-uuid', 'year': 2025, 'amount_cents': 11234567},
                                  {'id': 'point-uuid-2026', 'person_id': 'natasha-uuid', 'year': 2026, 'amount_cents': -12345}]}],
    }


def preview_import(client, data, resolutions=None, scope='household'):
    body = {'snapshot': data, 'person_resolutions': resolutions or {}}
    result = client.post('/api/annual-income/snapshot/preview?scope=' + scope, json=body)
    assert result.status_code == 200, result.text
    return body, result.json()


def import_snapshot(client, data, resolutions=None, scope='household'):
    body, preview = preview_import(client, data, resolutions, scope)
    assert preview['can_import'], preview
    response = client.post('/api/annual-income/snapshot/import?scope=' + scope,
                           json=body | {'input_fingerprint': preview['input_fingerprint']})
    assert response.status_code == 200, response.text
    return response.json(), body | {'input_fingerprint': preview['input_fingerprint']}


def test_annual_gross_withholding_sparse_history_and_monthly_independence(home):
    _, client = home
    john = person(client)
    natasha = person(client, 'Natasha')
    first = entry(client, john['id'], fed_tax_cents=1000000, state_tax_cents=200000, local_tax_cents=0,
                  medicare_cents=145000, social_security_cents=620000)
    entry(client, john['id'], amount=2000000, source='1099')
    entry(client, john['id'], year=2026, amount=0, note='Reported zero, not missing')
    entry(client, natasha['id'], year=2023, amount=8000000)
    data = tracker(client)
    annual = next(p for p in data['actuals'] if p['year'] == 2024)
    assert annual == {'person_id': john['id'], 'year': 2024, 'amount_cents': 12000000,
                      'withheld_cents': 1965000, 'net_cents': 10035000, 'entry_count': 2}
    assert not any(p['year'] == 2025 for p in data['actuals'])
    assert next(p for p in data['actuals'] if p['year'] == 2026)['amount_cents'] == 0
    assert next(y for y in data['year_totals'] if y['year'] == 2024)['missing_person_ids'] == [natasha['id']]
    assert next(y for y in data['year_totals'] if y['year'] == 2026)['coverage'] == 'reported'
    assert client.get('/api/income?month=2026-10').json()['total_cents'] == 0
    assert client.post('/api/income/entries?month=2026-10', json={'name': 'Check', 'amount_cents': 1234}).status_code == 201
    assert tracker(client)['actuals'] == data['actuals']
    assert client.patch(f"/api/annual-income/entries/{first['id']}", json={'fed_tax_cents': None}).status_code == 200
    assert next(p for p in tracker(client)['actuals'] if p['year'] == 2024)['withheld_cents'] == 965000


def test_archiving_people_preserves_history_and_does_not_infer_login(home):
    _, client = home
    assert tracker(client)['people'] == []
    p = person(client)
    e = entry(client, p['id'])
    saved = forecast(client)
    assert client.patch(f"/api/annual-income/people/{p['id']}", json={'active': False}).status_code == 200
    result = tracker(client)
    assert result['people'][0]['active'] is False
    assert result['entries'][0]['id'] == e['id']
    assert result['selected_forecast']['id'] == saved['id']
    assert client.delete(f"/api/annual-income/people/{p['id']}").status_code == 405
    assert client.post('/api/annual-income/people', json={'name': ' JOHN '}).status_code == 409


def test_pattern_exact_old_math_seed_catchup_float_carry_and_js_rounding(home):
    _, client = home
    p = person(client)
    entry(client, p['id'], year=2024)
    preview = client.post('/api/annual-income/forecasts/preview', json=spec()).json()
    assert [p['amount_cents'] for p in preview['points']] == [10350000, 10712250, 11087179, 12195897]
    # Half-cent ties use JS Math.round, not Python's banker rounding.
    points = annual_income.compute_forecast([{'person_id': 1, 'year': 2020, 'amount_cents': 101}],
                                            'pattern', {'ratesBps': [5000]}, 2021, 2022)
    assert points == [{'person_id': 1, 'year': 2022, 'amount_cents': 227}]
    assert annual_income.js_round(100.5) == 101
    assert annual_income.js_round(-100.5) == -100
    # A seed predating the base compounds through missing baseline years too.
    catchup = annual_income.compute_forecast([{'person_id': 1, 'year': 2020, 'amount_cents': 10000}],
                                             'pattern', {'ratesBps': [1000]}, 2022, 2023)
    assert catchup[0]['amount_cents'] == 13310


def test_linear_regression_observed_years_only_single_flat_negative_clamp(home):
    _, client = home
    p = person(client)
    for year, amount in [(2020, 5000000), (2022, 6000000), (2024, 7000000), (2026, 9999999)]:
        entry(client, p['id'], year, amount)
    saved = forecast(client, model='linear_regression', params={}, horizon_year=2026)
    assert [p['amount_cents'] for p in saved['points']] == [7500000, 8000000]
    single = annual_income.compute_forecast([{'person_id': 1, 'year': 2024, 'amount_cents': 8000000}], 'linear_regression', {}, 2024, 2026)
    assert [p['amount_cents'] for p in single] == [8000000, 8000000]
    declining = annual_income.compute_forecast([{'person_id': 1, 'year': 2020, 'amount_cents': 4000000},
                                              {'person_id': 1, 'year': 2021, 'amount_cents': 2000000},
                                              {'person_id': 1, 'year': 2022, 'amount_cents': 0}], 'linear_regression', {}, 2022, 2025)
    assert all(p['amount_cents'] == 0 for p in declining)


def test_default_current_year_explicit_future_and_vintage_baseline_immutable(home):
    _, client = home
    p = person(client)
    old = entry(client, p['id'], year=2024)
    saved = forecast(client)
    assert tracker(client)['current_year'] == 2026
    assert [p['year'] for p in tracker(client)['selected_forecast']['points']] == [2025, 2026]
    assert [p['year'] for p in tracker(client, '?through_year=2028')['selected_forecast']['points']] == [2025, 2026, 2027, 2028]
    entry(client, p['id'], year=2025, amount=11500000)
    assert client.patch(f"/api/annual-income/entries/{old['id']}", json={'amount_cents': 9000000}).status_code == 200
    retained = client.get(f"/api/annual-income/forecasts/{saved['id']}").json()
    assert retained['baseline'] == saved['baseline']
    assert retained['points'] == saved['points']
    assert retained['input_snapshot'] == saved['input_snapshot']
    assert client.delete(f"/api/annual-income/entries/{old['id']}").status_code == 204
    assert client.get(f"/api/annual-income/forecasts/{saved['id']}").json()['baseline'] == saved['baseline']
    second = forecast(client, base_year=2025, name='2025 updated')
    assert tracker(client)['selected_forecast']['id'] == second['id']
    assert tracker(client, '?forecast_id=' + str(saved['id']))['selected_forecast']['id'] == saved['id']
    assert tracker(client, '?forecast_id=none')['selected_forecast'] is None
    assert client.get('/api/annual-income?forecast_id=999999').status_code == 404


def test_preview_stale_and_forecast_lost_response_idempotency(home):
    _, client = home
    p = person(client)
    e = entry(client, p['id'])
    body = spec()
    preview = client.post('/api/annual-income/forecasts/preview', json=body).json()
    assert client.patch(f"/api/annual-income/entries/{e['id']}", json={'amount_cents': 9000000}).status_code == 200
    assert client.post('/api/annual-income/forecasts', json=body | {'input_fingerprint': preview['input_fingerprint']}).status_code == 409
    assert tracker(client)['forecasts'] == []
    fresh = client.post('/api/annual-income/forecasts/preview', json=body).json()
    request = body | {'input_fingerprint': fresh['input_fingerprint'], 'idempotency_key': 'forecast-retry-123'}
    first = client.post('/api/annual-income/forecasts', json=request)
    assert first.status_code == 201
    assert client.patch(f"/api/annual-income/entries/{e['id']}", json={'amount_cents': 8000000}).status_code == 200
    replay = client.post('/api/annual-income/forecasts', json=request)
    assert replay.status_code == 201 and replay.json() == first.json()
    assert len(tracker(client)['forecasts']) == 1
    assert client.post('/api/annual-income/forecasts', json=request | {'name': 'Changed'}).status_code == 409
    assert client.delete(f"/api/annual-income/forecasts/{first.json()['id']}").status_code == 204
    assert client.post('/api/annual-income/forecasts', json=request).status_code == 409


def test_forecast_create_concurrent_retry_has_one_vintage(home):
    _, client = home
    p = person(client)
    entry(client, p['id'])
    body = spec()
    preview = client.post('/api/annual-income/forecasts/preview', json=body).json()
    body |= {'input_fingerprint': preview['input_fingerprint'], 'idempotency_key': 'concurrent-forecast-123'}
    barrier = Barrier(2)
    def post():
        barrier.wait()
        return client.post('/api/annual-income/forecasts', json=body)
    with ThreadPoolExecutor(2) as executor:
        results = list(executor.map(lambda _: post(), range(2)))
    assert [r.status_code for r in results] == [201, 201]
    assert results[0].json()['id'] == results[1].json()['id']
    assert len(tracker(client)['forecasts']) == 1


def test_legacy_snapshot_exact_points_distinct_entries_signed_values_and_provenance(home):
    path, client = home
    data = snapshot()
    result, request = import_snapshot(client, data)
    assert result['entries_to_import'] == 3 and result['forecasts_to_import'] == 1
    retained = tracker(client)
    assert len(retained['entries']) == 3
    assert retained['actuals'][1]['amount_cents'] == 10000000
    john_entries = [e for e in retained['entries'] if e['year'] == 2024]
    assert all(e['fed_tax_cents'] is None and e['state_tax_cents'] == 0 for e in john_entries)
    assert all(e['created_at'] == '2025-01-01T01:02:03.123456' and e['updated_at'] is None for e in john_entries)
    saved = retained['selected_forecast']
    assert saved['model'] == 'future-retired-model'
    assert saved['params'] == data['forecasts'][0]['params']
    assert [p['amount_cents'] for p in saved['points']] == [11234567, -12345]
    assert saved['baseline_source'] == 'legacy_import_actuals'
    assert saved['baseline_recorded_at'] == '2026-10-05T01:00:00Z'
    assert saved['input_snapshot']['entries'] == []
    assert [p['amount_cents'] for p in saved['baseline']] == [-10000, 10000000]
    with connect(path) as db:
        assert {r['source_id'] for r in db.execute("SELECT source_id FROM annual_income_forecast_points WHERE kind='projected'")} == {'point-uuid-2025', 'point-uuid-2026'}
    # Lost-response replay and later newly generated export timestamp are safe.
    assert client.post('/api/annual-income/snapshot/import', json=request).status_code == 200
    data['source']['exported_at'] = '2026-10-07T08:00:00Z'
    later, _ = import_snapshot(client, data)
    assert later['already_imported'] == 6
    assert len(tracker(client)['entries']) == 3
    assert tracker(client)['selected_forecast']['baseline_recorded_at'] == '2026-10-05T01:00:00Z'
    # An additional later annual fact does not rebuild the old vintage baseline.
    data['entries'].append({'id': 'later-w2', 'person_id': 'john-uuid', 'year': 2023, 'source': 'w2', 'amount_cents': 123456})
    later, _ = import_snapshot(client, data)
    assert later['entries_to_import'] == 1
    assert tracker(client)['selected_forecast']['baseline'] == saved['baseline']


def test_snapshot_reimport_preserves_manual_changes_and_deleted_markers(home):
    _, client = home
    data = snapshot()
    _, request = import_snapshot(client, data)
    retained = tracker(client)
    modified = retained['entries'][0]
    deleted = retained['entries'][1]
    assert client.patch(f"/api/annual-income/entries/{modified['id']}", json={'amount_cents': -333, 'note': 'Manual edit'}).status_code == 200
    assert client.delete(f"/api/annual-income/entries/{deleted['id']}").status_code == 204
    assert client.delete(f"/api/annual-income/forecasts/{retained['selected_forecast']['id']}").status_code == 204
    replay = client.post('/api/annual-income/snapshot/import', json=request)
    assert replay.status_code == 200, replay.text
    assert replay.json()['preserved_changes'] >= 1
    assert replay.json()['deleted_records_skipped'] == 2
    assert len(tracker(client)['entries']) == 2
    assert tracker(client)['forecasts'] == []
    assert next(e for e in tracker(client)['entries'] if e['id'] == modified['id'])['amount_cents'] == -333
    changed_source = copy.deepcopy(data)
    changed_source['entries'][0]['amount_cents'] += 1
    body, preview = preview_import(client, changed_source)
    assert not preview['can_import']
    assert client.post('/api/annual-income/snapshot/import', json=body | {'input_fingerprint': preview['input_fingerprint']}).status_code == 409


def test_snapshot_resolution_is_explicit_and_stale_preview_is_atomic(home):
    _, client = home
    existing = person(client)
    data = snapshot()
    body, preview = preview_import(client, data)
    assert not preview['can_import'] and preview['conflicts'][0]['kind'] == 'person'
    body, resolved = preview_import(client, data, {'john-uuid': existing['id']})
    assert resolved['can_import'] and resolved['summary']['people_to_create'] == 1
    entry(client, existing['id'], year=2020)
    assert client.post('/api/annual-income/snapshot/import', json=body | {'input_fingerprint': resolved['input_fingerprint']}).status_code == 409
    assert len(tracker(client)['entries']) == 1
    import_snapshot(client, data, {'john-uuid': existing['id']})
    assert len(tracker(client)['people']) == 2


@pytest.mark.parametrize('coerced_id', [True, '1', 1.0])
def test_person_resolution_requires_an_explicit_integer(home, coerced_id):
    _, client = home
    person(client)
    result = client.post('/api/annual-income/snapshot/preview', json={
        'snapshot': snapshot(), 'person_resolutions': {'john-uuid': coerced_id}})
    assert result.status_code == 422
    assert tracker(client)['entries'] == []


def test_portable_snapshot_roundtrip_retains_baseline_and_self_deduplicates(home):
    _, client = home
    p = person(client)
    entry(client, p['id'])
    saved = forecast(client)
    exported = client.get('/api/annual-income/snapshot').json()
    result, _ = import_snapshot(client, exported)
    assert result['already_imported'] == 3
    assert len(tracker(client)['entries']) == 1
    assert len(tracker(client)['forecasts']) == 1
    # Import into one's independent personal scope intentionally creates copies.
    import_snapshot(client, exported, scope='personal')
    private = tracker(client, '?scope=personal')
    assert len(private['entries']) == 1 and private['selected_forecast']['baseline_source'] == 'creation_actuals'
    assert [p['amount_cents'] for p in private['selected_forecast']['baseline']] == [p['amount_cents'] for p in saved['baseline']]
    assert private['people'][0]['id'] != p['id']


@pytest.mark.parametrize('mutation', ['duplicate_entry', 'duplicate_person', 'duplicate_point', 'foreign_person', 'baseline_missing_provenance', 'wrong_year', 'nonfinite_params'])
def test_invalid_snapshot_is_rejected_without_partial_changes(home, mutation):
    _, client = home
    data = snapshot()
    if mutation == 'duplicate_entry':
        data['entries'].append(copy.deepcopy(data['entries'][0]))
    elif mutation == 'duplicate_person':
        data['people'].append(copy.deepcopy(data['people'][0]))
    elif mutation == 'duplicate_point':
        data['forecasts'][0]['points'].append(data['forecasts'][0]['points'][0] | {'id': 'different-id'})
    elif mutation == 'foreign_person':
        data['entries'][0]['person_id'] = 'missing-uuid'
    elif mutation == 'baseline_missing_provenance':
        data['forecasts'][0]['baseline'] = [{'person_id': 'john-uuid', 'year': 2024, 'amount_cents': 1}]
    elif mutation == 'wrong_year':
        data['forecasts'][0]['points'][0]['year'] = 2024
    else:
        # JSON's finite validation is exercised directly, not through a client
        # serializer which rejects NaN before an HTTP request can be made.
        with pytest.raises(Exception):
            annual_income.encoded({'rate': float('nan')})
        return
    response = client.post('/api/annual-income/snapshot/preview', json={'snapshot': data})
    assert response.status_code == 422
    assert tracker(client)['people'] == []


@pytest.mark.parametrize('body', [
    {'amount_cents': None}, {'person_id': None}, {'year': None}, {'source': '   '},
    {'amount_cents': True}, {'amount_cents': 1.5}, {'year': 2300}, {'amount_cents': 10**12 + 1},
])
def test_entry_patch_validation(home, body):
    _, client = home
    p = person(client)
    e = entry(client, p['id'])
    assert client.patch(f"/api/annual-income/entries/{e['id']}", json=body).status_code == 422
    assert tracker(client)['entries'][0]['amount_cents'] == 10000000


def test_js_safe_range_bound_huge_history_and_forecast(home):
    path, client = home
    p = person(client)
    # Seed invalid synthetic old database totals; module never emits unsafe JS cents.
    with connect(path) as db:
        db.execute('''INSERT INTO annual_income_entries(household_id,owner_id,scope,portable_id,person_id,year,source,amount_cents)
                      VALUES (1,0,'household','overflow-seed',?,2024,'seed',?)''', (p['id'], annual_income.MAX_SAFE))
    assert client.post('/api/annual-income/entries', json={'person_id': p['id'], 'year': 2025, 'source': 'w2', 'amount_cents': 1}).status_code == 422
    assert client.post('/api/annual-income/forecasts/preview', json=spec()).status_code == 422


def test_scoped_people_entries_forecasts_import_export_membership(home):
    path, client = home
    owner_token = client.headers['Authorization']
    shared = person(client)
    entry(client, shared['id'])
    private = person(client, 'Private person', scope='personal')
    private_entry = entry(client, private['id'], scope='personal')
    private_forecast = forecast(client, scope='personal')
    with connect(path) as db:
        second_id = db.execute('INSERT INTO users(username,display_name,password_hash,household_id) VALUES (?,?,?,1)',
                              ('second', 'Second', password_hash('second-long-password'))).lastrowid
        other_household = db.execute("INSERT INTO households(name,timezone) VALUES ('Other','UTC')").lastrowid
        db.execute('INSERT INTO users(username,display_name,password_hash,household_id) VALUES (?,?,?,?)',
                   ('outsider', 'Outsider', password_hash('outside-long-password'), other_household))
    login = client.post('/api/auth/login', json={'username': 'second', 'password': 'second-long-password'}).json()
    client.headers['Authorization'] = 'Bearer ' + login['token']
    assert tracker(client)['people'][0]['id'] == shared['id']
    assert tracker(client, '?scope=personal')['people'] == []
    for scope in ('personal', 'household'):
        assert client.patch(f"/api/annual-income/people/{private['id']}?scope={scope}", json={'name': 'Stolen'}).status_code == 404
        assert client.patch(f"/api/annual-income/entries/{private_entry['id']}?scope={scope}", json={'amount_cents': 1}).status_code == 404
        assert client.delete(f"/api/annual-income/entries/{private_entry['id']}?scope={scope}").status_code == 404
        assert client.get(f"/api/annual-income/forecasts/{private_forecast['id']}?scope={scope}").status_code == 404
        assert client.delete(f"/api/annual-income/forecasts/{private_forecast['id']}?scope={scope}").status_code == 404
        assert client.post('/api/annual-income/entries?scope=' + scope, json={'person_id': private['id'], 'year': 2024, 'source': 'x', 'amount_cents': 1}).status_code == 404
    assert client.get('/api/annual-income/snapshot?scope=personal').json()['entries'] == []
    assert client.post('/api/annual-income/snapshot/preview', json={'snapshot': snapshot(), 'person_resolutions': {'john-uuid': private['id']}}).status_code == 404
    outsider = client.post('/api/auth/login', json={'username': 'outsider', 'password': 'outside-long-password'}).json()
    client.headers['Authorization'] = 'Bearer ' + outsider['token']
    assert tracker(client)['people'] == []
    assert client.patch(f"/api/annual-income/people/{shared['id']}", json={'name': 'Stolen'}).status_code == 404
    assert 'Private person' not in client.get('/api/annual-income/snapshot').text
    client.headers['Authorization'] = owner_token


def test_corrupt_foreign_person_references_do_not_leak_history_or_forecast_points(home):
    path, client = home
    household = person(client)
    entry(client, household['id'])
    private = person(client, 'Private hidden', scope='personal')
    private_entry = entry(client, private['id'], scope='personal')
    saved = forecast(client)
    with connect(path) as db:
        # References point to a valid foreign scoped person. The scoped join
        # removes these records from monetary reads and portable exports.
        db.execute("UPDATE annual_income_entries SET household_id=1,owner_id=0,scope='household' WHERE id=?", (private_entry['id'],))
        db.execute('UPDATE annual_income_forecast_points SET person_id=? WHERE forecast_id=?', (private['id'], saved['id']))
    result = tracker(client)
    assert len(result['entries']) == 1
    assert result['selected_forecast']['points'] == []
    assert result['selected_forecast']['baseline'] == []
    exported = client.get('/api/annual-income/snapshot').json()
    assert len(exported['entries']) == 1
    assert exported['forecasts'][0]['points'] == []
    assert 'Private hidden' not in str(result)
