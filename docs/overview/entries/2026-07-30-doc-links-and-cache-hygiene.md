## 2026-07-30 — Docs link-check CI gate; finish the invalidateCache hygiene migration

Two small backlog items picked up after the earlier docs-cleanup session, both closing out
work other sessions had already started.

### PR #931 — docs link check in CI (Q-27 item 1)

Nothing protected the new `docs/domains/` indexes or the backlog's cross-links from rotting the
moment a doc moved. `scripts/check-doc-links.js` walks every `.md` under `docs/` plus the three
repo-root docs, strips fenced/inline code first (a regex literal or a quoted markdown example in
backticks reads exactly like `[text](path)` otherwise — both occurred in this repo's review/plan
docs and produced false positives before the strip was added), and fails on any relative link that
doesn't resolve. Wired into the Custom Rules CI job.

Running it found 42 broken links: 36 in `docs/overview/uplift-archive.md` missing a `../` (the
file lives one directory deeper than its link targets assume), 12 of those additionally needing
`archive/` (their target plans had separately moved into `docs/superpowers/plans/archive/`), and
one stray extra `docs/` prefix in a handoff doc. All fixed in the same PR.

### PR #934 — migrate the last hand-rolled invalidateCache() calls (J1 residual)

The 7 remaining raw `invalidateCache()` calls outside `lib/cache-groups.ts` are now routed
through named group helpers. Two were quietly missing the `clearLegacyHomeSeeds()` call
`cache-groups.ts`'s own top-of-file invariant requires for anything touching `workout-data:meta`
or `next-session` — they had no way to call it since the helper isn't exported. New
`invalidateWorkoutMetaRefresh()` (Home header's manual refresh button) and
`invalidateWorkoutDataImmediate()` (`completeWorkout()`'s early, pre-await invalidation) close
that gap. A third new group, `invalidateOuraWorkoutReview()`, replaces 4 identical
`invalidateCache('oura-unreviewed-workouts')` sites. One further raw call
(`invalidateCache('sleep-performance-correlation')`) was a dead duplicate already covered by the
adjacent `invalidateOuraSync()` and was deleted. Added the CI check J1 had been waiting on this
half for.

Not changelog/version-bump worthy — both are internal hygiene with no meaningfully describable
user-visible effect (the cache-timing fixes close a race condition that was already very unlikely
to manifest).

### Tests
Both PRs: `pnpm exec tsc --noEmit` clean, `pnpm lint` 0 errors, `pnpm build` clean, full `vitest`
suite green except the one pre-existing `claude-ro-readonly-role.test.ts` failure (confirmed
environmental — Unix-socket `DATABASE_URL` isn't parseable by the JS `URL` constructor the test
uses in this sandbox; CI's TCP connection string doesn't hit this), `check-reconcile.js` /
`check-push-mutations.js` / `check-doc-links.js` all clean.
