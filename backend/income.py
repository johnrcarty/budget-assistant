"""Versioned income plans and stable, independently editable paychecks.

Schedules use calendar dates, never UTC timestamps. Projected entries are
materialised without updating the legacy scalar or copying schedule templates.
"""
import calendar
from datetime import date, timedelta

from fastapi import HTTPException


def bounds(month):
    try:
        first = date.fromisoformat(month + '-01')
        last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
        return first, last
    except (ValueError, TypeError):
        raise HTTPException(422, 'Use a valid month in YYYY-MM format')


def lock(db):
    # Materialisation and schedule edits must read versions under the same write
    # lock: a stale concurrent GET must never recreate a retired projection.
    if not db.in_transaction:
        db.execute('BEGIN IMMEDIATE')


def next_month_first(today):
    if today.year == 9999 and today.month == 12:
        raise HTTPException(422, 'The schedule cannot extend beyond the calendar')
    return date(today.year + (today.month == 12), today.month % 12 + 1, 1)


def require_effective(day, today):
    if day < today.replace(day=1):
        raise HTTPException(422, 'Schedule changes cannot alter past months')
    return day.isoformat()


def migrate_legacy_income(db):
    """Each old scope/month becomes one editable line, including explicit zero.

    The durable marker prevents a deleted legacy line from reappearing at startup.
    The original scalar stays intact for rollback, but is never added to totals.
    """
    rows = db.execute('''SELECT b.* FROM budget_months b LEFT JOIN income_migrations m
                         ON m.household_id=b.household_id AND m.owner_id=b.owner_id AND m.scope=b.scope AND m.month=b.month
                         WHERE m.month IS NULL''').fetchall()
    for row in rows:
        identity = row['household_id'], row['owner_id'], row['scope']
        # Insert the marker first. An overlapping migration must not insert twice.
        inserted = db.execute('INSERT OR IGNORE INTO income_migrations(household_id,owner_id,scope,month) VALUES (?,?,?,?)',
                              (*identity, row['month'])).rowcount
        if inserted:
            db.execute('''INSERT INTO income_entries(household_id,owner_id,scope,month,name,amount_cents,kind)
                          VALUES (?,?,?,?,'Monthly income',?,'legacy')''',
                       (*identity, row['month'], row['income_cents']))


def mark_migrated(db, identity, month):
    db.execute('INSERT OR IGNORE INTO income_migrations(household_id,owner_id,scope,month) VALUES (?,?,?,?)', (*identity, month))


def replace_legacy(db, identity, month):
    db.execute("DELETE FROM income_entries WHERE household_id=? AND owner_id=? AND scope=? AND month=? AND kind='legacy'", (*identity, month))


def planned_occurrences(version, month):
    """Yield (stable slot key, date), retaining two clamped semimonthly slots."""
    first, last = bounds(month)
    anchor = date.fromisoformat(version['anchor_date'])
    start = max(first, date.fromisoformat(version['effective_from']), anchor)
    stop = min(last, date.fromisoformat(version['effective_to']) if version['effective_to'] else last)
    if version['superseded'] or start > stop:
        return []
    cadence = version['cadence']
    output = []
    if cadence == 'once':
        if start <= anchor <= stop:
            output.append(('d:' + anchor.isoformat(), anchor))
    elif cadence in ('weekly', 'biweekly'):
        step = 7 if cadence == 'weekly' else 14
        jump = max(0, (start - anchor).days + step - 1) // step
        if jump * step > (stop - anchor).days:
            return []
        current = anchor + timedelta(days=jump * step)
        while current <= stop:
            output.append(('d:' + current.isoformat(), current))
            if (stop - current).days < step:
                break
            current += timedelta(days=step)
    else:
        nominal = [anchor.day] if cadence == 'monthly' else [version['day1'], version['day2']]
        for slot, configured in enumerate(nominal, 1):
            requested = last.day if configured == 'last' else int(configured)
            current = first.replace(day=min(requested, last.day))
            if start <= current <= stop:
                output.append((f'm:{month}:{slot}', current))
    return sorted(output, key=lambda occurrence: (occurrence[1], occurrence[0]))


