#!/usr/bin/env node
// Q-483 — a route must not put a raw error into its response body.
//
// `errorLog` (packages/shared/src/logger.ts) returns `[ERROR]: ${error}` so a caller can log it and
// keep the string. Four routes returned that string as the JSON body, and with a Drizzle error the
// string is the whole failing statement — so a malformed id published every column of
// `workout_sessions` to the client:
//
//   GET /api/workout-sessions/not-a-uuid/recap → 500
//   {"error":"[ERROR]: Error: Failed query: select \"id\", \"user_id\", \"session_id\", …
//
// The control — a valid-but-missing UUID — returns a clean 404, so this was specific to the
// malformed id reaching the driver as 22P02. It is disclosure to an *authenticated* user rather than
// an anonymous hole, and production showed zero 22P02 rows, so it had likely never been served. It
// is still the only place in the app that publishes table structure, and redacting cost nothing:
// `reportServerError` already banked the full error and the log line still prints it.
//
// This check bans the shape rather than the instance, because the instance was four copies of one
// habit and the fifth would have been written the same way.
//
// **Widened by Q-320 to the `e.message` shape as well.** A caught error's `.message` *is* "Failed
// query: select …" for a Drizzle error, so `{ error: msg }` where `msg = e instanceof Error ?
// e.message : 'fallback'` leaks identically. The reason this waited for its own item is that the
// same variable served two habits: some sites echoed a message someone had **written for the user**
// ("An exercise with that name already exists"), and untangling those from the accidental ones was
// the work. It is done — the deliberate ones now throw `UserFacingError`
// (`packages/shared/src/errors.ts`), which carries its own status, and every route answers with
// `refusalResponse(err, fallback)` from `lib/api/route-errors.ts`. So this check can be strict
// without firing on correct code, which is the only reason a check survives.
//
// Two of Q-320's 14 listed sites turned out not to be leaks at all. `admin/db-query` is exempt below
// with its reason; `coach/apply/[id]/undo` needed nothing — its `detail` is an author-written literal
// off a structured result, never a caught error, so the shape this check bans was never there.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// `error: <something>` inside a NextResponse.json, where <something> is a bare identifier or an
// errorLog(...) call rather than a literal. A string literal is exactly what we want people writing.
const RAW_IN_BODY = [
  // { error: errorLog(...) } — inlined
  /NextResponse\.json\(\s*\{[^}]*\berror:\s*errorLog\s*\(/g,
];

// `const msg = e instanceof Error ? e.message : '…'` — the Q-320 shape. Any binding whose value is
// a caught error's `.message`, however it is spelled.
const MESSAGE_BINDING = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^\n;]*\binstanceof\s+Error\s*\?[^\n;]*\.message/g;

// Routes where echoing the raw error is the product, not a leak. Each needs a written reason, the
// same shape as check-api-no-store.js's one exemption. Do not add to this without one.
const EXEMPT = new Map([
  ['app/api/admin/db-query/route.ts',
   'the admin SQL console — the DB error text (permission denied, syntax, timeout) IS the answer ' +
   'the operator asked for, the route is admin-gated, and it already says so in a comment'],
]);

// The four-site shape was two statements, not one: `const errMsg = errorLog(...)` then
// `{ error: errMsg }`. Catch the binding too, so re-adding it via a variable does not slip past.
const ERRORLOG_BINDING = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*errorLog\s*\(/g;

const failures = [];
let scanned = 0;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

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
    for (const re of RAW_IN_BODY) {
      re.lastIndex = 0;
      for (const m of src.matchAll(re)) {
        failures.push({ rel, line: src.slice(0, m.index).split('\n').length, snippet: m[0].replace(/\s+/g, ' ').slice(0, 70) });
      }
    }
    if (EXEMPT.has(rel)) continue;
    for (const [re, label] of [[ERRORLOG_BINDING, 'errorLog'], [MESSAGE_BINDING, "a caught error's .message"]]) {
      re.lastIndex = 0;
      for (const b of src.matchAll(re)) {
        const used = new RegExp(`NextResponse\\.json\\(\\s*\\{[^}]*\\berror:\\s*${b[1]}\\s*[,}]`);
        const m = used.exec(src);
        if (m) failures.push({ rel, line: src.slice(0, m.index).split('\n').length, snippet: `error: ${b[1]}  (bound from ${label})` });
      }
    }
  }
}

walk(path.join(root, 'app', 'api'));

if (failures.length > 0) {
  console.error('A route puts a raw error into its response body (Q-483, widened by Q-320).');
  console.error('With a Drizzle error that string is the whole failing statement, including every');
  console.error('column name. Return a fixed string — `{ error: \'Internal error\' }` — and keep the');
  console.error('detail in the log line and reportServerError, which already have it.');
  console.error('If the message was WRITTEN for the user, throw UserFacingError instead and answer');
  console.error('with refusalResponse(err, fallback) — it echoes that one and hides everything else.');
  for (const f of failures) console.error(`  ${f.rel}:${f.line}  ${f.snippet}`);
  process.exit(1);
}

console.log(`check-no-raw-error-in-response: ${scanned} API route file(s), none return a raw error as the body.`);
