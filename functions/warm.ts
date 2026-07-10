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

// Keep each RocketRide pipeline alive so search/explain rarely have to recreate
// one mid-request. If a task has been terminated, rebuild it from the stored spec.
async function ensurePipelines(ctx: any): Promise<Record<string, string>> {
  const rows = (await ctx.db.query(`SELECT name, token, spec FROM pipeline_state`)).rows;
  const out: Record<string, string> = {};
  for (const row of rows) {
    let alive = false;
    if (row.token) {
      try {
        const st = await fetch(`${ctx.env.RR_API_URL}/task?token=${row.token}`, {
          headers: { Authorization: `Bearer ${ctx.env.RR_API_KEY}` },
        });
        const j = await st.json();
        alive = j?.status === 'OK' && j?.data?.state === 3;
      } catch {
        alive = false;
      }
    }
    if (alive) {
      out[row.name] = 'alive';
      continue;
    }
    // Rebuild from spec (inject the LLM key from env, never stored).
    if (row.token) {
      await fetch(`${ctx.env.RR_API_URL}/task?token=${row.token}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ctx.env.RR_API_KEY}` },
      }).catch(() => {});
    }
    const body = JSON.stringify(row.spec).replaceAll('__BB_API_KEY__', ctx.env.BB_API_KEY);
    const res = await fetch(`${ctx.env.RR_API_URL}/task`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.env.RR_API_KEY}`, 'Content-Type': 'application/json' },
      body,
    });
    const token = JSON.parse(await res.text())?.data?.token;
    if (token) {
      await ctx.db.query(
        `UPDATE pipeline_state SET token = $2, updated_at = now() WHERE name = $1`,
        [row.name, token],
      );
      out[row.name] = 'rebuilt';
    } else {
      out[row.name] = 'failed';
    }
  }
  return out;
}

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

    const pipelines = await ensurePipelines(ctx);

    console.log(`warm: neo4j ${res.status} people=${people} pipelines=${JSON.stringify(pipelines)} in ${Date.now() - started}ms`);
    return new Response(JSON.stringify({ ok, people, pipelines, ms: Date.now() - started }), {
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
