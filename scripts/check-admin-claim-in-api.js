#!/usr/bin/env node
// Q-479 — an API route must never authorise from the session's `isAdmin` JWT claim.
//
// `lib/admin.ts` holds two checks that disagree on purpose, and the difference is the whole bug:
//   requireAdmin(userId, _isAdmin?)  — accepts the flag for call-site compatibility and REFUSES to
//                                      trust it; reads the row every call. 61 API routes use it.
//   isAdminUser(userId, isAdmin?)    — RETURNS the passed flag when one is given.
//
// The claim is refreshed at most once a day (`ISACTIVE_RECHECK_MS`), which is a sound throttle for
// deciding whether to draw the admin entry point and an unsound one for deciding whether a write
// lands. `app/api/exercises` passed the claim, so a revoked admin kept writing to the shared
// exercise catalogue for up to 24 hours — measured 2026-08-18 at 201 from that route against 403
// from `/api/admin/errors`, same cookie, same instant, with the database already saying no.
//
// Page guards under app/ that are NOT routes may pass it: a revoked admin seeing an empty admin
// shell for up to a day, while every API behind it answers 403, is the intended trade. So this
// checks route files only.
//
// Zero baseline, not a ratchet — there was exactly one site and it is fixed.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// `isAdminUser(` with anything after the first argument's comma before the closing paren.
const CLAIM_ARG = /isAdminUser\(\s*[^),]+,/g;
const failures = [];
let scanned = 0;

// Blanks out // and /* */ comments, keeping byte offsets so reported line numbers stay true.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '__tests__') continue;
      walk(full);
      continue;
    }
    // Route handlers only — a page.tsx guard is UI and is allowed to read the claim.
    if (entry.name !== 'route.ts' && entry.name !== 'route.tsx') continue;
    const rel = path.relative(root, full).split(path.sep).join('/');
    scanned++;
    const raw = fs.readFileSync(full, 'utf8');
    // Strip comments first. Without this the check fires on a comment *explaining* the rule — which
    // it did on its own first run, against the note left at the site it had just cleaned.
    const src = stripComments(raw);
    for (const m of src.matchAll(CLAIM_ARG)) {
      failures.push({ rel, line: src.slice(0, m.index).split('\n').length });
    }
  }
}

walk(path.join(root, 'app', 'api'));

if (failures.length > 0) {
  console.error('An API route authorises from the session isAdmin claim, which is up to 24h stale (Q-479).');
  console.error('Use `requireAdmin(userId)` — it reads the row every call, like the other 61 API routes.');
  console.error('Passing the claim to isAdminUser makes it return the claim instead of checking anything.');
  for (const f of failures) console.error(`  ${f.rel}:${f.line}`);
  process.exit(1);
}

console.log(`check-admin-claim-in-api: ${scanned} API route file(s), none authorise from the stale isAdmin claim.`);
