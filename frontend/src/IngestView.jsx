import { useState } from 'react';
import { ingest } from './api';

const SAMPLES = [
  'Chen Wei presented his side project on quantum error correction at the eng all-hands — he implemented a surface-code decoder and walked us through the threshold theorem. Genuinely deep on this.',
  'Huge shoutout to Priya Nair — she rebuilt our ingestion service from scratch in Rust this quarter and cut p99 latency in half. Absolute Rust wizard now.',
  'Sofia Ramos ran a brilliant internal workshop on prompt evaluation and LLM red-teaming. She clearly knows evals cold.',
];

export default function IngestView({ onSearchSkill }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function run() {
    const t = text.trim();
    if (t.length < 8) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r = await ingest(t);
      setResult(r);
    } catch {
      setError('Could not read that. Try a sentence or two about who did what.');
    } finally {
      setBusy(false);
    }
  }

  const facts = result?.written ?? [];

  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Grow the graph</span>
        <h1 className="page-title">Teach WarmPath something new</h1>
        <p className="page-sub">
          Paste a Slack message or a doc snippet. A RocketRide Cloud pipeline reads it for who-knows-what and writes the
          new expertise straight into the Neo4j graph — searchable, with a warm path, seconds later.
        </p>
      </header>

      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
      >
        <textarea
          className="ingest-box"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Chen Wei just shipped a surface-code decoder for our quantum project…"
          aria-label="Document to ingest"
          disabled={busy}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || text.trim().length < 8} style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Reading…' : 'Read into the graph'}
        </button>
      </form>

      <div className="examples" style={{ marginTop: 14 }}>
        {SAMPLES.map((s, i) => (
          <button key={i} className="chip" type="button" onClick={() => setText(s)} disabled={busy}>
            Sample {i + 1}
          </button>
        ))}
      </div>

      {busy && (
        <div className="steps" role="status" aria-live="polite" style={{ marginTop: 8 }}>
          <div className="step" data-state="active">
            <span className="step-dot" />
            <span>Extracting who-knows-what</span>
            <span className="step-where">RocketRide Cloud</span>
          </div>
          <div className="step" data-state="idle">
            <span className="step-dot" />
            <span>Writing to the graph</span>
            <span className="step-where">Neo4j</span>
          </div>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {result && !busy && (
        <div style={{ marginTop: 26 }}>
          {facts.length === 0 ? (
            <div className="empty">
              <strong>No clear expertise facts in that text.</strong>
              Try naming a person and what they worked on.
            </div>
          ) : (
            <>
              <div className="results-head">
                <h2 className="eyebrow">Written into the graph</h2>
                <span className="eyebrow">
                  {facts.length} {facts.length === 1 ? 'fact' : 'facts'}
                </span>
              </div>
              {facts.map((f, i) => (
                <article key={i} className="ingest-fact">
                  <div className="ingest-fact-head">
                    <span className="ingest-person">{f.person}</span>
                    <span className="ingest-arrow" aria-hidden="true">
                      now knows
                    </span>
                    <span className="ingest-skill">{f.skill}</span>
                    <span className="ingest-tag">{f.isNewPerson ? 'new person' : 'new skill'}</span>
                  </div>
                  {f.evidence && <p className="evidence" style={{ margin: '10px 0 14px' }}>{f.evidence}</p>}
                  <button className="btn btn-sm" onClick={() => onSearchSkill(`who knows about ${f.skill}?`)}>
                    Search for {f.skill} →
                  </button>
                </article>
              ))}
              <p className="page-sub" style={{ marginTop: 18 }}>
                That expertise is live in the graph now. Search for it and WarmPath will find a warm path to them.
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}
