# 2026-09-12 — BF-144: the interruption test moves off exercise names onto the id link

**Branch:** `lane-a/bf144-interruption-test-by-id` · **Agent:** Implementation Lane A

## What was wrong, and it was the reason rather than the outcome

BF-143 fixed a real bug — a session rebuilt inside an existing program skipped its calibration — and
justified its name-keyed lookup with *"`workout_sessions.program_session_id` is NULL on every recent
row … an id join would answer 'never trained' for everyone"*. That measured the **dead** column of
the pair `schema.ts` warns about. The live link is the column named `session_id` (Drizzle property
`programSessionId`) and it was populated the whole time: **62 of 108 rows**, and on 2026-09-11 each
of the owner's four trained sessions carried one while the recreated Lower carried none — exactly
the question the guard needed answered, available directly and ignored.

**This is not a revert.** BF-143's date comparison is what carries the guard and it is correct. What
was wrong was the reason, and a reason left in a comment is what the next reader builds on.

## What shipped

- **`wasProgramSessionTrainedSince`** (`lib/data/postgres/slices/periodization.ts`) — joins
  `exercise_logs` to `workout_sessions` on the id link, scoped to the user, both soft-delete filters,
  `loggedAt >= since`.
- The route (`app/api/ai-periodization/session/[sessionId]/route.ts`) calls it with the session's own
  id and `phaseStartedAt`, and no longer asks `getLastExerciseLogsBatch` anything. The false comment
  is corrected in place.

## Decisions, and why

- **The date comparison stays.** Not redundant with the id: 46 of the 108 rows predate the link and
  carry no `session_id`, so the id alone cannot speak for older history — and the question is about
  training since *this* phase clock, not ever.
- **The program-scoping argument is gone, not dropped.** It was needed because a shared exercise name
  logged under a different program could skip a fresh cycle's AMRAP week. A program-session id
  belongs to exactly one program by construction, so the scope comes for free.
- **`gte`, not `gt`** — a log at the exact instant the phase started is training within it. Pinned by
  its own case, because a boundary nobody tests is a boundary that drifts.
- **The date semantics moved down into the query, so the route test can no longer own them.** They
  are covered against a real database instead, which is a better home for them than a mock that
  agrees with whatever it is told.

## Verification

- 10 DB-backed cases in `lib/data/postgres/__tests__/was-program-session-trained-since.test.ts`,
  including the one that is the whole of BF-144: **two sessions sharing the name "Lower"**, where a
  name lookup answers yes for both and the id answers correctly for each.
- The five BF-143 cases pass unchanged, which was the entry's stated bar — the behaviour was not
  meant to move, only to stop depending on names.
- **Mutation pass — 7 planted defects, 7 killed:** dropping each of the four `where` filters in turn,
  `gte`→`gt` at the boundary, and the route asking since the epoch rather than the phase clock. The
  equivalent control (`row != null` rewritten as `row !== undefined`) survived, as it should.
- Full suite green, lint green, `pnpm check:rules` — Ran 73 of 73, all passed.

## Not done

- **The dead column is still there.** Dropping it is data-losing and is the owner's call; BF-144
  stays queued with a `Gate: owner` and the recommendation written out. The gate went on the entry
  only now, after the startable half was out — putting it there earlier would have parked real work
  behind a question, which is the failure the entry itself was filed to avoid.
- **Not exercised:** no device run (server route, no device path); no production data — the 62/108
  and 46-row figures are the filing session's measurements, re-read from the entry rather than
  re-measured here.
