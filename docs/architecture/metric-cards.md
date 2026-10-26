# Readiness metric cards

_Written 2026-10-26 for the metrics the owner chose to card on #2823 and #2834 ("approve all", 26 Oct).
Each card follows the template in
[`scoring-layers-and-data-inputs.md`](scoring-layers-and-data-inputs.md) §7.1. **These are written
designs. Nothing here scores, and the live readiness reads none of it.** Every metric below gets its
own `type: tuning` proposal, replayed on history with the days moved stated, before it counts._

**Sources of the facts.** Evidence and citations: [`2026-10-12-readiness-metric-evidence.md`](../reviews/2026-10-12-readiness-metric-evidence.md),
every citation checked in PubMed there. Where a number below is not a published cut-off, it says so.
Candidate list: [`2026-10-12-data-gaps-summary.md`](../reviews/2026-10-12-data-gaps-summary.md) §2.
How a metric may link to others: [`metric-links.md`](metric-links.md), including the five gates.

**What the owner decided (26 Oct).**
- The morning check-in stays inside **Body**; it is not its own part of readiness.
- Alcohol and caffeine are context tags with **no weight**.
- **Chest-strap beats keep their 90-day limit** (`rr_intervals` is pruned at 90 days). So the
  aerobic-threshold metric (DFA-α1) is not carded, and nothing here needs older beats.
- Formatted ids follow the layer rule: the id says its cadence (`<thing>_per_<cadence>`).

