"""A same-origin API and React host suitable for a Pi or HA ingress.

Only household data is exposed by the separate automation token endpoint.
Home Assistant identity headers are accepted exclusively from the configured
socket peer. Start uvicorn with --no-proxy-headers to preserve that boundary.
"""
import asyncio
import base64
import calendar
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

import jwt
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .database import connect, initialize
from . import income as income_plans
from .models import (Account, AccountPatch, Bill, BillPatch, BudgetCopy, BudgetItem, BudgetPatch,
                     Income, IncomeEntry, IncomeEntryPatch, IncomeSource, IncomeSourcePatch,
                     Login, Member, Settings, Setup, SimpleFINConnect,
                     SimpleFINSync, Transaction, TransactionPatch)


def utc_now():
    return datetime.now(timezone.utc)


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    return 'scrypt$' + base64.urlsafe_b64encode(salt).decode() + '$' + base64.urlsafe_b64encode(digest).decode()


def password_matches(password: str, encoded: str | None) -> bool:
    try:
        version, salt, expected = (encoded or '').split('$')
        if version != 'scrypt':
            return False
        actual = hashlib.scrypt(password.encode(), salt=base64.urlsafe_b64decode(salt),
                                n=16384, r=8, p=1, dklen=32)
        return hmac.compare_digest(actual, base64.urlsafe_b64decode(expected))
    except (ValueError, TypeError):
        return False


def load_secret(data_dir: Path) -> str:
    target = data_dir / 'app-secret'
    try:
        # Exclusive creation keeps two startup processes from replacing a secret.
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        existing = target.read_text().strip()
        if len(existing) < 43:
            raise RuntimeError('The persisted app secret is invalid')
        os.chmod(target, 0o600)
        return existing
    value = secrets.token_urlsafe(48)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(value)
    return value


def month_bounds(month: str) -> tuple[str, str]:
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
        raise HTTPException(422, 'Use a month in YYYY-MM format')
    year, number = map(int, month.split('-'))
    try:
        start = date(year, number, 1)
        end = date(year + (number == 12), number % 12 + 1, 1)
    except ValueError:
        raise HTTPException(422, 'Choose a valid calendar month')
    return start.isoformat(), end.isoformat()


def user_payload(user):
    return {key: user[key] for key in ('id', 'username', 'display_name', 'household_name', 'timezone')} | {'is_admin': bool(user['is_admin'])}


def user_from_db(db, user_id):
    return db.execute('''SELECT u.*, h.name household_name, h.timezone
                         FROM users u JOIN households h ON h.id=u.household_id WHERE u.id=?''', (user_id,)).fetchone()


def local_today(request, user):
    clock = request.app.state.today
    return clock(ZoneInfo(user['timezone'])) if clock else datetime.now(ZoneInfo(user['timezone'])).date()


def scope_identity(user, scope):
    return (user['household_id'], 0 if scope == 'household' else user['id'], scope)


def trusted_ingress(request: Request) -> bool:
    peer = request.client.host if request.client else ''
    return peer in request.app.state.ingress_proxies


def issue_login(request, user):
    expiry = utc_now() + timedelta(hours=12)
    token = jwt.encode({'sub': str(user['id']), 'exp': expiry, 'iat': utc_now(),
                        'iss': 'budget-assistant', 'aud': 'budget-assistant-users'},
                       request.app.state.secret, algorithm='HS256')
    return {'token': token, 'user': user_payload(user)}


def current_user(request: Request):
    app = request.app
    with connect(app.state.db_path) as db:
        if app.state.auth_mode == 'ingress' and trusted_ingress(request):
            ingress_id = request.headers.get('X-Remote-User-Id')
            if ingress_id and len(ingress_id) <= 128:
                found = db.execute('SELECT id FROM users WHERE ingress_id=?', (ingress_id,)).fetchone()
                if found:
                    return dict(user_from_db(db, found['id']))
                db.execute('BEGIN IMMEDIATE')
                found = db.execute('SELECT id FROM users WHERE ingress_id=?', (ingress_id,)).fetchone()
                if found:
                    return dict(user_from_db(db, found['id']))
                household = db.execute('SELECT id FROM households ORDER BY id LIMIT 1').fetchone()
                if not household:
                    household_id = db.execute('INSERT INTO households(name,timezone) VALUES (?,?)',
                                              ('Our household', app.state.default_timezone)).lastrowid
                else:
                    household_id = household['id']
                first_user = not db.execute('SELECT 1 FROM users WHERE household_id=?', (household_id,)).fetchone()
                display = request.headers.get('X-Remote-User-Display-Name') or request.headers.get('X-Remote-User-Name') or 'Home Assistant user'
                uid = db.execute('''INSERT INTO users(username,display_name,household_id,is_admin,ingress_id)
                                     VALUES (?,?,?,?,?)''',
                                 ('ha_' + hashlib.sha256(ingress_id.encode()).hexdigest()[:24],
                                  display[:80], household_id,
                                  first_user, ingress_id)).lastrowid
                return dict(user_from_db(db, uid))
            # Missing identity must never fall through to an implicit user.
        if not app.state.local_auth:
            raise HTTPException(401, 'Open this app through authenticated Home Assistant ingress')
        authorization = request.headers.get('Authorization', '')
        if not authorization.startswith('Bearer '):
            raise HTTPException(401, 'Sign in to continue')
        try:
            claims = jwt.decode(authorization[7:], app.state.secret, algorithms=['HS256'],
                                issuer='budget-assistant', audience='budget-assistant-users',
                                options={'require': ['exp', 'iat', 'sub']})
            uid = int(claims['sub'])
        except (jwt.InvalidTokenError, ValueError, TypeError):
            raise HTTPException(401, 'Your session has expired. Sign in again')
        user = user_from_db(db, uid)
        if not user:
            raise HTTPException(401, 'Sign in to continue')
        return dict(user)


