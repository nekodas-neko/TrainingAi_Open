#!/usr/bin/env node
// Q-322 / Q-498 — a route must read its request body through `readJsonLimited`, not bare
// `req.json()`.
//
// `req.json()` buffers the whole body before anything can decide it does not want it. A Zod schema
// afterwards bounds what gets *stored*; it does not bound the transfer or the parse. Measured on
// 2026-08-18: a 20 MB body to `auth/register` and to `health-connect/ingest` was accepted in full —
// 20,000,048 bytes read, buffered and parsed — and then answered 400.
//
// `readJsonLimited` (packages/shared/src/http/request-guards.ts) treats `Content-Length` as a fast
// path and then streams with a real byte counter, cancelling on overflow. Measured against the same
// 20 MB body on a route with a 16 KB cap: cut off at 2,949,120 bytes.
//
// **This is a ratchet, not a sweep.** 104 bare reads across 92 route files remain after the three
// unauthenticated ones were converted, and converting all 92 at once is how a mistake hides in a
// diff nobody can read. So: every file below is baselined at the number of bare reads it has, the
// number may only go DOWN, and a file that is not listed must have none. A route converted to
// `readJsonLimited` lowers its own number in the same PR; a file that reaches zero is removed from
// the list. Q-322 tracks the remaining sweep, and this check is what makes doing it slowly safe.
//
// **What is left is printed by this script on every run and is deliberately NOT written down here.**
// A hand-maintained running total is one more thing to re-edit per slice and get wrong, and it
// conflicts on every parallel merge. The BASELINE below is the worklist; the summary line is the
// score.
//
// Slices so far — 1: the three routes reachable **without a session** (`auth/register`,
// `auth/exchange-mobile-token`, `health-connect/ingest`), deliberately absent from the baseline so
// re-adding a bare read to any of them fails immediately.  2: the offline-first hot paths.
// 3: the credential and admin-write ones.  4: the AI/expensive ones.  5: the device ingest paths
// (`oura-ble/accel-chunks`, `live-steps`, `rekey`, both sample backfills, `samples/pack`,
// `hr-ingest`, `sync-health`).
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// `req.json()` / `request.json()` in any form: awaited, chained with .catch, cast with `as`.
const BARE_JSON = /\b(?:req|request)\s*\.\s*json\s*\(\s*\)/g;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

