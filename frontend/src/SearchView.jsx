import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { search, explain, intros, ApiError } from './api';
import TrustPath from './TrustPath';
import GraphView from './GraphView';

const EXAMPLES = [
  'Who knows about SAP integration?',
  'We keep having pod evictions in prod, who can help?',
  'Need someone who understands fraud models',
];

// The three steps mirror the real call chain, so the wait explains the system
// instead of hiding it.
const STEPS = [
  { key: 'extract', label: 'Reading the question for a skill', where: 'RocketRide Cloud' },
  { key: 'graph', label: 'Ranking experts and tracing the trust path', where: 'Neo4j' },
  { key: 'explain', label: 'Writing the introduction briefing', where: 'RocketRide Cloud' },
];

const ANNOUNCE = {
  extract: 'Step 1 of 3: reading your question. This takes a few seconds.',
  graph: 'Step 2 of 3: ranking experts and tracing the trust path.',
  explain: 'Step 3 of 3: writing the introduction briefing.',
};

function Steps({ stage }) {
  const at = STEPS.findIndex((s) => s.key === stage);
  return (
    <>
      {/* The visual panel never changes its text, so it can't drive a live
          region. This does, with one discrete message per stage. */}
      <p className="sr-only" role="status" aria-live="polite">
        {ANNOUNCE[stage]}
      </p>
      <div className="steps" aria-hidden="true">
        {STEPS.map((s, i) => (
          <div key={s.key} className="step" data-state={i < at ? 'done' : i === at ? 'active' : 'idle'}>
            <span className="step-dot" />
            <span>{s.label}</span>
            <span className="step-where">{s.where}</span>
          </div>
        ))}
      </div>
    </>
  );
}