def admin_user(user=Depends(current_user)):
    if not user['is_admin']:
        raise HTTPException(403, 'Only a household administrator can do that')
    return user


def require_local_auth(request):
    if not request.app.state.local_auth:
        raise HTTPException(403, 'Local username and password access is disabled')


def require_scope_item(db, table, item_id, identity):
    # table is selected by server code, never supplied by a user.
    row = db.execute(f'SELECT * FROM {table} WHERE id=? AND household_id=? AND owner_id=? AND scope=?',
                     (item_id, *identity)).fetchone()
    if row is None:
        raise HTTPException(404, 'Item not found')
    return row


def budget_totals(db, identity, month):
    start, end = month_bounds(month)
    income_cents = income_plans.total(db, identity, month)
    planned = db.execute('SELECT COALESCE(SUM(planned_cents),0) n FROM budget_items WHERE household_id=? AND owner_id=? AND scope=? AND month=?',
                         (*identity, month)).fetchone()['n']
    # Positive transactions are inflows. Spending includes net refunds represented
    # by categorised positive entries; unassigned deposits do not reduce spending.
    spent = db.execute('''SELECT COALESCE(SUM(CASE WHEN amount_cents<0 OR category_id IS NOT NULL
                                 THEN -amount_cents ELSE 0 END),0) n FROM transactions
                           WHERE household_id=? AND owner_id=? AND scope=? AND date>=? AND date<?''',
                       (*identity, start, end)).fetchone()['n']
    return {'income_cents': income_cents,
            'planned_cents': planned, 'spent_cents': spent}


def bill_bucket(due: str, today: date):
    day = date.fromisoformat(due)
    week_end = today + timedelta(days=6 - today.weekday())
    if day < today:
        return 'past_due'
    if day == today:
        return 'today'
    if day <= week_end:
        return 'this_week'
    if day <= week_end + timedelta(days=7):
        return 'next_week'
    return 'later'


def bill_summary(db, identity, today):
    materialize_bills(db, identity, today)
    summary = {name: {'count': 0, 'total_cents': 0}
               for name in ('past_due', 'today', 'this_week', 'next_week')}
    rows = db.execute('SELECT due_date,amount_cents FROM bills WHERE household_id=? AND owner_id=? AND scope=? AND paid=0', identity)
    for row in rows:
        bucket = bill_bucket(row['due_date'], today)
        if bucket in summary:
            summary[bucket]['count'] += 1
            summary[bucket]['total_cents'] += row['amount_cents']
    return summary


def bill_payload(row, today):
    return {key: row[key] for key in ('id', 'name', 'amount_cents', 'due_date', 'recurrence')} | {
        'paid': bool(row['paid']), 'autopay': bool(row['autopay']),
        'bucket': 'paid' if row['paid'] else bill_bucket(row['due_date'], today)}


def next_month_occurrence(db, row):
    if row['recurrence'] != 'monthly' or not row['paid']:
        return
    previous = date.fromisoformat(row['due_date'])
    year = previous.year + (previous.month == 12)
    if year > 9999:
        return
    month = previous.month % 12 + 1
    day = row['recurrence_day'] or previous.day
    due = date(year, month, min(day, calendar.monthrange(year, month)[1])).isoformat()
    db.execute('''INSERT OR IGNORE INTO bills(household_id,owner_id,scope,name,amount_cents,
                   due_date,paid,autopay,recurrence,recurrence_key,recurrence_day)
                   VALUES (?,?,?,?,?,?,0,?,?,?,?)''',
               (row['household_id'], row['owner_id'], row['scope'], row['name'], row['amount_cents'],
                due, row['autopay'], row['recurrence'], row['recurrence_key'], day))


def materialize_bills(db, identity, today):
    """An unpaid earlier occurrence never prevents the next month's reminder."""
    horizon = today + timedelta(days=14)
    latest = {}
    for row in db.execute('''SELECT * FROM bills WHERE household_id=? AND owner_id=? AND scope=?
                             AND recurrence='monthly' AND recurrence_key IS NOT NULL ORDER BY due_date,id''', identity):
        latest[row['recurrence_key']] = dict(row)
    for row in latest.values():
        previous = date.fromisoformat(row['due_date'])
        day = row['recurrence_day'] or previous.day
        while True:
            year, month = previous.year + (previous.month == 12), previous.month % 12 + 1
            if year > 9999:
                break
            due = date(year, month, min(day, calendar.monthrange(year, month)[1]))
            if due > horizon:
                break
            db.execute('''INSERT OR IGNORE INTO bills(household_id,owner_id,scope,name,amount_cents,
                           due_date,paid,autopay,recurrence,recurrence_key,recurrence_day)
                           VALUES (?,?,?,?,?,?,0,?,'monthly',?,?)''',
                       (row['household_id'], row['owner_id'], row['scope'], row['name'], row['amount_cents'],
                        due.isoformat(), row['autopay'], row['recurrence_key'], day))
            previous = due


def transaction_payload(row):
    return {key: row[key] for key in ('id', 'description', 'amount_cents', 'date', 'account_name', 'category_id', 'category_name')} | {'pending': bool(row['pending'])}


