// WarmPath — expert search (phase 1 of 2).
//
//   browser (end-user JWT)
//     -> this function (auth: required)
//          -> RocketRide Cloud  : LLM turns the question into a canonical skill
//          -> Neo4j Aura        : PINNED Cypher ranks experts + finds the warm path
//
// Phase 2 (the prose explanation, a second RocketRide call) lives in explain.ts.
// Splitting them keeps the expert list on screen in ~5s instead of ~14s; the
// explanation lands a few seconds later.
//
// The graph query is deterministic on purpose. Letting an LLM improvise
// shortestPath/centrality Cypher is not something you want happening live.
//
// Secrets (RocketRide key, Neo4j password) live in ctx.env and never leave here.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

const EXTRACT_INSTRUCTIONS = `You extract a search intent for WarmPath, an internal expert-finder over a company knowledge graph.
Identify the single most important SKILL or TOPIC the person wants expertise in.
Normalise it to a short canonical skill name as it would appear in a skills taxonomy, for example: 'SAP Integration', 'Kubernetes', 'Machine Learning', 'Kafka', 'GraphQL', 'IAM'.
Prefer the specific technology over a generic category. Do not invent a skill the question does not imply.
Respond with ONLY a single minified JSON object. No prose, no markdown, no code fences.
Keys exactly: {"skill":"<canonical skill name>","intent":"<one short clause describing what the asker wants>"}`;

// One round trip: expert lookup (direct skill OR via project) + degree centrality
// ranking + shortest warm path. COUNT{} and shortestPath() are core Cypher, so
// this needs neither GDS nor APOC.
const CYPHER = `
MATCH (requester:Person {id:$requesterId})
CALL {
  MATCH (p:Person)-[h:HAS_SKILL]->(s:Skill)
  WHERE toLower(s.name) CONTAINS toLower($skill)
  RETURN p AS person, max(h.proficiency) AS proficiency, head(collect(h.evidence)) AS evidence
  UNION
  MATCH (p:Person)-[:WORKED_ON]->(pr:Project)-[:USES_SKILL]->(s:Skill)
  WHERE toLower(s.name) CONTAINS toLower($skill)
  RETURN p AS person, 0 AS proficiency, head(collect('worked on ' + pr.name)) AS evidence
}
WITH requester, person, max(proficiency) AS proficiency, head(collect(evidence)) AS evidence
WHERE person <> requester
WITH requester, person, proficiency, evidence,
     COUNT { (person)-[:COLLABORATED_WITH]-(:Person) } AS degree
OPTIONAL MATCH path = shortestPath( (requester)-[:COLLABORATED_WITH*..4]-(person) )
RETURN requester.name AS requesterName,
       person.id AS id, person.name AS name, person.title AS title, person.team AS team,
       proficiency, evidence, degree,
       CASE WHEN path IS NULL THEN -1 ELSE length(path) END AS hops,
       CASE WHEN path IS NULL THEN [] ELSE [n IN nodes(path) | {id:n.id,name:n.name,team:n.team}] END AS chain,
       CASE WHEN path IS NULL THEN [] ELSE [r IN relationships(path) | {strength:r.strength,context:r.context}] END AS links
ORDER BY proficiency DESC, degree DESC
LIMIT 8`;

