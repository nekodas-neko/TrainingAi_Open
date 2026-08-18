# The rest boundary shrank 3× because the owner got fitter

**Date:** 2026-08-18 · **Agent:** Tuning · **Type:** calibration evidence, docs-only
**Filed as:** Q-515 · **Lane:** A implements (this proposes only)
**Scope note:** first calibration review of the **heart-rate** pillar. `HR_REST_THRESHOLD` is the
single rest/active boundary shared by **Body Battery's charge/drain** and the **Activity Score's
"moved this hour"** signal, so it propagates into two pillars.

**The finding is not that the constant is wrong. It is that the boundary is anchored to the
fastest-moving part of the distribution, so improving fitness shrinks the charge window.** Every input
behaved correctly; the output is perverse.

---

## 1. What it resolves to

`HR_REST_THRESHOLD = 0.05` of heart-rate reserve above resting. For this owner (age 33, so
`hrMaxFromAge` = 187), against `body_battery_daily`'s own stored profile:

| month | resting HR | hr_max | **rest boundary** |
|---|---|---|---|
| 2026-07 | 62.9 | 187.0 | **69.1 bpm** |
| 2026-08 | 54.4 | 171.2 | **60.2 bpm** |

Measured over **12,471 BLE ring samples**, waking hours (07:00–21:59 local), joined per day to that
day's own profile:

| month | days | median % of waking samples below the boundary |
|---|---|---|
| 2026-07 | 25 | **26.5%** |
| 2026-08 | 17 | **8.2%** |

**A 3.2× collapse in one month, at identical sample density (184/day).**

---

## 2. Every input moved correctly

| driver | change | is it a defect? |
|---|---|---|
| resting HR | 62.9 → 54.4 (**−8.5**) | **No** — a genuine fitness improvement |
| `hr_max` | 187 → 168 (−19) | **No** — the profile maturing from the age formula to a corroborated observed ceiling (chest-strap max is 166 over 40,230 samples). `resolveHrProfile` working as designed |
| waking HR | mean 77.5 → 73.3 (−4.2) | **No** — the same fitness improvement |

Decomposing the 8.9 bpm boundary drop: holding `hr_max` at 187 and moving only resting HR gives
61.0 bpm, so **resting HR explains ~8.1 of the 8.9** and the `hr_max` maturation ~0.9. The dominant
driver is the fitness gain.

**The trap is a rate difference.** Resting HR fell **8.5 bpm**; waking HR fell only **4.2**. Resting HR
is the more responsive fitness marker, so a boundary pinned to it moves roughly twice as fast as the
distribution it is meant to classify. The owner got fitter and was rewarded with **less** recovery
credit.

---

## 3. No choice of fraction fixes it

Sweeping `HR_REST_THRESHOLD`, median % of waking samples below the boundary:

| fraction | 2026-07 | 2026-08 | ratio |
|---|---|---|---|
| **0.05 (shipped)** | 26.5% | 8.2% | **3.2×** |
| 0.08 | 38.5% | 22.7% | 1.7× |
| 0.10 | 47.8% | 29.8% | 1.6× |
| 0.12 | 59.6% | 35.2% | 1.7× |
| 0.15 | 72.8% | 50.6% | 1.4× |

The gap narrows but **never closes**. Raising the fraction opens the window at both ends without
stabilising it — so **tuning this constant is not the fix**, which is the fourth time this pattern has
appeared today (Q-506, Q-512, Q-514, and now this).

---

## 4. Two separable questions — only one of them is mine to answer

**(a) Is the boundary stable?** No, demonstrably, and that is a defect regardless of taste. A
classifier whose behaviour changes 3× in a month because its subject improved is not measuring what it
claims to.

**(b) Is 8.2% the right level?** **Unknown, and this review does not claim otherwise.** 8.2% of a
15-hour waking day is ~1.2 hours of "at rest" — not obviously wrong. Whether Body Battery *should*
charge more during the day is a product question for the owner, not a measurement.

**Fix (a); do not let (b) ride along with it.** If the fraction is raised at the same time, the two
effects become inseparable and neither is verifiable afterwards.

---

## 5. Proposal

