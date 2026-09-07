# 2026-09-07 — the deload confirm evicted nothing the screen reads (RV-49)

**Branch:** `fix/deload-confirm-eviction` · **Lane A**

## The defect

`handleEarlyDeloadConfirm` carries Q-117's fix comment naming the very keys that were going stale,
then calls `invalidatePrescriptionChanged()` **with no session id** — a deload is not scoped to one
session. Q-117 added a per-id eviction and reached `ai-prescription-card.tsx`, which passes an id;
this caller does not, and the eviction was conditional on it. So the confirm evicted **no cards at
all**. `next-session`, Home's recommendation key, was not in the group at any time.

Both keys are load-bearing rather than first-paint accelerators, which is the difference between a
brief stale flash and hours of wrong numbers. Checked rather than assumed, per the rule in
`CLAUDE.md`: `workout-card:` is fetched with `freshWithinTtl`, and `next-session` has **seed-only**
read paths — `use-deload-choice.ts`, `workout-select-content.tsx` and `session-select-content.tsx`
all `readTodayCacheSync` it, and the first of those reads the deload flag itself. So after the owner
confirmed a deload, every per-session card and the recommendation kept full-intensity weights for up
to TTL_LONG (6 h).

## The fix

In `lib/cache-groups.ts` only — the call site needed no change, which is what the re-laning note on
the entry had already established. With an id the eviction stays precise; without one it drops the
`workout-card:` and `ai-periodization-session:` prefixes, the shape `invalidateInjuryWrites` already
uses for the same two keys. `next-session` is added unconditionally.

`ai-periodization-session:` was not named in the entry, but it sits in the same conditional with the
same defect; fixing one and leaving the other would have been arbitrary.

## Verification

- **Mutation-tested three ways** at unit level: restoring the conditional, removing `next-session`,
  and prefix-sweeping even when an id IS given (which would lose the precision Q-117 built). Each
  fails.
- **A Playwright spec asserts the eviction in a real browser** — the half the unit test cannot reach,
  because it mocks `invalidateCache` and so pins the group's argument list rather than whether the
  browser's `sessionStorage`/`localStorage` mirrors actually clear. **Confirmed binding: with the fix
  reverted it fails with "workout-card: survived the deload confirm — this is RV-49"; with the fix it
  passes.**
- Full suite **6709 passed | 86 skipped**; `tsc` clean; Custom Rules 68 of 68.

## Three things that cost time on the e2e, written down so they do not again

1. **`/session-select` REDIRECTS to `/workout`.** The component is
   `app/session-select/session-select-content.tsx`, but the route of that name is a redirect and the
   early-deload card lives on the **home** tab at `/`. On `/workout` the readiness payload is never
   fetched, so a stub there registers zero hits and the card never renders.
2. **The route is `/api/readiness-score`,** not `/api/readiness`.
3. **The morning check-in sheet covers Home on a fresh profile.** The card renders and its text is in
   the DOM, but `getByRole('button')` returns only the sheet's own controls — the failure reads as
   "the button does not exist", which is a convincing wrong answer. `suppressMorningCheckin(page)` in
   `e2e/fixtures.ts` exists for this and its own doc comment says the same thing happened before.

**Not exercised:** the S25. The eviction is client-side and the spec drives real browser storage, but
the owner's own report was on the APK and this was not re-checked there.