**Sources after the Oura API switch (#2808, #2820).** Cards 1, 6 and 8 read the ring's sleep. The
Bluetooth source has had no new nights since 17 Oct, so the Oura API is the live route and each of
those cards lists it first. The API's sleep document has 5-minute `heart_rate` and `hrv` series and
`sleep_phase_5_min`. The Bluetooth rollup stays as the second route, for the nights it already
holds. Card 7 reads the chest strap and is unaffected.

**Order** (the owner's): 1 sleep regularity · 2 morning check-in · 3 session RPE · 4 alcohol and
caffeine tags · 5 cycle-aware normals · 6 body-clock offset · 7 heart-rate cost of a set · 8 HRV in
deep sleep only.

---

## 1. Sleep Regularity Index

**Metric:** Sleep Regularity Index · formatted id `sleep_regularity_per_week` · pillar Sleep (replaces `sleep.timing`)

**What it measures, and why it matters for readiness:** The chance, from 0 to 100, that a person is
in the same sleep or wake state at two moments 24 hours apart, over a rolling 7 days. It has the
strongest outcome evidence of any candidate: in UK Biobank (n = 60,977) the most regular quintiles
had 20–48% lower all-cause mortality (Windred 2024, *Sleep* 47(1):zsad253). It has not been tested
against next-day readiness, so it is a slow, Level-type score and not a day-to-day swing.

**Raw routes, best first:**
1. Oura API → `sleep_phase_5_min` → fraction of epochs whose state matches the epoch 24 h earlier,
   over the last 7 days, with any stage other than awake counted as asleep.
2. Oura ring (Bluetooth rollup, no new nights since 17 Oct) → our own 5-minute sleep/wake epochs from
   the stager → the same fraction.
3. Health Connect / Apple → sleep sessions with stages → epochs rebuilt from the stage intervals.
   Sessions with no stages give only start and end, which is too coarse; they leave this missing.

**Scoring:** directional with a plateau, graded on the week's index.
- Yardstick: UK Biobank median 81 (IQR 73.8–86.3); bottom-quintile cut-off 71.6, top-quintile 87.3.
  Most of the mortality gain is in by the second quintile (Windred hazard ratios 0.80, 0.75, 0.72,
  0.70 across Q2–Q5). Starting map, **derived and not a published cut-off**: ≥ 87 → 100, 81 → about
  70, under 72 → 40 or less.
- Those cut-offs come from wrist accelerometers. The first job in the tuning proposal is to see
  where this ring's SRI falls on the owner's history before trusting them. One unverified report says two SRI
  calculators give different values on the same data, so the calculator is pinned in the code and
  named in the proposal.
- Personal normal: not used for Level. Smallest meaningful change: 2 index points (**proposed**,
  to be checked on the replay).

**Weighting:** Not set here. It replaces `sleep.timing` (4.5 points), per
[`metric-links.md`](metric-links.md) §3 rule 3, so it starts with that budget, not an addition.
Settling in Heart partly re-scores timing; card 6 is the proposed fix for that.

**Red flag:** none.

**Missing data:** under 5 days of epochs in the window (Windred required 120 hours of valid paired
epochs), or a source with no stages, leaves it missing. It never counts as zero.

**Validation:** it should agree with the morning check-in's sleep-quality and fatigue items on days
held back, and `sleep.timing` should drop out as a duplicate (gate 4, above about 0.8). The replay
states how many days move.

---

## 2. Scored morning check-in, fatigue first

**Metric:** Morning check-in, scored item by item · formatted id `checkin_fatigue_per_day` (and one
id per item) · pillar **Body** (owner, 26 Oct; not its own part)

**What it measures, and why it matters for readiness:** How the person says they feel. In athlete
monitoring, self-reported wellness tracked training stress more sensitively and consistently than
most objective markers (Saw 2016, *Br J Sports Med* 50(5):281–91, 56 studies), and single items beat
totals. Fatigue was the best single item: r = −0.51 with daily load (Thorpe 2015). Soreness tracked
load in one study and not another (McLean 2010; Thorpe 2015), so it is optional. Later work finds
many associations only trivial to moderate (Duignan 2020), so this is a personal-baseline signal,
not an absolute one. It is also the target the weights are tuned against (spec §8, #2826).

**Why it carries nothing today:** the stored recovery answer was the pre-filled 3 on every one of
the 17 days an earlier review checked. The check-in has `perceivedRecoveryTouched` and
`sleepQualityFeelTouched`, which separate an answer from a seeded value.

**Raw routes, best first:**
1. The native morning check-in (`mobile/src/features/health/components/MorningCheckinSheet.tsx`)
   with a new **fatigue** item, 1 (fresh) to 5 (drained), starting **empty** → the answer.
2. Existing items, **only where the touched flag is true**: recovery and sleep quality.
3. Soreness, optional, same rule.
There is no fallback. An item left unanswered, or still holding its seeded value, is missing.

**Scoring:** directional per item, Day only, against the person's own median of the last 30
answers. The research gives no absolute band, so there is no Level.
- Personal normal: 30-day median of that item's answers. Smallest meaningful change: 1 point on the
  1–5 scale (an integer scale cannot show less).
- An item is scored on its own. Items are not averaged into one before they meet the other scores.
- Needs enough days with a real answer before it scores (the scorer's usual 14 and 30).

**Weighting:** Not set here. Fatigue gets the most; the proposal states the points, and which Body
scores give them up. Because the check-in sits inside Body, it moves the Body pillar total (pillar
totals float), and the proposal says by how much.

**Red flag:** none. A bad answer lowers the score; it does not cap readiness.

**Missing data:** a skipped item drops out, and the pillar shares its points. No device can fill it.
Tying it to a prompt that appears only on unusual days (#2106) would leave most days empty; the
card assumes a daily ask.

**Validation:** it is the target, so it cannot validate itself. What it must show is a different
answer on different days (more than one distinct value, which a replay checks first) and, once
there are enough days, a rank correlation with the next day's session RPE (card 3).

---

## 3. Session RPE for every session

**Metric:** Session RPE · formatted id `session_load_per_session` · pillar Activity (feeds the
`activity.training_load` input)

**What it measures, and why it matters for readiness:** One internal-load number per session,
CR-10 effort × minutes, that is the same for lifting and cardio. It is validated across modes,
resistance training included (Foster 2001; Sweet 2004). Endurance work interferes with strength gains (Wilson 2012), so all
activity belongs in the load, not lifting alone. The 7:28 load ratio built on it is **contested**
as an injury predictor (Impellizzeri 2020; 2021; Lolli 2019), so its weight stays low.

**Raw routes, best first:**
1. Chest strap on → HR-based load (Banister TRIMP; Morton 1990) for the session.
2. One tap after the session: `workout_sessions.session_rpe` (column exists) × session minutes.
   The native tap sits beside the per-set picker (`mobile/src/features/workouts/components/EffortPicker.tsx`).
3. Cardio sessions from the Oura API, Health Connect or Apple (duration and effort where given) →
   minutes × the tapped RPE; with no tap, left missing, not guessed.
MET-minutes remain a fallback for unlogged movement only: METs measure energy cost, not lifting
strain (reasoning, not a cited finding).
Set RPE from before `rpe_source` existed cannot be told from the picker's pre-fill, so it is not used.

**Scoring:** feeds the existing sweet spot on the 7:28 ratio (0.8–1.3, a team-sport heuristic, not
validated for recreational lifters). The card changes the input, not the shape.
- Personal normal: none for the ratio. Smallest meaningful change: 1 CR-10 point.

**Weighting:** none new. Training load keeps its 6 points; the proposal states whether the new
input moves any days. This answers "should training load count cardio".

**Red flag:** the existing ceiling for a load ratio of 1.6 or more (#2832, cap 65) reads the same
ratio, so a better input sharpens it.

**Missing data:** a session with no tap and no strap leaves its day's load missing in the new input
and falls back to today's volume-based load, as now. Sessions are never assumed to be an average RPE.

**Validation:** session RPE against the engine's predicted effort (#2791), and the 7:28 ratio built
on it against the next morning's fatigue (card 2). The replay states how many days change.

---

## 4. Alcohol and caffeine tags

**Metric:** Alcohol and caffeine intake · formatted ids `alcohol_g_per_kg_per_day`,
`caffeine_last_intake_per_day` · pillar **none** (explains other scores)

**What it measures, and why it matters for readiness:** What was taken, how much and when, so a
low morning has a stated reason. Alcohol lowered an HRV-derived recovery index in the first 3 hours
of sleep by 9.3, 24.0 and 39.2 percentage units at up to 0.25, 0.25–0.75 and over 0.75 g/kg
(Pietilä 2018, 4,098 employees). Caffeine, in a 24-study meta-analysis, cost 45 minutes of sleep,
7% efficiency, 9 minutes of latency and some deep sleep; a 107 mg coffee should be 8.8 hours or more
before bed, a 217.5 mg pre-workout 13.2 hours (Gardiner 2023). The effect already shows in HRV,
resting HR and sleep, so a weight would **count it twice**.

**Raw routes, best first:**
1. A tag logged by the person: alcohol in drinks (converted to g/kg with body weight) and the time of
   the last caffeine. The native app has no equivalent yet.
2. Apple `dietaryCaffeine` where it exists.
3. An "alcohol last night" flag exists today and stays as the minimum.

**Scoring:** none. No yardstick, no normal, no points.
- Alcohol bands for the explanation: up to 0.25, 0.25–0.75, over 0.75 g/kg (Pietilä).
- Caffeine: hours between the last intake and bedtime, against the 8.8 h and 13.2 h marks.

**Weighting:** none, deliberately.

**Red flag:** none.

**Missing data:** no tag means no explanation shown. It never implies "none taken".

**Validation:** gates 1 and 2 only (the bar for an explain-only link). The check is whether the
stated reason is true on the person's own days, a result that can flag a tag as unhelpful for them,
never prove it.

---

## 5. Cycle-aware normals

**Metric:** Cycle phase as context for a separate normal · formatted id `cycle_phase_per_day` ·
context for Body and Heart; no pillar of its own

**What it measures, and why it matters for readiness:** For anyone who menstruates, the luteal phase
shifts temperature, resting HR, breathing and HRV as much as an illness flag does. Late luteal
against follicular: wrist temperature +0.45 °C, heart rate about +4 bpm, respiration about +0.5
breaths/min (Goodale 2019, 237 women, computed from the phase means); finger temperature +0.30 °C
(Maijala 2019); vagal HRV falls from follicular to luteal (d = −0.39) and more into the premenstrual
phase (Schmalenberger 2019, 37 studies). Without a phase, the temperature and illness checks would
fire every month.

**Raw routes, best first:**
1. Cycle logged by the person (the native app has no cycle logging yet).
2. Health Connect or Apple cycle types.
Only for users who menstruate. The studies used naturally cycling women, so other cases are out of
scope until their evidence is checked.

**Scoring:** none of its own. It selects which normal a night is judged against.
- The scorer already keeps per-phase normals (`score.ts`, edge case 9): at least
  `CYCLE_PHASE_MIN_SAMPLES` (7) same-phase days within `CYCLE_PHASE_LOOKBACK_DAYS` (90) replace the
  plain 30-day normal. What is missing is the **input**: nothing sets `phase` on an observation.
- Applies to temperature, resting HR, HRV and breathing rate.

**Weighting:** none; an adjust link adds no points ([`metric-links.md`](metric-links.md) §3).

**Red flag:** it removes false ones. The shadow ceiling's temperature and illness caps already wait
when a phase is tracked without a phase normal (#2832), and fire normally once the phase has its
own.

**Missing data:** with no cycle input, or too few same-phase days, the plain normal is used and
the unit's maturity stays provisional, as edge case 9 specifies. Never guessed from temperature.

**Validation:** gates 1, 2 and 5. The replay shows how many days a luteal shift stops being flagged.
It can be tested only on a user who logs a cycle.

---

## 6. Body-clock offset

**Metric:** Body-clock offset · formatted id `body_clock_offset_per_night` · pillar Sleep
(proposed; to be decided in the tuning proposal)

**What it measures, and why it matters for readiness:** Where the night's heart-rate minimum fell,
against its own usual time, together with how far sleep timing moved. It measures the body clock
rather than bedtime behaviour. It also lets the settling score stop counting sleep timing and
duration a second time: settling is the hours from the HR minimum to waking, so it moves whenever
bedtime or duration does.

**Raw routes, best first:**
1. Oura API → the 5-minute `heart_rate` series of the sleep document → the time of the smoothed
   minimum, with the same smoothing as route 2 so the two sources stay comparable.
2. Oura ring (Bluetooth rollup, no new nights since 17 Oct) → the smoothed overnight heart-rate
   minimum. `recovery-index.ts` already finds it (`settledAt`, the smoothed minimum) every night and
   the rollup keeps only `hoursToSettle`. **Storing the minimum's clock time is one new nullable
   column** (a migration in its own PR, catalog-only, no default and no backfill).

**Scoring:** steady around the person's own usual HR-minimum time, circular in minutes from noon (as
`minutesFromNoon` does for timing), with the offset from the sleep window's midpoint read beside it.
- Research yardstick: none found for a single night. The evidence for circadian alignment is on
  light and regularity (card 1), not on this timing. So there is no Level; the unit is learned only.
- Personal normal: 30-day median of the HR-minimum time, same source. Smallest meaningful change:
  20 minutes (**proposed**, taken from `sleep.timing`; to be checked on the replay).

**Weighting:** Not set here. It likely takes points from settling (4.5) and the timing score that
card 1 replaces, since they overlap. The gate to pass is gate 4: its correlation with each.

**Red flag:** none.

**Missing data:** a night with no clear minimum, or from before the column existed, is missing.
Nights from before the column existed stay missing.

**Validation:** it should predict the next morning's fatigue (card 2) over and above timing. Replay
states days moved.

---

## 7. Heart-rate cost of a set

**Metric:** Heart-rate cost of a set · formatted id `set_hr_cost_per_set` · pillar Heart (proposed)

**What it measures, and why it matters for readiness:** How much heart rate a set costs, against the
person's own normal for that exercise, load and rep count, read together with how fast it comes back
down. It turns every lifting session into a fixed-workload fitness check. Higher cost with slower
recovery points to strain; lower cost with slower recovery is the overreaching pattern. The
research treats HR recovery as **contested** on its own: it rises with both fitness and
overreaching (Bellenger 2016), its typical error is about 25% against a smallest worthwhile change of
about 7% (Buchheit 2014), and a set of lifts is not a standardised bout. Reading cost beside recovery
is the way to separate them.

**Raw routes, best first:**
1. Chest strap → `set_hr_stats` (per set: `peakBpm`, `avgBpm`, `bpmAtEnd`, `pctHrrAtRestEnd`,
   `hrr1Bpm`) joined to `set_logs` for load and reps → % of heart-rate reserve during the set.
`set_hr_stats` is built from the strap's heart rate, so the move to the Oura API does not affect it.

**Scoring:** steady per exercise-load-rep cell around the person's own normal, read with a
direction on recovery.
- Research yardstick: none for a set. Personal normal: a median per cell once it has enough sets;
  until then it drops out. Smallest meaningful change: 3 bpm or 3% HRR (**proposed**, from Buchheit's
  3% typical error on controlled exercise HR).
- Needs a standardised enough cell. Rest time varies between sets and changes both numbers, so
  `restTakenSec` and `restAdequate` gate which sets count.

**Weighting:** Not set here. It lives beside HR recovery, which is 3 points and **never scores
today** because set-level HR recovery is not filled (#2824). That has to be fixed first; this
card stands behind it.

**Red flag:** none.

**Missing data:** a session without the strap has no value. It never counts as zero and it does
not fall back to ring HR.

**Validation:** against next-day fatigue (card 2) and session RPE (card 3). Replay on the sessions
that have strap data states days moved.

---

## 8. HRV in deep sleep only

**Metric:** HRV in deep sleep · formatted id `hrv_deep_per_night` · pillar Heart (replaces or sits
beside `heart.overnight_hrv`)

**What it measures, and why it matters for readiness:** Overnight HRV measured only in the deep-sleep
epochs. Whole-night HRV moves with how the night was staged, so a night with more REM or wake reads
differently for reasons that are not recovery. HRV taken only in deep sleep should be a cleaner
reading for the biggest single score. (This is a measurement argument. No citation in the evidence note tests deep-sleep HRV against
next-day readiness, so the replay is the test.)

**Raw routes, best first:**
1. Oura API → `hrv` (5-minute) and `sleep_phase_5_min` → mean RMSSD over the deep epochs.
2. Oura ring (Bluetooth rollup, no new nights since 17 Oct) → the per-5-minute RMSSD and our stager's
   hypnogram, already built together in the rollup → the same mean.
Our stager is a heuristic, not a measurement (`sleep-staging.ts`). The shadow model counts values
from it as **estimated**, at half weight (#2833); the Oura API's phases are Oura's own.

**Scoring:** directional, like `heart.overnight_hrv`, graded on the same population yardstick for
Level (HRV is highly genetic, so it only spans 60–90) and against the person's own deep-sleep normal
for Day.
- Personal normal: 30-day median of deep-sleep HRV, same source. Smallest meaningful change: 3 ms
  (the overnight HRV value today).
- A night with under a set number of deep epochs is missing (the minimum is **proposed** in the
  tuning proposal, since a mean over two epochs is noise).

**Weighting:** Not set here. Overnight HRV and resting HR already share one 13-point budget, so this
either replaces overnight HRV inside that budget or joins it. It does not add points. Gate 4 is the
test: if it correlates above about 0.8 with whole-night HRV on the owner's history, it replaces it.

**Red flag:** the existing ceiling for an overnight HRV score of 20 or less (#2832, cap 60) would
read whichever HRV unit carries the budget.

**Missing data:** a night with no stages, or too few deep epochs, falls back to whole-night HRV
(`heart.overnight_hrv`), so the pair never both drop out for the same reason.

**Validation:** against next-day fatigue (card 2) and against whole-night HRV on the same nights.
Replay states days moved.

---

## What these cards do not do

- They do not change a weight, a yardstick or a threshold anywhere in the app.
- They do not cover the other ideas on #2834 (sleep-architecture signature, the charger-aware wear
  gate, night perfusion, a multi-night temperature slope, breathing disturbances against weight,
  water-adjusted weight, aerobic threshold). The owner chose three of them; the rest wait.
- The order in which tuning proposals follow is the order above.