def ensure_month(db, identity, month):
    lock(db)
    migrate_legacy_income(db)
    first, last = bounds(month)
    versions = db.execute('''SELECT v.*,s.household_id,s.owner_id,s.scope FROM income_source_versions v
                             JOIN income_sources s ON s.id=v.source_id
                             WHERE s.household_id=? AND s.owner_id=? AND s.scope=? AND v.superseded=0
                             AND v.effective_from<=? AND (v.effective_to IS NULL OR v.effective_to>=?)
                             ORDER BY v.effective_from,v.id''', (*identity, last.isoformat(), first.isoformat())).fetchall()
    for version in versions:
        for occurrence_key, when in planned_occurrences(version, month):
            excluded = db.execute('''SELECT 1 FROM income_exclusions WHERE household_id=? AND owner_id=? AND scope=?
                                     AND source_id=? AND occurrence_key=?''', (*identity, version['source_id'], occurrence_key)).fetchone()
            if excluded:
                continue
            db.execute('''INSERT OR IGNORE INTO income_entries(household_id,owner_id,scope,month,name,amount_cents,date,
                          scheduled_date,source_id,version_id,occurrence_key,kind)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,'scheduled')''',
                       (*identity, month, version['name'], version['amount_cents'], when.isoformat(), when.isoformat(),
                        version['source_id'], version['id'], occurrence_key))


def total(db, identity, month):
    ensure_month(db, identity, month)
    return db.execute('SELECT COALESCE(SUM(amount_cents),0) FROM income_entries WHERE household_id=? AND owner_id=? AND scope=? AND month=?', (*identity, month)).fetchone()[0]


def entry_payload(row):
    return {key: row[key] for key in ('id', 'month', 'name', 'amount_cents', 'date', 'scheduled_date', 'source_id', 'kind')} | {'overridden': bool(row['overridden'])}


def sources_for(db, identity, month):
    first, last = bounds(month)
    output = []
    sources = db.execute('SELECT * FROM income_sources WHERE household_id=? AND owner_id=? AND scope=? ORDER BY id', identity).fetchall()
    for source in sources:
        versions = db.execute('SELECT * FROM income_source_versions WHERE source_id=? AND superseded=0 ORDER BY effective_from,id', (source['id'],)).fetchall()
        archived = False
        if not versions:
            # A stopped future-only source may still own preserved overrides.
            # Its archived configuration remains visible and can be resumed.
            versions = db.execute('SELECT * FROM income_source_versions WHERE source_id=? ORDER BY effective_from,id', (source['id'],)).fetchall()
            archived = True
        if not versions:
            continue
        applicable = [version for version in versions if version['effective_from'] <= last.isoformat()]
        version = applicable[-1] if applicable else versions[0]
        future = [candidate for candidate in versions if candidate['effective_from'] > last.isoformat()]
        if version['effective_to'] and version['effective_to'] < first.isoformat() and future:
            version = future[0]
        active = not archived and version['effective_from'] <= last.isoformat() and (not version['effective_to'] or version['effective_to'] >= first.isoformat())
        skipped_count = db.execute('''SELECT COUNT(*) FROM income_exclusions WHERE household_id=? AND owner_id=? AND scope=?
                                      AND source_id=? AND (scheduled_date>=? OR scheduled_date IS NULL)''',
                                   (*identity, source['id'], first.isoformat())).fetchone()[0]
        output.append({key: version[key] for key in ('name', 'amount_cents', 'cadence', 'anchor_date', 'effective_from')} |
                      {'id': source['id'], 'day1': 'last' if version['day1'] == 'last' else int(version['day1']),
                       'day2': 'last' if version['day2'] == 'last' else int(version['day2']),
                       'active': active, 'stopped_from': source['stopped_from'], 'skipped_count': skipped_count})
    return output