// RocketRide terminates idle tasks, so a token that worked yesterday may point
// at a dead pipeline. We keep name → {token, spec} in the pipeline_state table
// and transparently recreate + retry when a task is gone. This is what stops a
// stale token from 502-ing the demo.
async function rrRecreate(ctx: any, name: string, spec: any, staleToken: string | null): Promise<string> {
  if (staleToken) {
    await fetch(`${ctx.env.RR_API_URL}/task?token=${staleToken}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ctx.env.RR_API_KEY}` },
    }).catch(() => {});
  }
  const body = JSON.stringify(spec).replaceAll('__BB_API_KEY__', ctx.env.BB_API_KEY);
  const res = await fetch(`${ctx.env.RR_API_URL}/task`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.env.RR_API_KEY}`, 'Content-Type': 'application/json' },
    body,
  });
  const token = JSON.parse(await res.text())?.data?.token;
  if (!token) throw new Error(`could not recreate pipeline ${name}`);
  await ctx.db.query(
    `INSERT INTO pipeline_state (name, token, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (name) DO UPDATE SET token = $2, updated_at = now()`,
    [name, token],
  );
  return token;
}

async function rocketride(ctx: any, name: string, input: string): Promise<string> {
  const row = (await ctx.db.query(`SELECT token, spec FROM pipeline_state WHERE name = $1`, [name])).rows[0];
  if (!row) throw new Error(`pipeline ${name} not registered`);
  let token: string = row.token;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) token = await rrRecreate(ctx, name, row.spec, null);
    const res = await fetch(`${ctx.env.RR_API_URL}/task/data?token=${token}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.env.RR_API_KEY}`, 'Content-Type': 'text/plain' },
      body: input,
    });
    const text = await res.text();
    const out = JSON.parse(text);
    const answers = out?.data?.objects?.body?.answers;
    if (Array.isArray(answers) && answers.length) return String(answers[answers.length - 1]).trim();

    const errMsg = out?.data?.objects?.body?.error?.message ?? '';
    if (attempt === 0 && /not running|terminated|wrong token/i.test(errMsg)) {
      token = await rrRecreate(ctx, name, row.spec, token);
      continue;
    }
    throw new Error(`RocketRide ${name} returned no answers: ${text.slice(0, 300)}`);
  }
  throw new Error(`RocketRide ${name} unreachable`);
}

/** Run Cypher through Neo4j Aura's HTTP Query API (bolt is impossible from Deno). */
async function neo4j(env: any, statement: string, parameters: Record<string, unknown>) {
  const auth = btoa(`${env.NEO4J_USER}:${env.NEO4J_PASSWORD}`);
  const res = await fetch(`${env.NEO4J_HOST}/db/${env.NEO4J_DB}/query/v2`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ statement, parameters }),
  });
  const text = await res.text();
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`Neo4j ${res.status}: ${text.slice(0, 300)}`);
  }
  const { fields = [], values = [] } = JSON.parse(text).data || {};
  return values.map((row: unknown[]) => Object.fromEntries(fields.map((f: string, i: number) => [f, row[i]])));
}

/** LLMs like to wrap JSON in fences no matter how firmly you ask them not to. */
function parseJsonLoose(s: string): any {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : s).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const braced = candidate.match(/\{[\s\S]*\}/);
    if (braced) return JSON.parse(braced[0]);
    throw new Error(`could not parse JSON from: ${s.slice(0, 200)}`);
  }
}

export default async function handler(req: Request, ctx: any): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!ctx.user) return json({ error: 'unauthorized' }, 401);

  const uid = ctx.user.id;
  const limit = Number(ctx.env.FREE_SEARCH_LIMIT ?? 3);

  let question = '';
  try {
    question = String((await req.json()).question ?? '').trim();
  } catch {
    /* fall through to validation */
  }
  if (!question) return json({ error: 'question is required' }, 400);

  // Make sure this user has a profile (their identity in the graph) and a plan.
  await ctx.db.query(
    `INSERT INTO profiles (user_id, person_id) VALUES ($1::uuid, 'p-maya') ON CONFLICT (user_id) DO NOTHING`,
    [uid],
  );
  await ctx.db.query(
    `INSERT INTO subscriptions (user_id, plan) VALUES ($1::uuid, 'free') ON CONFLICT (user_id) DO NOTHING`,
    [uid],
  );

  const profile = await ctx.db.query(`SELECT person_id FROM profiles WHERE user_id = $1::uuid`, [uid]);
  const requesterId = profile.rows[0]?.person_id ?? 'p-maya';

  const sub = await ctx.db.query(`SELECT plan FROM subscriptions WHERE user_id = $1::uuid`, [uid]);
  const plan = sub.rows[0]?.plan ?? 'free';

  const used = Number((await ctx.db.query(`SELECT count(*)::int AS n FROM searches WHERE user_id = $1::uuid`, [uid])).rows[0].n);

  // The paywall lives here, server-side. A client flag would be trivially bypassed.
  if (plan !== 'pro' && used >= limit) {
    return json({ error: 'upgrade_required', plan, used, limit }, 402);
  }

  // Record the attempt before doing the work, so aborting mid-search can't farm
  // free searches. Rolled back below if the search itself fails.
  const inserted = await ctx.db.query(
    `INSERT INTO searches (user_id, question) VALUES ($1::uuid, $2) RETURNING id`,
    [uid, question],
  );
  const searchId = inserted.rows[0].id;

  try {
    const extracted = parseJsonLoose(
      await rocketride(ctx, 'warmpath-extract', `${EXTRACT_INSTRUCTIONS}\n\nQUESTION: ${question}`),
    );
    const skill = String(extracted.skill ?? '').trim();
    if (!skill) throw new Error('no skill extracted');

    const rows = await neo4j(ctx.env, CYPHER, { requesterId, skill });
    const requesterName = rows[0]?.requesterName ?? 'you';
    const experts = rows.map(({ requesterName: _drop, ...e }: any) => e);

    // The neighbourhood subgraph, for the visual: every person on any warm path
    // plus the experts and the requester, and the COLLABORATED_WITH edges among
    // them — so the picture shows the dense web the sparse warm path threads
    // through, not just the line. Two small reads, run alongside each other.
    const ids = Array.from(
      new Set([requesterId, ...experts.flatMap((e: any) => [e.id, ...e.chain.map((n: any) => n.id)])]),
    );
    let graph = { nodes: [] as any[], edges: [] as any[] };
    if (ids.length > 1) {
      const [nodes, edges] = await Promise.all([
        neo4j(ctx.env, `MATCH (p:Person) WHERE p.id IN $ids RETURN p.id AS id, p.name AS name, p.team AS team`, { ids }),
        neo4j(
          ctx.env,
          `MATCH (a:Person)-[c:COLLABORATED_WITH]-(b:Person)
           WHERE a.id IN $ids AND b.id IN $ids AND a.id < b.id
           RETURN a.id AS a, b.id AS b, c.strength AS strength, c.context AS context`,
          { ids },
        ),
      ]);
      graph = { nodes, edges };
    }

    const result = { skill, intent: extracted.intent ?? null, experts, requesterName, graph };
    await ctx.db.query(`UPDATE searches SET skill = $1, result_json = $2::jsonb WHERE id = $3::uuid`, [
      skill,
      JSON.stringify(result),
      searchId,
    ]);

    // So the UI can show "Awaiting consent" instead of offering to ask again —
    // local component state would forget this on the next search.
    const pendingIntros = (
      await ctx.db.query(
        `SELECT expert_person_id FROM intro_requests WHERE requester_id = $1::uuid AND status = 'pending_expert_consent'`,
        [uid],
      )
    ).rows.map((r: any) => r.expert_person_id);

    return json({ ...result, graph, searchId, requesterId, plan, used: used + 1, limit, pendingIntros });
  } catch (err) {
    // Don't charge a free search for our own failure.
    await ctx.db.query(`DELETE FROM searches WHERE id = $1::uuid`, [searchId]);
    console.error('search failed', String(err));
    return json({ error: 'search_failed', detail: String(err).slice(0, 300) }, 502);
  }
}
