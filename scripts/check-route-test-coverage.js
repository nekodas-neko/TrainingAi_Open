#!/usr/bin/env node
'use strict';
//
// PS-39 — the ratchet the entry asked for: "keep the scan as the ratchet".
//
// **The entry's own number was understated, by the mechanism it half-noticed.** It counted 93 routes
// "referenced by no test in any layer" and observed that `calendar-data`, `training-load` and
// `streak-data` appear only as cache-key strings — which is to say a route counts as covered when a
// test merely mentions its URL. Under that rule a cache-invalidation test covers a route it never
// calls. The honest question is whether anything imports the handler, and by that rule it was **150
// of 222**, not 93. Eight have come off since — `health-connect/ingest`, `client-error`, the home
// aggregates (`training-load`, `calendar-data`, `muscle-recovery`), `colmi/samples`,
// `program-week`, `oura/hr-day` and `oura-ble/samples` — so the number here is 141.
//
// So this counts a route as covered when a test file imports its `route` module. An e2e spec that
// merely navigates a page does not count either: it exercises the route through a browser, which is
// worth having and is not a route-level test of its behaviour.
//
// Shrink-only per the house pattern (check-hex-literals, check-fetch-once-effects): the baseline is
// a count, a route leaving the list may never rejoin it, and a NEW route arrives uncovered and
// therefore fails. That last part is the point — the 141 are debt, and the ratchet is about the
// 142nd.

const fs = require('fs');
const path = require('path');
const { stripComments } = require('./lib/strip-comments');

const root = path.join(__dirname, '..');
// **The rule was wrong in BOTH directions, and the errors nearly cancelled** (measured 2026-09-08).
// It used to ask whether any test file *contained the substring* `app/api/<route>/route`. Q-112d
// spotted half of that: a **relative** import never produces the substring, so a route whose own
// `__tests__/` loads the handler as `await import('../route')` read as untested. Correct, and it
// affects **13** routes — `sync/push`, `sync/pull`, `body-battery`, `ai/health-insight` among them.
//
// What that reading missed is the opposite error, which is the same size: a substring is not an
// import. **12 routes counted as COVERED because a test merely mentioned the path** — almost always
// `import type { Response } from '@/app/api/<route>/route'`, which borrows a type and calls nothing.
// `workout-data`, `nutrition/energy-balance` and `weekly-digest` were all believed tested and are
// not.
//
// So the honest number was **139**, not the ~126 predicted from the false negatives alone: 140 − 13
// + 12. The old count was accidentally close to right for two wrong reasons.
//
// **139 → 131**: eight of the routes the correction exposed now have real tests —
// `scale-ble/pending/[id]/{confirm,dismiss}`, `nutrition/energy-balance`,
// `session-explain/insight`, `running-plan/explain`, `nutrition/saved-meals/[id]` and
// `nutrition/meal-plans/generate/meal` and `weekly-digest`. Chosen because the gap between belief
// and reality was widest there, not because they were easiest.
//
// This resolves the specifier instead. A relative one resolves against the importing file; an alias
// or bare one resolves against the repo root; a type-only import does not count at all.
//
const BASELINE = 116;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const apiRoot = path.join(root, 'app', 'api');
const routes = walk(apiRoot)
  .filter(p => path.basename(p) === 'route.ts')
  .map(p => path.relative(apiRoot, path.dirname(p)).split(path.sep).join('/'))
  .sort();

const testFiles = ['lib', 'app', 'packages', 'components', 'e2e', 'scripts']
  .filter(d => fs.existsSync(path.join(root, d)))
  .flatMap(d => walk(path.join(root, d)))
  .filter(p => /\.(test|spec)\.tsx?$/.test(p));

// Every module specifier a test imports, with the `import type` ones dropped. Covers
// `from '…'`, `import('…')` and `require('…')`; the `type` group is what tells a real handler
// import from a test that only wanted a response type.
const SPECIFIER = /(?:^|\n)\s*import\s+(?<type>type\s+)?[^;'"]*?from\s*['"](?<from>[^'"]+)['"]|\bimport\s*\(\s*['"](?<dyn>[^'"]+)['"]\s*\)|\brequire\s*\(\s*['"](?<req>[^'"]+)['"]\s*\)/g;

/** The route a specifier names, or null. Resolves a RELATIVE specifier against the importing file
 *  rather than matching a string — `await import('../route')` from a route's own `__tests__/` is
 *  the single most common shape on this list and the substring rule could never see it. */
function routeFor(spec, fromFile) {
  const abs = spec.startsWith('.')
    ? path.resolve(path.dirname(fromFile), spec)
    : spec.startsWith('@/') ? path.join(root, spec.slice(2))
    : spec.startsWith('app/') ? path.join(root, spec)
    : null;
  if (!abs) return null;
  const rel = path.relative(apiRoot, abs).split(path.sep).join('/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const m = rel.match(/^(.*)\/route(?:\.tsx?)?$/);
  return m ? m[1] : null;
}

const covered = new Set();
for (const file of testFiles) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  for (const m of src.matchAll(SPECIFIER)) {
    const g = m.groups;
    // A type-only import is not a test of the handler — it is a test that wanted its response
    // type. Counting it is how `day-review/week-window` left this list while its own real handler
    // test stayed invisible (Q-112d): the signal pointed the wrong way in both directions at once.
    if (g.from && g.type) continue;
    const r = routeFor(g.from ?? g.dyn ?? g.req, file);
    if (r) covered.add(r);
  }
}

const uncovered = routes.filter(r => !covered.has(r));

if (uncovered.length > BASELINE) {
  const added = uncovered.length - BASELINE;
  console.error('Route test coverage check failed:\n');
  console.error(`  • ${uncovered.length} of ${routes.length} API routes have no test importing their handler,`);
  console.error(`    ${added} more than the ${BASELINE}-route baseline.\n`);
  console.error('      A new route needs a test that imports its handler and calls it — mock `@/auth` and');
  console.error('      `@/lib/data` the way `lib/__tests__/collection-route.test.ts` does. If you removed a');
  console.error("      route's test, restore it rather than raising the number: this list only shrinks.\n");
  console.error('  Uncovered routes:');
  for (const r of uncovered) console.error(`      ${r}`);
  process.exit(1);
}

if (uncovered.length < BASELINE) {
  console.log(
    `check-route-test-coverage: OK — ${uncovered.length} of ${routes.length} uncovered, ` +
    `${BASELINE - uncovered.length} below the ${BASELINE} baseline. Lower BASELINE to ` +
    `${uncovered.length} in this PR, or the list can regrow into the slack unnoticed.`,
  );
  process.exit(1);
}

console.log(`check-route-test-coverage: OK — ${uncovered.length} of ${routes.length} uncovered (baseline held).`);
