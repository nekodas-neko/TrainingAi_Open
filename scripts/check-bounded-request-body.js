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
// **It was a ratchet; the sweep finished, so it is now a flat rule: no route file may contain a bare
// read at all.** It began at 104 bare reads across 92 route files and came down in nine slices, the
// last of which emptied the list — converting all 104 at once is how a mistake hides in a diff
// nobody can read. The per-file BASELINE and its shrink-only bookkeeping are gone with the debt they
// tracked; re-introducing a bare read now fails on the first one rather than against an allowance.
//
// If a future route genuinely cannot use `readJsonLimited`, do not add a baseline back — say why in
// an EXEMPT entry beside the reason, the way the sibling checks do. A number with no reason attached
// is what lets the count drift back up.
//
// Slices so far — 1: the three routes reachable **without a session** (`auth/register`,
// `auth/exchange-mobile-token`, `health-connect/ingest`), deliberately absent from the baseline so
// re-adding a bare read to any of them fails immediately.  2: the offline-first hot paths.
// 3: the credential and admin-write ones.  4: the AI/expensive ones.  5: the device ingest paths.
// 6: the workout and activity write routes.
// 7: the nutrition CRUD routes.
// 8: every remaining admin route.
// 9: everything the numbered slices left over — the periodization, running-plan, phase-set,
// progression-style, friends, injuries, supplements, digest, mood and calendar routes.
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

// Route files allowed a bare read, each with the reason. Empty, and it should stay that way — an
// entry here is a route whose body cannot be bounded, which is a claim that needs defending.
const EXEMPT = new Map([
]);

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

const offenders = [...counts].filter(([rel]) => !EXEMPT.has(rel));
const staleExempt = [...EXEMPT.keys()].filter(rel => !counts.has(rel));

if (offenders.length > 0) {
  console.error('A route reads its request body with bare `req.json()` (Q-322 / Q-498).');
  console.error('That buffers the whole body before anything can refuse it — a Zod schema after the');
  console.error('read bounds what is STORED, not what is transferred and parsed. Use');
  console.error('`readJsonLimited(req, maxBytes)` from @trainingai/shared/http/request-guards and');
  console.error('answer 413 on `too_large`, 400 on `invalid_json`. Every one of the 210 route files');
  console.error('already does; this one would be the first back.');
  for (const [rel, n] of offenders) console.error(`  ${rel}  ${n} bare read(s)`);
  process.exit(1);
}

if (staleExempt.length > 0) {
  console.error('EXEMPT names files that no longer have a bare `req.json()` — drop the entry in the');
  console.error('same PR that converted them, so the exemption cannot outlive its reason.');
  for (const rel of staleExempt) console.error(`  ${rel}`);
  process.exit(1);
}

console.log(`check-bounded-request-body: ${scanned} API route file(s); no bare req.json() reads${EXEMPT.size ? `, ${EXEMPT.size} exempt` : ''}.`);
