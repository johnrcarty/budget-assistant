"""Literal ordered rules, manual provenance, and scoped reviewed backfills."""
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from . import accounts, income, item_details


def now():
    return datetime.now(timezone.utc)


def lock(db):
    if not db.in_transaction:
        db.execute('BEGIN IMMEDIATE')


def normalized(value):
    return ' '.join(value.casefold().split())


def provenance(row):
    source = row['category_source']
    if source == 'unmatched' and row['category_id'] is not None:
        source = 'manual'  # Legacy/direct seed assignments are always protected.
    return {'category_source': source, 'categorization_rule_id': row['categorization_rule_id'],
            'manual_category_lock': source == 'manual'}


def require_rule(db, identity, rule_id):
    row = db.execute('SELECT * FROM categorization_rules WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (rule_id, *identity)).fetchone()
    if row is None:
        raise HTTPException(404, 'Rule not found')
    return row


def rule_account(db, identity, account_id):
    if account_id is None:
        return
    account = accounts.require_account(db, identity, account_id)
    if account['currency'] != 'USD' or account['kind'] not in accounts.TRANSACTION_KINDS:
        raise HTTPException(422, 'Choose a USD checking, savings, or credit account')


def rule_target(db, identity, item_id):
    item = item_details.require_item(db, identity, item_id)
    category = db.execute('SELECT active FROM budget_categories WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (item['budget_category_id'], *identity)).fetchone()
    if category is None or not category['active']:
        raise HTTPException(409, 'Restore the target category before using it in a rule')
    return item['lineage_id']


def target_for_month(db, identity, lineage_id, month):
    return db.execute('''SELECT i.id,i.name,c.name group_name,c.active FROM budget_items i
        JOIN budget_item_lineages l ON l.id=i.lineage_id AND l.household_id=i.household_id AND l.owner_id=i.owner_id AND l.scope=i.scope
        JOIN budget_categories c ON c.id=i.budget_category_id AND c.household_id=i.household_id AND c.owner_id=i.owner_id AND c.scope=i.scope
        WHERE i.household_id=? AND i.owner_id=? AND i.scope=? AND i.lineage_id=? AND i.month=?''', (*identity, lineage_id, month)).fetchone()


def rule_payload(db, identity, row, month):
    target = target_for_month(db, identity, row['budget_item_lineage_id'], month)
    display = target or db.execute('''SELECT i.id,i.name,c.name group_name,c.active FROM budget_items i
        JOIN budget_categories c ON c.id=i.budget_category_id AND c.household_id=i.household_id AND c.owner_id=i.owner_id AND c.scope=i.scope
        WHERE i.household_id=? AND i.owner_id=? AND i.scope=? AND i.lineage_id=? ORDER BY i.month DESC,i.id DESC LIMIT 1''', (*identity, row['budget_item_lineage_id'])).fetchone()
    account = db.execute('SELECT name FROM accounts WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (row['account_id'], *identity)).fetchone() if row['account_id'] else None
    return {key: row[key] for key in ('id', 'name', 'merchant_text', 'match_type', 'direction', 'account_id', 'priority', 'budget_item_lineage_id')} | {
        'active': bool(row['active']), 'account_name': account['name'] if account else None,
        'budget_item_id': target['id'] if target else None,
        'target_name': display['name'] if display else None, 'target_group_name': display['group_name'] if display else None,
        'target_available': bool(target and target['active'])}


def list_rules(db, identity, month):
    income.bounds(month)
    return [rule_payload(db, identity, row, month) for row in db.execute('SELECT * FROM categorization_rules WHERE household_id=? AND owner_id=? AND scope=? ORDER BY priority,id', identity)]


def create_rule(db, identity, payload, month):
    lock(db)
    if db.execute('SELECT COUNT(*) n FROM categorization_rules WHERE household_id=? AND owner_id=? AND scope=?', identity).fetchone()['n'] >= 500:
        raise HTTPException(409, 'This budget already has the maximum number of rules')
    rule_account(db, identity, payload.account_id)
    lineage = rule_target(db, identity, payload.budget_item_id)
    priority = db.execute('SELECT COALESCE(MAX(priority),0)+1 n FROM categorization_rules WHERE household_id=? AND owner_id=? AND scope=?', identity).fetchone()['n']
    rule_id = db.execute('''INSERT INTO categorization_rules(household_id,owner_id,scope,name,merchant_text,match_type,direction,account_id,budget_item_lineage_id,active,priority)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)''', (*identity, payload.name, payload.merchant_text, payload.match_type, payload.direction, payload.account_id, lineage, int(payload.active), priority)).lastrowid
    return rule_payload(db, identity, require_rule(db, identity, rule_id), month)


def update_rule(db, identity, rule_id, payload, month):
    lock(db)
    require_rule(db, identity, rule_id)
    updates = payload.model_dump(exclude_unset=True)
    if any(value is None and key != 'account_id' for key, value in updates.items()):
        raise HTTPException(422, 'Only the optional account filter can be cleared')
    if 'account_id' in updates:
        rule_account(db, identity, updates['account_id'])
    if 'budget_item_id' in updates:
        updates['budget_item_lineage_id'] = rule_target(db, identity, updates.pop('budget_item_id'))
    if 'active' in updates:
        updates['active'] = int(updates['active'])
    if updates:
        db.execute('UPDATE categorization_rules SET ' + ','.join(f'{key}=?' for key in updates) + ' WHERE id=?', (*updates.values(), rule_id))
    return rule_payload(db, identity, require_rule(db, identity, rule_id), month)


def reorder_rules(db, identity, ids, month):
    lock(db)
    actual = {row['id'] for row in db.execute('SELECT id FROM categorization_rules WHERE household_id=? AND owner_id=? AND scope=?', identity)}
    if len(ids) != len(set(ids)) or set(ids) != actual or any(type(rule_id) is not int for rule_id in ids):
        raise HTTPException(409, 'The rule list changed. Refresh before reordering')
    for priority, rule_id in enumerate(ids, 1):
        db.execute('UPDATE categorization_rules SET priority=? WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (priority, rule_id, *identity))
    return list_rules(db, identity, month)


def active_rules(db, identity):
    return [dict(row) | {'needle': normalized(row['merchant_text'])} for row in db.execute('SELECT * FROM categorization_rules WHERE household_id=? AND owner_id=? AND scope=? AND active=1 ORDER BY priority,id', identity)]


def transaction_row(db, identity, transaction_id):
    return db.execute('''SELECT t.*,a.kind account_kind,a.currency account_currency FROM transactions t
        LEFT JOIN accounts a ON a.id=t.account_id AND a.household_id=t.household_id AND a.owner_id=t.owner_id AND a.scope=t.scope
        WHERE t.id=? AND t.household_id=? AND t.owner_id=? AND t.scope=?''', (transaction_id, *identity)).fetchone()


def eligible(row):
    if row['category_source'] == 'manual' or row['category_id'] is not None:
        return False
    return row['account_id'] is None or (row['account_currency'] == 'USD' and row['account_kind'] in accounts.TRANSACTION_KINDS)


def choose(db, identity, row, rules, cache):
    description = normalized(row['description'])
    for rule in rules:
        if rule['account_id'] is not None and rule['account_id'] != row['account_id']:
            continue
        if rule['direction'] == 'outflow' and row['amount_cents'] >= 0:
            continue
        if rule['direction'] == 'inflow' and row['amount_cents'] <= 0:
            continue
        match = rule['needle'] == description if rule['match_type'] == 'exact' else rule['needle'] in description
        if not match:
            continue
        key = rule['budget_item_lineage_id'], row['date'][:7]
        if key not in cache:
            cache[key] = target_for_month(db, identity, *key)
        target = cache[key]
        if target is None:
            return rule, None, 'target_missing_in_month'
        if not target['active']:
            return rule, None, 'target_category_archived'
        return rule, target, None
    return None, None, 'no_matching_rule'


def apply_automatic(db, identity, transaction_id, *, reconcile=False, rules=None, cache=None):
    row = transaction_row(db, identity, transaction_id)
    if row is None or row['category_source'] == 'manual':
        return
    if row['category_id'] is not None:
        if not reconcile or row['category_source'] != 'automatic':
            return
        item = db.execute('SELECT month FROM budget_items WHERE id=? AND household_id=? AND owner_id=? AND scope=?', (row['category_id'], *identity)).fetchone()
        if item and item['month'] == row['date'][:7]:
            return
        db.execute("UPDATE transactions SET category_id=NULL,category_source='unmatched',categorization_rule_id=NULL WHERE id=?", (transaction_id,))
        row = transaction_row(db, identity, transaction_id)
    if not eligible(row):
        return
    rule, target, _ = choose(db, identity, row, rules if rules is not None else active_rules(db, identity), cache if cache is not None else {})
    if target is not None:
        db.execute("UPDATE transactions SET category_id=?,category_source='automatic',categorization_rule_id=? WHERE id=? AND category_id IS NULL AND category_source!='manual'", (target['id'], rule['id'], transaction_id))


def reset_manual_clear(db, identity, transaction_id):
    lock(db)
    row = transaction_row(db, identity, transaction_id)
    if row is None:
        raise HTTPException(404, 'Transaction not found')
    if row['category_id'] is not None:
        raise HTTPException(409, 'Clear the current category before using rules')
    db.execute("UPDATE transactions SET category_source='unmatched',categorization_rule_id=NULL WHERE id=?", (transaction_id,))
    apply_automatic(db, identity, transaction_id)


def preview_data(db, identity, month):
    first, last = income.bounds(month)
    rows = db.execute('''SELECT t.*,a.kind account_kind,a.currency account_currency FROM transactions t
        LEFT JOIN accounts a ON a.id=t.account_id AND a.household_id=t.household_id AND a.owner_id=t.owner_id AND a.scope=t.scope
        WHERE t.household_id=? AND t.owner_id=? AND t.scope=? AND t.date>=? AND t.date<=? ORDER BY t.date,t.id''', (*identity, first.isoformat(), last.isoformat())).fetchall()
    rules = active_rules(db, identity)
    cache, matches, skipped = {}, [], []
    protected = 0
    for row in rows:
        if provenance(row)['manual_category_lock']:
            protected += 1
        if not eligible(row):
            continue
        rule, target, reason = choose(db, identity, row, rules, cache)
        entry = {key: row[key] for key in ('description', 'date', 'amount_cents', 'account_name')} | {'transaction_id': row['id']}
        if target:
            matches.append(entry | {'rule_id': rule['id'], 'rule_name': rule['name'], 'budget_item_id': target['id'], 'item_name': target['name'], 'group_name': target['group_name']})
        else:
            skipped.append({key: entry[key] for key in ('transaction_id', 'description', 'date')} | {'reason': reason})
    # Bind the entire reviewed month and target/rule metadata. New imports,
    # explicit manual choices, or changed rules make this preview stale.
    fingerprint = hashlib.sha256(json.dumps({'transactions': [dict(row) for row in rows],
        'rules': list_rules(db, identity, month), 'matches': matches, 'skipped': skipped}, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'month': month, 'matches': matches, 'skipped': skipped,
            'counts': {'matched': len(matches), 'skipped': len(skipped), 'protected_manual': protected}}, fingerprint


def create_preview(db, identity, month):
    lock(db)
    data, fingerprint = preview_data(db, identity, month)
    token = secrets.token_urlsafe(32)
    expiry = (now() + timedelta(minutes=10)).isoformat()
    db.execute('DELETE FROM categorization_previews WHERE expires_at<?', (now().isoformat(),))
    db.execute('''INSERT INTO categorization_previews(token_hash,household_id,owner_id,scope,month,fingerprint,expires_at)
        VALUES (?,?,?,?,?,?,?)''', (hashlib.sha256(token.encode()).hexdigest(), *identity, month, fingerprint, expiry))
    return data | {'preview_token': token, 'expires_at': expiry}


def apply_preview(db, identity, token):
    lock(db)
    preview = db.execute('''SELECT * FROM categorization_previews WHERE token_hash=? AND household_id=? AND owner_id=? AND scope=?''', (hashlib.sha256(token.encode()).hexdigest(), *identity)).fetchone()
    if preview is None:
        raise HTTPException(404, 'Preview not found')
    if preview['consumed'] or preview['expires_at'] <= now().isoformat():
        raise HTTPException(409, 'This preview expired or was already applied. Preview again')
    data, fingerprint = preview_data(db, identity, preview['month'])
    if fingerprint != preview['fingerprint']:
        raise HTTPException(409, 'Transactions or rules changed. Preview again before applying')
    applied = 0
    for match in data['matches']:
        applied += db.execute("UPDATE transactions SET category_id=?,category_source='automatic',categorization_rule_id=? WHERE id=? AND household_id=? AND owner_id=? AND scope=? AND category_id IS NULL AND category_source!='manual'", (match['budget_item_id'], match['rule_id'], match['transaction_id'], *identity)).rowcount
    db.execute('UPDATE categorization_previews SET consumed=1 WHERE token_hash=?', (preview['token_hash'],))
    return {'month': data['month'], 'applied': applied, 'skipped': len(data['skipped'])}
