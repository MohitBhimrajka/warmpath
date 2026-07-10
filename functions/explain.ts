// WarmPath — warm-path explanation (phase 2 of 2).
//
// Reads the search row the user just created, sends the ranked graph rows to a
// second RocketRide Cloud pipeline, and stores the prose back on the row.
// Kept separate from search.ts so the expert list can render while this runs.

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

const EXPLAIN_INSTRUCTIONS = `You are WarmPath's warm-introduction explainer.
The input is a JSON object with: question, requester (their name), and experts (an ordered, already-ranked list from a Neo4j collaboration graph).
Each expert has: name, title, team, proficiency (1-5), evidence, degree (how many colleagues they collaborate with), hops (shortest collaboration path length from the requester, -1 if none), chain (people on that path in order) and links (shared context for each step).
Write a short briefing of 2 to 4 sentences in plain prose. No markdown, no bullets, no headings.
Name the top expert and say concretely why they are right, quoting their evidence.
Then explain the warm path as a chain of real relationships using the link context, e.g. "You worked with Priya on the Q3 retention dashboard, and Priya integrated the analytics export into Chen's SAP pipeline."
If the top two experts tie on proficiency and the ranking was decided by collaboration centrality, say so in one clause.
If hops is -1 for the top expert, say plainly there is no warm path and this would be cold outreach.
Address the requester as "you". Never invent facts absent from the JSON.`;

// Self-healing: recreate a RocketRide pipeline that has been terminated. See
// search.ts for the full rationale — name → {token, spec} lives in pipeline_state.
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

export default async function handler(req: Request, ctx: any): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!ctx.user) return json({ error: 'unauthorized' }, 401);

  let searchId = '';
  try {
    searchId = String((await req.json()).searchId ?? '');
  } catch {
    /* validated below */
  }
  if (!searchId) return json({ error: 'searchId is required' }, 400);

  // RLS scopes this to the caller's own searches.
  const row = await ctx.db.query(`SELECT question, result_json FROM searches WHERE id = $1::uuid`, [searchId]);
  if (!row.rows.length) return json({ error: 'not_found' }, 404);

  const { question, result_json: result } = row.rows[0];
  const experts = result?.experts ?? [];

  if (!experts.length) {
    const explanation = `No one in the Meridian Systems graph lists ${result?.skill ?? 'that skill'} as a skill, and no project using it has contributors. Try a broader topic.`;
    return json({ explanation });
  }

  try {
    const explanation = await rocketride(
      ctx,
      'warmpath-explain',
      `${EXPLAIN_INSTRUCTIONS}\n\n${JSON.stringify({
        question,
        requester: result.requesterName ?? 'you',
        experts: experts.slice(0, 3),
      })}`,
    );

    await ctx.db.query(
      `UPDATE searches SET result_json = jsonb_set(result_json, '{explanation}', to_jsonb($1::text)) WHERE id = $2::uuid`,
      [explanation, searchId],
    );
    return json({ explanation });
  } catch (err) {
    console.error('explain failed', String(err));
    return json({ error: 'explain_failed', detail: String(err).slice(0, 300) }, 502);
  }
}
