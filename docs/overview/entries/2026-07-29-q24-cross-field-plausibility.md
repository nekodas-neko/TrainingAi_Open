## 2026-07-29 — Q-24 §7: the last six ingest surfaces, and Q-24 closes

**Branch:** `fix/q24-cross-field-plausibility` · Q-24 §7 remainder · **Q-24 is now fully done**

`log-exercise` landed earlier today (#898). This is the other six.

### The shape of the class

Every one of these routes bounds its fields. None of them was wrong about any single field. The
defect each time is a relationship the per-field bounds cannot express: a distance against a
duration, a stage total against the night that contains it, a timestamp against the session it
belongs to, an RR set against the bpm measured off the same heartbeat.

### Reject, skip, or reconcile — decided per surface

Not every bad payload deserves the same answer, and getting this wrong is how the codebase has
wedged itself before:

- **`fitness-tests` — reject (400).** A single interactive save. The user is present, and a bad one
  is worth telling them about.
- **`sync-health` — skip the record, keep the batch.** The Health Connect aggregator re-sends the
  same window on every sync, so 400-ing the payload over one impossible record wedges the sync
  permanently (the poison-pill class, G-2). The reasons ride back in a new `rejected[]` field
  instead. Also added: a `Number.isNaN` guard on `sleepStart`/`sleepEnd`, which were only checked
  for being non-empty strings and reached the driver as Invalid Date.
- **`complete-workout` — reconcile, never reject.** A 400 here quarantines the outbox mutation and
  the workout is simply never marked complete. Losing a real session over a bad clock reading is
  worse than an approximate timestamp, so an unusable `completedAtMs` falls back to server time —
  exactly what the route already did when the field was absent. An offline replay from days ago
  still keeps its own timestamp: it is after `startedAt` and not in the future.
- **`scale-ble/samples` — reject the weight, clamp the clock.** 0 kg is a decode fault and there is
  nothing to salvage. But the weight on a late-arriving reading is real data captured off physical
  hardware, so `measuredAt` outside a 7-day window is replaced with server time rather than
  discarding the weigh-in.
- **`hr-ingest` — drop the sample, keep the flush.** Same poison-pill reasoning as sync-health; the
  route's existing comment already made this call and it is preserved.

### The metrics PATCH needed the row

`activity-logs/[id]/metrics` had **no maxima at all**, and the rate checks need a duration the patch
never carries — it lives on the row being enriched. So the route now reads the log and checks the
patch *merged over it*. That is the only way a 30-minute walk rejects the 420 km someone fills into
it. This is the one place a new repository method was added (`getActivityLogById`, ownership-scoped).
The route also gained a rate limiter and uuid validation on the path param, both of which it lacked.

### Two things the RR walk was doing

`rr` is `z.number().int()` — negatives allowed. The backwards cursor walk subtracted every reported
interval unconditionally, so a **negative** artifact walked the cursor *forward* past the packet
timestamp, planting later beats in the future where the `inWindow` filter (which only ever sees
`s.at`) could not reach them. The cursor now only moves on an interval that could be real elapsed
time — with a ceiling far above the RR band, because a 5 s gap is not a heartbeat but is still real
time and must still move the cursor.

Separately, `bpm` and `rr` measure the same heart and were never compared. `rrContradictsBpm` drops
the RR set (not the bpm) when they disagree by more than ±50%, because RR is what feeds HRV, where a
wrong value is not visibly wrong on any screen. The tolerance is wide on purpose: the strap's bpm is
smoothed while the intervals are instantaneous, so they legitimately diverge through a hard interval.

### Verification

Full suite **2,730 passing, zero failures**; `tsc`, lint and `check-push-mutations` clean. 30 new
tests across two files.

Every one of the six routes was then exercised against a running `pnpm dev` with the result checked
in Postgres, not just by status code:

- `fitness-tests`: 100 km in 1 s → 400; a real 520 m / 360 s walk test → 201.
- `sync-health`: a payload mixing good and bad → 200 with three entries in `rejected[]`
  (`distance implies 25200 km/h`, `stages total 96.0 h inside a 1.0 h window`, `unparseable
  sleepStart/sleepEnd`); the DB shows the good walk and the good night stored and nothing else.
- `activity-logs/…/metrics`: 420 km into a 32-minute walk → 400 `distance implies 788 km/h`; a
  150 kcal backfill → 200; unknown id → 404; non-uuid → 400.
- `complete-workout`: `completedAtMs` a year before `startedAt` → stamped server time; `1e20` →
  stamped server time (never Invalid Date); a legitimate value 10 minutes old → stored exactly.
- `scale-ble/samples`: 0 kg → 400; a real weight dated 2019 → stored with `measured_at` clamped to
  now.
- `hr-ingest`: a packet of 300 ms intervals reporting 60 bpm contributed **no** RR rows; a packet
  containing `-600000` stored its beats one second apart with **none** in the future.

### Noted, not fixed

- `sync-health` 500s on an exercise session whose `activityType` is not in the seeded
  `activity_types` table (FK violation). Pre-existing, unrelated to this change, and it surfaced
  only because the QA payload used `walking` instead of `walk`.
- `scale-ble/samples` writes `body_metrics` keyed on `todayInTz(tz)` while the raw sample keeps
  `measuredAt`, so a reading queued offline yesterday lands on today's row. Bounding `measuredAt`
  makes this visible but does not cause it; changing the keying is a behaviour change beyond this
  fix.

### Not exercised

No APK run. The offline `pushMutations` branches for these domains are only reachable on device,
and the two BLE ingest routes are driven by the native foreground services.
