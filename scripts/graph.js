// Shared Neo4j Aura HTTP Query API client.
// Bolt is unusable from Butterbase's Deno isolates (no raw TCP), so everything
// goes over the HTTP Query API. Note the database is the instance id, not "neo4j".
//
// Credentials come from .env or the environment. Never inline them here.

import { readFileSync, existsSync } from 'node:fs';

const envPath = new URL('../.env', import.meta.url);
const fileEnv = existsSync(envPath)
  ? Object.fromEntries(
      readFileSync(envPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    )
  : {};

const need = (key) => {
  const v = process.env[key] ?? fileEnv[key];
  if (!v) throw new Error(`${key} is not set — copy .env.example to .env and fill it in`);
  return v;
};

export const NEO4J_HOST = need('NEO4J_HOST');
export const NEO4J_DB = need('NEO4J_DB');
export const NEO4J_USER = need('NEO4J_USER');
export const NEO4J_PASSWORD = need('NEO4J_PASSWORD');

const URL_ = `${NEO4J_HOST}/db/${NEO4J_DB}/query/v2`;
const AUTH = 'Basic ' + Buffer.from(`${NEO4J_USER}:${NEO4J_PASSWORD}`).toString('base64');

/** Run one Cypher statement. Returns rows as objects keyed by RETURN column name. */
export async function run(statement, parameters = {}) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: {
      Authorization: AUTH,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ statement, parameters }),
  });
  const text = await res.text();
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`Neo4j ${res.status}: ${text.slice(0, 500)}\n  stmt: ${statement.slice(0, 160)}`);
  }
  const json = JSON.parse(text);
  const { fields = [], values = [] } = json.data || {};
  return values.map((row) => Object.fromEntries(fields.map((f, i) => [f, row[i]])));
}
