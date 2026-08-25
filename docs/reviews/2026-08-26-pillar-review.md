# The five pillars, answered one at a time — 2026-08-26

*Tuning · production data pulled 2026-08-26. Filed as TN-13…TN-16 plus an amendment to Q-507.
Propose-only. Counts are the owner's account only (`claude_ro` is row-scoped).*

Owner: *"Overall the pillars are not working great and not very useful. Requires tuning."* Six
specific questions. Each is answered below with what was measured, and — where it matters more — what
was **not**.

---

## 1. Heart Rate — "my value is 52; what is that?"

**It is your 7-day average resting HR.** `oura-score-chip-row.tsx:390` reads
`readiness.restingHr ?? readiness.hrCurrent`, and the payload documents `restingHr` as
*"recent (7-day) average resting HR, bpm — the Heart Rate card value"* (`readiness-payload.ts:131`).
The underlying reading is the overnight resting HR, so it is sleep-derived.

**The problem is the averaging, and it is measurable.** Over 50 nights:

| | night-to-night change |
|---|---|
| nightly resting HR | **2.11 bpm** |
| the 7-day average shown on the tile | **0.33 bpm** |

**The tile smooths away 84% of the day-to-day movement.** And from the check-in lookback,
**resting HR is the single best predictor of how the owner actually feels** (r = **+0.557**, the
strongest of nine contributors). So the tile is showing the most informative signal in its least
informative form — a number that barely moves and therefore cannot mean anything on a given morning.

**More useful: last night's resting HR against the baseline** — "52, −2 vs your usual" — which is
daily-actionable and uses the variation the average discards. The tile already computes a cue from
`restingHrBaseline`, so the comparison exists; it is the *displayed number* that is smoothed. Filed
as **TN-13**.

---

## 2. Sleep — "60 is way off, I'd imagine 75–80"

Three separate causes, two already filed and one new.

**a. The calibration curve (TN-5, signed off).** 2026-08-26's weighted blend was **73.15**, which
`SCORE_CALIBRATION` maps to exactly **57** — reproduced from the stored value. TN-5's uniform-gain
curve gives **≈63** for the same night. So a "73" night displays as 57 today.

**b. The duration curve (TN-10).** 7.75 h scores **73.5** on `totalSleep`, the heaviest of the ten
contributors — while that curve's own comment claims 8 h is "excellent (~92)" and the anchors give
77. The comment and the code disagree by ~15 points.

**c. Genuine autonomic dip.** Overnight HRV 53 against 60 two days earlier; resting HR 53.7 against
50.2. The `hrv` (48) and `hr` (64) contributors are real signal, not artefacts.

So the owner's 75–80 intuition is closest to the **blend** (73.15), and the gap to 57 is the display
curve. **That is TN-5, already approved.**

### ⚠️ The 2026-08-19 night is still 3.50 h and still contributing

Checked directly: `oura_daily_summary` for 2026-08-19 holds **3.50 h**, efficiency 86, deep 1.0,
REM 0.58 — sitting between a 9.00 h night and a 7.67 h night. **Nothing in the pipeline has removed
or flagged it.** It feeds every trailing baseline and every sleep statistic that reads that table.

**Q-520 (a partial-night flag) is filed and unbuilt**, so there is no mechanism to exclude it. Filed
as **TN-14** — the owner has now asked twice for this not to contribute.

---

## 3. Activity — "yesterday's or today's? How would I make this 100?"

**Today's**, and it is a partial day until the day ends — the 55-weight daily-movement lane
(steps 18 + activeEnergy 15 + zoneMinutes 10 + moveHours 12) is near-empty at 7 am, while the
45-weight strength lane (freq 25 + volume 20) already carries yesterday's session. That is why it
reads 63 in the morning and 78–82 by evening. **Readiness separately contains `prevDayActivity`
(weight 0.09) which is the completed previous day, so both windows exist in different places.**

**100 has never happened.** Over 30 scored days: mean **75.1**, sd 7.5, range **51–91**, one day ≥90.

**What blocks it**, contributor by contributor:

| contributor | weight | state |
|---|---|---|
| `moveHours` | 12 | already ~always 100 — **TN-11**, it qualifies 99.8% of hours |
| `strengthFreq` | 25 | needs 5 sessions / 7 days; at ceiling on 78% of days already |
| `strengthVolume` | 20 | needs 5,200 kg over 7 days |
| `steps` | 18 | needs the step goal — and **there are three different goals** (Q-524: 7,000 / 10,000 / 8,000) |
| `zoneMinutes` | 10 | **floored at 0 on 53 of 59 days (Q-523)**; excluded on lifting days, counted as 0 otherwise |
| `activeEnergy` | 15 | **present on 8 of 51 days**; excluded and renormalised the rest |

