# 2026-08-31 · Lane A — the deload banner stops firing off a broken temperature baseline (TN-18)

Branch `lane-a/deload-temp-gate`. One condition, plus the read it needed. JS/server only.

## The finding, in one frame

The owner's 2026-08-31 06:43 screenshot held both halves of a broken baseline for the same night:

| path | value | verdict |
|---|---|---|
| readiness contributor | `tempZ` = 0.303 | **80/100** — temperature is fine |
| deload banner | `temp_dev_c` = 0.519 °C | **"Body temp elevated — rest or deload recommended"** |

Same number, opposite answers. The z is small because the baseline sd is inflated —
`temp_baseline_dev_x8` reads 1.714 °C against a true nightly sd of ~0.14 °C, and 0.519 / 1.714 =
0.303 to three decimals. Q-506's inflated sd and TN-6's low mean, failing in opposite directions at
once.

**TN-6a shipped the suspension and its own entry said it "must cover all three consumers". It
covered one** — and it was the readiness ladder, the path the owner does not read. The banner is
the surface behind the report that started all of this: *"its often triggering deload days. its not
trustable yet."*

## The fix, and the thing it is not

`computeDeloadStrength` takes a `temperatureTrusted` flag; the adapter computes it with
`isTemperatureBaselineCentred` — **imported, not re-derived**, because two answers to "is
temperature trustworthy" is exactly what produced the disagreement above. An absent flag suppresses,
matching how an absent `temperatureBaselineDays` already behaves: both unknowns fail the same way.

**The threshold is untouched.** Raising `TEMP_ALERT_THRESHOLD_C` is the Q-504 mistake and would have
been the fourth *"the threshold is right, the input is wrong"* in this pillar.

The suspension is one condition on one alert, not a mute: a fever still deloads (different branch),
and so does a stressful day. Both pinned.

## The hazard the fix introduced, which is the part worth reading

Judging centredness needs the *trailing* deviations, and the adapter read only today's summary. So
the query widened to the same 28-day window readiness uses — and that quietly turned
`summaryRows[0]` from **today** into **the oldest of 28 nights**. A month-stale deviation and
baseline count feeding a deload banner is a worse bug than the one being fixed.

**The first version of the new test file passed with it in place**, because every case there judged
the *window*, which is centred either way. `todaySummary` is found by date now, with its own case
asserting the deviation and the baseline count come from today.

Two other mutations survived first drafts and forced better tests: the adapter simply not passing
the flag into the engine (the tests read the flag out of `signals` and never checked the alert), and
the trust flag defaulting to `true`. Four mutations, four tests.

## Not verified

The pass test is a morning where the banner stays quiet on an over-threshold night, and that is the
owner's to observe — the entry's own acceptance. Nothing here touches native SQLite, Capacitor,
safe-area or the APK path. The third consumer TN-18 names (`tempZ` / the illness radar) was
deliberately **not** touched: it is not firing wrongly, it cannot fire at all while the sd is 12×
too wide, and that is TN-6's subject.
