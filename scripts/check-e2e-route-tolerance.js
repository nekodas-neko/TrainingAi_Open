#!/usr/bin/env node
// A `page.route` handler that calls `route.fetch()` is doing a real network round trip, so the page
// can fire a request the handler is still serving when Playwright tears the test's context down.
// The rejection that produces — `route.fetch: Test ended.` — is reported OUTSIDE any test, which is
// what made it expensive: the shard prints `74 expected · 0 unexpected · ok: true` and exits 1
// anyway, under `1 error was not a part of any test`.
//
// Because E2E is advisory here, that took `E2E shard 4` red on FOUR consecutive PRs (runs
// 36594986970, 36598412525, 36602819608, 36604843800) and blocked none of them; and because the
// error names no test, it reads as CI infrastructure rather than as a spec. The standing suspicion
// was `LB-149`'s browser death, which it is not — the browser was healthy and 74 tests passed.
//
// `tolerateTestEnd` (e2e/fixtures.ts) swallows exactly the end-of-test rejections and rethrows
// everything else. Playwright's own hint, `page.unrouteAll({ behavior: 'ignoreErrors' })`, is
// per-test and has to be remembered at every exit path including a failing assertion — which is a
// rule policed by memory, and this file exists because that is policed by nothing.
'use strict';
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./lib/strip-comments');

const E2E_DIR = path.join(__dirname, '..', 'e2e');
const ROUTE_CALL = 'page.route(';

/** The handler body: from the `=> {` that opens it to its matching brace. */
function handlerBody(source, routeCallIndex) {
  const arrow = source.indexOf('=> {', routeCallIndex);
  if (arrow < 0) return null;
  let depth = 0;
  for (let i = source.indexOf('{', arrow); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(routeCallIndex, i);
  }
  return source.slice(routeCallIndex);
}

const offenders = [];
for (const file of fs.readdirSync(E2E_DIR).filter(f => f.endsWith('.ts'))) {
  const full = path.join(E2E_DIR, file);
  const source = stripComments(fs.readFileSync(full, 'utf8'));
  for (let at = source.indexOf(ROUTE_CALL); at >= 0; at = source.indexOf(ROUTE_CALL, at + 1)) {
    const body = handlerBody(source, at);
    if (!body || !/\b[A-Za-z_$][\w$]*\.fetch\(/.test(body)) continue;
    // The wrapper sits between `page.route(` and the handler's arrow, so a match anywhere in the
    // slice before the body would also accept a nested one — check only the call's argument list.
    const head = body.slice(0, body.indexOf('=> {'));
    if (head.includes('tolerateTestEnd(')) continue;
    offenders.push(`e2e/${file}:${source.slice(0, at).split('\n').length}`);
  }
}

if (offenders.length > 0) {
  console.error('A page.route handler calls route.fetch() without tolerateTestEnd().');
  console.error('');
  console.error('A request still in flight when the test ends rejects OUTSIDE any test, so the');
  console.error('shard exits 1 with zero failed tests and the error names no spec. Wrap the');
  console.error("handler: page.route(pred, tolerateTestEnd(async r => { … })) — see e2e/fixtures.ts.");
  console.error('');
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log(`check-e2e-route-tolerance: every page.route handler that fetches is wrapped.`);
