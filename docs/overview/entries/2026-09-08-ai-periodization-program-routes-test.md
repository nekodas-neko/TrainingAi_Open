# 2026-09-08 — the program-level ai-periodization routes get tests (PS-39)

**Branch:** `test/ai-periodization-program-routes` · **Lane:** A · tests + docs only, no product code.

## What shipped

`lib/__tests__/ai-periodization-program-routes.test.ts` — 30 cases across the four remaining
`ai-periodization` routes: `baseline/complete`, `session/[sessionId]/transition`,
`program-overview` and `weekly-volume`. Batched because they are the program-level half of the
feature whose session routes landed in #966, and they verify alongside it. **Every
`ai-periodization` route now has a test that imports its handler.**

Three carry a decision invisible from the response shape:

- **`baseline/complete` seeds from typed starting numbers, not only earned ones.**
  `personal_records` is log-derived, so a brand-new user has none — the 1RMs they entered in the
  program builder live in `exercise_estimates`. Without that fallback the skip-baseline flow was
  unreachable for exactly the users it exists for (Q-5). Each source is tagged (`existing` vs
  `estimate`) so the prescription prompt can tell an earned number from a typed one, and an earned
  record outranks a typed one for the same exercise.
- **A completed transition leaves the slot `'consumed'`, not `'none'`.**
  `isAiPrescriptionPending` keys on exactly that value; `'none'` matched nothing, so accepting a
  transition emptied the card with nothing left to refill it (owner report, 2026-08-02). Pinned
  along with the ordering — `advancePhase` writes `'none'` itself, so the status must be written
  after it.
- **`weekly-volume` normalises muscle names on both sides and SUMS the collisions**, because a
  target row edited by hand can carry a synonym of one the defaults already wrote.

Also pinned: the transition's phase graph (each adjacent step allowed, a jump refused with the
`force:true` override named, a jump the stored prescription actually recommended allowed, and a
prescription recommending a *different* phase not treated as permission); `weekly-volume`'s
ownership check on a supplied `programId` before any target is read, its active-program fallback,
and its Monday-to-Sunday window in the user's timezone; `program-overview` healing the stored phase
counts before reading them, pairing state by session id rather than position, and counting days
since the last *completed* session rather than one still in progress; and `baseline/complete`
refusing a second completion (409), refusing an empty anchor with `no_prior_data`, and surviving a
prescription generation that fails, because that call is best effort.

`scripts/check-route-test-coverage.js` baseline 124 → **120**.

## Found doing it — LA-78

`baseline/complete` calls `ensureSessionPeriodization` about twenty lines **before** it checks the
session is in the caller's active program. Verified against the local database rather than reasoned
about: `program_session_id` carries a foreign key, so an unknown uuid raises
`violates foreign key constraint "session_periodization_program_session_id_fkey"` — uncaught, so the
caller gets a framework **500** where the route means to answer **404**. A real session of theirs in
an *inactive* program takes the other branch and leaves a stray row before the 404. Not a cross-user
hole; every path is scoped to `userId` and the FK bounds the rest. The fix is a three-line reorder.

Filed rather than fixed here, so this PR stays one thing. The two cases were deliberately **left out**
of the test file rather than pinning the current behaviour as correct — the entry names them for
whoever takes the fix.

## Notes

- **Nineteen mutations, all caught**: dropping the estimate fallback, letting an estimate outrank a
  record, completing with an empty anchor, allowing a second completion, making the generation
  failure fatal, unstricting the schema, `'none'` as the post-transition status, allowing any jump,
  ignoring which phase was recommended, shifting the adjacency table, reading before healing,
  counting an unfinished session as trained, pairing state by position, skipping the program
  ownership check, dropping the muscle normalisation, overwriting instead of summing, ignoring the
  timezone, a 7-day week, and dropping `no-store`.
- **`vi.clearAllMocks()` clears calls, not implementations.** A `mockRejectedValue` on the stubbed
  `fetch` leaked from the best-effort-failure case into the success case, which then read as a
  failure. `mockReset()` plus a re-set default in `beforeEach` fixes it — worth remembering wherever
  one case deliberately makes a shared stub throw.
