import { useCallback, useEffect, useRef, useState } from 'react';
import { me as fetchMe, billing, auth, getToken, realtimeUrl } from './api';
import Login from './Login';
import SearchView from './SearchView';
import InboxView from './InboxView';
import IngestView from './IngestView';

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function Paywall({ onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const modalRef = useRef(null);
  const firstRef = useRef(null);
  const returnTo = useRef(null);

  // role="dialog" is a promise: focus goes in, stays in, and comes back out.
  // The trigger is often gone by now — the example chips disable themselves
  // while the search runs, so focus had already fallen to <body>. Land on the
  // search input in that case rather than dropping the user at the top.
  useEffect(() => {
    const trigger = document.activeElement;
    returnTo.current = trigger && trigger !== document.body ? trigger : null;
    firstRef.current?.focus();
    return () => {
      const target =
        returnTo.current?.isConnected && !returnTo.current.disabled
          ? returnTo.current
          : document.querySelector('.ask input');
      target?.focus?.();
    };
  }, []);

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = modalRef.current?.querySelectorAll(FOCUSABLE);
      if (!f?.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  async function upgrade() {
    setBusy(true);
    setError('');
    try {
      const { url } = await billing.checkout();
      // Stash only when we're actually leaving for Stripe, so paying lands them
      // on the answer they wanted. Stashing at paywall-open would replay the
      // question (and re-open the paywall) on every reload.
      const q = document.querySelector('.ask input')?.value?.trim();
      if (q) sessionStorage.setItem('warmpath.pendingQuestion', q);
      window.location.href = url;
    } catch {
      setError('Checkout could not start. Try again in a moment.');
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-title"
        ref={modalRef}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="eyebrow">Free plan · 3 searches</span>
        <h2 id="paywall-title">You’ve used your free searches</h2>
        <p>Upgrade to keep searching the collaboration graph and requesting introductions.</p>

        <div className="price">
          <b>$3</b>
          <span>/ MONTH</span>
        </div>
        <ul className="perks">
          <li>Unlimited expert searches</li>
          <li>Full trust paths, up to four hops</li>
          <li>AI-drafted introductions once the expert consents</li>
        </ul>

        <button ref={firstRef} className="btn btn-primary" style={{ width: '100%' }} onClick={upgrade} disabled={busy}>
          {busy ? 'Opening Stripe…' : 'Upgrade to Pro'}
        </button>
        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={onClose}>
          Not now
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <p className="testcard">Stripe test mode · card 4242 4242 4242 4242 · any future expiry and CVC</p>
      </div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState('search');
  const [paywall, setPaywall] = useState(false);
  const [notice, setNotice] = useState('');
  const [liveTick, setLiveTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setProfile(await fetchMe());
    } catch {
      auth.logout();
      setAuthed(false);
    }
  }, []);

  // Live consent: subscribe to intro_requests over a realtime WebSocket. RLS
  // means each side only hears about rows they're party to, so when the expert
  // accepts, the requester's badge and inbox update without a refresh. Kept at
  // the top level so the badge stays live on any screen.
  useEffect(() => {
    if (!authed) return;
    let ws;
    let closed = false;
    let retry;
    const connect = () => {
      try {
        ws = new WebSocket(realtimeUrl());
      } catch {
        return;
      }
      ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', table: 'intro_requests' }));
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === 'change') {
          refresh();
          setLiveTick((t) => t + 1);
        }
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [authed, refresh]);

  // Returning from Stripe Checkout: confirm server-side, never trust the query string.
  useEffect(() => {
    if (!authed) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    const status = params.get('checkout');

    (async () => {
      if (status === 'success' && sessionId) {
        try {
          await billing.confirm(sessionId);
          setNotice('You’re on Pro. Searches are unlimited.');
        } catch {
          setNotice('We couldn’t confirm that payment yet. Give it a minute and reload — you won’t be charged twice.');
        }
        window.history.replaceState({}, '', window.location.pathname);
      } else if (status === 'cancelled') {
        setNotice('No changes — you’re still on the free plan.');
        window.history.replaceState({}, '', window.location.pathname);
      }
      await refresh();
    })();
  }, [authed, refresh]);

  const openPaywall = useCallback(() => setPaywall(true), []);

  const onUsage = useCallback(
    (res) => setProfile((p) => ({ ...p, used: res.used, remaining: Math.max(0, res.limit - res.used) })),
    [],
  );

  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  if (!profile) return <div className="auth">Loading…</div>;

  const isPro = profile.plan === 'pro';
  const spent = Math.min(profile.used, profile.limit);
  const pending = profile.pendingConsent ?? 0;
  const accepted = profile.acceptedIntros ?? 0;

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="shell">
        <nav className="rail" aria-label="Primary">
          <div className="brand">
            <span className="brand-mark">
              Warm<em>Path</em>
            </span>
          </div>

          <div className="nav">
            <button aria-current={view === 'search' ? 'page' : undefined} onClick={() => setView('search')}>
              Search
            </button>
            <button aria-current={view === 'ingest' ? 'page' : undefined} onClick={() => setView('ingest')}>
              Grow the graph
            </button>
            <button aria-current={view === 'inbox' ? 'page' : undefined} onClick={() => setView('inbox')}>
              Introductions
              {pending > 0 && (
                <span className="badge" aria-label={`${pending} awaiting your consent`}>
                  {pending}
                </span>
              )}
              {pending === 0 && accepted > 0 && (
                <span className="badge" data-tone="accepted" aria-label={`${accepted} accepted`}>
                  {accepted}
                </span>
              )}
            </button>
          </div>

          <div className="rail-foot">
            {!isPro && (
              <span className="quota-chip" data-empty={profile.remaining === 0}>
                {profile.remaining}/{profile.limit} free
              </span>
            )}
            <div className="identity">
              <div className="identity-name">{profile.person?.name ?? profile.email}</div>
              <div className="identity-title">
                {profile.person ? `${profile.person.title} · ${profile.person.team}` : profile.email}
              </div>
              {isPro ? (
                <div className="plan-pro" style={{ marginTop: 10 }}>
                  PRO · UNLIMITED
                </div>
              ) : (
                <>
                  <div className="meter" aria-hidden="true">
                    {Array.from({ length: profile.limit }, (_, i) => (
                      <i key={i} data-spent={i < spent} />
                    ))}
                  </div>
                  <div className="eyebrow" style={{ marginTop: 7 }}>
                    {profile.remaining} of {profile.limit} free searches left
                  </div>
                </>
              )}
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                auth.logout();
                setAuthed(false);
                setProfile(null);
              }}
            >
              Sign out
            </button>
          </div>
        </nav>

        <main className="main" id="main">
          {notice && (
            <div className="reveal notice" style={{ marginBottom: 22, marginTop: 0 }} role="status">
              <p>{notice}</p>
              <button onClick={() => setNotice('')} aria-label="Dismiss">
                ×
              </button>
            </div>
          )}
          {view === 'search' && <SearchView onUsage={onUsage} onPaywall={openPaywall} />}
          {view === 'ingest' && (
            <IngestView
              onSearchSkill={(q) => {
                sessionStorage.setItem('warmpath.pendingQuestion', q);
                setView('search');
              }}
            />
          )}
          {view === 'inbox' && <InboxView onRefresh={refresh} liveTick={liveTick} />}
        </main>
      </div>

      {paywall && <Paywall onClose={() => setPaywall(false)} />}
    </>
  );
}
