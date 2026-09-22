#!/usr/bin/env node
// `toLocaleDateString`/`toLocaleTimeString` without an explicit `timeZone` renders in the
// DEVICE's timezone, not the user's. It is invisible while the device sits in the zone the data
// was recorded in, which is why it hid for months — on 2026-08-03 six user-facing screens were
// found rendering Brisbane clock times in device-local (a 7:05 am wake read as 5:05 pm in New
// York). Use formatTimeOfDay/formatInTimeZone from @trainingai/shared/date-utils, or pass an
// explicit `timeZone` option.
//
// Deliberately exempt (CLAUDE.md): the admin and oura-ble debug consoles, where device-local IS
// the useful reading because you are holding the device.
'use strict';
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./lib/strip-comments');

const EXEMPT_PREFIXES = [
  'components/admin/',
  'components/oura-ble/',
  // The helper that implements timezone-correct rendering — it necessarily calls the raw APIs.
  'packages/shared/src/date-utils.ts',
];

// TRIAGED 2026-08-08. The original list was 12 undifferentiated files; each was then read and
// classified, because "calls toLocale* without a timeZone" is not by itself a bug.
//
// BENIGN — the Date is built from calendar components (`new Date(y, m - 1, d)`) or from a
// date string anchored at LOCAL noon/midnight (`new Date(s + 'T12:00:00')`, no `Z`). Those are
// local-time Dates carrying a calendar date, so rendering them device-local returns the same
// date in any zone. There is nothing to fix; they are listed to record that the judgement was
// made, so nobody re-triages them.
//
// FOUR OF THE FIVE ARE GONE (LB-126). They were benign, and they are now also absent: each spelled
// its own `{ weekday: … }` option bag, and `formatDateDisplay` grew the styles for them in LB-125,
// so they route through the one formatter and no longer call `toLocale*String` at all. The rows
// are deleted rather than kept, per this check's own rule — the four it named were
// `nutrition-content`, `recommendation-card`, `week-day-sheet` and `weekly-nutrition-chart`.
const REVIEWED_BENIGN = new Set([
  // The one LB-126 deliberately did NOT convert: this renders a MONTH and YEAR from
  // `(viewYear, viewMonth - 1, 1)`, while `formatDateDisplay` takes a `YYYY-MM-DD` string and has
  // no month-year style. Still benign for the original reason — a calendar-component Date.
  'components/calendar-widget.tsx',                 // new Date(viewYear, viewMonth - 1, 1) — month label
]);

// REAL but BLOCKED — this list is now EMPTY, and that is the finished state of Q-148, not an
// oversight. These sites rendered an absolute instant device-local and could not be fixed the way
// the server-side ones were (Q-144), because no client component could read the user's timezone.
// `UserTimezoneProvider` (fed from the root layout's existing `auth()` call) closed that gap, and
// `chat.tsx` + `more/stats-grid.tsx` were converted. Keep the set — a future client-side site with
// no way to reach a timezone belongs here rather than being silently benign-listed.
//
// NOTE the check's scope, which is narrower than the bug: it matches `toLocale*String` only. A site
// that moves to `formatTimeOfDay`/`formatDayShort`/`toAestDay` WITHOUT passing a tz leaves this
// check while still rendering in DEFAULT_TZ rather than the user's zone — that is what happened to
// `exercise-review-sheet.tsx` between Q-123 and Q-148. Grep for those formatters called with one
// argument when sweeping, not just for `toLocale*`.
const BLOCKED_ON_CLIENT_TZ = new Set([]);

// Both lists may only shrink: the check fails if a listed file no longer matches, so a fix cannot
// silently leave a stale entry behind. A new file appearing in neither is a regression.
const GRANDFATHERED = new Set([...REVIEWED_BENIGN, ...BLOCKED_ON_CLIENT_TZ]);

const root = path.join(__dirname, '..');
const PATTERN = /\.toLocale(?:Date|Time)String\s*\(/;
const offenders = new Map();

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '__tests__', '.next', 'dist'].includes(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (EXEMPT_PREFIXES.some(p => rel.startsWith(p))) continue;

    const lines = stripComments(fs.readFileSync(full, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (!PATTERN.test(line)) return;
      // The option object can span lines; scan a small window for an explicit timeZone.
      const window = lines.slice(i, i + 6).join('\n');
      if (/timeZone\s*:/.test(window)) return;
      if (!offenders.has(rel)) offenders.set(rel, []);
      offenders.get(rel).push(i + 1);
    });
  }
}

for (const top of ['app', 'components', 'lib', 'packages']) {
  const dir = path.join(root, top);
  if (fs.existsSync(dir)) walk(dir);
}

const newOffenders = [...offenders.keys()].filter(f => !GRANDFATHERED.has(f));
const fixed = [...GRANDFATHERED].filter(f => !offenders.has(f));

if (newOffenders.length > 0) {
  console.error('toLocaleDateString/toLocaleTimeString without an explicit `timeZone` — this renders in the DEVICE timezone, not the user\'s (CLAUDE.md: Timezone).');
  console.error('Use formatTimeOfDay/formatInTimeZone from @trainingai/shared/date-utils, or pass { timeZone }:');
  for (const f of newOffenders) console.error(`  ${f}: line(s) ${offenders.get(f).join(', ')}`);
  process.exit(1);
}

if (fixed.length > 0) {
  console.error('These files no longer call toLocale*String without a timeZone — remove them from GRANDFATHERED in this script so they stay fixed:');
  for (const f of fixed) console.error(`  ${f}`);
  process.exit(1);
}

console.log(
  `check-timezone-rendering: no new device-local date/time rendering ` +
  `(${REVIEWED_BENIGN.size} triaged benign, ${BLOCKED_ON_CLIENT_TZ.size} real but blocked on client-side timezone access — Q-148).`,
);
