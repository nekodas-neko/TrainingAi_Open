#!/usr/bin/env node
/**
 * Custom Rules gate for docs/implementation-backlog.md.
 *
 * The backlog carries three numbers that sessions collide on, and every one of them had drifted by
 * 2026-08-17: the Postgres migration pointer was 11 behind the directory, the local SQLite version
 * was 4 behind the source, and Q-306 and Q-307 were each held by two different entries at once.
 * Prose could not hold them. This reads the real values and fails on a mismatch.
 *
 * Checks:
 *   1. No entry ID is used by two queue entries.
 *   2. Every queue entry heading carries at least one valid [domain] tag.
 *   3. The "Next free Postgres migration" pointer matches the migrations directory.
 *   4. The "Local SQLite schema version" pointer matches lib/sqlite/migrations.ts.
 *   5. Every `Needs:` names an ID that exists, or has existed, somewhere in the tree.
 *   6. No cycle among `Needs:` edges.
 *   7. Every `Gate:` value is one this project knows how to resolve.
 *   8. A `Batch:` is a kebab slug, and no batch mixes Lane A and Lane B — one batch is one PR, and
 *      one PR is one lane.
 *
 * IDs are `<letter>-<number>` with an optional lowercase suffix: LA/LB (implementer lanes), BF
 * (BugFix), RV (Review), TN (Tuning), PS (one-off planning sessions), and the legacy Q. The old "next
 * unallocated Q band" pointer check is gone with the bands themselves — see docs/agents/README.md
 * for why enumerated bands were replaced by per-agent counters.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKLOG = path.join(ROOT, 'docs/implementation-backlog.md');
const MIGRATIONS = path.join(ROOT, 'lib/data/postgres/migrations');
const SQLITE = path.join(ROOT, 'lib/sqlite/migrations.ts');

// The eleven pillars, plus "cross" for entries that genuinely span several.
const PILLARS = new Set([
  'sleep', 'readiness', 'heart-rate', 'cardio', 'activity', 'workouts',
  'nutrition', 'body', 'devices', 'app-shell', 'platform', 'cross',
]);

const failures = [];
let batchSummary = '';
const text = fs.readFileSync(BACKLOG, 'utf8');
const lines = text.split('\n');

// Only the Queue section carries numbered entries; the header and Protocol do not.
const queueStart = lines.findIndex((l) => l.trim() === '## Queue');
if (queueStart < 0) {
  console.error('check-backlog-pointers: no "## Queue" heading found — has the file been restructured?');
  process.exit(1);
}
const queue = lines.slice(queueStart);

// ---- 1 & 2: entry headings -------------------------------------------------
const seen = new Map();
const entryOrder = [];
/** id -> { needs: [], gates: [], batch: null, lane: null } for the most recently opened heading. */
const meta = new Map();
let currentId = null;