So a 100 requires simultaneously maxing two contributors that are structurally broken (`zoneMinutes`
floored, `activeEnergy` absent) and one that is meaningless (`moveHours`). **The honest answer is
that 100 is not currently reachable by behaviour**, and chasing it is not a useful goal until
Q-505/Q-523/TN-11 land.

---

## 4. Stress — "how is this calculated, how real is it?"

**Calculated** from a dHRV model: skin temperature, MET and HR are fed to a fitted per-user model
(`buildDaytimeStressSeriesFromModel`) which estimates daytime HRV per **30-minute bucket**, compares
each bucket against the day's own median, and emits a level on [−1, +1] where negative = stressed.
Minutes below `STRESS_HIGH_LEVEL` become `stress_high_minutes`.

**How real: it points the wrong way, and this now replicates.** Q-507 measured high-stress minutes
correlating **+0.40 with readiness** on 2026-08-18. Re-measured today with more days (n = 33):

| | r |
|---|---|
| stress-high minutes vs **readiness** | **+0.386** |
| stress-high minutes vs **sleep score** | **+0.477** |
| stress-high minutes vs activity score | −0.033 |
| `daytime_stress_scaled` vs readiness | −0.086 |

**More "high stress" minutes on days the owner is more ready, and more on nights they slept better.**
The sleep correlation is stronger than the readiness one and is new — Q-507 did not test it. A stress
measure that rises with better sleep is not measuring stress.

### The mechanism is unknown, and my hypothesis was wrong

I proposed that stress minutes might track **data density** — better sleep → denser HRV signal →
more buckets scored → more minutes classified as anything. **Measured and refuted:**

| | r |
|---|---|
| stress-high minutes vs HR sample count | **−0.128** |
| total scored minutes (stress + recovery) vs sample count | −0.259 |
| stress-high minutes vs overnight HRV | −0.258 |
| stress-high minutes vs sleep hours | +0.224 |

Data density does not explain it. Note the HRV correlation is **−0.258** — weakly in the *right*
direction — which sits oddly against +0.477 vs the sleep score and is not resolved here.

**So: the finding replicates and strengthens; the cause is not established.** Recorded that way
rather than reaching for a second hypothesis. Q-507 is amended with the replication and the refuted
mechanism.

**⛔ Until the sign is explained, do not build on this metric.** The owner asked about a stress
overlay on the HR chart, a prolonged-stress warning and a calm-down ritual. All three would present a
number that currently rises on good days. The overlay is **TN-3b** (already filed, `Needs: TN-3a` for
the per-bucket persistence); the warning and ritual are filed as **TN-16** behind the fidelity
question, deliberately.

---

## 5. Body Battery — "should drain with exercise/HR/stress and charge back through sleep"

That is a description of a **different model from the one shipped**, and the owner is asking for it
directly, so the earlier note in this repo saying not to propose overnight charging is superseded for
this reason (it was written against chasing a symptom, not against a stated product requirement).

**Today:** no overnight charge phase at all — `walkBodyBattery` filters to `tsMs >= wakeTime`, and the
morning value is the readiness score (`resolveAnchor`). Drain is HR-only and, per **Q-521**, tracks
**how long the ring was worn** rather than what the owner did — `corr(hr_sample_count, drained)` =
**+0.518** against `corr(steps, drained)` = **−0.153**, and a workout moves the end value by **0.6
points**.

So both halves the owner describes are missing: drain does not respond to exercise, and there is no
recharge. Filed as **TN-15**, which supersedes the "do not redesign" guidance and sequences the work.

---

## 6. Readiness — "not sure what this uses or whether it's accurate"

**Nine weighted contributors:** previousNight 0.16, restingHeartRate 0.15, hrvBalance 0.15,
temperature 0.10, sleepBalance 0.10, checkin 0.10, prevDayActivity 0.09, recoveryIndex 0.09,
activityBalance 0.06.

**Is it accurate?** The one external check available is whether it tracks how the owner reports
feeling. From the 2026-08-26 lookback: resting HR **+0.557** and previous night **+0.520** against the
check-in, and a two-predictor model reaches **LOO R² 0.293**. So its two heaviest objective inputs
genuinely track felt state — **the ingredients are sound.**

What is wrong with it is documented and mostly already queued: a temperature penalty firing on 91% of
nights (**TN-6**, signed off), a score that moves after first open (**TN-9**), and a `recoveryIndex`
whose anchor is under review (**Q-509**). **Readiness is the pillar in the best shape of the five** —
its problem is contaminated inputs, not a broken design.

---

## Failure surfaces not exercised

No code ran — SQL against production plus source reading. No `pnpm dev`, no device, no APK. Every
correlation is same-day and single-subject (n = 30–50 depending on the pair); none establishes
direction of causation. The stress mechanism is explicitly **unresolved**, not deferred.
