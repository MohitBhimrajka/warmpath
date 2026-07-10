// WarmPath — ingest a document into the graph.
//
//   raw text (a Slack message, a doc snippet)
//     -> RocketRide Cloud pipeline: LLM extracts {person, skill, evidence, proficiency} triples
//     -> Neo4j: deterministic MERGE (the backend writes the Cypher, not the LLM)
//
// This is the second RocketRide pipeline, and it's what proves the graph is
// AI-built: paste a sentence about someone's work, and their expertise becomes
// searchable — with a warm path — moments later.
//
// Same principle as search: RocketRide does the language understanding, the
// backend does the deterministic graph write. We never run LLM-authored Cypher.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

const INSTRUCTIONS = `You extract expertise facts for WarmPath, a company knowledge graph.
From the text, extract every well-supported (person, skill, evidence) fact.
- person: the full name of a person the text says has a skill.
- skill: a short canonical skill or technology name, e.g. "Rust", "Kubernetes", "SAP Integration", "GraphQL".
- evidence: a short phrase quoting what they did, drawn from the text.
- proficiency: an integer 1-5 estimating depth from the text (a shipped/led project = 4-5, a mention = 2-3).
Only extract facts the text actually supports. Do not invent people or skills.
Respond with ONLY a single minified JSON object, no prose, no markdown, no code fences:
{"triples":[{"person":"","skill":"","evidence":"","proficiency":0}]}`;

// Match an existing person by name (so "Priya Nair" attaches to p-priya and her
// existing collaboration edges), otherwise create a new ingested Person. Then
// MERGE the skill and the HAS_SKILL edge. isNew tells the UI whether this added
// a brand-new person or a new skill for someone already in the graph.
const MERGE_CYPHER = `
UNWIND $triples AS t
MERGE (p:Person {name: t.person})
  ON CREATE SET p.id = 'ing-' + replace(toLower(t.person), ' ', '-'),
                p.title = 'Contributor',
                p.team = 'Ingested'
MERGE (s:Skill {name: t.skill})
  ON CREATE SET s.category = 'Ingested'
MERGE (p)-[h:HAS_SKILL]->(s)
  SET h.proficiency = t.proficiency, h.evidence = t.evidence
RETURN t.person AS person, t.skill AS skill, t.evidence AS evidence,
       t.proficiency AS proficiency, p.id AS personId,
       (p.id STARTS WITH 'ing-') AS isNewPerson`;

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

async function neo4j(ctx: any, statement: string, parameters: Record<string, unknown>) {
  const auth = btoa(`${ctx.env.NEO4J_USER}:${ctx.env.NEO4J_PASSWORD}`);
  const res = await fetch(`${ctx.env.NEO4J_HOST}/db/${ctx.env.NEO4J_DB}/query/v2`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ statement, parameters }),
  });
  const text = await res.text();
  if (res.status !== 200 && res.status !== 202) throw new Error(`Neo4j ${res.status}: ${text.slice(0, 300)}`);
  const { fields = [], values = [] } = JSON.parse(text).data || {};
  return values.map((row: unknown[]) => Object.fromEntries(fields.map((f: string, i: number) => [f, row[i]])));
}

function parseJsonLoose(s: string): any {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : s).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const braced = candidate.match(/\{[\s\S]*\}/);
    if (braced) return JSON.parse(braced[0]);
    throw new Error(`could not parse triples from: ${s.slice(0, 200)}`);
  }
}

export default async function handler(req: Request, ctx: any): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!ctx.user) return json({ error: 'unauthorized' }, 401);

  let text = '';
  try {
    text = String((await req.json()).text ?? '').trim();
  } catch {
    /* validated below */
  }
  if (text.length < 8) return json({ error: 'paste a sentence or two about who did what' }, 400);
  if (text.length > 2000) text = text.slice(0, 2000);

  try {
    const extracted = parseJsonLoose(await rocketride(ctx, 'warmpath-ingest', `${INSTRUCTIONS}\n\nTEXT:\n${text}`));
    const triples = (extracted.triples ?? [])
      .filter((t: any) => t?.person && t?.skill)
      .map((t: any) => ({
        person: String(t.person).trim(),
        skill: String(t.skill).trim(),
        evidence: String(t.evidence ?? '').trim(),
        proficiency: Math.max(1, Math.min(5, Math.round(Number(t.proficiency) || 3))),
      }))
      .slice(0, 12);

    if (!triples.length) return json({ triples: [], written: [], message: 'No clear expertise facts found in that text.' });

    const written = await neo4j(ctx, MERGE_CYPHER, { triples });
    return json({ triples, written });
  } catch (err) {
    console.error('ingest failed', String(err));
    return json({ error: 'ingest_failed', detail: String(err).slice(0, 300) }, 502);
  }
}
