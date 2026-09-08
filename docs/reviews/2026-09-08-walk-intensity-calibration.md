# Can the interval walk be calibrated? Yes — and it explains Q-523 — 2026-09-08

*Tuning · production data pulled 2026-09-08. Files **TN-24**; supplies the mechanism for **Q-523**.
Propose-only. Counts are the owner's account only (`claude_ro` is row-scoped).*

Owner, after a 30-minute interval walk that logged **30:00 in Z1 Recovery and 0:00 in every other
zone**: *"now that we have some data including steps/HR/cadence etc. can we make any calibrations or
formulas for this to optimise the walk?"*

**Yes — three, and the first one explains why `zoneMinutes` has been floored at zero for months.**

---

## 1. Zone 2 is unreachable on foot, and that is arithmetic rather than fitness

`hr-zones.ts:38` builds zones as **fractions of heart-rate reserve** (Karvonen), with Z1 spanning
**0.0 → 0.6**. For this owner (resting **52**, max **168**, reserve **116**):

| zone | lower bound |
|---|---|
| Z1 Recovery | **52 bpm** |
| **Z2 Light** | **122 bpm** |
| Z3 Aerobic | 133 bpm |
| Z4 Hard | 145 bpm |
| Z5 Peak | 156 bpm |

**Z1 spans 52–122 bpm — 60% of the entire usable range in a single bucket.** Everything from sitting
still to a brisk interval walk is "Recovery".

**The max is real, so this is not a stale anchor.** `oura_heartrate` holds **140 samples above 150**
and a genuine peak of **168** (2026-07-05, with 166 on 07-24). The zones are anchored correctly; the
training simply never reaches them — **nothing above 140 bpm has been recorded since 2026-07-24**,
six weeks ago.

**This is Q-523's mechanism.** That entry records `zoneMinutes` floored at 0 on **53 of 59 days** and
has never had a cause. The cause is that the owner's training is walking and lifting, and **neither
can reach 122 bpm**.

## 2. Cadence is the wrong lever, and the data says how wrong

Across **88 intervals over 10 sessions** with both cadence and HR:

| | |
|---|---|
| `corr(cadence, HR)` | **+0.512** |
| slope | **0.288 bpm per spm** |
| mean cadence separation, fast vs slow | **27.2 spm (31% faster)** |
| **mean HR separation, fast vs slow** | **7.9 bpm** |
| mean fast-interval intensity | **40.1% of reserve** (Z2 needs 60%) |
| best fast interval ever | **50.5% of reserve** (2026-08-18) |

**A 31% cadence increase buys 7.9 bpm.** Extrapolating the fit, averaging 122 bpm would take
**≈198 spm** — that is a run, not a walk.

**So the protocol's own control variable is nearly exhausted.** Walking speed is cadence × stride, and
at the owner's measured **0.739 m** stride (see
[2026-08-31](2026-08-31-measured-stride-from-cadence.md)) the achievable speed range simply does not
demand much cardiovascularly. **Grade or carried load are the levers that remain** — both raise the
metabolic cost at a walking speed the owner already sustains, where cadence cannot.

## 3. The protocol is not progressing

| date | fast spm | slow spm | fast HR | ΔHR | % reserve |
|---|---|---|---|---|---|
| 2026-08-01 | 123.5 | 116.6 | 103.1 | 9.8 | 44.1% |
| 2026-08-05 | 127.0 | 108.3 | 103.5 | 9.0 | 44.4% |
| 2026-08-07 | 125.2 | 90.1 | 100.4 | 9.6 | 41.7% |
| 2026-08-14 | 112.1 | 86.3 | 86.8 | 5.2 | 30.0% |
| 2026-08-18 | 118.0 | 86.7 | **110.6** | 6.4 | **50.5%** |
| 2026-08-19 | 120.2 | 87.7 | 96.2 | 8.2 | 38.1% |
| 2026-09-02 | 116.2 | 88.4 | 102.2 | 4.4 | 43.3% |
| 2026-09-04 | 117.7 | 84.6 | 96.0 | 10.0 | 37.9% |
| 2026-09-07 | 115.3 | 85.3 | 92.6 | 7.8 | 35.0% |
| 2026-09-08 | 112.3 | 81.1 | 93.4 | 8.6 | 35.7% |

