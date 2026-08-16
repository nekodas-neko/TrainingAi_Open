#!/usr/bin/env node
// A repository method that accepts `userId` and never uses it cannot be scoping anything.
//
// Q-155 measured the gap this closes: removing the `user_id` scope from `getBodyMetricsBaseline`
// — turning a user-scoped read into one that returns any user's row — left the whole suite green.
// Three passes of hand-written ownership tests followed (36 of them, each verified by mutation),
// but exact per-predicate attribution needs ~246 individual runs, so the suite can only ever bound
// the problem. This is the cheap half: it does not prove the existing scopes are right, it stops a
// NEW method from shipping with none at all, which is the regression the entry actually names —
// *"fails loudly when a new unscoped method appears."*
//
// ── What this DOES catch ──────────────────────────────────────────────────────
// A function whose signature takes `userId: string` and whose body never mentions `userId` or
// `user_id` again: the parameter is decorative, the query is unfiltered, every user's rows come
// back. That is the `getBodyMetricsBaseline` mutation, made permanent.
//
// ── What this does NOT catch, and it matters ──────────────────────────────────
//   1. A scope on the WRONG column or the wrong id — `eq(x.userId, someOtherId)` reads as used.
//   2. A join that mentions `userId` but does not actually constrain the rows returned.
//   3. Ownership enforced by a pre-check that is present but wrong (`ensureWorkoutSession`'s
//      throw, `renameExercise`'s `createdBy` compare).
//   4. Anything outside `adapter.ts` and its slices — routes, shared helpers, raw `sql` builders
//      assembled elsewhere.
// It is an omission detector, not a correctness proof. The hand-written cases in
// `repository-ownership-scoping.test.ts` are what cover (1)–(3), and Q-155 stays open for the rest.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SLICE_DIR = path.join(root, 'lib/data/postgres/slices');

// Methods that legitimately take `userId` without scoping a query on it. Empty on purpose: there
// were none when this check was written (368 methods, 0 violations). A new entry needs a reason —
// "it's fine" is not one, because that is exactly what an unscoped read looks like.
const EXEMPT = new Map([]);

function balanced(src, i, open, close) {
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// `export async function foo(` in a slice, or a two-space-indented `async foo(` method on the
// adapter class. Deliberately not a TS parser: this runs in Custom Rules on every PR.
const SIGNATURE = /(?:export\s+async\s+function|^\s{2}(?:private\s+)?async)\s+([A-Za-z0-9_]+)\s*\(/gm;

const files = [
  'lib/data/postgres/adapter.ts',
  ...fs.readdirSync(SLICE_DIR).filter(f => f.endsWith('.ts')).map(f => `lib/data/postgres/slices/${f}`),
];

let checked = 0;
const offenders = [];

for (const rel of files) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const marks = [];
  let m;
  SIGNATURE.lastIndex = 0;
  while ((m = SIGNATURE.exec(src))) marks.push({ name: m[1], at: m.index, afterName: m.index + m[0].length - 1 });

  marks.forEach((mark, i) => {
    const paramOpen = src.indexOf('(', mark.afterName);
    const paramClose = balanced(src, paramOpen, '(', ')');
    if (paramClose < 0) return;
    if (!/\buserId\s*:\s*string/.test(src.slice(paramOpen + 1, paramClose))) return;
    checked++;

    // Everything from the end of the parameters to the next signature. Deliberately not the brace
    // body: a multi-line return type (`Promise<{ … }>`) contains braces, and matching on those
    // truncated the body and produced 29 false positives on the first attempt at this.
    const region = src.slice(paramClose, i + 1 < marks.length ? marks[i + 1].at : src.length);
    if (/userId\s*[),]/.test(region) || /user_id/.test(region)) return;

    const line = src.slice(0, mark.at).split('\n').length;
    const key = `${rel}:${mark.name}`;
    if (EXEMPT.has(key)) return;
    offenders.push({ where: `${rel}:${line}`, name: mark.name });
  });
}

if (offenders.length > 0) {
  console.error('Repository method takes `userId` but never uses it — the query is unscoped and returns every user\'s rows (Q-155).');
  console.error('Scope it (`eq(table.userId, userId)`), or, if it is genuinely global, add it to EXEMPT in this script with a reason:');
  for (const o of offenders) console.error(`  ${o.where}  ${o.name}`);
  process.exit(1);
}

console.log(`check-repository-user-scoping: ${checked} methods take userId, all use it${EXEMPT.size ? ` (${EXEMPT.size} exempt)` : ''}.`);
