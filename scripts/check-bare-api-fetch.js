#!/usr/bin/env node
// LB-155. CLAUDE.md: "Client GETs of /api/* use cachedFetch with a readCacheSync seed, never bare
// fetch." That rule was prose only, and prose lost: measured 2026-09-25 it had **68 live
// violations**, and both entries that cited it (RV-79, LB-154) were filed as though their one site
// were exceptional, because nobody had counted.
//
// A rule with 68 violations and no written carve-out cannot be enforced, and that is the actual
// defect — not any individual call. Roughly half the population SHOULD stay a bare fetch, so a ban
// would be wrong and a silent prose rule is worse. This makes both halves explicit:
//
//   * EXEMPT_ENDPOINTS — routes where a cached read is incorrect, keyed by ENDPOINT rather than by
//     file:line, because the reason belongs to the route and line numbers drift.
//   * DEBUG_DIRS — the BLE and admin consoles, exempt wholesale on the precedent CLAUDE.md already
//     sets for them under the timezone rule: device-local/live is the useful reading when you are
//     holding the device.
//   * BASELINE — every remaining file at its current count, shrink-only. A new bare fetch in a file
//     not listed is a failure; converting one lowers the number here in the same PR.
//
// ⚠ The counting has two traps, both of which produced a wrong published figure before this script
// existed. A call site may be `fetch<T>(…)`-free but the URL argument spans lines, so the whole
// brace-balanced call has to be read rather than the line. And a mutation can declare its method as
// the SHORTHAND `{ method, headers }` with no colon — that slipped one POST through as a GET and put
// "69" into three merged documents.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SELF = 'scripts/check-bare-api-fetch.js';

const EXEMPT_ENDPOINTS = new Map([
  ['/api/version', 'the update check — a cached read defeats the point, and this is the one route deliberately exempt from the private,no-store rule'],
  ['/api/colmi/status', 'live pairing state read while the user is holding the ring; already passes cache: no-store'],
  ['/api/scale-ble/pending', 'live pairing handshake — a cached answer would hang the pairing flow'],
  ['/api/scale-ble/today', 'live pairing handshake, same as above'],
  ['/api/sync/pull', 'the sync engine itself; caching a delta is a correctness bug, not a staleness one'],
  ['/api/oura-ble/rollup-state', 'device rollup state during a sync; already passes cache: no-store'],
  ['/api/exercise-library', 'builder-review reads past the cache immediately after an edit; already passes cache: no-store'],
  ['/api/ai-periodization/session/', 'conditionally no-store right after a write, which is the case the cache cannot serve'],
]);

const DEBUG_DIRS = [
  ['components/oura-ble/', 'BLE debug console — live is the useful reading while holding the device (CLAUDE.md sets this same carve-out for the timezone rule)'],
  ['components/admin/', 'admin console — same reasoning'],
  ['app/admin/', 'admin console — same reasoning'],
];

const BASELINE = {
  // PER-QUERY reads. A cache key for these has to carry the query, so converting them is a design
  // choice about key shape rather than a straight swap — and a search-as-you-type key would churn
  // the cache for no benefit. These are the weakest candidates, listed first so nobody starts here.
  'app/coach/coach-content.tsx': 1,                               // threads?threadId=
  'app/session-explain/components/ai-insight-card.tsx': 1,        // insight?sessionId=
  'components/nutrition/capture-actions.tsx': 1,                  // barcode?code=
  'components/nutrition/food-list.tsx': 1,                        // food-items?q=
  'components/nutrition/ingredient-picker.tsx': 2,                // food-items?q= + barcode?code=
  'lib/hooks/use-food-database-search.ts': 1,                     // food-search?q=

  // DUPLICATED ENDPOINTS — the strongest candidates. The same route is read from several places, so
  // one cache key would serve all of them and in some cases a key for it already exists elsewhere.
  'app/session-select/session-select-content.tsx': 1,             // day-checkin  (1 of 3)
  'components/morning-checkin-sheet.tsx': 1,                      // day-checkin  (2 of 3)
  'components/nutrition/end-of-day/end-of-day-review.tsx': 1,     // day-checkin  (3 of 3, evening)
  'components/config-screen.tsx': 4,                              // phase-sets x2 + workout-templates x2
  'lib/day-review-reminders.ts': 1,                               // bedtime-estimate (1 of 2)
  'lib/meal-reminders.ts': 1,                                     // bedtime-estimate (2 of 2)

  // SINGLE-SITE candidates.
  'app/nutrition/use-food-logs-loader.ts': 1,                     // food-logs?date=
  'app/nutrition/use-plan-meal-logging.ts': 1,                    // plan-meal-answers?date=
  'components/activity/done-activity-screen.tsx': 2,              // oura/hr-window x2
  'components/nutrition/meal-plan-edit-sheet.tsx': 1,             // meal-plans/:id
  'components/nutrition/meal-plan-setup-sheet.tsx': 1,            // dietary-restrictions
  'components/workout-screen.tsx': 2,                             // achievements + exercise-history?name=
};

