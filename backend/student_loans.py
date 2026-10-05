"""Explicit borrower/servicer groups; real accounts remain valuation facts."""
from decimal import Decimal, ROUND_HALF_UP
import sqlite3

from fastapi import HTTPException


def group_context(db, identity):
    return {row['id']: row for row in db.execute('''SELECT * FROM student_loan_groups
                 WHERE household_id=? AND owner_id=? AND scope=? AND active=1 ORDER BY id''', identity)}


def role(row, groups):
    if row['student_loan_group_id'] in groups:
        return groups[row['student_loan_group_id']], 'child'
    return next(((group, 'reported_total') for group in groups.values()
                 if group['reported_account_id'] == row['id']), (None, None))


def require_group(db, identity, group_id, active=True):
    row = db.execute('''SELECT * FROM student_loan_groups WHERE id=?
                       AND household_id=? AND owner_id=? AND scope=?''', (group_id, *identity)).fetchone()
    if row is None or (active and not row['active']):
        raise HTTPException(404, 'Student loan group not found')
    return row


def set_inclusion(db, account, included, *, group_id=None, timestamp=None, force=False):
    from .accounts import now_string
    included = bool(included)
    if not force and bool(account['net_worth_included']) == included:
        return
    db.execute('UPDATE accounts SET net_worth_included=? WHERE id=?', (int(included), account['id']))
    db.execute('''INSERT INTO account_net_worth_events(account_id,observed_at,included,group_id,reason)
                  VALUES (?,?,?,?,?)''', (account['id'], timestamp or now_string(), int(included), group_id,
                                          'student_loan_group' if group_id is not None else 'manual'))


def validate_member(group, account):
    if account['kind'] != 'loan' or account['debt_type'] != 'student':
        raise HTTPException(422, 'Student loan groups require loan accounts classified as student loans')
    if account['currency'] != group['currency']:
        raise HTTPException(422, 'All accounts in a student loan group must use its currency')


def prepare_new_child(db, identity, data):
    if data['student_loan_group_id'] is None:
        return None
    group = require_group(db, identity, data['student_loan_group_id'])
    validate_member(group, data)
    data['net_worth_included'] = group['valuation_mode'] == 'individual_loans'
    return group


def account_edit_error(db, identity, account, changed):
    group, membership = role(account, group_context(db, identity))
    if group is None:
        return None
    if changed['kind'] != 'loan' or changed['debt_type'] != 'student' or changed['currency'] != group['currency']:
        return 409, 'Detach this account from its student loan group before changing classification or currency'
    if bool(changed['net_worth_included']) != bool(account['net_worth_included']):
        return 409, 'Change the student loan group valuation source to change grouped account inclusion'
    return None


def archive_error(db, identity, account):
    group, membership = role(account, group_context(db, identity))
    if group is not None and membership == 'reported_total' and group['valuation_mode'] == 'servicer_total':
        return 409, 'Choose another valuation source or archive the group before archiving its authoritative total'
    return None


def validate_accounts(db, identity, payload, group_id=None):
    from .accounts import require_account
    prospective = {'currency': payload.currency}
    ids = payload.child_account_ids + ([payload.reported_account_id] if payload.reported_account_id is not None else [])
    result = {}
    groups = group_context(db, identity)
    for account_id in ids:
        account = require_account(db, identity, account_id, include_archived=True)
        validate_member(prospective, account)
        existing_group, membership = role(account, groups)
        if account['archived'] and (existing_group is None or existing_group['id'] != group_id):
            raise HTTPException(422, 'Archived accounts can only retain their existing group membership')
        if account['archived'] and account_id == payload.reported_account_id and payload.valuation_mode == 'servicer_total':
            raise HTTPException(422, 'The authoritative servicer total must be active')
        if existing_group is not None and existing_group['id'] != group_id:
            raise HTTPException(409, 'This account already belongs to another student loan group')
        result[account_id] = account
    return result


def guard_source_switch(db, identity, previous, payload, members):
    """A source change must account for every debt it formerly counted.

    Ordinary detachment preserves the last explicit inclusion decision. During
    a source switch, however, dropping a counted role would leave its old debt
    included alongside the new authority without any visible group reference.
    Retain it in a role so the same transaction can record its new inclusion.
    """
    if not previous['active']:
        return
    source_changed = (previous['valuation_mode'] != payload.valuation_mode
                      or (payload.valuation_mode == 'servicer_total'
                          and previous['reported_account_id'] != payload.reported_account_id))
    if not source_changed:
        return
    omitted = db.execute('''SELECT id FROM accounts WHERE household_id=? AND owner_id=? AND scope=?
                         AND archived=0 AND net_worth_included=1
                         AND (student_loan_group_id=? OR id=?)''',
                         (*identity, previous['id'], previous['reported_account_id'])).fetchall()
    if any(account['id'] not in members for account in omitted):
        raise HTTPException(409, 'Keep previously counted accounts in the group when changing its valuation source; detach them after the source change')


