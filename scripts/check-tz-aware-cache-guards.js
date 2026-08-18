#!/usr/bin/env node
// isBodyMetadataFresh / isWorkoutDataToday compare a date the SERVER stamped in the user's
// timezone against a date the CLIENT computes. Both take an optional `tz`; omit it and the
// comparison silently becomes "is the server's date equal to Brisbane's date", which is false
// for |Δ| hours out of every 24 for a user Δ hours from Brisbane — 14 hours a day in New York.
//
// The parameter is optional because making it required would force it through call sites that
// legitimately have no session (and because the default is correct for the owner). That is
// exactly why prose cannot hold this: the wrong call compiles, type-checks, lints clean, and is
// correct on the only device anyone tests on. Q-478 found four such call sites, one of which sat
// two lines above a `todayInTz(tz)` that had the timezone in hand.
//
// So: every call passes a second argument. If a new call site genuinely has no timezone to pass,
// pass `undefined` explicitly — that is a decision in the diff rather than an omission.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const GUARDS = ['isBodyMetadataFresh', 'isWorkoutDataToday'];
const DIRS = ['app', 'components', 'lib', 'packages'];
// The definitions themselves, and the unit tests, which deliberately call both arities to prove
// the default still holds for a Brisbane user.
const EXEMPT = new Set(['lib/sqlite/cache.ts', 'lib/__tests__/cache-fetch.test.ts']);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = DIRS.filter(d => fs.existsSync(path.join(root, d)))
  .flatMap(d => walk(path.join(root, d), []));

const bad = [];
let checked = 0;

for (const abs of files) {
  const rel = path.relative(root, abs).replace(/\\/g, '/');
  if (EXEMPT.has(rel)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  for (const guard of GUARDS) {
    let from = 0;
    for (;;) {
      const i = src.indexOf(`${guard}(`, from);
      if (i === -1) break;
      from = i + guard.length;
      // An import naming the guard is not a call.
      const lineStart = src.lastIndexOf('\n', i) + 1;
      const line = src.slice(lineStart, src.indexOf('\n', i));
      if (/^\s*import\b/.test(line)) continue;
      checked++;
      // Walk the argument list to its matching close paren, counting only top-level commas so a
      // nested call or an object literal in argument one is not mistaken for a second argument.
      let depth = 0, comma = false, j = src.indexOf('(', i);
      for (; j < src.length; j++) {
        const c = src[j];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) break; }
        else if (c === ',' && depth === 1) comma = true;
      }
      if (!comma) {
        const lineNo = src.slice(0, i).split('\n').length;
        bad.push(`${rel}:${lineNo}  ${guard}(…) has no timezone argument\n      ${line.trim()}`);
      }
    }
  }
}

if (bad.length) {
  console.error('Timezone-blind cache guard check failed:\n');
  for (const b of bad) console.error(`  • ${b}\n`);
  console.error(`  Pass the user's timezone — \`useUserTimezone()\` in a component, \`user?.timezone\``);
  console.error(`  where the user object is already in scope. If there is genuinely none to pass,`);
  console.error(`  pass \`undefined\` explicitly so the choice is visible in the diff.`);
  process.exit(1);
}

console.log(`check-tz-aware-cache-guards: OK — ${checked} call sites, all timezone-aware`);
