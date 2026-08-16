#!/usr/bin/env node
// One canonical TTL per cache key (CLAUDE.md: Cache Invalidation). The same key fetched with
// different TTLs at different call sites makes freshness last-writer-wins, and the constants in
// packages/shared/src/cache-ttl.ts exist precisely so two sites cannot drift.
//
// That rule was prose plus a naming convention, and it did not hold. The 2026-08-14 review found
// `day-log:` fetched with a literal TTL_MEDIUM at one site and DAY_LOG_TTL at another (equal values,
// so nothing was broken). Scanning for the same shape found a second one the review missed, where
// the values were NOT equal: `hr-profile` was HR_PROFILE_TTL (6 h) at seven sites and a raw
// TTL_MEDIUM (30 min) at the eighth. That is the failure mode the rule describes, live.
//
// So this compares TTL *expressions*, not resolved values: two names for the same number today are
// exactly what drifts tomorrow when one of them is changed.
//
// Coverage is deliberately three-sided, because a key's TTL is set in three places:
//   1. cachedFetch / cachedFetchToday call sites
//   2. setCached writes for the same key
//   3. the sync-provider warm list, which pre-populates keys the screens later read
// A key warmed at one TTL and fetched at another has the same last-writer-wins problem.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ROOTS = ['app', 'components', 'lib'];
// The cache module itself defines these functions; its `key` parameters are not call sites.
const SKIP = new Set(['lib/sqlite/cache.ts']);
const WARM_LIST = 'components/sync-provider.tsx';

const CALL = /\b(cachedFetch|cachedFetchToday|setCached)\s*(?:<[^<>]*(?:<[^<>]*>)?[^<>]*>)?\s*\(/g;
const CONST_STR = /const\s+(\w+)\s*=\s*(?:\([^)]*\)\s*=>\s*)?(`[^`]*`|"[^"]*"|'[^']*')/g;
const WARM_ENTRY = /\{\s*key:\s*'([^']+)'[^}]*?ttl:\s*([A-Za-z_0-9]+)/g;

/** The literal prefix of a key expression: `day-log:${date}` -> "day-log:". Null if not a literal. */
function keyPrefix(expr) {
  const m = /^[`'"]([^$`'"]*)/.exec(expr.trim());
  return m ? m[1] : null;
}

/** Split a call's arguments at depth 1, starting just past its opening paren. */
function splitArgs(src, start) {
  let i = start, depth = 1, cur = '';
  const args = [];
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) break;
    }
    if (c === ',' && depth === 1) { args.push(cur); cur = ''; } else cur += c;
    i++;
  }
  args.push(cur);
  return args;
}

const sites = new Map();   // key prefix -> Map(ttl expression -> [locations])
const unresolved = [];

function record(prefix, ttl, where) {
  if (!sites.has(prefix)) sites.set(prefix, new Map());
  const byTtl = sites.get(prefix);
  if (!byTtl.has(ttl)) byTtl.set(ttl, []);
  byTtl.get(ttl).push(where);
}

function scan(file, rel) {
  const src = fs.readFileSync(file, 'utf8');

  // Every `const X = '<literal>'` with its offset, so a re-declared name in a second function
  // resolves to the nearest PRECEDING definition rather than the file's first one. Resolving from
  // the wrong occurrence is how a first version of this scan invented a divergence that was not
  // there (two `const cacheKey` in one file, for different keys).
  const defs = new Map();
  for (const m of src.matchAll(CONST_STR)) {
    const p = keyPrefix(m[2]);
    if (p === null) continue;
    if (!defs.has(m[1])) defs.set(m[1], []);
    defs.get(m[1]).push({ at: m.index, prefix: p });
  }

  CALL.lastIndex = 0;
  for (const m of src.matchAll(CALL)) {
    const args = splitArgs(src, m.index + m[0].length);
    if (args.length < 3) continue;
    const line = src.slice(0, m.index).split('\n').length;
    const where = `${rel}:${line}`;
    // Strip comments before comparing: a comment beside the argument is not part of the
    // expression, and leaving it in makes an identical TTL look like a divergence.
    const ttl = args[2].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim().replace(/\s+/g, ' ');
    let prefix = keyPrefix(args[0]);
    if (prefix === null) {
      const base = /^(\w+)/.exec(args[0].trim());
      const candidates = (base && defs.get(base[1]) || []).filter(d => d.at < m.index);
      if (candidates.length > 0) prefix = candidates[candidates.length - 1].prefix;
    }
    if (prefix === null) { unresolved.push(`${where} (${args[0].trim().slice(0, 40)})`); continue; }
    record(prefix, ttl, where);
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (['node_modules', '.next', '__tests__', 'dist'].includes(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || SKIP.has(rel)) continue;
    scan(full, rel);
  }
}

for (const top of ROOTS) {
  const dir = path.join(root, top);
  if (fs.existsSync(dir)) walk(dir);
}

// The warm list sets a TTL for keys the screens read elsewhere — same key, third source of truth.
const warmPath = path.join(root, WARM_LIST);
if (fs.existsSync(warmPath)) {
  const src = fs.readFileSync(warmPath, 'utf8');
  for (const m of src.matchAll(WARM_ENTRY)) {
    record(m[1], m[2], `${WARM_LIST} (warm list)`);
  }
}

const divergent = [...sites.entries()].filter(([, byTtl]) => byTtl.size > 1);

if (divergent.length > 0) {
  console.error('Cache key(s) fetched with more than one TTL expression (CLAUDE.md: one canonical TTL per cache key).');
  console.error('Name the TTL once in packages/shared/src/cache-ttl.ts and import it at every call site,');
  console.error('including the sync-provider warm list.');
  for (const [key, byTtl] of divergent) {
    console.error(`  ${key}`);
    for (const [ttl, where] of byTtl) console.error(`      ${ttl} — ${where.join(', ')}`);
  }
  process.exit(1);
}

// Printed rather than failed: a key built by a helper call can't be resolved statically, so these
// are this check's blind spot. Keeping the count visible stops a clean run being read as full
// coverage.
console.log(`check-cache-ttl-divergence: ${sites.size} cache keys, each with one TTL expression (${unresolved.length} key expressions unresolvable: ${unresolved.join(', ') || 'none'}).`);
