"""Persistent, scoped budget categories without changing transaction item IDs.

Category metadata is shared across months. Legacy item labels/colors remain
snapshots, and archiving never deletes plans or categorised transactions.
"""
import sqlite3

from fastapi import HTTPException


DEFAULT_COLOR = '#4f766b'
SAVED_NAME = 'Saved'
SAVED_SOURCE = 'saved'


def name_key(name):
    return name.strip().casefold()


def ensure_saved_category(db, identity):
    """Reserve one real category; never create monthly placeholder items."""
    category = db.execute('''SELECT * FROM budget_categories
                              WHERE household_id=? AND owner_id=? AND scope=? AND name_key=?''',
                          (*identity, name_key(SAVED_NAME))).fetchone()
    if category is None:
        # Early/directly-created rows may have a noncanonical key. Adopt the
        # existing category rather than replacing its ID or item associations.
        category = next((row for row in db.execute('''SELECT * FROM budget_categories
                                                      WHERE household_id=? AND owner_id=? AND scope=? ORDER BY id''', identity)
                         if name_key(row['name']) == name_key(SAVED_NAME) and row['managed_source'] in (None, SAVED_SOURCE)), None)
    if category is None:
        db.execute('''INSERT OR IGNORE INTO budget_categories
                      (household_id,owner_id,scope,name,name_key,color,active,managed_source)
                      VALUES (?,?,?,?,?,?,1,?)''',
                   (*identity, SAVED_NAME, name_key(SAVED_NAME), DEFAULT_COLOR, SAVED_SOURCE))
        category = db.execute('''SELECT * FROM budget_categories
                                  WHERE household_id=? AND owner_id=? AND scope=? AND name_key=?''',
                              (*identity, name_key(SAVED_NAME))).fetchone()
    if category['managed_source'] not in (None, SAVED_SOURCE):
        raise HTTPException(409, 'The Saved name is reserved for the built-in category')
    if (category['name'], category['name_key'], category['active'], category['managed_source']) != (SAVED_NAME, name_key(SAVED_NAME), 1, SAVED_SOURCE):
        db.execute('''UPDATE budget_categories SET name=?,name_key=?,active=1,managed_source=?
                      WHERE id=? AND household_id=? AND owner_id=? AND scope=?''',
                   (SAVED_NAME, name_key(SAVED_NAME), SAVED_SOURCE, category['id'], *identity))
    return require_category(db, identity, category['id'])


def ensure_user_saved_categories(db, household_id, user_id):
    ensure_saved_category(db, (household_id, 0, 'household'))
    ensure_saved_category(db, (household_id, user_id, 'personal'))


def ensure_categories(db, identity=None):
    """Idempotently link legacy items, including demo/old clients after startup."""
    # Adopt Saved before backfilling NULL memberships, so a legacy category with
    # a noncanonical key retains its ID when late rows use the canonical name.
    identities = [identity] if identity is not None else (
        [(row['id'], 0, 'household') for row in db.execute('SELECT id FROM households ORDER BY id')]
        + [(row['household_id'], row['id'], 'personal') for row in db.execute('SELECT id,household_id FROM users ORDER BY id')])
    for scoped_identity in identities:
        ensure_saved_category(db, scoped_identity)
    query = 'SELECT * FROM budget_items WHERE budget_category_id IS NULL'
    args = ()
    if identity is not None:
        query += ' AND household_id=? AND owner_id=? AND scope=?'
        args = identity
    for item in db.execute(query + ' ORDER BY id', args).fetchall():
        item_identity = (item['household_id'], item['owner_id'], item['scope'])
        name = item['group_name'].strip() or 'Uncategorized'
        db.execute('''INSERT OR IGNORE INTO budget_categories
                      (household_id,owner_id,scope,name,name_key,color)
                      VALUES (?,?,?,?,?,?)''',
                   (*item_identity, name, name_key(name), item['color'] or DEFAULT_COLOR))
        category = db.execute('''SELECT id FROM budget_categories
                                  WHERE household_id=? AND owner_id=? AND scope=? AND name_key=?''',
                              (*item_identity, name_key(name))).fetchone()
        db.execute('UPDATE budget_items SET budget_category_id=? WHERE id=? AND budget_category_id IS NULL',
                   (category['id'], item['id']))


