# 2026-08-05 — Ring and strap notifications: quiet by default, loud when the battery is actually low

**Domain:** platform · devices — v1.259.0, **native — needs the new APK**

Q-67 quieted the scale's ongoing notification and deliberately left the identical ring and strap
ones alone, flagging them back to the owner rather than guessing. The owner's answer was better than
the question: **quiet them too, but not unconditionally — surface the battery when it drops below
~35%.**

## Why this needs two channels, not one

A `NotificationChannel`'s importance is fixed when the channel is created and cannot be raised for
an individual notification. So "quiet normally, loud when low" cannot be one channel that changes
its mind. It is:

1. **Ongoing status channel → `IMPORTANCE_MIN`** (new id, legacy deleted on first run). No
   status-bar icon, collapsed to the bottom of the shade. Android requires *a* notification while a
   foreground service runs, so it cannot be removed — only made unobtrusive.
2. **A separate one-shot "battery low" channel → `IMPORTANCE_DEFAULT`**, posted only on the
   downward crossing. Same shape as the scale's "Weigh-in logged".

Both channel ids had to change (`oura-ble` → `oura-ble-v2`, `polar-ble` → `polar-ble-v2`) for the
same reason as the scale: Android will not retroactively lower an existing channel's importance, so
an upgraded install would have kept the old `IMPORTANCE_LOW` channel and nothing would have changed.
The legacy ids are deleted rather than left as orphans in notification settings.

## Hysteresis is the feature, not an edge case

**The ring polls battery every 5 minutes** (`KEEPALIVE_MS`). A naive `if (percent < 35) notify()`
would post **288 notifications a day** on a low ring — strictly worse than the always-on
notification this change exists to quieten.

So `DeviceBatteryNotifier.decide` fires once on the way down and re-arms only above a **higher**
mark (40%), not at 35%. A single threshold would let a reading hovering on the boundary alternate
armed/fired and notify on every other poll. Between 35 and 39 the decision holds whatever state it
was in.

Charging clears an outstanding alert as well as suppressing new ones — the reading is going up and
the owner is already dealing with it, and clearing it means a later drain warns again. The strap
passes `charging = false` unconditionally: a CR2025 coin cell cannot charge.

The decision is a pure function precisely so it can be tested without an Android runtime. Eight
JUnit cases cover it, including the day-long one:

```kotlin
// 288 polls at 5-minute intervals, battery drifting 45% → 0% across the day
assertTrue("expected exactly one alert across a day of polls, got $alerts", alerts == 1)
```

## Worth having on the strap specifically

The H10's coin cell presents as **flaky connections long before it presents as a dead strap** — the
pairing card already surfaces the percentage for that reason. A low-battery alert turns a confusing
symptom into a known cause. And the strap's ongoing notification matters more since v1.257.0: the
auto-retry restarts that service roughly every 4 minutes while the app is foregrounded and the strap
is off, so "Connecting to strap…" cycles rather than sitting still. At `IMPORTANCE_MIN` that stops
being visible churn.

## Not verified

**Native — no APK, no observation.** Kotlin is compile-gated only in the sandbox (no Android SDK,
Gradle download proxy-blocked). CI's Android job compiles it and runs the JUnit tests; the
hysteresis was additionally re-derived and checked independently before committing. What none of
that proves is how One UI actually renders `IMPORTANCE_MIN`, which has differed from stock AOSP
before.

**On-device checks:**
1. Ring and strap ongoing notifications lose their status-bar icons and sit collapsed.
2. The one-shot alert fires when either device is genuinely below 35% — and **does not** repeat on
   the next poll five minutes later. This is the one worth watching for a full day.
3. The scale's behaviour from v1.257.3 is unchanged.

**Threshold:** 35% / re-arm 40%, as asked. Both are named constants in
`DeviceBatteryNotifier.kt` — one-line changes if either number turns out wrong in practice.
