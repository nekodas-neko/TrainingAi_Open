#!/usr/bin/env node
// Q-477 — client code must compute "today" in the USER's timezone, not Brisbane's and not the
// phone's.
//
// Three answers to "what day is it" ship in this app at once:
//
//   todayInTz(tz)        the user's setting, from `useUserTimezone()`   — correct
//   todayInTz()          falls back to DEFAULT_TZ, i.e. Brisbane        — wrong for anyone else
//   localDateString()    the DEVICE's zone                              — a third answer entirely
//
// While a user is on `Australia/Brisbane` all three agree and nothing is broken, which is why this
// has survived: the wrong call compiles, type-checks, lints clean, and is correct on the only device
// anyone tests on. **Setting the timezone is what introduces the bug** — the server moves to the new
// zone immediately (its routes take the JWT's tz) and the client does not. And
// `components/profile/edit-profile-sheet.tsx` ships an "Auto-detect timezone" button, so the intended
// one-tap action for anyone outside Brisbane is exactly the action that desynchronises them.
//
// Measured with a user on `Pacific/Kiritimati` (UTC+14): `POST /api/day-checkin` stamped
// `logDate 2026-08-19` while the Training Calendar highlighted **18** — `calendar-widget.tsx`'s
// `localDateString()`, following neither the user's setting nor the server.
//
// **This is a ratchet, not a sweep.** The sweep is Lane B's and is ordered highest-visibility first
// (the calendar today-marker, then write paths, then display). What this does is freeze the number
// so every future addition lands in a diff — the same reason `check-hex-literals.js` and
// `check-cache-ttl-divergence.js` exist, both of which were written after prose failed to hold a
// count. The per-file baseline below is SHRINK-ONLY: a file not listed must have zero, and a listed
// file may only go down.
//
// **Do NOT "fix" this by making `todayInTz()`'s default throw or read a global.** The function is
// shared with server code that passes `tz` explicitly, and a global reintroduces the same ambiguity
// somewhere harder to see.
//
// Reproduce the count: node scripts/check-client-today-timezone.js --print
'use strict';
const fs = require('fs');
const path = require('path');
const { resolveBaseRef, countAtBase, verdict } = require('./lib/base-ref');

const root = path.join(__dirname, '..');

// Client code only. `app/api/**` is server — it reads the tz from the session and is the half that
// already behaves. `packages/shared` is shared with the server for the same reason.
const DIRS = ['app', 'components', 'lib/hooks', 'lib/stores'];
const SKIP_PREFIX = ['app/api/'];

// A bare call — no argument at all. `todayInTz(tz)` and `todayInTz(user?.timezone)` are the
// correct shape and are not counted.
const BARE = /\b(todayInTz|localDateString)\s*\(\s*\)/g;

// Files allowed a bare call, each with the reason. Not a count — a claim that the file has no user
// timezone available, which is a thing to defend rather than to baseline.
const EXEMPT = new Map([
]);

const BASELINE = {
  'app/health/health-content.tsx': 3,
  'app/health/hooks/use-health-calcs.ts': 1,
  'app/nutrition/nutrition-content.tsx': 3,
  'app/session-explain/session-explain-client.tsx': 1,
  'app/session-select/components/log-value-sheet.tsx': 2,
  'app/session-select/session-select-content.tsx': 16,
  'components/activity/done-activity-screen.tsx': 2,
  'components/admin/day-review-tab.tsx': 2,
  'components/admin/time-audit-card.tsx': 1,
  'components/day-review-sheet.tsx': 2,
  'components/exercise-history-sheet.tsx': 1,
  'components/fitness-tests/test-result.tsx': 1,
  'components/guided-walk/walk-summary.tsx': 1,
  'components/health/hr-day-card.tsx': 1,
  'components/health/injury-card.tsx': 1,
  'components/health/injury-sheet.tsx': 3,
  'components/health/time-in-zone-card.tsx': 1,
  'components/health/training-stress-line.tsx': 1,
  'components/home/home-card-widget.tsx': 2,
  'components/nutrition/assign-step.tsx': 2,
  'components/nutrition/food-logger-sheet.tsx': 1,
  'components/nutrition/manage-supplements-sheet.tsx': 3,
  'components/nutrition/saved-meals-sheet.tsx': 3,
  'components/nutrition/supplements-section.tsx': 1,
  'components/running/prescribed-run-card.tsx': 1,
  'components/running/running-plan-content.tsx': 1,
  'components/stats/weekly-stats-hub.tsx': 1,
  'components/sync-provider.tsx': 2,
  'components/workout-screen.tsx': 4,
  'components/workout/active-workout-screen.tsx': 1,
  'components/workout/done-screen.tsx': 1,
  'components/workout/exercise-summary-screen.tsx': 1,
  'lib/stores/workout-store.ts': 3,
};

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '__tests__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

