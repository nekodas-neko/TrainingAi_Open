# 2026-08-02 — activity payload hardening: two fixed, two answered by production (Q-41)

**Branch:** `fix/activity-payload-hardening` · **Version:** 1.250.4 · Run-list item 8 of the
[batch queue drain](../../handoff-2026-08-02-platform-batch-queue-drain.md), continuing
[run 1](../../handoff-2026-08-02-platform-batch-queue-drain-run-1.md).

Four findings the Q-36 investigation surfaced and deliberately left out of its fix. Two were
implementable, one needs the owner, and one turned out to be asking the wrong question.

## Finding 2 — fixed: every activity type now saves HR, not just treadmill

`done-activity-screen.tsx` gated `avgHr`/`maxHr` on `activityType === 'treadmill'`, so every GPS run
and walk wrote null HR.

The fix is smaller than the entry implies. A mount effect **already** fetches
`/api/oura/hr-window` for every activity type — for the route-map colouring — and that response
already carries `avgHr` and `maxHr` (`hr-window/route.ts:74`). It was reading `readings` and
throwing the other two fields away. So this captures them from a response we had already paid for
and uses them at save time for all types, with the treadmill handler's own values still winning
when the user typed a distance (that is what they just saw on screen).

Read synchronously from state at save time — the fetch happened on mount, so the save stays instant
and nothing is awaited before the local write.

**Production shows the entry's mechanism was inverted.** 15 of 30 walks and 2 of 7 runs *do* carry
HR — from the Health Connect enrichment path — while **0 of 2 treadmill rows do**, the one type the
code path was written for. So the gate was not the only thing failing; it was masking how patchy
the coverage already was.

## Finding 3 — fixed: a zero-distance activity no longer rejects the whole payload

`distanceKm: z.number().positive()` on `/api/activity-logs/[id]/metrics`. A GPS activity with two
or more points that never moved computes exactly `0`, which `omitNullFields` does not strip, so
`.positive()` rejected the entire payload — HR and calories with it. Now `.nonnegative()`, with
tests for the zero case and for the negative/oversized cases still rejecting.

`caloriesBurned` deliberately keeps `.positive()`: a zero there means "not measured", and the
underlying UPDATE only fills nulls.

## Finding 4 — the 60 spm floor is untestable, because cadence has never been stored

The entry asked whether the floor rejects real slow walks, and said to check against the owner's
stored walks. Production:

```
activity_logs: 42 rows (30 walk, 7 run, 3 other, 2 treadmill)
rows with cadence_spm: 0
rows with cadence_series: 3
```

**Not one activity row has ever carried a `cadence_spm` value**, while three carry a
`cadence_series`. So the floor has never rejected a real walk — and the more interesting question
is why the scalar is null on rows whose series is populated. That is a different bug from the one
the entry describes, and changing the floor now would be tuning a gate nothing has ever passed
through. Re-filed as **Q-47** with the numbers.

## Finding 1 — needs the owner, not a default

`getCalendarData` reads `activity_logs` from Postgres, so a locally-saved activity is invisible on
the training calendar until it syncs. The entry is explicit that this needs a decision — merge
local rows into the calendar, or record it as a second sanctioned server-aggregate exception
alongside `home-day-timeline`. Both are defensible and they lead to different architectures, so
picking one here would be substituting my judgement for a call the entry reserves. Added to the
owner-decisions list in the batch handoff, and Q-41 stays open carrying only this finding.

## Verified

- Full suite green, lint and typecheck clean, custom rules pass.
- Four new tests on the metrics route covering the zero, negative, oversized and zero-calorie cases.

## Not exercised

**The finding-2 change was not run against a real GPS activity.** Doing so needs the whole
activity-tracking flow (location permission, a moving device) — it does not exist in the sandbox.
What is proven: the endpoint returns `avgHr`/`maxHr` (read from its source), the effect that fetches
them already runs for every activity type, and the save path reads them synchronously. What is not:
that a real run or walk ends with non-null HR on the row. A `projectOverview.md` Known-Issues row
says so, and it is on the owner device checklist.
