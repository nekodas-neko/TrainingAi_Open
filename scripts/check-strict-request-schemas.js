#!/usr/bin/env node
// Q-464 — a request schema that is not `.strict()` silently DROPS an unknown key, so a mistyped or
// renamed field becomes a successful write of the wrong thing rather than a 400 at the boundary.
//
// Measured 2026-08-18 on `POST /api/body-metadata`: `{"date":"2026-08-10","weightKg":81}` answered
// `200 {"success":true}` and wrote the weight on **today**, because the contract's key is
// `localDate` and `date` was dropped. Same for `"3026-08-18"` and `"not-a-date"`.
//
// It is not hypothetical. The Water widget's web fallback posts `{localDate, waterIntake}` to that
// route, `waterIntake` is in no schema, and the value is silently discarded — verified live, the
// row's `water_ml` stays NULL behind a `200 {"success":true}` (Q-319).
//
// Prose would not hold this: the same file already documents the `ai-chat` `localDate` regex that
// rejected every real request for a full release. So this is a ratchet, the same shape as
// check-hex-literals and check-cache-ttl-divergence — each file that has non-strict request schemas
// today is recorded at its count and may only shrink; a file NOT listed must have zero.
//
// EXEMPTIONS ARE NOT BLANKET. Two classes genuinely must stay permissive, and both are listed with
// their reason rather than silently skipped:
//
//   * Schemas parsed by `pushMutations` — outbox payloads are written to local SQLite by whatever
//     bundle was current when the user acted, and sit there until the device next syncs. Tightening
//     one can reject a mutation queued by an older bundle, which dead-letters real data. The backlog
//     entry flagged this for `sync/push`; it applies to EVERY schema the push path parses, which is
//     a wider set than the entry named.
//   * Routes with an external client — `health-connect/ingest` is fed by the owner's Tasker profile,
//     whose exact payload is not in this repo and cannot be checked from here.
//
// Reproduce the count: node scripts/check-strict-request-schemas.js --print
'use strict';
const fs = require('fs');
const path = require('path');
const { resolveBaseRef, countAtBase, verdict } = require('./lib/base-ref');

const ROOTS = ['app/api', 'packages/shared/src/validation'];

// Baseline recorded 2026-08-18 — 89 non-strict request schemas across 63 files. Shrink-only.
// A file that reaches zero should have its row deleted, so it is held to zero from then on.
const BASELINE = {
  'app/api/activity-logs/[id]/metrics/route.ts': 1,
  'app/api/activity-logs/route.ts': 1,
  'app/api/admin/activity-types/route.ts': 1,
  'app/api/admin/ai-usage/route.ts': 1,
  'app/api/admin/exercises/route.ts': 1,
  'app/api/admin/fix-exercise-units/route.ts': 1,
  'app/api/admin/generate-exercise-media/route.ts': 1,
  'app/api/admin/mirror-dataset-gifs/route.ts': 1,
  'app/api/admin/timing-baseline/route.ts': 1,
  'app/api/ai-periodization/baseline/complete/route.ts': 1,
  'app/api/ai-periodization/session/[sessionId]/prescribe/route.ts': 1,
  'app/api/ai-periodization/session/[sessionId]/respond/route.ts': 1,
  'app/api/ai-periodization/session/[sessionId]/transition/route.ts': 1,
  'app/api/ai/health-insight/route.ts': 1,
  'app/api/builder-chat/route.ts': 4,
  'app/api/coach/apply/route.ts': 1,
  'app/api/coach/options/route.ts': 1,
  'app/api/coach/route.ts': 1,
  'app/api/coach/threads/route.ts': 1,
  'app/api/exercise-estimates/route.ts': 1,
  'app/api/exercise-gif/route.ts': 1,
  'app/api/exercises/generate/route.ts': 2,
  'app/api/exercises/route.ts': 1,
  'app/api/fitness-tests/route.ts': 1,
  'app/api/generate-program/route.ts': 3,
  'app/api/hr-ingest/route.ts': 1,
  // Q-495 moved this schema out of the route so it could be unit-tested; the exemption moves with
  // it, for the same reason as before — the Tasker payload's exact shape is not in this repo.
  'packages/shared/src/validation/health-connect-ingest.ts': 1,
  'app/api/nutrition-goals/recommend/route.ts': 1,
  'app/api/nutrition/barcode/route.ts': 1,
  'app/api/nutrition/dietary-restrictions/route.ts': 1,
  'app/api/nutrition/meal-plans/[id]/route.ts': 1,
  'app/api/nutrition/meal-plans/[id]/structure/route.ts': 1,
  'app/api/nutrition/meal-plans/generate/meal/route.ts': 4,
  'app/api/nutrition/meal-plans/generate/route.ts': 3,
  'app/api/nutrition/meal-plans/meals/[mealId]/route.ts': 1,
  'app/api/nutrition/meal-plans/route.ts': 3,
  'app/api/nutrition/meal-types/route.ts': 1,
  'app/api/nutrition/plan-meal-answers/route.ts': 2,
  'app/api/nutrition/scan/route.ts': 2,
  'app/api/nutrition/targets/route.ts': 1,
  'app/api/oura-ble/accel-chunks/route.ts': 1,
  'app/api/oura-ble/live-steps/route.ts': 2,
  'app/api/oura-ble/samples/route.ts': 1,
  'app/api/oura-ble/step-counter-export/route.ts': 1,
  'app/api/push/subscribe/route.ts': 1,
  'app/api/running-plan/explain/route.ts': 1,
  'app/api/running-plan/override/route.ts': 1,
  'app/api/running-plan/route.ts': 1,
  'app/api/scale-ble/samples/route.ts': 1,
  'app/api/sync/push/route.ts': 1,
  'app/api/user/goals/route.ts': 1,
  'app/api/user/profile/route.ts': 1,
  'app/api/workout-review/session/[sessionId]/apply/route.ts': 1,
  'app/api/workout-sessions/route.ts': 1,
  'packages/shared/src/validation/activity-log.ts': 6,
  'packages/shared/src/validation/day-checkin.ts': 2,
  'packages/shared/src/validation/fitness-test.ts': 1,
  'packages/shared/src/validation/food-item.ts': 1,
  'packages/shared/src/validation/generated-program.ts': 4,
  'packages/shared/src/validation/mood-log.ts': 1,
  'packages/shared/src/validation/oura-summary.ts': 2,
  'packages/shared/src/validation/prescribed-run.ts': 1,
  'packages/shared/src/validation/session-rpe.ts': 1,
};

