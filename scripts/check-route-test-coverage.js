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

const root = path.join(__dirname, '..');
const BASELINE = 141;

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

const testBlob = ['lib', 'app', 'packages', 'components', 'e2e', 'scripts']
  .filter(d => fs.existsSync(path.join(root, d)))
  .flatMap(d => walk(path.join(root, d)))
  .filter(p => /\.(test|spec)\.tsx?$/.test(p))
  .map(p => fs.readFileSync(p, 'utf8'))
  .join('\n');

const uncovered = routes.filter(r => !testBlob.includes(`app/api/${r}/route`));

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
