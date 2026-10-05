"""Budget item lineage, monthly payment facts, and authoritative bill reminders."""
import calendar
from datetime import date, timedelta

from fastapi import HTTPException

from . import categories


def ensure_lineages(db, identity=None):
    categories.ensure_categories(db, identity)
    query = 'SELECT * FROM budget_items WHERE lineage_id IS NULL'
    parameters = ()
    if identity is not None:
        query += ' AND household_id=? AND owner_id=? AND scope=?'
        parameters = identity
    if db.execute(query + ' LIMIT 1', parameters).fetchone() is None:
        return
    if not db.in_transaction:
        db.execute('BEGIN IMMEDIATE')
    # Legacy monthly copies did not record provenance. Never infer identity
    # from a matching name: every old item starts its own independent lineage.
    for item in db.execute(query + ' ORDER BY id', parameters).fetchall():
        lineage_id = create_lineage(db, (item['household_id'], item['owner_id'], item['scope']))
        db.execute('UPDATE budget_items SET lineage_id=? WHERE id=? AND lineage_id IS NULL', (lineage_id, item['id']))


def create_lineage(db, identity):
    lineage_id = db.execute('INSERT INTO budget_item_lineages(household_id,owner_id,scope) VALUES (?,?,?)', identity).lastrowid
    db.execute('UPDATE budget_item_lineages SET bill_recurrence_key=? WHERE id=?', (f'budget-item:{lineage_id}', lineage_id))
    return lineage_id


def require_item(db, identity, item_id):
    ensure_lineages(db, identity)
    item = db.execute('SELECT * FROM budget_items WHERE id=? AND household_id=? AND owner_id=? AND scope=?',
                      (item_id, *identity)).fetchone()
    if item is None:
        raise HTTPException(404, 'Item not found')
    require_lineage(db, identity, item['lineage_id'])
    return item


def require_lineage(db, identity, lineage_id):
    row = db.execute('SELECT * FROM budget_item_lineages WHERE id=? AND household_id=? AND owner_id=? AND scope=?',
                     (lineage_id, *identity)).fetchone()
    if row is None:
        raise HTTPException(404, 'Item not found')
    return row


def month_after(month):
    year, number = map(int, month.split('-'))
    if year == 9999 and number == 12:
        return None
    return f'{year + (number == 12):04d}-{number % 12 + 1:02d}'


def date_for(month, day):
    year, number = map(int, month.split('-'))
    last = calendar.monthrange(year, number)[1]
    return date(year, number, last if day == 'last' else min(int(day), last)).isoformat()


def due_version(db, lineage_id, month):
    return db.execute('''SELECT * FROM budget_item_due_versions WHERE lineage_id=? AND effective_from<=?
                         AND (effective_to IS NULL OR effective_to>?) ORDER BY effective_from DESC,id DESC LIMIT 1''',
                      (lineage_id, month, month)).fetchone()


def month_bill(db, identity, lineage_id, month):
    return db.execute('''SELECT * FROM bills WHERE household_id=? AND owner_id=? AND scope=?
                         AND budget_item_lineage_id=? AND item_month=?''', (*identity, lineage_id, month)).fetchone()


def payment_paid(db, lineage_id, month):
    row = db.execute('SELECT paid FROM budget_item_payment_facts WHERE lineage_id=? AND month=?', (lineage_id, month)).fetchone()
    return bool(row['paid']) if row else False


def record_payment(db, lineage_id, month, paid):
    db.execute('''INSERT INTO budget_item_payment_facts(lineage_id,month,paid) VALUES (?,?,?)
                  ON CONFLICT(lineage_id,month) DO UPDATE SET paid=excluded.paid''', (lineage_id, month, int(paid)))


def bill_bucket(due_date, today):
    due = date.fromisoformat(due_date)
    try:
        week_end = today + timedelta(days=6 - today.weekday())
        next_end = week_end + timedelta(days=7)
    except OverflowError:
        week_end = next_end = date.max
    if due < today:
        return 'past_due'
    if due == today:
        return 'today'
    if due <= week_end:
        return 'this_week'
    if due <= next_end:
        return 'next_week'
    return 'later'


