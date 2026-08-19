# 2026-08-19 — a year-9999 weigh-in no longer owns every "most recent" read (Q-494)

**Branch:** `fix/ingest-date-range-bounds` · **Lane:** Implementation A

## Reproduced first, against a running route

`health-connect/ingest` bounded its `date` by regex — **shape only, never range**. Driven against
`pnpm dev`:

```
before: most-recent confirmed weight -> 2026-08-19, 80 kg
POST {"secret":"…","date":"9999/12/30","weightKg":499}  ->  200 {"date":"9999-12-30"}
after:  most-recent confirmed weight -> 9999-12-30, 499 kg
```

`getMostRecentConfirmedWeightKg` is `ORDER BY date DESC LIMIT 1`, so that answer stands **until the
year 9999** — no later write can outrank it. Two readers use that shape: the BLE scale's confirmation
step, and `deriveActivityKcal`, which multiplies body weight into every activity-calorie estimate.

**The ranked source merge cannot help**, and the reason is worth keeping: `health-source.ts` ranks per
column *per date*, so it stops a worse source overwriting a better one **on the same day**. A row on a
date nothing else ever writes has no competitor, so even rank-1 `health_connect` wins outright. That
protection is orthogonal to this, not weak against it.

This is not a novel class — it is the one ingest path that never got the guard its siblings have.
`scale-ble/samples` ✅, `oura-ble/samples` ✅, `complete-workout` ✅, `health-connect/ingest` ❌.

## What shipped

`resolveIngestDate` in `packages/shared/src/validation/ingest-clock.ts` — the calendar-date analogue
of `resolveMeasuredAt`, beside it rather than a bespoke check in the route, since three sibling paths
already use that module. The route passes `todayInTz(tz)` and stops constructing the date itself.

**One deliberate deviation from the sibling, and it is the part worth reviewing.** `resolveMeasuredAt`
returns `now` for anything out of window — right for an *instant*, where a reading filed seconds off
is still that reading. This route writes a **daily aggregate** (steps, calories, macros for a whole
day), so re-dating a ten-day-old day onto *today* would merge stale numbers into the day every
"today" and "most recent" read depends on. The past bound therefore clamps to the **boundary day**,
not to today. Reconcile-don't-reject is preserved either way: a 400 would quarantine the outbox
mutation and lose a real reading over a bad clock.

## Verified against the route, after

| request | stored date |
|---|---|
| `{"date":"9999/12/30","weightKg":499}` | today — capture closed |
| `{"date":"2026-02-31","steps":123}` | today — shape-passing non-date |
| `{"date":"2026/08/17","steps":4321}` | `2026-08-17` — control, untouched |
| `{"date":"2020/01/01","steps":7}` | `2026-08-13` — boundary, **not** today |

9 unit cases. Full suite with `DATABASE_URL`: **502 files, 4,266 tests, 0 failed.** `tsc` clean,
`pnpm check:rules` **Ran 49 of 49**.

**A Custom Rules catch worth recording:** the first version put `/^\d{4}-\d{2}-\d{2}$/` inside the
helper. It was *correct* there — it runs after slash-normalisation — but step 13 flags dash-only date
regexes on sight, and fighting a check is the wrong move. The shape test now runs on the **raw** value
with `[-/]`, which is equivalent and unambiguous.

## The residual, stated rather than left to be found

**The date is bounded; the value is not.** A 499 kg weigh-in still lands, now on today, so it owns
"most recent" until the next real weigh-in outranks it. That is a large improvement on *permanent*,
and it is the scope of this entry — but `weightKg` is capped at 500 by the schema, and 500 kg is not a
plausible human weight. Whether the ingest bounds should be plausibility bounds rather than
sanity bounds is a separate question and is **not** filed as one; raise it if a bad reading ever
appears.

**Not exercised:** production, the real Tasker client, anything on device. No migration, no schema
change, no auth change. Local secrets used for the reproduction were written to `.env.local` and
removed again — nothing committed.
