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
//
// **A count cannot see a swap, and that is what the set comparison below is for (LA-81).** Covering
// five routes while un-covering three nets to a two-route improvement, so the number falls and the
// check says OK. That is not hypothetical: a new test file was written to a path that already held
// one (`lib/__tests__/home-aggregate-routes.test.ts`), destroying the tests for `calendar-data`,
// `training-load` and `muscle-recovery`. The count went 87 → 85 and nothing in CI said a word; only
// diffing the two uncovered lists by hand showed three routes had gone backwards.
//
// So the number is no longer the only question. The scan also runs over the merge base and fails on
// any route that was covered there and is not covered here — whatever the total does. Deleting a
// test on purpose then has to say so, by naming the route in the same PR.
//
// **This half degrades the opposite way from the size ratchets, and that is worth knowing.** They
// fall back to a plain absolute comparison when no base resolves, which is STRICTER than the
// base-aware one. This one has nothing to fall back to: no base means no comparison, so it simply
// does not run. CI fetches `origin main` at depth 1 before this step, which is enough for
// `git archive` — but a fetch that fails leaves the count as the only gate, exactly as before.

const fs = require('fs');
const path = require('path');
const { stripComments } = require('./lib/strip-comments');
const { resolveBaseRef, materialiseBaseTree, cleanupBaseTree } = require('./lib/base-ref');
const { lostRouteCoverage } = require('./lib/coverage-regression');

const root = path.join(__dirname, '..');
/** Everything the scan reads: the routes themselves, plus every directory tests live in. */
const SCAN_DIRS = ['app', 'lib', 'packages', 'components', 'e2e', 'scripts'];
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
const BASELINE = 27;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}


// Every module specifier a test imports, with the `import type` ones dropped. Covers
// `from '…'`, `import('…')` and `require('…')`; the `type` group is what tells a real handler
// import from a test that only wanted a response type.
const SPECIFIER = /(?:^|\n)\s*import\s+(?<type>type\s+)?[^;'"]*?from\s*['"](?<from>[^'"]+)['"]|\bimport\s*\(\s*['"](?<dyn>[^'"]+)['"]\s*\)|\brequire\s*\(\s*['"](?<req>[^'"]+)['"]\s*\)/g;

/** The route a specifier names, or null. Resolves a RELATIVE specifier against the importing file
 *  rather than matching a string — `await import('../route')` from a route's own `__tests__/` is
 *  the single most common shape on this list and the substring rule could never see it. */
function routeFor(spec, fromFile, treeRoot, apiRoot) {
  const abs = spec.startsWith('.')
    ? path.resolve(path.dirname(fromFile), spec)
    : spec.startsWith('@/') ? path.join(treeRoot, spec.slice(2))
    : spec.startsWith('app/') ? path.join(treeRoot, spec)
    : null;
  if (!abs) return null;
  const rel = path.relative(apiRoot, abs).split(path.sep).join('/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const m = rel.match(/^(.*)\/route(?:\.tsx?)?$/);
  return m ? m[1] : null;
}

/** The whole scan, as a function of a tree root — so the identical rule answers for the merge base
 *  as well as for the working tree, which is the only way the two lists are comparable. */
function scan(treeRoot) {
  const apiRoot = path.join(treeRoot, 'app', 'api');
  if (!fs.existsSync(apiRoot)) return null;

  const routes = walk(apiRoot)
    .filter(p => path.basename(p) === 'route.ts')
    .map(p => path.relative(apiRoot, path.dirname(p)).split(path.sep).join('/'))
    .sort();

  const testFiles = SCAN_DIRS
    .filter(d => fs.existsSync(path.join(treeRoot, d)))
    .flatMap(d => walk(path.join(treeRoot, d)))
    .filter(p => /\.(test|spec)\.tsx?$/.test(p));

  const covered = new Set();
  for (const file of testFiles) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (const m of src.matchAll(SPECIFIER)) {
      const g = m.groups;
      // A type-only import is not a test of the handler — it is a test that wanted its response
      // type. Counting it is how `day-review/week-window` left this list while its own real handler
      // test stayed invisible (Q-112d): the signal pointed the wrong way in both directions at once.
      if (g.from && g.type) continue;
      const r = routeFor(g.from ?? g.dyn ?? g.req, file, treeRoot, apiRoot);
      if (r) covered.add(r);
    }
  }
  return { routes, covered, uncovered: routes.filter(r => !covered.has(r)) };
}

const { routes, covered, uncovered } = scan(root);

// The set comparison. A route only counts as a regression when it still EXISTS here — a deleted
// route is not an uncovered one — and a missing base is not a violation, it is a question we
// cannot answer, so the count check below stands alone.
const baseRef = resolveBaseRef();
const baseDir = materialiseBaseTree(baseRef, SCAN_DIRS);
let lostCoverage = [];
// Whether the base half actually ran, so a clean line is never mistaken for both halves passing —
// the same reason `check-cache-ttl-divergence.js` prints how many sites it had to skip.
let baseNote = 'no base resolved, count only';
try {
  const base = baseDir ? scan(baseDir) : null;
  if (base) baseNote = `base comparison ran against ${baseRef}`;
  lostCoverage = lostRouteCoverage({ routes, covered, baseCovered: base ? base.covered : null });
} finally {
  cleanupBaseTree(baseDir);
}

if (lostCoverage.length > 0) {
  console.error('Route test coverage check failed:\n');
  console.error(`  • ${lostCoverage.length} route${lostCoverage.length === 1 ? '' : 's'} had a test importing the handler on the base branch and`);
  console.error('    no longer do. The total is not the question here — covering new routes while');
  console.error('    un-covering these still leaves them untested, and a count nets the two out.\n');
  for (const r of lostCoverage) console.error(`      ${r}`);
  console.error('\n      Usually a test file was overwritten rather than added: check whether the path you');
  console.error('      wrote to already held a test. If a test was removed deliberately, say so in the PR');
  console.error('      — this check has no baseline to raise, by design.');
  process.exit(1);
}

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
    `${BASELINE - uncovered.length} below the ${BASELINE} baseline (${baseNote}). Lower BASELINE ` +
    `to ${uncovered.length} in this PR, or the list can regrow into the slack unnoticed.`,
  );
  process.exit(1);
}

console.log(
  `check-route-test-coverage: OK — ${uncovered.length} of ${routes.length} uncovered ` +
  `(baseline held; ${baseNote}).`,
);
