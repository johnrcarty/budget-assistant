"""Household PDF inbox. A dedicated write-only token cannot read household data."""
import hashlib
import secrets
from urllib.parse import quote

from fastapi import Depends, HTTPException, Query, Request, Response

from .database import connect

MAX_PDF_BYTES = 10 * 1024 * 1024
HOUSEHOLD_QUOTA = 100 * 1024 * 1024


def install(app, current_user, admin_user):
    path = app.state.db_path
    with connect(path) as db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS document_tokens (
                household_id INTEGER PRIMARY KEY REFERENCES households(id), token_hash TEXT UNIQUE NOT NULL
            );
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
                filename TEXT NOT NULL, sha256 TEXT NOT NULL, content BLOB NOT NULL,
                source_id TEXT NOT NULL, sender TEXT NOT NULL, subject TEXT NOT NULL,
                received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(household_id,sha256), UNIQUE(household_id,source_id,filename)
            );
            CREATE TABLE IF NOT EXISTS document_receipts (
                household_id INTEGER NOT NULL REFERENCES households(id), source_id TEXT NOT NULL,
                filename TEXT NOT NULL, document_id INTEGER NOT NULL REFERENCES documents(id),
                PRIMARY KEY(household_id,source_id,filename)
            );
            INSERT OR IGNORE INTO document_receipts
                SELECT household_id,source_id,filename,id FROM documents;
        ''')

    @app.post('/api/integrations/document-token')
    def create_token(user=Depends(admin_user)):
        token = 'ba_docs_' + secrets.token_urlsafe(36)
        with connect(path) as db:
            db.execute('INSERT OR REPLACE INTO document_tokens VALUES (?,?)',
                       (user['household_id'], hashlib.sha256(token.encode()).hexdigest()))
        return {'token': token}

    @app.delete('/api/integrations/document-token', status_code=204)
    def revoke_token(user=Depends(admin_user)):
        with connect(path) as db:
            db.execute('DELETE FROM document_tokens WHERE household_id=?', (user['household_id'],))

    def destination(request: Request):
        value = request.headers.get('Authorization', '')
        if not value.startswith('Bearer ba_docs_'):
            raise HTTPException(401, 'A document delivery token is required')
        with connect(path) as db:
            row = db.execute('SELECT household_id FROM document_tokens WHERE token_hash=?',
                             (hashlib.sha256(value[7:].encode()).hexdigest(),)).fetchone()
        if not row:
            raise HTTPException(401, 'Invalid document delivery token')
        return row['household_id']

    @app.post('/api/integrations/documents', status_code=201)
    async def receive(request: Request, response: Response, household=Depends(destination),
                      filename: str = Query(min_length=1, max_length=200),
                      source_id: str = Query(min_length=1, max_length=500),
                      sender: str = Query(default='', max_length=320),
                      subject: str = Query(default='', max_length=500)):
        if (not filename.lower().endswith('.pdf') or any(c in filename for c in '/\\')
                or any(ord(c) < 32 for c in filename)):
            raise HTTPException(422, 'Use a PDF filename without path components')
        if request.headers.get('Content-Type', '').split(';')[0].lower() != 'application/pdf':
            raise HTTPException(415, 'Send the PDF as application/pdf')
        content = bytearray()
        async for chunk in request.stream():
            if len(content) + len(chunk) > MAX_PDF_BYTES:
                raise HTTPException(413, 'PDF exceeds the 10 MiB limit')
            content.extend(chunk)
        if not content.startswith(b'%PDF-'):
            raise HTTPException(422, 'The attachment is not a PDF')
        digest = hashlib.sha256(content).hexdigest()
        with connect(path) as db:
            db.execute('BEGIN IMMEDIATE')
            # Recheck revocation after receiving the body, in the write transaction.
            if not db.execute('SELECT 1 FROM document_tokens WHERE household_id=? AND token_hash=?',
                              (household, hashlib.sha256(request.headers['Authorization'][7:].encode()).hexdigest())).fetchone():
                raise HTTPException(401, 'Document delivery token was revoked')
            prior = db.execute('''SELECT d.id,d.sha256 FROM document_receipts r JOIN documents d ON d.id=r.document_id
                WHERE r.household_id=? AND r.source_id=? AND r.filename=?''',
                               (household, source_id, filename)).fetchone()
            if prior and prior['sha256'] != digest:
                raise HTTPException(409, 'This source attachment was already received with different contents')
            duplicate = prior or db.execute('SELECT id FROM documents WHERE household_id=? AND sha256=?',
                                           (household, digest)).fetchone()
            if duplicate:
                db.execute('INSERT OR IGNORE INTO document_receipts VALUES (?,?,?,?)',
                           (household, source_id, filename, duplicate['id']))
                response.status_code = 200
                return {'id': duplicate['id'], 'sha256': digest, 'duplicate': True}
            used = db.execute('SELECT COALESCE(SUM(length(content)),0) FROM documents WHERE household_id=?',
                              (household,)).fetchone()[0]
            if used + len(content) > HOUSEHOLD_QUOTA:
                raise HTTPException(413, 'Household document storage is full (100 MiB)')
            identifier = db.execute('''INSERT INTO documents
                (household_id,filename,sha256,content,source_id,sender,subject) VALUES (?,?,?,?,?,?,?)''',
                (household, filename, digest, bytes(content), source_id, sender, subject)).lastrowid
            db.execute('INSERT INTO document_receipts VALUES (?,?,?,?)', (household, source_id, filename, identifier))
        return {'id': identifier, 'sha256': digest, 'duplicate': False}

    @app.get('/api/documents')
    def list_documents(user=Depends(current_user)):
        with connect(path) as db:
            return [dict(row) for row in db.execute('''SELECT id,filename,sha256,length(content) size,
                sender,subject,received_at FROM documents WHERE household_id=? ORDER BY id DESC LIMIT 500''',
                (user['household_id'],))]

    @app.get('/api/documents/{identifier}/content')
    def download(identifier: int, user=Depends(current_user)):
        with connect(path) as db:
            row = db.execute('SELECT filename,content FROM documents WHERE id=? AND household_id=?',
                             (identifier, user['household_id'])).fetchone()
        if not row:
            raise HTTPException(404, 'Document not found')
        return Response(bytes(row['content']), media_type='application/pdf', headers={
            'Content-Disposition': "attachment; filename*=UTF-8''" + quote(row['filename'], safe=''),
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        })
