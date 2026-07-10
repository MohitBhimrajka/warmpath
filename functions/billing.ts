// WarmPath — Pro upgrade via Stripe Checkout.
//
// Butterbase's native app billing runs on a live-mode Stripe Connect platform
// (`livemode:true`), so completing it would require real bank/identity details
// and a real charge. For a demo that has to accept card 4242 4242 4242 4242 we
// drive Stripe Checkout directly from this function with a test-mode secret key.
//
// `confirm` re-fetches the session from Stripe rather than trusting the browser's
// claim that it paid, and checks client_reference_id matches the caller.

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

async function stripe(env: any, path: string, method = 'GET', form?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${body?.error?.message ?? 'unknown'}`);
  return body;
}

export default async function handler(req: Request, ctx: any): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!ctx.user) return json({ error: 'unauthorized' }, 401);
  const uid = ctx.user.id;

  await ctx.db.query(
    `INSERT INTO subscriptions (user_id, plan) VALUES ($1::uuid, 'free') ON CONFLICT (user_id) DO NOTHING`,
    [uid],
  );

  if (req.method === 'GET') {
    const s = (await ctx.db.query(`SELECT plan, status, stripe_ref FROM subscriptions WHERE user_id = $1::uuid`, [uid])).rows[0];
    return json(s ?? { plan: 'free', status: 'inactive' });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action = String(body.action ?? '').trim();

  if (action === 'checkout') {
    try {
      const appUrl = ctx.env.APP_URL;
      const session = await stripe(ctx.env, 'checkout/sessions', 'POST', {
        mode: 'subscription',
        'line_items[0][price]': ctx.env.STRIPE_PRICE_ID,
        'line_items[0][quantity]': '1',
        client_reference_id: uid,
        success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/?checkout=cancelled`,
      });
      return json({ url: session.url, sessionId: session.id });
    } catch (err) {
      console.error('checkout failed', String(err));
      return json({ error: 'checkout_failed', detail: String(err).slice(0, 300) }, 502);
    }
  }

  if (action === 'confirm') {
    const sessionId = String(body.sessionId ?? '').trim();
    if (!sessionId) return json({ error: 'sessionId is required' }, 400);
    try {
      const session = await stripe(ctx.env, `checkout/sessions/${sessionId}`);
      // Never trust the client: the session must be paid AND belong to this user.
      if (session.client_reference_id !== uid) return json({ error: 'session_mismatch' }, 403);
      if (session.payment_status !== 'paid' && session.status !== 'complete') {
        return json({ error: 'not_paid', payment_status: session.payment_status }, 402);
      }
      const upd = await ctx.db.query(
        `UPDATE subscriptions SET plan = 'pro', status = 'active', stripe_ref = $2, updated_at = now()
         WHERE user_id = $1::uuid RETURNING plan, status`,
        [uid, String(session.subscription ?? session.id)],
      );
      return json({ ...upd.rows[0], upgraded: true });
    } catch (err) {
      console.error('confirm failed', String(err));
      return json({ error: 'confirm_failed', detail: String(err).slice(0, 300) }, 502);
    }
  }

  return json({ error: `unknown action: ${action}` }, 400);
}
