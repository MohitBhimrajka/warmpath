// Post-authentication hook. Butterbase calls this (fire-and-forget, as the
// service role) after every signup and login, with the user's email — which
// functions cannot otherwise see (ctx.user.email is null inside a normal call).
//
// It binds each account to its graph identity SERVER-SIDE. That's the whole
// security fix: `person_id` is no longer something the client can choose, so
// nobody can claim another person's expert identity and hijack their intros.
//
// Wired with manage_auth_config action=configure_auth_hook, post_auth_function=on-auth.

// The two demo accounts map to fixed Person nodes; everyone else is the
// read-only "Maya" demo persona (they can search, but hold no expert identity).
const EMAIL_TO_PERSON: Record<string, string> = {
  'maya.demo@warmpath.dev': 'p-maya',
  'chen.demo@warmpath.dev': 'p-chen',
};

export default async function handler(req: Request, ctx: any): Promise<Response> {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return new Response('bad payload', { status: 400 });
  }

  const uid = body?.user?.id;
  const email = String(body?.user?.email ?? '').toLowerCase();
  if (!uid) return new Response('no user', { status: 400 });

  const pinned = EMAIL_TO_PERSON[email] ?? null;

  // Force the pinned identity for demo accounts; for everyone else create the
  // profile if missing (default persona) but never overwrite an existing bind.
  await ctx.db.query(
    `INSERT INTO profiles (user_id, person_id, email)
     VALUES ($1::uuid, COALESCE($2, 'p-maya'), $3)
     ON CONFLICT (user_id) DO UPDATE
       SET email = EXCLUDED.email,
           person_id = CASE WHEN $2 IS NOT NULL THEN $2 ELSE profiles.person_id END`,
    [uid, pinned, email || null],
  );
  await ctx.db.query(
    `INSERT INTO subscriptions (user_id, plan) VALUES ($1::uuid, 'free') ON CONFLICT (user_id) DO NOTHING`,
    [uid],
  );

  console.log(`on-auth: ${email || uid} -> ${pinned ?? 'p-maya (persona)'} [${body.event}]`);
  return new Response('ok');
}
