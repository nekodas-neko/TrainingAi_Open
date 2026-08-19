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
'use strict';
const fs = require('fs');
const path = require('path');

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
    const id = line.match(/\b([ABFRTPQ]-\d+[a-z]?)\b/);
    const title = line.replace(/^###\s*/, '');
    current = id
      ? { id: id[1], title, tags: [...line.matchAll(/\[([a-z-]+)\]/g)].map((m) => m[1]), lane: null, needs: [], gates: [], legacyBlocked: null }
      : null;
    if (current) entries.push(current);
    continue;
  }
  if (!current) continue;

  const needs = line.match(/^\s*[-*]\s*\*{0,2}Needs:\*{0,2}\s*(.+)$/i);
  if (needs) for (const m of needs[1].matchAll(/\b([ABFRTPQ]-\d+[a-z]?)\b/g)) current.needs.push(m[1]);

  const gate = line.match(/^\s*[-*]\s*\*{0,2}Gate:\*{0,2}\s*([a-z]+)/i);
  if (gate) current.gates.push(gate[1].toLowerCase());

  // `Lane: ?` is a deliberate "I could not tell" — it must reach a human, not be filtered away.
  const lane = line.match(/\*{0,2}Lane:?\*{0,2}\s*\*{0,2}(A\b|B\b|\?)/);
  if (lane && !current.lane) current.lane = lane[1].trim();

  // Entries not yet migrated off the prose marker. Treated as parked, and named as unmigrated so
  // the remaining ones stay visible instead of quietly reading as ready.
  if (!current.legacyBlocked && line.includes('⛔')) {
    current.legacyBlocked = line.replace(/^\s*[-*]?\s*/, '').slice(0, 90);
  }
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
const parked = [];
const unclassified = [];

for (const e of entries) {
  if (!wantLane(e)) continue;
  const unmet = unmetNeeds(e);
  const reasons = [];
  if (unmet.length) reasons.push(`Needs: ${unmet.join(', ')}`);
  for (const g of e.gates) reasons.push(`Gate: ${g}`);
  if (e.legacyBlocked) reasons.push(`unmigrated marker — ${e.legacyBlocked}`);

  if (reasons.length) parked.push({ e, reasons });
  else if (e.lane === '?') unclassified.push(e);
  else ready.push(e);
}

const fmt = (e) => {
  const tags = e.tags.length ? `[${e.tags.join('][')}] ` : '';
  const title = e.title.replace(/^(\[[^\]]*\]\s*)+/, '').replace(/^[^\w]*/, '');
  return `${e.id.padEnd(7)} ${(tags + title).slice(0, 100)}`;
};

console.log(`\nQueue: ${entries.length} entries${laneArg ? ` · lane ${laneArg}` : ''}\n`);

console.log(`READY (${ready.length}) — top of the list is next`);
if (!ready.length) console.log('  nothing startable — everything is parked or unclassified');
ready.slice(0, TOP_N).forEach((e, i) => console.log(`  ${String(i + 1).padStart(2)}. ${fmt(e)}`));
if (ready.length > TOP_N) console.log(`      … and ${ready.length - TOP_N} more (--all)`);

if (unclassified.length) {
  console.log(`\nUNCLASSIFIED (${unclassified.length}) — Lane: ? — decide the lane and edit the entry`);
  unclassified.forEach((e) => console.log(`      ${fmt(e)}`));
}

if (parked.length) {
  console.log(`\nPARKED (${parked.length})`);
  parked.forEach(({ e, reasons }) => console.log(`      ${fmt(e)}\n        ${reasons.join(' · ')}`));
}
console.log('');
