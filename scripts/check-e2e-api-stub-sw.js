#!/usr/bin/env node
//
// An e2e spec that stubs an `/api/` route must block the service worker.
//
// `public/sw-template.js` re-issues EVERY `/api/` request — no method filter — so once the worker
// has claimed the page the request comes from the worker, and Playwright's own types say route
// "will not intercept requests intercepted by Service Worker" (1.62.1, types.d.ts:10184). The
// worker calls `skipWaiting()` then `clients.claim()`, so control arrives mid-page-life rather than
// on the next navigation: whether a given fetch is stubbed or hits the real route is a RACE.
//
// That is why the failure looks like a flake with no cause in the diff. Measured on
// `food-row-shared.spec.ts` (PS-14): fail → pass → fail across three CI runs on a Bluetooth branch
// that touches no nutrition file, while eight consecutive local runs passed. Reproduced directly:
// a page-context fetch before the claim reaches the stub, the identical fetch after the claim does
// not and the real route answers.
//
// `e2e/README.md` has stated this rule since `recipe-url-to-meal.spec.ts` hit it. Prose did not
// hold it — three specs were written against it afterwards, two of them on the day PS-14 was filed
// by a session that had the entry open. Hence a check.
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'e2e');

// A stub of an app API route. `**/api/…` is the only shape used here; a bare `/api/` glob would
// also match the external hosts specs stub (openfoodfacts, etc.), which the worker never re-issues
// because they are not same-origin.
const API_STUB = /\.route\(\s*['"`][^'"`]*\*\*\/api\//;
const GUARD = /serviceWorkers:\s*['"`]block['"`]/;

const offenders = [];
let stubbing = 0;

for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.spec.ts')) continue;
  const src = fs.readFileSync(path.join(dir, name), 'utf8');
  if (!API_STUB.test(src)) continue;
  stubbing++;
  if (!GUARD.test(src)) offenders.push(name);
}

if (offenders.length > 0) {
  console.error('e2e specs stub an /api route without blocking the service worker:\n');
  for (const o of offenders) console.error(`  • e2e/${o}`);
  console.error(`
  The service worker re-issues every /api/ request, and Playwright cannot intercept a
  service-worker fetch — so the stub applies or not depending on whether the worker has
  claimed the page yet. The spec passes locally and fails on CI sometimes, with the REAL
  route answering in the server log.

  Add this above the tests, as five other specs already do:

    test.use({ serviceWorkers: 'block' })

  Combine it with an existing test.use if the file has one (see card-429-error-state.spec.ts).`)
  process.exit(1);
}

console.log(`check-e2e-api-stub-sw: OK — ${stubbing} spec(s) stub an /api route, all block the service worker.`);
