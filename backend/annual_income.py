"""Annual taxable income and immutable forecast vintages, separate from cash budgets.

Snapshot import uses source IDs rather than content deduplication: two identical
W-2 entries can be real separate records. A deleted imported record stays marked
as imported, and repeat imports never overwrite later manual edits.
"""
import hashlib
import json
import math
import sqlite3
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import HTTPException

TAX_FIELDS = ('fed_tax_cents', 'state_tax_cents', 'local_tax_cents', 'medicare_cents', 'social_security_cents')
ENTRY_FIELDS = ('person_id', 'year', 'source', 'amount_cents', *TAX_FIELDS, 'note', 'created_at', 'updated_at')
MAX_SAFE = 2**53 - 1
MAX_PEOPLE, MAX_ENTRIES, MAX_FORECASTS, MAX_POINTS = 500, 10000, 500, 50000


def lock(db):
    if not db.in_transaction:
        db.execute('BEGIN IMMEDIATE')


def read_lock(db):
    if not db.in_transaction:
        db.execute('BEGIN')


def now():
    return datetime.now(timezone.utc).isoformat()


def encoded(value):
    try:
        result = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError):
        raise HTTPException(422, 'Use finite JSON values')
    return result


def fingerprint(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


def require(db, table, item_id, identity):
    row = db.execute(f'SELECT * FROM {table} WHERE id=? AND household_id=? AND owner_id=? AND scope=?',
                     (item_id, *identity)).fetchone()
    if row is None:
        raise HTTPException(404, 'Annual income record not found')
    return row


def person_dto(row):
    return {key: row[key] for key in ('id', 'name', 'color', 'sort_order')} | {'active': bool(row['active'])}


def people(db, identity):
    return [person_dto(r) for r in db.execute('''SELECT * FROM annual_income_people
                WHERE household_id=? AND owner_id=? AND scope=? ORDER BY sort_order,name_key,id''', identity)]


def entries(db, identity):
    # Recheck the referenced person's identity in the final query, including for
    # corrupt or old references. No foreign names/IDs or money enter this view.
    return [{key: r[key] for key in ('id', *ENTRY_FIELDS)} for r in db.execute('''
        SELECT e.* FROM annual_income_entries e JOIN annual_income_people p ON p.id=e.person_id
        AND p.household_id=e.household_id AND p.owner_id=e.owner_id AND p.scope=e.scope
        WHERE e.household_id=? AND e.owner_id=? AND e.scope=? ORDER BY e.year,e.person_id,e.id''', identity)]


def safe_money(records, fields=('amount_cents',)):
    if sum(abs(r.get(field) or 0) for r in records for field in fields) > MAX_SAFE:
        raise HTTPException(422, 'Income totals exceed the safe integer range; reduce the data range')


def aggregate(records):
    safe_money(records, ('amount_cents', *TAX_FIELDS))
    amounts = {}
    for e in records:
        key = (e['person_id'], e['year'])
        item = amounts.setdefault(key, {'person_id': key[0], 'year': key[1], 'amount_cents': 0,
                                        'withheld_cents': 0, 'net_cents': 0, 'entry_count': 0})
        item['amount_cents'] += e['amount_cents']
        item['withheld_cents'] += sum(e[k] or 0 for k in TAX_FIELDS)
        item['net_cents'] = item['amount_cents'] - item['withheld_cents']
        item['entry_count'] += 1
    return sorted(amounts.values(), key=lambda r: (r['year'], r['person_id']))


def capacity(db, identity, table, maximum, adding=1):
    n = db.execute(f'SELECT COUNT(*) n FROM {table} WHERE household_id=? AND owner_id=? AND scope=?', identity).fetchone()['n']
    if n + adding > maximum:
        raise HTTPException(422, f'Annual tracker supports at most {maximum} records in this section')


def point_capacity(db, identity, adding):
    n = db.execute('''SELECT COUNT(*) n FROM annual_income_forecast_points p JOIN annual_income_forecasts f ON f.id=p.forecast_id
                      WHERE f.household_id=? AND f.owner_id=? AND f.scope=?''', identity).fetchone()['n']
    if n + adding > MAX_POINTS:
        raise HTTPException(422, 'Annual tracker supports at most 50000 saved forecast points')


def create_person(db, identity, payload):
    lock(db)
    capacity(db, identity, 'annual_income_people', MAX_PEOPLE)
    try:
        person_id = db.execute('''INSERT INTO annual_income_people
            (household_id,owner_id,scope,portable_id,name,name_key,color,sort_order,active) VALUES (?,?,?,?,?,?,?,?,?)''',
            (*identity, str(uuid.uuid4()), payload.name, payload.name.casefold(), payload.color, payload.sort_order, int(payload.active))).lastrowid
    except sqlite3.IntegrityError:
        raise HTTPException(409, 'A person with that name already exists in this tracker')
    return person_dto(require(db, 'annual_income_people', person_id, identity))


def patch_person(db, identity, person_id, payload):
    lock(db)
    row = require(db, 'annual_income_people', person_id, identity)
    values = payload.model_dump(exclude_unset=True)
    if any(values.get(k) is None for k in ('name', 'active', 'sort_order') if k in values):
        raise HTTPException(422, 'Name, order, and active status cannot be empty')
    if 'name' in values:
        values['name_key'] = values['name'].casefold()
    try:
        if values:
            db.execute('UPDATE annual_income_people SET ' + ','.join(k + '=?' for k in values) +
                       ' WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (*values.values(), row['id'], *identity))
    except sqlite3.IntegrityError:
        raise HTTPException(409, 'A person with that name already exists in this tracker')
    return person_dto(require(db, 'annual_income_people', person_id, identity))


def create_entry(db, identity, payload):
    lock(db)
    require(db, 'annual_income_people', payload.person_id, identity)
    capacity(db, identity, 'annual_income_entries', MAX_ENTRIES)
    values = payload.model_dump() | {'created_at': now(), 'updated_at': now()}
    safe_money(entries(db, identity) + [values], ('amount_cents', *TAX_FIELDS))
    entry_id = db.execute('''INSERT INTO annual_income_entries
        (household_id,owner_id,scope,portable_id,''' + ','.join(ENTRY_FIELDS) + ') VALUES (' + ','.join('?' for _ in range(4 + len(ENTRY_FIELDS))) + ')',
        (*identity, str(uuid.uuid4()), *(values[k] for k in ENTRY_FIELDS))).lastrowid
    return {key: require(db, 'annual_income_entries', entry_id, identity)[key] for key in ('id', *ENTRY_FIELDS)}


def patch_entry(db, identity, entry_id, payload):
    lock(db)
    row = require(db, 'annual_income_entries', entry_id, identity)
    changes = payload.model_dump(exclude_unset=True)
    if any(changes.get(k) is None for k in ('person_id', 'year', 'source', 'amount_cents') if k in changes):
        raise HTTPException(422, 'Person, year, source, and gross amount cannot be empty')
    values = {k: row[k] for k in ENTRY_FIELDS} | changes | {'updated_at': now()}
    require(db, 'annual_income_people', values['person_id'], identity)
    safe_money([e for e in entries(db, identity) if e['id'] != entry_id] + [values], ('amount_cents', *TAX_FIELDS))
    db.execute('UPDATE annual_income_entries SET ' + ','.join(k + '=?' for k in ENTRY_FIELDS) +
               ' WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (*(values[k] for k in ENTRY_FIELDS), entry_id, *identity))
    return {'id': entry_id} | values


def delete_entry(db, identity, entry_id):
    lock(db)
    require(db, 'annual_income_entries', entry_id, identity)
    db.execute("UPDATE annual_income_imports SET local_id=NULL WHERE household_id=? AND owner_id=? AND scope=? AND entity='entry' AND local_id=?", (*identity, entry_id))
    db.execute('DELETE FROM annual_income_entries WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (entry_id, *identity))


def js_round(value):
    if not math.isfinite(value) or abs(value) > 10**12:
        raise HTTPException(422, 'Projected income exceeds the supported per-point amount range')
    return math.floor(value + 0.5)


def compute_forecast(actuals, model, params, base_year, horizon_year):
    by_person = defaultdict(list)
    for point in actuals:
        if point['year'] <= base_year:
            by_person[point['person_id']].append(point)
    if not by_person:
        raise HTTPException(422, 'Add reported annual income at or before the base year first')
    result = []
    for person_id, points in sorted(by_person.items()):
        points.sort(key=lambda p: p['year'])
        if model == 'pattern':
            seed = points[-1]
            value = seed['amount_cents']
            rates = params['ratesBps']
            for year in range(seed['year'] + 1, horizon_year + 1):
                value *= 1 + rates[(year - seed['year'] - 1) % len(rates)] / 10000
                if year > base_year:
                    result.append({'person_id': person_id, 'year': year, 'amount_cents': js_round(value)})
        else:
            mean_x = sum(p['year'] for p in points) / len(points)
            mean_y = sum(p['amount_cents'] for p in points) / len(points)
            numerator = sum((p['year'] - mean_x) * (p['amount_cents'] - mean_y) for p in points)
            denominator = sum((p['year'] - mean_x)**2 for p in points)
            slope = numerator / denominator if denominator else 0
            intercept = mean_y - slope * mean_x
            for year in range(base_year + 1, horizon_year + 1):
                result.append({'person_id': person_id, 'year': year, 'amount_cents': js_round(max(0, intercept + slope * year))})
    safe_money(result)
    return result


def forecast_spec(payload):
    return {k: getattr(payload, k) for k in ('name', 'model', 'params', 'base_year', 'horizon_year')}


def preview_forecast(db, identity, payload):
    read_lock(db)
    source = [e for e in entries(db, identity) if e['year'] <= payload.base_year]
    actuals = aggregate(source)
    baseline = [{k: p[k] for k in ('person_id', 'year', 'amount_cents')} for p in actuals]
    points = compute_forecast(actuals, payload.model, payload.params, payload.base_year, payload.horizon_year)
    safe_money(baseline + points)
    point_capacity(db, identity, len(points) + len(baseline))
    spec = forecast_spec(payload)
    digest = fingerprint({'identity': identity, 'spec': spec, 'entries': source})
    return spec | {'baseline': baseline, 'points': points, 'baseline_source': 'creation_actuals',
                   'input_snapshot': {'entries': source, 'actuals': baseline}, 'input_fingerprint': digest}


def forecast_metadata(row):
    return {k: row[k] for k in ('id', 'name', 'model', 'base_year', 'horizon_year', 'created_at', 'baseline_source', 'baseline_recorded_at')} | {'params': json.loads(row['params'])}


def forecast_detail(db, identity, forecast_id):
    row = require(db, 'annual_income_forecasts', forecast_id, identity)
    baseline, points = [], []
    for p in db.execute('''SELECT q.* FROM annual_income_forecast_points q JOIN annual_income_people p ON p.id=q.person_id
                          AND p.household_id=? AND p.owner_id=? AND p.scope=? WHERE q.forecast_id=?
                          ORDER BY q.year,q.person_id''', (*identity, forecast_id)):
        (baseline if p['kind'] == 'baseline' else points).append({k: p[k] for k in ('person_id', 'year', 'amount_cents')})
    safe_money(baseline + points)
    allowed = {p['id'] for p in people(db, identity)}
    snapshot = json.loads(row['input_snapshot'])
    snapshot = {'actuals': [p for p in snapshot.get('actuals', []) if p.get('person_id') in allowed],
                'entries': [e for e in snapshot.get('entries', []) if e.get('person_id') in allowed]}
    return forecast_metadata(row) | {'baseline': baseline, 'points': points, 'input_snapshot': snapshot,
                                     'input_fingerprint': row['input_fingerprint']}


def insert_forecast(db, identity, values, baseline, points, snapshot, provenance, created_at=None, source_namespace=None):
    forecast_id = db.execute('''INSERT INTO annual_income_forecasts
        (household_id,owner_id,scope,portable_id,name,model,params,base_year,horizon_year,created_at,input_snapshot,baseline_source,baseline_recorded_at,input_fingerprint)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
        (*identity, str(uuid.uuid4()), values['name'], values['model'], encoded(values['params']), values['base_year'], values['horizon_year'],
         created_at, encoded(snapshot), provenance, values.get('baseline_recorded_at', created_at), values.get('input_fingerprint'))).lastrowid
    for kind, records in (('baseline', baseline), ('projected', points)):
        db.executemany('''INSERT INTO annual_income_forecast_points(portable_id,forecast_id,person_id,year,amount_cents,kind,source_id,source_namespace)
                          VALUES (?,?,?,?,?,?,?,?)''', [(str(uuid.uuid4()), forecast_id, p['person_id'], p['year'], p['amount_cents'], kind,
                          p.get('id') if source_namespace else None, source_namespace) for p in records])
    return forecast_id


def create_forecast(db, identity, payload):
    lock(db)
    body_hash = fingerprint(payload.model_dump(exclude={'idempotency_key'}))
    if payload.idempotency_key:
        marker = db.execute('''SELECT * FROM annual_income_forecast_requests
            WHERE household_id=? AND owner_id=? AND scope=? AND idempotency_key=?''', (*identity, payload.idempotency_key)).fetchone()
        if marker:
            if marker['request_fingerprint'] != body_hash or marker['forecast_id'] is None:
                raise HTTPException(409, 'This forecast request was already used or removed; start a new preview')
            return forecast_detail(db, identity, marker['forecast_id'])
    capacity(db, identity, 'annual_income_forecasts', MAX_FORECASTS)
    preview = preview_forecast(db, identity, payload)
    if preview['input_fingerprint'] != payload.input_fingerprint:
        raise HTTPException(409, 'Reported income changed after the preview; preview the forecast again')
    forecast_id = insert_forecast(db, identity, preview, preview['baseline'], preview['points'], preview['input_snapshot'], 'creation_actuals', now())
    if payload.idempotency_key:
        db.execute('''INSERT INTO annual_income_forecast_requests(household_id,owner_id,scope,idempotency_key,request_fingerprint,forecast_id)
                      VALUES (?,?,?,?,?,?)''', (*identity, payload.idempotency_key, body_hash, forecast_id))
    return forecast_detail(db, identity, forecast_id)


def delete_forecast(db, identity, forecast_id):
    lock(db)
    require(db, 'annual_income_forecasts', forecast_id, identity)
    db.execute("UPDATE annual_income_imports SET local_id=NULL WHERE household_id=? AND owner_id=? AND scope=? AND entity='forecast' AND local_id=?", (*identity, forecast_id))
    db.execute('DELETE FROM annual_income_forecasts WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (forecast_id, *identity))


def tracker(db, identity, current_year, through_year, forecast_id=None):
    read_lock(db)
    persons = people(db, identity)
    records = [e for e in entries(db, identity) if e['year'] <= through_year]
    actuals = aggregate(records)
    by_year = {}
    active = {p['id'] for p in persons if p['active']}
    for p in actuals:
        y = by_year.setdefault(p['year'], {'year': p['year'], 'amount_cents': 0, 'withheld_cents': 0, 'net_cents': 0, 'reported_person_ids': []})
        for k in ('amount_cents', 'withheld_cents', 'net_cents'):
            y[k] += p[k]
        y['reported_person_ids'].append(p['person_id'])
    for y in by_year.values():
        y['person_count'] = len(y['reported_person_ids'])
        y['missing_person_ids'] = sorted(active - set(y['reported_person_ids']))
        y['coverage'] = 'reported'  # Existence of a record never proves a full year.
        y['person_coverage'] = 'partial' if y['missing_person_ids'] else 'all_reported'
    vintages = [forecast_metadata(r) for r in db.execute('''SELECT * FROM annual_income_forecasts
        WHERE household_id=? AND owner_id=? AND scope=? ORDER BY created_at DESC,id DESC''', identity)]
    selected = None
    if forecast_id != 'none':
        if forecast_id is None:
            selected_id = vintages[0]['id'] if vintages else None
        else:
            try:
                selected_id = int(forecast_id)
            except (TypeError, ValueError):
                raise HTTPException(422, 'Choose a forecast ID or none')
        if selected_id is not None:
            selected = forecast_detail(db, identity, selected_id)
            selected['points'] = [p for p in selected['points'] if p['year'] <= through_year]
            selected['baseline'] = [p for p in selected['baseline'] if p['year'] <= through_year]
            selected['input_snapshot'] = {
                key: [r for r in records if r['year'] <= through_year]
                for key, records in selected['input_snapshot'].items()}
            # Charts compare actuals against forecasts and can subtract signed
            # values. Bound their combined magnitude, not just each series.
            safe_money([{'amount_cents': sum(abs(e[k] or 0) for e in records for k in ('amount_cents', *TAX_FIELDS))}]
                       + selected['baseline'] + selected['points'])
    return {'currency': 'USD', 'current_year': current_year, 'through_year': through_year, 'people': persons,
            'entries': records, 'actuals': actuals, 'year_totals': sorted(by_year.values(), key=lambda r: r['year']),
            'forecasts': vintages, 'selected_forecast': selected}


def snapshot_export(db, identity, namespace):
    read_lock(db)
    persons = list(db.execute('''SELECT * FROM annual_income_people WHERE household_id=? AND owner_id=? AND scope=?
                                ORDER BY sort_order,name_key,id''', identity))
    portable = {p['id']: p['portable_id'] for p in persons}
    records = []
    for e in entries(db, identity):
        row = require(db, 'annual_income_entries', e['id'], identity)
        records.append(e | {'id': row['portable_id'], 'person_id': portable[e['person_id']]})
    forecasts = []
    for f in db.execute('SELECT * FROM annual_income_forecasts WHERE household_id=? AND owner_id=? AND scope=? ORDER BY id', identity):
        value = {k: f[k] for k in ('name', 'model', 'base_year', 'horizon_year', 'created_at', 'baseline_source', 'baseline_recorded_at')}
        value |= {'id': f['portable_id'], 'params': json.loads(f['params']), 'points': [], 'baseline': []}
        for p in db.execute('SELECT * FROM annual_income_forecast_points WHERE forecast_id=? ORDER BY year,person_id', (f['id'],)):
            if p['person_id'] not in portable:
                continue
            point = {'person_id': portable[p['person_id']], 'year': p['year'], 'amount_cents': p['amount_cents']}
            if p['kind'] == 'projected':
                value['points'].append(point | {'id': p['portable_id']})
            else:
                value['baseline'].append(point)
        forecasts.append(value)
    return {'format': 'budget-assistant-annual-income', 'version': 1,
            'source': {'kind': 'budget-assistant', 'household_id': namespace, 'exported_at': now()},
            'people': [person_dto(p) | {'id': p['portable_id']} for p in persons], 'entries': records, 'forecasts': forecasts}


def snapshot_namespace(snapshot):
    return snapshot.source.kind + ':' + snapshot.source.household_id


def snapshot_data(payload):
    snapshot = payload.snapshot.model_dump()
    if len(encoded(snapshot).encode()) > 10 * 1024 * 1024:
        raise HTTPException(422, 'Snapshot must be no more than 10 MiB')
    for f in snapshot['forecasts']:
        if len(encoded(f['params']).encode()) > 16384:
            raise HTTPException(422, 'Forecast parameters must be no more than 16 KiB')
    safe_money(snapshot['entries'], ('amount_cents', *TAX_FIELDS))
    # Missing baseline is reconstructed only from the import snapshot, not later
    # runtime edits. Provenance explicitly disclaims original creation knowledge.
    actuals = aggregate(snapshot['entries'])
    for f in snapshot['forecasts']:
        if f['baseline'] is None:
            f['baseline'] = [{k: p[k] for k in ('person_id', 'year', 'amount_cents')} for p in actuals if p['year'] <= f['base_year']]
            f['baseline_source'] = 'legacy_import_actuals'
            f['baseline_recorded_at'] = snapshot['source']['exported_at']
        safe_money(f['baseline'] + f['points'])
    if sum(len(f['baseline']) + len(f['points']) for f in snapshot['forecasts']) > MAX_POINTS:
        raise HTTPException(422, 'Snapshot supports at most 50000 forecast points including reconstructed baselines')
    return snapshot


def import_plan(db, identity, payload):
    read_lock(db)
    data = snapshot_data(payload)
    source_forecasts = {f.id: f.model_dump() for f in payload.snapshot.forecasts}
    namespace = snapshot_namespace(payload.snapshot)
    existing_people = {p['id']: p for p in people(db, identity)}
    current_entries = entries(db, identity)
    current_entry_by_id = {e['id']: e for e in current_entries}
    names = {p['name'].casefold(): p['id'] for p in existing_people.values()}
    incoming_ids = {p['id'] for p in data['people']}
    if set(payload.person_resolutions) - incoming_ids:
        raise HTTPException(422, 'A person resolution refers to a person absent from the snapshot')
    # 404, without any foreign person's name, for attempted scope bypass.
    for person_id in payload.person_resolutions.values():
        require(db, 'annual_income_people', person_id, identity)
    mapping_rows = [dict(r) for r in db.execute('''SELECT * FROM annual_income_imports
                      WHERE household_id=? AND owner_id=? AND scope=? AND namespace=? ORDER BY entity,external_id''', (*identity, namespace))]
    mappings = {(r['entity'], r['external_id']): r for r in mapping_rows}
    source_person_ids = {m['local_id']: m['external_id'] for m in mapping_rows if m['entity'] == 'person'}
    exported = snapshot_export(db, identity, 'local')
    portable_records = {kind: {r['id']: r for r in exported[collection]} for kind, collection in
                        (('person', 'people'), ('entry', 'entries'), ('forecast', 'forecasts'))}
    portable_local_ids = {kind: {r['portable_id']: r['id'] for r in db.execute(
        f'SELECT id,portable_id FROM {table} WHERE household_id=? AND owner_id=? AND scope=?', identity)}
        for kind, table in (('person', 'annual_income_people'), ('entry', 'annual_income_entries'), ('forecast', 'annual_income_forecasts'))}
    actions, conflicts = [], []
    resolved = {}
    summary = {'people_to_create': 0, 'entries_to_import': 0, 'forecasts_to_import': 0, 'already_imported': 0,
               'preserved_changes': 0, 'deleted_records_skipped': 0}
    for kind, collection in (('person', data['people']), ('entry', data['entries']), ('forecast', data['forecasts'])):
        for record in collection:
            marker = mappings.get((kind, record['id']))
            # A legacy export has no original baseline. Its reconstructed
            # baseline and recording date are generated once at first import;
            # subsequent backup dates or new actuals must not change the source
            # fingerprint of the already materialized forecast vintage.
            source_record = source_forecasts[record['id']] if kind == 'forecast' else record
            digest = fingerprint(source_record)
            if marker:
                if marker['fingerprint'] != digest:
                    conflicts.append({'kind': kind, 'id': record['id'], 'message': 'This source ID was previously imported with different data; existing history will not be overwritten'})
                else:
                    summary['already_imported'] += 1
                    if marker['local_id'] is None:
                        summary['deleted_records_skipped'] += 1
                    elif kind == 'person':
                        current = existing_people.get(marker['local_id'])
                        if current and fingerprint(current | {'id': record['id']}) != digest:
                            summary['preserved_changes'] += 1
                    elif kind == 'entry':
                        current = current_entry_by_id.get(marker['local_id'])
                        if current:
                            incoming_person = source_person_ids.get(current['person_id'])
                            if fingerprint(current | {'id': record['id'], 'person_id': incoming_person}) != digest:
                                summary['preserved_changes'] += 1
                if kind == 'person':
                    local = marker['local_id']
                    if local not in existing_people:
                        conflicts.append({'kind': kind, 'id': record['id'], 'message': 'Previously resolved person is unavailable'})
                    if record['id'] in payload.person_resolutions and payload.person_resolutions[record['id']] != local:
                        conflicts.append({'kind': kind, 'id': record['id'], 'message': 'This person was already resolved to another person'})
                    resolved[record['id']] = local
                continue
            local_id = portable_local_ids[kind].get(record['id'])
            if local_id is not None:
                if fingerprint(portable_records[kind][record['id']]) != digest:
                    conflicts.append({'kind': kind, 'id': record['id'], 'message': 'This portable record already exists with different data; it will not be overwritten'})
                summary['already_imported'] += 1
                if kind == 'person':
                    resolved[record['id']] = local_id
                    if record['id'] in payload.person_resolutions and payload.person_resolutions[record['id']] != local_id:
                        conflicts.append({'kind': kind, 'id': record['id'], 'message': 'This portable person already belongs to another person'})
                actions.append({'kind': kind, 'record': record, 'fingerprint': digest, 'existing_local': local_id})
                continue
            action = {'kind': kind, 'record': record, 'fingerprint': digest}
            if kind == 'person':
                target = payload.person_resolutions.get(record['id'])
                if target is None and record['name'].casefold() in names:
                    conflicts.append({'kind': kind, 'id': record['id'], 'message': 'A person with this name already exists; explicitly resolve the snapshot person'})
                resolved[record['id']] = target
                action['target'] = target
                if target is None:
                    summary['people_to_create'] += 1
            else:
                summary['entries_to_import' if kind == 'entry' else 'forecasts_to_import'] += 1
            actions.append(action)
    # Resolutions must not collapse distinct person/year forecast points.
    for f in data['forecasts']:
        for points in (f['baseline'], f['points']):
            keys = [(resolved.get(p['person_id']) or 'new:' + p['person_id'], p['year']) for p in points]
            if len(keys) != len(set(keys)):
                conflicts.append({'kind': 'forecast', 'id': f['id'], 'message': 'Person resolution would merge distinct saved forecast points'})
    capacity(db, identity, 'annual_income_people', MAX_PEOPLE, summary['people_to_create'])
    capacity(db, identity, 'annual_income_entries', MAX_ENTRIES, summary['entries_to_import'])
    capacity(db, identity, 'annual_income_forecasts', MAX_FORECASTS, summary['forecasts_to_import'])
    safe_money(current_entries + [a['record'] for a in actions if a['kind'] == 'entry' and 'existing_local' not in a], ('amount_cents', *TAX_FIELDS))
    point_capacity(db, identity, sum(len(a['record']['points']) + len(a['record']['baseline']) for a in actions if a['kind'] == 'forecast' and 'existing_local' not in a))
    # Capture scoped state too: preview/apply cannot silently resolve against a
    # changed name, deleted marker, or edited historical input.
    state = {'people': list(existing_people.values()), 'entries': current_entries, 'mappings': mapping_rows,
             'forecasts': [dict(r) for r in db.execute('SELECT * FROM annual_income_forecasts WHERE household_id=? AND owner_id=? AND scope=? ORDER BY id', identity)]}
    digest = fingerprint({'identity': identity, 'snapshot': data, 'resolutions': payload.person_resolutions, 'state': state})
    return {'input_fingerprint': digest, 'can_import': not conflicts, 'summary': summary, 'conflicts': conflicts}, actions, resolved, namespace


def preview_import(db, identity, payload):
    return import_plan(db, identity, payload)[0]


def apply_import(db, identity, payload):
    lock(db)
    preview, actions, resolved, namespace = import_plan(db, identity, payload)
    if payload.input_fingerprint != preview['input_fingerprint']:
        # Same input after an acknowledged import has a different state hash.
        # Exact repeat is safe when no new records and no source conflicts.
        if actions or preview['conflicts']:
            raise HTTPException(409, 'Annual history changed after preview; preview the snapshot again')
    if preview['conflicts']:
        raise HTTPException(409, {'message': 'Resolve snapshot conflicts before importing', 'conflicts': preview['conflicts']})
    for action in actions:
        kind, record = action['kind'], action['record']
        if 'existing_local' in action:
            local_id = action['existing_local']
        elif kind == 'person':
            local_id = action['target']
            if local_id is None:
                local_id = db.execute('''INSERT INTO annual_income_people(household_id,owner_id,scope,portable_id,name,name_key,color,sort_order,active)
                    VALUES (?,?,?,?,?,?,?,?,?)''', (*identity, str(uuid.uuid4()), record['name'], record['name'].casefold(), record['color'], record['sort_order'], int(record['active']))).lastrowid
            resolved[record['id']] = local_id
        elif kind == 'entry':
            values = record | {'person_id': resolved[record['person_id']]}
            local_id = db.execute('INSERT INTO annual_income_entries(household_id,owner_id,scope,portable_id,' + ','.join(ENTRY_FIELDS) +
                    ') VALUES (' + ','.join('?' for _ in range(4 + len(ENTRY_FIELDS))) + ')',
                    (*identity, str(uuid.uuid4()), *(values[k] for k in ENTRY_FIELDS))).lastrowid
        else:
            baseline = [p | {'person_id': resolved[p['person_id']]} for p in record['baseline']]
            points = [p | {'person_id': resolved[p['person_id']]} for p in record['points']]
            local_id = insert_forecast(db, identity, record, baseline, points, {'entries': [], 'actuals': baseline}, record['baseline_source'], record['created_at'], namespace)
        db.execute('''INSERT INTO annual_income_imports(household_id,owner_id,scope,namespace,entity,external_id,local_id,fingerprint)
                      VALUES (?,?,?,?,?,?,?,?)''', (*identity, namespace, kind, record['id'], local_id, action['fingerprint']))
    return preview['summary'] | {'imported': True}