**Recommendation: decouple the boundary from same-day resting HR.** Anchor it to a **slow-moving**
baseline — a 90-day trailing resting HR, or a fixed offset re-derived quarterly — so a month of
genuine fitness improvement cannot move the classifier under the data it is classifying. It keeps
personalisation (a fitter person does have a lower rest boundary) while removing the month-scale
feedback.

**Alternative considered and rejected: a percentile of the owner's own recent *waking* HR** (e.g. the
trailing-28-day p25). It self-calibrates to the right distribution and would be stable by
construction — but that is precisely the objection. Body Battery charge would then be near-constant
across days, so a genuinely restful day could not read as one. The codebase already names this failure
mode as "the treadmill" and removed it from the activity-goal volume lane
(`daily-goals.ts`, Q-190). **A self-referential boundary is fine for a pure classifier and wrong for
anything that feeds a score, and this one feeds two.**

**Reversal cost is low.** It is one constant plus a baseline source; nothing is persisted from it that
would need migrating, and the effect is observable within a week of BLE data.

**Re-measure both consumers afterwards** — Body Battery's charge/drain balance (currently mean charged
23.1 vs drained 36.0) and the Activity Score's "moved this hour" signal. A boundary this shared cannot
be changed and checked in one place.

---

## 6. What was not exercised

- **No code changed and no constant altered.**
- **`hr_max = 168` was not traced to its source.** It is stable across all of August and is close to
  the chest strap's observed 166, so "a corroborated observed ceiling via `resolveHrProfile`" is an
  inference from the numbers, not something read out of the resolver's logic.
- **The waking window is a proxy.** 07:00–21:59 local is this review's definition, not the app's;
  Body Battery's own notion of waking may differ, which would shift the absolute percentages (though
  not the July-vs-August ratio, which uses one definition throughout).
- **Sleep samples are excluded** by that window, so nothing here speaks to overnight charge.
- **`PEAK_BANDS` and the Karvonen zone boundaries (0.6/0.7/0.8/0.9) were NOT reviewed** — they are the
  remaining heart-rate items. `PEAK_BANDS` justifies itself with "stable per-bucket sample sizes",
  which is an empirical claim and still unmeasured.
- **This review did not replay Body Battery** to show the charge/drain consequence end-to-end; the
  link from boundary to charge is read from the route's structure, not measured through it.
- **Q-272's "median 6.7% of waking samples"** could not be reproduced exactly — the same statistic on
  current data gives **15.0%** pooled across 42 days, and the month split (26.5% / 8.2%) suggests that
  figure was measured on recent data alone. **Not claimed as an error in Q-272**; the windows differ
  and the drift documented here is enough to explain it.
- Every figure is **the owner's** (`claude_ro` is row-scoped), 12,471 BLE samples over
  2026-07-06 → 08-18.

---

# Part 2 — `PEAK_BANDS`: calibrated for a heart-rate range strength training never reaches

**Filed as:** Q-516

`hr-recovery-profile.ts` bands recovery episodes by peak HR, justifying the scheme in its own comment
as *"Bands, not exact bpm, for stable per-bucket sample sizes (spec §3)."* That is an empirical claim.
It is false for this athlete.

## 1. The observed range

`claude_ro.set_hr_stats`, 208 episodes with `coverage_ok` (2026-05-27 → 08-17):

| | peak_bpm |
|---|---|
| min | 59 |
| p25 | 93.8 |
| **median** | **102** |
| p75 | 110 |
| p95 | 121 |
| **max** | **132** |

## 2. Three of five buckets are unreachable or empty

| band | episodes | share | mean `drop_60s` |
|---|---|---|---|
| **`<110`** (spec: *low-signal, de-emphasise*) | **149** | **71.6%** | **3.0** |
| `110–129` | 57 | 27.4% | **14.9** |
| `130–149` | **2** | 1.0% | 13.5 |
| `150–169` | **0** | 0% | — |
| `170+` | **0** | 0% | — |

The owner's highest set-peak ever recorded is **132**, so the top two bands are **structurally
unreachable** — not sparse, unreachable. And `LOW_SIGNAL_BAND_LABEL = '<110'` sits at the **p75**, so
the profile explicitly de-emphasises three quarters of its own data.

