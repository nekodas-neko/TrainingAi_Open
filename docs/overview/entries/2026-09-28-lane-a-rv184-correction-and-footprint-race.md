# 2026-09-28 — RV-184 re-verified and corrected; a racing footprint test fixed

## RV-184: the fix it prescribed would have found nothing

RV-184 said the AI prescription regenerates at workout open on days the completion already generated
one, and prescribed adding three fields to the logged fingerprint. Checked against current `main`:

- Completion no longer generates anything. `packages/shared/src/workout/complete-workout.ts` marks the
  slot `consumed`; the old in-process regenerator is gone, so the next open has to regenerate.
- `excludeSessionId`, the parameter that would name the completion trigger, is passed by no caller.
- `ai_call_log.fingerprint` is stored as a hash, so extra fields cannot make a trigger readable.

The production log agrees with the current design: one call per workout day, and a second for the
same session 35-60 minutes later when the app is reopened after training. The one anomaly is a pair
7 seconds apart on 09-16, inside the 30-second cooldown. The entry now points at that instead, and
records `excludeSessionId` as a dead parameter.

## A racing test

`storage-footprint-real-counts.test.ts` failed once in a full local suite with `expected 211 to be
210`, and passed 6/6 alone. It compared a live `count(*)` of `oura_raw_samples` against a second
reading, and other test files insert into that table at the same time. Both assertions are now `>=`.
**Checked that this still catches the bug it exists for:** restoring the BF-54 estimate
(`n_live_tup`) in `getOuraStorageStats` makes it fail, because a stale estimate is below the real count.
