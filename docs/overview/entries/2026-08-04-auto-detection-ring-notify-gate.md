# 2026-08-04 — Ring-confirmed activity detection gets the notify gate AD-1 already had (Q-68)

**Branch:** `fix/auto-detection-ring-notify-gate` · **Domain:** cardio · devices

## What was wrong

Two paths can start an auto-detected walk/run:

- **AD-1, sensor fallback** — already ran the "Activity detected" ping behind `shouldNotifyActivity`
  (≥200 m **and** ≥90 s of real movement).
- **AD-2, ring-confirm** — fired the same notification the instant cadence confirmed, with **zero**
  distance corroboration.

AD-2 is the path actually active whenever the ring is connected, i.e. the common case. The owner
saw *"Recording your walk or run"* fire in the same minute as a scale weigh-in.

Both now run behind the same gate.

## The design point: veto, not requirement

A genuine indoor walk can have **no GPS fix at all**, and that is precisely the case AD-2 was built
to handle better than GPS. Requiring GPS distance would have silently broken it — trading a
false-positive notification for a false-negative on the feature's whole reason for existing.

So `shouldNotifyRingConfirmedActivity` only lets GPS **override** the cadence confirmation:

| GPS points | behaviour |
|---|---|
| 0 or 1 | trust the ring — unchanged |
| ≥2, and they show real movement | notify |
| ≥2, and they show you barely moved | **veto** |

One point is a position, not a distance, so two is the floor for judging.

The session itself still **starts and records** on ring confirmation either way. This gates only the
notification, exactly as the file's existing comment says AD-1's gate does. Save-path quality
thresholds (`detection-thresholds.ts`) are untouched.

## Verification

Six new tests in `notify-gate.test.ts` (17 total in the file), including the veto case, the real
walk, both no-fix cases, and the one-shot latch.

**Mutation-checked**: flipping the veto into a requirement — `pointCount < 2` returning `false`
instead of `true`, which is the dangerous way to get this wrong and would break indoor detection
outright — fails 2 tests by name.

## What this does NOT fix

The **AD-2 Hz bands are still provisional and uncalibrated** (`gait-classifier.ts`), which is a
separate tracked Known Issue blocked on an owner on-device calibration capture. A rest period
between sets sustaining cadence in the walk band can still *confirm* a phantom walk — it just will
not notify about one when GPS can see you did not move. Worth being clear that this narrows the
symptom rather than fixing the classifier.

## Not verified

**On device.** No GPS, no ring and no native notifications run in the sandbox, so every path here is
covered by the pure predicate only. JS-only — reaches the phone through Railway with no APK.
