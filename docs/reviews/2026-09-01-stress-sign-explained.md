# Q-507 explained: the stress model is fine, the stored daily scalar is not — 2026-09-01

*Tuning · production data pulled 2026-09-01. Files **TN-22** and amends **Q-507**, open since
2026-08-18. Propose-only. Counts are the owner's account only (`claude_ro` is row-scoped).*

Owner: *"does this mean stress will work properly soon?"*

**The stress model has been producing the right answer the whole time. The daily number stored beside
it is what points backwards.**

---

## The test

TN-3a's per-bucket persistence gives, for the first time, both the model's raw output and the daily
scalar derived from it. `stress_high_minutes` is defined as bucket-minutes below
`STRESS_HIGH_LEVEL = -0.5`, so it can be **recomputed from the persisted buckets and compared with
what was stored**.

Correct direction is **negative** — more high-stress minutes should mean worse sleep and lower
readiness.

| | vs sleep | vs readiness |
|---|---|---|
| **stored `stress_high_minutes`** | **+0.137** | **+0.338** |
| recomputed from buckets, all hours | **−0.181** | **−0.438** |
| recomputed, waking window only (TN-21's fix) | **−0.289** | **−0.477** |

**Recomputing the same quantity from the model's own output flips the sign to correct.**

### It strengthens when the one corrupt day is removed

2026-08-31 is a known **TN-20** casualty — its readiness and sleep were overwritten to 25/15 from
55/56 — so it is the right day to drop as a robustness check, not a convenient one:

| n = 8 | vs sleep | vs readiness |
|---|---|---|
| stored | +0.029 | +0.270 |
| recomputed, all hours | −0.116 | −0.452 |
| **recomputed, waking only** | **−0.383** | **−0.699** |

**−0.699 against readiness.** The finding does not depend on the corrupt day; it is *masked* by it.

## The direct evidence: 8 of 9 days disagree

| date | stored | buckets say | |
|---|---|---|---|
| 2026-08-24 | **0** | 240 | differs |
| 2026-08-25 | 30 | 270 | differs |
| 2026-08-26 | **0** | 210 | differs |
| 2026-08-27 | **0** | 270 | differs |
| 2026-08-28 | 60 | 120 | differs |
| 2026-08-29 | **0** | 210 | differs |
| 2026-08-30 | 30 | 240 | differs |
| 2026-08-31 | **0** | 240 | differs |
| **2026-09-01** | **180** | **180** | **MATCH** |

**The only day that agrees is today** — the one most recently computed. Every older day stores a
number far below what the model's own buckets contain, and four store **zero** against 210–270
minutes.

**That is the same shape as TN-20**: a later pass recomputes a completed day from an impoverished
input and overwrites a correct value. Here it hits the daily stress scalar; there it hits the battery
row and the derived scores. **They are plausibly one defect**, and TN-22 says so without asserting it
— the mechanism is not identified in either case.

---

## What this changes

**Q-507 is explained, and its conclusion is reversed.** Since 2026-08-18 the entry has said high
stress minutes correlate *positively* with readiness and that the metric therefore cannot be built
on. Both statements are true of the **stored scalar** and false of the **model**. The dHRV stress
model correlates **−0.699** with readiness on the waking window — the right sign, and a usable
magnitude.

**This also retires the two mechanisms previously proposed and the one refuted.** The data-density
hypothesis (refuted 2026-08-26, r = −0.128 vs HR sample count) and the bucket-count hypothesis
(TN-21, r = −0.784) were both attempts to explain a phenomenon that **is not a property of the
model**. TN-21's *window* finding stands on its own — the series is still 55% night, and restricting
it improves the correlation from −0.452 to −0.699 — but TN-21's Q-507 candidate is superseded.

**⚠ What this does NOT establish.** n = 8–9 days. The waking window used here is 06:00–22:00 chosen
by this review, **not the app's own definition**. The buckets are persisted by the same pipeline that
writes the scalar, so "the buckets are right" rests on their producing the physiologically correct
sign, not on independent verification. **The mechanism that writes the wrong scalar is not
identified** — only that it disagrees with the buckets on 8 of 9 days and agrees on the newest.

---

## So: will stress work soon?

**The honest answer is that the blocker changed, and it is now a smaller problem than it was.**
Nobody has to explain a backwards physiological signal any more, because there isn't one. What is
left is a persistence defect, which is the kind of thing that gets found and fixed rather than
researched.

**Order:** TN-20 (stop the overwrite — same family, and it is destroying data now) → TN-22 (make the
stored scalar match the buckets) → TN-21 (restrict the window, worth −0.452 → −0.699) → then
**re-test Q-507 on ≥30 days before anything is built on the metric**, because everything above rests
on 8.

**TN-16** — the prolonged-stress warning and calm-down prompt — stays parked until that re-test, and
its `Needs: Q-507` is now a *dependency with a route*, not an open research question.

---

## Failure surfaces not exercised

No code ran — SQL against production plus source reading. No `pnpm dev`, no device, no APK. The
recomputation was done in SQL against the persisted buckets, **not by running
`summarizeStressDay`**, so it reproduces the *definition* of `stress_high_minutes` rather than the
shipped function. Every correlation is n = 8–9, single-subject, same-day.
