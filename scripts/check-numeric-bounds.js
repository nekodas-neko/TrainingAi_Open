#!/usr/bin/env node
// A `z.number()` in a validation schema with no `.max()` accepts any magnitude. That is not
// theoretical: on 2026-08-09 a `POST /api/activity-logs` with `durationMin: 100000` returned 201 and
// persisted a single walk lasting 69.4 days (Q-164). Every aggregate that sums such a field is
// corruptible by one typo — and the *plausible* typo is the dangerous one, because 1000-for-100
// inflates a week while looking entirely normal.
//
// The project already solves this well: `validation/body-metrics.ts` uses
// `z.number().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX)` — bounded, with named constants. Bounds should
// come from physiology, not round numbers.
'use strict';
const fs = require('fs');
const path = require('path');

// Every unbounded numeric found on 2026-08-09 sits in ONE file. That is the useful shape of this
// finding: it is a single file that missed a pattern the rest of the surface follows, not a
// systemic gap. Grandfathered by file so the check still guards every other schema from acquiring
// one, and so the burn-down is a single focused PR.
//
// This list may only shrink. When `activity-log.ts` is bounded, delete the entry — the check then
// holds it to the same standard as everything else.
// Empty, and that is the point: activity-log.ts was bounded in full (Q-164, 2026-08-09), so every
// schema file in validation/ + validators/ is now held to the same standard with no exceptions.
const GRANDFATHERED_FILES = new Set([]);

const root = path.join(__dirname, '..');
const DIRS = ['packages/shared/src/validation', 'packages/shared/src/validators'];
const offenders = new Map();

for (const dir of DIRS) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) continue;
  for (const name of fs.readdirSync(full)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const rel = `${dir}/${name}`;
    const lines = fs.readFileSync(path.join(full, name), 'utf8').split('\n');
    lines.forEach((line, i) => {
      // One line can declare several — `z.object({ km: z.number(), paceSec: z.number() })`. Scanning
      // only the first occurrence undercounts (28 real vs 24 reported when this check was written),
      // so walk every one and read its chain up to where the next begins.
      for (let at = line.indexOf('z.number()'); at !== -1; at = line.indexOf('z.number()', at + 1)) {
        const next = line.indexOf('z.number()', at + 1);
        const chain = line.slice(at, next === -1 ? line.length : next);
        if (chain.includes('.max(')) continue;
        if (!offenders.has(rel)) offenders.set(rel, []);
        offenders.get(rel).push(i + 1);
      }
    });
  }
}

const newOffenders = [...offenders.keys()].filter(f => !GRANDFATHERED_FILES.has(f));
const fixed = [...GRANDFATHERED_FILES].filter(f => !offenders.has(f));

if (newOffenders.length > 0) {
  console.error('Unbounded `z.number()` in a validation schema — no `.max()`, so any magnitude is accepted (Q-164).');
  console.error('Add an upper bound with a named constant, as `validation/body-metrics.ts` does:');
  for (const f of newOffenders) console.error(`  ${f}: line(s) ${offenders.get(f).join(', ')}`);
  process.exit(1);
}

if (fixed.length > 0) {
  console.error('These files no longer contain an unbounded `z.number()` — remove them from GRANDFATHERED_FILES so they stay bounded:');
  for (const f of fixed) console.error(`  ${f}`);
  process.exit(1);
}

const pending = [...GRANDFATHERED_FILES].reduce((n, f) => n + (offenders.get(f)?.length ?? 0), 0);
console.log(`check-numeric-bounds: no new unbounded numerics (${pending} pending in ${GRANDFATHERED_FILES.size} grandfathered file).`);