def transactions_for(db, identity, month, limit=None):
    start, end = month_bounds(month)
    sql = '''SELECT t.*,i.name category_name FROM transactions t LEFT JOIN budget_items i ON i.id=t.category_id
             AND i.household_id=t.household_id AND i.owner_id=t.owner_id AND i.scope=t.scope
             WHERE t.household_id=? AND t.owner_id=? AND t.scope=? AND t.date>=? AND t.date<?
             ORDER BY t.date DESC,t.id DESC'''
    parameters = (*identity, start, end)
    if limit is not None:
        sql += ' LIMIT ?'
        parameters += (limit,)
    return [transaction_payload(row) for row in db.execute(sql, parameters)]


def validate_category(db, category_id, identity, transaction_date):
    if category_id is not None:
        row = require_scope_item(db, 'budget_items', category_id, identity)
        if row['month'] != str(transaction_date)[:7]:
            raise HTTPException(422, 'Choose a budget item in the transaction month')


async def sync_connection(app, user_id, scope):
    from .simplefin import sync_accounts, SimpleFINError
    try:
        return await sync_accounts(str(app.state.db_path), user_id, scope, app.state.secret)
    except SimpleFINError as error:
        raise HTTPException(getattr(error, 'status_code', 400), error.safe_message)
    except Exception:
        # Provider URLs or credentials must not escape via exception text.
        raise HTTPException(502, 'The bank connection could not sync. Please try again later')


async def scheduled_sync(app):
    while True:
        await asyncio.sleep(60)
        if app.state.demo:
            continue
        with connect(app.state.db_path) as db:
            connections = db.execute('''SELECT s.*, (SELECT MIN(u.id) FROM users u WHERE u.household_id=s.household_id AND u.is_admin=1) admin_id
                                        FROM integration_state s WHERE s.connected=1''').fetchall()
        for connection in connections:
            try:
                last = datetime.fromisoformat(connection['last_sync']) if connection['last_sync'] else None
                if last and last.tzinfo is None:
                    last = last.replace(tzinfo=timezone.utc)
                if last and utc_now() - last < timedelta(hours=connection['sync_interval_hours']):
                    continue
                uid = connection['owner_id'] if connection['scope'] == 'personal' else connection['admin_id']
                if uid:
                    await sync_connection(app, uid, connection['scope'])
            except HTTPException:
                pass  # service persists the safe error for the connection owner
            except Exception:
                pass  # one malformed connection cannot stop other schedules