def require_category(db, identity, category_id):
    row = db.execute('''SELECT * FROM budget_categories
                         WHERE id=? AND household_id=? AND owner_id=? AND scope=?''',
                     (category_id, *identity)).fetchone()
    if row is None:
        raise HTTPException(404, 'Category not found')
    return row


def metadata(row):
    source = row['managed_source'] if 'managed_source' in row.keys() else None
    return {key: row[key] for key in ('id', 'name', 'color')} | {'active': bool(row['active']), 'managed': source is not None, 'source': source or 'manual'}


def create_category(db, identity, payload):
    ensure_categories(db, identity)
    if name_key(payload.name) == name_key(SAVED_NAME):
        raise HTTPException(409, 'Saved is a built-in category and already exists')
    try:
        category_id = db.execute('''INSERT INTO budget_categories
                                   (household_id,owner_id,scope,name,name_key,color,active)
                                   VALUES (?,?,?,?,?,?,?)''',
                                 (*identity, payload.name, name_key(payload.name), payload.color, int(payload.active))).lastrowid
    except sqlite3.IntegrityError:
        raise HTTPException(409, 'A category with that name already exists. Restore it if it is archived')
    return metadata(require_category(db, identity, category_id))


def update_category(db, identity, category_id, payload):
    ensure_categories(db, identity)
    category = require_category(db, identity, category_id)
    if category['managed_source'] and category['managed_source'] != SAVED_SOURCE:
        raise HTTPException(409, 'This category is managed by account payment schedules')
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if category['managed_source'] == SAVED_SOURCE:
        if ('name' in changes and changes['name'] != SAVED_NAME) or ('active' in changes and not changes['active']):
            raise HTTPException(409, 'Saved is a built-in category and must remain active with its original name')
    if 'name' in changes:
        changes['name_key'] = name_key(changes['name'])
    if 'active' in changes:
        changes['active'] = int(changes['active'])
    if changes:
        try:
            db.execute('UPDATE budget_categories SET ' + ','.join(f'{key}=?' for key in changes) + ' WHERE id=?',
                       (*changes.values(), category_id))
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'A category with that name already exists. Choose another name')
    return metadata(require_category(db, identity, category_id))


def resolve_membership(db, identity, *, category_id=None, group_name=None, color=None, existing=None):
    """An explicit ID always wins; foreign IDs never fall back to a name."""
    ensure_categories(db, identity)
    if category_id is not None:
        category = require_category(db, identity, category_id)
    elif existing is not None and name_key(group_name or '') == name_key(existing['group_name']):
        # Old item forms resend their snapshot label after a global rename.
        category = require_category(db, identity, existing['budget_category_id'])
    else:
        category = db.execute('''SELECT * FROM budget_categories
                                 WHERE household_id=? AND owner_id=? AND scope=? AND name_key=?''',
                              (*identity, name_key(group_name))).fetchone()
        if category is None:
            db.execute('''INSERT OR IGNORE INTO budget_categories
                          (household_id,owner_id,scope,name,name_key,color) VALUES (?,?,?,?,?,?)''',
                       (*identity, group_name.strip(), name_key(group_name), color or DEFAULT_COLOR))
            category = db.execute('''SELECT * FROM budget_categories
                                     WHERE household_id=? AND owner_id=? AND scope=? AND name_key=?''',
                                  (*identity, name_key(group_name))).fetchone()
    same_membership = existing is not None and existing['budget_category_id'] == category['id']
    if category['managed_source'] and category['managed_source'] != SAVED_SOURCE and not same_membership:
        raise HTTPException(409, 'This category is reserved for managed debt payments')
    if not category['active'] and not same_membership:
        raise HTTPException(409, 'Restore this category before adding or moving items into it')
    return category


