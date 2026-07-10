import { useEffect, useState } from 'react';
import { intros } from './api';
import TrustPath from './TrustPath';

const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const LABEL = {
  pending_expert_consent: 'Awaiting consent',
  accepted: 'Accepted',
  declined: 'Declined',
};

function Incoming({ row, onDone }) {
  const [busy, setBusy] = useState('');
  async function respond(decision) {
    setBusy(decision);
    try {
      await intros.respond(row.id, decision);
      await onDone();
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <span className="eyebrow">Someone wants an introduction</span>
          <h3 className="expert-name">{row.path_json?.[0]?.name ?? 'A colleague'} asked to be introduced to you</h3>
        </div>
        <span className="status" data-s={row.status}>
          {LABEL[row.status] ?? row.status}
        </span>
      </div>

      {row.note && <p className="note">“{row.note}”</p>}
      {row.path_json?.length > 1 && <TrustPath chain={row.path_json} links={[]} hops={row.path_json.length - 1} />}

      {row.status === 'pending_expert_consent' ? (
        <div className="actions" style={{ marginTop: 16 }}>
          <button className="btn btn-consent btn-sm" onClick={() => respond('accept')} disabled={!!busy}>
            {busy === 'accept' ? 'Accepting…' : 'Accept and share my email'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => respond('decline')} disabled={!!busy}>
            {busy === 'decline' ? 'Declining…' : 'Decline'}
          </button>
        </div>
      ) : (
        <p className="note" style={{ margin: '14px 0 0' }}>
          {row.status === 'accepted'
            ? `You shared your contact details on ${when(row.responded_at)}.`
            : 'You declined this request. No contact details were shared.'}
        </p>
      )}
    </div>
  );
}

function Outgoing({ row }) {
  const [contact, setContact] = useState(null);
  const [err, setErr] = useState('');

  async function reveal() {
    setErr('');
    try {
      setContact(await intros.contact(row.id));
    } catch (e) {
      setErr(e.status === 403 ? 'They haven’t consented yet, so their details stay private.' : 'Could not load that.');
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <span className="eyebrow">Requested {when(row.created_at)}</span>
          <h3 className="expert-name">{row.expert_name}</h3>
        </div>
        <span className="status" data-s={row.status}>
          {LABEL[row.status] ?? row.status}
        </span>
      </div>

      {row.status === 'pending_expert_consent' && (
        <p className="note">
          {row.expert_name} has to accept before WarmPath shares their contact details. Nothing has been sent to them
          from you yet.
        </p>
      )}
      {row.status === 'declined' && <p className="note">{row.expert_name} declined. Their details stay private.</p>}

      {row.status === 'accepted' &&
        (contact ? (
          <div className="reveal" role="status">
            <span className="eyebrow">Consent given · contact released</span>
            <p className="reveal-email" style={{ margin: '6px 0 0' }}>
              {contact.expertEmail}
            </p>
            <p className="reveal-msg">{contact.introMessage}</p>
          </div>
        ) : (
          <button className="btn btn-sm" onClick={reveal}>
            Show contact details and draft intro
          </button>
        ))}
      {err && <p className="error">{err}</p>}
    </div>
  );
}

export default function InboxView({ onRefresh, liveTick = 0 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      setData(await intros.list());
      onRefresh?.();
    } catch {
      setError('Could not load your introductions.');
    }
  }
  // Reload on mount and whenever a realtime change arrives (liveTick bumps).
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTick]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <div className="empty">Loading…</div>;

  const { inbox = [], outbox = [] } = data;

  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Introductions</span>
        <h1 className="page-title">Consent inbox</h1>
        <p className="page-sub">
          Every introduction needs two yeses: yours to ask, and theirs to be reached. Contact details are released only
          after the expert accepts.
        </p>
      </header>

      <div className="results-head">
        <h2 className="eyebrow">Asked of you</h2>
        <span className="eyebrow">{inbox.length}</span>
      </div>
      {inbox.length === 0 ? (
        <div className="empty">
          <strong>No one has asked you for an introduction.</strong>
          When a colleague needs your expertise, the request lands here first.
        </div>
      ) : (
        inbox.map((r) => <Incoming key={r.id} row={r} onDone={load} />)
      )}

      <div className="results-head" style={{ marginTop: 34 }}>
        <h2 className="eyebrow">Your requests</h2>
        <span className="eyebrow">{outbox.length}</span>
      </div>
      {outbox.length === 0 ? (
        <div className="empty">
          <strong>You haven’t asked for an introduction yet.</strong>
          Search for a topic, then ask the expert WarmPath finds.
        </div>
      ) : (
        outbox.map((r) => <Outgoing key={r.id} row={r} />)
      )}
    </>
  );
}
