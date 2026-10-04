"""Persistent, scoped budget categories without changing transaction item IDs.

Category metadata is shared across months. Legacy item labels/colors remain
snapshots, and archiving never deletes plans or categorised transactions.
"""
import sqlite3

from fastapi import HTTPException


DEFAULT_COLOR = '#4f766b'


def name_key(name):
    return name.strip().casefold()


def ensure_categories(db, identity=None):
    """Idempotently link legacy items, including demo/old clients after startup."""
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
    return {key: row[key] for key in ('id', 'name', 'color')} | {'active': bool(row['active'])}


def create_category(db, identity, payload):
    ensure_categories(db, identity)
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
    require_category(db, identity, category_id)
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
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
    if not category['active'] and not same_membership:
        raise HTTPException(409, 'Restore this category before adding or moving items into it')
    return category


def item_payload(row, category=None):
    payload = {key: row[key] for key in ('id', 'name', 'group_name', 'color', 'planned_cents', 'budget_category_id')}
    payload.update(snapshot_group_name=row['group_name'], snapshot_color=row['color'])
    # Keep old clients' display fields in sync with current category metadata,
    # while retaining the original labels both in storage and explicit fields.
    if category is not None:
        payload.update(group_name=category['name'], color=category['color'])
    elif 'current_group_name' in row.keys() and row['current_group_name'] is not None:
        payload.update(group_name=row['current_group_name'], color=row['current_color'])
    return payload


def categories_for(db, identity, month, start, end):
    ensure_categories(db, identity)
    categories = {row['id']: metadata(row) | {'planned_cents': 0, 'spent_cents': 0,
                                             'historical_item_spent_cents': 0, 'items': []}
                  for row in db.execute('''SELECT * FROM budget_categories
                                           WHERE household_id=? AND owner_id=? AND scope=? ORDER BY id''', identity)}
    for item in db.execute('''SELECT i.*,COALESCE((SELECT SUM(-t.amount_cents) FROM transactions t
                              WHERE t.category_id=i.id AND t.household_id=i.household_id AND t.owner_id=i.owner_id
                              AND t.scope=i.scope AND t.date>=? AND t.date<?),0) spent_cents
                              FROM budget_items i WHERE i.household_id=? AND i.owner_id=? AND i.scope=? AND i.month=?
                              ORDER BY i.id''', (start, end, *identity, month)):
        category = categories.get(item['budget_category_id'])
        if category is not None:
            category['items'].append(item_payload(item, category) | {'spent_cents': item['spent_cents']})
            category['planned_cents'] += item['planned_cents']
    # Transaction.category_id still refers to a budget ITEM. A bank transaction
    # imported this month may retain last month's item ID; count that spending
    # in the persistent category without rewriting its historical assignment.
    for row in db.execute('''SELECT i.budget_category_id,COALESCE(SUM(-t.amount_cents),0) spent_cents
                             FROM transactions t JOIN budget_items i ON i.id=t.category_id
                             AND i.household_id=t.household_id AND i.owner_id=t.owner_id AND i.scope=t.scope
                             WHERE t.household_id=? AND t.owner_id=? AND t.scope=? AND t.date>=? AND t.date<?
                             GROUP BY i.budget_category_id''', (*identity, start, end)):
        category = categories.get(row['budget_category_id'])
        if category is not None:
            category['spent_cents'] = row['spent_cents']
    for category in categories.values():
        category['historical_item_spent_cents'] = category['spent_cents'] - sum(item['spent_cents'] for item in category['items'])
    return list(categories.values())
