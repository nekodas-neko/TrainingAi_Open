# Pillar model soundness — workouts (round 2), nutrition, cardio, heart-rate, body

**Date:** 2026-08-15 · **Against:** `main` at `0698824` (v1.317.0) · **Type:** review, docs-only
**Third of three:** [scoring pillars](2026-08-15-comprehensive-app-review.md) (Q-271…Q-284) →
[six unused lenses](2026-08-15-uncovered-lenses-review.md) (Q-285…Q-296) → **this**
**Backlog entries filed:** Q-298 … Q-303 (6)

The owner asked for every remaining pillar to be reviewed the way the health scores were: not
"is the code correct" but **"is the model sound, and does it do anything in production?"**

Two pillars came back **clean**, and that is reported as a result rather than padded into findings.

---

## 0. What this round covers, and why it existed

The previous review's Lens I did **one quarter of one lens**: it measured `expectedRpe` and left
three of its own four sub-checks unrun. Running the first of those found a live bug within minutes
(§1.1). This round finishes workouts and applies the same treatment to the four pillars never
reviewed for model soundness at all.

**The `claude_ro` limit applies throughout:** views are row-scoped to one user, `error_events`
prunes at 30 days. Every number is the owner's.

---

## 1. Workouts — round 2

### 1.1 Ten exercise logs record an estimated 1RM of exactly zero

**10 of 355 `exercise_logs` (2.8%) have `estimated_1rm = 0`** — not null, zero — alongside entirely
real volume and reps:

```
2026-08-09 21:36  Sumo Deadlift           e1rm=0  vol=2062.5  avg_reps=6.3  deload=false
2026-08-09 21:46  Bent-Over Barbell Row   e1rm=0  vol=720     avg_reps=6    deload=false
2026-08-09 21:56  Barbell Shrug           e1rm=0  vol=2100    avg_reps=6    deload=false
2026-08-09 22:04  Pull-Up                 e1rm=0  vol=1064.3  avg_reps=5    deload=false
2026-08-09 22:13  Dumbbell Preacher Curl  e1rm=0  vol=585     avg_reps=12   deload=false
2026-08-06 …      5 further rows, ALL deload=true
```

**Two clusters, and only one is explained.** The 2026-08-06 five are all `exercise_deloaded = true`
— the Q-115 / Q-228 deload-corruption date. The 2026-08-09 five are `exercise_deloaded = false`,
run consecutively over 37 minutes, and are **one entire workout session** in which every exercise
recorded a zero 1RM while recording correct volume.

**Zero is a value, not an absence.** A null says "could not compute"; a zero is a lie that flows
into trend charts, PR detection and the next prescription. Measuring first-vs-last e1RM per
exercise, those two lifts read as **−100%**.

**Q-228's fix does not cover this.** That fix filters `getLastRealOneRmBatch` on
`exercise_deloaded` — and the 08-09 cluster has that flag false, so it passes straight through.

**Context worth carrying into the fix: 2026-08-09 logged 1,000 `error_events`**, overwhelmingly
connection timeouts, and the same date carries a 0.00 h sleep row at 04:52 (Q-274). Three anomalies
in three domains on one heavy-fault day points at the connection-starvation class (Q-213 / Q-107)
as a common cause. Filed as **Q-298**.

### 1.2 The good news: progressive overload is happening

The outcome question no review had asked. First-vs-last `estimated_1rm` per exercise, excluding
deloaded rows, for lifts with ≥ 4 sessions:

| exercise | n | first | last | change |
|---|---|---|---|---|
| Barbell Hip Thrust | 15 | 98.0 | 157.2 | **+60.5%** |
| Barbell Bench Press | 18 | 84.0 | 100.2 | **+19.3%** |
| Landmine Press | 17 | 22.0 | 45.2 | +105.7% |
| Single Leg Hip Thrusts | 16 | 53.2 | 86.8 | +62.9% |
| Cable Pulldown | 16 | 24.5 | 31.2 | +27.6% |
| Barbell Romanian Deadlift | 13 | 56.0 | 56.5 | +0.9% |

**10 of 12 improving over ~3.5 months.** The two "regressing" are the zero-e1RM artefacts from
§1.1, not real regressions. Whatever else this review says, the program is working.

### 1.3 Autoregulation's missing-data defaults are asymmetric, and they favour increasing load

A prescription is recorded on a **minority** of sets:

| field | sets with it | of 1,009 |
|---|---|---|
| `planned_pct` | 280 | 28% |
| `planned_rest_sec` | 296 | 29% |
| **`planned_reps`** | **176** | **17%** |

