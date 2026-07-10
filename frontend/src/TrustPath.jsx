// The signature element: the shortest collaboration path, rendered as a wire
// whose colour and thickness come from the `strength` property stored on each
// COLLABORATED_WITH edge in Neo4j. Nothing here is decorative — a segment only
// looks warm because the underlying relationship is strong.
//
// The wire itself is aria-hidden and a visually-hidden sentence carries the
// same information to assistive tech. The *reason* each link exists is the
// product; a screen reader that only heard the names would be missing it.

const COLD = [74, 98, 116]; // --cold  #4a6274
const EMBER = [242, 166, 90]; // --ember #f2a65a

/** strength 1–10 → the colour of that tie. */
function warmth(strength) {
  const t = Math.max(0, Math.min(1, (Number(strength || 1) - 1) / 9));
  const c = COLD.map((cold, i) => Math.round(cold + (EMBER[i] - cold) * t));
  return `rgb(${c.join(',')})`;
}

const thickness = (strength) => 1.5 + (Math.max(1, Math.min(10, Number(strength || 1))) / 10) * 1.8;

/** One sentence describing the whole chain, links included. */
function narrate(chain, links) {
  return chain
    .map((p, i) => {
      if (i === 0) return `Start with you, in ${p.team}.`;
      const link = links?.[i - 1];
      const role = i === chain.length - 1 ? 'the expert' : 'a connector';
      const via = link?.context ? `, who ${link.context} (tie strength ${link.strength} of 10)` : '';
      return `Then ${p.name}, in ${p.team}, ${role}${via}.`;
    })
    .join(' ');
}

export default function TrustPath({ chain, links, hops }) {
  if (!chain?.length || hops < 0) {
    return (
      <div className="cold-path">
        <span aria-hidden="true">◦</span>
        <span>
          No collaboration path within 4 hops. Reaching out would be cold outreach — WarmPath can still ask, but nobody
          can vouch for you.
        </span>
      </div>
    );
  }

  const hopLabel = `${hops} ${hops === 1 ? 'hop' : 'hops'}`;

  return (
    <div className="filament">
      <div className="filament-head">
        <span className="eyebrow">Shortest trust path · {hopLabel}</span>
        <span className="filament-rule" />
      </div>

      <p className="sr-only">
        Shortest trust path, {hopLabel}. {narrate(chain, links)}
      </p>

      <div className="wire" aria-hidden="true">
        {chain.map((person, i) => {
          // `links` is absent when we replay a stored path (the inbox); draw the
          // wire cold rather than leaving a gap between the nodes.
          const link = links?.[i];
          const isLast = i === chain.length - 1;
          const role = i === 0 ? 'you' : isLast ? 'expert' : 'broker';
          return (
            <div key={person.id} style={{ display: 'contents' }}>
              <div className="node" data-role={role}>
                <span className="node-dot" />
                <span className="node-name">{i === 0 ? 'You' : person.name}</span>
                <span className="node-team">{person.team}</span>
              </div>

              {!isLast && (
                <div className="segment">
                  {/* Colour and thickness are custom properties, not literal
                      height/background, so the mobile rules can turn the wire
                      vertical without the inline style winning. */}
                  <div
                    className="segment-wire"
                    style={{
                      '--wire-color': warmth(link?.strength ?? 1),
                      '--wire-w': `${thickness(link?.strength ?? 1)}px`,
                      '--delay': `${i * 0.22}s`,
                    }}
                  />
                  {link && (
                    <div className="segment-meta">
                      <span className="segment-strength">{link.strength}</span>
                      <span className="segment-context">{link.context}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