function countNonStrict(src) {
  let n = 0, i = 0;
  while ((i = src.indexOf('z.object(', i)) !== -1) {
    let depth = 0, j = i + 'z.object'.length;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) { j++; break } }
    }
    // `.strict()` may be separated by whitespace or a newline from the closing paren.
    if (!/^\s*\.\s*strict\s*\(/.test(src.slice(j, j + 40))) n++;
    i = j;
  }
  return n;
}

function walk(dir, hit) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, hit);
    else if (p.endsWith('.ts') && !p.includes('__tests__')) {
      const n = countNonStrict(fs.readFileSync(p, 'utf8'));
      if (n > 0) hit[p] = n;
    }
  }
}

const found = {};
for (const r of ROOTS) if (fs.existsSync(r)) walk(r, found);

if (process.argv.includes('--print')) {
  console.log(JSON.stringify(found, null, 2));
  process.exit(0);
}

const baseRef = resolveBaseRef();
const failures = [];
const inherited = [];
for (const [file, n] of Object.entries(found)) {
  const limit = BASELINE[file];
  // LA-16 / Q-424: whether THIS BRANCH added one, not whether the file is over. `countNonStrict` is
  // already a pure per-file counter, so the base is that same function over the base's copy.
  const v = verdict({ count: n, limit: limit ?? 0, atBase: countAtBase(baseRef, file, countNonStrict) });
  if (v === 'inherited') {
    inherited.push(`${file}: ${n} non-strict request schema(s) against a baseline of ${limit ?? 0}, but the base branch is already there.`);
  } else if (limit === undefined) {
    failures.push(
      `${file} has ${n} non-strict request schema(s) and is not in the baseline.\n` +
      `      Add .strict() so an unknown key is a 400 instead of a silent drop — or, if this schema\n` +
      `      parses outbox payloads or an external client's body, add a row here WITH the reason.`);
  } else if (n > limit) {
    failures.push(
      `${file} has ${n} non-strict request schema(s), over its baseline of ${limit}.\n` +
      `      Add .strict() to the new one, or raise this file's number here in the same PR.`);
  }
}
for (const file of Object.keys(BASELINE)) {
  if (found[file] === undefined) {
    failures.push(`${file} is in the baseline but now has none — delete its row so it stays at zero.`);
  } else if (found[file] < BASELINE[file]) {
    failures.push(
      `${file} is down to ${found[file]} from ${BASELINE[file]} — lower its number here so the\n` +
      `      improvement is locked in.`);
  }
}

// Reported whether or not the run fails, and never as a failure (Q-424).
if (inherited.length) {
  console.log('check-strict-request-schemas: inherited from the base branch, not caused here:');
  inherited.forEach((f) => console.log('  • ' + f));
}

if (failures.length) {
  console.error('Strict-request-schema check failed:\n');
  for (const f of failures) console.error('  \u2022 ' + f + '\n');
  process.exit(1);
}
const total = Object.values(found).reduce((a, b) => a + b, 0);
console.log(`check-strict-request-schemas: OK \u2014 ${total} non-strict across ${Object.keys(found).length} files (baseline held)`);
