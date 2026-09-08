# 2026-09-08 — the route-coverage ratchet learns to see a swap (LA-81)

**Branch:** `fix/route-coverage-set-comparison` · **Lane A** · closes LA-81.

## The defect

`scripts/check-route-test-coverage.js` compared one number against a baseline, so **covering five
routes while un-covering three read as a two-route improvement**. Found by walking into it: earlier
the same day a new test file was written to `lib/__tests__/home-aggregate-routes.test.ts`, a path
that already held one, destroying the tests for `calendar-data`, `training-load` and
`muscle-recovery`. The count went 87 → 85 and the check said OK. Diffing the two uncovered lists by
hand is the only reason it surfaced; nothing in CI would have said a word, and the PR would have
read as progress.

## The fix

The scan is now a function of a tree root, so the identical rule can answer for the merge base as
well as the working tree — which is what makes the two lists comparable at all. `materialiseBaseTree`
in `scripts/lib/base-ref.js` already existed for `check-memo-prop-stability.js` and does the archive.
Any route covered at the base and uncovered here fails, whatever the total does.

Three cases are deliberately not regressions, and the reasoning is in the code: a route already
uncovered at the base is debt the count owns; a route the branch deletes is not an untested route;
and no base at all reports nothing, because "the base covered nothing" and "we cannot read the base"
lead to opposite conclusions and only one of them is knowable.

The decision itself is a pure function in `scripts/lib/coverage-regression.js`, tested without a git
repository — the same shape as `verdict` in `base-ref.js`, and for the same reason.

## Verified by replaying the accident

The end-to-end proof is the original failure, re-run: copy the new file over the existing one, delete
the new path, run the checker. It now fails and names the three routes:

```
  • 3 routes had a test importing the handler on the base branch and no longer do.
      calendar-data
      muscle-recovery
      training-load
```

Six unit cases pin the rule. A five-mutation pass caught all five, one after re-aiming: replacing the
null guard with an empty set is genuinely equivalent for this function's output, while *deleting* the
guard is the real mutation, and that is caught.

## Two things worth knowing about it

**It degrades the opposite way from the size ratchets.** They fall back to a plain absolute
comparison when no base resolves, which is *stricter* than the base-aware one. This has nothing to
fall back to: no base means no comparison, so it does not run. CI fetches `origin main` at depth 1
before the step (enough for `git archive`), but a failed fetch leaves the count as the only gate —
the pre-LA-81 behaviour, never a weaker one. That step is renamed from "for the size ratchet's
comparison" to "for the ratchets' base comparison", since it now serves two.

**It costs about 1.7 seconds** — the checker went from ~0.6 s to 2.3 s, in a job that runs at ~25 s.

## The line says which halves ran

A clean run used to read identically whether the base comparison happened or not, which made the
"did it actually run in CI" question unanswerable from the log — and a check that silently does
nothing is worse than no check. It now ends `base comparison ran against origin/main` or `no base
resolved, count only`. Same reason `check-cache-ttl-divergence.js` prints how many sites it had to
skip: a clean run should never be mistaken for full coverage. Both branches were exercised, the
second against a clone with no reachable base.

## Not exercised

Node-only, no runtime surface: no device, no database, no UI. The CI path specifically — `git
archive` against a depth-1 fetched `origin/main` on a GitHub runner — is exercised for the first time
by this PR's own Custom Rules run, not locally; the line above is what confirms it from the log.
