// Seeds the "Meridian Systems" collaboration graph into Neo4j Aura.
//
// Determinism is the whole point: a seeded PRNG plus a hand-pinned "spine" of
// people and edges guarantees the three demo scenarios resolve identically on
// every run. Random edges are never allowed to create a shortcut that would
// change a shortest path — see PROTECTED and FORBIDDEN below.
//
//   node scripts/seed.js            # seed
//   node scripts/seed.js --verify   # assertions only

import { run } from './graph.js';

// ---------------------------------------------------------------- determinism

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260709);
const randint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// ---------------------------------------------------------------------- teams

const TEAMS = [
  'Product Analytics',
  'Platform',
  'DevOps/SRE',
  'Data Engineering',
  'Machine Learning',
  'Integrations',
  'Security',
  'Design',
];

const SKILLS = [
  ['Kubernetes', 'Infrastructure'], ['Terraform', 'Infrastructure'], ['Docker', 'Infrastructure'],
  ['AWS', 'Infrastructure'], ['Observability', 'Infrastructure'], ['Incident Response', 'Infrastructure'],
  ['Go', 'Backend'], ['Rust', 'Backend'], ['Java', 'Backend'], ['Python', 'Backend'],
  ['Node.js', 'Backend'], ['gRPC', 'Backend'], ['PostgreSQL', 'Backend'], ['Redis', 'Backend'],
  ['Kafka', 'Backend'],
  ['Spark', 'Data'], ['Airflow', 'Data'], ['dbt', 'Data'], ['Snowflake', 'Data'], ['Data Modeling', 'Data'],
  ['Machine Learning', 'ML'], ['PyTorch', 'ML'], ['MLOps', 'ML'], ['NLP', 'ML'], ['Recommender Systems', 'ML'],
  ['SAP Integration', 'Integrations'], ['Salesforce Integration', 'Integrations'],
  ['REST API Design', 'Integrations'], ['GraphQL', 'Integrations'], ['Webhooks', 'Integrations'],
  ['Threat Modeling', 'Security'], ['IAM', 'Security'], ['Cryptography', 'Security'],
  ['React', 'Frontend'], ['Design Systems', 'Frontend'],
];

const PROJECTS = [
  ['Project Atlas', 'ERP consolidation and the SAP data bridge', 2024],
  ['Project Beacon', 'Customer-facing analytics dashboards', 2024],
  ['Project Cascade', 'Streaming ingestion rebuild on Kafka', 2023],
  ['Project Delta', 'Fraud scoring for payments', 2025],
  ['Project Ember', 'Multi-region Kubernetes migration', 2025],
  ['Project Fathom', 'Warehouse cost reduction', 2023],
  ['Project Gaslight', 'Incident response tooling', 2024],
  ['Project Harbor', 'Public API gateway', 2025],
  ['Project Iris', 'Design system unification', 2024],
  ['Project Juniper', 'Salesforce revenue sync', 2023],
  ['Project Kestrel', 'Realtime recommendations', 2025],
  ['Project Lumen', 'Observability overhaul', 2024],
  ['Project Meridian', 'Core platform re-architecture', 2022],
  ['Project Nimbus', 'Terraform-managed infrastructure', 2023],
  ['Project Onyx', 'Zero-trust access control', 2025],
  ['Project Pilot', 'ML feature store', 2024],
  ['Project Quartz', 'Data quality framework', 2023],
  ['Project Relay', 'Webhook delivery service', 2025],
  ['Project Summit', 'Executive reporting suite', 2024],
  ['Project Tundra', 'Cold storage archival', 2022],
  ['Project Umbra', 'Secrets management', 2024],
  ['Project Vertex', 'Graph-based entity resolution', 2025],
  ['Project Willow', 'Customer churn modelling', 2024],
  ['Project Xenon', 'Search relevance tuning', 2023],
  ['Project Yield', 'Pricing optimisation', 2025],
];

