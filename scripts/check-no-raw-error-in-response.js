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
// **Deliberately narrow: `errorLog(...)` output only.** The first draft also flagged
// `{ error: msg }` where `msg = e instanceof Error ? e.message : 'fallback'`, and it was RIGHT to —
// a Drizzle error's `.message` *is* "Failed query: select …", so those 500s leak the same way. But
// that is 14 sites across 8 files, several of which return a deliberate user-facing message on a
// 4xx, and untangling which is which is a separate item, not a widening of this one. Filed as
// **Q-320**. Do not broaden this check without doing that work — a check that fires on correct code
// gets deleted rather than obeyed.
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
    ERRORLOG_BINDING.lastIndex = 0;
    for (const b of src.matchAll(ERRORLOG_BINDING)) {
      const used = new RegExp(`NextResponse\\.json\\(\\s*\\{[^}]*\\berror:\\s*${b[1]}\\s*[,}]`);
      const m = used.exec(src);
      if (m) failures.push({ rel, line: src.slice(0, m.index).split('\n').length, snippet: `error: ${b[1]}  (bound from errorLog)` });
    }
  }
}

walk(path.join(root, 'app', 'api'));

if (failures.length > 0) {
  console.error('A route puts a raw error into its response body (Q-483).');
  console.error('With a Drizzle error that string is the whole failing statement, including every');
  console.error('column name. Return a fixed string — `{ error: \'Internal error\' }` — and keep the');
  console.error('detail in the log line and reportServerError, which already have it.');
  for (const f of failures) console.error(`  ${f.rel}:${f.line}  ${f.snippet}`);
  process.exit(1);
}

console.log(`check-no-raw-error-in-response: ${scanned} API route file(s), none return a raw error as the body.`);
