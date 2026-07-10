// WarmPath — who am I, what plan am I on, how many free searches are left.
//
// `person_id` links a Butterbase auth user to a Person node in the Neo4j graph.
// The demo ships two identities (Maya the requester, Chen the expert) so the
// double-consent flow can be shown with two real accounts rather than a toggle.

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

async function neo4j(env: any, statement: string, parameters: Record<string, unknown>) {
  const auth = btoa(`${env.NEO4J_USER}:${env.NEO4J_PASSWORD}`);
  const res = await fetch(`${env.NEO4J_HOST}/db/${env.NEO4J_DB}/query/v2`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ statement, parameters }),
  });
  if (res.status !== 200 && res.status !== 202) throw new Error(`Neo4j ${res.status}`);
  const { fields = [], values = [] } = JSON.parse(await res.text()).data || {};
  return values.map((r: unknown[]) => Object.fromEntries(fields.map((f: string, i: number) => [f, r[i]])));
}

export default async function handler(req: Request, ctx: any): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!ctx.user) return json({ error: 'unauthorized' }, 401);
  const uid = ctx.user.id;
  const limit = Number(ctx.env.FREE_SEARCH_LIMIT ?? 3);

  // Identity is bound server-side by the on-auth hook, never chosen by the
  // client — that's what stops anyone claiming another person's expert identity.
  // This INSERT is only a safety net in case /me races ahead of the hook.
  await ctx.db.query(
    `INSERT INTO profiles (user_id, person_id) VALUES ($1::uuid, 'p-maya') ON CONFLICT (user_id) DO NOTHING`,
    [uid],
  );
  await ctx.db.query(
    `INSERT INTO subscriptions (user_id, plan) VALUES ($1::uuid, 'free') ON CONFLICT (user_id) DO NOTHING`,
    [uid],
  );

  const profile = (await ctx.db.query(`SELECT person_id FROM profiles WHERE user_id = $1::uuid`, [uid])).rows[0];
  const plan = (await ctx.db.query(`SELECT plan FROM subscriptions WHERE user_id = $1::uuid`, [uid])).rows[0]?.plan ?? 'free';
  const used = Number((await ctx.db.query(`SELECT count(*)::int AS n FROM searches WHERE user_id = $1::uuid`, [uid])).rows[0].n);
  // Two different signals: requests waiting on MY consent, and my own requests
  // that someone has said yes to. Without the second one the requester never
  // learns the introduction was granted.
  const pending = Number(
    (await ctx.db.query(
      `SELECT count(*)::int AS n FROM intro_requests WHERE status = 'pending_expert_consent' AND expert_person_id = $1`,
      [profile.person_id],
    )).rows[0].n,
  );
  const accepted = Number(
    (await ctx.db.query(
      `SELECT count(*)::int AS n FROM intro_requests WHERE requester_id = $1::uuid AND status = 'accepted'`,
      [uid],
    )).rows[0].n,
  );

  const person = (await neo4j(ctx.env, `MATCH (p:Person {id:$id}) RETURN p.name AS name, p.title AS title, p.team AS team`, {
    id: profile.person_id,
  }))[0] ?? null;

  return json({
    userId: uid,
    email: ctx.user.email ?? null,
    personId: profile.person_id,
    person,
    plan,
    used,
    limit,
    remaining: plan === 'pro' ? null : Math.max(0, limit - used),
    pendingConsent: pending,
    acceptedIntros: accepted,
  });
}
