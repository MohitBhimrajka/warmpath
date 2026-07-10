// End-to-end check of the whole WarmPath flow against the LIVE deployment.
//
//   node scripts/e2e.js
//
// Includes the negative cases. "Contact details stay hidden until the expert
// consents" is a security claim, so the tests that matter most are the ones
// that assert a request is REFUSED.

import { readFile } from 'node:fs/promises';

const ENV = Object.fromEntries(
  (await readFile(new URL('../.env', import.meta.url), 'utf8'))
    .split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const BASE = ENV.BB_API_URL;
const APP = ENV.BB_APP_ID;
const PW = 'WarmPath!2026';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ''}`); }
};

async function api(path, { method = 'POST', jwt, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try { json = JSON.parse(await res.text()); } catch { json = null; }
  return { status: res.status, json };
}

const fn = (name, jwt, body, method = 'POST') => api(`/v1/${APP}/fn/${name}`, { method, jwt, body });

async function ensureUser(email, expectPerson) {
  await api(`/auth/${APP}/signup`, { body: { email, password: PW, display_name: email } });
  const { json } = await api(`/auth/${APP}/login`, { body: { email, password: PW } });
  const jwt = json.access_token;
  // Identity is bound by the on-auth hook (async, fire-and-forget). Poll /me
  // until it settles rather than setting it from the client.
  if (expectPerson) {
    for (let i = 0; i < 12; i++) {
      const me = (await fn('me', jwt, null, 'GET')).json;
      if (me?.person?.name === expectPerson) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return jwt;
}

console.log('\n── identities ──');
const maya = await ensureUser('maya.demo@warmpath.dev', 'Maya Rodriguez');
const chen = await ensureUser('chen.demo@warmpath.dev', 'Chen Wei');
ok('maya + chen logged in (unverified email is fine)', !!maya && !!chen);

const mayaMe = (await fn('me', maya, null, 'GET')).json;
const chenMe = (await fn('me', chen, null, 'GET')).json;
ok('maya maps to Maya Rodriguez', mayaMe.person?.name === 'Maya Rodriguez', JSON.stringify(mayaMe));
ok('chen maps to Chen Wei', chenMe.person?.name === 'Chen Wei', JSON.stringify(chenMe));

console.log('\n── search (RocketRide extract -> Neo4j) ──');
const t0 = Date.now();
const s = await fn('search', maya, { question: 'Who knows about SAP integration? I need help with our ERP connector.' });
const searchMs = Date.now() - t0;
ok(`search returned 200 (${searchMs}ms)`, s.status === 200, JSON.stringify(s.json).slice(0, 200));
const top = s.json?.experts?.[0];
ok('skill extracted = "SAP Integration"', s.json?.skill === 'SAP Integration', s.json?.skill);
ok('top expert is Chen Wei', top?.name === 'Chen Wei', top?.name);
ok('warm path is 2 hops via Priya Nair', top?.hops === 2 && top?.chain?.[1]?.name === 'Priya Nair',
  JSON.stringify(top?.chain));

console.log('\n── explain (second RocketRide call) ──');
const t1 = Date.now();
const x = await fn('explain', maya, { searchId: s.json.searchId });
ok(`explanation returned (${Date.now() - t1}ms)`, x.status === 200 && (x.json?.explanation ?? '').length > 60,
  JSON.stringify(x.json).slice(0, 200));
ok('explanation names Chen Wei and Priya', /Chen Wei/.test(x.json?.explanation) && /Priya/.test(x.json?.explanation));

console.log('\n── ranking is decided by centrality on a proficiency tie ──');
const k = await fn('search', maya, { question: 'we keep having pod evictions in prod, who can help?' });
const [k1, k2] = k.json?.experts ?? [];
ok('skill extracted = "Kubernetes"', k.json?.skill === 'Kubernetes', k.json?.skill);
ok('Arjun (deg 12) outranks Tomas (deg 3) despite equal proficiency',
  k1?.name === 'Arjun Mehta' && k2?.name === 'Tomas Novak' && k1.proficiency === k2.proficiency && k1.degree > k2.degree,
  `${k1?.name}(${k1?.proficiency}/${k1?.degree}) vs ${k2?.name}(${k2?.proficiency}/${k2?.degree})`);

console.log('\n── double consent ──');
const created = await fn('intro', maya, {
  action: 'create', expertPersonId: 'p-chen', note: 'Need help wiring our ERP connector.',
  path: top?.chain ?? [],
});
const introId = created.json?.id;
ok('maya creates intro request (consent #1)', created.status === 201 && !!introId, JSON.stringify(created.json));

const beforeContact = await fn('intro', maya, { action: 'contact', id: introId });
ok('NEGATIVE: contact refused before expert consents', beforeContact.status === 403,
  `got ${beforeContact.status} ${JSON.stringify(beforeContact.json)}`);

const selfRespond = await fn('intro', maya, { action: 'respond', id: introId, decision: 'accept' });
ok('NEGATIVE: requester cannot accept on the expert\'s behalf', selfRespond.status === 403,
  `got ${selfRespond.status} ${JSON.stringify(selfRespond.json)}`);

// Straight at the REST API, bypassing our handler entirely: RLS must still refuse.
const rlsPatch = await api(`/v1/${APP}/intro_requests/${introId}`, {
  method: 'PATCH', jwt: maya, body: { status: 'accepted' },
});
const rlsRow = await api(`/v1/${APP}/intro_requests/${introId}`, { method: 'GET', jwt: maya });
const stillPending = (Array.isArray(rlsRow.json) ? rlsRow.json[0] : rlsRow.json)?.status === 'pending_expert_consent';
ok('NEGATIVE: raw REST PATCH by requester is blocked by RLS policy', stillPending,
  `patch=${rlsPatch.status} status=${JSON.stringify(rlsRow.json).slice(0, 120)}`);

const chenInbox = await fn('intro', chen, null, 'GET');
ok('request appears in chen\'s inbox', (chenInbox.json?.inbox ?? []).some((r) => r.id === introId));
ok('inbox row exposes no email before consent',
  (chenInbox.json?.inbox ?? []).find((r) => r.id === introId)?.expert_email == null);

const accepted = await fn('intro', chen, { action: 'respond', id: introId, decision: 'accept', skill: 'SAP Integration' });
ok('chen accepts (consent #2)', accepted.status === 200 && accepted.json?.status === 'accepted',
  JSON.stringify(accepted.json).slice(0, 200));

const contact = await fn('intro', maya, { action: 'contact', id: introId });
ok('contact revealed only after consent', contact.status === 200 && /@meridian\.io$/.test(contact.json?.expertEmail ?? ''),
  JSON.stringify(contact.json).slice(0, 200));
ok('intro message was drafted', (contact.json?.introMessage ?? '').length > 40);

console.log('\n── freemium gate (fresh user, limit 3) ──');
const gateEmail = `gate.${Date.now()}@warmpath.dev`;
const gate = await ensureUser(gateEmail, 'Maya Rodriguez');
let gateStatus = 0, n = 0;
for (let i = 1; i <= 4; i++) {
  const r = await fn('search', gate, { question: 'who knows kubernetes' });
  gateStatus = r.status;
  if (r.status === 200) n++;
  console.log(`    search ${i}: ${r.status}${r.status === 402 ? ` (${r.json.error})` : ''}`);
}
ok('3 free searches succeed, the 4th returns 402 upgrade_required', n === 3 && gateStatus === 402);

const bill = await fn('billing', gate, { action: 'checkout' });
ok('stripe checkout session created', bill.status === 200 && /^https:\/\/checkout\.stripe\.com/.test(bill.json?.url ?? ''),
  JSON.stringify(bill.json).slice(0, 160));
if (bill.json?.url) console.log(`    checkout url: ${bill.json.url.slice(0, 72)}...`);

const fakeConfirm = await fn('billing', gate, { action: 'confirm', sessionId: bill.json?.sessionId });
ok('NEGATIVE: confirm refuses an unpaid session', fakeConfirm.status === 402,
  `got ${fakeConfirm.status} ${JSON.stringify(fakeConfirm.json)}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
