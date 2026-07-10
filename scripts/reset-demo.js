// Puts the demo accounts back to a clean, repeatable starting state.
//
//   node scripts/reset-demo.js
//
// After running: Maya is on the free plan with 3 searches available and no
// introduction requests, so the full story — search, hit the paywall, pay with
// 4242, request an intro, switch to Chen, accept, reveal contact — can be shown
// end to end again. Cancels the Stripe test subscription too.

import { readFile } from 'node:fs/promises';

const ENV = Object.fromEntries(
  (await readFile(new URL('../.env', import.meta.url), 'utf8'))
    .split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const APP = ENV.BB_APP_ID;
const H = { Authorization: `Bearer ${ENV.BB_API_KEY}` };
const base = `${ENV.BB_API_URL}/v1/${APP}`;

const get = async (p) => {
  const r = await (await fetch(`${base}${p}`, { headers: H })).json();
  return Array.isArray(r) ? r : r.rows ?? [];
};
const del = (p) => fetch(`${base}${p}`, { method: 'DELETE', headers: H });
const patch = (p, body) =>
  fetch(`${base}${p}`, { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Resolve the demo requester by logging in, NOT by `person_id = 'p-maya'` —
// every new signup defaults to that persona, so more than one profile matches.
const login = await (
  await fetch(`${ENV.BB_API_URL}/auth/${APP}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'maya.demo@warmpath.dev', password: 'WarmPath!2026' }),
  })
).json();
if (!login.user?.id) {
  console.error('could not sign in as maya.demo@warmpath.dev');
  process.exit(1);
}
const maya = { user_id: login.user.id };
console.log(`· demo requester: ${login.user.email} (${maya.user_id})`);

// 1. Cancel the Stripe test subscription so the upgrade can be demoed again.
const sub = (await get(`/subscriptions?user_id=eq.${maya.user_id}`))[0];
if (sub?.stripe_ref?.startsWith('sub_')) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_ref}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ENV.STRIPE_SECRET_KEY}` },
  });
  console.log(`· stripe subscription ${sub.stripe_ref}: ${res.ok ? 'cancelled' : `cancel failed (${res.status})`}`);
}
if (sub) {
  await patch(`/subscriptions/${sub.id}`, { plan: 'free', status: 'inactive', stripe_ref: null });
  console.log('· maya back on the free plan');
}

// 2. Clear the search counter.
const searches = await get(`/searches?user_id=eq.${maya.user_id}&select=id`);
for (const s of searches) await del(`/searches/${s.id}`);
console.log(`· cleared ${searches.length} searches`);

// 3. Clear this requester's introduction requests.
const intros = await get(`/intro_requests?requester_id=eq.${maya.user_id}&select=id`);
for (const i of intros) await del(`/intro_requests/${i.id}`);
console.log(`· cleared ${intros.length} introduction requests`);

console.log('\nready. maya.demo@warmpath.dev has 3 free searches and an empty inbox.');