// Project -> skills it uses. Atlas/SAP is pinned for demo scenario 1.
const PROJECT_SKILLS = {
  'Project Atlas': ['SAP Integration', 'REST API Design', 'Java'],
  'Project Ember': ['Kubernetes', 'Terraform', 'AWS'],
  'Project Delta': ['Machine Learning', 'PyTorch', 'Python'],
  'Project Cascade': ['Kafka', 'Spark', 'Go'],
  'Project Kestrel': ['Recommender Systems', 'Machine Learning', 'Redis'],
  'Project Onyx': ['IAM', 'Threat Modeling', 'Cryptography'],
  'Project Iris': ['React', 'Design Systems'],
  'Project Juniper': ['Salesforce Integration', 'REST API Design'],
  'Project Lumen': ['Observability', 'Incident Response'],
  'Project Harbor': ['GraphQL', 'REST API Design', 'Node.js'],
};

// ------------------------------------------------------------- pinned "spine"

// Everything the demo depends on is declared here, never generated.
const PINNED_PEOPLE = [
  { id: 'p-maya',  name: 'Maya Rodriguez', title: 'Product Analyst',        team: 'Product Analytics' },
  { id: 'p-priya', name: 'Priya Nair',     title: 'Staff Engineer',          team: 'Platform' },
  { id: 'p-chen',  name: 'Chen Wei',       title: 'Integration Engineer',    team: 'Integrations' },
  { id: 'p-arjun', name: 'Arjun Mehta',    title: 'SRE Lead',                team: 'DevOps/SRE' },
  { id: 'p-tomas', name: 'Tomas Novak',    title: 'Site Reliability Engineer', team: 'DevOps/SRE' },
  { id: 'p-sofia', name: 'Sofia Ramos',    title: 'ML Engineer',             team: 'Machine Learning' },
  // Maya's three Product Analytics neighbours. Intra-team edges only, so the
  // only route out of Maya's neighbourhood is Priya.
  { id: 'p-guard1', name: 'Elena Duarte', title: 'Product Analyst', team: 'Product Analytics' },
  { id: 'p-guard2', name: 'Ravi Shankar', title: 'Data Analyst',    team: 'Product Analytics' },
  { id: 'p-guard3', name: 'Hana Kim',     title: 'Product Manager', team: 'Product Analytics' },
  // Cross-team hubs (besides Arjun).
  { id: 'p-nina', name: 'Nina Petrova', title: 'Principal Data Engineer', team: 'Data Engineering' },
  { id: 'p-omar', name: 'Omar Haddad',  title: 'Security Architect',      team: 'Security' },
];

// Never receive randomly generated edges. Their adjacency is fully pinned,
// which is what makes the demo shortest paths provable.
const PROTECTED = new Set(['p-maya', 'p-priya', 'p-chen', 'p-tomas', 'p-sofia']);
// Guards may take intra-team edges but never cross-team ones.
const NO_CROSS = new Set(['p-guard1', 'p-guard2', 'p-guard3']);
// Cross-team random edges originate only from these hubs.
const HUBS = ['p-arjun', 'p-nina', 'p-omar'];

const PINNED_COLLABS = [
  ['p-maya', 'p-priya', 8, 'co-led the Q3 retention dashboard'],
  ['p-maya', 'p-guard1', 7, 'shared the weekly analytics review'],
  ['p-maya', 'p-guard2', 6, 'built the funnel report together'],
  ['p-maya', 'p-guard3', 5, 'ran the product discovery sprint'],
  ['p-priya', 'p-chen', 7, 'integrated the analytics export into the SAP pipeline'],
  ['p-priya', 'p-arjun', 6, 'migrated the analytics service to the shared cluster'],
  ['p-arjun', 'p-sofia', 7, 'productionised the fraud model on GPU nodes'],
  ['p-arjun', 'p-tomas', 5, 'paired on the multi-region failover runbook'],
  ['p-tomas', 'p-guard1', 2, 'on-call handoff for the analytics stack'],
  ['p-tomas', 'p-nina', 3, 'debugged the ingestion backlog'],
  ['p-sofia', 'p-nina', 6, 'designed the feature store schema'],
];

// Pairs the random generator must never emit. Each one, if created, would
// collapse a demo shortest path.
const FORBIDDEN = new Set(
  [
    ['p-maya', 'p-chen'], ['p-maya', 'p-arjun'], ['p-maya', 'p-sofia'], ['p-maya', 'p-tomas'],
    ['p-priya', 'p-sofia'],
    ['p-guard1', 'p-chen'], ['p-guard2', 'p-chen'], ['p-guard3', 'p-chen'],
    ['p-guard1', 'p-sofia'], ['p-guard2', 'p-sofia'], ['p-guard3', 'p-sofia'],
  ].map(([a, b]) => key(a, b)),
);

