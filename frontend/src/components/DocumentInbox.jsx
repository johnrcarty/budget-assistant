import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { api, getToken } from '../lib/api.js';
import { Button } from './ui.jsx';

export default function DocumentInbox({ user }) {
  const [documents, setDocuments] = useState([]);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(action) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const refresh = () => api('documents').then(setDocuments);
  useEffect(() => { refresh().catch(e => setError(e.message)); }, [user]);
  async function download(doc) {
    const response = await fetch(new URL(`api/documents/${doc.id}/content`, document.baseURI), {
      credentials: 'same-origin', headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    });
    if (!response.ok) throw new Error('Could not download the PDF. Sign in and try again.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = doc.filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="card setting-card">
    <div className="setting-icon"><FileText size={22} /></div>
    <p className="eyebrow">DELIVERED TO YOUR HOUSEHOLD</p>
    <h2>Document inbox</h2>
    <p>PDFs delivered by your email rules. Documents are stored as received; amounts and budgets are unchanged.</p>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <Button variant="secondary" disabled={busy} onClick={() => run(refresh)}>Refresh documents</Button>
    <div className="member-list">
      {documents.map(doc => <div key={doc.id} className="member-row">
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}><strong>{doc.filename}</strong>
          <small>{doc.subject || doc.sender} · {doc.received_at} UTC</small>
          <span className="pill neutral">Received</span></div>
        <Button variant="secondary" disabled={busy} onClick={() => run(() => download(doc))}>Download</Button>
      </div>)}
      {!documents.length && <p className="muted">No documents received yet.</p>}
    </div>
    {user.is_admin && <>
      <h3>Email delivery connection</h3>
      <p>Create a token and paste it into Keywright’s Mail settings. It can only deliver household PDFs. Creating another replaces the previous token.</p>
      <Button variant="secondary" disabled={busy} onClick={() => run(async () => {
        setToken((await api('integrations/document-token', { method: 'POST' })).token);
      })}>Create delivery token</Button>{' '}
      <Button variant="secondary" disabled={busy} onClick={() => run(async () => {
        await api('integrations/document-token', { method: 'DELETE' }); setToken('');
      })}>Revoke delivery access</Button>
      {token && <label>Delivery token — copy now<input readOnly value={token} onFocus={e => e.target.select()} /></label>}
    </>}
  </section>;
}
