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
// So the walk skips `__check_fixture__` by default, and a run opts in with SCAN_CHECK_FIXTURES=<tag>.
// Only the suites that park fixtures set it, and only on the child processes they spawn; CI and
// `pnpm check:rules` never do, so a stray fixture directory cannot fail them.
//
// Issue 2707. Two suites used to park a copy at the SAME path (`components/home/__check_fixture__/
// collection-card.tsx`) and each removed the whole folder when it finished, so a full `pnpm test`
// failed comment-blindness with a hex-literals diff or ENOENT. Now each suite parks its copy in its
// OWN child folder, `__check_fixture__/__fx_<tag>/`, and scans with SCAN_CHECK_FIXTURES=<tag>, which
// admits only that child. Another suite's child, and a stray one, stay invisible. Test walkers keep
// skipping `__check_fixture__` by name, so they never reach a child either.
//
// One helper, used by every tree-walking check (issue 2697 extended it from the twelve comment-blindness
// exercises to all of them): the skip is not copied per check. `check-fixture-isolation.test.ts` finds
// the walkers itself (any check-*.js using `withFileTypes`), so a new check cannot miss it.

const FIXTURE_DIR = '__check_fixture__';
const CHILD_PREFIX = '__fx_';

/** Name of the per-suite child folder inside `__check_fixture__` for this tag. */
function fixtureChildDir(tag) {
  return CHILD_PREFIX + tag;
}

/** True when a directory (or path segment) of this name is a fixture copy this run must not scan. */
function isSkippedFixtureDir(name) {
  const scan = process.env.SCAN_CHECK_FIXTURES || '';
  if (name === FIXTURE_DIR) return scan === '';
  if (name.startsWith(CHILD_PREFIX)) return name !== CHILD_PREFIX + scan;
  return false;
}

module.exports = { FIXTURE_DIR, CHILD_PREFIX, fixtureChildDir, isSkippedFixtureDir };
