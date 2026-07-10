// Deploys the WarmPath pipelines to RocketRide Cloud and records their task tokens.
//
// RocketRide keys a pipeline by (apikey, name), so re-deploying the same name
// errors with "already exists". We therefore DELETE any previously recorded
// token before POSTing. Tokens are secrets — they live in pipelines/tokens.json,
// which is gitignored, and get pushed into the Butterbase function's envVars.
//
//   node scripts/deploy-pipelines.js

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const ENV = Object.fromEntries(
  (await readFile(new URL('../.env', import.meta.url), 'utf8'))
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const RR = ENV.RR_API_URL;
const RR_KEY = ENV.RR_API_KEY;
const TOKENS_PATH = new URL('../pipelines/tokens.json', import.meta.url);
const PIPELINES = ['warmpath-extract', 'warmpath-explain', 'warmpath-ingest'];

const headers = { Authorization: `Bearer ${RR_KEY}`, 'Content-Type': 'application/json' };

async function rr(path, init = {}) {
  const res = await fetch(`${RR}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

const tokens = existsSync(TOKENS_PATH) ? JSON.parse(await readFile(TOKENS_PATH, 'utf8')) : {};

// Store name → { token, spec } in the app DB so any function can recreate a
// pipeline that RocketRide has terminated. The spec keeps the __BB_API_KEY__
// placeholder — the secret is injected from the function's env at recreate time,
// never persisted.
async function upsertState(name, rawSpec, token) {
  const spec = JSON.parse(rawSpec);
  const res = await fetch(`${ENV.BB_API_URL}/v1/${ENV.BB_APP_ID}/pipeline_state`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ENV.BB_API_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ name, token, spec }),
  });
  if (!res.ok) {
    // fall back to update if the row already exists
    await fetch(`${ENV.BB_API_URL}/v1/${ENV.BB_APP_ID}/pipeline_state?name=eq.${name}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ENV.BB_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, spec }),
    });
  }
}

for (const name of PIPELINES) {
  if (tokens[name]) {
    const { json } = await rr(`/task?token=${tokens[name]}`, { method: 'DELETE' });
    console.log(`· ${name}: removed previous deployment (${json.status || 'gone'})`);
  }

  const rawSpec = await readFile(new URL(`../pipelines/${name}.json`, import.meta.url), 'utf8');
  const spec = rawSpec.replaceAll('__BB_API_KEY__', ENV.BB_API_KEY);

  const { status, json } = await rr('/task', { method: 'POST', body: spec });
  if (status !== 200 || json.status !== 'OK' || !json.data?.token) {
    console.error(`✗ ${name}: deploy failed (${status})`, JSON.stringify(json).slice(0, 400));
    process.exit(1);
  }
  tokens[name] = json.data.token;
  await upsertState(name, rawSpec, json.data.token);
  console.log(`✓ ${name}: ${json.data.token}  (state seeded)`);

  const st = await rr(`/task?token=${json.data.token}`);
  const d = st.json.data || {};
  console.log(`    state=${d.state} status="${d.status}" errors=${JSON.stringify(d.errors || [])}`);
}

await writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2) + '\n');
console.log(`\nwrote ${TOKENS_PATH.pathname}`);
