// Deploys the WarmPath serverless functions to Butterbase.
//
//   node scripts/deploy-functions.js            # all
//   node scripts/deploy-functions.js search     # just one

import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const ENV = Object.fromEntries(
  (await readFile(new URL('.env', root), 'utf8'))
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const TOKENS = JSON.parse(await readFile(new URL('pipelines/tokens.json', root), 'utf8'));

// Secrets handed to the Deno isolate. None of these ever reach the browser.
const SHARED = {
  NEO4J_HOST: ENV.NEO4J_HOST,
  NEO4J_DB: ENV.NEO4J_DB,
  NEO4J_USER: ENV.NEO4J_USER,
  NEO4J_PASSWORD: ENV.NEO4J_PASSWORD,
  RR_API_URL: ENV.RR_API_URL,
  RR_API_KEY: ENV.RR_API_KEY,
  RR_TOKEN_EXTRACT: TOKENS['warmpath-extract'],
  RR_TOKEN_EXPLAIN: TOKENS['warmpath-explain'],
  BB_API_KEY: ENV.BB_API_KEY,
  BB_API_URL: ENV.BB_API_URL,
  BB_APP_ID: ENV.BB_APP_ID,
  FREE_SEARCH_LIMIT: ENV.FREE_SEARCH_LIMIT,
};

const STRIPE = {
  STRIPE_SECRET_KEY: ENV.STRIPE_SECRET_KEY,
  STRIPE_PRICE_ID: ENV.STRIPE_PRICE_ID,
  APP_URL: ENV.BB_FRONTEND_URL,
};

const FUNCTIONS = [
  { name: 'search', file: 'functions/search.ts', envVars: SHARED, timeoutMs: 60000 },
  { name: 'explain', file: 'functions/explain.ts', envVars: SHARED, timeoutMs: 90000 },
  { name: 'intro', file: 'functions/intro.ts', envVars: SHARED, timeoutMs: 60000 },
  { name: 'me', file: 'functions/me.ts', envVars: SHARED, timeoutMs: 20000 },
  { name: 'ingest', file: 'functions/ingest.ts', envVars: SHARED, timeoutMs: 60000 },
  { name: 'billing', file: 'functions/billing.ts', envVars: { ...SHARED, ...STRIPE }, timeoutMs: 30000 },
  // Every 3 minutes: isolates evict around 5, so this leaves margin. Also keeps
  // Neo4j Aura from auto-pausing.
  {
    name: 'warm',
    file: 'functions/warm.ts',
    envVars: SHARED,
    timeoutMs: 20000,
    trigger: { type: 'cron', config: { schedule: '*/3 * * * *' } },
  },
  // Called by the auth system (service context), so no end-user auth.
  {
    name: 'on-auth',
    file: 'functions/on-auth.ts',
    envVars: SHARED,
    timeoutMs: 15000,
    trigger: { type: 'http', config: { auth: 'none' } },
  },
];

const only = process.argv[2];
const targets = only ? FUNCTIONS.filter((f) => f.name === only) : FUNCTIONS;
if (!targets.length) {
  console.error(`no such function: ${only}`);
  process.exit(1);
}

for (const fn of targets) {
  let code;
  try {
    code = await readFile(new URL(fn.file, root), 'utf8');
  } catch {
    console.log(`· ${fn.name}: ${fn.file} not written yet, skipping`);
    continue;
  }

  const res = await fetch(`${ENV.BB_API_URL}/v1/${ENV.BB_APP_ID}/functions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ENV.BB_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: fn.name,
      code,
      description: `WarmPath ${fn.name}`,
      envVars: fn.envVars,
      timeoutMs: fn.timeoutMs,
      trigger: fn.trigger ?? { type: 'http', config: { auth: 'required' } },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`✗ ${fn.name}: ${res.status} ${text.slice(0, 400)}`);
    process.exit(1);
  }
  const j = JSON.parse(text);
  console.log(`✓ ${fn.name}: ${j.url ?? `${ENV.BB_API_URL}/v1/${ENV.BB_APP_ID}/fn/${fn.name}`}`);
}