function key(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const PINNED_SKILLS = [
  ['p-chen', 'SAP Integration', 5, 'built the SAP connector for Project Atlas'],
  ['p-chen', 'REST API Design', 4, 'designed the Atlas integration API surface'],
  ['p-arjun', 'Kubernetes', 5, 'led the multi-region Kubernetes migration on Project Ember'],
  ['p-tomas', 'Kubernetes', 5, 'wrote the cluster autoscaling policies for Project Ember'],
  ['p-sofia', 'Machine Learning', 5, 'lead author of the fraud-scoring model on Project Delta'],
  ['p-sofia', 'PyTorch', 4, 'trained the churn model for Project Willow'],
  ['p-priya', 'Go', 5, 're-architected the core platform in Go on Project Meridian'],
  ['p-maya', 'Data Modeling', 3, 'owns the retention metric definitions'],
  ['p-nina', 'Kafka', 4, 'rebuilt streaming ingestion on Project Cascade'],
  ['p-omar', 'IAM', 5, 'designed zero-trust access control on Project Onyx'],
];

const PINNED_PROJECTS = [
  ['p-chen', 'Project Atlas'],
  ['p-arjun', 'Project Ember'],
  ['p-tomas', 'Project Ember'],
  ['p-sofia', 'Project Delta'],
  ['p-priya', 'Project Meridian'],
];

// ------------------------------------------------------- generated population

const FIRST = ['Aiko','Bruno','Camila','Dmitri','Esme','Felix','Greta','Hugo','Ingrid','Jonas','Kira','Lucas','Mira','Noor','Otto','Pia','Quinn','Rosa','Stefan','Tariq','Ulla','Viktor','Wren','Ximena','Yusuf','Zara','Anders','Bianca','Cyrus','Delia','Emil','Farah','Gustav','Helena','Iker','Jana','Kofi','Lena','Marek','Nadia','Oscar','Petra','Rafael','Sana','Timo','Ursula','Vikram','Wanda','Yara','Zoltan','Ada','Basil','Clara','Dario','Eero','Freya','Gabriel','Hilda','Ivan','Juno'];
const LAST = ['Alvarez','Bergman','Costa','Dubois','Eriksen','Ferrari','Grimaldi','Halvorsen','Ibrahim','Jansen','Kowalski','Lindqvist','Moreau','Nakamura','Olsen','Pereira','Quintero','Rossi','Silva','Tanaka','Ueda','Vasquez','Weber','Xu','Yilmaz','Zielinski','Andersson','Blanc','Cohen','Denis','Egan','Fontaine','Garcia','Hoffman','Ismail','Jokinen','Keller','Laurent','Mendes','Novak'];

const TITLES = {
  'Product Analytics': ['Product Analyst', 'Data Analyst', 'Analytics Engineer'],
  Platform: ['Software Engineer', 'Staff Engineer', 'Backend Engineer'],
  'DevOps/SRE': ['Site Reliability Engineer', 'Platform Engineer', 'Infrastructure Engineer'],
  'Data Engineering': ['Data Engineer', 'Senior Data Engineer', 'Analytics Engineer'],
  'Machine Learning': ['ML Engineer', 'Research Engineer', 'Data Scientist'],
  Integrations: ['Integration Engineer', 'Solutions Engineer', 'API Engineer'],
  Security: ['Security Engineer', 'Security Architect', 'AppSec Engineer'],
  Design: ['Product Designer', 'Design Engineer', 'UX Researcher'],
};

const TEAM_SKILLS = {
  'Product Analytics': ['Data Modeling', 'dbt', 'Snowflake', 'PostgreSQL'],
  Platform: ['Go', 'Rust', 'gRPC', 'PostgreSQL', 'Redis', 'Java'],
  'DevOps/SRE': ['Kubernetes', 'Terraform', 'Docker', 'AWS', 'Observability', 'Incident Response'],
  'Data Engineering': ['Spark', 'Airflow', 'dbt', 'Snowflake', 'Kafka', 'Python'],
  'Machine Learning': ['Machine Learning', 'PyTorch', 'MLOps', 'NLP', 'Recommender Systems', 'Python'],
  Integrations: ['SAP Integration', 'Salesforce Integration', 'REST API Design', 'GraphQL', 'Webhooks'],
  Security: ['Threat Modeling', 'IAM', 'Cryptography', 'AWS'],
  Design: ['React', 'Design Systems'],
};

const TEAM_SIZES = {
  'Product Analytics': 9, Platform: 10, 'DevOps/SRE': 11, 'Data Engineering': 10,
  'Machine Learning': 10, Integrations: 10, Security: 10, Design: 10,
};

function buildPeople() {
  const people = PINNED_PEOPLE.map((p) => ({ ...p, email: emailFor(p.name) }));
  const used = new Set(people.map((p) => p.name));
  let n = 0;
  for (const team of TEAMS) {
    const have = people.filter((p) => p.team === team).length;
    for (let i = have; i < TEAM_SIZES[team]; i++) {
      let name;
      do {
        name = `${FIRST[randint(0, FIRST.length - 1)]} ${LAST[randint(0, LAST.length - 1)]}`;
      } while (used.has(name));
      used.add(name);
      const titles = TITLES[team];
      people.push({
        id: `p-gen${++n}`,
        name,
        title: titles[randint(0, titles.length - 1)],
        team,
        email: emailFor(name),
      });
    }
  }
  return people;
}

function emailFor(name) {
  return name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').join('.') + '@meridian.io';
}

function buildCollabs(people) {
  const byTeam = Object.fromEntries(TEAMS.map((t) => [t, people.filter((p) => p.team === t)]));
  const edges = new Map();

  const add = (a, b, strength, context) => {
    if (a === b) return;
    const k = key(a, b);
    if (FORBIDDEN.has(k) || edges.has(k)) return;
    edges.set(k, { aId: k.split('|')[0], bId: k.split('|')[1], strength, context });
  };

  for (const [a, b, s, c] of PINNED_COLLABS) add(a, b, s, c);

  // Dense within teams.
  const INTRA = [
    'shipped the quarterly roadmap together', 'paired on the on-call rotation',
    'reviewed each other\'s design docs', 'ran the team\'s architecture review',
    'co-authored the runbook', 'debugged a production incident together',
  ];
  for (const team of TEAMS) {
    const members = byTeam[team].filter((p) => !PROTECTED.has(p.id));
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (rnd() < 0.7) {
          add(members[i].id, members[j].id, randint(6, 10), INTRA[randint(0, INTRA.length - 1)]);
        }
      }
    }
  }

  // Sparse across teams — only from hubs, and never into protected/guard nodes.
  const CROSS = [
    'collaborated on a cross-team migration', 'jointly ran a capacity review',
    'partnered on an incident postmortem', 'co-designed a shared service contract',
  ];
  const eligible = people.filter((p) => !PROTECTED.has(p.id) && !NO_CROSS.has(p.id) && !HUBS.includes(p.id));
  for (const hub of HUBS) {
    const hubTeam = people.find((p) => p.id === hub).team;
    const targets = eligible.filter((p) => p.team !== hubTeam);
    const count = randint(6, 9);
    for (let i = 0; i < count; i++) {
      const t = targets[randint(0, targets.length - 1)];
      add(hub, t.id, randint(2, 5), CROSS[randint(0, CROSS.length - 1)]);
    }
  }
  return [...edges.values()];
}

