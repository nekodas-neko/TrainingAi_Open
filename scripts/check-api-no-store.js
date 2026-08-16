#!/usr/bin/env node
// API responses do not go in the browser's HTTP cache.
//
// This app manages its own cache explicitly — `cachedFetch` keys, `readCacheSync` seeds, and the
// named invalidation groups in `lib/cache-groups.ts`. A `Cache-Control: private, max-age=60` on an
// API route puts a **second** cache underneath all of that, and it is the only one
// `invalidateCache()` cannot reach.
//
// Q-166 (2026-08-09) measured what that costs rather than assuming it. An unsafe method only
// invalidates its *own* url, so `POST /api/phase-sets` → `GET /api/phase-sets` self-heals, while
// `DELETE /api/supplements/<id>` → `GET /api/supplements` kept returning the deleted row for a
// minute — on a route that already shipped the header. That was a live bug, not a hypothetical.
//
// The client and the service worker now both send `cache: 'no-store'` for `/api/`, so the header
// governs almost nothing on the canonical runtime anyway. Given it buys ~nothing and has already
// cost correctness once, the decision (owner, 2026-08-10) was to go the other way: API responses
// are `private, no-store`, and this check is what keeps the old convention from growing back.
//
// Exemptions are listed with their reason. Add one only for a response that genuinely should sit
// in a shared or long-lived cache — not to quiet the check on a data route.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const API = path.join(root, 'app', 'api');

const EXEMPT = new Map([
  // Public, session-independent, and deliberately cacheable: the version/APK-release lookup. Its
  // own comment explains why it is not auth-gated. 5 minutes of staleness on a version number is
  // the point — it keeps the update card off the GitHub API on every app open.
  ['app/api/version/route.ts', 'public version endpoint, deliberately cacheable'],
]);

// Anything that parks a response in a cache we cannot invalidate.
const BANNED = /\b(max-age|s-maxage|stale-while-revalidate|stale-if-error|immutable)\b/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['__tests__', 'node_modules'].includes(entry.name)) continue;
      walk(full, out);
      continue;
    }
    if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

const offenders = [];
let checked = 0;

for (const file of walk(API)) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (EXEMPT.has(rel)) continue;
  checked++;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/Cache-Control/i.test(line)) return;
    if (BANNED.test(line)) offenders.push({ rel, line: i + 1, text: line.trim() });
  });
}

if (offenders.length > 0) {
  console.error('API route caches its response in a layer `invalidateCache()` cannot reach (Q-166).');
  console.error("Use `Cache-Control: 'private, no-store'` — the app's own cache handles freshness.");
  for (const o of offenders) console.error(`  ${o.rel}:${o.line}  ${o.text}`);
  process.exit(1);
}

console.log(`check-api-no-store: ${checked} API route file(s), none cache their response.`);
