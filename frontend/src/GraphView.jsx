import { useEffect, useMemo, useRef, useState } from 'react';

// The neighbourhood as an actual graph. Nodes are people, edges are real
// collaborations coloured by their strength, and the shortest warm path to the
// selected expert is lit through the web. This is the "it's a graph" moment —
// the sparse trusted route threading a dense network.

const COLD = [74, 98, 116];
const EMBER = [242, 166, 90];
const warmth = (s) => {
  const t = Math.max(0, Math.min(1, (Number(s || 1) - 1) / 9));
  return `rgb(${COLD.map((c, i) => Math.round(c + (EMBER[i] - c) * t)).join(',')})`;
};

const W = 640;
const H = 400;

// A small, stable force layout. Deterministic-ish initial ring so the picture
// looks the same each render; a few hundred ticks settle it.
function layout(nodes, edges, anchorId, ticks) {
  const idx = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
  const pos = nodes.map((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2;
    return { x: W / 2 + Math.cos(a) * 130, y: H / 2 + Math.sin(a) * 90, vx: 0, vy: 0 };
  });
  const links = edges.map((e) => [idx[e.a], idx[e.b]]).filter(([a, b]) => a != null && b != null);

  for (let t = 0; t < ticks; t++) {
    // repulsion
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let d2 = dx * dx + dy * dy || 1;
        const f = 2600 / d2;
        const d = Math.sqrt(d2);
        dx /= d;
        dy /= d;
        pos[i].vx += dx * f;
        pos[i].vy += dy * f;
        pos[j].vx -= dx * f;
        pos[j].vy -= dy * f;
      }
    }
    // springs
    for (const [a, b] of links) {
      let dx = pos[b].x - pos[a].x;
      let dy = pos[b].y - pos[a].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 74) * 0.02;
      dx /= d;
      dy /= d;
      pos[a].vx += dx * f;
      pos[a].vy += dy * f;
      pos[b].vx -= dx * f;
      pos[b].vy -= dy * f;
    }
    // gravity to centre + anchor pull for "You"
    for (let i = 0; i < pos.length; i++) {
      pos[i].vx += (W / 2 - pos[i].x) * 0.012;
      pos[i].vy += (H / 2 - pos[i].y) * 0.012;
      if (nodes[i].id === anchorId) {
        pos[i].vx += (W / 2 - pos[i].x) * 0.06;
        pos[i].vy += (H / 2 - pos[i].y) * 0.06;
      }
      pos[i].vx *= 0.86;
      pos[i].vy *= 0.86;
      pos[i].x = Math.max(28, Math.min(W - 28, pos[i].x + pos[i].vx));
      pos[i].y = Math.max(24, Math.min(H - 24, pos[i].y + pos[i].vy));
    }
  }
  return Object.fromEntries(nodes.map((n, i) => [n.id, { x: pos[i].x, y: pos[i].y }]));
}

export default function GraphView({ graph, requesterId, experts, selectedId, onSelect }) {
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Settle fully up front (cheap at this size); animate the reveal separately.
  const positions = useMemo(() => layout(nodes, edges, requesterId, 320), [graph, requesterId]);
  const expertIds = useMemo(() => new Set(experts.map((e) => e.id)), [experts]);

  // The lit path = the selected expert's chain, as consecutive id pairs.
  const selected = experts.find((e) => e.id === selectedId) ?? experts[0];
  const pathIds = selected?.chain?.map((n) => n.id) ?? [];
  const pathNodeSet = new Set(pathIds);
  const pathEdgeSet = new Set();
  for (let i = 0; i < pathIds.length - 1; i++) {
    pathEdgeSet.add([pathIds[i], pathIds[i + 1]].sort().join('|'));
  }

  // A one-shot reveal: fade/scale the lit path in.
  const [lit, setLit] = useState(reduce);
  const raf = useRef(0);
  useEffect(() => {
    setLit(false);
    cancelAnimationFrame(raf.current);
    if (reduce) {
      setLit(true);
      return;
    }
    const t = setTimeout(() => setLit(true), 120);
    return () => clearTimeout(t);
  }, [selectedId, graph, reduce]);

  if (nodes.length < 2) return null;

  const nameOf = (id) => nodes.find((n) => n.id === id)?.name ?? id;

  return (
    <figure className="graphviz">
      <figcaption className="graphviz-cap">
        <span className="eyebrow">The collaboration graph around your question</span>
        <span className="graphviz-hint">Tap a lit node to re-route the warm path</span>
      </figcaption>
      <div className="graphviz-frame">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Collaboration graph; warm path lit to ${selected?.name}`}>
          {edges.map((e, i) => {
            const a = positions[e.a];
            const b = positions[e.b];
            if (!a || !b) return null;
            const onPath = pathEdgeSet.has([e.a, e.b].sort().join('|'));
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={onPath ? warmth(e.strength) : 'var(--line-bright)'}
                strokeWidth={onPath ? 1.5 + (e.strength / 10) * 2 : 1}
                strokeOpacity={onPath ? (lit ? 1 : 0) : 0.4}
                style={{ transition: 'stroke-opacity .5s ease' }}
              >
                <title>{`${nameOf(e.a)} ↔ ${nameOf(e.b)} · ${e.context} (${e.strength}/10)`}</title>
              </line>
            );
          })}
          {nodes.map((n) => {
            const p = positions[n.id];
            if (!p) return null;
            const isYou = n.id === requesterId;
            const isExpert = expertIds.has(n.id);
            const onPath = pathNodeSet.has(n.id);
            const r = isYou ? 8 : isExpert ? 8 : 5;
            const fill = onPath && isExpert ? 'var(--ember)' : onPath ? 'var(--ember-dim)' : 'var(--surface-2)';
            const stroke = isYou ? 'var(--text-dim)' : isExpert ? 'var(--ember)' : 'var(--cold)';
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                className={isExpert ? 'graphviz-node graphviz-node--click' : 'graphviz-node'}
                onClick={isExpert ? () => onSelect?.(n.id) : undefined}
                role={isExpert ? 'button' : undefined}
                tabIndex={isExpert ? 0 : undefined}
                onKeyDown={isExpert ? (ev) => (ev.key === 'Enter' || ev.key === ' ') && onSelect?.(n.id) : undefined}
                aria-label={isExpert ? `Route via ${n.name}` : undefined}
              >
                {n.id === selected?.id && <circle r={r + 5} fill="none" stroke="var(--ember)" strokeOpacity="0.35" />}
                <circle r={r} fill={fill} stroke={stroke} strokeWidth="2" />
                <text y={r + 13} textAnchor="middle" className="graphviz-label" fill={onPath ? 'var(--text)' : 'var(--text-mute)'}>
                  {isYou ? 'You' : n.name.split(' ')[0]}
                </text>
                <title>{`${n.name} · ${n.team}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
