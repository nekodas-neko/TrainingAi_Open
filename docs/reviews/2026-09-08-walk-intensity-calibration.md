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

---

# ADDENDUM 2 — on a treadmill the control variable is belt speed, and the app never records it (TN-26)

Owner: *"I mostly do this on a treadmill so we can't add incline… currently slow is below 90 spm
(2 km/h) and fast above 120 (4 km/h). If we moved slow to below 100 and fast to above 130 — what's
best?"*

## The proposal is directionally right and about **+2 bpm** in size

Using the owner's own speed↔cadence mapping and holding each phase's stride constant:

| phase | cadence | belt speed | HR effect |
|---|---|---|---|
| slow | 90 → **100** spm | 2.0 → **2.2** km/h | **+0.9 bpm** |
| fast | 120 → **130** spm | 4.0 → **4.3** km/h | **+1.3 bpm** |

Against a **34.7 bpm** shortfall on the fast target, that is not the lever.

## The deeper problem: on a treadmill, cadence is not a control at all

The owner's mapping implies a stride of **0.370 m at 2 km/h** and **0.556 m at 4 km/h** — both far
below the **0.739 m** measured outdoors. That is the giveaway: **at a fixed belt speed, taking more
steps means taking shorter ones.** Cadence follows speed on a treadmill; it does not drive it.

**So a cadence target is the wrong instruction for a treadmill walk.** The only lever on a flat belt
is **km/h**.

## And the app cannot see it

`walk-summary.tsx:141-146` saves treadmill walks as activity type `treadmill` with
`is_distance_based = false` — **no distance, no pace, no speed.** Treadmill sessions capture
**cadence and heart rate only**, and there is no belt-speed field anywhere.

**Consequence: the app cannot learn this user's speed→HR relationship, and cannot prescribe in the
one unit that would work.** Most of the owner's walks are treadmill sessions — only **17 of 106
segments carry a distance** — so this is the majority case, not an edge.

## Why the numbers cannot be extrapolated

Two speed points exist (2 km/h → 90.7 bpm, 4 km/h → 98.5 bpm), giving **≈3.9 bpm per km/h**.
Extrapolated, 70% of reserve would need **~12.9 km/h** — which is obviously wrong: that is a run, and
HR would arrive far sooner. **The slope was measured in the flattest part of the curve and does not
survive extension.** The walk/run transition sits around 7–8 km/h and the HR response steepens
sharply approaching it.

**⛔ Do not set a belt-speed prescription from these two points.** It is the same error as fitting a
threshold to a saturated input.

## The calibration this actually needs

**One session, and it produces the curve the app is missing:** 3 minutes each at **3, 4, 5, 6, 7
km/h**, recording steady-state HR at each step. That yields a personal speed→HR curve, from which
fast and slow blocks can be set in **km/h** — the unit the treadmill actually exposes.

**Then the prescription becomes:** *"fast blocks at X km/h, slow at Y"*, with X chosen from the
measured curve at whatever reserve fraction the protocol settles on (see TN-25 — the current 0.70 is
unreachable on foot).

**Two changes make this possible, in order:**
1. **Capture belt speed on treadmill walks** — a single per-block field the owner sets once per
   phase, or a session-level pair. Without it nothing here is learnable.
2. **Prescribe treadmill blocks in km/h, not spm.** Keep cadence as a *reported* stat; it is a good
   read on effort outdoors and a dependent variable indoors.

## On "conversational" — the owner is applying the slow-phase rule to the fast phase

The prescription's rationale reads *"a steady Zone-2 aerobic session — you should be able to hold a
conversation."* The owner reasonably concluded a harder fast block would breach it.

**But that guidance describes a steady easy session, not the fast half of an interval walk.** The
same session simultaneously carries a pacer target of **70% of reserve**, which is by definition not
conversational. **The app is issuing two incompatible instructions and the owner has been following
the conservative one.** That is the third contradiction in this prescription (see TN-24) and the one
that directly caused the question.

**⚠ What this review does not settle:** what the fast-phase intensity *should* be for this user. That
is TN-25's owner decision, and it cannot be answered before the speed→HR curve exists.

---

## Addendum 3 — the owner declined to tune to the treadmill; heart rate is the answer

**Owner, 2026-09-08:** *"let's not tune to the treadmill — like you said it changes based on
location, what do you suggest we do?"* This retires the belt-speed direction that addendum 2 was
built around, and it is the right call. What follows replaces it, and TN-26 was rewritten to match.

**Why the redirect is correct.** Every control this walk could be prescribed in is surface-dependent
except one:

