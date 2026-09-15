#!/usr/bin/env node
// A stubbed payload's date must not be a literal the clock will walk away from.
//
// LA-107, from the failure that blocked every branch on 2026-09-14.
// `e2e/nutrition-budget-honesty.spec.ts` stubbed `/api/nutrition/energy-balance` with
// `date: '2026-09-14'`. `nutrition-content.tsx` renders the two cards that spec asserts on under
// `energyBalance?.date === selectedDate`, and `selectedDate` is `todayInTz('Australia/Brisbane')`
// — so at 14:00 UTC that day Brisbane rolled over, the guard stopped matching, the page rendered
// its no-balance state, and both locators became genuinely absent. It does not recover: the
// literal recedes from the user's day every hour.
//
// ── What this check is NOT, established by measuring rather than assumed ──────────────────────
//
// The obvious discriminator — "a literal date in the same file as a clock derivation" — was
// measured against the very case that motivated the entry and **does not catch it**. The pre-fix
// spec contained no `new Date()`, no `todayInTz`, nothing: the clock lives in the application the
// spec drives, not in the spec. Nine of the twelve e2e files holding a literal date have zero
// clock references. That signal does not discriminate at all.
//
// What the guard has instead is the shape the defect actually takes: a literal date handed to the
// app through a `page.route` stub, where the app is free to compare it against today. Coarse —
// file-level, not expression-level — and deliberately so, because the corpus is twelve files and
// every one of them has been read.
//
// ── Why the exemptions are the useful half ────────────────────────────────────────────────────
//
// All five files this flags today are legitimate, and until 2026-09-14 nobody had established
// why. Each reason below is a measurement, not a guess, and that is the part worth keeping: the
// next person to add a stub gets told which of these three safe shapes theirs is, or discovers it
// is the fourth.
//
// Exemptions are per (file, date), not per file, so a NEW literal in an already-exempt file is
// still a failure. Add one only with a reason that says why the clock cannot reach it.
'use strict';
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./lib/strip-comments');

const root = path.join(__dirname, '..');
const E2E = path.join(root, 'e2e');

/** file → Map(YYYY-MM-DD → why the clock cannot invalidate it). */
const EXEMPT = new Map([
  ['e2e/day-rollover-checkin.spec.ts', new Map([
    // `page.clock.install({ time: JUST_BEFORE_MIDNIGHT })` then `fastForward`. Both sides of the
    // comparison are fixed, which is the one condition under which a literal is correct.
    ['2026-03-10', 'page.clock pins the app clock to this instant'],
  ])],
  ['e2e/nutrition-day-rollover.spec.ts', new Map([
    ['2026-03-10', 'page.clock pins the app clock to this instant'],
    ['2026-03-11', 'the far side of the same pinned rollover'],
  ])],
  ['e2e/stress-by-hour.spec.ts', new Map([
    // `at()` builds every timestamp from `Date.UTC(2026, 8, 8, …)` and the `date` field matches it.
    // Self-consistent: the payload never disagrees with itself, and the card does not date-guard.
    ['2026-09-08', 'every timestamp in the fixture derives from this same fixed day'],
  ])],
  ['e2e/sleep-provisional.spec.ts', new Map([
    // Measured 2026-09-14: green with a date twelve days stale. The sleep list renders the nights
    // it is given; nothing compares them to today. A date-guarded consumer would have failed on
    // the first rollover, not survived twelve.
    ['2026-09-02', 'the sleep list renders given nights; no today-guard (green 12 days stale)'],
    ['2026-09-01', 'the same night, as its start/end instants'],
  ])],
  ['e2e/home-device-battery-chips.spec.ts', new Map([
    ['2026-09-02', 'sunrise/sunset labels, rendered as given; green 12 days stale'],
  ])],
]);

// The date part of any literal date or timestamp: '2026-09-14', '2026-09-14T06:00', ….
//
// Quote characters only, never backticks, and the source has its comments stripped first. Both
// guards earn their place: the first version of this file flagged a date inside its OWN header
// prose, because a date in backticks reads as a template literal to a regex and as emphasis to a
// human. A check that fires on the paragraph explaining it is not one anybody keeps.
const DATE_LITERAL = /['"](\d{4}-\d{2}-\d{2})(?:[T ][^'"]*)?['"]/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, out); continue; }
    if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const failures = [];
let scanned = 0;
let stubbing = 0;

for (const file of walk(E2E)) {
  const rel = path.relative(root, file);
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  scanned++;
  // Only a spec that hands the app a payload can hand it a date the app will compare.
  if (!src.includes('page.route(')) continue;
  stubbing++;

  const allowed = EXEMPT.get(rel) ?? new Map();
  const seen = new Set();
  for (const m of src.matchAll(DATE_LITERAL)) {
    const day = m[1];
    if (allowed.has(day) || seen.has(day)) continue;
    seen.add(day);
    const line = src.slice(0, m.index).split('\n').length;
    failures.push({ rel, line, day, text: m[0] });
  }
}

if (failures.length) {
  console.error('check-e2e-stub-dates: a stubbed payload holds a literal date.\n');
  for (const f of failures) {
    console.error(`  ${f.rel}:${f.line}  ${f.text}`);
  }
  console.error(`
Derive it from the seeded user's zone instead:

  const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date())

A literal is correct only when BOTH sides of the comparison are fixed — the app clock pinned with
\`page.clock.install\`, or a fixture whose every timestamp derives from that same day. If yours is
one of those, add it to EXEMPT in ${path.relative(root, __filename)} with the reason.`);
  process.exit(1);
}

console.log(`check-e2e-stub-dates: OK — ${stubbing} of ${scanned} e2e files stub a route; ` +
  `${[...EXEMPT.values()].reduce((n, m) => n + m.size, 0)} dates exempt with a stated reason.`);
