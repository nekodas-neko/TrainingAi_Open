# The readiness tree — from the score down to its smallest units

**Status:** agreed direction (owner, 2026-10-06), not yet built. Tracking issue: #2356. Mockups:
`docs/design/2026-10-06-readiness-hub.html`; scoring test cases and baseline windows:
`docs/design/2026-10-06-readiness-scoring-cases.html`.

Read with [`adaptive-scoring.md`](adaptive-scoring.md) (how bands and normals are learned per
person) and [`component-references.md`](component-references.md) (the research default for each
unit). Today's shipped model is described in [`scoring-structure.md`](scoring-structure.md).

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
the research default and is refit to the person. A unit at the person's normal scores **70**; 100
is reached at +1.5σ (the curve in the scoring-cases page). Low-wear nights and nap fragments are
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
