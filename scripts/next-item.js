#!/usr/bin/env node
//
// What can this lane start right now?
//
// The queue is one file of ~200 entries, ordered by priority, and an implementer used to have to
// read a lot of it to answer that question. Priority stays human-curated — position in the file is
// the priority, and nothing here changes it. Readiness is what this computes: an entry is startable
// unless it is waiting on another entry, on the owner, or on the device.
//
// Anything it cannot place is printed under UNCLASSIFIED rather than dropped. An entry invisible to
// this query would be worse than one you had to read for yourself.
//
// Usage:
//   node scripts/next-item.js                 both lanes
//   node scripts/next-item.js --lane A        one lane
//   node scripts/next-item.js --all           do not truncate READY
//
// READY is work nobody has started. An entry that shipped and still owes an owner sign-off or a
// device run states so with `- **Keep:**` and is listed under KEEP instead — see lib/keep.js for
// why that separation is the whole point of the tool.
//
'use strict';
const fs = require('fs');
const path = require('path');

const { laneFromLines } = require('./lib/lane');
const { keepFromLines } = require('./lib/keep');
const { idPattern } = require('./lib/entry-id');

const ROOT = path.resolve(__dirname, '..');
const BACKLOG = path.join(ROOT, 'docs/implementation-backlog.md');

const argv = process.argv.slice(2);
const laneArg = (() => {
  const i = argv.findIndex((a) => a === '--lane' || a.startsWith('--lane='));
  if (i < 0) return null;
  const v = argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1];
  return v ? v.toUpperCase() : null;
})();
const showAll = argv.includes('--all');
const TOP_N = showAll ? Infinity : 10;

const lines = fs.readFileSync(BACKLOG, 'utf8').split('\n');
const queueStart = lines.findIndex((l) => l.trim() === '## Queue');
if (queueStart < 0) {
  console.error('next-item: no "## Queue" heading found — has the backlog been restructured?');
  process.exit(1);
}