def month_payload(db, identity, month):
    ensure_month(db, identity, month)
    rows = db.execute('''SELECT * FROM income_entries WHERE household_id=? AND owner_id=? AND scope=? AND month=?
                         ORDER BY COALESCE(date,month||'-01'),id''', (*identity, month)).fetchall()
    return {'entries': [entry_payload(row) for row in rows], 'sources': sources_for(db, identity, month),
            'total_cents': sum(row['amount_cents'] for row in rows)}


def scoped_entry(db, entry_id, identity):
    row = db.execute('SELECT * FROM income_entries WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (entry_id, *identity)).fetchone()
    if not row:
        raise HTTPException(404, 'Income entry not found')
    return row


def scoped_source(db, source_id, identity):
    row = db.execute('SELECT * FROM income_sources WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (source_id, *identity)).fetchone()
    if not row:
        raise HTTPException(404, 'Income source not found')
    return row


def create_entry(db, identity, month, payload):
    ensure_month(db, identity, month)
    entry_month = payload.date.strftime('%Y-%m') if payload.date else month
    bounds(entry_month)
    if payload.replace_legacy:
        replace_legacy(db, identity, entry_month)
    uid = db.execute('''INSERT INTO income_entries(household_id,owner_id,scope,month,name,amount_cents,date,kind)
                        VALUES (?,?,?,?,?,?,?,'manual')''',
                     (*identity, entry_month, payload.name, payload.amount_cents, payload.date.isoformat() if payload.date else None)).lastrowid
    return entry_payload(scoped_entry(db, uid, identity))


def patch_entry(db, identity, entry_id, payload):
    lock(db)
    row = scoped_entry(db, entry_id, identity)
    updates = payload.model_dump(exclude_unset=True)
    if any(value is None for key, value in updates.items() if key != 'date'):
        raise HTTPException(422, 'Only the expected date can be cleared')
    if 'date' in updates and updates['date'] is not None:
        updates['month'] = updates['date'].strftime('%Y-%m')
        updates['date'] = updates['date'].isoformat()
    if updates and row['source_id']:
        updates['overridden'] = 1
    if updates:
        db.execute('UPDATE income_entries SET ' + ','.join(f'{key}=?' for key in updates) + ' WHERE id=?', (*updates.values(), entry_id))
    return entry_payload(scoped_entry(db, entry_id, identity))


def delete_entry(db, identity, entry_id):
    lock(db)
    row = scoped_entry(db, entry_id, identity)
    if row['source_id']:
        db.execute('''INSERT OR IGNORE INTO income_exclusions(household_id,owner_id,scope,source_id,occurrence_key,version_id,scheduled_date)
                      VALUES (?,?,?,?,?,?,?)''',
                   (*identity, row['source_id'], row['occurrence_key'], row['version_id'], row['scheduled_date']))
    db.execute('DELETE FROM income_entries WHERE id=?', (entry_id,))


def insert_version(db, source_id, data, effective):
    return db.execute('''INSERT INTO income_source_versions(source_id,name,amount_cents,cadence,anchor_date,day1,day2,effective_from)
                         VALUES (?,?,?,?,?,?,?,?)''',
                      (source_id, data['name'], data['amount_cents'], data['cadence'], str(data['anchor_date']),
                       str(data['day1']), str(data['day2']), effective)).lastrowid


def create_source(db, identity, month, payload, today):
    ensure_month(db, identity, month)
    effective = require_effective(payload.effective_from or bounds(month)[0], today)
    if payload.replace_legacy:
        replace_legacy(db, identity, effective[:7])
    source_id = db.execute('INSERT INTO income_sources(household_id,owner_id,scope,name) VALUES (?,?,?,?)', (*identity, payload.name)).lastrowid
    insert_version(db, source_id, payload.model_dump(), effective)
    ensure_month(db, identity, month)
    return next(source for source in sources_for(db, identity, month) if source['id'] == source_id)


def retire_after(db, source_id, identity, effective):
    previous = (date.fromisoformat(effective) - timedelta(days=1)).isoformat()
    db.execute('''UPDATE income_source_versions SET effective_to=? WHERE source_id=? AND superseded=0
                  AND effective_from<? AND (effective_to IS NULL OR effective_to>=?)''', (previous, source_id, effective, effective))
    db.execute('UPDATE income_source_versions SET superseded=1 WHERE source_id=? AND effective_from>=?', (source_id, effective))
    # Individual overrides (including a deliberate zero or moved paycheck) survive.
    db.execute('''DELETE FROM income_entries WHERE household_id=? AND owner_id=? AND scope=? AND source_id=?
                  AND overridden=0 AND scheduled_date>=?''', (*identity, source_id, effective))


def patch_source(db, identity, source_id, payload, today, month):
    lock(db)
    scoped_source(db, source_id, identity)
    effective = require_effective(payload.effective_from or next_month_first(today), today)
    baseline = db.execute('''SELECT * FROM income_source_versions WHERE source_id=? AND superseded=0
                             ORDER BY CASE WHEN effective_from<=? THEN 0 ELSE 1 END,effective_from DESC,id DESC LIMIT 1''',
                          (source_id, effective)).fetchone()
    if not baseline:
        baseline = db.execute('SELECT * FROM income_source_versions WHERE source_id=? ORDER BY effective_from DESC,id DESC LIMIT 1', (source_id,)).fetchone()
    if not baseline:
        raise HTTPException(409, 'This income schedule has no saved configuration')
    data = {key: baseline[key] for key in ('name', 'amount_cents', 'cadence', 'anchor_date', 'day1', 'day2')}
    data.update(payload.model_dump(exclude_unset=True, exclude_none=True))
    if data['cadence'] == 'semimonthly' and str(data['day1']) == str(data['day2']):
        raise HTTPException(422, 'Choose two distinct days for twice monthly income')
    def signature(configuration):
        cadence = configuration['cadence']
        if cadence in ('weekly', 'biweekly'):
            return cadence, date.fromisoformat(str(configuration['anchor_date'])).toordinal() % (7 if cadence == 'weekly' else 14)
        if cadence == 'once':
            return cadence, str(configuration['anchor_date'])
        return (cadence,)

    desired = signature(data)
    overrides = db.execute('''SELECT v.cadence,v.anchor_date FROM income_entries e LEFT JOIN income_source_versions v ON v.id=e.version_id
                              WHERE e.household_id=? AND e.owner_id=? AND e.scope=? AND e.source_id=?
                              AND e.overridden=1 AND e.scheduled_date>=?''', (*identity, source_id, effective)).fetchall()
    if any(not original['cadence'] or signature(original) != desired for original in overrides):
        # A cadence/phase change has no unambiguous mapping for an individually
        # edited future paycheck. Preserve it and require an explicit resolution
        # instead of counting it alongside a newly generated replacement.
        raise HTTPException(409, 'Reset or remove the future paycheck overrides before changing this schedule frequency or pay dates')
    skipped = db.execute('''SELECT v.cadence,v.anchor_date FROM income_exclusions e LEFT JOIN income_source_versions v ON v.id=e.version_id
                            WHERE e.household_id=? AND e.owner_id=? AND e.scope=? AND e.source_id=?
                            AND (e.scheduled_date>=? OR e.scheduled_date IS NULL)''', (*identity, source_id, effective)).fetchall()
    if any(not original['cadence'] or signature(original) != desired for original in skipped):
        raise HTTPException(409, 'Restore the future skipped paychecks for this income source before changing its frequency or pay dates')
    retire_after(db, source_id, identity, effective)
    insert_version(db, source_id, data, effective)
    db.execute('UPDATE income_sources SET name=?,stopped_from=NULL WHERE id=?', (data['name'], source_id))
    ensure_month(db, identity, month)
    # Return the newly planned revision even when the viewed month is earlier.
    return {'id': source_id, 'name': data['name'], 'amount_cents': data['amount_cents'], 'cadence': data['cadence'],
            'anchor_date': str(data['anchor_date']), 'effective_from': effective,
            'day1': 'last' if str(data['day1']) == 'last' else int(data['day1']),
            'day2': 'last' if str(data['day2']) == 'last' else int(data['day2']), 'active': True, 'stopped_from': None}


def stop_source(db, identity, source_id, effective, today):
    lock(db)
    scoped_source(db, source_id, identity)
    effective = require_effective(effective or next_month_first(today), today)
    retire_after(db, source_id, identity, effective)
    db.execute('UPDATE income_sources SET stopped_from=? WHERE id=?', (effective, source_id))


def restore_skipped(db, identity, source_id, month, from_date=None):
    """Explicitly undo skips from a chosen calendar date; never resume a source."""
    lock(db)
    scoped_source(db, source_id, identity)
    beginning = (from_date or bounds(month)[0]).isoformat()
    restored = db.execute('''DELETE FROM income_exclusions WHERE household_id=? AND owner_id=? AND scope=? AND source_id=?
                             AND (scheduled_date>=? OR scheduled_date IS NULL)''', (*identity, source_id, beginning)).rowcount
    ensure_month(db, identity, month)
    return {'restored_count': restored}


def reset_entry(db, identity, entry_id):
    lock(db)
    row = scoped_entry(db, entry_id, identity)
    if not row['source_id']:
        raise HTTPException(422, 'Only a scheduled paycheck can be reset')
    month = row['scheduled_date'][:7]
    versions = db.execute('SELECT * FROM income_source_versions WHERE source_id=? AND superseded=0 ORDER BY effective_from,id', (row['source_id'],)).fetchall()
    for version in versions:
        for key, when in planned_occurrences(version, month):
            if key == row['occurrence_key']:
                db.execute('''UPDATE income_entries SET name=?,amount_cents=?,month=?,date=?,scheduled_date=?,version_id=?,overridden=0
                              WHERE id=?''', (version['name'], version['amount_cents'], when.strftime('%Y-%m'), when.isoformat(), when.isoformat(), version['id'], entry_id))
                return entry_payload(scoped_entry(db, entry_id, identity))
    raise HTTPException(409, 'This paycheck is no longer in its schedule. Keep the override or remove the entry')


def save_legacy_total(db, identity, month, amount):
    """Compatibility for the original scalar-income editor; other named lines stay."""
    ensure_month(db, identity, month)
    mark_migrated(db, identity, month)
    existing = db.execute("SELECT id FROM income_entries WHERE household_id=? AND owner_id=? AND scope=? AND month=? AND kind='legacy' ORDER BY id LIMIT 1", (*identity, month)).fetchone()
    if existing:
        db.execute('UPDATE income_entries SET amount_cents=? WHERE id=?', (amount, existing['id']))
        return existing['id']
    uid = db.execute("INSERT INTO income_entries(household_id,owner_id,scope,month,name,amount_cents,kind) VALUES (?,?,?,?,'Monthly income',?,'legacy')",
                     (*identity, month, amount)).lastrowid
    return uid


def copy_monthly_lines(db, identity, source_month, destination_month):
    ensure_month(db, identity, source_month)
    ensure_month(db, identity, destination_month)
    existing = db.execute("SELECT 1 FROM income_entries WHERE household_id=? AND owner_id=? AND scope=? AND month=? AND kind IN ('manual','legacy')", (*identity, destination_month)).fetchone()
    if not existing:
        db.execute('''INSERT INTO income_entries(household_id,owner_id,scope,month,name,amount_cents,kind)
                      SELECT household_id,owner_id,scope,?,name,amount_cents,kind FROM income_entries
                      WHERE household_id=? AND owner_id=? AND scope=? AND month=? AND kind IN ('manual','legacy') AND date IS NULL''',
                   (destination_month, *identity, source_month))
    mark_migrated(db, identity, destination_month)
