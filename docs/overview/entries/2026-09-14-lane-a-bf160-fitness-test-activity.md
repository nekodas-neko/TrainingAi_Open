# 2026-09-14 — a fitness test now logs the activity it was (BF-160)

**Branch:** `lane-a/bf160-fitness-test-activity` · **Lane:** A · Entry **BF-160**, filed by BugFix
intake from the owner's 2026-09-14 Cooper run. Asked whether the test should count, he answered
*"Yes it should count."*

## What was wrong

`computeActiveEnergy` has exactly three sources — strength sessions, logged activities, passive
steps — and a fitness test was none of them. `handleSave` in `components/fitness-tests/test-result.tsx`
wrote one row, to `fitness_tests`, and nothing downstream of the calorie budget reads that table. So
1,975 m in twelve minutes at an average of 156 bpm contributed **nothing** to the day's earned
calories, on the same screen BF-152 and BF-154 had just finished anchoring to measured movement.

**The half that hid it.** Zone minutes come from `oura_heartrate` via `getZoneMinutesRange`, so the
strap's 581 samples in the top zone *were* credited automatically. The test therefore looked counted
until someone checked the budget specifically — HR-derived credit flows without an event row,
event-derived credit does not.

**The steps path did not rescue it either.** `body_metrics.steps` read 894 for the whole day, fewer
than a 1,975 m run produces on its own, so the pedometer had not seen the effort.

## What shipped

`activityType` is now a field on `FitnessTestProtocol` — `run` for Cooper, `walk` for the 6MWT, null
for `resting_hrr` (sixty seconds of effort inside three minutes of sitting is not a cardio session).
Declared per protocol rather than switched on the id, so a new protocol row cannot forget to answer.

`buildTestActivity` (`packages/shared/src/fitness-tests/test-activity.ts`) turns a capture into the
activity it is worth, or null. `test-result.tsx` writes that row to the local store and queues an
`activity_logs` outbox mutation beside the test's own, then invalidates both cache groups — before
the push for its own screens and again after it, via `pushThenRevalidate`.

Three decisions inside the builder, each with a test:

- **It never consults the VO₂max.** BF-158, which shipped hours earlier, withholds the score when the
  distance cannot be real. The effort still happened, so the calories are still owed; gating one on
  the other would make a failed GPS fix cost the day's budget as well as the score.
- **A zero distance is omitted, not sent.** `ActivityLogBody.distanceKm` is `.positive()`, and a
  rejection on the sync-push path lands in `errors[]` — a dead letter, not an error the user sees.
  Confirmed against the running route: the omitted shape answers **201**, `distanceKm: 0` answers
  **400**.
- **No activity for a capture with no duration**, so a screen opened and closed leaves no row.

The activity write sits in its own `try`/`catch` *after* the test's. An uncaught throw there would
fall into the outer catch and re-POST the already-saved test to the API fallback under the same id.

## The double-count the entry warned about does not exist, and that was checked rather than assumed

`computeZoneQuota`'s only actual is `getZoneMinutesRange`, which reads the `daily_zone_minutes`
cache built from HR samples. An activity row is not an input to it at any point, so creating one
cannot add a second helping of the same minutes.

The overlap that *is* real is steps, and `computeActiveEnergy` already handles it: a logged `walk`,
`run` or `hike` has its step-equivalent subtracted from the passive total. Here that takes the
passive term to **zero** — 1.98 km implies more steps than the whole day recorded — so the change is
not purely additive, and the run's own estimate becomes the entire credit.

## Verification

Full gate green. **Mutation pass: six mutants, all killed** — the `activityType` guard, the duration
guard, `distanceM > 0` widened to `>= 0`, `captureDistance` ignored, minutes rounded to whole, and
Cooper re-declared as a walk. One deliberately equivalent control (`/60_000 * 10` rewritten as
`/6_000`) survived, as it should.

Driven against `pnpm dev` and the local database, signed in as the seeded user:

| probe | result |
|---|---|
| `/baselines` compiled and served with the new client imports | **200** |
| Cooper payload exactly as the builder emits it | **201**, row stored |
| 6MWT payload | **201** |
| distance omitted (GPS gave nothing) | **201** |
| `distanceKm: 0` — the shape the builder avoids | **400** `Invalid body` |
| `activeEnergyKcalToday` with the three rows present | **122** |
| the same after deleting them | **0** |

That 0 → 122 is the whole point of the entry, measured on the live path rather than argued. **The
number itself is not the production one**: this machine has only the synthetic MET fixtures, where
`hasRealConstants()` is false, so the magnitude assertion in the unit test is skipped in CI too. The
structure is CI-verified; the size of the credit is not, on any machine in this repo.

**Not exercised:** no device path or APK. The capture itself — GPS distance, strap HR, the Finish
tap — cannot be driven in the sandbox, so the one thing never run end to end is the flow a person
actually uses. BF-160's own verification step stands and is recorded in `projectOverview.md`: run a
protocol on device, confirm one activity appears in cardio history with the right duration and
distance, that the day's earned calories rise, and that the zone quota does **not** jump.
