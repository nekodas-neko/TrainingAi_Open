# 2026-09-17 — `fix/lb116-checkin-sends-suggested-sore`

**LB-116** — the check-in sheet knew which sore ticks it had suggested and threw it away. v1.457.10.
Also removes **BF-172** from the queue, which #1268 shipped and left sitting with a ✅.

BF-173 shipped the engine: `mood_logs.suggested_sore_muscles` (migration 276), the repository write,
and a scorer that clamps only ticks *not* in that list. The sheet computes the list already — it is
the `suggested` state the pills are drawn from — and never sent it.

`suggestedSoreMuscles: suggested` now goes on `leanPayload`, which is what reaches all three writes:
`store.upsertMoodLog`, `store.queueMutation` and the `/api/mood` fallback POST. The optimistic
`MoodLog` carries it too, so the card behind the sheet does not flash a different shape.

## It touched a Lane A path, deliberately and narrowly

`MoodFieldsSchema` (`packages/shared/src/validation/mood-log.ts`) had to gain the field. The schema
has **no `.strict()`**, so Zod drops an unknown key rather than rejecting it — without that edit the
sheet's value would have been silently stripped on both the route and the outbox branch, and the fix
would have shipped inert with a green test suite and a 200 response.

One optional field, bounded like its sibling, named by the entry and delegated by the lane that owns
the file. Unlike OR-118 — where the missing piece was a whole route and the work was parked — this is
a single key with the column, the write and the scorer all already shipped. Flagged here rather than
done quietly.

## The e2e was written, run against `main`, and deleted

A browser test that saves a check-in and reads `mood_logs.suggested_sore_muscles` back **passes
against unfixed `main`**. `saveMoodLog` derives the list when the caller sends none, so the column is
non-null either way and the assertion cannot tell the sheet's value from the server's guess.
Distinguishing them needs control of the recovery feed the harness does not have.

Deleted rather than shipped green. A vacuous test is worse than none because it answers. The unit
test carries the proof instead: **4 of its 6 assertions fail against `main`**, including a real
`MoodFieldsSchema.parse` round-trip — exactly the strip this fix is about — plus bounds checks and an
assertion that the field stays optional so `saveMoodLog`'s fallback keeps working for older clients.

**Three harness traps cost time here and are worth naming**, because each reads as "the sheet did not
open": the morning check-in is a separate Radix modal that marks everything behind it `aria-hidden`
(suppressing it does *not* seed a mood row, so the readiness card still appears); the sheet
auto-opens when there is no mood row, so the "Log Readiness" card is a fallback path rather than the
way in; and **the muscle pills are `role="checkbox"`, not `button`**, so a button query finds nothing
at all.

## What was verified

- `components/__tests__/lb116-checkin-sends-suggested-sore.test.ts` — 4 of 6 fail against `main`.
- Full suite **7607 passed**, `pnpm check:rules` **Ran 75 of 75**, test-typecheck none above
  baseline, lint 0 errors, build clean.

**NOT exercised: the two cases that motivate the entry.** Neither the volunteered-muscle-that-would-
have-qualified case nor the offline check-in is covered by any test — the first needs a controlled
recovery feed, the second needs the device. The engine half's own tests
(`sore-muscle-provenance.test.ts`) pin what the scorer does with each input; what is untested is the
sheet producing the right input in those two situations.