// Shrink-only. Each number is how many bare reads that file still has.
const BASELINE = {
  'app/api/activity-logs/[id]/metrics/route.ts': 1,
  'app/api/activity-logs/route.ts': 2,
  'app/api/admin/activity-types/route.ts': 2,
  'app/api/admin/db-query/route.ts': 1,
  'app/api/admin/exercises/route.ts': 2,
  'app/api/admin/fix-exercise-units/route.ts': 1,
  'app/api/admin/generate-exercise-media/route.ts': 1,
  'app/api/admin/invites/route.ts': 2,
  'app/api/admin/mirror-dataset-gifs/route.ts': 1,
  'app/api/admin/timing-baseline/route.ts': 1,
  'app/api/admin/users/route.ts': 2,
  'app/api/admin/vacuum/route.ts': 1,
  'app/api/ai-periodization/baseline/complete/route.ts': 1,
  'app/api/ai-periodization/session/[sessionId]/prescribe/route.ts': 1,
  'app/api/ai-periodization/session/[sessionId]/respond/route.ts': 1,
  'app/api/ai-periodization/session/[sessionId]/transition/route.ts': 1,
  'app/api/ai/health-insight/route.ts': 1,
  'app/api/body-metadata/route.ts': 1,
  'app/api/builder-chat/route.ts': 1,
  'app/api/coach/apply/route.ts': 1,
  'app/api/coach/preview/route.ts': 1,
  'app/api/coach/route.ts': 1,
  'app/api/coach/threads/route.ts': 1,
  'app/api/complete-workout/route.ts': 1,
  'app/api/confirm-early-deload/route.ts': 1,
  'app/api/daily-digest/route.ts': 1,
  'app/api/day-checkin/route.ts': 1,
  'app/api/exercise-estimates/route.ts': 1,
  'app/api/exercises/generate/route.ts': 1,
  'app/api/exercises/route.ts': 1,
  'app/api/fitness-tests/route.ts': 2,
  'app/api/food-logging-complete/route.ts': 1,
  'app/api/friends/[id]/route.ts': 1,
  'app/api/friends/route.ts': 1,
  'app/api/generate-program/route.ts': 1,
  'app/api/injuries/[id]/route.ts': 1,
  'app/api/injuries/route.ts': 1,
  'app/api/log-calendar-event/route.ts': 1,
  'app/api/log-exercise/route.ts': 1,
  'app/api/mood/route.ts': 1,
  'app/api/nutrition-goals/[id]/route.ts': 1,
  'app/api/nutrition-goals/recommend/route.ts': 1,
  'app/api/nutrition/dietary-restrictions/route.ts': 1,
  'app/api/nutrition/food-items/route.ts': 1,
  'app/api/nutrition/food-logs/[id]/route.ts': 1,
  'app/api/nutrition/food-logs/route.ts': 1,
  'app/api/nutrition/meal-plans/[id]/route.ts': 1,
  'app/api/nutrition/meal-plans/[id]/structure/route.ts': 1,
  'app/api/nutrition/meal-plans/generate/meal/route.ts': 1,
  'app/api/nutrition/meal-plans/generate/route.ts': 1,
  'app/api/nutrition/meal-plans/meals/[mealId]/route.ts': 1,
  'app/api/nutrition/meal-plans/route.ts': 1,
  'app/api/nutrition/meal-types/[id]/route.ts': 1,
  'app/api/nutrition/meal-types/route.ts': 2,
  'app/api/nutrition/plan-meal-answers/route.ts': 2,
  'app/api/nutrition/saved-meals/[id]/route.ts': 1,
  'app/api/nutrition/saved-meals/route.ts': 1,
  'app/api/nutrition/targets/route.ts': 1,
  'app/api/oura/hr-sync/route.ts': 1,
  'app/api/oura/workouts/route.ts': 1,
  'app/api/phase-sets/[id]/route.ts': 1,
  'app/api/phase-sets/clone/route.ts': 1,
  'app/api/phase-sets/route.ts': 1,
  'app/api/progression-styles/route.ts': 2,
  'app/api/push/subscribe/route.ts': 2,
  'app/api/running-plan/explain/route.ts': 1,
  'app/api/running-plan/override/route.ts': 1,
  'app/api/running-plan/route.ts': 1,
  'app/api/running-plan/runs/[id]/route.ts': 1,
  'app/api/supplements/[id]/route.ts': 1,
  'app/api/supplements/route.ts': 1,
  'app/api/sync/push/route.ts': 1,
  'app/api/user/equipped-title/route.ts': 1,
  'app/api/user/goals/route.ts': 1,
  'app/api/user/password/route.ts': 1,
  'app/api/user/profile/route.ts': 1,
  'app/api/water-log/route.ts': 1,
  'app/api/weekly-digest/route.ts': 1,
  'app/api/workout-entry/route.ts': 2,
  'app/api/workout-review/session/[sessionId]/apply/route.ts': 1,
  'app/api/workout-sessions/route.ts': 1,
  'app/api/workout-sessions/rpe/route.ts': 1,
  'app/api/workout-templates/route.ts': 2,
  'app/api/workout/backfill-set-hr-stats/route.ts': 1,
};

const counts = new Map();
let scanned = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === '__tests__') continue;
      walk(full);
      continue;
    }
    if (e.name !== 'route.ts' && e.name !== 'route.tsx') continue;
    scanned++;
    const rel = path.relative(root, full).split(path.sep).join('/');
    const src = stripComments(fs.readFileSync(full, 'utf8'));
    BARE_JSON.lastIndex = 0;
    const n = [...src.matchAll(BARE_JSON)].length;
    if (n > 0) counts.set(rel, n);
  }
}

walk(path.join(root, 'app', 'api'));

const over = [];
for (const [rel, n] of counts) {
  const limit = BASELINE[rel] ?? 0;
  if (n > limit) over.push({ rel, n, limit });
}
const stale = Object.keys(BASELINE).filter(rel => !counts.has(rel));

if (over.length > 0) {
  console.error('A route reads its request body with bare `req.json()` (Q-322 / Q-498).');
  console.error('That buffers the whole body before anything can refuse it — a Zod schema after the');
  console.error('read bounds what is STORED, not what is transferred and parsed. Use');
  console.error('`readJsonLimited(req, maxBytes)` from @trainingai/shared/http/request-guards and');
  console.error('answer 413 on `too_large`, 400 on `invalid_json`.');
  for (const o of over) console.error(`  ${o.rel}  ${o.n} bare read(s), baseline ${o.limit}`);
  process.exit(1);
}

if (stale.length > 0) {
  console.error('BASELINE lists files that no longer have a bare `req.json()`. The baseline is');
  console.error('shrink-only: remove these entries in the same PR that converted them, or the next');
  console.error('author gets a free allowance they did not earn.');
  for (const rel of stale) console.error(`  ${rel}`);
  process.exit(1);
}

const remaining = [...counts.values()].reduce((a, b) => a + b, 0);
console.log(`check-bounded-request-body: ${scanned} API route file(s); ${remaining} bare req.json() read(s) left across ${counts.size} file(s), none above baseline.`);
