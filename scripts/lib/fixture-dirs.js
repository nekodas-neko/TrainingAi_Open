'use strict';
//
// #2578. `check-comment-blindness.test.ts` parks a COPY of a real source file, with a violation
// appended, in an ignored `__check_fixture__/` folder beside it, and runs each check over the tree
// to see whether the check notices. Those checks have to see the copy; every other run must not.
// A full `pnpm test` runs other suites that spawn the REAL check against the working tree
// (`strict-schema-inert`), and when the two overlapped the real check reported the other suite's
// copy, or hit ENOENT when it was removed mid-walk. Suspected cause of the "goals-route flake"
// recorded in `lib/base-ref.js`.
//
// So the walk skips `__check_fixture__` by default, and a run opts in with SCAN_CHECK_FIXTURES=1.
// Only check-comment-blindness sets it, and only on the child processes it spawns; CI and
// `pnpm check:rules` never do, so a stray fixture directory cannot fail them.
//
// One helper, used by every tree-walking check (issue 2697 extended it from the twelve comment-blindness
// exercises to all of them): the skip is not copied per check. `check-fixture-isolation.test.ts` finds
// the walkers itself (any check-*.js using `withFileTypes`), so a new check cannot miss it.

const FIXTURE_DIR = '__check_fixture__';

/** True when a directory (or path segment) of this name is a fixture copy this run must not scan. */
function isSkippedFixtureDir(name) {
  return name === FIXTURE_DIR && process.env.SCAN_CHECK_FIXTURES !== '1';
}

module.exports = { FIXTURE_DIR, isSkippedFixtureDir };
