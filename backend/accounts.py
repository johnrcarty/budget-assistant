"""Scoped account observations and versioned, dated debt payment allocations."""
import calendar
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException

from . import categories, income, item_details

DEBT_KINDS = ('loan', 'credit')
TRANSACTION_KINDS = ('checking', 'savings', 'credit')
DEBT_FIELDS = ('original_balance_cents', 'apr_basis_points', 'debt_type', 'opened_date', 'term_months', 'notes')


def now_string():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


def lock(db):
    if not db.in_transaction:
        db.execute('BEGIN IMMEDIATE')


def require_account(db, identity, account_id, include_archived=False):
    row = db.execute('SELECT * FROM accounts WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (account_id, *identity)).fetchone()
    if row is None or (row['archived'] and not include_archived):
        raise HTTPException(404, 'Account not found')
    return row


def net_value(balance, kind):
    return -abs(balance) if kind in DEBT_KINDS else balance


def provider_timestamp(value):
    if value is None:
        return None
    try:
        if isinstance(value, bool):
            return None
        result = datetime.fromtimestamp(float(value), timezone.utc)
        if result > datetime.now(timezone.utc) + timedelta(minutes=5):
            return None
        return result.isoformat(timespec='microseconds')
    except (ValueError, TypeError, OverflowError, OSError):
        return None


def observe(db, row, source, provider_as_of=None, observed_at=None, force=False):
    """Immutable observations, with received time separate from provider time."""
    observed_at = observed_at or now_string()
    previous = db.execute('SELECT * FROM account_balance_observations WHERE account_id=? ORDER BY id DESC LIMIT 1', (row['id'],)).fetchone()
    if not force and previous and previous['balance_cents'] == row['balance_cents'] and previous['currency'] == row['currency']:
        if provider_as_of is not None and provider_as_of == previous['provider_as_of']:
            return
    db.execute('''INSERT OR IGNORE INTO account_balance_observations
                  (account_id,observed_at,provider_as_of,effective_at,balance_cents,currency,kind,source)
                  VALUES (?,?,?,?,?,?,?,?)''',
               (row['id'], observed_at, provider_as_of, provider_as_of or observed_at,
                row['balance_cents'], row['currency'], row['kind'], source))


def ensure_observations(db, identity=None):
    query = 'SELECT * FROM accounts WHERE NOT EXISTS (SELECT 1 FROM account_balance_observations o WHERE o.account_id=accounts.id)'
    args = ()
    if identity is not None:
        query += ' AND household_id=? AND owner_id=? AND scope=?'
        args = identity
    rows = db.execute(query, args).fetchall()
    if not rows:
        return
    lock(db)
    timestamp = now_string()
    for row in rows:
        db.execute('UPDATE accounts SET created_at=COALESCE(created_at,?) WHERE id=?', (timestamp, row['id']))
        observe(db, row, 'baseline', observed_at=timestamp)
        if db.execute('SELECT 1 FROM account_valuation_events WHERE account_id=?', (row['id'],)).fetchone() is None:
            db.execute('INSERT INTO account_valuation_events(account_id,observed_at,kind) VALUES (?,?,?)', (row['id'], timestamp, row['kind']))


def schedule_version(db, account_id, month):
    return db.execute('''SELECT * FROM debt_payment_versions WHERE account_id=? AND effective_from<=?
                         AND (effective_to IS NULL OR effective_to>?) ORDER BY effective_from DESC,id DESC LIMIT 1''',
                      (account_id, month + '-01', month + '-01')).fetchone()


def schedule_payload(version):
    if version is None:
        return None
    return {key: version[key] for key in ('amount_cents', 'cadence', 'anchor_date', 'effective_from')} | {
        'day1': int(version['day1']) if version['day1'] != 'last' else 'last',
        'day2': int(version['day2']) if version['day2'] != 'last' else 'last', 'active': bool(version['active'])}


def account_payload(db, row, month):
    upcoming = db.execute('''SELECT * FROM debt_payment_versions WHERE account_id=? AND effective_from>?
                            AND (effective_to IS NULL OR effective_to>effective_from) ORDER BY effective_from,id DESC LIMIT 1''', (row['id'], month + '-01')).fetchone()
    return {key: row[key] for key in ('id', 'name', 'institution', 'kind', 'balance_cents', 'currency', 'source', *DEBT_FIELDS)} | {
        'active': not bool(row['archived']), 'archived_at': row['archived_at'],
        'payment_schedule': schedule_payload(schedule_version(db, row['id'], month)),
        'upcoming_payment_schedule': schedule_payload(upcoming)}


def account_list(db, identity, month):
    income.bounds(month)
    ensure_observations(db, identity)
    return [account_payload(db, row, month) for row in db.execute('SELECT * FROM accounts WHERE household_id=? AND owner_id=? AND scope=? AND archived=0 ORDER BY id', identity)]


def validate_metadata(kind, data):
    if kind not in DEBT_KINDS and any(data.get(field) is not None for field in DEBT_FIELDS):
        raise HTTPException(422, 'Debt details are available for loan and credit accounts')


def create_account(db, identity, payload, month):
    lock(db)
    data = payload.model_dump()
    validate_metadata(data['kind'], data)
    data['name'] = data['name'].strip()
    if not data['name']:
        raise HTTPException(422, 'Enter an account name')
    if data['opened_date']:
        data['opened_date'] = data['opened_date'].isoformat()
    data.update(source='manual', created_at=now_string())
    keys = list(data)
    uid = db.execute('INSERT INTO accounts(household_id,owner_id,scope,' + ','.join(keys) + ') VALUES (' + ','.join('?' for _ in range(3 + len(keys))) + ')', (*identity, *data.values())).lastrowid
    row = require_account(db, identity, uid)
    observe(db, row, 'manual')
    db.execute('INSERT INTO account_valuation_events(account_id,observed_at,kind) VALUES (?,?,?)', (uid, data['created_at'], data['kind']))
    return account_payload(db, row, month)


def update_account(db, identity, account_id, payload, month, today):
    lock(db)
    ensure_observations(db, identity)
    row = require_account(db, identity, account_id)
    updates = payload.model_dump(exclude_unset=True)
    if any(value is None and key not in DEBT_FIELDS for key, value in updates.items()):
        raise HTTPException(422, 'Only optional debt details can be cleared')
    kind = updates.get('kind', row['kind'])
    combined = dict(row) | updates
    validate_metadata(kind, combined)
    if updates.get('currency', row['currency']) != row['currency'] and 'balance_cents' not in updates:
        raise HTTPException(422, 'Enter a balance in the new currency when changing currency')
    if updates.get('currency', row['currency']) != row['currency'] and row['original_balance_cents'] is not None and 'original_balance_cents' not in updates:
        raise HTTPException(422, 'Clear or re-enter the original balance in the new currency')
    active_schedule = db.execute('''SELECT 1 FROM debt_payment_versions WHERE account_id=? AND active=1
                                   AND (effective_to IS NULL OR (effective_to>effective_from AND effective_to>?))''', (account_id, today.replace(day=1).isoformat())).fetchone()
    if active_schedule and (kind not in DEBT_KINDS or combined['currency'] != 'USD'):
        raise HTTPException(409, 'Stop the debt payment schedule before changing account kind or currency')
    if 'name' in updates:
        updates['name'] = updates['name'].strip()
        if not updates['name']:
            raise HTTPException(422, 'Enter an account name')
    if updates.get('opened_date'):
        updates['opened_date'] = updates['opened_date'].isoformat()
    if updates:
        if 'balance_cents' in updates:
            updates['balance_as_of'] = now_string()
        db.execute('UPDATE accounts SET ' + ','.join(f'{key}=?' for key in updates) + ' WHERE id=?', (*updates.values(), account_id))
    changed = require_account(db, identity, account_id)
    if 'balance_cents' in updates and (changed['balance_cents'] != row['balance_cents'] or changed['currency'] != row['currency']):
        observe(db, changed, 'manual', observed_at=updates['balance_as_of'])
    if changed['kind'] != row['kind']:
        db.execute('INSERT INTO account_valuation_events(account_id,observed_at,kind) VALUES (?,?,?)', (account_id, now_string(), changed['kind']))
    if changed['name'] != row['name']:
        db.execute('UPDATE bills SET name=? WHERE debt_account_id=? AND paid=0 AND due_date>=?',
                   (changed['name'] + ' payment', account_id, today.isoformat()))
    materialize_debts(db, identity, today, month)
    return account_payload(db, changed, month)


def import_balance(db, account_row, balance, currency, provider_as_of=None):
    """Ignore known stale provider balances without discarding transactions."""
    if account_row['archived']:
        return False
    if provider_as_of and account_row['balance_as_of'] and provider_as_of < account_row['balance_as_of']:
        return False
    if currency != account_row['currency'] and account_row['original_balance_cents'] is not None:
        return False
    if currency != account_row['currency'] and db.execute('''SELECT 1 FROM debt_payment_versions WHERE account_id=? AND active=1
                                                           AND (effective_to IS NULL OR (effective_to>effective_from AND effective_to>?))''', (account_row['id'], datetime.now().date().replace(day=1).isoformat())).fetchone():
        return False
    db.execute('UPDATE accounts SET balance_cents=?,currency=?,balance_as_of=COALESCE(?,balance_as_of) WHERE id=?', (balance, currency, provider_as_of, account_row['id']))
    row = db.execute('SELECT * FROM accounts WHERE id=?', (account_row['id'],)).fetchone()
    observe(db, row, 'simplefin', provider_as_of)
    return True


def transaction_account(db, identity, account_id, account_name, resolve_name=True):
    if account_id is not None:
        row = require_account(db, identity, account_id)
    elif resolve_name and account_name != 'Manual entry':
        rows = db.execute('SELECT * FROM accounts WHERE household_id=? AND owner_id=? AND scope=? AND archived=0 AND name=?', (*identity, account_name)).fetchall()
        if len(rows) > 1:
            raise HTTPException(409, 'Choose a specific account for this transaction')
        row = rows[0] if rows else None
    else:
        row = None
    if row is not None and row['currency'] != 'USD':
        raise HTTPException(422, 'Transactions in budgets currently require USD accounts')
    return (row['id'], row['name']) if row else (None, account_name)


def archive_account(db, identity, account_id, today):
    lock(db)
    ensure_observations(db, identity)
    row = require_account(db, identity, account_id)
    timestamp = now_string()
    db.execute('UPDATE accounts SET archived=1,archived_at=? WHERE id=?', (timestamp, account_id))
    db.execute('DELETE FROM bills WHERE debt_account_id=? AND paid=0 AND due_date>?', (account_id, today.isoformat()))
    # Historical allocations and transactions remain available. Future rows with
    # existing spending remain too; blank projections can be removed safely.
    db.execute('''DELETE FROM budget_items WHERE managed_account_id=? AND month>? AND NOT EXISTS
                  (SELECT 1 FROM transactions t WHERE t.category_id=budget_items.id) AND NOT EXISTS
                  (SELECT 1 FROM bills b WHERE b.budget_item_id=budget_items.id)''', (account_id, today.strftime('%Y-%m')))


def payment_dates(version, month):
    if version is None or not version['active']:
        return []
    if version['cadence'] == 'monthly':
        first, last = income.bounds(month)
        requested = last.day if version['day1'] == 'last' else int(version['day1'])
        when = first.replace(day=min(requested, last.day))
        start = max(first, date.fromisoformat(version['effective_from']), date.fromisoformat(version['anchor_date']))
        stop = min(last, date.fromisoformat(version['effective_to']) - timedelta(days=1) if version['effective_to'] else last)
        return [(f'm:{month}:1', when)] if start <= when <= stop else []
    schedule = dict(version) | {'superseded': 0}
    return income.planned_occurrences(schedule, month)


def require_managed_mutable(item):
    if item['managed_account_id'] is not None:
        raise HTTPException(409, 'This budget item is managed by its account payment schedule')


def set_schedule(db, identity, account_id, payload, today, month):
    lock(db)
    account = require_account(db, identity, account_id)
    if account['kind'] not in DEBT_KINDS or account['currency'] != 'USD':
        raise HTTPException(422, 'Payment schedules require a USD loan or credit account')
    effective = payload.effective_from or income.next_month_first(today)
    if effective.day != 1:
        raise HTTPException(422, 'Choose the first day of the effective month')
    income.require_effective(effective, today)
    start = effective.isoformat()
    # A changed cadence/phase cannot silently reinterpret already paid dates.
    retained_facts = db.execute('''SELECT b.*,v.cadence,v.anchor_date,v.day1,v.day2 FROM bills b
                                 JOIN debt_payment_versions v ON v.id=b.debt_version_id
                                 WHERE b.debt_account_id=? AND (b.paid=1 OR b.due_date<?) AND b.item_month>=?''', (account_id, today.isoformat(), start[:7])).fetchall()
    def phase(version):
        cadence = version['cadence']
        if cadence in ('weekly', 'biweekly'):
            return cadence, date.fromisoformat(version['anchor_date']).toordinal() % (7 if cadence == 'weekly' else 14)
        return cadence,
    if payload.active and any(phase(row) != phase({'cadence': payload.cadence, 'anchor_date': payload.anchor_date.isoformat()}) for row in retained_facts):
        raise HTTPException(409, 'Paid or overdue payments already exist in affected months. Start the new cadence after those months')
    db.execute('DELETE FROM debt_payment_versions WHERE account_id=? AND effective_from>=? AND id NOT IN (SELECT debt_version_id FROM bills WHERE debt_account_id=? AND debt_version_id IS NOT NULL)', (account_id, start, account_id))
    # Preserve referenced versions for immutable paid/history facts. Their old
    # future applicability ends; new same-effective revision needs its own ID.
    db.execute('UPDATE debt_payment_versions SET effective_to=? WHERE account_id=? AND effective_from<? AND (effective_to IS NULL OR effective_to>?)', (start, account_id, start, start))
    db.execute('UPDATE debt_payment_versions SET effective_to=effective_from WHERE account_id=? AND effective_from>=?', (account_id, start))
    # Same-effective edits keep old referenced rows in an archived revision table
    # by allowing revision IDs, rather than overwriting facts.
    day1 = payload.anchor_date.day if payload.cadence == 'monthly' and 'day1' not in payload.model_fields_set else payload.day1
    db.execute('''INSERT INTO debt_payment_versions(account_id,amount_cents,cadence,anchor_date,day1,day2,active,effective_from)
                  VALUES (?,?,?,?,?,?,?,?)''', (account_id, payload.amount_cents, payload.cadence, payload.anchor_date.isoformat(), str(day1), str(payload.day2), int(payload.active), start))
    # Preserve every paid occurrence and already overdue debt; refresh only
    # unpaid dates that have not passed. Their stable keys retain IDs when possible.
    materialize_debts(db, identity, today, month, refresh_from=start[:7])
    return account_payload(db, require_account(db, identity, account_id), month)


def managed_category(db, identity):
    row = db.execute("SELECT * FROM budget_categories WHERE household_id=? AND owner_id=? AND scope=? AND managed_source='debt_payment'", identity).fetchone()
    if row:
        return row
    name, suffix = 'Debt payments', 1
    while db.execute('SELECT 1 FROM budget_categories WHERE household_id=? AND owner_id=? AND scope=? AND name_key=?', (*identity, categories.name_key(name))).fetchone():
        suffix += 1
        name = f'Debt payments ({suffix})'
    category_id = db.execute('''INSERT INTO budget_categories(household_id,owner_id,scope,name,name_key,color,managed_source)
                  VALUES (?,?,?,?,?,'#a55f46','debt_payment')''', (*identity, name, categories.name_key(name))).lastrowid
    return db.execute('SELECT * FROM budget_categories WHERE id=?', (category_id,)).fetchone()


def ensure_debt_month(db, identity, account, month, today, refresh=False):
    version = schedule_version(db, account['id'], month)
    dates = payment_dates(version, month) if not account['archived'] and account['kind'] in DEBT_KINDS and account['currency'] == 'USD' else []
    existing = db.execute('SELECT * FROM bills WHERE debt_account_id=? AND item_month=? ORDER BY due_date,id', (account['id'], month)).fetchall()
    expected = {key: when for key, when in dates}
    if refresh:
        for bill in existing:
            if not bill['paid'] and bill['due_date'] >= today.isoformat() and bill['debt_occurrence_key'] not in expected:
                db.execute('DELETE FROM bills WHERE id=?', (bill['id'],))
    if not dates and not db.execute('SELECT 1 FROM bills WHERE debt_account_id=? AND item_month=?', (account['id'], month)).fetchone():
        # Stop a blank future projection, retaining monthly identity/history.
        db.execute('UPDATE budget_items SET planned_cents=0 WHERE managed_account_id=? AND month=?', (account['id'], month))
        return
    lineage_id = account['debt_lineage_id']
    if lineage_id is None:
        lineage_id = item_details.create_lineage(db, identity)
        db.execute('UPDATE accounts SET debt_lineage_id=? WHERE id=?', (lineage_id, account['id']))
    category = managed_category(db, identity)
    db.execute('''INSERT OR IGNORE INTO budget_items(household_id,owner_id,scope,month,name,group_name,color,planned_cents,budget_category_id,lineage_id,managed_account_id)
                  VALUES (?,?,?,?,?,?,?,0,?,?,?)''', (*identity, month, account['name'] + ' payment', category['name'], category['color'], category['id'], lineage_id, account['id']))
    item = db.execute('SELECT * FROM budget_items WHERE managed_account_id=? AND month=?', (account['id'], month)).fetchone()
    for key, when in dates:
        old = db.execute('SELECT * FROM bills WHERE debt_account_id=? AND debt_occurrence_key=?', (account['id'], key)).fetchone()
        if old is None:
            db.execute('''INSERT OR IGNORE INTO bills(household_id,owner_id,scope,name,amount_cents,due_date,recurrence,
                          debt_account_id,debt_version_id,debt_occurrence_key,budget_item_id,item_month)
                          VALUES (?,?,?,?,?,?,'none',?,?,?,?,?)''', (*identity, account['name'] + ' payment', version['amount_cents'], when.isoformat(), account['id'], version['id'], key, item['id'], month))
        elif not old['paid'] and old['due_date'] >= today.isoformat() and refresh:
            db.execute('UPDATE bills SET name=?,amount_cents=?,due_date=?,debt_version_id=? WHERE id=?', (account['name'] + ' payment', version['amount_cents'], when.isoformat(), version['id'], old['id']))
    total = db.execute('SELECT COALESCE(SUM(amount_cents),0) n FROM bills WHERE debt_account_id=? AND item_month=?', (account['id'], month)).fetchone()['n']
    db.execute('UPDATE budget_items SET planned_cents=?,name=? WHERE id=?', (total, account['name'] + ' payment', item['id']))


def materialize_debts(db, identity, today, selected_month=None, refresh_from=None):
    lock(db)
    try:
        horizon = today + timedelta(days=14)
    except OverflowError:
        horizon = date.max
    for account in db.execute('SELECT * FROM accounts WHERE household_id=? AND owner_id=? AND scope=?', identity).fetchall():
        months = set()
        earliest = db.execute('SELECT MIN(effective_from) d FROM debt_payment_versions WHERE account_id=?', (account['id'],)).fetchone()['d']
        if earliest and not account['archived']:
            month = earliest[:7]
            while month is not None and month <= horizon.strftime('%Y-%m'):
                months.add(month)
                month = item_details.month_after(month)
        if selected_month:
            months.add(selected_month)
        if refresh_from:
            months.update(row['month'] for row in db.execute('SELECT month FROM budget_items WHERE managed_account_id=? AND month>=?', (account['id'], refresh_from)))
        for month in sorted(months):
            ensure_debt_month(db, identity, account, month, today, refresh=bool(refresh_from and month >= refresh_from))


def account_history(db, identity, account_id):
    account = require_account(db, identity, account_id, include_archived=True)
    ensure_observations(db, identity)
    has_provider = db.execute('SELECT 1 FROM account_balance_observations WHERE account_id=? AND provider_as_of IS NOT NULL LIMIT 1', (account_id,)).fetchone() is not None
    points = [{key: row[key] for key in ('observed_at', 'provider_as_of', 'effective_at', 'balance_cents', 'currency', 'kind', 'source')} |
              {'net_worth_cents': net_value(row['balance_cents'], row['kind']),
               'is_baseline': row['source'] == 'baseline',
               'superseded_by_provider': row['source'] == 'baseline' and has_provider}
              for row in db.execute('SELECT * FROM account_balance_observations WHERE account_id=? ORDER BY effective_at,observed_at,id', (account_id,))]
    valued = [point for point in points if not point['superseded_by_provider']]
    return {'account_id': account_id, 'currency': account['currency'], 'history_starts_at': valued[0]['effective_at'] if valued else None, 'points': points}


def net_worth_history(db, identity):
    """Sweep immutable observations/events once; never fill unknown balances."""
    ensure_observations(db, identity)
    scoped_accounts = [dict(row) for row in db.execute('SELECT * FROM accounts WHERE household_id=? AND owner_id=? AND scope=?', identity)]
    observations = [dict(row) for row in db.execute("""SELECT o.* FROM account_balance_observations o JOIN accounts a ON a.id=o.account_id
                                                      WHERE a.household_id=? AND a.owner_id=? AND a.scope=? ORDER BY o.effective_at,o.observed_at,o.id""", identity)]
    valuations = [dict(row) for row in db.execute("""SELECT e.* FROM account_valuation_events e JOIN accounts a ON a.id=e.account_id
                                               WHERE a.household_id=? AND a.owner_id=? AND a.scope=? ORDER BY e.observed_at,e.id""", identity)]
    provider_accounts = {row['account_id'] for row in observations if row['provider_as_of'] is not None}
    baseline_accounts = {row['account_id'] for row in observations if row['source'] == 'baseline'}
    # A cached baseline has an unknown measurement date. Retain the raw fact,
    # but never let it override a subsequently accepted provider measurement.
    observations = [row for row in observations if row['source'] != 'baseline' or row['account_id'] not in provider_accounts]
    if not observations:
        return {'series': []}
    grouped = {}
    for observation in observations:
        grouped.setdefault(observation['account_id'], []).append(observation)
    first_timestamp = min(observation['effective_at'] for observation in observations)
    timeline = []
    for account in scoped_accounts:
        account_points = grouped.get(account['id'], [])
        if not account_points:
            continue
        first = account_points[0]
        # Migration tells us the account existed, but not when its balance was
        # valid. Include it in coverage before its first amount becomes known.
        coverage_start = first_timestamp if account['id'] in baseline_accounts else min(account['created_at'] or first['effective_at'], first['effective_at'])
        timeline.append((coverage_start, 0, account['id'], 'open', {'currency': first['currency'], 'kind': first['kind']}))
        if account['archived_at']:
            timeline.append((account['archived_at'], 3, account['id'], 'archive', None))
    for observation in observations:
        timeline.append((observation['effective_at'], 2, observation['id'], 'balance', observation))
    for event in valuations:
        timeline.append((event['observed_at'], 1, event['id'], 'kind', event))
    timeline.sort(key=lambda entry: (entry[0], entry[1], entry[2]))
    state, totals, series = {}, {}, {}

    def contribute(account_state, sign):
        if not account_state or not account_state['active']:
            return
        currency = account_state['currency']
        aggregate = totals.setdefault(currency, {'assets_cents': 0, 'liabilities_cents': 0, 'observed_accounts': 0, 'total_accounts': 0})
        aggregate['total_accounts'] += sign
        if account_state['balance'] is None:
            return
        aggregate['observed_accounts'] += sign
        value = net_value(account_state['balance'], account_state['kind'])
        aggregate['liabilities_cents' if account_state['kind'] in DEBT_KINDS else 'assets_cents'] += sign * (-value if account_state['kind'] in DEBT_KINDS else value)

    index = 0
    while index < len(timeline):
        timestamp = timeline[index][0]
        while index < len(timeline) and timeline[index][0] == timestamp:
            _, _, identifier, action, value = timeline[index]
            account_id = identifier if action in ('open', 'archive') else value['account_id']
            current = state.get(account_id)
            contribute(current, -1)
            if action == 'open':
                state[account_id] = {'active': True, 'currency': value['currency'], 'kind': value['kind'], 'balance': None}
            elif current is not None and action == 'archive':
                current['active'] = False
            elif current is not None and action == 'kind':
                current['kind'] = value['kind']
            elif current is not None and action == 'balance':
                current.update(balance=value['balance_cents'], currency=value['currency'])
            contribute(state.get(account_id), 1)
            index += 1
        for currency, aggregate in totals.items():
            points = series.setdefault(currency, [])
            if aggregate['observed_accounts'] or points:
                points.append({'observed_at': timestamp, 'effective_at': timestamp, **aggregate,
                               'net_worth_cents': aggregate['assets_cents'] - aggregate['liabilities_cents'],
                               'complete': aggregate['observed_accounts'] == aggregate['total_accounts']})
    return {'series': [{'currency': currency, 'points': points} for currency, points in sorted(series.items()) if points]}