`repCompletionRate` is therefore null most of the time (it additionally requires
`state.lastSessionRanPrescription && sessionsInPhase > 0 && prescription && last5.length > 0`).
Read what `autoregulation.ts` does with null:

```ts
// back-off (cut load)
const missedReps = sig.repCompletionRate != null && sig.repCompletionRate < COMPLETION_CEIL
if (sig.rpeDelta >= RPE_DEAD_BAND && (sig.rm1Trend === 'down' || missedReps)) { … }

// push (add reps)
const metReps = (sig.repCompletionRate ?? 1) >= 1
if (sig.rpeDelta <= -RPE_DEAD_BAND && sig.rm1Trend !== 'down' && metReps) { … }
```

**Null makes `missedReps` false and `metReps` true.** Missing data therefore *removes* a condition
from the increase path and *adds* one to the decrease path: back-off then requires the 1RM to be
actively falling, while push needs only the RPE delta and a 1RM that is not falling.

**This compounds Q-289.** That finding measured a systematic **−2.19** RPE delta at expected-10 —
past the `<= -2` threshold that adds **two** target reps. On 83% of sets the only remaining guard
(`metReps`) is auto-satisfied. Filed as **Q-299**.

### 1.4 More than a third of sets are taken with materially less rest than prescribed

Where both are recorded (n = 276):

```
mean rest taken     99 s
mean rest planned  111 s
rushed (< 75% of planned)   103 sets  (37%)
overlong (> 150% of planned) 44 sets  (16%)
```

**This is a confound for Q-289 and should be controlled for before recalibrating anything.** A set
at 80% with 60 s rest is not the same stimulus as the same set with 120 s, and `expectedRpe` has no
rest term at all — it maps (%1RM, reps) → RPE as if rest were constant. Filed as **Q-300**.

### 1.5 Clean: rep adherence, where it is recorded

Of the 176 sets with a recorded rep prescription: **135 exact hits (77%)**, 31 over, 10 under, mean
difference +0.28 reps. When the app prescribes reps and records it, they get done. No finding.

---

## 2. Cardio — a baseline that is written, never read, and empty

`running_baselines` holds **vo2max, max_hr, resting_hr, threshold_hr, weekly_base_minutes,
easy_pace_sec_per_km** — the full set of inputs a running prescription should rest on.

Three facts, each verified:

1. **Production holds 0 rows**, against 1 `running_plans` row and **12 `prescribed_runs`**.
2. `saveRunningBaseline` **is** wired — `app/api/running-plan/route.ts:144` calls it at plan creation.
3. **`getRunningBaseline` has zero callers outside the repository layer.** Nothing in `app/`,
   `components/`, `lib/` (beyond `adapter.ts`/`repository.ts`) reads it.

So even if the table were populated, no prescription would consult it. Twelve runs have been
prescribed without reference to the athlete's VO2max, threshold HR or easy pace. Two independent
defects — an empty table *and* a dead reader — and the second is the one that matters. Filed as
**Q-301**.

This is the same shape as Q-270 (`training_load_ots`: live producer, zero rows) and Q-231 (the
"Exercise detected" card losing its only writer). Third instance of the class; worth noting as a
pattern rather than three coincidences.

---

## 3. Nutrition — a well-built model behind a gate that never opens

### 3.1 The model itself is sound

Better founded than expected, and worth recording so nobody rebuilds it:
`packages/shared/src/nutrition/` carries `adaptive-tdee.ts`, `tdee-adaptation.ts`,
`calorie-balance.ts`, `goal-recommendation.ts`, `adherence.ts`; energy estimation uses **Schofield
BMR** with **Mifflin-St Jeor activity factors** and **Compendium MET values**
(`health/daily-energy.ts`, `health/workout-energy.ts`). These are the right references.

Targets are internally consistent — `150 g × 4 + 190 g × 4 + 60 g × 9 = 1,900 kcal`, exactly the
stored calorie target. Q-191's fix holds in production.

### 3.2 …and the adaptive TDEE gate has not opened once in 30 days

`adaptive-tdee.ts` gates on `MIN_LOGGED_DAYS = 10` within a `DEFAULT_WINDOW_DAYS = 14` window
(`MIN_LOGGED_FRACTION = 0.7`), plus `MIN_WEIGH_INS = 4`.

Computing the rolling window against production food logs:

