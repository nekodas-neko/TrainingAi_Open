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
// A function whose signature takes `userId: string` and whose body never USES it to scope or stamp
// rows: the parameter is decorative, the query is unfiltered, every user's rows come back. That is
// the `getBodyMetricsBaseline` mutation, made permanent.
//
// #3803 tightened "uses". It used to pass on `userId` anywhere in the body (a log call counted) or
// `user_id` anywhere (a column list counted). Now `userId` must sit in a place that constrains or
// stamps rows:
//   - inside a `where(` / `eq(` / `and(` / `or(` / `inArray(` call;
//   - as a bound parameter: `${userId}` in a `sql` template (never `sql.raw`), or an element of an
//     array literal passed to a call (`pool.query(text, [userId])`);
//   - inside `.values(` / `.set(` — an insert or update that stamps the owner;
//   - passed to another call that is not logging, i.e. delegated to a helper that does the scoping.
// A mention of the word `user_id` no longer counts on its own. Plain (non-async) query builders —
// `export function`, and non-async class methods — are checked too, and a floor on the number of
// methods checked stops a signature change from quietly checking nothing.
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
const { stripComments } = require('./lib/strip-comments');

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

// `export [async] function foo(` in a slice, or a two-space-indented `[async] foo(` method on the
// adapter class. Deliberately not a TS parser: this runs in Custom Rules on every PR. A two-space
// call statement inside a top-level function also matches the method shape; it never has a
// `userId: string` parameter, so it is never checked, but it still bounds the region before it.
const SIGNATURE = /(?:export\s+(?:async\s+)?function\s+|^\s{2}(?:(?:private|public|protected|static)\s+)*(?:async\s+)?)(?!(?:if|for|while|switch|catch|return|await|function)\b)([A-Za-z0-9_]+)\s*(?:<[^>()]*>)?\(/gm;

// The floor (#3803): 368 methods when this check was written, 663 under the old async-only scan, 672
// once plain builders and optional `userId?` parameters were counted. Lower it only when methods
// are genuinely removed; never to make a scan that stopped matching pass.
// The fixture tests in repository-user-scoping-check.test.ts run a three-method tree and lower it
// through this variable; nothing else sets it.
const MIN_CHECKED = Number(process.env.USER_SCOPING_MIN_CHECKED ?? 670);

const SCOPING_CALLS = new Set(['where', 'eq', 'and', 'or', 'inArray', 'values', 'set']);
// A call that only reports the id: passing `userId` here scopes nothing.
const LOGGING = /^(?:console\.\w+|logger\.\w+|log|logError|logWarn|(?:\w+\.)?capture(?:Exception|Message)|String|JSON\.stringify)$/;

/** The callee name before the `(` at `open`, e.g. `eq`, `this.getFoo`, `tx.update(t).set`. */
function calleeBefore(src, open) {
  const m = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*(?:<[^<>()]*>)?\s*$/.exec(src.slice(Math.max(0, open - 200), open));
  return m ? m[1].replace(/\s+/g, '') : '';
}

/**
 * Whether the `userId` at `idx` scopes or stamps rows. Walks outward through the brackets that
 * enclose it; the first that settles the question decides.
 */
function scopes(src, idx) {
  // A `${userId}` inside a template: bound only when the template is tagged `sql` (not sql.raw).
  const before = src.slice(0, idx);
  if (/\$\{\s*$/.test(before)) {
    const tick = before.lastIndexOf('`');
    if (tick >= 0 && /(?:^|[^.\w])sql\s*$/.test(before.slice(0, tick))) return true;
  }
  let depth = { '(': 0, '[': 0, '{': 0 };
  for (let i = idx - 1; i >= 0; i--) {
    const c = src[i];
    if (c === ')' || c === ']' || c === '}') { depth[{ ')': '(', ']': '[', '}': '{' }[c]]++; continue; }
    if (c !== '(' && c !== '[' && c !== '{') continue;
    if (depth[c] > 0) { depth[c]--; continue; }
    if (c === '{') {
      // A row built in a variable and then written: `const values = { userId, day }` … `.values(values)`.
      const bound = /(?:const|let)\s+([A-Za-z_$][\w$]*)(?:\s*:[^=]+)?\s*=\s*$/.exec(src.slice(Math.max(0, i - 200), i));
      if (bound && new RegExp(`\\.(?:values|set)\\(\\s*${bound[1]}\\b`).test(src)) return true;
      continue; // otherwise an object literal — keep walking to the call it is passed to
    }
    if (c === '[') {
      // An array literal handed to a call is a bound parameter list.
      const after = src.slice(0, i).trimEnd();
      if (/[(,]$/.test(after)) return true;
      continue;
    }
    const callee = calleeBefore(src, i);
    if (!callee) continue; // a grouping paren
    const last = callee.split('.').pop();
    if (SCOPING_CALLS.has(last)) return true;
    if (LOGGING.test(callee)) return false;
    return true; // delegated to a helper that takes the id
  }
  return false;
}

// `nested`: the parameter is a field of an object parameter (`m: { userId: string }`), so the use
// to look for is `m.userId`, not a bare `userId`.
function usesUserId(region, nested) {
  const re = nested ? /(?<![\w$])userId\b(?!\s*:(?!:))/g : /(?<![.\w$])userId\b(?!\s*:(?!:))/g;
  let m;
  while ((m = re.exec(region))) if (scopes(region, m.index)) return true;
  return false;
}

const files = [
  'lib/data/postgres/adapter.ts',
  ...fs.readdirSync(SLICE_DIR).filter(f => f.endsWith('.ts')).map(f => `lib/data/postgres/slices/${f}`),
];

let checked = 0;
const offenders = [];

for (const rel of files) {
  const src = stripComments(fs.readFileSync(path.join(root, rel), 'utf8'));
  const marks = [];
  let m;
  SIGNATURE.lastIndex = 0;
  while ((m = SIGNATURE.exec(src))) {
    // A definition is followed by its body or return type; a call statement that happens to sit at
    // two spaces (`  dropObservedHrDay(userId, …)` inside a function) is not, and is not a mark.
    const open = m.index + m[0].length - 1;
    const close = balanced(src, open, '(', ')');
    if (close < 0 || !/^\s*[:{]/.test(src.slice(close + 1, close + 40))) continue;
    marks.push({ name: m[1], at: m.index, afterName: open });
  }

  marks.forEach((mark, i) => {
    const paramOpen = src.indexOf('(', mark.afterName);
    const paramClose = balanced(src, paramOpen, '(', ')');
    if (paramClose < 0) return;
    const params = src.slice(paramOpen + 1, paramClose);
    const decl = /\buserId\s*\??\s*:\s*string/.exec(params);
    if (!decl) return;
    // Is the declaration inside an object type (`m: { userId: string }`) rather than a parameter?
    const prefix = params.slice(0, decl.index);
    const nested = (prefix.match(/\{/g) || []).length > (prefix.match(/\}/g) || []).length;
    checked++;

    // Everything from the end of the parameters to the next signature. Deliberately not the brace
    // body: a multi-line return type (`Promise<{ … }>`) contains braces, and matching on those
    // truncated the body and produced 29 false positives on the first attempt at this.
    const region = src.slice(paramClose, i + 1 < marks.length ? marks[i + 1].at : src.length);
    if (usesUserId(region, nested)) return;

    const line = src.slice(0, mark.at).split('\n').length;
    const key = `${rel}:${mark.name}`;
    if (EXEMPT.has(key)) return;
    offenders.push({ where: `${rel}:${line}`, name: mark.name });
  });
}

if (checked < MIN_CHECKED) {
  console.error(`check-repository-user-scoping: only ${checked} methods taking userId were found, below the floor of ${MIN_CHECKED}.`);
  console.error('The signature scan has probably stopped matching. Fix the scan; lower the floor only when methods were genuinely removed.');
  process.exit(1);
}

if (offenders.length > 0) {
  console.error('Repository method takes `userId` but never uses it to scope or stamp rows — the query is unscoped and returns every user\'s rows (Q-155).');
  console.error('Scope it (`eq(table.userId, userId)`, a bound `${userId}` / `[userId]`), or, if it is genuinely global, add it to EXEMPT in this script with a reason.');
  console.error('A log call, or the word user_id in a column list, does not scope anything:');
  for (const o of offenders) console.error(`  ${o.where}  ${o.name}`);
  process.exit(1);
}

console.log(`check-repository-user-scoping: ${checked} methods take userId, all use it${EXEMPT.size ? ` (${EXEMPT.size} exempt)` : ''}.`);
