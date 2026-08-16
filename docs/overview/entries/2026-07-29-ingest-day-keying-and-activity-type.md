# 2026-07-29 — a weigh-in filed on the wrong day, and an unseeded activity type losing a whole flush

Branch `fix/ingest-day-keying-and-activity-type`. Closes backlog **Q-25** (a) and (b).

Both were found during the on-server QA of Q-24 §7 and recorded rather than dropped. Neither was
caused by those fixes.

## (a) `sync-health` 500'd on an unseeded `activityType`

`activity_logs.activity_type` is an FK into `activity_types`. The Health Connect aggregator sends its
own vocabulary — `"walking"` where the seeded id is `"walk"` — and the unguarded
`repo.saveActivityLog` at `app/api/sync-health/route.ts` threw straight out of the exercise loop.

The route already had a `rejected[]` path for implausible records; this was the same poison-pill shape
arriving through a different door, and it took the **whole flush** with it.

**Measured before the fix**, one request carrying an unseeded record and a valid one:

```
http=500
activity_logs written: 0        ← the valid sibling was lost too
```

**After:**

```
{"ok":true,"rejected":["exercise 2026-07-20 07:00: unknown activityType \"walking\""]}
http=200
activity_logs: 2026-07-20 | walk | Good | 09:00:00   ← the valid sibling survives
```

The unknown id is **checked against `listActivityTypes()`** rather than caught from the driver, so a
genuine DB fault still surfaces as a 500 instead of being silently downgraded to a skipped record.

## (b) The scale filed the weigh-in on the day it was *received*

`app/api/scale-ble/samples` archived the raw sample under its real `measuredAt` but keyed the
`body_metrics` trend row on `todayInTz(tz)`. `resolveMeasuredAt` accepts a `measuredAt` up to
**7 days** old, so a reading captured while the phone was offline and pushed later landed on today —
overwriting today's weight and leaving its own day blank.

Both the day-of-write and the "first reading of the day" check (`hasConfirmedScaleTrendForDate`) now
key off `toAestDay(measuredAt, tz)`. They must agree, or a second backdated reading would silently
overwrite the first.

**The sibling surface had the identical bug and is fixed in the same PR:**
`app/api/scale-ble/pending/[id]/confirm/route.ts`, where it matters *more* — a pending reading is
confirmed by hand some time after capture, so "today" is routinely the wrong day for it. The stored
sample already carries `measuredAt` (`ScalePendingSample.measuredAt`), so no schema change was needed.

**Verified end-to-end** against the local dev DB — today (07-29) holding a real manual 83.0 kg, then a
weigh-in actually taken on 07-28 pushed in:

```
before:  2026-07-29 | 83   | manual
after:   2026-07-28 | 82.5 | scale_ble     ← its own day
         2026-07-29 | 83   | manual        ← untouched
```

The backlog flagged that this "wants a moment's thought about the anomaly-staging flow that reads the
weight back". Checked: the anomaly gate compares against `getMostRecentConfirmedWeightKg`, which is
not day-keyed, so changing the upsert day does not perturb it. (A first attempt at this manual test
was invalid — the 99.9 kg fixture I set up was 17.4 % from the pushed reading and tripped the 15 %
anomaly gate, so the reading staged as `pending` and never reached the write path at all. Re-run with
a realistic delta.)

The response field `isAdditionalReadingToday` is renamed `isAdditionalReadingForDay`, since it no
longer means "today". Grep confirms no consumer in-repo, and the APK is a WebView over this same JS,
so there is no out-of-tree caller to break.

## Tests

Nine added, each confirmed **red without its fix**:

- `app/api/__tests__/sync-health.test.ts` — the unknown id is rejected not thrown; a valid sibling in
  the same flush still writes; a seeded id is unaffected.
- `app/api/__tests__/scale-ble-day-keying.test.ts` (new) — asserts the day that reaches
  `upsertBodyMetrics`, and that the trend-check is asked about the *same* day it writes. Route-level
  deliberately: the first draft tested only the date helper and would have passed against the broken
  route.
- `lib/__tests__/sensor-ingest-reconciliation.test.ts` — local-day resolution including the
  before-10am-Brisbane case, and that the out-of-tolerance fallback to `now` still resolves to now's
  local day.

Full suite, `tsc --noEmit`, eslint, `check-push-mutations`, `check-reconcile` all clean.

The repo's own lint rule caught a `toISOString().slice(0,10)` I had written in a test purely to
contrast the wrong answer — correctly, since the pattern shouldn't exist anywhere to be copy-pasted.
Rewritten as `toAestDay(resolved, 'UTC')`, which makes the same point through the sanctioned helper.

## Not exercised

Server routes only — no device path, no APK rebuild, no migration. The scale and Health Connect
ingests were driven with synthetic payloads against the local DB, not from the real scale or the real
aggregator; the aggregator's actual `activityType` vocabulary beyond `"walking"` is unknown, so other
unseeded ids will now appear in `rejected[]` rather than being written. That is the intended
behaviour, but it means **a type the owner expects to see logged may now show up as rejected instead
of silently 500ing the flush** — worth a glance at the `rejected[]` array after the next real sync.