def create_app(data_dir: str | Path | None = None, *, today=None) -> FastAPI:
    folder = Path(data_dir or os.getenv('BUDGET_DATA_DIR', str(Path(__file__).resolve().parent.parent / 'data')))
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(folder, 0o700)
    demo = os.getenv('BUDGET_DEMO', '0') == '1'
    db_path = folder / ('budget-demo.sqlite3' if demo else 'budget.sqlite3')
    initialize(db_path)
    os.chmod(db_path, 0o600)
    mode = os.getenv('BUDGET_AUTH_MODE', 'local')
    if mode not in ('local', 'ingress'):
        raise RuntimeError('BUDGET_AUTH_MODE must be local or ingress')
    default_timezone = os.getenv('BUDGET_TIMEZONE', 'America/New_York')
    ZoneInfo(default_timezone)

    @asynccontextmanager
    async def lifespan(application):
        task = asyncio.create_task(scheduled_sync(application))
        try:
            yield
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    app = FastAPI(title='Budget Assistant', lifespan=lifespan)
    app.state.db_path = db_path
    app.state.secret = load_secret(folder)
    app.state.demo = demo
    app.state.auth_mode = mode
    app.state.local_auth = os.getenv('BUDGET_LOCAL_AUTH', 'true' if mode == 'local' else 'false').lower() == 'true'
    app.state.ingress_proxies = {value.strip() for value in os.getenv('BUDGET_INGRESS_PROXY', '172.30.32.2').split(',') if value.strip()}
    app.state.default_timezone = default_timezone
    app.state.today = today
    app.state.login_attempts = defaultdict(deque)

    @app.middleware('http')
    async def response_headers(request, call_next):
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'same-origin'
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/api/health')
    def health():
        return {'status': 'ok'}

    @app.get('/api/auth/status')
    def auth_status(request: Request):
        with connect(db_path) as db:
            empty = db.execute('SELECT COUNT(*) FROM users').fetchone()[0] == 0
        return {'mode': mode, 'setup_required': empty and app.state.local_auth and not demo,
                'demo': demo, 'local_auth': app.state.local_auth}

    @app.post('/api/auth/setup', status_code=201)
    def setup(payload: Setup, request: Request):
        require_local_auth(request)
        if demo:
            raise HTTPException(403, 'Use the demo entrance for this preview')
        with connect(db_path) as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM users LIMIT 1').fetchone():
                raise HTTPException(409, 'This household has already been set up')
            hid = db.execute('INSERT INTO households(name,timezone) VALUES (?,?)',
                             (payload.household_name.strip(), payload.timezone)).lastrowid
            uid = db.execute('INSERT INTO users(username,display_name,password_hash,household_id,is_admin) VALUES (?,?,?,?,1)',
                             (payload.username, payload.display_name.strip(), password_hash(payload.password), hid)).lastrowid
            user = dict(user_from_db(db, uid))
        return issue_login(request, user)

    @app.post('/api/auth/login')
    def login(payload: Login, request: Request):
        require_local_auth(request)
        peer = request.client.host if request.client else 'unknown'
        failures = app.state.login_attempts[peer]
        cutoff = time.monotonic() - 900
        while failures and failures[0] < cutoff:
            failures.popleft()
        if len(failures) >= 8:
            raise HTTPException(429, 'Too many sign-in attempts. Wait 15 minutes')
        with connect(db_path) as db:
            record = db.execute('SELECT id,password_hash FROM users WHERE username=?', (payload.username.strip().lower(),)).fetchone()
            # Constant work even when the username does not exist.
            valid = password_matches(payload.password, record['password_hash'] if record else app.state.dummy_password)
            if not record or not valid:
                failures.append(time.monotonic())
                raise HTTPException(401, 'The username or password is incorrect')
            user = dict(user_from_db(db, record['id']))
        failures.clear()
        return issue_login(request, user)

    @app.post('/api/auth/demo')
    def demo_login(request: Request):
        if not demo:
            raise HTTPException(404, 'Demo access is disabled')
        from .demo import seed_demo
        with connect(db_path) as db:
            uid = seed_demo(db, default_timezone, today(ZoneInfo(default_timezone)) if today else datetime.now(ZoneInfo(default_timezone)).date())
            user = dict(user_from_db(db, uid))
        return issue_login(request, user)

    app.state.dummy_password = password_hash(secrets.token_urlsafe(32))

    @app.get('/api/me')
    def me(user=Depends(current_user)):
        return user_payload(user)

    @app.get('/api/scopes')
    def scopes(user=Depends(current_user)):
        return [{'id': 'household', 'name': user['household_name'], 'kind': 'household'},
                {'id': 'personal', 'name': 'My budget', 'kind': 'personal'}]

    @app.get('/api/dashboard')
    def dashboard(request: Request, scope: Literal['household', 'personal'] = 'household',
                  month: str | None = None, user=Depends(current_user)):
        current_month = month or local_today(request, user).strftime('%Y-%m')
        start, end = month_bounds(current_month)
        identity = scope_identity(user, scope)
        with connect(db_path) as db:
            totals = budget_totals(db, identity, current_month)
            shared = {'income_cents': 0, 'planned_cents': 0, 'spent_cents': 0, 'contributors': 0}
            if scope == 'household':
                for contributor in db.execute('SELECT id FROM users WHERE household_id=? AND share_personal_totals=1', (user['household_id'],)).fetchall():
                    personal = budget_totals(db, (user['household_id'], contributor['id'], 'personal'), current_month)
                    for key in personal:
                        shared[key] += personal[key]
                    shared['contributors'] += 1
            groups = {}
            for row in db.execute('''SELECT i.*,COALESCE((SELECT SUM(-t.amount_cents) FROM transactions t
                                     WHERE t.category_id=i.id AND t.household_id=i.household_id AND t.owner_id=i.owner_id
                                     AND t.scope=i.scope AND t.date>=? AND t.date<?),0) spent_cents
                                     FROM budget_items i WHERE i.household_id=? AND i.owner_id=? AND i.scope=? AND i.month=? ORDER BY i.id''',
                                  (start, end, *identity, current_month)):
                group = groups.setdefault(row['group_name'], {'id': row['group_name'], 'name': row['group_name'],
                                                'color': row['color'], 'planned_cents': 0, 'spent_cents': 0, 'items': []})
                group['planned_cents'] += row['planned_cents']
                group['spent_cents'] += row['spent_cents']
                group['items'].append({key: row[key] for key in ('id', 'name', 'planned_cents', 'spent_cents')})
            combined = {key: totals[key] + shared[key] for key in totals}
            return combined | {'remaining_cents': combined['planned_cents'] - combined['spent_cents'],
                               'unassigned_cents': combined['income_cents'] - combined['planned_cents'],
                               'shared_personal': shared, 'groups': list(groups.values()),
                               'bill_summary': bill_summary(db, identity, local_today(request, user)),
                               'recent_transactions': transactions_for(db, identity, current_month, 5), 'month': current_month}

    @app.get('/api/budget/items')
    def budget_items(request: Request, scope: Literal['household', 'personal'] = 'household', month: str | None = None,
                     user=Depends(current_user)):
        current_month = month or local_today(request, user).strftime('%Y-%m')
        month_bounds(current_month)
        with connect(db_path) as db:
            return [dict(row) for row in db.execute('SELECT id,name,group_name,color,planned_cents FROM budget_items WHERE household_id=? AND owner_id=? AND scope=? AND month=? ORDER BY id',
                                                   (*scope_identity(user, scope), current_month))]

    @app.post('/api/budget/items', status_code=201)
    def add_budget_item(payload: BudgetItem, request: Request, scope: Literal['household', 'personal'] = 'household',
                        month: str | None = None, user=Depends(current_user)):
        current_month = month or local_today(request, user).strftime('%Y-%m')
        month_bounds(current_month)
        with connect(db_path) as db:
            uid = db.execute('INSERT INTO budget_items(household_id,owner_id,scope,month,name,group_name,color,planned_cents) VALUES (?,?,?,?,?,?,?,?)',
                             (*scope_identity(user, scope), current_month, payload.name.strip(), payload.group_name.strip(), payload.color, payload.planned_cents)).lastrowid
        return {'id': uid} | payload.model_dump()

    @app.patch('/api/budget/items/{item_id}')
    def update_budget_item(item_id: int, payload: BudgetPatch, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            require_scope_item(db, 'budget_items', item_id, scope_identity(user, scope))
            updates = payload.model_dump(exclude_unset=True, exclude_none=True)
            if updates:
                db.execute('UPDATE budget_items SET ' + ','.join(f'{key}=?' for key in updates) + ' WHERE id=?', (*updates.values(), item_id))
            return dict(db.execute('SELECT id,name,group_name,color,planned_cents FROM budget_items WHERE id=?', (item_id,)).fetchone())

    @app.delete('/api/budget/items/{item_id}', status_code=204)
    def delete_budget_item(item_id: int, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            require_scope_item(db, 'budget_items', item_id, scope_identity(user, scope))
            db.execute('DELETE FROM budget_items WHERE id=?', (item_id,))
        return Response(status_code=204)

    @app.post('/api/budget/copy', status_code=201)
    def copy_budget(payload: BudgetCopy, user=Depends(current_user)):
        month_bounds(payload.from_month)
        month_bounds(payload.to_month)
        identity = scope_identity(user, payload.scope)
        with connect(db_path) as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM budget_items WHERE household_id=? AND owner_id=? AND scope=? AND month=?', (*identity, payload.to_month)).fetchone():
                raise HTTPException(409, 'The destination month already has a budget')
            source = db.execute('SELECT 1 FROM budget_items WHERE household_id=? AND owner_id=? AND scope=? AND month=?', (*identity, payload.from_month)).fetchone()
            income_plans.ensure_month(db, identity, payload.from_month)
            income = db.execute('SELECT 1 FROM income_entries WHERE household_id=? AND owner_id=? AND scope=? AND month=?', (*identity, payload.from_month)).fetchone()
            if not source and not income:
                raise HTTPException(404, 'The source month has no budget to copy')
            db.execute('''INSERT INTO budget_items(household_id,owner_id,scope,month,name,group_name,color,planned_cents)
                          SELECT household_id,owner_id,scope,?,name,group_name,color,planned_cents FROM budget_items
                          WHERE household_id=? AND owner_id=? AND scope=? AND month=?''', (payload.to_month, *identity, payload.from_month))
            income_plans.copy_monthly_lines(db, identity, payload.from_month, payload.to_month)
            db.execute('INSERT OR IGNORE INTO budget_months(household_id,owner_id,scope,month,income_cents) VALUES (?,?,?,?,0)',
                       (*identity, payload.to_month))
        return {'month': payload.to_month, 'copied': True}

    @app.post('/api/budget/income')
    def save_income(payload: Income, user=Depends(current_user)):
        month_bounds(payload.month)
        with connect(db_path) as db:
            identity = scope_identity(user, payload.scope)
            income_plans.save_legacy_total(db, identity, payload.month, payload.amount_cents)
            db.execute('''INSERT INTO budget_months(household_id,owner_id,scope,month,income_cents) VALUES (?,?,?,?,?)
                          ON CONFLICT(household_id,owner_id,scope,month) DO UPDATE SET income_cents=excluded.income_cents''',
                       (*scope_identity(user, payload.scope), payload.month, payload.amount_cents))
            total = income_plans.total(db, identity, payload.month)
        return {'income_cents': total, 'month': payload.month}

    @app.get('/api/income')
    def income_entries(request: Request, scope: Literal['household', 'personal'] = 'household',
                       month: str | None = None, user=Depends(current_user)):
        selected = month or local_today(request, user).strftime('%Y-%m')
        month_bounds(selected)
        with connect(db_path) as db:
            return income_plans.month_payload(db, scope_identity(user, scope), selected)

    @app.post('/api/income/entries', status_code=201)
    def add_income_entry(payload: IncomeEntry, request: Request,
                         scope: Literal['household', 'personal'] = 'household', month: str | None = None,
                         user=Depends(current_user)):
        selected = month or local_today(request, user).strftime('%Y-%m')
        month_bounds(selected)
        with connect(db_path) as db:
            return income_plans.create_entry(db, scope_identity(user, scope), selected, payload)

    @app.patch('/api/income/entries/{entry_id}')
    def update_income_entry(entry_id: int, payload: IncomeEntryPatch,
                            scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            return income_plans.patch_entry(db, scope_identity(user, scope), entry_id, payload)

    @app.delete('/api/income/entries/{entry_id}', status_code=204)
    def delete_income_entry(entry_id: int, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            income_plans.delete_entry(db, scope_identity(user, scope), entry_id)
        return Response(status_code=204)

    @app.post('/api/income/entries/{entry_id}/reset')
    def reset_income_entry(entry_id: int, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            return income_plans.reset_entry(db, scope_identity(user, scope), entry_id)

    @app.post('/api/income/sources', status_code=201)
    def add_income_source(payload: IncomeSource, request: Request,
                          scope: Literal['household', 'personal'] = 'household', month: str | None = None,
                          user=Depends(current_user)):
        selected = month or local_today(request, user).strftime('%Y-%m')
        month_bounds(selected)
        with connect(db_path) as db:
            return income_plans.create_source(db, scope_identity(user, scope), selected, payload, local_today(request, user))

    @app.patch('/api/income/sources/{source_id}')
    def update_income_source(source_id: int, payload: IncomeSourcePatch, request: Request,
                             scope: Literal['household', 'personal'] = 'household', month: str | None = None,
                             user=Depends(current_user)):
        selected = month or local_today(request, user).strftime('%Y-%m')
        month_bounds(selected)
        with connect(db_path) as db:
            return income_plans.patch_source(db, scope_identity(user, scope), source_id, payload, local_today(request, user), selected)

    @app.delete('/api/income/sources/{source_id}', status_code=204)
    def delete_income_source(source_id: int, request: Request, scope: Literal['household', 'personal'] = 'household',
                             effective_from: date | None = None, user=Depends(current_user)):
        with connect(db_path) as db:
            income_plans.stop_source(db, scope_identity(user, scope), source_id, effective_from, local_today(request, user))
        return Response(status_code=204)

    @app.post('/api/income/sources/{source_id}/restore-skipped')
    def restore_skipped_income(source_id: int, request: Request,
                               scope: Literal['household', 'personal'] = 'household', month: str | None = None,
                               effective_from: date | None = None, user=Depends(current_user)):
        selected = month or local_today(request, user).strftime('%Y-%m')
        month_bounds(selected)
        with connect(db_path) as db:
            return income_plans.restore_skipped(db, scope_identity(user, scope), source_id, selected, effective_from)

    @app.get('/api/bills')
    def bills(request: Request, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            materialize_bills(db, scope_identity(user, scope), local_today(request, user))
            return [bill_payload(row, local_today(request, user)) for row in db.execute('SELECT * FROM bills WHERE household_id=? AND owner_id=? AND scope=? ORDER BY paid,due_date,id', scope_identity(user, scope))]

    @app.post('/api/bills', status_code=201)
    def add_bill(payload: Bill, request: Request, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            uid = db.execute('''INSERT INTO bills(household_id,owner_id,scope,name,amount_cents,due_date,paid,autopay,recurrence,recurrence_key,recurrence_day)
                                VALUES (?,?,?,?,?,?,?,?,?,?,?)''',
                             (*scope_identity(user, scope), payload.name.strip(), payload.amount_cents, payload.due_date.isoformat(), payload.paid,
                              payload.autopay, payload.recurrence, secrets.token_urlsafe(16) if payload.recurrence == 'monthly' else None, payload.due_date.day)).lastrowid
            row = require_scope_item(db, 'bills', uid, scope_identity(user, scope))
            next_month_occurrence(db, row)
            return bill_payload(row, local_today(request, user))

    @app.patch('/api/bills/{bill_id}')
    def update_bill(bill_id: int, payload: BillPatch, request: Request, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        try:
            with connect(db_path) as db:
                identity = scope_identity(user, scope)
                original = require_scope_item(db, 'bills', bill_id, identity)
                updates = payload.model_dump(exclude_unset=True, exclude_none=True)
                if 'due_date' in updates:
                    if updates['due_date'].isoformat() != original['due_date'] or not original['recurrence_day']:
                        updates['recurrence_day'] = updates['due_date'].day
                    updates['due_date'] = updates['due_date'].isoformat()
                if updates.get('recurrence') == 'monthly' and not original['recurrence_key']:
                    updates['recurrence_key'] = secrets.token_urlsafe(16)
                if updates.get('recurrence') == 'none' and original['recurrence_key']:
                    db.execute('''DELETE FROM bills WHERE household_id=? AND owner_id=? AND scope=? AND recurrence_key=?
                                  AND paid=0 AND due_date>? AND id!=?''',
                               (*identity, original['recurrence_key'], local_today(request, user).isoformat(), bill_id))
                    db.execute('''UPDATE bills SET recurrence='none' WHERE household_id=? AND owner_id=? AND scope=? AND recurrence_key=?''',
                               (*identity, original['recurrence_key']))
                if updates:
                    db.execute('UPDATE bills SET ' + ','.join(f'{key}=?' for key in updates) + ' WHERE id=?', (*updates.values(), bill_id))
                row = require_scope_item(db, 'bills', bill_id, identity)
                if original['recurrence_key'] and row['recurrence'] == 'monthly':
                    # Paid history keeps its original values; edits affect the next
                    # unpaid occurrences as well as subsequent materialisation.
                    future = db.execute('''SELECT * FROM bills WHERE household_id=? AND owner_id=? AND scope=?
                                           AND recurrence_key=? AND paid=0 AND due_date>? AND id!=?''',
                                        (*identity, original['recurrence_key'], original['due_date'], bill_id)).fetchall()
                    for occurrence in future:
                        inherited = {key: updates[key] for key in ('name', 'amount_cents', 'autopay', 'recurrence_day') if key in updates}
                        if 'recurrence_day' in inherited:
                            old_due = date.fromisoformat(occurrence['due_date'])
                            inherited['due_date'] = date(old_due.year, old_due.month,
                                                         min(inherited['recurrence_day'], calendar.monthrange(old_due.year, old_due.month)[1])).isoformat()
                        if inherited:
                            db.execute('UPDATE bills SET ' + ','.join(f'{key}=?' for key in inherited) + ' WHERE id=?', (*inherited.values(), occurrence['id']))
                if not original['paid'] and row['paid']:
                    next_month_occurrence(db, row)
                return bill_payload(row, local_today(request, user))
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'That date conflicts with another occurrence of this bill')

    @app.delete('/api/bills/{bill_id}', status_code=204)
    def delete_bill(bill_id: int, request: Request, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            identity = scope_identity(user, scope)
            original = require_scope_item(db, 'bills', bill_id, identity)
            if original['recurrence_key']:
                db.execute('''DELETE FROM bills WHERE household_id=? AND owner_id=? AND scope=?
                              AND recurrence_key=? AND paid=0 AND due_date>?''',
                           (*identity, original['recurrence_key'], local_today(request, user).isoformat()))
                db.execute('''UPDATE bills SET recurrence='none' WHERE household_id=? AND owner_id=? AND scope=? AND recurrence_key=?''',
                           (*identity, original['recurrence_key']))
            db.execute('DELETE FROM bills WHERE id=?', (bill_id,))
        return Response(status_code=204)

    @app.get('/api/transactions')
    def transactions(request: Request, scope: Literal['household', 'personal'] = 'household', month: str | None = None, user=Depends(current_user)):
        with connect(db_path) as db:
            return transactions_for(db, scope_identity(user, scope), month or local_today(request, user).strftime('%Y-%m'))

    @app.post('/api/transactions', status_code=201)
    def add_transaction(payload: Transaction, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        identity = scope_identity(user, scope)
        with connect(db_path) as db:
            validate_category(db, payload.category_id, identity, payload.date)
            uid = db.execute('INSERT INTO transactions(household_id,owner_id,scope,description,amount_cents,date,account_name,category_id,pending) VALUES (?,?,?,?,?,?,?,?,?)',
                             (*identity, payload.description.strip(), payload.amount_cents, payload.date.isoformat(), payload.account_name, payload.category_id, payload.pending)).lastrowid
            row = db.execute('SELECT t.*,i.name category_name FROM transactions t LEFT JOIN budget_items i ON i.id=t.category_id WHERE t.id=?', (uid,)).fetchone()
            return transaction_payload(row)

    @app.patch('/api/transactions/{transaction_id}')
    def update_transaction(transaction_id: int, payload: TransactionPatch, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        identity = scope_identity(user, scope)
        with connect(db_path) as db:
            original = require_scope_item(db, 'transactions', transaction_id, identity)
            updates = payload.model_dump(exclude_unset=True)
            # category_id=null clears a category; all other nulls are rejected.
            if any(value is None and key != 'category_id' for key, value in updates.items()):
                raise HTTPException(422, 'Only category_id can be cleared')
            validate_category(db, updates.get('category_id', original['category_id']), identity, updates.get('date', original['date']))
            if 'date' in updates:
                updates['date'] = updates['date'].isoformat()
            if 'amount_cents' in updates and original['external_id']:
                updates['amount_override_cents'] = updates['amount_cents']
            if updates:
                db.execute('UPDATE transactions SET ' + ','.join(f'{key}=?' for key in updates) + ' WHERE id=?', (*updates.values(), transaction_id))
            return transaction_payload(db.execute('SELECT t.*,i.name category_name FROM transactions t LEFT JOIN budget_items i ON i.id=t.category_id WHERE t.id=?', (transaction_id,)).fetchone())

    @app.delete('/api/transactions/{transaction_id}', status_code=204)
    def delete_transaction(transaction_id: int, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            row = require_scope_item(db, 'transactions', transaction_id, scope_identity(user, scope))
            if row['external_id']:
                db.execute('INSERT OR IGNORE INTO transaction_exclusions(household_id,owner_id,scope,external_id) VALUES (?,?,?,?)',
                           (*scope_identity(user, scope), row['external_id']))
            db.execute('DELETE FROM transactions WHERE id=?', (transaction_id,))
        return Response(status_code=204)

    @app.get('/api/accounts')
    def accounts(scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            return [dict(row) for row in db.execute('SELECT id,name,institution,kind,balance_cents,currency,source FROM accounts WHERE household_id=? AND owner_id=? AND scope=? ORDER BY id', scope_identity(user, scope))]

    @app.post('/api/accounts', status_code=201)
    def add_account(payload: Account, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            uid = db.execute('INSERT INTO accounts(household_id,owner_id,scope,name,institution,kind,balance_cents,currency,source) VALUES (?,?,?,?,?,?,?,?,?)',
                             (*scope_identity(user, scope), payload.name.strip(), payload.institution, payload.kind, payload.balance_cents, payload.currency, 'manual')).lastrowid
        return {'id': uid, 'source': 'manual'} | payload.model_dump()

    @app.patch('/api/accounts/{account_id}')
    def update_account(account_id: int, payload: AccountPatch, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            require_scope_item(db, 'accounts', account_id, scope_identity(user, scope))
            updates = payload.model_dump(exclude_unset=True, exclude_none=True)
            if updates:
                db.execute('UPDATE accounts SET ' + ','.join(f'{key}=?' for key in updates) + ' WHERE id=?', (*updates.values(), account_id))
            return dict(db.execute('SELECT id,name,institution,kind,balance_cents,currency,source FROM accounts WHERE id=?', (account_id,)).fetchone())

    @app.delete('/api/accounts/{account_id}', status_code=204)
    def delete_account(account_id: int, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            require_scope_item(db, 'accounts', account_id, scope_identity(user, scope))
            db.execute('DELETE FROM accounts WHERE id=?', (account_id,))
        return Response(status_code=204)

    @app.get('/api/settings')
    def settings(scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            state = db.execute('SELECT * FROM integration_state WHERE household_id=? AND owner_id=? AND scope=?', scope_identity(user, scope)).fetchone()
        warnings = []
        if state:
            try:
                from .simplefin import safe_warning
                stored_warnings = json.loads(state['warnings'])
                if isinstance(stored_warnings, list):
                    warnings = [safe_warning(value) for value in stored_warnings if isinstance(value, str)][:30]
            except (ValueError, TypeError):
                pass
        return {'share_personal_totals': bool(user['share_personal_totals']),
                'simplefin_connected': bool(state and state['connected']),
                'last_sync': state['last_sync'] if state else None,
                'sync_error': state['sync_error'] if state else None,
                'warnings': warnings,
                'sync_interval_hours': state['sync_interval_hours'] if state else 6}

    @app.patch('/api/settings')
    def update_settings(payload: Settings, scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            if payload.share_personal_totals is not None:
                db.execute('UPDATE users SET share_personal_totals=? WHERE id=?', (payload.share_personal_totals, user['id']))
            if payload.sync_interval_hours is not None:
                db.execute('''INSERT INTO integration_state(household_id,owner_id,scope,sync_interval_hours) VALUES (?,?,?,?)
                              ON CONFLICT(household_id,owner_id,scope) DO UPDATE SET sync_interval_hours=excluded.sync_interval_hours''',
                           (*scope_identity(user, scope), payload.sync_interval_hours))
            latest = dict(user_from_db(db, user['id']))
        return settings(scope, latest)

    @app.get('/api/members')
    def members(user=Depends(current_user)):
        with connect(db_path) as db:
            return [dict(row) | {'is_admin': bool(row['is_admin'])} for row in db.execute('SELECT id,username,display_name,is_admin FROM users WHERE household_id=? ORDER BY id', (user['household_id'],))]

    @app.post('/api/members', status_code=201)
    def add_member(payload: Member, request: Request, user=Depends(admin_user)):
        require_local_auth(request)
        with connect(db_path) as db:
            try:
                uid = db.execute('INSERT INTO users(username,display_name,password_hash,household_id) VALUES (?,?,?,?)',
                                 (payload.username, payload.display_name.strip(), password_hash(payload.password), user['household_id'])).lastrowid
            except sqlite3.IntegrityError:
                raise HTTPException(409, 'That username is already taken')
        return {'id': uid, 'username': payload.username, 'display_name': payload.display_name, 'is_admin': False}

    @app.post('/api/integrations/ha-token')
    def create_ha_token(user=Depends(admin_user)):
        token = 'ba_ha_' + secrets.token_urlsafe(36)
        with connect(db_path) as db:
            db.execute('DELETE FROM machine_tokens WHERE household_id=?', (user['household_id'],))
            db.execute('INSERT INTO machine_tokens(household_id,token_hash) VALUES (?,?)', (user['household_id'], hashlib.sha256(token.encode()).hexdigest()))
        return {'token': token}

    @app.get('/api/ha/bills')
    def ha_bills(request: Request):
        authorization = request.headers.get('Authorization', '')
        if not authorization.startswith('Bearer ba_ha_'):
            raise HTTPException(401, 'A household automation token is required')
        token_hash = hashlib.sha256(authorization[7:].encode()).hexdigest()
        with connect(db_path) as db:
            household = db.execute('''SELECT h.* FROM machine_tokens t JOIN households h ON h.id=t.household_id
                                      WHERE t.token_hash=?''', (token_hash,)).fetchone()
            if not household:
                raise HTTPException(401, 'A valid household automation token is required')
            current_day = local_today(request, household)
            summary = bill_summary(db, (household['id'], 0, 'household'), current_day)
        week_end = current_day + timedelta(days=6 - current_day.weekday())
        return summary | {'timezone': household['timezone'], 'as_of': current_day.isoformat(), 'currency': 'USD',
                          'boundary_dates': {'today': current_day.isoformat(), 'this_week_end': week_end.isoformat(),
                                             'next_week_start': (week_end + timedelta(days=1)).isoformat(),
                                             'next_week_end': (week_end + timedelta(days=7)).isoformat()}}

    @app.post('/api/integrations/simplefin')
    async def connect_simplefin(payload: SimpleFINConnect, user=Depends(current_user)):
        if demo:
            raise HTTPException(403, 'Bank connections are unavailable in the demo')
        from .simplefin import claim_token, SimpleFINError
        try:
            credential = await claim_token(payload.setup_token, app.state.secret)
        except SimpleFINError as error:
            raise HTTPException(getattr(error, 'status_code', 400), error.safe_message)
        except Exception:
            raise HTTPException(502, 'The bank connection could not be established')
        with connect(db_path) as db:
            db.execute('''INSERT INTO integration_state(household_id,owner_id,scope,credential,connected) VALUES (?,?,?,?,1)
                          ON CONFLICT(household_id,owner_id,scope) DO UPDATE SET credential=excluded.credential,connected=1,
                          last_sync=NULL,last_attempt=NULL,sync_error=NULL,warnings='[]' ''',
                       (*scope_identity(user, payload.scope), credential))
        return {'connected': True}

    @app.post('/api/integrations/simplefin/sync')
    async def manual_sync(payload: SimpleFINSync, user=Depends(current_user)):
        if demo:
            raise HTTPException(403, 'Bank sync is unavailable in the demo')
        return await sync_connection(app, user['id'], payload.scope)

    @app.delete('/api/integrations/simplefin', status_code=204)
    def disconnect_simplefin(scope: Literal['household', 'personal'] = 'household', user=Depends(current_user)):
        with connect(db_path) as db:
            db.execute('UPDATE integration_state SET credential=NULL,connected=0,sync_error=NULL WHERE household_id=? AND owner_id=? AND scope=?', scope_identity(user, scope))
        return Response(status_code=204)

    frontend = Path(os.getenv('BUDGET_FRONTEND_DIR', str(Path(__file__).resolve().parent.parent / 'frontend' / 'dist')))
    if (frontend / 'assets').exists():
        app.mount('/assets', StaticFiles(directory=frontend / 'assets'), name='assets')

    @app.get('/{path:path}', include_in_schema=False)
    def frontend_index(path: str, request: Request):
        if path == 'api' or path.startswith('api/') or path.startswith('assets/'):
            raise HTTPException(404, 'Not found')
        candidate = frontend / path
        if path and candidate.is_file() and candidate.resolve().is_relative_to(frontend.resolve()):
            return FileResponse(candidate)
        index = frontend / 'index.html'
        if not index.is_file():
            return JSONResponse({'detail': 'Build the React app with npm run build in frontend/'}, status_code=503)
        ingress_path = request.headers.get('X-Ingress-Path', '') if trusted_ingress(request) else ''
        if ingress_path and re.fullmatch(r'/[A-Za-z0-9_/-]+', ingress_path) and '..' not in ingress_path:
            base = ingress_path.rstrip('/') + '/'
        else:
            base = '/'
        content = index.read_text()
        content = re.sub(r'<base\s[^>]*>', '', content, flags=re.I)
        content = content.replace('<head>', '<head><base href="' + html.escape(base, quote=True) + '">', 1)
        return HTMLResponse(content, headers={'Cache-Control': 'no-store'})

    return app


app = create_app()