**Fast/slow HR separation trends at −0.11 bpm per session** — flat across ten sessions. And **fast
cadence has fallen 123.5 → 112.3 spm** while slow cadence fell further (116.6 → 81.1), so the
*contrast* improved while the *effort* declined. A protocol whose hard intervals are getting easier is
not progressing.

**⚠ This is a description, not a diagnosis.** Ten sessions, one subject, and no controlled
comparison. The declining trend could equally be seasonal, terrain, or deliberate.

---

## 4. Is the session *efficient*? — it hits its prescription exactly, and the prescription is mislabelled

The owner's real question was efficiency: *"should steps increase or longer durations?"* That depends
on what the session is for, and `prescribed_runs` answers it:

| field | value |
|---|---|
| `run_type` | **easy** |
| `target_hr_low` / `high` | **68 – 97 bpm** |
| `target_zone_ids` | `[1, 2]` |
| `rationale` | *"A steady **Zone-2 aerobic** session — you should be able to hold a conversation."* |
| `duration_min` | 30 |

**The session averaged 89 bpm — dead centre of a 68–97 target. It is executed correctly.**

**But the prescription contradicts itself twice:**

1. **It calls itself "Zone-2 aerobic" while targeting 68–97 bpm, and Zone 2 starts at 122.** The
   target band lies **entirely inside Zone 1**. The label and the number cannot both be right.
2. **It prescribes a *steady* session; the walk player runs fast/slow cadence intervals.** Two
   different sessions under one prescription.

**⚑ This corrects an earlier line in this review**, which said *"the app currently prescribes
cadence"*. It prescribes **both** — an HR band in `prescribed_runs` and a cadence-interval structure
in the player — and they are not reconciled.

### So: steps, or duration?

**For the goal as actually targeted (68–97 bpm, conversational, easy aerobic), the intensity is
already right and duration is the correct lever.** That is what an easy aerobic session is: the
adaptation comes from time at a low intensity, not from raising it. **Increasing cadence would move
the session *away* from its own target**, not toward it.

**The interval structure is the inefficient part.** Measured across nine sessions:

| | |
|---|---|
| within-session HR drift (first → last fast block) | **+7.1 bpm** |
| fast-vs-slow contrast | **+7.7 bpm** |
| sessions where **drift exceeded contrast** | **5 of 9** |

**Simply staying on your feet for 30 minutes raises HR about as much as the intervals do.** The
"slow" halves sit at **33.3% of reserve** against the fast blocks' **40.1%** — so half the session is
spent giving back what the other half earned, for a 7.7 bpm contrast that time-on-feet supplies
anyway.

**Energy return, for scale:** 101 kcal over 30 min = **3.37 kcal/min gross**, about **2.29 kcal/min
net** of resting. So **+15 minutes ≈ +34 net kcal** — real, linear, and modest. Duration does not
compound; it adds.

**⛔ None of this makes the session bad.** At 33–40% of reserve for 30 minutes it is a good
easy-aerobic / step-accumulation session and it hits its target. **It is inefficient only against the
"Zone-2" label it carries**, which walking cannot satisfy at all.

## What to build

**(a) Report intensity against something a walk can reach.** The zone bar is structurally uninformative
for this training. Either add a walking-appropriate band below Z2, or surface **% of heart-rate
reserve** directly on the summary — 40.1% is a meaningful, movable number where "Z1, 30:00" is not.

**(b) Reconcile the prescription with itself.** `prescribed_runs` already carries an HR band
(68–97 bpm) and the owner hits it. **Fix the label, not the target** — calling a 68–97 bpm session
"Zone-2 aerobic" when Zone 2 starts at 122 is what makes the whole pillar read as broken. And decide
whether the session is *steady* (as the rationale says) or *intervals* (as the player runs); shipping
both is why the contrast is only 7.7 bpm.

**(b2) If a genuine Zone-2 stimulus is the goal, walking cannot supply it** — grade or carried load
are the only levers that reach 122 bpm. That is a product decision, not a calibration: an easy
aerobic walk and a Zone-2 session are different sessions.

**(c) Progress on measured separation, not on prescribed cadence.** The natural target is fast/slow HR
separation, which has been flat at 7.9 bpm. **Do not ship a target number from this review** — ten
sessions is not enough to set one, and a target that cannot be hit is the Q-504 mistake.

**⛔ Do not "fix" this by lowering the zone boundaries.** The Karvonen fractions are conventional and
the max is genuine; moving Z2 down to make walks qualify would make the zone label mean something
different from every other use of it, and would silently re-score history. **The fix is what the app
reports, not where the boundaries sit.**