function buildSkills(people) {
  const rows = PINNED_SKILLS.map(([personId, skill, proficiency, evidence]) => ({
    personId, skill, proficiency, evidence,
  }));
  const seen = new Set(rows.map((r) => `${r.personId}|${r.skill}`));
  for (const p of people) {
    const pool = TEAM_SKILLS[p.team];
    const n = randint(2, 4);
    for (let i = 0; i < n; i++) {
      const skill = pool[randint(0, pool.length - 1)];
      const k = `${p.id}|${skill}`;
      if (seen.has(k)) continue;
      seen.add(k);
      // Cap generated proficiency at 4 so pinned experts (5) always rank first.
      rows.push({
        personId: p.id, skill, proficiency: randint(2, 4),
        evidence: `${p.title.toLowerCase()} work on ${skill}`,
      });
    }
  }
  return rows;
}

function buildWorkedOn(people) {
  const rows = PINNED_PROJECTS.map(([personId, project]) => ({ personId, project }));
  const seen = new Set(rows.map((r) => `${r.personId}|${r.project}`));
  for (const p of people) {
    const n = randint(1, 3);
    for (let i = 0; i < n; i++) {
      const project = PROJECTS[randint(0, PROJECTS.length - 1)][0];
      const k = `${p.id}|${project}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ personId: p.id, project });
    }
  }
  return rows;
}

// ------------------------------------------------------------------- seeding

const CONSTRAINTS = [
  'CREATE CONSTRAINT person_id   IF NOT EXISTS FOR (p:Person)  REQUIRE p.id   IS UNIQUE',
  'CREATE CONSTRAINT skill_name  IF NOT EXISTS FOR (s:Skill)   REQUIRE s.name IS UNIQUE',
  'CREATE CONSTRAINT project_name IF NOT EXISTS FOR (r:Project) REQUIRE r.name IS UNIQUE',
  'CREATE CONSTRAINT team_name   IF NOT EXISTS FOR (t:Team)    REQUIRE t.name IS UNIQUE',
];

async function seed({ reset = false } = {}) {
  // Destructive, so opt-in only. MERGE + uniqueness constraints already make
  // re-seeding idempotent; --reset is for when the schema itself changed.
  if (reset) {
    console.log('· wiping graph (--reset)');
    await run('MATCH (n) DETACH DELETE n');
  }

  console.log('· constraints');
  for (const c of CONSTRAINTS) await run(c);

  const people = buildPeople();
  const collabs = buildCollabs(people);
  const skills = buildSkills(people);
  const workedOn = buildWorkedOn(people);

  console.log('· skills, teams, projects');
  await run('UNWIND $rows AS r MERGE (s:Skill {name:r.name}) SET s.category = r.category',
    { rows: SKILLS.map(([name, category]) => ({ name, category })) });
  await run('UNWIND $rows AS r MERGE (:Team {name:r.name})', { rows: TEAMS.map((name) => ({ name })) });
  await run('UNWIND $rows AS r MERGE (p:Project {name:r.name}) SET p.description = r.description, p.year = r.year',
    { rows: PROJECTS.map(([name, description, year]) => ({ name, description, year })) });

  console.log(`· ${people.length} people`);
  await run(
    'UNWIND $rows AS r MERGE (p:Person {id:r.id}) SET p.name=r.name, p.title=r.title, p.team=r.team, p.email=r.email',
    { rows: people },
  );
  await run('UNWIND $rows AS r MATCH (p:Person {id:r.id}), (t:Team {name:r.team}) MERGE (p)-[:MEMBER_OF]->(t)',
    { rows: people.map(({ id, team }) => ({ id, team })) });

  console.log(`· ${skills.length} HAS_SKILL`);
  await run(
    `UNWIND $rows AS r
     MATCH (p:Person {id:r.personId}), (s:Skill {name:r.skill})
     MERGE (p)-[h:HAS_SKILL]->(s) SET h.proficiency=r.proficiency, h.evidence=r.evidence`,
    { rows: skills },
  );

  console.log(`· ${workedOn.length} WORKED_ON`);
  await run('UNWIND $rows AS r MATCH (p:Person {id:r.personId}), (pr:Project {name:r.project}) MERGE (p)-[:WORKED_ON]->(pr)',
    { rows: workedOn });

  const usesSkill = Object.entries(PROJECT_SKILLS).flatMap(([project, ss]) => ss.map((skill) => ({ project, skill })));
  console.log(`· ${usesSkill.length} USES_SKILL`);
  await run('UNWIND $rows AS r MATCH (pr:Project {name:r.project}), (s:Skill {name:r.skill}) MERGE (pr)-[:USES_SKILL]->(s)',
    { rows: usesSkill });

  console.log(`· ${collabs.length} COLLABORATED_WITH`);
  await run(
    `UNWIND $rows AS r
     MATCH (a:Person {id:r.aId}), (b:Person {id:r.bId})
     MERGE (a)-[c:COLLABORATED_WITH]->(b) SET c.strength=r.strength, c.context=r.context`,
    { rows: collabs },
  );

  console.log('✓ seeded');
}

// -------------------------------------------------------------- verification

const ASSERTIONS = [
  {
    name: 'cardinalities: 80 people / 8 teams / 25 projects / 35 skills',
    cypher: 'RETURN COUNT{(:Person)} AS people, COUNT{(:Team)} AS teams, COUNT{(:Project)} AS projects, COUNT{(:Skill)} AS skills',
    check: (r) => r[0].people === 80 && r[0].teams === 8 && r[0].projects === 25 && r[0].skills === 35,
  },
  {
    name: 'Chen Wei is the SAP expert with pinned evidence',
    cypher: `MATCH (c:Person {id:'p-chen'})-[r:HAS_SKILL]->(:Skill {name:'SAP Integration'})
             RETURN c.name AS name, r.proficiency AS prof, r.evidence AS evidence`,
    check: (r) => r[0]?.name === 'Chen Wei' && r[0].prof === 5 &&
      r[0].evidence === 'built the SAP connector for Project Atlas',
  },
  {
    name: 'Maya -> Chen shortest path is exactly 2 hops',
    cypher: `MATCH p = shortestPath((:Person{id:'p-maya'})-[:COLLABORATED_WITH*..4]-(:Person{id:'p-chen'}))
             RETURN length(p) AS hops, [n IN nodes(p) | n.name] AS chain`,
    check: (r) => r[0]?.hops === 2 && r[0].chain.join(' > ') === 'Maya Rodriguez > Priya Nair > Chen Wei',
  },
  {
    name: 'no direct Maya-Chen edge (the 2-hop is real brokering)',
    cypher: `RETURN COUNT { (:Person{id:'p-maya'})-[:COLLABORATED_WITH]-(:Person{id:'p-chen'}) } AS direct`,
    check: (r) => r[0].direct === 0,
  },
  {
    name: 'Kubernetes: Arjun and Tomas tie on proficiency, Arjun wins on degree',
    cypher: `MATCH (p:Person)-[h:HAS_SKILL]->(s:Skill) WHERE toLower(s.name) CONTAINS 'kubernetes'
             RETURN p.name AS name, h.proficiency AS prof, COUNT { (p)-[:COLLABORATED_WITH]-(:Person) } AS degree
             ORDER BY prof DESC, degree DESC`,
    check: (r) => {
      const a = r.find((x) => x.name === 'Arjun Mehta');
      const t = r.find((x) => x.name === 'Tomas Novak');
      return a && t && a.prof === 5 && t.prof === 5 && a.degree >= 12 && t.degree === 3 &&
        r[0].name === 'Arjun Mehta';
    },
  },
  {
    name: 'Maya -> Sofia shortest path is exactly 3 hops via Priya + Arjun',
    cypher: `MATCH p = shortestPath((:Person{id:'p-maya'})-[:COLLABORATED_WITH*..4]-(:Person{id:'p-sofia'}))
             RETURN length(p) AS hops, [n IN nodes(p) | n.name] AS chain`,
    check: (r) => r[0]?.hops === 3 &&
      r[0].chain.join(' > ') === 'Maya Rodriguez > Priya Nair > Arjun Mehta > Sofia Ramos',
  },
];

async function verify() {
  let pass = 0;
  for (const a of ASSERTIONS) {
    let rows;
    try {
      rows = await run(a.cypher);
    } catch (e) {
      console.log(`✗ ${a.name}\n    query error: ${e.message}`);
      continue;
    }
    const ok = a.check(rows);
    if (ok) pass++;
    console.log(`${ok ? '✓' : '✗'} ${a.name}`);
    if (!ok) console.log(`    got: ${JSON.stringify(rows).slice(0, 300)}`);
  }
  console.log(`\n${pass}/${ASSERTIONS.length} assertions passed`);
  if (pass !== ASSERTIONS.length) process.exit(1);
}

const verifyOnly = process.argv.includes('--verify');
if (!verifyOnly) await seed({ reset: process.argv.includes('--reset') });
await verify();
