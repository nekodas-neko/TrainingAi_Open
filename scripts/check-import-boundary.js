#!/usr/bin/env node
// Server code, the shared package and the native app never import client code (#3729).
//
// The web screens (root `app/` pages and `components/`) and the Capacitor plumbing around them are
// being retired once the native app in `mobile/` takes over (#2849). They can only be deleted
// cleanly if nothing that outlives them reaches into them. An import graph on 11 Nov found eight
// import lines running the wrong way — an API route importing `components/workout/utils`, a
// server helper taking a type from `lib/local-store/types.ts`, two routes pulling constants out of
// Capacitor-only modules — and this check is what stops them growing back.
//
// What counts as "server": every file under `app/api/`, `lib/data/` and `lib/ai/`, plus every
// `lib/` file one of those reaches through its imports (so a server-side helper outside those
// folders is covered the moment a route imports it). All of `packages/shared/` and `mobile/` are
// checked too. None of them may import a client folder below, or any `@capacitor/*` module.
// Type-only imports count: a type import still ties the file to the client tree.
//
// CLIENT_DIRS is the one list of client folders. Add a folder here, not a second copy elsewhere.
'use strict';
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./lib/strip-comments');
const { isSkippedFixtureDir } = require('./lib/fixture-dirs');

const CLIENT_DIRS = ['components/', 'lib/local-store/', 'lib/sqlite/', 'lib/hooks/'];
const CLIENT_MODULE_PREFIXES = ['@capacitor/'];

// Roots whose every file is checked. Server roots also seed the walk into the rest of `lib/`.
const SERVER_ROOTS = ['app/api', 'lib/data', 'lib/ai'];
const WHOLE_ROOTS = ['packages/shared', 'mobile'];

// Today's exceptions: client-only files that live in `packages/shared/` and import the local store.
// Each is a file that only the web client imports; moving it out is its own change. The list may
// only shrink — a file that no longer violates must be removed from it (the check fails on a stale
// entry), and a new violation is never fixed by adding a line here.
const ALLOWLIST = new Set([
  // A cachedFetch wrapper for the web screens' widgets; reads the device cache (lib/sqlite/cache).
  'packages/shared/src/fetch-with-retry.ts',
  // The nutrition write paths the web screens call: each writes the local store first, then pushes.
  'packages/shared/src/nutrition/barcode-lookup.ts',
  'packages/shared/src/nutrition/create-food-item.ts',
  'packages/shared/src/nutrition/local-eaten-at.ts',
  'packages/shared/src/nutrition/log-food.ts',
  'packages/shared/src/nutrition/log-meal.ts',
  'packages/shared/src/nutrition/save-plan-meal.ts',
]);

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
// Tests are not shipped, and some exist to compare the server with the local store (the parity
// suites run both). They are deleted with the client code they exercise, so they are not checked,
// and an import from a test does not pull a lib/ file into the server walk.
const TEST_FILE = /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', '.next', '.expo', 'dist', 'build', 'android', 'ios', '.git']);

function parseArgs(argv) {
  const out = { root: path.join(__dirname, '..'), allowlist: ALLOWLIST };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') out.root = path.resolve(argv[++i]);
    // For the hermetic tests, whose fixture trees hold none of the allowlisted files.
    else if (argv[i] === '--no-allowlist') out.allowlist = new Set();
  }
  return out;
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name === '__tests__' || isSkippedFixtureDir(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (SOURCE_EXT.test(e.name) && !e.name.endsWith('.d.ts') && !TEST_FILE.test(e.name)) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

// Static imports and re-exports, side-effect imports, dynamic import() and require().
const SPEC_RES = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function importsOf(src) {
  const code = stripComments(src);
  const found = [];
  for (const re of SPEC_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) {
      const line = code.slice(0, m.index).split('\n').length;
      found.push({ spec: m[1], line });
    }
  }
  return found;
}

const RESOLVE_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js'];

/** Repo-relative path a specifier points at (resolved to a file when one exists), or null for a package. */
function resolveSpec(root, fromRel, spec) {
  let base;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('@trainingai/shared/')) base = 'packages/shared/src/' + spec.slice('@trainingai/shared/'.length);
  else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  else return null;
  for (const ext of RESOLVE_EXTS) {
    const cand = base + ext;
    try {
      if (fs.statSync(path.join(root, cand)).isFile()) return cand;
    } catch {
      /* try the next extension */
    }
  }
  return base;
}

function clientTarget(spec, resolved) {
  if (CLIENT_MODULE_PREFIXES.some((p) => spec.startsWith(p))) return spec;
  if (resolved && CLIENT_DIRS.some((d) => resolved === d.slice(0, -1) || resolved.startsWith(d))) return resolved;
  return null;
}

function rel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

function run(root, allowlist = ALLOWLIST) {
  const checked = new Map(); // rel path -> why it is checked
  for (const r of WHOLE_ROOTS) for (const f of walk(path.join(root, r))) checked.set(rel(root, f), r);
  const queue = [];
  for (const r of SERVER_ROOTS) for (const f of walk(path.join(root, r))) queue.push([rel(root, f), r]);

  const violations = [];
  const seen = new Set();
  // Server roots, then every lib/ file they reach. Client files are reported, never walked into.
  while (queue.length) {
    const [file, why] = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    checked.delete(file);
    scanFile(root, file, why, violations, (next) => {
      if (next.startsWith('lib/') && SOURCE_EXT.test(next) && !TEST_FILE.test(next) && !seen.has(next)) queue.push([next, `reached from ${file}`]);
    });
  }
  for (const [file, why] of checked) scanFile(root, file, why, violations, () => {});

  const violating = new Set(violations.map((v) => v.file));
  const fresh = violations.filter((v) => !allowlist.has(v.file));
  const stale = [...allowlist].filter((f) => !violating.has(f));
  return { fresh, stale, allowed: violations.length - fresh.length, scanned: seen.size + checked.size };
}

function scanFile(root, file, why, violations, onLocal) {
  let src;
  try {
    src = fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return;
  }
  for (const { spec, line } of importsOf(src)) {
    const resolved = resolveSpec(root, file, spec);
    const target = clientTarget(spec, resolved);
    if (target) violations.push({ file, line, spec, target, why });
    else if (resolved) onLocal(resolved);
  }
}

function main() {
  const { root, allowlist } = parseArgs(process.argv.slice(2));
  const { fresh, stale, allowed, scanned } = run(root, allowlist);
  if (fresh.length === 0 && stale.length === 0) {
    console.log(`Import boundary OK — ${scanned} server/shared/native files import no client code (${allowlist.size} files allowlisted, ${allowed} import lines).`);
    return;
  }
  for (const v of fresh) {
    console.error(`${v.file}:${v.line} imports client code '${v.spec}' (${v.why})`);
  }
  for (const f of stale) {
    console.error(`${f} is on the allowlist in scripts/check-import-boundary.js but no longer imports client code — remove it.`);
  }
  console.error(
    `\nServer code, packages/shared and mobile/ must not import ${CLIENT_DIRS.join(', ')} or ${CLIENT_MODULE_PREFIXES.join(', ')}*.` +
      '\nMove the type, constant or pure helper into packages/shared/ instead (#3729).'
  );
  process.exit(1);
}

if (require.main === module) main();

module.exports = { CLIENT_DIRS, CLIENT_MODULE_PREFIXES, ALLOWLIST, importsOf, run };
