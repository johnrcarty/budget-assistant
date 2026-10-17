import hashlib

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.database import connect


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv('BUDGET_AUTH_MODE', 'local')
    monkeypatch.setenv('BUDGET_LOCAL_AUTH', 'true')
    monkeypatch.setenv('BUDGET_DEMO', '0')
    app = create_app(tmp_path)
    with TestClient(app) as client:
        response = client.post('/api/auth/setup', json={
            'username': 'owner', 'display_name': 'Owner', 'password': 'a-good-long-password',
            'household_name': 'Home', 'timezone': 'America/New_York'})
        owner = {'Authorization': 'Bearer ' + response.json()['token']}
        token = client.post('/api/integrations/document-token', headers=owner).json()['token']
        yield app, client, owner, {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/pdf'}


def upload(client, headers, content=b'%PDF-1.4\nfixture', **params):
    return client.post('/api/integrations/documents', headers=headers, content=content,
                       params={'filename': 'electric.pdf', 'source_id': 'message-1', **params})


def test_delivery_round_trip_and_duplicate_retry(home):
    app, client, owner, delivery = home
    result = upload(client, delivery)
    assert result.status_code == 201
    assert result.json()['sha256'] == hashlib.sha256(b'%PDF-1.4\nfixture').hexdigest()
    assert upload(client, delivery).json() == {**result.json(), 'duplicate': True}
    assert upload(client, delivery, source_id='message-2').status_code == 200
    assert upload(client, delivery, b'%PDF-1.4\nchanged', source_id='message-2').status_code == 409
    assert upload(client, delivery, b'%PDF-1.4\nchanged').status_code == 409
    rows = client.get('/api/documents', headers=owner).json()
    assert len(rows) == 1 and 'content' not in rows[0]
    response = client.get(f"/api/documents/{rows[0]['id']}/content", headers=owner)
    assert response.content == b'%PDF-1.4\nfixture'
    assert response.headers['content-disposition'].startswith('attachment;')
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT count(*) FROM bills').fetchone()[0] == 0


def test_tokens_are_separate_and_revocable(home):
    app, client, owner, delivery = home
    ha = client.post('/api/integrations/ha-token', headers=owner).json()['token']
    assert upload(client, {'Authorization': 'Bearer ' + ha}).status_code == 401
    assert upload(client, owner).status_code == 401
    assert client.get('/api/documents', headers=delivery).status_code == 401
    assert client.get('/api/ha/bills', headers=delivery).status_code == 401
    assert client.post('/api/integrations/document-token', headers=delivery).status_code == 401
    client.post('/api/integrations/document-token', headers=owner)
    assert upload(client, delivery).status_code == 401
    token = client.post('/api/integrations/document-token', headers=owner).json()['token']
    client.delete('/api/integrations/document-token', headers=owner)
    assert upload(client, {'Authorization': 'Bearer ' + token}).status_code == 401


def test_validation_and_stream_size_bound(home, monkeypatch):
    _, client, _, delivery = home
    assert upload(client, delivery, b'not a pdf').status_code == 422
    assert upload(client, delivery, filename='../bill.pdf').status_code == 422
    assert upload(client, delivery, filename='bill.html').status_code == 422
    assert upload(client, {**delivery, 'Content-Type': 'text/html'}).status_code == 415
    monkeypatch.setattr('backend.documents.MAX_PDF_BYTES', 8)
    assert upload(client, delivery).status_code == 413


def test_household_membership_and_admin_boundary(home):
    app, client, owner, delivery = home
    identifier = upload(client, delivery).json()['id']
    client.post('/api/members', headers=owner, json={
        'username': 'member', 'display_name': 'Member', 'password': 'a-good-long-password'})
    login = client.post('/api/auth/login', json={'username': 'member', 'password': 'a-good-long-password'})
    member = {'Authorization': 'Bearer ' + login.json()['token']}
    assert len(client.get('/api/documents', headers=member).json()) == 1
    assert client.post('/api/integrations/document-token', headers=member).status_code == 403
    with connect(app.state.db_path) as db:
        other = db.execute("INSERT INTO households(name,timezone) VALUES ('Other','UTC')").lastrowid
        db.execute("UPDATE users SET household_id=? WHERE username='member'", (other,))
    assert client.get('/api/documents', headers=member).json() == []
    assert client.get(f'/api/documents/{identifier}/content', headers=member).status_code == 404