def occurrence_for_month(db, identity, lineage, month):
    version = due_version(db, lineage['id'], month)
    existing = month_bill(db, identity, lineage['id'], month)
    if existing is not None or version is None or version['due_day'] is None:
        return existing
    plan = db.execute('''SELECT * FROM budget_items WHERE household_id=? AND owner_id=? AND scope=? AND lineage_id=?
                         AND month<=? ORDER BY month DESC,id DESC LIMIT 1''', (*identity, lineage['id'], month)).fetchone()
    if plan is None:
        return None
    due = date_for(month, version['due_day'])
    day = 31 if version['due_day'] == 'last' else int(version['due_day'])
    previous = db.execute('''SELECT autopay FROM bills WHERE household_id=? AND owner_id=? AND scope=?
                             AND budget_item_lineage_id=? AND item_month<=? ORDER BY item_month DESC,id DESC LIMIT 1''',
                          (*identity, lineage['id'], month)).fetchone()
    db.execute('''INSERT OR IGNORE INTO bills(household_id,owner_id,scope,name,amount_cents,due_date,paid,autopay,
                    recurrence,recurrence_key,recurrence_day,budget_item_lineage_id,item_month)
                    VALUES (?,?,?,?,?,?,?,?,'monthly',?,?,?,?)''',
               (*identity, plan['name'], plan['planned_cents'], due, int(payment_paid(db, lineage['id'], month)),
                previous['autopay'] if previous else 0, lineage['bill_recurrence_key'], day, lineage['id'], month))
    return month_bill(db, identity, lineage['id'], month)


def materialize_bills(db, identity, today, selected_month=None, selected_lineage_id=None):
    ensure_lineages(db, identity)
    selected_lineages = set()
    if selected_month is not None and selected_lineage_id is None:
        selected_lineages = {row['lineage_id'] for row in db.execute('''SELECT lineage_id FROM budget_items
                            WHERE household_id=? AND owner_id=? AND scope=? AND month=?''', (*identity, selected_month))}
    try:
        horizon = today + timedelta(days=14)
    except OverflowError:
        horizon = date.max
    horizon_month = horizon.strftime('%Y-%m')
    for lineage in db.execute('''SELECT l.* FROM budget_item_lineages l WHERE l.household_id=? AND l.owner_id=? AND l.scope=?
                                AND EXISTS (SELECT 1 FROM budget_items i WHERE i.lineage_id=l.id AND i.household_id=l.household_id
                                  AND i.owner_id=l.owner_id AND i.scope=l.scope)''', identity).fetchall():
        first = db.execute('SELECT MIN(effective_from) month FROM budget_item_due_versions WHERE lineage_id=?', (lineage['id'],)).fetchone()['month']
        if first is None:
            continue
        month = first
        while month is not None and month <= horizon_month:
            version = due_version(db, lineage['id'], month)
            if version is not None and version['due_day'] is not None and date_for(month, version['due_day']) <= horizon.isoformat():
                occurrence_for_month(db, identity, lineage, month)
            month = month_after(month)
        if selected_month is not None and (lineage['id'] == selected_lineage_id or lineage['id'] in selected_lineages):
            occurrence_for_month(db, identity, lineage, selected_month)


def list_due_dates(db, identity, month, today=None):
    """Read the actual monthly occurrence, including immutable paid dates."""
    if today is not None:
        materialize_bills(db, identity, today, selected_month=month)
    return {row['budget_item_lineage_id']: row['due_date'] for row in db.execute('''SELECT budget_item_lineage_id,due_date
               FROM bills WHERE household_id=? AND owner_id=? AND scope=? AND item_month=?
               AND budget_item_lineage_id IS NOT NULL''', (*identity, month))}


def refresh_unpaid(db, identity, lineage_id, today, from_month=None):
    """Explicit changes affect unpaid current/future occurrences, never history."""
    current_month = today.strftime('%Y-%m')
    for bill in db.execute('''SELECT * FROM bills WHERE household_id=? AND owner_id=? AND scope=?
                             AND budget_item_lineage_id=? AND paid=0''', (*identity, lineage_id)).fetchall():
        month = bill['item_month']
        if month < current_month or (from_month is not None and month < from_month):
            continue
        version = due_version(db, lineage_id, month)
        if version is None or version['due_day'] is None:
            if bill['due_date'] >= today.isoformat():
                db.execute('DELETE FROM bills WHERE id=?', (bill['id'],))
            continue
        plan = db.execute('''SELECT * FROM budget_items WHERE household_id=? AND owner_id=? AND scope=? AND lineage_id=?
                             AND month<=? ORDER BY month DESC,id DESC LIMIT 1''', (*identity, lineage_id, month)).fetchone()
        if plan is not None:
            day = 31 if version['due_day'] == 'last' else int(version['due_day'])
            db.execute('UPDATE bills SET name=?,amount_cents=?,due_date=?,recurrence_day=? WHERE id=?',
                       (plan['name'], plan['planned_cents'], date_for(month, version['due_day']), day, bill['id']))