for (let i = 0; i < queue.length; i++) {
  const line = queue[i];

  // A `## ` section heading ends the previous entry. Without this, a field written under a section
  // boundary — belonging to no entry — is attributed to the last entry above it. The queue carries
  // eight such boundaries.
  if (line.startsWith('## ') && !line.startsWith('### ')) {
    currentId = null;
    continue;
  }

  if (!line.startsWith('### ')) {
    // Body lines belong to the heading above them. `Needs:` and `Gate:` are what make readiness
    // computable instead of prose, so they are read here rather than left for a human to notice.
    if (currentId) {
      const needs = line.match(/^\s*[-*]\s*\*{0,2}Needs:\*{0,2}\s*(.+)$/i);
      if (needs) {
        for (const m of needs[1].matchAll(/\b((?:LA|LB|BF|RV|TN|PS|Q)-\d+[a-z]?)\b/g)) {
          meta.get(currentId).needs.push(m[1]);
        }
      }
      const gate = line.match(/^\s*[-*]\s*\*{0,2}Gate:\*{0,2}\s*([a-z]+)/i);
      if (gate) meta.get(currentId).gates.push(gate[1].toLowerCase());

      const batch = line.match(/^\s*[-*]\s*\*{0,2}Batch:\*{0,2}\s*`?([^`\s]+)`?/i);
      if (batch && !meta.get(currentId).batch) meta.get(currentId).batch = batch[1];

      const lane = line.match(/\*{0,2}Lane:?\*{0,2}\s*\*{0,2}(A\b|B\b|\?)/);
      if (lane && !meta.get(currentId).lane) meta.get(currentId).lane = lane[1].trim();
    }
    continue;
  }

  currentId = null;

  const tags = [...line.matchAll(/\[([a-z-]+)\]/g)].map((m) => m[1]);
  const valid = tags.filter((t) => PILLARS.has(t));
  if (valid.length === 0) {
    failures.push(
      `Untagged queue entry — a heading with no valid [domain] tag is invisible to every ` +
        `per-pillar sweep:\n    ${line.slice(0, 120)}`,
    );
  }

  const q = line.match(/\b(LA|LB|BF|RV|TN|PS|Q)-(\d+)([a-z]?)\b/);
  if (!q) continue;
  const id = `${q[1]}-${q[2]}${q[3]}`;
  entryOrder.push(id);
  currentId = id;
  if (!meta.has(id)) meta.set(id, { needs: [], gates: [], batch: null, lane: null });

  if (seen.has(id)) {
    failures.push(
      `Duplicate ${id} — two queue entries hold the same number:\n` +
        `    ${seen.get(id).slice(0, 110)}\n    ${line.slice(0, 110)}`,
    );
  } else {
    seen.set(id, line);
  }
}

// ---- 2b: Gate values -------------------------------------------------------
// Three different blockers used to be written the same way as prose `blocked:` markers, with three
// different resolvers. A free-text gate is the same problem wearing a field name.
const GATES = new Set(['owner', 'device']);
for (const [id, m] of meta) {
  for (const g of m.gates) {
    if (!GATES.has(g)) {
      failures.push(
        `${id} has \`Gate: ${g}\`, which is not a gate this project resolves. ` +
          `Use \`Gate: owner\` (a decision) or \`Gate: device\` (the S25 smoke run). ` +
          `A dependency on another entry is \`Needs:\`, not a gate.`,
      );
    }
  }
}

// ---- 2b2: Batch slugs and lane purity --------------------------------------
// A batch is a set of entries that ship as ONE pull request, so that one verification pass covers
// all of them. One PR is one lane's work, so a batch spanning both lanes cannot be shipped as one.
{
  const batches = new Map();
  for (const [id, m] of meta) {
    if (!m.batch) continue;
    if (!/^[a-z][a-z0-9-]*$/.test(m.batch)) {
      failures.push(
        `${id} has \`Batch: ${m.batch}\` — a batch name is a lowercase kebab slug (e.g. ` +
          `\`nutrition-surface\`), because it is also the PR's branch suffix.`,
      );
      continue;
    }
    if (!batches.has(m.batch)) batches.set(m.batch, []);
    batches.get(m.batch).push([id, m.lane]);
  }
  for (const [name, members] of batches) {
    const lanes = new Set(members.map(([, l]) => l).filter((l) => l === 'A' || l === 'B'));
    if (lanes.size > 1) {
      const who = members.map(([id, l]) => `${id}=${l ?? '-'}`).join(', ');
      failures.push(
        `Batch \`${name}\` mixes Lane A and Lane B (${who}). A batch ships as one PR and a PR is ` +
          `one lane's work — split it into one batch per lane, with a \`Needs:\` if one must land first.`,
      );
    }
  }
  batchSummary = [...batches.entries()].map(([n, m]) => `${n}×${m.length}`).join(', ');
}

