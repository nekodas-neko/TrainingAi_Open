# 2026-08-18 — "the row you named does not exist" is a 404 now (Q-463 + Q-462)

**Lane A** · branch `fix/not-found-status-across-write-surface` · repository + `app/api` · no
migration, no Kotlin, no APK.

A review probed every `app/api` route with a dynamic segment and a write method, as an authenticated
user with a fabricated UUID. **Five answered 500**, four of them with an **empty body**. One cause
repeated: **16 bare `throw new Error('… not found')`** in `lib/data/postgres/`, and routes with
nothing mapping them, so Next's default handler answered.

| Route | Before | After |
|---|---|---|
| `PATCH /api/injuries/[id]` | `500`, empty body | `404 {"error":"Injury not found"}` |
| `PUT /api/nutrition/meal-types/[id]` | `500`, empty body | `404 {"error":"Meal type not found"}` |
| `PATCH /api/supplements/[id]` | `500`, empty body | `404 {"error":"Supplement not found"}` |
| `POST /api/supplements/[id]/log` | `500`, empty body | `404 {"error":"Supplement not found"}` |
| `DELETE /api/phase-sets/[id]` | `500` | `404 {"error":"Phase set not found"}` |
| `PUT /api/phase-sets/[id]` | **`400`** | `404` — same answer as its DELETE |
| `POST /api/log-exercise` (Q-462) | `500 {"error":"Failed to log exercise"}` | `404 {"error":"Workout session not found"}` |

Why it mattered, each against a rule already written here: the sync client **retries what can never
succeed** (`CLAUDE.md` makes 4xx a poison pill and 5xx a reason to back off and retry); an empty body
makes a client's `res.json()` throw *on top of* the failure so it never renders its error state; and
stack traces from correctly-refused requests pollute `error_events` — the one fault signal nobody
watches, pruned at 30 days and read at every session start.

## The shape

`NotFoundError` in `packages/shared/src/errors.ts` and **one** mapper in `lib/api/route-errors.ts` —
not 16 call sites each remembering.

Three decisions worth keeping:

- **A marker property, not `instanceof`.** The Next server bundle and the rollup worker's separate
  esbuild output can each hold their own copy of the class, and `instanceof` returns false across
  them — silently. There is a test that builds a structural copy and proves the marker still
  recognises it while `instanceof` does not.
- **No separate `NotOwnedError` with its own status**, though the entry named one. A row owned by
  someone else must not be distinguishable from a row that does not exist, or the write surface
  becomes a membership oracle for other users' ids. That reasoning is already written into
  `meal-plans/[id]`, this repo's own reference for the correct shape.
- **The mapper re-throws what it does not recognise.** Clearing correctly-refused requests out of
  `error_events` is the point; swallowing genuine bugs would make that table worse at the same job. A
  bare `Error('Supplement not found')` is *not* a `NotFoundError` — the type is the contract, not the
  message, which is what stops this degenerating into the substring matching that made
  `phase-sets`' DELETE answer 500 in the first place.

**Q-462 keeps its signal.** The ownership refusal on `/api/log-exercise` still logs — as a one-line
warning naming the user and session, not a `reportServerError` stack trace. Dropping the log entirely
would have traded one problem for a blind spot on a cross-user attempt.

## What was deliberately NOT changed

The **seven `DELETE`s that answer 200/204 for an absent row.** They look like the same shape and are
not: `DELETE` is idempotent by convention, the desired end state (row absent) holds, and the outbox is
right to treat it as done. There is a test pinning one of them at 200 so it does not get "fixed"
later. Q-460 differed because there the desired end state was `session_rpe = 7` and it did **not**
hold.

## Verification

- **5 mapper/type tests** and **7 route-level tests**: each of the five at 404 *with a parseable body*
  (four returned nothing before), the phase-sets verbs agreeing on the same condition, and the
  idempotent DELETE still at 200.
- **Mutation-checked**: reverting one throw to a bare `Error` and removing one route's check turns
  **3 of 7** red.
- The existing ownership test now asserts the **type** rather than the message — stronger, since it
  cannot pass by coincidence on wording.
- **Live on `pnpm dev`**: all six statuses above confirmed; and for Q-462, a real cross-user session
  id gives `404`, one warning line naming user and session, and **zero** `exercise_logs` written into
  the other user's session.
- Full suite **495 files / 4,026 tests passed** · `tsc --noEmit` clean · `pnpm check:rules` 38 of 38.

## Failure surfaces NOT exercised

- **The remaining `throw new Error` classes are untouched** — only "not found" was typed. Other bare
  throws (`MEAL_TYPE_HAS_LOGS`, "In use", the `default` phase-set guard) still map by message
  substring where they map at all.
- **The client-side consequence is inferred, not observed.** That a 4xx now quarantines rather than
  retries follows from the outbox's documented handling; no device run confirmed it.
- No device, no Kotlin, no APK.