const Expert = memo(function Expert({ expert, rank, skill, onRequested, requested }) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const cold = expert.hops < 0;

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await intros.create(expert.id, expert.chain, note.trim() || `Looking for help with ${skill}.`);
      onRequested(expert.id);
    } catch (e2) {
      // Already pending is the desired end state, not an error.
      if (e2.status === 409) onRequested(expert.id);
      else setErr('Could not send that request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="expert">
      <div className="expert-top">
        <span className="rank mono">{String(rank).padStart(2, '0')}</span>
        <div className="expert-body">
          <h3 className="expert-name">{expert.name}</h3>
          <p className="expert-role">
            {expert.title} · {expert.team}
          </p>
        </div>
        <div className="expert-actions">
          {requested ? (
            <span className="status" data-s="pending_expert_consent" role="status">
              Awaiting consent
            </span>
          ) : (
            !asking && (
              <button className="btn btn-sm" onClick={() => setAsking(true)}>
                {cold ? 'Ask anyway (cold)' : 'Ask for an intro'}
              </button>
            )
          )}
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat-label" id={`prof-${expert.id}`}>
            Proficiency
          </span>
          {expert.proficiency > 0 ? (
            <span className="prof" role="img" aria-label={`Proficiency: ${expert.proficiency} out of 5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <i key={n} data-on={n <= expert.proficiency} />
              ))}
            </span>
          ) : (
            <span className="via-project">Not rated · project evidence</span>
          )}
        </div>
        <div className="stat">
          <span className="stat-label">Collaborators</span>
          <span className="stat-value">{expert.degree}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Distance</span>
          <span className="stat-value" data-tone={cold ? 'cold' : 'warm'}>
            {cold ? 'unreachable' : `${expert.hops} hops`}
          </span>
        </div>
      </div>

      {expert.evidence && <p className="evidence">{expert.evidence}</p>}

      {asking && !requested && (
        <form className="ask-note" onSubmit={submit}>
          <label className="eyebrow" htmlFor={`note-${expert.id}`}>
            What do you need? (optional — it goes into the introduction)
          </label>
          <textarea
            id={`note-${expert.id}`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`e.g. wiring our ERP connector, 30 minutes of your time`}
          />
          <div className="actions">
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send request'}
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setAsking(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {err && <p className="error">{err}</p>}

      <TrustPath chain={expert.chain} links={expert.links} hops={expert.hops} />
    </article>
  );
});

export default function SearchView({ onUsage, onPaywall }) {
  const [question, setQuestion] = useState('');
  const [stage, setStage] = useState(null);
  const [result, setResult] = useState(null);
  // null = still writing, '' = failed, string = the briefing.
  const [briefing, setBriefing] = useState(null);
  const [error, setError] = useState('');
  const [requested, setRequested] = useState([]);
  const [selectedExpert, setSelectedExpert] = useState(null);
  const stageTimer = useRef(null);

  const onRequested = useCallback((id) => setRequested((r) => (r.includes(id) ? r : [...r, id])), []);

  useEffect(() => () => clearTimeout(stageTimer.current), []);

  const run = useCallback(
    async (q) => {
      const text = (q ?? question).trim();
      if (!text) return;
      setQuestion(text);
      setError('');
      setResult(null);
      setBriefing(null);
      setRequested([]);

      // `search` does extract-then-graph server-side, so we can't observe the
      // handover. Advance on the measured p50 of the extract call instead of
      // flashing straight past step 1.
      setStage('extract');
      clearTimeout(stageTimer.current);
      stageTimer.current = setTimeout(() => setStage((s) => (s === 'extract' ? 'graph' : s)), 4200);

      try {
        const res = await search(text);
        clearTimeout(stageTimer.current);
        setResult(res);
        setRequested(res.pendingIntros ?? []);
        setSelectedExpert(res.experts?.[0]?.id ?? null);
        onUsage(res);

        if (res.experts.length) {
          setStage('explain');
          try {
            const { explanation } = await explain(res.searchId);
            setBriefing(explanation);
          } catch {
            setBriefing(''); // the ranked list still stands on its own
          }
        }
      } catch (e) {
        clearTimeout(stageTimer.current);
        if (e instanceof ApiError && e.status === 402) onPaywall();
        else setError('The search could not be completed. Try again in a moment.');
      } finally {
        setStage(null);
      }
    },
    [question, onUsage, onPaywall],
  );

  // Resume the question the user was mid-way through when the paywall sent them
  // to Stripe, so paying lands them on the answer they wanted.
  useEffect(() => {
    const pending = sessionStorage.getItem('warmpath.pendingQuestion');
    if (pending) {
      sessionStorage.removeItem('warmpath.pendingQuestion');
      run(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const experts = result?.experts ?? [];

  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Expert search</span>
        <h1 className="page-title">Who knows about…</h1>
        <p className="page-sub">
          Ask in your own words. WarmPath finds the people with real evidence of the skill, then works out who can
          introduce you.
        </p>
      </header>

      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Who knows about SAP integration?"
          aria-label="Your question"
          disabled={!!stage}
        />
        <button className="btn btn-primary" type="submit" disabled={!!stage || !question.trim()}>
          {stage ? 'Searching…' : 'Find experts'}
        </button>
      </form>

      <div className="examples">
        {EXAMPLES.map((e) => (
          <button key={e} className="chip" type="button" onClick={() => run(e)} disabled={!!stage}>
            {e}
          </button>
        ))}
      </div>

      {stage && <Steps stage={stage} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {result && !stage && (
        <>
          <p className="sr-only" role="status">
            {experts.length} {experts.length === 1 ? 'person' : 'people'} found with {result.skill}.
          </p>

          {experts.length > 0 && result.graph?.nodes?.length > 1 && (
            <GraphView
              graph={result.graph}
              requesterId={result.requesterId}
              experts={experts}
              selectedId={selectedExpert}
              onSelect={setSelectedExpert}
            />
          )}

          {experts.length > 0 && (
            <div className="briefing">
              <span className="eyebrow">Briefing</span>
              {briefing === null ? (
                <span className="briefing-pending">Writing the briefing…</span>
              ) : briefing ? (
                <span>{briefing}</span>
              ) : (
                <span className="briefing-pending">
                  The briefing didn’t come back. The ranked list and trust paths below stand on their own.
                </span>
              )}
            </div>
          )}

          <div className="results-head">
            <h2 className="eyebrow">
              {experts.length} {experts.length === 1 ? 'person' : 'people'} with {result.skill}
            </h2>
            <span className="eyebrow">Ranked by proficiency, then centrality</span>
          </div>

          {experts.length === 0 ? (
            <div className="empty">
              <strong>Nobody in the graph lists {result.skill}.</strong>
              No project using it has contributors either. Try a broader topic.
            </div>
          ) : (
            experts.map((e, i) => (
              <Expert
                key={e.id}
                expert={e}
                rank={i + 1}
                skill={result.skill}
                requested={requested.includes(e.id)}
                onRequested={onRequested}
              />
            ))
          )}
        </>
      )}
    </>
  );
}