```
window ending   logged/14
2026-08-15         4/14   fail
2026-08-14         3/14   fail
2026-08-13         2/14   fail
2026-08-12         1/14   fail
…
of the last 30 rolling 14-day windows, 0 pass the >=10-logged-days gate
```

**Zero of thirty.** The weigh-in gate passes comfortably (14 weigh-ins in the last 14 days), so
food logging alone blocks it.

**Correcting a figure from earlier in this session:** "41 of 76 days logged (54%)" is true in
aggregate and misleading — the logging is front-loaded, and recent coverage is **1–4 days per 14**
(7–28%).

**The gate is probably correct; its invisibility is the defect.** Estimating maintenance from 3 of
14 days would be worse than not estimating it. But `TdeeAdaptationCard` is on the nutrition screen,
and the user has no way to know it is dormant, why, or what would wake it ("log 6 more days this
fortnight"). Filed as **Q-302**.

### 3.3 The AI gives macro advice on days with no coverage

The 2026-08-15 daily digest: *"let's focus on bumping that protein closer to your 150g goal
tomorrow."* On a 14-day window containing **4 logged days**, that advice rests on almost nothing,
and it is delivered with the same confidence as the workout numbers beside it — which are complete.

Related to Q-292 (the AI stating a false score) but distinct: nothing here is *false*, it is
**unqualified**. Filed as **Q-303**.

---

## 4. Heart rate — clean

Checked and no finding filed:

- **57,494 HR samples**, observed max **168 bpm**, p99.9 **160**, mean 85. The observed max matches
  the **168** that Q-57 adopted for the Body Battery reserve over the `220 − age` estimate of 190 —
  independent corroboration that the switch was right.
- `daily_zone_minutes` carries `max_hr` and `resting_hr` **per row**, so a zone computation can be
  reproduced against the reference actually used at the time. That is the provenance discipline
  Q-273 asks for elsewhere, already present here.
- Per-set (671 rows) and per-workout (74) HR stats are populated.

The one open HR concern remains the already-tracked Q-11 / "only ~20% of logged sets have usable HR".

---

## 5. Body — clean

Checked and no finding filed:

- 108 `body_metrics` rows; **73 weights** (67.6–72.8 kg, mean 69.9 — a plausible 5.2 kg span), 68
  body-fat readings.
- The apparent gap — 17 rows with `skeletal_muscle_pct` / `visceral_fat_index` / `bmr_kcal` /
  `metabolic_age` against 68 with body fat — **resolved as benign**: those columns first appear
  2026-07-29, so the 51 without them are simply older than the capability. Not a producer gap.
- Six manual tape-measure columns (`waist_cm`, `chest_cm`, `arm_cm`, `thigh_cm`, `hip_cm`,
  `neck_cm`) are **0 of 108**. Classified **"correctly empty"** per the Lens G taxonomy — the owner
  does not tape-measure, and that is not a defect. Not filed.

---

## 6. Surfaces NOT exercised

- **No device, no emulator, no browser, no `pnpm dev`.** Docs-only, all three reviews.
- **One user's data.** The RPE, rest-adherence and TDEE-gate findings are one athlete's. The
  *mechanisms* (asymmetric null defaults, a dead reader, an unreachable gate) are user-independent;
  the *magnitudes* are not.
- **The 1RM formula question (I4) is still not done.** This round found zero-valued 1RMs (§1.1) but
  did **not** examine high-rep estimation error, the `use_for_1rm` flag, or whether
  `personal_records` contains untrustworthy entries. It remains open.
- **Deload policy, volume-landmark adherence, muscle balance and the phase engine were not
  measured.** Named in the previous prompt, still unrun — see §7.
- **Cardio was assessed structurally, not numerically.** 47 activity logs were not analysed for
  pace/HR model soundness.
- **`error_events` prunes at 30 days**, so the 2026-08-09 correlation in §1.1 cannot be extended
  backwards.

---

## 7. Still open after three reviews

Stated plainly so the next session does not assume completeness:

| area | status |
|---|---|
| 1RM formula validity at high reps (I4) | **not started** |
| Deload policy — does it fire at defensible times? | **not started** |
| Volume landmarks vs actual weekly per-muscle sets | **not started** |
| Muscle balance / exercise selection | **not started** |
| Phase engine — do phases progress sensibly? | **not started** |
| Cardio pace/HR model against 47 activity logs | **not started** |
| Systematic AI-output audit (8 of 117 read) | partial |
| Degradation matrix against a running app | desk-only (Q-294) |
| "What breaks at 10 users, at 100" | **not answered** — left open three times now |
