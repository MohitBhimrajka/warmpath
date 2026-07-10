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

async function rocketride(env: any, token: string, body: string): Promise<string> {
  const res = await fetch(`${env.RR_API_URL}/task/data?token=${token}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RR_API_KEY}`, 'Content-Type': 'text/plain' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`RocketRide ${res.status}: ${text.slice(0, 300)}`);
  const answers = JSON.parse(text)?.data?.objects?.body?.answers;
  if (!Array.isArray(answers) || !answers.length) {
    throw new Error(`RocketRide returned no answers: ${text.slice(0, 300)}`);
  }
  return String(answers[answers.length - 1]).trim();
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
      ctx.env,
      ctx.env.RR_TOKEN_EXPLAIN,
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
