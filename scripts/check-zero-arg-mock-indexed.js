#!/usr/bin/env node
// A `vi.fn` declared with no parameters, whose recorded calls are then indexed.
//
// `const f = vi.fn(async () => undefined)` takes no parameters, so TypeScript types
// `f.mock.calls[0]` as the empty tuple `[]`. A spec that then reads `[0]` off it gets **TS2493**
// ("Tuple type '[]' of length '0' has no element at index '0'"), and an `as {…}` on the result adds
// **TS2352**. The mock still works at runtime — vitest records arguments regardless of the declared
// signature — so the spec PASSES and only the type checker objects.
//
// **Why that reaches `main` instead of the branch.** `tsconfig.json` excludes `**/__tests__/**`, so
// `npx tsc --noEmit` — what an implementer runs — cannot see it. `check-test-typecheck.js` can, and
// it is in `pnpm ci:local`, but it lives in the Build job in CI: an author who runs lint and the
// suite separately gets a clean board and finds out after the merge. Three instances did exactly
// that on 2026-09-07 (LB-62), each turning `main` red.
//
// **The cheaper alternative was priced and it is already spent.** LB-62 suggested adding
// `check-test-typecheck` to `pnpm ci:local` instead of building this. Measured: it went in on
// **2026-09-02** (#770), five days BEFORE all three incidents. Being in `ci:local` did not stop
// them, because the authors were not running `ci:local`. That is what makes a targeted check worth
// its weight — it fails in the Custom Rules job, which is dependency-free and ~25 seconds.
//
// **Both halves are required.** A zero-argument mock nobody indexes is fine and there are many; an
// indexed mock that declares its parameters is fine too. Only the pair is a type error.
'use strict';
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./lib/strip-comments');

const root = path.join(__dirname, '..');

/** `const NAME = vi.fn(` followed by an arrow taking NO parameters — `()` or `async ()`. */
const ZERO_ARG_MOCK = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*vi\.fn\s*\(\s*(?:async\s*)?\(\s*\)\s*=>/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const { resolveBaseRef, countAtBase, verdict } = require('./lib/base-ref');

// Recorded 2026-09-10 (LB-62). Every one predates the check, and every one is a REAL error: the
// type checker reports 52 TS2493s across the tree, and each site below appears in that output.
//
// **They are already caught — by `check-test-typecheck`, in the Build job, on its own shrink-only
// baseline of 320 errors across 90 files.** This check does not find anything that gate misses. It
// finds it *four minutes earlier*, in Custom Rules, which installs nothing and runs in ~25 seconds,
// and it names the one-line fix instead of printing a TS code.
//
// **The baseline is deliberately not zero, and clearing it is not this check's job.** Each fix means
// choosing the parameter types the assertion reads, which is a judgement per site; getting one wrong
// makes a spec assert against a shape the code never produces. Shrink it when touching the file.
const BASELINE = {
  'app/api/__tests__/admin-db-query.test.ts': 3,
  'app/api/__tests__/dexa-scans-route.test.ts': 3,
  'app/api/__tests__/hr-ingest-poison-pill.test.ts': 3,
  'app/api/sync/pull/__tests__/route.test.ts': 3,
  'components/nutrition/__tests__/save-meal-tags.test.ts': 2,
  'lib/__tests__/app-load-metrics.test.ts': 2,
  'lib/__tests__/cache-http-layer-bypass.test.ts': 2,
  'lib/__tests__/register-inactive.test.ts': 1,
  'lib/ai/__tests__/instrument.test.ts': 3,
  'lib/home/__tests__/rest-day-write.test.ts': 1,
  'lib/scale-ble/__tests__/apply-reading.test.ts': 6,
  'lib/user/__tests__/preferences-sync.test.ts': 2,
  'packages/shared/src/workout/__tests__/log-exercise.test.ts': 8,
};

/** Sites in one file's source. Exported shape so the base-branch comparison runs the same code. */
function countSites(src) {
  const lines = stripComments(src).split('\n');
  const zeroArg = new Map();
  lines.forEach((line, i) => {
    const m = ZERO_ARG_MOCK.exec(line);
    if (m) zeroArg.set(m[1], i + 1);
  });
  if (zeroArg.size === 0) return { count: 0, hits: [] };

  const hits = [];
  for (const [name, declLine] of zeroArg) {
    const indexed = new RegExp(
      `\\b${name}\\.mock\\.calls\\s*\\[[^\\]]+\\]\\s*(?:\\[|\\bas\\b)` +
      `|\\[[^\\]]*\\]\\s*=\\s*${name}\\.mock\\.calls\\s*\\[[^\\]]+\\]`,
    );
    lines.forEach((line, i) => {
      if (indexed.test(line)) hits.push({ name, declLine, useLine: i + 1, text: line.trim().slice(0, 100) });
    });
  }
  return { count: hits.length, hits };
}

const baseRef = resolveBaseRef();
const failures = [];
const inherited = [];
const perFile = new Map();
let checked = 0;

for (const file of walk(root)) {
  checked++;
  const rel = path.relative(root, file).split(path.sep).join('/');
  const { count, hits } = countSites(fs.readFileSync(file, 'utf8'));
  if (count > 0) perFile.set(rel, { count, hits });
}

for (const [rel, { count, hits }] of perFile) {
  const allowed = BASELINE[rel] ?? 0;
  // Q-424: whether THIS BRANCH added one, not whether the file is over.
  const v = verdict({ count, limit: allowed, atBase: countAtBase(baseRef, rel, (c) => countSites(c).count) });
  if (v === 'inherited') {
    inherited.push(`${rel}: ${count} site(s) against a baseline of ${allowed}, but the base branch is already there.`);
  } else if (v === 'fail') {
    failures.push(allowed === 0
      ? `${rel}: ${count} zero-argument mock(s) indexed; this file is not in the baseline, so it must have zero.\n` +
        hits.map(h => `        line ${h.useLine}: \`${h.name}\` (declared zero-arg at ${h.declLine}) — ${h.text}`).join('\n')
      : `${rel}: ${count} site(s), over its baseline of ${allowed}.`);
  }
}

// Shrink-only: a file that improved must lower its number, or the baseline stops meaning anything.
for (const [rel, allowed] of Object.entries(BASELINE)) {
  const count = perFile.get(rel)?.count ?? 0;
  if (count < allowed) {
    failures.push(`${rel}: down to ${count} from a baseline of ${allowed} — ${count === 0 ? 'delete its row' : `lower it to ${count}`}, the baseline is shrink-only.`);
  }
}

// Reported, never a failure (Q-424): the base's debt is not this branch's to answer for.
if (inherited.length) {
  console.log('check-zero-arg-mock-indexed: inherited from the base branch, not caused here:');
  inherited.forEach((f) => console.log('  • ' + f));
}

if (failures.length) {
  console.error('A zero-argument `vi.fn` has its recorded calls indexed — TS2493 in the test typecheck (LB-62).\n');
  console.error('The mock works at runtime, so the spec PASSES and only `check-test-typecheck` objects —');
  console.error('and that runs in the Build job, i.e. after the merge for anyone not running `pnpm ci:local`.\n');
  console.error('Fix: declare the parameters the assertion reads, which usually removes the cast too:');
  console.error('  const f = vi.fn(async (_userId: string, _from: Date) => undefined)\n');
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}

const total = [...perFile.values()].reduce((n, v) => n + v.count, 0);
console.log(`check-zero-arg-mock-indexed: ${checked} spec file(s); ${total} baselined site(s), none added.`);
