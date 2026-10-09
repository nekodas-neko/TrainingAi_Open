#!/usr/bin/env node
'use strict';
// The work queue: every ready issue for one agent, in order, grouped into batches by the files the
// issues touch. Replaces next-item.js now that the backlog lives in GitHub Issues.
//
//   node scripts/queue.js --agent implementer        the ordered queue, with suggested batches
//   node scripts/queue.js --agent bugfix --json      machine-readable
//   node scripts/queue.js --next-batch [--lane engine|surface] [--urgent-only] [--sonnet-only]
//                                                    the next unclaimed BATCH MILESTONE, or NO_BATCH
//
// CLAIMING: several sessions of a role may run at once. A session labels its issues `in progress`
// when it starts, and both modes here skip anything already claimed. Two Implementers split by
// `--lane` so they never edit the same half of the code.
//
// BATCH MILESTONES (owner, 2026-10-05): the Orchestrator groups 1–10 related ready issues into a
// milestone titled `Batch: <what it is>`. The Implementer builds one batch as one PR. Batches are
// taken oldest milestone first. Creating a batch milestone is how the Orchestrator hands the
// Implementer its next job; the agent runner (scripts/agent-runner.mjs) waits for one.
//
// READY means open, carrying `agent: <name>`, and neither `blocked`, `later` nor any `needs:` label.
// `later` (owner, 2026-10-08) parks a someday idea out of the queue without closing it.
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

/** A batch needs Opus when its milestone description names it (descriptions start `Opus.` or `Sonnet.`). */
function needsOpus(milestone) {
  return /\bOpus\b/.test(milestone.description || '');
}

/**
 * Pure: the batch to build next (owner, 2026-10-09: "prioritise the higher priority tasks").
 * A batch ranks by its most urgent ready issue (`hotfix`, then `next`, then a bug, then the rest;
 * the same order as `rank`), and ties go to the oldest milestone. A batch someone has claimed
 * (`in progress`), one outside `lane`, one needing Opus under `sonnetOnly`, and one with nothing
 * ready are skipped. `urgentOnly` (the Slow usage tier) keeps only batches holding a hotfix, a `next`
 * or a bug.
 */
function pickBatch(milestones, issuesByMilestone, { sonnetOnly = false, urgentOnly = false, lane = null } = {}) {
  const names = (i) => new Set(i.labels.map((l) => (typeof l === 'string' ? l : l.name)));
  const parked = (l) => l.has('blocked') || l.has('later') || [...l].some((n) => n.startsWith('needs:'));
  const candidates = [];
  for (const m of milestones) {
    if (sonnetOnly && needsOpus(m)) continue;
    const issues = issuesByMilestone.get(m.number) || [];
    const labelSets = issues.map(names);
    if (labelSets.some((l) => l.has('in progress'))) continue;
    if (lane && !labelSets.some((l) => l.has(`lane: ${lane}`))) continue;
    const readySets = labelSets.filter((l) => !parked(l));
    if (!readySets.length) continue;
    const best = Math.min(...readySets.map(rank));
    if (urgentOnly && best > 2) continue; // the Slow tier takes only hotfix, next and bug batches
    candidates.push({ milestone: m, issues, blocked: issues.filter((_, k) => parked(labelSets[k])), best });
  }
  candidates.sort((a, b) => a.best - b.best || a.milestone.number - b.milestone.number);
  return candidates[0] || null;
}

function isReady(issue, agent) {
  const l = issue.labelSet;
  return l.has(`agent: ${agent}`) && !l.has('blocked') && !l.has('later') && !l.has('in progress') && ![...l].some((n) => n.startsWith('needs:'));
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

module.exports = { plan, rank, isReady, needsOpus, pickBatch };

if (require.main === module) {
  const args = process.argv.slice(2);
  const agent = args[args.indexOf('--agent') + 1];
  if (!args.includes('--next-batch') && (!args.includes('--agent') || !agent)) {
    console.error('Usage: queue.js --agent <implementer|bugfix|orchestrator> [--json]  |  queue.js --next-batch [--urgent-only] [--sonnet-only] [--json]');
    process.exit(2);
  }
  const repo = process.env.GH_REPO || 'nekodas-neko/TrainingAi_Open';
  const api = (p) => JSON.parse(execFileSync('gh', ['api', p], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

  const lane = args.includes('--lane') ? args[args.indexOf('--lane') + 1] : null;
  if (args.includes('--next-batch')) {
    const milestones = api(`repos/${repo}/milestones?state=open&sort=due_on&direction=asc&per_page=100`)
      .filter((m) => /^Batch\b/i.test(m.title));
    // One paginated read of every open issue, grouped by milestone, instead of a call per milestone.
    const open = [];
    for (let page = 1; ; page++) {
      const batch = api(`repos/${repo}/issues?state=open&milestone=*&per_page=100&page=${page}`);
      open.push(...batch.filter((i) => !i.pull_request));
      if (batch.length < 100) break;
    }
    const byMilestone = new Map();
    for (const i of open) {
      const list = byMilestone.get(i.milestone.number) || [];
      list.push(i);
      byMilestone.set(i.milestone.number, list);
    }
    // --sonnet-only (owner, 2026-10-09) skips batches that need Opus.
    const picked = pickBatch(milestones, byMilestone, { sonnetOnly: args.includes('--sonnet-only'), urgentOnly: args.includes('--urgent-only'), lane });
    if (!picked) {
      console.log('NO_BATCH');
      process.exit(0);
    }
    const { milestone: m, issues, blocked } = picked;
    if (args.includes('--json')) {
      console.log(JSON.stringify({ milestone: m.number, title: m.title, issues: issues.map((i) => ({ number: i.number, title: i.title, blocked: blocked.includes(i) })) }, null, 2));
    } else {
      console.log(`NEXT BATCH: milestone #${m.number} — ${m.title}`);
      for (const i of issues) console.log(`  #${i.number}  ${i.title}${blocked.includes(i) ? '   (blocked — leave it, say so in the PR)' : ''}`);
    }
    process.exit(0);
  }

  const all = [];
  for (let page = 1; ; page++) {
    const batch = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/issues?state=open&per_page=100&page=${page}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    all.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  for (const i of all) i.labelSet = new Set(i.labels.map((l) => l.name));
  const ready = all.filter((i) => isReady(i, agent) && (!lane || i.labelSet.has(`lane: ${lane}`)));
  const batches = plan(ready);
  if (args.includes('--json')) {
    console.log(JSON.stringify(batches, null, 2));
  } else {
    console.log(`${ready.length} ready for ${agent}, in ${batches.length} suggested batches (issues sharing files).\n`);
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