| prescribed in | treadmill | footpath | hill | portable? |
|---|---|---|---|---|
| cadence (spm) | 120 spm ≈ 4.0 km/h (0.556 m stride) | 120 spm ≈ 5.3 km/h (0.739 m stride) | same spm, more work | **no** |
| speed (km/h) | readable off the belt | not recorded on 89 of 106 segments | same speed, more work | **no** |
| **% HR reserve** | **same meaning** | **same meaning** | **same meaning** | **yes** |

Heart-rate reserve is defined against this user's own resting HR and max, not against the ground, so
it is the only unit in which "the fast block" is the same instruction indoors and out. Everything
addendum 2 wanted the belt speed for — knowing whether the fast phase is actually hard — heart rate
already answers, and answers everywhere.

**So the prescription changes unit, not ambition.** The pacer already computes the band
(`hrReserveTarget`); what is missing is an achievable target (**TN-25**, still the owner's decision)
and an instruction phrased as a loop — *raise effort until HR reaches X* — instead of a fixed control
(*walk at 120 spm*). Cadence stays as a starting hint and a reported stat; it is a genuinely good
read on effort outdoors and a dependent variable indoors.

**And the two calibration metrics the owner asked for are already surface-independent**, which is the
part worth keeping from the whole thread:

- **Fast-block compliance** — share of fast blocks whose steady HR reached target. **0 of 44 today.**
- **Interval contrast** — mean fast %reserve minus mean slow %reserve. **6.8 points today**, against
  the protocol's own targets implying **30**.

Both are computed from `activity_logs.segments` and HR alone. A treadmill session and an outdoor
session produce numbers that can sit in the same trend line without any surface adjustment — which
is exactly what a calibration metric has to do to be worth trending.

**What is still worth capturing, demoted.** Recording belt speed indoors and distance outdoors is
still useful, but as *evidence*, not as the target: it lets the app learn *this surface, this control
→ this HR* and offer a better opening hint. It no longer gates anything, and specifically it no
longer blocks TN-25 — the fast-block reserve fraction is answerable from HR data that already exists.

**⛔ Unchanged from addendum 2:** do not extrapolate a speed prescription from the two indoor points.
2 km/h → 90.7 bpm and 4 km/h → 98.5 bpm gives ≈3.9 bpm/km/h, which puts 70% reserve at ~12.9 km/h.
The owner's proposed tweak (slow 90→100 spm, fast 120→130 spm) is worth ≈**+0.9** and **+1.3 bpm**
against a **34.7 bpm** shortfall — the clearest single piece of evidence that the control is the
wrong lever rather than one that needs a bigger setting.

---

## Addendum 4 — the fourth contradiction: two zone models, and the app mixes them

**Owner, 2026-09-09:** *"is it working correctly I guess is the question — would it be more beneficial
to just speed walk for the 30 minutes instead… IS that the goal; do we want more Z2 time?"*

This addendum supersedes TN-25's recommended option. The three options in that entry were all built
on the premise that **133 bpm is Zone 2 for this owner**. It is not — not under the model the
session's own copy is written in.

### The prescription's words and its numbers come from different zone models

| model | Zone 2 is | for this owner (RHR 52, max 168) |
|---|---|---|
| **% of HRmax** — where *"conversational aerobic base"* comes from | 60–70% of max | **101–118 bpm** |
| **% of HR reserve** (Karvonen) — what `ZONE_DEFS` uses | 60–70% of reserve | **122–133 bpm** |

Both are legitimate. The app uses the **language** of the first (*"a steady Zone-2 aerobic session —
you should be able to hold a conversation"*) and the **thresholds** of the second. For a user with a
resting HR of 52 they differ by **21 bpm**, which is the whole of the gap this review has been
measuring.

**So the owner has been following the words while the app graded him against the numbers.** Measured
across 44 fast blocks: mean **98.5 bpm = 58.6% of HRmax**, just under classic Zone 2; best single
block **115 bpm = 68.5% HRmax**, comfortably inside it. **17 of 44 fast blocks already reached
101 bpm or more, and `classifyZone` returned `'push'` on every one.**

**⚠ The 168 max is observed, not tested** — 63 samples at 160+, so it is not one artefact, but it is a
floor on the true max rather than a measurement of it. A higher true max moves classic Zone 2 up and
makes these walks look *easier*, not harder. The direction of this finding does not depend on it.

### Zone-2 minutes is the metric, and it is surface-independent

Minutes at classic Zone-2 intensity (≥101 bpm) across the 11 recorded sessions, 318 minutes walked:

| | Z2 min/week |
|---|---|
| **today, intervals as executed** | **~13** |
| intervals, if every fast block reached 105–115 | ~29 |
| **30 min continuous at 105+ bpm** | **~60** |

**⛔ Continuous at the CURRENT fast pace gives zero** — 98.5 bpm sits 3 bpm under the floor. The
continuous option only wins at a genuinely brisker hold, not at today's fast-block effort.

**It is already reachable and has already happened:** 2026-08-18 produced **21 minutes** in band and
2026-09-02 **18**. The four most recent sessions produced **none**. This is an execution range, not a
physiological ceiling.

### Why the interval structure is not earning itself

Fast-minus-slow contrast measures **7.7 bpm** (per-session range 4.4–10.0). Interval walking beats
continuous walking when the fast half is genuinely hard — that is its entire mechanism. At this
contrast the session is a continuous walk with a wobble. And TN-25's own arithmetic puts a genuinely
hard fast half at **233 spm**, which is a jog.

### Recommended: a fourth option, and it is better than the other three

**A 30-minute continuous brisk walk against one band, 105–118 bpm.** Roughly **quadruples** Z2
minutes for the same 30 minutes; one instruction instead of two speeds that cannot be separated
enough for the structure to pay; and it changes nothing mechanically — the pacer already computes an
HR band, only the target it compares against moves, and the cue stops saying "push" every three
minutes. **Keep the intervals only if the owner will jog the fast blocks**, which is the honest
condition rather than a hedge.

Reversal cost is near zero: a target constant and a session label.

**⛔ Do not read this as "the Karvonen model is wrong".** It is a standard model and `hr-zones.ts` is
internally consistent. The defect is that one prescription draws its copy from one model and its
thresholds from another, so the session cannot be both what it says and what it measures.

---

## Addendum 5 — correcting addendum 4: the protocol is right, and he can already do it

**Owner, 2026-09-09:** *"there was meant to be some research on the interval walking for 30 mins which
showed great cardio results — are you saying it would be better to just walk for 30 mins at a fast
speed?"*

**No, and addendum 4 implied otherwise. That was an overstatement and this addendum corrects it.**

### The research holds and the app implements it faithfully

The interval-walking protocol (Nemoto, Masuki and Nose, Shinshu University) is 3 min fast / 3 min
slow × 5, four-plus days a week, over months, with the **fast phase at ~70% of peak aerobic
capacity** — and it beat a continuous moderate-walking control on peak VO₂, leg strength and blood
pressure. **`walk-active.tsx:67`'s `hrReserveTarget(0.70, …)` is a correct rendering of that
parameter**, and 133 bpm is the right number for this owner. The app is not misconfigured.

**⚠ Recalled from the study design rather than read from the papers here** — treat the specific
outcome measures as approximate. The load-bearing parameter, the fast-phase intensity, is the part
this review verifies from the owner's own data, which does not depend on the citation.

**What does not transfer is the population.** Those cohorts were roughly 60–70 years old, and for
them brisk walking genuinely reaches 70% of peak capacity. At 33 with a max of 168 it does not — which
is what TN-24 and TN-25 already measured, and is a statement about walking, not about the protocol.

### The owner has already exceeded the fast-phase target, on foot

| | avg HR | % reserve | pace |
|---|---|---|---|
| **2026-07-24, a 9.2-min run (1.43 km)** | **145** | **80.2%** | 6.4 min/km — 9.4 km/h |
| 2026-07-19, outdoor walk (1.29 km, 14.2 min) | 117 | 56.0% | 11.0 min/km — 5.4 km/h |
| treadmill fast blocks | 98.5 | 40.1% | — |
| treadmill session average | ~90 | 32.8% | — |

**Nine minutes at 145 bpm average is above the protocol's fast phase.** Five bouts of three minutes at
133+ is inside what this owner has already demonstrated. The 60-day HR record puts ≥133 bpm on
**two days out of sixty** (2026-07-19 and 07-24), so the capacity is there and the recent training
simply has not used it.

**Note the surface effect in the same table:** an outdoor walk averaged **117 bpm** against the
treadmill's **89–91**. Same activity, 27 bpm apart — TN-26's argument, measured.

### So the recommendation inverts

**⚑ Option 1 — jog the fast blocks — is the recommendation, and addendum 4 was wrong to rank it last.**
It is the protocol executed as designed, the owner has the capacity for it, the 133 bpm target becomes
correct and reachable, and the pacer stops rendering a cue that can only say "push". The slow blocks
stay a walk; that half already works.

**Option 4 (continuous brisk walk, 105–118 bpm) is the FALLBACK if the session stays a walk** — more
Zone-2 volume than today (~60 against ~13 min/week, and the 07-19 walk shows the band is holdable) but
**it is not the interval protocol and must not be described as one.**

**⛔ Do not lower the 133 bpm target to match the copy.** That was addendum 4's implicit direction and
it is backwards: the target is right and **the copy is wrong**. *"A steady Zone-2 aerobic session —
you should be able to hold a conversation"* describes neither the protocol nor its intensity. The
session should say what it is — a hard interval session with easy recovery — which also resolves the
contradiction TN-24 found without touching a threshold.

---

## Addendum 6 — the actual zone inconsistency: ONE model, TWO max-HR anchors

**Owner, 2026-09-09:** *"we should only have one calculation for our heart rate zones so try make them
consistent."*

**Addendum 4's central claim was wrong and this addendum retracts it.** It said the app mixes a
%HRmax model with a %HR-reserve model. It does not. `hr-zones.ts` is the only zone model in the app
and every band comes from `computeHrZones`. The real inconsistency is different, narrower, and
genuinely worth fixing.

### The app resolves TWO different max heart rates, on purpose

`resolveHrProfile` (`hr-profile.ts:61`) returns both, and `hr-profile.ts:17-38` documents why:

| field | value here | rule | what uses it |
|---|---|---|---|
| **`maxHr`** | **187** | observed only if **≥** age-predicted, so 220−33 wins over 168 | **every zone band** |
| **`targetAnchorMax`** | **168** | the corroborated observed max | **the guided walk's targets** |

The reasoning on each is sound in isolation — anchoring a *ceiling* on a low observed max makes every
hard effort read over 100%, and anchoring a *reachable target* on 220−age puts the fast block out of
reach. **But the walk screen shows both at once**, so the target and the zone bar it sits beside are
computed against denominators 19 bpm apart.

### The numbers coincide by accident, and that is worse than disagreeing

- Walk fast target: `0.70 × 116` (observed reserve) + 52 = **133 bpm**
- Zone 2 floor: `0.60 × 135` (age reserve) + 52 = **133 bpm**

**They are the same number for entirely different reasons.** Nothing holds them together: a corroborated
observed max of 175, or a resting HR drifting to 55, separates them silently and the walk starts
targeting a boundary that is no longer Zone 2. **The copy's "Zone 2" is currently correct by
coincidence.**

### ⚠ Correction to TN-24: Zone 1 is 52–132, not 52–122

TN-24 states Zone 1 spans **52–122 bpm**. That was computed against the observed max of 168. The zone
bands use `maxHr` = **187**, so the true bands are:

| zone | name | bpm |
|---|---|---|
| 1 | Recovery | 52–132 |
| 2 | Light | 133–145 |
| 3 | Aerobic | 146–159 |
| 4 | Hard | 160–173 |
| 5 | Peak | 174+ |

**TN-24's conclusion survives and gets stronger**: Zone 1 is **81 bpm wide, 60% of the whole range**,
and the 44 fast blocks reach it 0 times out of 44 either way. Only the boundary number changes.

**⚠ Note also that the app's Zone 2 is named "Light" and Zone 3 is "Aerobic".** The walk's copy says
*"Zone-2 aerobic"*, which pairs the number of one band with the name of the next. That phrase matches
nothing in `ZONE_DEFS`.

### 220 − age is the weaker half, and it is 19 bpm above anything he has recorded

Every zone the owner sees is anchored to **187** against **107,255 HR samples** whose maximum is
**168** — including a run at 161. Re-read against that anchor his efforts land low: the 2026-07-24 run
at 145 bpm average reads **Zone 2**, and his best walk block reads Zone 1 at **61.5% of max**.

**Recommendation: one anchor, and it should be the corroborated observed max.** 220−age is a
population formula with a standard deviation around 10–12 bpm; using it as a personal ceiling for
someone with a six-figure sample count is the weaker of the two claims about this owner's physiology.
The documented objection — that a low observed max makes hard efforts read over 100% — is real but
smaller: a reading above the anchor is informative (it *raises* the observed max next time), whereas a
ceiling nobody can reach silently under-rates every session forever.

**⛔ Do not "fix" this by deleting `targetAnchorMax`.** Two named anchors beat the three accidental
resolvers they replaced, and the walk's target would jump from 133 to **147** overnight if it took
`maxHr` instead. The fix is to make **one** of them the truth for both uses, not to collapse the
naming.

**⚠ Not yet audited: every other `computeHrZones` call site.** `build-day-audit.ts:134` and
`score-audit/heart-rate.ts:58` pass `hrMaxFromAge(...)` directly rather than a resolved profile, which
is a third path to a max. Whether they agree with the two above is open and is TN-30's first job.

---

## Addendum 7 — the owner ran the experiment and won it: DURATION is the lever, not cadence

**Owner, 2026-09-09:** *"I don't think your estimation for HR is right — I reckon if I walk for longer
at a faster pace it will increase my HR."* They then walked **35 minutes at 5 min fast / 2 min slow**
and sent the summary. **The hypothesis is confirmed and this review's model is the thing that was
wrong.**

### The session against the ten that preceded it

| | previous 10 sessions | **2026-09-09** | delta |
|---|---|---|---|
| fast-block cadence | 118.6 spm | 121.3 | **+2.7 spm** |
| **fast-block HR** | 98.5 bpm | **107.0** | **+8.5 bpm** |
| slow-block HR | 90.7 bpm | 96.4 | +5.7 bpm |
| **session average HR** | ~90 bpm | **104** | **+14 bpm** |
| contrast (fast − slow) | 7.8 bpm | 10.6 | +2.8 bpm |

**+8.5 bpm on the fast blocks for +2.7 spm of cadence.** The cadence slope predicts **+0.8 bpm** for
that. Nearly all of the gain came from somewhere the model has no term for.

### Within the session, the model misses by a factor of five

| set | 1 | 2 | 3 | 4 | 5 | rise |
|---|---|---|---|---|---|---|
| fast cadence (spm) | 116 | 119 | 122 | 122 | 128 | **+11.7** |
| **fast HR (bpm)** | **97** | 103 | 109 | 110 | **116** | **+19** |
| slow HR (bpm) | 73 | 95 | 99 | 108 | 107 | **+34** |

**The cadence rise of +11.7 spm predicts +3.4 bpm. The fast blocks rose +19.** **15.6 bpm — 82% of the
movement — is duration, and the model contained no duration term at all.**

**⚠ TN-24's conclusion was half right and its prescription was wrong.** *"Cadence is nearly exhausted
as a lever"* is confirmed here — 2.7 spm bought almost nothing directly. But the entry then said
*"grade and carried load are the levers that remain"*, **and it never considered duration**, which is
the lever that actually moved 19 bpm on flat ground with no load. The reason is structural: every
figure in this review was fitted **across blocks**, so a within-session effect was invisible to it by
construction.

### The mechanism is accumulated load, not interval contrast — and that matters

Per-set contrast: **+24, +8, +10, +2, +9**. It collapsed after set 1 and never returned. Look at why:
**the slow blocks stopped recovering.** By set 4 the "slow" block sat at **108 bpm — above the
historical FAST average of 98.5** — and the last two slow blocks (108, 107) were harder than the first
three fast blocks.

**So the session did not become better intervals. It became a continuous brisk walk with a ripple on
it, and that is what produced the 14 bpm.** The owner's own experiment is the strongest evidence yet
for the continuous option (addendum 4's option 4) — arrived at empirically rather than argued.

### The app reported 35 minutes of "Recovery"

**Time in zone: Z5 0:00 · Z4 0:00 · Z3 0:00 · Z2 0:00 · Z1 Recovery 34:59.**

The best walk in the record — 35 minutes, HR climbing the entire time, peaking at 123 — is rendered as
35 minutes of recovery. **This is TN-24 and TN-30 demonstrated on one screen**, and which of the two
it is depends entirely on the anchor:

| anchor | Zone 2 floor | fast avg 107 | peak 123 |
|---|---|---|---|
| **observed max 168** (walk targets, Body Battery) | **122** | 47% reserve, 64% HRmax | **crosses it** |
| **age max 187** (the zone bar) | **133** | 41% reserve, 57% HRmax | 10 bpm short |

**Under the anchor the walk's own targets use, this session reached Zone 2. Under the anchor the zone
bar uses, it did not.** TN-30 is no longer a tidiness argument — it decides whether this session
earned anything.

### What this review got wrong, plainly

1. **The static cadence model was the wrong instrument** and its ≈238 spm figure should never have
   been written. Already qualified in TN-24; this addendum is the measurement that retires it.
2. **"Walking cannot raise this owner's HR meaningfully" was wrong.** 104 average and a 123 peak from
   a walk, unaided by incline or load.
3. **The prediction that held was the pessimistic one, and it is the app's fault, not the owner's:**
   the session still reports 0:00 in Zone 2.

**⛔ Do not now swing to "duration is the whole answer".** This is **one session**, it changed three
things at once (block length 3→5 min, recovery 3→2 min, total 30→35 min), and drift has a ceiling —
it cannot keep adding 19 bpm every session. **What is established is that the duration term exists and
is large; what is not established is its shape.** Two or three more sessions at this structure would
settle it, and the per-block data to fit it is already stored.
