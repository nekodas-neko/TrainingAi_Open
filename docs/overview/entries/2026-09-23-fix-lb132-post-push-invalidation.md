# 2026-09-23 — LB-132: invalidate again once a local write reaches the server

**Branch:** `fix/lb132-post-push-invalidation` · **Lane B** · v1.465.15

## What shipped

Five local-first write paths queued their mutation, fired a bare `pushMutations` and evicted their
caches on the same beat. Each now pairs that immediate call with `pushThenRevalidate`, carrying its
own group's invalidator(s):

| Site | Invalidators |
|------|--------------|
| `app/session-select/components/log-value-sheet.tsx` | `invalidateBodyMetricWrite` + `invalidateReadinessInputs` |
| `components/mood-checkin-sheet.tsx` | `invalidateCheckinAffectsPrescription` |
| `components/morning-checkin-sheet.tsx` | `invalidateCheckinAffectsPrescription` + `invalidateHealthTrends` |
| `components/nutrition/end-of-day/end-of-day-review.tsx` | `invalidateHealthTrends` |
| `components/activity/exercise-review-sheet.tsx` | `invalidateActivityWrites` + `invalidateOuraWorkoutReview` |

## Why the second half is load-bearing

The entry left one question open — whether the pull path already re-invalidates — and it bounded
whether any of group ② was worth doing. It is answered: **`lib/local-store/sync-engine.ts` fires no
cache invalidation at all.** No `invalidateBiometrics`, no `invalidateCache(`. Nothing downstream
closes the window.

`pushThenRevalidate`'s own docblock names the cost exactly: invalidating only *before* the push
makes every `useCachedValue` subscriber refetch while the server still holds the pre-write state and
**re-cache the stale payload**, which then stands for the key's full TTL because nothing invalidates
again. That is LB-4 — the 42 kcal Energy Balance reading. Every one of the five groups clears a
server-computed aggregate (readiness, the prescription, health trends, the day log), so each had a
real window rather than a theoretical one.

The immediate call stays in all five. Offline the push never resolves usefully, so a push-only
invalidation repaints nothing at all.

## What this was NOT

Group ① of LB-132 is **empty** — both its candidates were verified correct before this session, and
the entry now says so in place, so a later sweep does not patch a working file. The same test emptied
four more apparent offenders: `use-plan-meal-logging.ts`, `manual-bedtime-card.tsx`,
`more-content.tsx`, `sync-health-card.tsx`. `log-value-sheet.tsx` looked like the defect from its
call line too — its invalidation sits 39 lines below the push, inside the same `try`, so only the
far-side half was missing there.

**RV-108 remains the only genuine missed invalidation found in the app.**

## Verification

- `components/__tests__/lb132-post-push-invalidation.test.ts` — 17 assertions. Per site: the exact
  far-side call, the immediate call still present, no bare `pushMutations` on the write path. Plus
  each group really clearing a server-computed key, and `sync-engine.ts` still invalidating nothing
  (so the far-side calls are not later removed as redundant).
- Control run: reverting `mood-checkin-sheet.tsx` to the bare push failed 2 of its 3.
- `tsc --noEmit` clean · `check-test-typecheck` at baseline (320/90) · lint clean on all five ·
  `pnpm check:rules` **Ran 77 of 77** · `pnpm build` green · 12 related test files, 85 tests green.

## Not exercised

**The changed branch is unreachable in the web sandbox.** `getLocalStore` returns null there, so
`pnpm dev` runs the API fallback arm — the one this PR does not touch. The build proves it compiles
and the test proves the calls are present; neither watches an eviction on a phone. Also not
exercised: native SQLite, safe-area, Samsung WebView, drifted prod data.

**Owed:** the device pass, recorded as `Keep:` on the entry — log a morning check-in and an
end-of-day review on the S25 and confirm the prescription and health-trends surfaces move when the
push lands rather than at TTL.