/** The one counting pass, so the working tree and the base branch are measured identically (LA-16). */
function countBare(raw) {
  const src = stripComments(raw);
  BARE.lastIndex = 0;
  return [...src.matchAll(BARE)].length;
}

const counts = new Map();
let scanned = 0;

for (const dir of DIRS) {
  for (const full of walk(path.join(root, dir), [])) {
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (SKIP_PREFIX.some(p => rel.startsWith(p))) continue;
    scanned++;
    const n = countBare(fs.readFileSync(full, 'utf8'));
    if (n > 0) counts.set(rel, n);
  }
}

const total = [...counts.values()].reduce((a, b) => a + b, 0);

if (process.argv.includes('--print')) {
  for (const [rel, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(3)}  ${rel}`);
  console.log(`\n${total} bare call(s) across ${counts.size} file(s); ${scanned} client file(s) scanned.`);
  process.exit(0);
}

const baseRef = resolveBaseRef();
const offenders = [];
const inherited = [];
for (const [rel, n] of counts) {
  if (EXEMPT.has(rel)) continue;
  const allowed = BASELINE[rel] ?? 0;
  // LA-16 / Q-424: whether THIS BRANCH added one, not whether the file is over.
  const v = verdict({ count: n, limit: allowed, atBase: countAtBase(baseRef, rel, countBare) });
  if (v === 'inherited') {
    inherited.push(`${rel}: ${n} bare call(s) against a baseline of ${allowed}, but the base branch is already there.`);
  } else if (v === 'fail') {
    offenders.push({ rel, n, allowed });
  }
}

// Reported whether or not the run fails, and never as a failure (Q-424).
if (inherited.length > 0) {
  console.log('check-client-today-timezone: inherited from the base branch, not caused here:');
  inherited.forEach((f) => console.log('  • ' + f));
}
const stale = Object.keys(BASELINE).filter(rel => (counts.get(rel) ?? 0) < BASELINE[rel]);
const staleExempt = [...EXEMPT.keys()].filter(rel => !counts.has(rel));

if (offenders.length > 0) {
  console.error('Client code computing "today" in the wrong timezone (Q-477).');
  console.error('A bare `todayInTz()` falls back to DEFAULT_TZ (Brisbane) and a bare');
  console.error('`localDateString()` reads the DEVICE\'s zone — neither follows the user\'s setting,');
  console.error('which the server already honours. Pass the timezone from `useUserTimezone()`:');
  console.error('  const tz = useUserTimezone()   →   todayInTz(tz)');
  for (const o of offenders) {
    console.error(`  ${o.rel}  ${o.n} bare call(s), baseline ${o.allowed}`);
  }
  process.exit(1);
}

if (stale.length > 0) {
  console.error('BASELINE is shrink-only and these files have improved — lower them in the same PR,');
  console.error('so the reclaimed ground cannot be given back silently.');
  for (const rel of stale) console.error(`  ${rel}  now ${counts.get(rel) ?? 0}, baseline ${BASELINE[rel]}`);
  process.exit(1);
}

if (staleExempt.length > 0) {
  console.error('EXEMPT names files with no bare call left — drop the entry in the same PR.');
  for (const rel of staleExempt) console.error(`  ${rel}`);
  process.exit(1);
}

console.log(`check-client-today-timezone: ${total} bare call(s) across ${counts.size} file(s) (baseline held); ${scanned} client file(s) scanned.`);
