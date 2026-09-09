#!/usr/bin/env node
// Q-548 — `requireAdmin` must not be wrapped in a catch that cannot tell a refusal from an outage.
//
// `requireAdmin` makes a DB round-trip and throws `AdminError` for "not an admin". A catch that
// discards the reason answers 403 for *anything else* too — including a connection failure. That is
// the one status a caller will neither retry nor escalate, and it points the investigation at
// credentials: during the 2026-08-18 volume incident every /api/admin/db-query call returned
// {"error":"Forbidden"} while the Railway dashboard already said the service was offline, and the
// first several minutes went into checking env vars and the admin flag.
//
// "Not authorised" and "could not check" must be different answers. `adminErrorResponse(err)` /
// `adminFailureOutcome(err)` in lib/admin.ts give 403 for a real refusal and 503 otherwise.
//
// ## Why this was rewritten (2026-09-09)
//
// **The first version of this check could not see most of the class it names, and passed clean for
// weeks while eleven live sites carried the defect.** It matched a single regex requiring the try's
// closing brace on the line immediately after the call:
//
//     /await\s+requireAdmin\([^\n]*\)\s*\n\s*\}\s*catch\s*.../
//
// Two shapes slip straight through it, and between them they covered every remaining offender:
//
//   1. **A trailing semicolon.** `await requireAdmin(a, b);` puts a `;` between `)` and the
//      newline, which `\s*` does not match. Purely stylistic, and it silently disabled the check
//      for nine sites across four admin routes.
//   2. **A try block holding more than the call.** `admin/errors`, `admin/feedback` and
//      `admin/feedback/[id]` wrapped the repository read as well, so the catch swallowed a failed
//      QUERY into 403 too — the more dangerous shape of the two, and invisible to a pattern that
//      insists the brace comes next.
//
// So the old header's claim that "the sweep cleared all 46, so the correct baseline is zero" was
// true only of the 46 the regex could see. This version brace-matches the enclosing `try` instead
// of pattern-matching its shape, which is why it does not care about spacing, semicolons, or how
// much else lives in the block. `scripts/__tests__/admin-guard-catch.test.ts` pins both blind spots
// so the check cannot regress to a narrower reading.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const FORWARDS = /adminErrorResponse\(|adminFailureOutcome\(|adminFailureStatus\(|isAdminRefusal\(/;

/** The index just past the `}` closing the block that opens at `openIdx` (which must be a `{`). */
function matchBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Every `try` block that calls `requireAdmin`, paired with the catch clause that follows it.
 * Returns the offenders — a catch whose body never reaches one of the helpers.
 */
function offendersIn(src) {
  const out = [];
  const TRY = /\btry\s*\{/g;
  for (const m of src.matchAll(TRY)) {
    const openIdx = m.index + m[0].length - 1;
    const endOfTry = matchBrace(src, openIdx);
    if (endOfTry < 0) continue;
    const block = src.slice(openIdx, endOfTry);
    if (!block.includes('requireAdmin(')) continue;

    const rest = src.slice(endOfTry);
    const cm = /^\s*catch\s*(?:\(\s*[\w$]+\s*\)\s*)?\{/.exec(rest);
    if (!cm) continue;                       // try/finally with no catch cannot swallow anything
    const catchOpen = endOfTry + cm[0].length - 1;
    const catchEnd = matchBrace(src, catchOpen);
    const body = catchEnd < 0 ? rest : src.slice(catchOpen, catchEnd);
    if (FORWARDS.test(body)) continue;

    out.push(src.slice(0, m.index).split('\n').length);
  }
  return out;
}

const failures = [];
let scanned = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '__tests__') continue;
      walk(full);
      continue;
    }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (rel === 'lib/admin.ts') continue;
    const src = fs.readFileSync(full, 'utf8');
    if (!src.includes('requireAdmin(')) continue;
    scanned++;
    for (const line of offendersIn(src)) failures.push({ rel, line });
  }
}

for (const top of ['app', 'lib']) walk(path.join(root, top));

if (failures.length > 0) {
  console.error('requireAdmin sits in a try whose catch does not distinguish a refusal from an outage (Q-548).');
  console.error('A DB failure inside requireAdmin becomes 403, which reads as "your credential was revoked".');
  console.error("Use `catch (err) { return adminErrorResponse(err) }` (or adminFailureOutcome) from lib/admin.ts,");
  console.error('and keep the real work OUTSIDE that try — a catch around the read turns a failed query into 403 too.');
  for (const f of failures) console.error(`  ${f.rel}:${f.line}`);
  process.exit(1);
}

console.log(`check-admin-guard-catch: ${scanned} file(s) call requireAdmin, none swallow the reason.`);

module.exports = { offendersIn };