/** Parse the queue into entries, in file order, which IS priority order. */
const entries = [];
let current = null;
for (const line of lines.slice(queueStart)) {
  if (line.startsWith('### ')) {
    const id = line.match(idPattern());
    const title = line.replace(/^###\s*/, '');
    current = id
      ? { id: id[1], title, tags: [...line.matchAll(/\[([a-z-]+)\]/g)].map((m) => m[1]), lane: null, laneLines: [], needs: [], gates: [], batch: null, legacyBlocked: null, schemaRisk: false, keep: null }
      : null;
    if (current) entries.push(current);
    continue;
  }
  // A `## ` section heading ends the previous entry — see check-backlog-pointers.js for why.
  if (line.startsWith('## ')) {
    current = null;
    continue;
  }
  if (!current) continue;

  const needs = line.match(/^\s*[-*]\s*\*{0,2}Needs:\*{0,2}\s*(.+)$/i);
  if (needs) for (const m of needs[1].matchAll(idPattern('g'))) current.needs.push(m[1]);

  const gate = line.match(/^\s*[-*]\s*\*{0,2}Gate:\*{0,2}\s*([a-z]+)/i);
  if (gate) current.gates.push(gate[1].toLowerCase());

  const batch = line.match(/^\s*[-*]\s*\*{0,2}Batch:\*{0,2}\s*`?([^`\s]+)`?/i);
  if (batch && !current.batch) current.batch = batch[1];

  // Advisory only, and deliberately fuzzy: a batched entry that looks like it carries a schema
  // change gets flagged, because the one thing that must never be batched is a migration — its
  // blast radius is data and its revert is a corrective migration, not a git revert.
  if (/\bmigration\b|schema change|ADD COLUMN|local SQLite version/i.test(line)) current.schemaRisk = true;

  // `Lane: ?` is a deliberate "I could not tell" — it must reach a human, not be filtered away.
  //
  // The lane rule lives in `lib/lane.js` and is applied over the whole entry once it is collected —
  // NOT re-implemented here. It was, briefly, and the two copies drifted within a day: the lib
  // learned to refuse an ambiguous entry and this file went on guessing, so the unit test was
  // testing a function the tool did not call.
  current.laneLines.push(line);

  // Entries not yet migrated off the prose marker. Treated as parked, and named as unmigrated so
  // the remaining ones stay visible instead of quietly reading as ready.
  if (!current.legacyBlocked && line.includes('⛔')) {
    current.legacyBlocked = line.replace(/^\s*[-*]?\s*/, '').slice(0, 90);
  }
}

for (const e of entries) {
  e.lane = laneFromLines(e.laneLines);
  e.keep = keepFromLines(e.laneLines);
}

const inQueue = new Set(entries.map((e) => e.id));
// An absent target means shipped — the protocol removes a completed entry from the queue.
const unmetNeeds = (e) => e.needs.filter((n) => inQueue.has(n));

const wantLane = (e) => {
  if (!laneArg) return true;
  if (e.lane === laneArg) return true;
  // No lane stated means the path rule in docs/agents/README.md §3 answers it, so it stays visible
  // to both lanes rather than being hidden from the one that might own it.
  return e.lane === null || e.lane === '?';
};

const ready = [];
const keeps = [];
const parked = [];
const unclassified = [];

for (const e of entries) {
  if (!wantLane(e)) continue;
  const unmet = unmetNeeds(e);
  const reasons = [];
  if (unmet.length) reasons.push(`Needs: ${unmet.join(', ')}`);
  for (const g of e.gates) reasons.push(`Gate: ${g}`);
  // A structured field is authoritative. The prose marker stays in the body for its detail, and is
  // only reported as unmigrated where nothing structured has replaced it yet.
  if (e.legacyBlocked && !e.gates.length && !unmet.length) {
    reasons.push(`unmigrated marker — ${e.legacyBlocked}`);
  }

  // A Keep's own `Gate:` blocks as hard as a top-level one — the residue IS the gate there.
  if (e.keep?.gate && !e.gates.includes(e.keep.gate)) reasons.push(`Gate: ${e.keep.gate}`);

  if (reasons.length) parked.push({ e, reasons });
  else if (e.lane === '?') unclassified.push(e);
  else if (e.keep) keeps.push(e);
  else ready.push(e);
}

// An entry that states no lane is shown to BOTH lanes on the understanding that the path rule in
// docs/agents/README.md §3 answers it. That is the right default and it was silent: 77 of 193
// entries state no lane (measured 2026-08-25), so an implementer reading this list could not tell a
// row the queue KNOWS is theirs from one nobody has classified. Three sessions in a row started on
// an entry that turned out to be the other lane's. Marking them changes no bucket — it says which
// rows still owe a path-rule check before you start.
const fmt = (e) => {
  const tags = e.tags.length ? `[${e.tags.join('][')}] ` : '';
  const title = e.title.replace(/^(\[[^\]]*\]\s*)+/, '').replace(/^[^\w]*/, '');
  const unlaned = e.lane === null ? '  ⟨lane unstated⟩' : '';
  return `${e.id.padEnd(7)} ${(tags + title).slice(0, 100)}${unlaned}`;
};

console.log(`\nQueue: ${entries.length} entries${laneArg ? ` · lane ${laneArg}` : ''}\n`);

const unlanedReady = ready.filter((e) => e.lane === null).length;
console.log(
  `READY (${ready.length}) — top of the list is next` +
  (unlanedReady ? ` · ${unlanedReady} state no lane (⟨lane unstated⟩) — apply the path rule before starting one` : ''),
);
if (!ready.length) console.log('  nothing startable — everything is parked or unclassified');

// Entries sharing a Batch: ship as one PR, so the first member to appear pulls its siblings up with
// it. Position still decides priority — the batch inherits its highest member's place in the queue.
const shownBatches = new Set();
let rank = 0;
for (const e of ready) {
  if (rank >= TOP_N) break;
  if (e.batch) {
    if (shownBatches.has(e.batch)) continue;
    shownBatches.add(e.batch);
    const members = ready.filter((m) => m.batch === e.batch);
    rank++;
    console.log(`  ${String(rank).padStart(2)}. ▣ batch \`${e.batch}\` — ${members.length} entries, one PR`);
    for (const m of members) {
      const warn = m.schemaRisk ? '  ⚠ mentions a schema change — do not batch a migration' : '';
      console.log(`        ${fmt(m)}${warn}`);
    }
    continue;
  }
  rank++;
  console.log(`  ${String(rank).padStart(2)}. ${fmt(e)}`);
}
const shown = ready.filter((e) => !e.batch || shownBatches.has(e.batch)).length;
if (ready.length > shown) console.log(`      … and ${ready.length - shown} more (--all)`);

if (keeps.length) {
  console.log(`\nKEEP (${keeps.length}) — shipped; only the stated residue is owed. Not new work.`);
  keeps.forEach((e) => console.log(`      ${fmt(e)}\n        Keep: ${e.keep.text.slice(0, 110)}`));
}

if (unclassified.length) {
  console.log(`\nUNCLASSIFIED (${unclassified.length}) — Lane: ? — decide the lane and edit the entry`);
  unclassified.forEach((e) => console.log(`      ${fmt(e)}`));
}

if (parked.length) {
  console.log(`\nPARKED (${parked.length})`);
  parked.forEach(({ e, reasons }) => console.log(`      ${fmt(e)}\n        ${reasons.join(' · ')}`));
}
console.log('');