def adopt_bill(db, identity, item, bill_id):
    lineage = require_lineage(db, identity, item['lineage_id'])
    bill = db.execute('SELECT * FROM bills WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (bill_id, *identity)).fetchone()
    if bill is None:
        raise HTTPException(404, 'Bill not found')
    if bill['debt_account_id'] is not None:
        raise HTTPException(409, 'This reminder is managed by its account payment schedule')
    if bill['budget_item_lineage_id'] == item['lineage_id']:
        return
    if bill['budget_item_lineage_id'] is not None or db.execute('SELECT 1 FROM bills WHERE budget_item_lineage_id=? LIMIT 1', (item['lineage_id'],)).fetchone():
        raise HTTPException(409, 'This item or bill already has a reminder. Keep its existing reminder')
    if bill['due_date'][:7] != item['month']:
        raise HTTPException(422, 'Choose a bill in the selected item month')
    rows = [bill]
    if bill['recurrence_key']:
        rows = db.execute('SELECT * FROM bills WHERE household_id=? AND owner_id=? AND scope=? AND recurrence_key=?', (*identity, bill['recurrence_key'])).fetchall()
    months = [row['due_date'][:7] for row in rows]
    if len(months) != len(set(months)) or any(row['budget_item_lineage_id'] is not None for row in rows):
        raise HTTPException(409, 'This reminder has conflicting monthly occurrences and cannot be attached')
    key = bill['recurrence_key'] or lineage['bill_recurrence_key']
    db.execute('UPDATE budget_item_lineages SET bill_recurrence_key=? WHERE id=?', (key, item['lineage_id']))
    for row in rows:
        month = row['due_date'][:7]
        db.execute('UPDATE bills SET budget_item_lineage_id=?,item_month=?,recurrence_key=?,recurrence=? WHERE id=?',
                   (item['lineage_id'], month, key, 'monthly', row['id']))
        record_payment(db, item['lineage_id'], month, bool(row['paid']))


def set_due(db, identity, item_id, payload, today):
    db.execute('BEGIN IMMEDIATE')
    item = require_item(db, identity, item_id)
    from .accounts import require_managed_mutable
    require_managed_mutable(item)
    if payload.existing_bill_id is not None:
        if payload.due_day is None:
            raise HTTPException(422, 'Choose a recurring due day when attaching a bill')
        adopt_bill(db, identity, item, payload.existing_bill_id)
    month = item['month']
    db.execute('DELETE FROM budget_item_due_versions WHERE lineage_id=? AND effective_from>=?', (item['lineage_id'], month))
    db.execute('UPDATE budget_item_due_versions SET effective_to=? WHERE lineage_id=? AND effective_from<? AND (effective_to IS NULL OR effective_to>?)',
               (month, item['lineage_id'], month, month))
    db.execute('INSERT INTO budget_item_due_versions(lineage_id,due_day,effective_from) VALUES (?,?,?)',
               (item['lineage_id'], None if payload.due_day is None else str(payload.due_day), month))
    refresh_unpaid(db, identity, item['lineage_id'], today, month)
    materialize_bills(db, identity, today, month, item['lineage_id'])


def set_payment(db, identity, item_id, paid, today):
    if not db.in_transaction:
        db.execute('BEGIN IMMEDIATE')
    item = require_item(db, identity, item_id)
    from .accounts import require_managed_mutable
    require_managed_mutable(item)
    materialize_bills(db, identity, today, item['month'], item['lineage_id'])
    bill = month_bill(db, identity, item['lineage_id'], item['month'])
    if bill is not None:
        db.execute('UPDATE bills SET paid=? WHERE id=?', (int(paid), bill['id']))
    record_payment(db, item['lineage_id'], item['month'], paid)


def after_item_delete(db, identity, lineage_id, today):
    if db.execute('SELECT 1 FROM budget_items WHERE household_id=? AND owner_id=? AND scope=? AND lineage_id=? LIMIT 1', (*identity, lineage_id)).fetchone():
        return
    db.execute('DELETE FROM bills WHERE household_id=? AND owner_id=? AND scope=? AND budget_item_lineage_id=? AND paid=0 AND due_date>?',
               (*identity, lineage_id, today.isoformat()))
    month = today.strftime('%Y-%m')
    db.execute('DELETE FROM budget_item_due_versions WHERE lineage_id=? AND effective_from>=?', (lineage_id, month))
    db.execute('UPDATE budget_item_due_versions SET effective_to=? WHERE lineage_id=? AND effective_from<? AND (effective_to IS NULL OR effective_to>?)',
               (month, lineage_id, month, month))
    db.execute('INSERT INTO budget_item_due_versions(lineage_id,due_day,effective_from) VALUES (?,NULL,?)', (lineage_id, month))


def require_transaction(db, identity, transaction_id):
    row = db.execute('SELECT * FROM transactions WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (transaction_id, *identity)).fetchone()
    if row is None:
        raise HTTPException(404, 'Transaction not found')
    return row


def usd_account(db, identity, account_id):
    row = db.execute('SELECT * FROM accounts WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (account_id, *identity)).fetchone()
    if row is None:
        raise HTTPException(404, 'Account not found')
    if row['currency'] != 'USD':
        raise HTTPException(422, 'Only USD transactions can be assigned to this budget')
    return row


def validate_transaction(db, identity, item, transaction):
    if transaction['date'][:7] != item['month']:
        raise HTTPException(422, 'Choose a transaction in the selected item month')
    if transaction['account_id'] is not None:
        usd_account(db, identity, transaction['account_id'])


def link_transaction(db, identity, item_id, transaction_id, replace_existing=False, unlink=False):
    if not db.in_transaction:
        db.execute('BEGIN IMMEDIATE')
    item = require_item(db, identity, item_id)
    transaction = require_transaction(db, identity, transaction_id)
    validate_transaction(db, identity, item, transaction)
    if unlink:
        if transaction['category_id'] != item_id:
            raise HTTPException(409, 'This transaction is no longer assigned to this item')
        db.execute("UPDATE transactions SET category_id=NULL,category_source='manual',categorization_rule_id=NULL WHERE id=? AND category_id=?", (transaction_id, item_id))
    else:
        if transaction['category_id'] not in (None, item_id) and not replace_existing:
            raise HTTPException(409, 'This transaction belongs to another item. Confirm moving it')
        db.execute("UPDATE transactions SET category_id=?,category_source='manual',categorization_rule_id=NULL WHERE id=?", (item_id, transaction_id))


def create_transaction(db, identity, item_id, payload):
    if not db.in_transaction:
        db.execute('BEGIN IMMEDIATE')
    item = require_item(db, identity, item_id)
    if payload.date.isoformat()[:7] != item['month']:
        raise HTTPException(422, 'Choose a transaction date in the selected item month')
    account_id, account_name = payload.account_id, payload.account_name
    if account_id is not None:
        account_name = usd_account(db, identity, account_id)['name']
    else:
        accounts = db.execute('SELECT * FROM accounts WHERE household_id=? AND owner_id=? AND scope=? AND name=?', (*identity, account_name)).fetchall()
        if len(accounts) > 1:
            raise HTTPException(409, 'Choose a specific account for this transaction')
        if accounts:
            account_id = accounts[0]['id']
            usd_account(db, identity, account_id)
    return db.execute('''INSERT INTO transactions(household_id,owner_id,scope,description,amount_cents,date,account_id,account_name,category_id,pending,category_source)
                        VALUES (?,?,?,?,?,?,?,?,?,?,'manual')''',
                      (*identity, payload.description.strip(), payload.amount_cents, payload.date.isoformat(), account_id, account_name, item_id, int(payload.pending))).lastrowid


def transaction_payload(row):
    from .categorization import provenance
    return {key: row[key] for key in ('id', 'description', 'amount_cents', 'date', 'account_name', 'category_id', 'category_name')} | {
        'pending': bool(row['pending']), 'currency': row['currency'] if 'currency' in row.keys() else 'USD'} | provenance(row)


def details(db, identity, item_id, today):
    item = require_item(db, identity, item_id)
    if item['managed_account_id'] is not None:
        from .accounts import materialize_debts
        materialize_debts(db, identity, today, item['month'])
        item = require_item(db, identity, item_id)
    category = categories.require_category(db, identity, item['budget_category_id'])
    materialize_bills(db, identity, today, item['month'], item['lineage_id'])
    bill = month_bill(db, identity, item['lineage_id'], item['month'])
    version = due_version(db, item['lineage_id'], item['month'])
    day = version['due_day'] if version is not None else None
    due = {'due_day': (int(day) if day not in (None, 'last') else day),
           'effective_from': version['effective_from'] if version else None,
           'bill_id': bill['id'] if bill else None, 'due_date': bill['due_date'] if bill else None,
           'paid': bool(bill['paid']) if bill else payment_paid(db, item['lineage_id'], item['month']),
           'bucket': ('paid' if bill['paid'] else bill_bucket(bill['due_date'], today)) if bill else None,
           'amount_cents': bill['amount_cents'] if bill else None,
           'can_adopt_existing_bill': db.execute('SELECT 1 FROM bills WHERE budget_item_lineage_id=? LIMIT 1', (item['lineage_id'],)).fetchone() is None}
    linked = [transaction_payload(row) for row in db.execute('''SELECT t.*,i.name category_name,COALESCE(a.currency,'USD') currency FROM transactions t
                  JOIN budget_items i ON i.id=t.category_id AND i.household_id=t.household_id AND i.owner_id=t.owner_id AND i.scope=t.scope
                  LEFT JOIN accounts a ON a.id=t.account_id AND a.household_id=t.household_id AND a.owner_id=t.owner_id AND a.scope=t.scope
                  WHERE t.household_id=? AND t.owner_id=? AND t.scope=? AND t.category_id=? AND substr(t.date,1,7)=?
                  ORDER BY t.date DESC,t.id DESC''', (*identity, item_id, item['month']))]
    spent = sum(-row['amount_cents'] for row in linked)
    pending = sum(-row['amount_cents'] for row in linked if row['pending'])
    year, number = map(int, item['month'].split('-'))
    ending = (year - 1) * 12 + number - 1
    history = []
    for index in range(max(0, ending - 11), ending + 1):
        month = f'{index // 12 + 1:04d}-{index % 12 + 1:02d}'
        plan = db.execute('''SELECT COALESCE(SUM(planned_cents),0) planned_cents,COUNT(*) count FROM budget_items
                            WHERE household_id=? AND owner_id=? AND scope=? AND lineage_id=? AND month=?''', (*identity, item['lineage_id'], month)).fetchone()
        totals = db.execute('''SELECT COALESCE(SUM(-t.amount_cents),0) spent_cents,
                              COALESCE(SUM(CASE WHEN t.pending=1 THEN -t.amount_cents ELSE 0 END),0) pending_cents
                              FROM transactions t JOIN budget_items i ON i.id=t.category_id
                              AND i.household_id=t.household_id AND i.owner_id=t.owner_id AND i.scope=t.scope
                              WHERE t.household_id=? AND t.owner_id=? AND t.scope=? AND i.lineage_id=? AND substr(t.date,1,7)=?''',
                            (*identity, item['lineage_id'], month)).fetchone()
        history.append({'month': month, 'planned_cents': plan['planned_cents'], 'spent_cents': totals['spent_cents'],
                        'pending_cents': totals['pending_cents'], 'has_plan': bool(plan['count'])})
    available = [{key: row[key] for key in ('id', 'name', 'amount_cents', 'due_date', 'recurrence')} | {'paid': bool(row['paid'])}
                 for row in db.execute('''SELECT * FROM bills WHERE household_id=? AND owner_id=? AND scope=?
                                         AND budget_item_lineage_id IS NULL AND debt_account_id IS NULL AND substr(due_date,1,7)=? ORDER BY due_date,id''', (*identity, item['month']))]
    payments = []
    if item['managed_account_id'] is not None:
        from .app import bill_payload
        payments = [bill_payload(row, today) for row in db.execute('SELECT * FROM bills WHERE budget_item_id=? ORDER BY due_date,id', (item_id,))]
        due.update(due_day=None, effective_from=None, bill_id=None, due_date=None,
                   paid=bool(payments) and all(row['paid'] for row in payments),
                   can_adopt_existing_bill=False, amount_cents=item['planned_cents'])
        available = []
    item_data = categories.item_payload(item, category) | {'month': item['month'], 'lineage_id': item['lineage_id'], 'spent_cents': spent, 'pending_cents': pending}
    if item['managed_account_id'] is not None:
        item_data['payment_dates'] = [row['due_date'] for row in payments]
    return {'item': item_data,
            'month': item['month'], 'category': categories.metadata(category), 'due': due,
            'linked_transactions': linked, 'history': history, 'available_bills': available,
            'payment_occurrences': payments}
