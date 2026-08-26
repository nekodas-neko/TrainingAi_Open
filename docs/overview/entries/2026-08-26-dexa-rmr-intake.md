# 2026-08-26 — the DEXA filter gets a date, and the RMR half splits off

**Branch:** `feat/dexa-rmr-intake` · docs-only · BugFix Intake

## What changed

The owner has a **DEXA + RMR test booked** and asked how far away the feature is. Two things follow
from that.

**BF-2's priority signal is void.** It sat at the tail of the queue because the owner filed it on
2026-08-23 as *"a loose note to put more effort into later when we have a chance"*. A booked
appointment is not that. It still needs a planning session — the calibration maths are genuinely
undecided — but the plan should now be written **before the scan**, so the reading has somewhere to
land on the day rather than sitting in a screenshot for a month.

**The RMR half is now BF-33**, in the main queue. BF-2 itself said this half *"is simpler … it needs
no calibration maths at all, just a stored value and a precedence rule"*, and unlike the filter it
does not need the scan to exist before it can be built.

## The correction the panel design needed

The owner asked for three RMR values plus an energy figure. Three of those four are not all RMR, and
building it as asked would have produced a number the app cannot honestly compute.

**Energy balance can only ever see total expenditure** — what went in, against what the body weighed.
The learned number is a **TDEE**. Turning it into an RMR means dividing by an activity factor, which
is precisely the guess the measurement was meant to remove.

So the honest panel is a 2×2:

| | Predicted | Measured / learned |
|---|---|---|
| **RMR** | Cunningham `ffm·21.6+370` — exists | the scan — **the only missing cell** |
| **TDEE** | RMR × activity multiplier — exists | `adaptive-tdee.ts` — exists and shipped |

**The owner's own test sheet already draws exactly this 2×2** — Measured RMR beside Predicted RMR,
Projected TDEE beside Predicted TDEE. Three of its four cells are computed in this app today.

**And the prize is a fifth number neither input gives alone:** with a measured RMR *and* the learned
TDEE, the real activity factor falls out as `learned TDEE ÷ measured RMR`. The test sheet guesses
`Mild` in two places and multiplies by it. The app would know.

## What already exists, so the plan does not rebuild it

The owner's description of the third value — *"checks when you completed a diary entry so it knows you
logged a full meal; then checks the weight the next day"* — **is `adaptive-tdee.ts`, already built and
already hard-gated**: `MIN_LOGGED_DAYS`, `MIN_LOGGED_FRACTION`, `MIN_WEIGH_INS`, a plausibility clamp,
and Q-387's completed-day gate, which exists because an abandoned half-log is byte-identical to a
light day and was measured pulling the estimate 514 kcal low.

## Two refinements that change the filter's shape

1. **It must accumulate.** *"This value needs to be able to accept more … so it can work together to
   build a correct filter."* The stored thing is a **set of paired (scan, scale) observations** with
   the calibration derived from them, not one constant a second scan overwrites. This also settles
   BF-2's open ratio-vs-offset question in the only honest way: with one data point the two are
   indistinguishable, so store the pairs and pick the form when there are two.
2. **It is per measurement system.** *"whatever measurement system was used"* — the bias belongs to
   the Renpho BIA path. Applying its correction to a different instrument would be worse than
   applying none.

## What is not decided

BF-2 stays a planning item. Whether the filter corrects body fat alone or re-derives the whole panel
(muscle mass, bone mass, water, visceral fat all come out of the same `computeBodyComposition()` call)
is exactly the kind of question a plan exists to answer, and it was already flagged as a trap in the
entry.
