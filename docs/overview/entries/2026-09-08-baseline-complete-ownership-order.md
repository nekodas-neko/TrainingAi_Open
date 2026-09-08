# 2026-09-08 — `baseline/complete` verifies before it writes (LA-78)

**Branch:** `fix/baseline-complete-ownership-order` · **Lane:** A · one product-code reorder, two tests.

## The defect

`app/api/ai-periodization/baseline/complete/route.ts` called
`ensureSessionPeriodization(userId, sessionId)` about twenty lines **before** the check that
`sessionId` is in the caller's active program — write-then-verify, which the write-path ownership
discipline says it must not be. Two outcomes, neither of them the 404 the route means to give:

- A **real** `program_sessions` row of the caller's, in a *different* (inactive) program: the insert
  succeeded and left a stray `session_periodization` row for a session no active program contains,
  then the request 404'd.
- A **uuid matching no session**: `program_session_id` carries a foreign key, so Postgres rejected
  the insert. **Verified against the database rather than reasoned about** —
  `insert or update on table "session_periodization" violates foreign key constraint
  "session_periodization_program_session_id_fkey"`. Nothing caught it, so the caller got a framework
  **500** where a **404** was intended.

Never a cross-user hole: every path is scoped to `userId` and the foreign key bounds the rest. A
correctness and error-shape defect, which is why it was filed small rather than urgent.

## The fix

Move `ensureSessionPeriodization` **below** the `programSession`/404 check. The `getActiveProgram`
read that check needs already happened in the same handler, so this costs nothing — it is purely an
ordering change, and the comment left behind records why the order matters.

## Tests

The two cases were deliberately **left out** of #968's PS-39 batch rather than pinning the defect as
correct behaviour; they land here with the fix, in
`lib/__tests__/ai-periodization-program-routes.test.ts`:

- a session from an inactive program answers 404 **and `ensureSessionPeriodization` is never
  called**;
- an id matching no session answers 404 rather than reaching the foreign key.

**Both fail against the pre-fix route and pass against the fixed one** — checked by reverting only
`route.ts` to `origin/main` while keeping the new tests, which is the ordering that actually proves
the fix is load-bearing. (Stashing reverts both halves and proves nothing; that was the first
attempt.)

## Notes

- Found while writing #968's tests, filed there, fixed here — one PR per thing.
- No version bump or changelog entry: nothing user-visible changed. The affected requests are ones
  the app's own client never sends, and the app-facing behaviour (a valid session completing its
  baseline) is unchanged.
