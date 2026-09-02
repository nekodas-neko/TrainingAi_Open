#!/usr/bin/env node
// Unit-test files are typechecked. They were not, for the life of the repository.
//
// `tsconfig.json` carried `exclude: ["node_modules", ".claude", "**/__tests__/**"]`, so across ~700
// spec files a test could reference a type that does not exist, call a function with the wrong
// arity, or assert against an interface that had since changed shape, and `tsc` said nothing. Every
// session here treats a clean `tsc` as its first gate and CI's Build job runs the same project, so
// "TSC_OK" carried no information about any spec. That is the same class as a guard that cannot
// fail (LB-37). `e2e/` was never excluded and has always been checked; this is unit tests only.
//
// **A ratchet, not a ban.** 320 errors across 90 files is far too much for one diff, and they sit in
// the highest-consequence places — the shared write path (`log-exercise.test.ts`, 25), the energy
// balance service (24), the local store (16). So every file holding errors today is recorded at its
// current count and may only shrink; any file NOT listed must have zero. The value is immediate for
// every NEW spec; the 320 come down as files are touched.
//
// **The split is exact, which is why the baseline can be trusted.** `npx tsc --noEmit -p
// tsconfig.json` (tests excluded) reports **0** errors, and every one of the 320 is in a test file.
// There are no pre-existing non-test errors mixed in and nothing to argue about.
//
// **Why a second tsconfig rather than editing the first.** `tsconfig.json` is what `next build`
// reads; dropping the exclusion there would put 320 errors in front of the Build job, which is a
// different (and much larger) change than making new specs typecheck. `tsconfig.tests.json` extends
// it and drops only the exclusion, so the two projects cannot disagree about anything else.
//
// **No base-branch comparison, deliberately (contrast Q-424's `verdict`).** The sibling ratchets
// re-run their matcher over the base branch's file content to tell "this branch grew it" from "the
// base was already over". That needs the check to be a pure function of one file's text; this one
// needs a whole-project type graph, and running `tsc` twice against two checkouts is minutes, not
// seconds. The committed baseline moves with `main` instead, so a branch only fails for a count it
// raised itself.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const BASELINE_FILE = path.join(root, 'scripts/test-typecheck-baseline.json');
const BASELINE = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));

// `tsc` exits non-zero when it reports errors, which is the normal case here — the errors are the
// output, not a failure to run. A crash (no diagnostics at all) is different and must not be read
// as "clean", so an empty result with a non-zero exit is reported rather than passed.
function runTsc() {
  try {
    return execFileSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.tests.json'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    if (err.stdout != null) return err.stdout + (err.stderr || '');
    throw err;
  }
}

/** `path/to/file.ts(12,3): error TS2345: …` — the only line shape tsc emits for a located error. */
const ERROR_LINE = /^([^ (][^(]*)\(\d+,\d+\): error /;

function countByFile(out) {
  const counts = new Map();
  for (const line of out.split('\n')) {
    const m = ERROR_LINE.exec(line);
    if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  return counts;
}

const out = runTsc();
const counts = countByFile(out);
const total = [...counts.values()].reduce((a, b) => a + b, 0);

// A run that produced no diagnostics at all is either genuinely clean or a tsc that fell over. The
// baseline says which: with 90 recorded files, zero diagnostics means the run did not happen.
if (counts.size === 0 && Object.keys(BASELINE).length > 0) {
  console.error('check-test-typecheck: tsc produced no diagnostics at all, which cannot be right against a');
  console.error('non-empty baseline. Treating it as a failed run rather than a clean one. Output was:\n');
  console.error(out.slice(0, 4000));
  process.exit(1);
}

const failures = [];
const stale = [];

for (const [rel, count] of [...counts.entries()].sort()) {
  const allowed = BASELINE[rel] ?? 0;
  if (count > allowed) failures.push({ rel, count, allowed });
}

// A row for a file that is now clean (or gone) has to come out, or the list rots into an allowlist
// that lets errors return to a file somebody already fixed. Same rule the sibling ratchets use.
for (const rel of Object.keys(BASELINE)) {
  if (!counts.has(rel)) stale.push(fs.existsSync(path.join(root, rel)) ? rel : `${rel} (deleted)`);
}

if (failures.length > 0 || stale.length > 0) {
  if (failures.length > 0) {
    console.error('Type error(s) in test files, above the recorded baseline (LB-37).');
    console.error('A spec is code: fix the type, or — if a file legitimately grew — raise its number in');
    console.error('scripts/test-typecheck-baseline.json in this PR, which puts the growth in the diff.\n');
    for (const f of failures) {
      console.error(f.allowed === 0
        ? `  ${f.rel}: ${f.count} error(s) — this file had none.`
        : `  ${f.rel}: ${f.count} error(s), baseline ${f.allowed}.`);
    }
    console.error('\nRun `npx tsc --noEmit -p tsconfig.tests.json` to see them.');
  }
  if (stale.length > 0) {
    console.error('\nBaseline row(s) to delete — these files no longer carry the errors they are recorded for:');
    for (const s of stale) console.error(`  ${s}`);
  }
  process.exit(1);
}

console.log(`check-test-typecheck: ${total} type errors across ${counts.size} test files, none above baseline (${Object.keys(BASELINE).length} recorded).`);
