//
// LA-81 — the half of a shrink-only ratchet that a count cannot express.
//
// `check-route-test-coverage.js` compares one number against a baseline, so covering five routes
// while un-covering three reads as a two-route improvement. That is not hypothetical: a test file
// was written to a path that already held one, destroying the tests for `calendar-data`,
// `training-load` and `muscle-recovery`. The count fell 87 → 85, the check said OK, and only
// diffing the two uncovered lists by hand showed three routes had gone backwards.
//
// Kept pure and separate so it can be tested without a git repository, exactly as `verdict` in
// `base-ref.js` is — the end-to-end behaviour was demonstrated by replaying that accident against a
// real base; what belongs in CI is the decision.
'use strict';

/**
 * The routes that had a handler test on the base and no longer do.
 *
 * Three things are deliberately NOT regressions:
 *   - a route that was already uncovered at the base — that is debt, and the count owns it;
 *   - a route the branch DELETES — a route that no longer exists is not an untested one;
 *   - anything at all when `baseCovered` is null, which means we could not read the base rather
 *     than that the base covered nothing. Those lead to opposite conclusions, so a base we cannot
 *     see must never turn a passing branch red.
 *
 * @param {{routes: string[], covered: Set<string>, baseCovered: Set<string>|null}} a
 * @returns {string[]}
 */
function lostRouteCoverage({ routes, covered, baseCovered }) {
  if (!baseCovered) return [];
  return routes.filter(r => baseCovered.has(r) && !covered.has(r));
}

module.exports = { lostRouteCoverage };
