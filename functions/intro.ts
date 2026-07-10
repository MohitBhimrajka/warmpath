// WarmPath — double-consent introductions.
//
// Consent #1: the requester asks (INSERT, RLS with_check requester_id = me).
// Consent #2: the expert accepts (UPDATE, RLS policy `intro_update_expert_only`
//             restricts UPDATE to the account whose profile.person_id matches
//             the row's expert_person_id).
//
// The expert's email is NOT stored on the row until they accept, so a requester
// who reads the row directly through the REST API before consent sees NULL.
// The privacy property is enforced in Postgres, not in this handler.

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

/** Save the drafted intro to Butterbase Storage; returns the object id (or null). */
async function storeIntroFile(env: any, text: string): Promise<string | null> {
  try {
    const base = env.BB_API_URL ?? 'https://api.butterbase.ai';
    const app = env.BB_APP_ID ?? env.BUTTERBASE_APP_ID;
    const sizeBytes = new TextEncoder().encode(text).length;
    const up = await fetch(`${base}/storage/${app}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.BB_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'warm-intro.txt', contentType: 'text/plain', sizeBytes, public: true }),
    });
    if (!up.ok) return null;
    const { uploadUrl, objectId } = await up.json();
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: text });
    return put.ok ? objectId : null;
  } catch {
    return null;
  }
}

/** Mint a fresh presigned download URL for a stored intro. */
async function introDownloadUrl(env: any, objectId: string): Promise<string | null> {
  try {
    const base = env.BB_API_URL ?? 'https://api.butterbase.ai';
    const app = env.BB_APP_ID ?? env.BUTTERBASE_APP_ID;
    const res = await fetch(`${base}/storage/${app}/download/${objectId}`, {
      headers: { Authorization: `Bearer ${env.BB_API_KEY}` },
    });
    if (!res.ok) return null;
    return (await res.json()).downloadUrl ?? null;
  } catch {
    return null;
  }
}

/** Draft the intro note with Butterbase's AI gateway. Best-effort; falls back to a template. */
async function draftIntro(env: any, payload: Record<string, unknown>): Promise<string> {
  const fallback =
    `Hi ${payload.expertName}, ${payload.requesterName} is looking for help with ${payload.skill}. ` +
    `${payload.broker ? `${payload.broker} suggested the connection. ` : ''}Context: ${payload.note || 'no additional context.'}`;
  try {
    const res = await fetch(`${env.BB_API_URL ?? 'https://api.butterbase.ai'}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.BB_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4.5',
        max_tokens: 220,
        messages: [
          {
            role: 'user',
            content:
              `Write a short, warm introduction message (3 sentences max, plain text, no markdown, no subject line) ` +
              `from ${payload.requesterName} to ${payload.expertName}. ` +
              `They are connected through: ${payload.chain}. ` +
              `${payload.requesterName} wants help with ${payload.skill}. ` +
              `${payload.expertName} is known for: ${payload.evidence}. ` +
              `The requester's note: ${payload.note || '(none)'}. ` +
              `Reference the shared connection naturally. Output only the message.`,
          },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const text = (await res.json())?.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim() : fallback;
  } catch {
    return fallback;
  }
}

export default async function handler(req: Request, ctx: any): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!ctx.user) return json({ error: 'unauthorized' }, 401);
  const uid = ctx.user.id;

  const me = (await ctx.db.query(`SELECT person_id FROM profiles WHERE user_id = $1::uuid`, [uid])).rows[0];
  const myPersonId = me?.person_id ?? null;

  let body: any = {};
  if (req.method === 'POST') {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }
  const action = String(body.action ?? (req.method === 'GET' ? 'list' : '')).trim();

  // --- list: RLS returns rows where I am the requester OR I am the expert -----
  if (action === 'list') {
    const rows = await ctx.db.query(
      `SELECT id, requester_id, expert_person_id, expert_name, expert_email, path_json, note,
              intro_message, status, created_at, responded_at
       FROM intro_requests ORDER BY created_at DESC`,
    );
    const outbox = rows.rows.filter((r: any) => r.requester_id === uid);
    const inbox = rows.rows.filter((r: any) => r.expert_person_id === myPersonId && r.requester_id !== uid);
    return json({ myPersonId, outbox, inbox });
  }

  // --- create: consent #1 ----------------------------------------------------
  if (action === 'create') {
    const expertPersonId = String(body.expertPersonId ?? '').trim();
    if (!expertPersonId) return json({ error: 'expertPersonId is required' }, 400);
    if (expertPersonId === myPersonId) return json({ error: 'cannot request an intro to yourself' }, 400);

    const person = (await neo4j(ctx.env, `MATCH (p:Person {id:$id}) RETURN p.name AS name`, { id: expertPersonId }))[0];
    if (!person) return json({ error: 'unknown expert' }, 400);

    const dup = await ctx.db.query(
      `SELECT id FROM intro_requests WHERE requester_id = $1::uuid AND expert_person_id = $2 AND status = 'pending_expert_consent'`,
      [uid, expertPersonId],
    );
    if (dup.rows.length) return json({ error: 'already_pending', id: dup.rows[0].id }, 409);

    // expert_email deliberately left NULL until consent #2.
    const ins = await ctx.db.query(
      `INSERT INTO intro_requests (requester_id, expert_person_id, expert_name, path_json, note)
       VALUES ($1::uuid, $2, $3, $4::jsonb, $5) RETURNING id, status, created_at`,
      [uid, expertPersonId, person.name, JSON.stringify(body.path ?? []), String(body.note ?? '').slice(0, 500)],
    );
    return json({ ...ins.rows[0], expertName: person.name }, 201);
  }

  // --- respond: consent #2 (only the expert's account may do this) ------------
  if (action === 'respond') {
    const id = String(body.id ?? '').trim();
    const decision = String(body.decision ?? '').trim();
    if (!id || !['accept', 'decline'].includes(decision)) {
      return json({ error: "id and decision ('accept'|'decline') are required" }, 400);
    }

    const row = (await ctx.db.query(`SELECT * FROM intro_requests WHERE id = $1::uuid`, [id])).rows[0];
    if (!row) return json({ error: 'not_found' }, 404);
    if (row.expert_person_id !== myPersonId) return json({ error: 'only the expert can respond' }, 403);
    if (row.status !== 'pending_expert_consent') return json({ error: 'already_resolved', status: row.status }, 409);

    if (decision === 'decline') {
      const upd = await ctx.db.query(
        `UPDATE intro_requests SET status = 'declined', responded_at = now() WHERE id = $1::uuid RETURNING id, status`,
        [id],
      );
      if (!upd.rows.length) return json({ error: 'forbidden_by_policy' }, 403);
      return json(upd.rows[0]);
    }

    // Accepted: only now do we materialise contact details.
    const expert = (await neo4j(
      ctx.env,
      `MATCH (p:Person {id:$id}) OPTIONAL MATCH (p)-[h:HAS_SKILL]->(s:Skill) RETURN p.email AS email, p.name AS name,
       head(collect(h.evidence)) AS evidence`,
      { id: row.expert_person_id },
    ))[0];

    const requesterName =
      (await neo4j(ctx.env, `MATCH (p:Person {id:$id}) RETURN p.name AS name`, {
        id: (await ctx.db.query(`SELECT person_id FROM profiles WHERE user_id = $1::uuid`, [row.requester_id])).rows[0]
          ?.person_id ?? 'p-maya',
      }))[0]?.name ?? 'A colleague';

    const chain = Array.isArray(row.path_json) ? row.path_json.map((n: any) => n.name).join(' → ') : '';
    const skill = String(body.skill ?? 'this topic');
    const message = await draftIntro(ctx.env, {
      requesterName,
      expertName: expert?.name ?? row.expert_name,
      chain,
      skill,
      evidence: expert?.evidence ?? 'their work',
      note: row.note,
      broker: Array.isArray(row.path_json) && row.path_json.length > 2 ? row.path_json[1]?.name : '',
    });

    // Save the drafted intro to storage so the requester can download it.
    const fileId = await storeIntroFile(ctx.env, message);

    const upd = await ctx.db.query(
      `UPDATE intro_requests SET status = 'accepted', responded_at = now(), expert_email = $2, intro_message = $3, intro_file_id = $4
       WHERE id = $1::uuid RETURNING id, status, expert_email, intro_message`,
      [id, expert?.email ?? null, message, fileId],
    );
    if (!upd.rows.length) return json({ error: 'forbidden_by_policy' }, 403);
    return json(upd.rows[0]);
  }

  // --- contact: the requester reads the reveal --------------------------------
  if (action === 'contact') {
    const id = String(body.id ?? '').trim();
    const row = (await ctx.db.query(`SELECT * FROM intro_requests WHERE id = $1::uuid`, [id])).rows[0];
    if (!row) return json({ error: 'not_found' }, 404);
    if (row.requester_id !== uid) return json({ error: 'forbidden' }, 403);
    if (row.status !== 'accepted') return json({ error: 'not_consented', status: row.status }, 403);
    const introFileUrl = row.intro_file_id ? await introDownloadUrl(ctx.env, row.intro_file_id) : null;
    return json({
      id: row.id,
      expertName: row.expert_name,
      expertEmail: row.expert_email,
      introMessage: row.intro_message,
      introFileUrl,
    });
  }

  return json({ error: `unknown action: ${action}` }, 400);
}