function bareApiGets(src) {
  const out = [];
  const re = /(?<![.\w])fetch\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    let d = 1, j = m.index + m[0].length;
    while (j < src.length && d > 0) { const c = src[j]; if (c === '(') d++; else if (c === ')') d--; j++; }
    const call = src.slice(m.index, j);
    const url = /['"`]([^'"`]*\/api\/[^'"`]*)['"`]/.exec(call);
    if (!url) continue;
    if (/method\s*:/.test(call) || /\{\s*method\s*[,}]/.test(call)) continue;   // both traps
    out.push({ url: url[1], line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

// Exported so the parser can be tested against the two traps directly, rather than only through a
// whole-repo run whose number nobody can check by hand.
module.exports = { bareApiGets };

if (require.main !== module) return;

const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(ts|tsx)$/.test(f)
    && f !== SELF
    && !f.includes('__tests__')
    && !f.startsWith('app/api/')
    && !f.startsWith('e2e/')
    && !f.startsWith('scripts/'));

const counts = {};
let exemptCount = 0, debugCount = 0, total = 0;
for (const f of files) {
  let src;
  try { src = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  if (!src.includes('/api/')) continue;
  for (const hit of bareApiGets(src)) {
    total++;
    const debug = DEBUG_DIRS.find(([d]) => f.startsWith(d));
    if (debug) { debugCount++; continue; }
    if ([...EXEMPT_ENDPOINTS.keys()].some((e) => hit.url.includes(e))) { exemptCount++; continue; }
    counts[f] = (counts[f] || 0) + 1;
  }
}

// A parse that silently stops finding anything would report a clean rule while checking nothing.
if (total === 0) {
  console.error('check-bare-api-fetch: found no fetch() of an /api/ route at all, which cannot be right.');
  console.error('  The call scan is broken — fix it rather than trusting this pass.');
  process.exit(1);
}

const failures = [];
for (const [f, n] of Object.entries(counts)) {
  const allowed = BASELINE[f] ?? 0;
  if (n > allowed) failures.push({ f, n, allowed });
}
const stale = Object.keys(BASELINE).filter((f) => (counts[f] ?? 0) < BASELINE[f]);

if (failures.length || stale.length) {
  if (failures.length) {
    console.error('Bare fetch() of an /api/ GET in client code (CLAUDE.md: use cachedFetch with a readCacheSync seed).');
    console.error('If the route genuinely must not be cached, add its ENDPOINT to EXEMPT_ENDPOINTS here WITH the reason.');
    console.error('⚠ A conversion is not mechanical: cachedFetchCore stores the response after any 2xx, so a route that');
    console.error('  can return null needs `shouldCache` — without it the conversion trades a rule breach for the');
    console.error('  session-167 re-prompt bug (RV-79 proved this).');
    for (const f of failures) {
      console.error(f.allowed === 0
        ? `  ${f.f}: ${f.n} bare /api/ GET(s) — this file had none.`
        : `  ${f.f}: ${f.n} bare /api/ GET(s), baseline ${f.allowed}.`);
    }
  }
  if (stale.length) {
    console.error('Baseline row(s) to lower or delete — these files now carry fewer than recorded:');
    for (const s of stale) console.error(`  ${s}: ${counts[s] ?? 0} now, baseline ${BASELINE[s]}`);
  }
  process.exit(1);
}

const tracked = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`check-bare-api-fetch: ${total} bare /api/ GET(s) — ${debugCount} in debug consoles, `
  + `${exemptCount} on exempt endpoints, ${tracked} tracked across ${Object.keys(BASELINE).length} baselined file(s).`);
