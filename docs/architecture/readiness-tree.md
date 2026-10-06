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

| Pillar | Unit | Shape | Notes |
|---|---|---|---|
| **Sleep** | duration | sweet spot | default 7–9 h, refit per person |
| | efficiency | directional ↑ | |
| | deep + REM share | sweet spot vs normal | |
| | latency | sweet spot | falling asleep instantly is a sign of debt, not health |
| | timing / consistency | steady | vs the person's usual bed and wake times |
| | sleep balance (7-day debt) | sweet spot | |
| **Heart** | overnight HRV | directional ↑ | |
| | overnight resting HR | directional ↓ | |
| | overnight settling (recovery index) | directional | |
| | daytime resting HR, still periods | directional ↓ | **new** |
| | HR recovery after exercise | directional ↑ | **new** — the density gate in #2234 first |
| **Activity** | yesterday's movement | sweet spot | too much lowers it — see below |
| | zone minutes (week) | sweet spot | WHO 150–300 moderate-equivalent; vigorous line per #2198 |
| | training load 7:28 | sweet spot | 0.8–1.3 = 100 (#2194) |
| | block trend 28:90 | sweet spot | #2340 |
| **Body** | temperature | steady | 100 at normal — fixes #2359 |
| | breathing rate | steady | |
| | SpO₂ | threshold | fine above ~95 %, falls below |
| | weight vs plan | steady | against the goal pace (#2071: recomp 0.3 % BW/week) |
| | energy balance | sweet spot | near the #2071 budget; a large deficit or surplus both fall |
| | protein, hydration | reach target | |
| | daytime stress | directional ↓ | elevated HR while still — counted here only, not again in Heart |

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
