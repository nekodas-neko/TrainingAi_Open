#!/usr/bin/env node
// Q-482 — a dynamic `[id]` route must validate its id before it reaches the repository.
//
// Postgres rejects a non-UUID cast with `22P02 invalid_text_representation`, which surfaces as a
// **500** on a request that is plainly a 400. Measured 2026-08-18 across all 30 dynamic route files,
// every method, called twice — once with a well-formed-but-nonexistent UUID (the control) and once
// with `not-a-uuid`: **21 route/method pairs answered 5xx** while answering the control correctly.
// That control is what makes it a missing input guard rather than a broken route.
//
// Not a security hole: a malformed id cannot read anyone's data, because Postgres refuses the cast
// before any row is touched and every route is `auth()`-scoped. Production showed zero `22P02` rows,
// so it had never been served. It is an error-shape gap with a cheap shared fix — which is exactly
// the kind that grows back unless something checks.
//
// The rule: **every `const { x } = await params` in `app/api/**` is followed by a guard on that
// binding.** `invalidUuidResponse(x)` from `lib/api/route-errors.ts` is the shared one; a route that
// validates its own way is fine as long as the binding is checked before use — see ACCEPTS below.
//
// **The rule is "guarded", not "is a UUID" — BF-53 is what happens when those are conflated.** Two
// routes key on a `bigserial` (`scale_raw_samples.id`), and the sweep that closed Q-482 gave them
// the UUID guard anyway. A decimal id can never match a UUID regex, so both returned `400 Invalid
// id` to **every real request** and the pending weigh-in triage was dead in production. Their
// correct `Number.isInteger` check sat unreachable on the next line. `numericRouteId(x)` is the
// shared guard for that case and is accepted below; the failure message names both, because the
// message is what the next sweep will actually read.
//
// This has **no baseline**, deliberately. All 39 destructures across 29 dynamic route files (every one but the NextAuth
// catch-all) were converted in the same PR, so there is nothing to grandfather and a new route
// cannot inherit an allowance.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// `const { id } = await params` / `const { sessionId: programSessionId } = await params`
const DESTRUCTURE = /const \{\s*(\w+)(?:\s*:\s*(\w+))?\s*\}\s*=\s*await params/g;

// What counts as guarding `name`: a shared helper, or a route's own explicit check. Which helper
// depends on the COLUMN — `numericRouteId` for a `bigserial` key, the UUID ones for a `uuid` key.
// Applying the wrong one is not a weaker guard, it is a 400 for every request (BF-53).
const ACCEPTS = (name) => [
  new RegExp(`invalidUuidResponse\\(\\s*${name}\\s*\\)`),
  new RegExp(`isUuid\\(\\s*${name}\\s*\\)`),
  new RegExp(`uuid\\(\\)\\.safeParse\\(\\s*${name}\\s*\\)`),
  new RegExp(`numericRouteId\\(\\s*${name}\\s*\\)`),
];

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

const failures = [];
let scanned = 0;
let guarded = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === '__tests__') continue;
      // The NextAuth catch-all takes no id of ours.
      if (e.name.startsWith('[...')) continue;
      walk(full);
      continue;
    }
    if (e.name !== 'route.ts' && e.name !== 'route.tsx') continue;
    const rel = path.relative(root, full).split(path.sep).join('/');
    const src = stripComments(fs.readFileSync(full, 'utf8'));
    // Scoped to the handler, not the file. A file with two verbs has two destructures of the same
    // name, and searching the whole source lets one verb's guard vouch for the other's — which is
    // exactly what a route grows into when a method is added later. Verified by removing one of
    // two guards from a file and watching this go red.
    const HANDLER_START = /export\s+(?:async\s+)?function\s+[A-Z]+\s*\(/g;
    HANDLER_START.lastIndex = 0;
    const bounds = [...src.matchAll(HANDLER_START)].map(h => h.index);
    const endOfHandler = (from) => {
      const next = bounds.find(b => b > from);
      return next === undefined ? src.length : next;
    };

    DESTRUCTURE.lastIndex = 0;
    for (const m of src.matchAll(DESTRUCTURE)) {
      const name = m[2] || m[1];
      scanned++;
      const scope = src.slice(m.index, endOfHandler(m.index));
      if (ACCEPTS(name).some(re => re.test(scope))) { guarded++; continue; }
      failures.push({ rel, line: src.slice(0, m.index).split('\n').length, name });
    }
  }
}

walk(path.join(root, 'app', 'api'));

if (failures.length > 0) {
  console.error('A dynamic route uses a path param without guarding it (Q-482).');
  console.error('Postgres rejects a bad cast with 22P02 and the route answers 500 for what is a 400.');
  console.error('Add, right after the destructure — CHECK THE COLUMN FIRST (BF-53):');
  console.error('  uuid key:      const badId = invalidUuidResponse(<name>); if (badId) return badId');
  console.error('  bigserial key: const p = numericRouteId(<name>); if (!p.ok) return p.response');
  console.error("both from '@/lib/api/route-errors'. The UUID guard on a numeric key is a 400 for");
  console.error('EVERY real request, not a stricter check — that is how BF-53 shipped dead.');
  for (const f of failures) console.error(`  ${f.rel}:${f.line}  ${f.name}`);
  process.exit(1);
}

console.log(`check-dynamic-route-uuid-guard: ${guarded}/${scanned} route path params guarded.`);
