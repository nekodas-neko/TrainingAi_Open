# 2026-08-02 — cadence has never been measured, and an empty array was hiding it (Q-47)

_Branch `fix/empty-cadence-series` · PR #1008 · v1.250.10 · domains `activity` / `devices`_

Q-47 was filed in run 1 as *"`cadence_spm` has never been stored, though `cadence_series` has"*.
That premise was mine, and it was wrong. This entry records the correction as much as the fix.

## What the numbers actually say

Run 1 measured production with `WHERE cadence_series IS NOT NULL` and found three rows — against
zero rows with a `cadence_spm` — and concluded the scalar was being computed and dropped. Re-queried
with `jsonb_array_length`:

```
date        pts
2026-07-29    0
2026-07-29    0
2026-07-30    0
```

All three are **empty arrays**, which `IS NOT NULL` happily counts. `cadence_source` is null on all
three as well. Nothing was ever dropped: **cadence has never been captured at all**, on any of the
42 activities.

`summarizeCadence` returns `{ avgSpm: null, series: [], source: null }` as a set when no reading
passes the plausibility gate — the three fields never disagree. The guided-walk save then persisted
that `[]` verbatim, writing a non-NULL jsonb column beside two null scalars. That is the shape that
misled the measurement.

## What shipped

`cadenceFieldsForSave(summary)` in `packages/shared/src/health/cadence.ts` — the single place that
decides what "no cadence" looks like on disk. An empty series becomes `null`; a real one passes
through untouched. `walk-summary.tsx` uses it for both the local upsert and the outbox payload, so
the two stay identical by construction (that file's own comment says it mirrors
`done-activity-screen`'s contract exactly).

`activity-store.ts`'s path already guarded on `avgSpm != null` and never wrote the empty array, so
the guided walk was the only leak — but the decision now lives in one function rather than in a
guard one call site happened to have.

Three unit tests: empty summary → all three columns null; no summary at all → the same; a real
summary passes through with its spm, source and series intact.

## What is NOT fixed — and why it cannot be here

**Why zero readings were ever captured is still open, and it needs the device.** Both cadence
sources are native BLE — the ring's gait feed (`subscribeGateFeed`) and the Polar strap's
accelerometer (`setAccStreaming`) — and neither exists in the sandbox. Two hypotheses, recorded on
the backlog entry in priority order:

1. **The strap was not connected.** All three walks fall on 2026-07-29/30, inside the window of the
   Q-40 bug where the chest-strap card sat on "Connecting…" indefinitely (fixed in #997, needs the
   new APK).
2. **The ring alone cannot supply enough.** `onRingWindow` keeps only the newest window per drain
   burst and drains are hourly, so a 30-minute walk yields at most ~1 ring reading even when
   everything works.

A device check is on the owner checklist: wear the strap, walk 10+ minutes, and report whether the
live cadence readout ever shows a number. A plain yes/no separates the two hypotheses. Until it
runs, `isPlausibleCadence`'s 60 spm floor stays untouched — Q-41 finding 4 wanted it tuned, and
tuning a gate nothing has reached is not a fix.

## Not exercised

The capture path itself, for the reason above. The persistence change is pure TypeScript verified by
unit test; no native, safe-area or migration surface is touched, and the three existing production
rows are left as they are (an empty array holds no information worth a migration to erase).