def save_group(db, identity, payload, month, today, group_id=None):
    from .accounts import lock, now_string
    lock(db)
    previous = require_group(db, identity, group_id, active=False) if group_id is not None else None
    members = validate_accounts(db, identity, payload, group_id)
    if previous is not None:
        guard_source_switch(db, identity, previous, payload, members)
    timestamp = now_string()
    values = (payload.name, payload.name.strip().casefold(), payload.borrower, payload.servicer,
              payload.currency, payload.valuation_mode, payload.reported_account_id)
    try:
        if group_id is None:
            group_id = db.execute('''INSERT INTO student_loan_groups
                         (household_id,owner_id,scope,name,name_key,borrower,servicer,currency,valuation_mode,reported_account_id)
                         VALUES (?,?,?,?,?,?,?,?,?,?)''', (*identity, *values)).lastrowid
        else:
            db.execute('''UPDATE student_loan_groups SET name=?,name_key=?,borrower=?,servicer=?,currency=?,
                          valuation_mode=?,reported_account_id=?,active=1 WHERE id=?''', (*values, group_id))
    except sqlite3.IntegrityError:
        raise HTTPException(409, 'A student loan group with that name already exists') from None
    # Detaching retains the last valuation decision. No silent independent debt.
    db.execute('''UPDATE accounts SET student_loan_group_id=NULL WHERE student_loan_group_id=?
                  AND household_id=? AND owner_id=? AND scope=?''', (group_id, *identity))
    for account_id in payload.child_account_ids:
        db.execute('UPDATE accounts SET student_loan_group_id=? WHERE id=?', (group_id, account_id))
        set_inclusion(db, members[account_id], payload.valuation_mode == 'individual_loans',
                      group_id=group_id, timestamp=timestamp)
    if payload.reported_account_id is not None:
        set_inclusion(db, members[payload.reported_account_id], payload.valuation_mode == 'servicer_total',
                      group_id=group_id, timestamp=timestamp)
    from .accounts import materialize_debts
    materialize_debts(db, identity, today, month)
    return group_payload(db, identity, require_group(db, identity, group_id), month, today)


def archive_group(db, identity, group_id):
    from .accounts import lock
    lock(db)
    require_group(db, identity, group_id)
    db.execute('''UPDATE accounts SET student_loan_group_id=NULL WHERE student_loan_group_id=?
                  AND household_id=? AND owner_id=? AND scope=?''', (group_id, *identity))
    db.execute('UPDATE student_loan_groups SET active=0,reported_account_id=NULL WHERE id=?', (group_id,))


def interest_stale(account):
    return account['accrued_interest_cents'] is not None and account['accrued_interest_cents'] > abs(account['balance_cents'])


def group_payload(db, identity, group, month, today, relations=None):
    from . import accounts
    relations = relations or accounts.collateral_context(db, identity)
    rows = relations[0]
    children = [row for row in rows.values() if row['student_loan_group_id'] == group['id']]
    active = [row for row in children if not row['archived']]
    reported = rows.get(group['reported_account_id'])
    child_balance = sum(abs(row['balance_cents']) for row in active)
    reported_balance = abs(reported['balance_cents']) if reported is not None and not reported['archived'] else None
    balance = reported_balance if group['valuation_mode'] == 'servicer_total' else child_balance
    rated = [row for row in active if row['apr_basis_points'] is not None and abs(row['balance_cents']) > 0]
    covered = sum(abs(row['balance_cents']) for row in rated)
    weighted = (float((Decimal(sum(abs(row['balance_cents']) * row['apr_basis_points'] for row in rated)) / covered)
                       .quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)) if covered else None)
    known_interest = [row for row in active if row['accrued_interest_cents'] is not None and not interest_stale(row)]
    scheduled = {row['debt_account_id']: row['total'] for row in db.execute('''SELECT debt_account_id,SUM(amount_cents) total
                  FROM bills WHERE household_id=? AND owner_id=? AND scope=? AND item_month=?
                  AND debt_account_id IS NOT NULL GROUP BY debt_account_id''', (*identity, month))}
    children_scheduled = sum(scheduled.get(row['id'], 0) for row in children)
    reported_scheduled = scheduled.get(reported['id'], 0) if reported is not None else 0
    breakdown_complete = group['valuation_mode'] == 'individual_loans' or reported_balance == child_balance
    return {key: group[key] for key in ('id', 'name', 'borrower', 'servicer', 'currency', 'valuation_mode', 'reported_account_id')} | {
        'reported_account_id': reported['id'] if reported is not None else None,
        'active': bool(group['active']), 'children': [accounts.account_payload(db, row, month, relations) for row in children],
        'reported_account': accounts.account_payload(db, reported, month, relations) if reported is not None else None,
        'balance_cents': balance or 0, 'child_balance_cents': child_balance, 'reported_balance_cents': reported_balance,
        'balance_difference_cents': reported_balance - child_balance if reported_balance is not None else None,
        'child_count': len(children), 'active_child_count': len(active),
        'weighted_apr_basis_points': weighted, 'apr_covered_balance_cents': covered,
        'apr_reported_count': len(rated), 'apr_complete': bool(child_balance and covered == child_balance and breakdown_complete),
        'breakdown_complete': breakdown_complete,
        'accrued_interest_cents': sum(row['accrued_interest_cents'] for row in known_interest) if known_interest else None,
        'interest_reported_count': len(known_interest),
        'interest_stale_count': sum(interest_stale(row) for row in active),
        'interest_complete': bool(active) and len(known_interest) == len(active) and (group['valuation_mode'] == 'individual_loans' or reported_balance == child_balance),
        'scheduled_payment_cents': children_scheduled + reported_scheduled,
        'duplicate_schedule_sources': bool(children_scheduled and reported_scheduled)}


def group_list(db, identity, month, today):
    from .accounts import collateral_context, materialize_debts
    materialize_debts(db, identity, today, month)
    relations = collateral_context(db, identity)
    return [group_payload(db, identity, group, month, today, relations) for group in db.execute(
        'SELECT * FROM student_loan_groups WHERE household_id=? AND owner_id=? AND scope=? ORDER BY id', identity)]
