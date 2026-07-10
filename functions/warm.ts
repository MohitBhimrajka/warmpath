// Keeps the two cold surfaces warm.
//
// A Butterbase Deno isolate evicts after a few minutes idle (we measured a ~30s
// first invoke), and Neo4j Aura's free tier pauses on inactivity and is just as
// slow to resume. A judge's first click should not pay for either.
//
// The Neo4j round trip is the point: a no-op handler would keep the isolate hot
// but let Aura sleep. RocketRide Cloud is their infrastructure and stays warm on
// its own, so we deliberately don't spend an LLM call here.
//
// Deployed with: trigger { type: 'cron', config: { schedule: '*/3 * * * *' } }

export default async function handler(_req: Request, ctx: any): Promise<Response> {
  const started = Date.now();
  try {
    const auth = btoa(`${ctx.env.NEO4J_USER}:${ctx.env.NEO4J_PASSWORD}`);
    const res = await fetch(`${ctx.env.NEO4J_HOST}/db/${ctx.env.NEO4J_DB}/query/v2`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ statement: 'MATCH (p:Person) RETURN count(p) AS people' }),
    });
    const ok = res.status === 200 || res.status === 202;
    const people = ok ? JSON.parse(await res.text())?.data?.values?.[0]?.[0] : null;
    console.log(`warm: neo4j ${res.status} people=${people} in ${Date.now() - started}ms`);
    return new Response(JSON.stringify({ ok, people, ms: Date.now() - started }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('warm failed', String(err));
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