---

## Failure surfaces not exercised

No code ran — SQL against production plus source reading. No `pnpm dev`, no device, no APK. **The
zone bounds were computed by hand from `ZONE_DEFS` and the owner's profile, not by executing
`computeHrZones`.** The cadence→HR slope is a linear fit to 88 intervals (r = 0.512, so it explains
~26% of the variance) and is used only to show that the required cadence is far outside the observed
range, not to predict any individual interval. **17 of 106 segments carry a distance**, so nothing
here rests on pace. Ten sessions, single subject.

---

# ADDENDUM — the app's own fast target has never been met, in 44 attempts (TN-25)

Owner: *"the interval walk is a known effective exercise — what makes it effective is the 2 speeds.
Should I be walking faster or slower during any phases?"*

**The app already answers this, and it has been saying "push" on every fast block for ten sessions.**

`walk-active.tsx:67-68` sets the live pacer's targets from the app's own Karvonen helper:

```ts
fast: hrReserveTarget(0.70, restingHr, hrMax),   // 133 bpm for this owner
slow: hrReserveTarget(0.40, restingHr, hrMax),   //  98 bpm
```

Those fractions — **70% of reserve fast, 40% slow** — are the guided-interval-walking protocol the
feature implements. They are the *definition* of the two speeds the owner is asking about.

## Measured against the app's own targets

| | |
|---|---|
| fast target | **≥ 133 bpm** |
| **your fast blocks** | **98.5 bpm mean (40.1% reserve)**, best single block **115** |
| **fast blocks meeting the target** | **0 of 44 — 0%** |
| slow ceiling | ≤ 98 bpm |
| your slow blocks | 90.7 bpm mean (33.3%) |
| slow blocks within the ceiling | 35 of 45 — **78%** |

### The finding, in one line

**Your fast average (98.5 bpm) is the app's slow target (98 bpm).** The whole session runs one phase
low: the fast blocks are working at the intensity prescribed for recovery, and the slow blocks sit
below that again.

**`classifyZone` returns `'push'` whenever a fast block is under target — so the pacer has shown
"push" on 100% of fast intervals across ten sessions.** A live cue that can only ever say *push* is
not coaching; it is the Q-504 failure in real time.

### And the target is not reachable by walking

Closing a **34.7 bpm** gap at the measured **0.288 bpm/spm** needs **+121 spm → 233 spm**. The best
single fast block ever recorded is **115 bpm**, still 18 short.

| date | fast avg | vs target |
|---|---|---|
| 2026-08-18 (best) | 110.6 | **−22.6** |
| 2026-09-08 (latest) | 93.4 | **−39.8** |

**So the answer to "faster or slower" is: faster on the fast blocks, and by more than walking can
deliver.** The slow blocks are compliant and need no change.

## What this means for the calibration

**The 0.70 fraction is right for the protocol and wrong for this user's mode of exercise.** Guided
interval walking is validated largely in older adults, for whom brisk walking does reach ~70% of
reserve; a 33-year-old with a 168 bpm max cannot get there on flat ground at a 0.739 m stride.

**Three options, and the choice is the owner's:**
1. **Make the fast block a jog or an incline** — keeps the 70% target honest and the protocol intact.
2. **Re-anchor the fast target to what walking can reach** (~50–55% of reserve, i.e. 110–116 bpm) and
   rename the session so it is not claiming a stimulus it does not deliver.
3. **Leave the target and stop showing a verdict that is always "push"** — the weakest option, but
   better than the current state.

**⛔ Do not silently lower the target to make the cue turn green.** That is the Q-504 mistake in the
other direction: a target met by redefinition teaches nothing. Whichever option is chosen, the
session's *name* and its *target* have to agree.

## The efficiency metric the owner asked for

Both halves are computable from `activity_logs.segments` today, with no new capture:

- **Fast-block compliance** — % of fast blocks reaching the fast target. **Currently 0%.**
- **Interval contrast** — fast %reserve minus slow %reserve. **Currently 6.8 points against the
  protocol's 30.**

Those two numbers say more about whether a session did its job than anything on the summary screen
now, and the second is the direct read on *"what makes it effective is the 2 speeds"*.

**⚠ Do not ship a target for either number from this review.** Ten sessions cannot calibrate one, and
the fast-block figure is 0% precisely because the target above is unreachable — fix that first, then
measure.