**The HR Recovery Profile has exactly one usable bucket** (`110–129`, n = 57).

## 3. The de-emphasis is right, which makes it worse

Mean `drop_60s` is **3.0 bpm** below 110 against **14.9** above it. The spec's claim that recovery
below 110 is *"near-meaningless … mostly measurement noise"* is **supported by the data**. So this is
not a case where re-banding recovers hidden signal — below 110 there genuinely isn't much.

That is the uncomfortable version: the bands are wrong *and* fixing them does not by itself produce a
working feature, because **peak HR during a lifting set mostly does not reach the range where HR
recovery is informative.** These bands read as designed for cardio/interval work.

## 4. Also: `coverage_ok` is true on 31% of rows

212 of **691** `set_hr_stats` rows pass `coverage_ok`. So roughly **two thirds of set-HR rows are
discarded before banding is even reached**. Not investigated here — recorded so the 208 is not
mistaken for the full sample.

## 5. Proposal

1. **Re-band to the observed range** — something like `<90 · 90–104 · 105–119 · 120+` would populate
   four buckets from this data instead of one. Cheap, and it stops the 110–129 signal being diluted by
   a bucket holding 72% of episodes.
2. **But do not treat that as the fix.** State plainly, in the feature and the docs, that HR recovery
   is informative for roughly the **28%** of sets that peak above 110 — the rest cannot support it. A
   re-banded profile that still averages noise into four buckets is worse than one honest bucket,
   because it looks like it is working.
3. **Decide whether the feature is targeted correctly at all.** If HR recovery is meant to track
   conditioning, cardio sessions and the chest-strap data (max 166, 40,230 samples) are where the
   range exists — not strength sets. That is an owner-facing product question, not a constant.

**Do not re-band and ship without (2)**, which would convert a visibly-empty feature into an
invisibly-noisy one.

## 6. What was not exercised

- **No code changed.** Nothing about the recovery *math* (`drop_30s`…`drop_120s`, `sec_to_hrr50`) was
  checked — only the banding and its populations.
- **`coverage_ok`'s 31% pass rate was not diagnosed.**
- **Cardio/chest-strap episodes were not examined.** §5.3's claim that the range exists there is from
  the raw `oura_heartrate` chest-strap max (166), **not** from any recovery episode built on it —
  `set_hr_stats` is strength-set-derived by construction.
- 208 episodes is a small sample and all of it is one athlete's strength training.

---

# Part 3 — the Karvonen zone boundaries: checked, deliberately NOT filed

`ZONE_DEFS`' reserve fractions (0.6 / 0.7 / 0.8 / 0.9, with Zone 1 starting at resting HR) were the
third heart-rate item. **No finding is filed, and the reason is worth recording so the next session
does not repeat the two dead ends.**

## The wrong denominator, and why it is tempting

Measured across **all** stored HR, Zone 1 holds **99.8%** of BLE samples and **99.1%** of chest-strap
samples, with Zones 2–5 sharing under 1%. That looks like a damning result and **it is not a fair
one**: `computeHrZones` / `zoneForBpm` / `HR_ZONE_META` are consumed only on **cardio surfaces** —
`run-hr-zone-hero`, `exercise-review-sheet`, `zone-stack-chart`, `zone-quota-card`. All-day ring HR is
not the population these boundaries are asked to classify, and 99% Zone 1 is the expected answer for a
24-hour denominator regardless of where the boundaries sit.

## The right denominator does not exist yet

`activity_logs` over the whole history: **32 walks, 7 runs, 5 treadmill, 1 cycle** — roughly **13
run/treadmill sessions**, the most recent **2026-07-24**, nearly a month before this review.

Five boundaries fitted to thirteen sessions would be fitting noise, and it would repeat the mistake
this review's Part 1 and Part 2 both avoided: **producing a number because a number was asked for.**

## What would make it measurable

Enough cardio volume to populate the upper zones — the same precondition that has kept the whole
**cardio** pillar deprioritised. Until then the zone boundaries stay on textbook Karvonen, which is a
defensible default for an athlete with no cardio history to fit against.

**Do not re-open this by measuring all-day HR.** That path yields a 99% Zone 1 figure that reads like
a finding and is not one.
