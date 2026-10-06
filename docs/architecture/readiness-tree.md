# The readiness tree — from the score down to its smallest units

**Status:** agreed direction (owner, 2026-10-06), not yet built. Tracking issue: #2356. Mockups:
`docs/design/2026-10-06-readiness-hub.html`; scoring test cases and baseline windows:
`docs/design/2026-10-06-readiness-scoring-cases.html`.

Read with [`adaptive-scoring.md`](adaptive-scoring.md) (how bands and normals are learned per
person) and [`component-references.md`](component-references.md) (the research default for each
unit). Today's shipped model is described in [`scoring-structure.md`](scoring-structure.md). Every
threshold in the app, classed as learned / guarded / constant / model with its gaps, is in
[`threshold-inventory.md`](threshold-inventory.md) (gaps filed as #2371–#2375, #2341).

## The rule

**Readiness is only the weighted pillars.** `Readiness = Σ pillar × weight`, and each
`pillar = Σ unit × weight`. Nothing is bolted on afterwards: today's training-load modifier
(+3 to −15, `lib/health/readiness-payload.ts`) becomes a unit under Activity. So **100 needs every
pillar at 100** on the same morning — near-perfect sleep *and* everything else.

Weights at both levels are a `type: tuning` decision for the owner, proposed with the number of
past days they move. History is re-scored (owner OK, trial mode).

## Three scoring shapes

Every unit uses exactly one:

| Shape | 100 when… | Falls when… |
|---|---|---|
| **Sweet spot** (range) | inside the person's ideal band | too little **or** too much — the two sides may fall at different rates |
| **Steady** (closer is better) | at the person's normal | it drifts either way |
| **Directional** | ≥ 1.5σ past the normal in the good direction | it moves the bad way |

For steady and directional units, "normal" is the **30-day** baseline. A sweet-spot band starts from
the research default and is refit to the person. How a unit is scored is **Level + Day**, below. Low-wear nights and nap fragments are
excluded from every window.

## The tree

| Pillar | Unit | Shape | Reference | Notes |
|---|---|---|---|---|
| **Sleep** | duration | sweet spot | guarded | default 7–9 h, refit per person |
| | efficiency | directional ↑ | learned | |
| | deep + REM share | sweet spot vs normal | constant | |
| | latency | sweet spot | constant | falling asleep instantly is a sign of debt, not health |
| | timing / consistency | steady | learned | vs the person's usual bed and wake times |
| | sleep balance (7-day debt) | sweet spot | guarded | |
| **Heart** | overnight HRV | directional ↑ | learned | |
| | overnight resting HR | directional ↓ | learned | |
| | overnight settling (recovery index) | directional | learned | |
| | daytime resting HR, still periods | directional ↓ | learned | **new** |
| | HR recovery after exercise | directional ↑ | learned | **new** — the density gate in #2234 first |
| **Activity** | yesterday's movement | sweet spot | guarded | too much lowers it — see below |
| | zone minutes (week) | sweet spot | constant | WHO 150–300 moderate-equivalent; vigorous line per #2198 |
| | training load 7:28 | sweet spot | constant | 0.8–1.3 = 100 (#2194) |
| | block trend 28:90 | sweet spot | constant | #2340 |
| **Body** | temperature | steady | learned | 100 at normal — fixes #2359 |
| | breathing rate | steady | learned | |
| | SpO₂ | threshold | constant | fine above ~95 %, falls below |
| | weight vs plan | steady | constant | against the goal pace (#2071: recomp 0.3 % BW/week) |
| | energy balance | sweet spot | guarded | near the #2071 budget; a large deficit or surplus both fall |
| | protein, hydration | reach target | constant | |
| | daytime stress | directional ↓ | learned | elevated HR while still — counted here only, not again in Heart |

## Where each number comes from — self-tuning (owner, 2026-10-06)

Most references are **learned from the person's own data**, so the model tunes itself as data arrives.
Each unit's reference is one of three kinds (the *Reference* column above):

| Kind | How it works |
|---|---|
| **learned** | The person's own distribution sets the scale: p10 ≈ 30, median = 70, p90 and above = 100 (mirrored for lower-is-better). Medians and percentiles, not means, so one bad week can't redefine "normal". |
| **constant** | A research value that does not change per person — weekly zone minutes, SpO₂ ≥ 95 %, protein g/kg, hydration, training load 0.8–1.3, sleep-stage ratio ranges (`component-references.md`). |
| **guarded** | Learned, but only **inside** the research range: the person's own sweet spot, clamped to the guardrails (e.g. sleep duration learned within 7–9 h). |

**Why guarded exists.** Pure self-relative scoring normalises a bad habit: a month of 5½-hour nights
would make 5½ h the median and score it 70. Wherever a real health target exists, the personal band
may only move inside it, so a chronic shortfall keeps scoring low however consistent it is.

**Maturity**

| Days of data (per unit, valid days only) | What scores |
|---|---|
| 0–13 | research defaults; the unit shows "learning", never a fake number |
| 14–29 | the person's own baseline, marked provisional |
| 30+ | settled; refit monthly, shadow-scored a week before it replaces the live values |

Excluded from every window: low-wear nights, nap fragments (#2192), and days the person flagged as
unwell. **Progress is shown, not scored away:** as fitness improves the median rises and a good day
still reads ~70; the gain appears in the 90-day window ("HRV normal up 6 ms this season") on the
pillar screen.

## Level + Day — how a unit is scored (owner, 2026-10-06)

**Supersedes "70 at your normal, 100 at +1.5σ".** That curve fails the owner's own test: someone with
perfect sleep and activity every day would read 70 forever, with no way to see improvement. So the
reference cannot also be the scale. Every unit is scored in two parts:

| Part | Question | Compared against |
|---|---|---|
| **Level** | How good is your *normal*? | absolute yardsticks — research ranges (sleep 7–9 h, WHO zone minutes, protein g/kg, SpO₂) or population norms for age and sex (HRV, resting HR) |
| **Day** | How is today versus your normal? | your own history — your median and spread, 30-day window |

`unit score = clamp(Level + Day, 0, 100)`. The normal and the spread are learned per person (the
self-tuning above); only the yardstick that grades the normal is fixed.

| Person | Level | Day | Score |
|---|---|---|---|
| Sleeps 8 h of great sleep every night | ~95 | ±0 | ~95; a slightly better night reaches 100 |
| Average sleeper, great night | ~70 | +15 | 85 |
| 5½ h every night, consistently | ~40 | ±0 | 40 — a habit is not excused by being consistent |
| Average sleeper, bad night | ~70 | −25 | 45 |

Units that only mean something as a change (temperature, breathing rate) have **no Level**: steady
at your normal is 100, and Day only subtracts. As a person improves, Level rises with them, so
progress shows in the score itself as well as in the 90-day window.

### Edge cases this must survive — each becomes a test

| # | Case | What would go wrong | Rule |
|---|---|---|---|
| 1 | Perfect and consistent (the owner's case) | stuck at "average" | Level grades the normal: ~95–100 |
| 2 | Bad habit, consistently | 5½ h scored as fine | Level grades the normal against the research range |
| 3 | Genetically low HRV, perfect lifestyle | capped forever by population norms | for highly genetic units (HRV, resting HR) Level spans only **60–90**, so Day and the other units decide; genetics cannot pin a pillar |
| 4 | Very consistent person — tiny spread | a 2 ms HRV wobble reads as a crisis | **minimum meaningful change per unit** (e.g. HRV ±3 ms, resting HR ±2 bpm, temperature ±0.15 °C) floors the spread |
| 5 | Too much of a good thing (10 h sleep, very high load) | rewarded as "more" | sweet-spot units grade *both* Level and Day on the range shape: above the band falls |
| 6 | Chronic overload that has become normal | ACWR adapts and reads fine | 28:90 block trend falls out of band; Heart's Level drifts down; the 90-day window flags it |
| 7 | Sick weeks drag the normal down | recovery then scores as "great" | flagged unwell days and low-wear nights are excluded; medians, not means |
| 8 | New routine — shift work, travel, new program | every day scores as an anomaly | a step change that holds 7+ days is treated as a **regime change**: re-baseline faster, ask once ("new routine?") |
| 9 | Menstrual cycle | temperature/HRV/resting HR penalised every luteal phase | cycle-aware normal (per-phase baseline) when the cycle is tracked, or a detected ~28-day rhythm; never scored as illness |
| 10 | Medication, altitude, pregnancy | population Level misleads (beta-blockers lower HR; altitude lowers SpO₂) | a declared **context** adjusts the yardstick; asked once when a unit sits out of range for 14+ days unexplained |
| 11 | Sensor change (ring → strap → Health Connect) | measurement method shifts the normal | baselines are kept **per source**; a source change restarts that unit as provisional |
| 12 | Unlogged food or hydration | counted as zero intake | not logged = missing, not zero: the unit drops out and its pillar renormalises, and says so |
| 13 | Daytime sleeper (night shift) | main sleep labelled a nap | the main sleep period is the longest of the 24 h, not a clock window (and #2192's freeze holds) |
| 14 | Fewer than 14 valid days | fake precision | Level from population defaults, Day shown as "learning"; settles at 30 days |
| 15 | Ceiling — great normal and a great day | sum exceeds 100 | clamp at 100; a great normal keeps its room to show 100 |

## Inputs are device-agnostic — the input cascade (owner, 2026-10-06)

**Scoring never reads a device.** Every unit reads one or more **named, normalised inputs** —
`steps/min`, `MET/min`, `HR/min`, `HR drop 60 s after a set`, `sleep stages`, `temperature
deviation`, … — and each input has an ordered **cascade** of ways to obtain it. Any source that can
fill a rung does; the best available rung wins.

| Rung | Meaning | Example: `MET/min` | Example: `steps/min` | Example: `HRR60` |
|---|---|---|---|---|
| 1 · provided | the device reports it | Oura MET | Oura / Health Connect steps | — |
| 2 · derived | computed from rawer data we hold | from raw accelerometer | counted from raw accelerometer | from dense HR (strap, or any ≥1 Hz series) around the set |
| 3 · estimated | inferred from a coarser signal | from heart rate (HR reserve), or a logged activity's compendium MET | — | — |
| 4 · missing | nothing can fill it | unit not scored | unit not scored | unit not scored |

Rules (owner, 2026-10-06):

- **Per minute, best rung wins.** A day can mix sources: ring MET in the morning, strap-derived
  values through a workout. Each minute takes the best rung that has it.
- **Every value carries its provenance** (source + rung). Lower rungs **score the same**, and the
  screen says where the number came from ("estimated from heart rate"). Baselines keep provenance so
  a measured normal is never silently mixed with an estimated one (edge case #11).
- **Missing is missing, never zero.** A unit with no input on any rung drops out and its pillar
  renormalises over the units that have data, and says so (edge case #12).
- **A new device only has to fill inputs.** Adding a source means writing its adapter to the named
  inputs, never touching a scorer. If a unit uses an input, the cascade must name at least one
  rung-2 or rung-3 route, or say plainly that the unit is device-limited.

## Too much activity costs twice, and that is correct

Activity is a sweet spot, so overdoing it lowers **today's Activity score**. If the body was
genuinely overloaded, **tomorrow's Heart pillar** falls too (HRV down, resting HR up). These are two
different facts — *you did too much* and *it cost you* — so this is not double counting. If the
body coped, Heart doesn't fall, and only the Activity unit records the excess.

## Dynamic tuning — assume first, ask only when the data can't explain it

1. **Defaults.** Every unit starts from its research band in `component-references.md`.
2. **Personalise.** Bands and normals are refit monthly from the person's own 30-day history, shadow
   scored for a week before they replace the live values, step-limited per refit (the #2341
   pattern).
3. **Ask only on an unexplained outlier.** When a unit lands outside the person's range and nothing
   in the data explains it, the app asks one question — *"You slept 10 h 40 m, far above your usual.
   Were you unwell?"* — and the answer becomes a label that sharpens the next refit. No forced
   check-ins (owner, 2026-10-05).
4. **Every live parameter set is stamped** with a model version, so a correlation never pools days
   scored by different models.

## Order of work

1. Owner yes on the mockups, the curve (70 at normal, 100 at +1.5σ) and 30 days as the scoring window.
2. Tuning proposal: unit weights and pillar weights, with days moved.
3. Engine batch: units → pillars → readiness, behind a shadow score first.
4. Surface batch: the hub, detail screens and edge states from the mockup.
