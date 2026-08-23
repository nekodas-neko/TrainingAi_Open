# 2026-08-20 — a workout duration keyed by a name that is not an identity (Q-362a)

**Branch:** `fix/day-log-workout-durations-key` · **Lane A** · closes **Q-362a**, files **LA-15**

## What was wrong

`/api/day-log` built `workoutDurations` in a loop writing `workoutDurations[ws.sessionName]`. Two
`Push` sessions on one Brisbane day therefore produced **one** key holding only the later window —
the earlier session's duration gone, not merged. Reproduced against `pnpm dev` before this change,
and pinned here by a test that asserts both windows.

The `exercises` array beside it already carried the correct `workoutSessionId` on every row, which is
what made the fix cheap: every consumer already has the id to hand.

## Why it shipped additively, which is the part worth reading

The obvious fix — change the key — is a **response-shape change**, and three Lane B surfaces read
this record by name (Q-362b). Switching it outright would have left all three showing *no duration at
all* for however long the two lanes' PRs were apart. That window is unbounded: it depends on when
another agent picks its entry up.

So the route now emits **`workoutDurationsById`**, keyed by `workout_sessions.id`, *beside* the legacy
name-keyed record, which is untouched and still collides. Nothing breaks on merge, Q-362b can land
whenever it lands, and **LA-15** removes the legacy half afterwards — expand, migrate, contract. The
deprecated field says all of this on the type, where the next reader will actually be standing.

This also unblocks Q-362b rather than sequencing it: its entry now says to read the new field, so it
has no coordinated-merge requirement at all.

## Measured

| | before | after |
|---|---|---|
| keys for two same-named sessions | **1** (`Push`, later window only) | **2**, one per session id |
| earlier session's window | lost | `9:00am → 9:41am, 41 min` |
| later session's window | `5:00pm → 5:41pm, 41 min` | unchanged |
| legacy `workoutDurations` | 1 colliding key | 1 colliding key, deliberately unchanged |

3 tests, **mutation-verified** — re-keying the new record by name turns two of the three red.

The fixture derives its date from the clock and anchors the two sessions at 09:00 and 17:00 local,
per the repo's own rule: a hardcoded date is a time bomb with a known detonation date, and midnight
is the boundary where an off-by-one stops being visible.

**One assertion was wrong before it was right, and it is worth recording why.** The first version
asserted `early.start < late.start`. Those are `fmtAest` strings — `"9:00am"` and `"5:00pm"` — so the
comparison is lexical and `"5:00pm"` sorts first. The test failed, the code was correct. It now
asserts both exact windows, which is stronger than an ordering anyway.

## The gate

`tsc` clean · `pnpm lint` **0 errors** · **Ran 50 of 50** Custom Rules steps · `pnpm build` clean ·
full suite green.

## Also in this PR

**LA-14's own heading was malformed** — it contained the route path `/food-logs/[id]`, and
`next-item.js` parsed the `[id]` as a domain tag, printing the entry as `[platform][id]`. Renamed. A
tag that does not exist is exactly the kind of thing that survives because nobody reads it twice.

## Not exercised

The S25 APK, and **the three consuming surfaces are untouched by this PR** — they still read the
legacy record and still render one merged duration for two same-named sessions. That is Q-362b, and
it is Lane B's.
