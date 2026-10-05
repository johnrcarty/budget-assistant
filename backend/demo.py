"""Synthetic preview fixtures, separate from every live database.

These amounts and names are invented; no reference-photo finances are copied.
"""
import calendar
import secrets
from datetime import date, timedelta


def seed_demo(db, timezone_name, today):
    found = db.execute("SELECT id FROM users WHERE username='demo'").fetchone()
    if found:
        return found['id']
    month = today.strftime('%Y-%m')
    previous_month = (today.replace(day=1) - timedelta(days=1)).strftime('%Y-%m')
    hid = db.execute('INSERT INTO households(name,timezone) VALUES (?,?)', ('Juniper House', timezone_name)).lastrowid
    riley = db.execute("INSERT INTO users(username,display_name,household_id,is_admin,share_personal_totals) VALUES ('demo','Riley',?,1,1)", (hid,)).lastrowid
    morgan = db.execute("INSERT INTO users(username,display_name,household_id,is_admin,share_personal_totals) VALUES ('demo-partner','Morgan',?,0,1)", (hid,)).lastrowid
    for budget_month in (previous_month, month):
        for owner, scope, income in ((0, 'household', 620000), (riley, 'personal', 95000), (morgan, 'personal', 110000)):
            db.execute('INSERT INTO budget_months(household_id,owner_id,scope,month,income_cents) VALUES (?,?,?,?,?)', (hid, owner, scope, budget_month, income))
        fixtures = [
            ('Mortgage', 'Shelter', '#597568', 185000),
            ('Utilities', 'Shelter', '#597568', 26000),
            ('Internet', 'Shelter', '#597568', 7000),
            ('Groceries', 'Everyday', '#bd724f', 68000),
            ('Transport', 'Everyday', '#bd724f', 26000),
            ('Home essentials', 'Everyday', '#bd724f', 18000),
            ('Rainy day fund', 'Future', '#c49d42', 65000),
            ('Travel fund', 'Future', '#c49d42', 40000),
            ('Dining out', 'Little joys', '#647f97', 28000),
            ('Entertainment', 'Little joys', '#647f97', 17000),
        ]
        categories = {}
        for name, group, color, planned in fixtures:
            categories[name] = db.execute('INSERT INTO budget_items(household_id,owner_id,scope,month,name,group_name,color,planned_cents) VALUES (?,0,?,?,?,?,?,?)',
                                          (hid, 'household', budget_month, name, group, color, planned)).lastrowid
        private = {}
        for owner, name, planned in ((riley, 'Creative projects', 25000), (riley, 'Personal savings', 50000),
                                     (morgan, 'Morgan private hobby', 36000), (morgan, 'Morgan private savings', 55000)):
            private[(owner, name)] = db.execute("INSERT INTO budget_items(household_id,owner_id,scope,month,name,group_name,color,planned_cents) VALUES (?,?,'personal',?,?,'My priorities','#597568',?)",
                                             (hid, owner, budget_month, name, planned)).lastrowid
        if budget_month == month:
            sample = [('Market on Elm', -14652, 'Groceries'), ('Northside utility', -12800, 'Utilities'),
                      ('Garden & home', -5238, 'Home essentials'), ('Sunday supper', -6420, 'Dining out'),
                      ('City fuel', -4875, 'Transport'), ('Museum evening', -2800, 'Entertainment'),
                      ('Paycheck', 620000, None), ('Monthly mortgage', -185000, 'Mortgage'),
                      ('Coast savings transfer', -40000, 'Travel fund'), ('Safety net transfer', -65000, 'Rainy day fund')]
            for index, (description, amount, category) in enumerate(sample):
                day = today.replace(day=max(1, today.day - index % 4)).isoformat()
                db.execute("INSERT INTO transactions(household_id,owner_id,scope,description,amount_cents,date,account_name,category_id,pending) VALUES (?,0,'household',?,?,?,'Everyday checking',?,?)",
                           (hid, description, amount, day, categories.get(category), index == 0))
            for owner, name, amount in ((riley, 'Creative projects', -7350), (morgan, 'Morgan private hobby', -15800)):
                db.execute("INSERT INTO transactions(household_id,owner_id,scope,description,amount_cents,date,account_name,category_id) VALUES (?,?,'personal',?,?,?,'Personal checking',?)",
                           (hid, owner, 'Private purchase — ' + name, amount, today.isoformat(), private[(owner, name)]))
    for name, kind, amount in [('Everyday checking', 'checking', 428650), ('Coast savings', 'savings', 1284300),
                                ('Retirement nest', 'investment', 4872500), ('Home', 'property', 26000000),
                                ('Home mortgage', 'loan', -16800000), ('Travel card', 'credit', -92040)]:
        db.execute("INSERT INTO accounts(household_id,owner_id,scope,name,institution,kind,balance_cents,currency,source) VALUES (?,0,'household',?,'Juniper Credit Union',?,?,'USD','manual')",
                   (hid, name, kind, amount))
    db.execute("INSERT INTO accounts(household_id,owner_id,scope,name,institution,kind,balance_cents,currency,source) VALUES (?,?,'personal','My checking','Juniper Credit Union','checking',182340,'USD','manual')", (hid, riley))
    week_end = today + timedelta(days=6 - today.weekday())
    bills = [('Water & sewer', 4830, today - timedelta(days=2), False, 'none'),
             ('Internet', 7000, today, True, 'monthly'),
             ('Electricity', 12800, week_end if week_end > today else today + timedelta(days=1), False, 'monthly'),
             ('Home insurance', 9200, week_end + timedelta(days=3), True, 'monthly'),
             ('Streaming', 1800, today + timedelta(days=18), True, 'monthly')]
    for name, amount, due, autopay, recurrence in bills:
        db.execute("INSERT INTO bills(household_id,owner_id,scope,name,amount_cents,due_date,autopay,recurrence,recurrence_key,recurrence_day) VALUES (?,0,'household',?,?,?,?,?,?,?)",
                   (hid, name, amount, due.isoformat(), autopay, recurrence,
                    secrets.token_urlsafe(16) if recurrence == 'monthly' else None, due.day))
    db.execute("INSERT INTO bills(household_id,owner_id,scope,name,amount_cents,due_date) VALUES (?,?,'personal','Private membership',2200,?)", (hid, riley, (today + timedelta(days=3)).isoformat()))
    db.execute("INSERT INTO bills(household_id,owner_id,scope,name,amount_cents,due_date) VALUES (?,?,'personal','Morgan private bill',9900,?)", (hid, morgan, today.isoformat()))
    return riley
