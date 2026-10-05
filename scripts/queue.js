#!/usr/bin/env node
'use strict';
// The work queue: every ready issue for one agent, in order, grouped into batches by the files the
// issues touch. Replaces next-item.js now that the backlog lives in GitHub Issues.
//
//   node scripts/queue.js --agent implementer        the ordered, batched queue
//   node scripts/queue.js --agent bugfix --json      machine-readable
//
// READY means open, carrying `agent: <name>`, and neither `blocked` nor any `needs:` label.
// ORDER (owner, 2026-10-05): `hotfix`, then `next`, then `type: bug`, then everything else, oldest
// first. Oldest-first preserves the migrated backlog's priority, because the migration created the
// issues in queue order.
// BATCHES: ready issues that name a common file belong in one PR — the file is the location, so
// area and lane labels do not split a batch. Hub files that most of the app touches (the database
// adapter, the schema, the cache groups, the root layout) do not count as a shared location, and a
// batch is capped at MAX_BATCH so one PR stays reviewable. A batch is listed where its
// highest-priority member would have been.
const { execFileSync } = require('child_process');

const FILE = /((?:app|lib|components|packages|android)\/[\w./\[\]()@-]+\.(?:ts|tsx|kt|js|sql))/g;
const HUB_FILES = new Set([
  'lib/data/postgres/adapter.ts',
  'lib/data/postgres/schema.ts',
  'lib/data/repository.ts',
  'lib/cache-groups.ts',
  'app/layout.ts',
  'app/layout.tsx',
]);
const MAX_BATCH = 5;

function rank(labels) {
  if (labels.has('hotfix')) return 0;
  if (labels.has('next')) return 1;
  if (labels.has('type: bug')) return 2;
  return 3;
}

function isReady(issue, agent) {
  const l = issue.labelSet;
  return l.has(`agent: ${agent}`) && !l.has('blocked') && ![...l].some((n) => n.startsWith('needs:'));
}

/** Pure: ordered batches from issues already filtered to one agent's ready set. */
function plan(issues) {
  const ordered = [...issues].sort((a, b) => rank(a.labelSet) - rank(b.labelSet) || a.number - b.number);
  const files = new Map(ordered.map((i) => [i.number, new Set([...(i.body || '').matchAll(FILE)].map((m) => m[1]).filter((f) => !HUB_FILES.has(f)))]));
  const size = new Map(ordered.map((i) => [i.number, 1]));

  // Union-find over issues sharing a file, never growing a batch past MAX_BATCH.
  const parent = new Map(ordered.map((i) => [i.number, i.number]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (let a = 0; a < ordered.length; a++) {
    for (let b = a + 1; b < ordered.length; b++) {
      const A = ordered[a];
      const B = ordered[b];
      const shared = [...files.get(A.number)].some((f) => files.get(B.number).has(f));
      const ra = find(A.number);
      const rb = find(B.number);
      if (!shared || ra === rb || size.get(ra) + size.get(rb) > MAX_BATCH) continue;
      parent.set(rb, ra);
      size.set(ra, size.get(ra) + size.get(rb));
    }
  }
  const batches = [];
  const seen = new Set();
  for (const i of ordered) {
    const root = find(i.number);
    if (seen.has(root)) continue;
    seen.add(root);
    const members = ordered.filter((x) => find(x.number) === root);
    const shared = members.length > 1
      ? [...files.get(members[0].number)].filter((f) => members.slice(1).some((m) => files.get(m.number).has(f)))
      : [];
    batches.push({ members: members.map((m) => ({ number: m.number, title: m.title })), sharedFiles: shared });
  }
  return batches;
}

module.exports = { plan, rank };

if (require.main === module) {
  const args = process.argv.slice(2);
  const agent = args[args.indexOf('--agent') + 1];
  if (!args.includes('--agent') || !agent) {
    console.error('Usage: queue.js --agent <implementer|bugfix|orchestrator> [--json]');
    process.exit(2);
  }
  const repo = process.env.GH_REPO || 'nekodas-neko/TrainingAi_Open';
  const all = [];
  for (let page = 1; ; page++) {
    const batch = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/issues?state=open&per_page=100&page=${page}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    all.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  for (const i of all) i.labelSet = new Set(i.labels.map((l) => l.name));
  const ready = all.filter((i) => isReady(i, agent));
  const batches = plan(ready);
  if (args.includes('--json')) {
    console.log(JSON.stringify(batches, null, 2));
  } else {
    console.log(`${ready.length} ready for ${agent}, in ${batches.length} batches. Take the first.\n`);
    batches.slice(0, args.includes('--all') ? batches.length : 15).forEach((b, n) => {
      if (b.members.length === 1) console.log(`${n + 1}. #${b.members[0].number}  ${b.members[0].title}`);
      else {
        console.log(`${n + 1}. BATCH of ${b.members.length} — one PR (shared: ${b.sharedFiles.slice(0, 3).join(', ')})`);
        for (const m of b.members) console.log(`     #${m.number}  ${m.title}`);
      }
    });
    if (!args.includes('--all') && batches.length > 15) console.log(`\n… ${batches.length - 15} more (--all).`);
  }
}