def item_payload(row, category=None):
    payload = {key: row[key] for key in ('id', 'name', 'group_name', 'color', 'planned_cents', 'budget_category_id', 'lineage_id')}
    payload.update(snapshot_group_name=row['group_name'], snapshot_color=row['color'])
    managed_account_id = row['managed_account_id'] if 'managed_account_id' in row.keys() else None
    payload.update(managed=managed_account_id is not None, managed_account_id=managed_account_id,
                   source='debt_payment' if managed_account_id is not None else 'manual')
    if 'payment_dates' in row.keys():
        payload['payment_dates'] = row['payment_dates']
    # Keep old clients' display fields in sync with current category metadata,
    # while retaining the original labels both in storage and explicit fields.
    if category is not None:
        payload.update(group_name=category['name'], color=category['color'])
    elif 'current_group_name' in row.keys() and row['current_group_name'] is not None:
        payload.update(group_name=row['current_group_name'], color=row['current_color'])
    return payload


def categories_for(db, identity, month, start, end, today=None):
    from .item_details import ensure_lineages, list_due_dates
    ensure_lineages(db, identity)
    due_dates = list_due_dates(db, identity, month, today)
    categories = {row['id']: metadata(row) | {'planned_cents': 0, 'spent_cents': 0,
                                             'historical_item_spent_cents': 0, 'items': []}
                  for row in db.execute('''SELECT * FROM budget_categories
                                           WHERE household_id=? AND owner_id=? AND scope=?
                                           ORDER BY CASE WHEN managed_source='saved' THEN 0 ELSE 1 END,id''', identity)}
    for item in db.execute('''SELECT i.*,COALESCE((SELECT SUM(-t.amount_cents) FROM transactions t
                              WHERE t.category_id=i.id AND t.household_id=i.household_id AND t.owner_id=i.owner_id
                              AND t.scope=i.scope AND t.date>=? AND t.date<?
                              AND t.income_entry_id IS NULL AND COALESCE(t.provider_role_override,t.provider_role)='ordinary'
                              AND (t.account_id IS NULL OR EXISTS (SELECT 1 FROM accounts a WHERE a.id=t.account_id
                                   AND a.household_id=t.household_id AND a.owner_id=t.owner_id AND a.scope=t.scope AND a.currency='USD'))),0) spent_cents
                              FROM budget_items i WHERE i.household_id=? AND i.owner_id=? AND i.scope=? AND i.month=?
                              ORDER BY i.id''', (start, end, *identity, month)):
        category = categories.get(item['budget_category_id'])
        if category is not None:
            entry = item_payload(item, category) | {'spent_cents': item['spent_cents'], 'due_date': due_dates.get(item['lineage_id'])}
            if entry['managed']:
                entry['payment_dates'] = [bill['due_date'] for bill in db.execute('SELECT due_date FROM bills WHERE budget_item_id=? ORDER BY due_date,id', (item['id'],))]
                entry['due_date'] = entry['payment_dates'][0] if entry['payment_dates'] else None
            category['items'].append(entry)
            category['planned_cents'] += item['planned_cents']
    # Transaction.category_id still refers to a budget ITEM. A bank transaction
    # imported this month may retain last month's item ID; count that spending
    # in the persistent category without rewriting its historical assignment.
    for row in db.execute('''SELECT i.budget_category_id,COALESCE(SUM(-t.amount_cents),0) spent_cents
                             FROM transactions t JOIN budget_items i ON i.id=t.category_id
                             AND i.household_id=t.household_id AND i.owner_id=t.owner_id AND i.scope=t.scope
                             WHERE t.household_id=? AND t.owner_id=? AND t.scope=? AND t.date>=? AND t.date<?
                             AND t.income_entry_id IS NULL AND COALESCE(t.provider_role_override,t.provider_role)='ordinary'
                             AND (t.account_id IS NULL OR EXISTS (SELECT 1 FROM accounts a WHERE a.id=t.account_id
                                  AND a.household_id=t.household_id AND a.owner_id=t.owner_id AND a.scope=t.scope AND a.currency='USD'))
                             GROUP BY i.budget_category_id''', (*identity, start, end)):
        category = categories.get(row['budget_category_id'])
        if category is not None:
            category['spent_cents'] = row['spent_cents']
    for category in categories.values():
        category['historical_item_spent_cents'] = category['spent_cents'] - sum(item['spent_cents'] for item in category['items'])
    return list(categories.values())
