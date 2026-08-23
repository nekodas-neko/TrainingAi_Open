#!/usr/bin/env node
// Q-313 — a `lib/oura-models/constants` getter called at MODULE SCOPE opens the constants
// directory at import time, and `next build` imports every route to collect page data.
//
// Not hypothetical. A3 was recorded as having made the model constants a runtime-only dependency,
// and a green `publish-dry-run --all` was the evidence. It was wrong: six modules still read at
// module scope, so deleting the files produced `ENOENT … energy-expenditure-features.json` at
// *Failed to collect page data for /api/achievements* — a failed Railway deploy, not a local
// annoyance. A4b fixed those six to read on first use.
//
// `tsc --noEmit` cannot see it: the fault is a file read at import time, not a type. `publish-dry-run`
// now runs `next build` under `--all`, which catches it properly; this is the seconds-not-minutes
// version that runs on every PR, so the class cannot come back between dry-runs.
//
// **Parsed with TypeScript's own parser, not a brace counter.** The first draft counted braces and
// flagged `const K_ = (): T => (cache ??= getAstdConstants())` — which is the A4b FIX, a memoised
// read-on-first-use, and does not run on import at all. A checker that fails on the correct shape
// is worse than no checker, and the arrow-body case is exactly what a heuristic gets wrong.
'use strict';
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const ROOTS = ['lib', 'app', 'packages/shared/src', 'components'];

// Sourced from the module that defines them, so a new getter is covered the day it is added rather
// than the day someone remembers to update a list here.
function constantsGetters() {
  const src = fs.readFileSync(path.join(ROOT, 'lib/oura-models/constants/index.ts'), 'utf8');
  return new Set([...src.matchAll(/^export function (get\w+)\s*\(/gm)].map(m => m[1]));
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !p.includes('__tests__')) out.push(p);
  }
  return out;
}

// Anything that DEFERS execution. A call inside one of these runs when that thing is called, not
// when the module is imported — which is the whole distinction being drawn.
const DEFERS = new Set([
  ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor, ts.SyntaxKind.ClassDeclaration, ts.SyntaxKind.ClassExpression,
]);

function moduleScopeHits(file, src, getters) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits = [];
  (function visit(node, deferred) {
    if (ts.isCallExpression(node) && !deferred) {
      const fn = node.expression;
      const name = ts.isIdentifier(fn) ? fn.text
        : ts.isPropertyAccessExpression(fn) && ts.isIdentifier(fn.name) ? fn.name.text
        : null;
      if (name && getters.has(name)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        hits.push({ line: line + 1, name, text: src.split('\n')[line].trim().slice(0, 100) });
      }
    }
    const nowDeferred = deferred || DEFERS.has(node.kind);
    ts.forEachChild(node, c => visit(c, nowDeferred));
  })(sf, false);
  return hits;
}

const getters = constantsGetters();
if (getters.size === 0) {
  console.error('check-constants-module-scope: found no getters to look for — the accessor module moved or changed shape.');
  process.exit(1);
}

const found = [];
for (const r of ROOTS) {
  const dir = path.join(ROOT, r);
  if (!fs.existsSync(dir)) continue;
  for (const f of walk(dir)) {
    const rel = path.relative(ROOT, f);
    if (rel.startsWith('lib/oura-models/constants/')) continue; // where they are defined
    const src = fs.readFileSync(f, 'utf8');
    if (![...getters].some(g => src.includes(g))) continue;
    for (const h of moduleScopeHits(rel, src, getters)) found.push({ file: rel, ...h });
  }
}

if (process.argv.includes('--print')) {
  console.log(JSON.stringify(found, null, 2));
  process.exit(0);
}

if (found.length) {
  console.error('check-constants-module-scope: a constants getter is called at module scope.\n');
  for (const h of found) console.error(`  ${h.file}:${h.line}  ${h.name}()  —  ${h.text}`);
  console.error(`
${found.length} call(s). These run on IMPORT, and \`next build\` imports every route to collect page
data — so the constants directory would have to exist at build time, which is the dependency A4b
removed.

Move the call inside the function that needs the value. The memoised shape the fixed modules use is
  let cache; const C_ = () => (cache ??= getFoo());
which this check accepts, because the getter runs on first use rather than on import.`);
  process.exit(1);
}
console.log(`check-constants-module-scope: OK — no module-scope reads across ${getters.size} getters.`);