// ---- 2c: Needs targets exist ----------------------------------------------
// An absent target means SHIPPED, because the protocol removes a completed entry from the queue —
// so a dependent must unblock, not wedge. The cost of that rule is that a typo reads exactly like a
// success, which is why a target that has never existed anywhere in the tree is an error here.
let treeBlob = '';
{
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.md')) {
        // Strip the `Needs:` declarations themselves. Otherwise a typo'd target is proved to exist
        // by the very line that names it, and this check silently never fires.
        treeBlob += fs
          .readFileSync(full, 'utf8')
          .split('\n')
          .filter((l) => !/^\s*[-*]\s*\*{0,2}Needs:/i.test(l))
          .join('\n');
      }
    }
  };
  walk(path.join(ROOT, 'docs'));
}
for (const [id, m] of meta) {
  for (const target of m.needs) {
    if (seen.has(target)) continue;
    const mentioned = new RegExp(`\\b${target}\\b`).test(treeBlob);
    if (!mentioned) {
      failures.push(
        `${id} declares \`Needs: ${target}\`, but ${target} does not exist and never has. ` +
          `An absent target reads as "already shipped", so a typo here silently unblocks the entry.`,
      );
    }
  }
}

// ---- 2d: no Needs cycles ---------------------------------------------------
// Two entries waiting on each other are each individually plausible and jointly unstartable.
{
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      const cycle = [...stack.slice(stack.indexOf(id)), id].join(' → ');
      failures.push(`Needs: cycle — these entries wait on each other and none can start: ${cycle}`);
      return;
    }
    state.set(id, 'open');
    stack.push(id);
    for (const t of meta.get(id)?.needs ?? []) if (seen.has(t)) visit(t);
    stack.pop();
    state.set(id, 'done');
  };
  for (const id of seen.keys()) visit(id);
}

// ---- 3: Postgres migration pointer ----------------------------------------
const migFiles = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .map((f) => parseInt(f.match(/^(\d+)/)[1], 10));
const nextMigration = Math.max(...migFiles) + 1;

const migRow = text.match(/\|\s*Next free Postgres migration\s*\|\s*\*\*(\d+)\*\*/);
if (!migRow) {
  failures.push('Live-pointer table is missing its "Next free Postgres migration" row.');
} else if (parseInt(migRow[1], 10) !== nextMigration) {
  failures.push(
    `Migration pointer says ${migRow[1]}, but the directory head is ` +
      `${nextMigration - 1} so the next free number is ${nextMigration}.`,
  );
}

// ---- 4: local SQLite version ----------------------------------------------
const sqliteSrc = fs.readFileSync(SQLITE, 'utf8');
const versions = [...sqliteSrc.matchAll(/toVersion:\s*(\d+)/g)].map((m) => parseInt(m[1], 10));
if (versions.length === 0) {
  failures.push('Could not read any toVersion from lib/sqlite/migrations.ts.');
} else {
  const maxVersion = Math.max(...versions);
  const sqliteRow = text.match(/\|\s*Local SQLite schema version\s*\|\s*\*\*v(\d+)\*\*/);
  if (!sqliteRow) {
    failures.push('Live-pointer table is missing its "Local SQLite schema version" row.');
  } else if (parseInt(sqliteRow[1], 10) !== maxVersion) {
    failures.push(
      `SQLite pointer says v${sqliteRow[1]}, but lib/sqlite/migrations.ts tops out at v${maxVersion}.`,
    );
  }
}

// ---- report ----------------------------------------------------------------
if (failures.length) {
  console.error('Backlog pointer check failed:\n');
  failures.forEach((f) => console.error('  • ' + f + '\n'));
  process.exit(1);
}

const withNeeds = [...meta.values()].filter((m) => m.needs.length).length;
const withGate = [...meta.values()].filter((m) => m.gates.length).length;
console.log(
  `check-backlog-pointers: OK — ${seen.size} entries, no duplicates, all tagged; ` +
    `${withNeeds} with Needs: (no cycles, all targets known), ${withGate} with Gate:; ` +
    `batches [${batchSummary || 'none'}]; ` +
    `migration ${nextMigration}, SQLite v${Math.max(...versions)} match source.`,
);
