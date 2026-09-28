# 2026-09-28 — `Full` still would not take, and the reason was nine missing progression styles

**Agent:** BugFix intake. **Docs only** — no product code.

## What the owner reported

*"I still cant change this to full?"* — on the Pull pre-workout screen for Tuesday 29 September,
with the AI Prescription card reading *"Full is on, but these weights are unchanged."* The same
screenshot carried a `⚠ Style not found` on Face Pull.

## What it actually was — two separate things

**① The BF-198 fix is live and does not reach a prescription already stored.** Production is on
`1.481.1`; the fix (`d4466c55`) merged at 07:17 +10:00 the same morning and is in the deployed
tree. His Pull prescription was generated **2026-09-23T09:54:51Z** and does not expire until
**2026-09-30T09:54:51Z**, so it outlives the session he was about to train. It is the only stored
whole-session deload: 5 of 5 deloaded, 0 with `preDeload`.

There is a one-tap workaround, which BF-198 did not record because nobody had traced the refit
path: changing the duration preset **cannot** be served from the stored plan on a whole-session
deload — `refitPrescriptionToBudget` needs a baseline, whole-session deloads carry none, so it
returns `no_baseline` and the route falls through to full generation
(`prescribe/route.ts:95`, `refit-prescription.ts:57`). On the fixed code that rebuild writes
`preDeload`.

**② Nine exercises in his live program have no progression style — filed as BF-217.** Promoted out
of BF-200's Keep ①, which recorded it as one exercise. The active program `Bankai` carries **9 of
25 with `style_id` NULL**; every other program carries zero except the dead `Main`. **`Lower` has
lost all five.** The losses date to 09-09, 09-10, 09-12 (×4) and 09-13 from the last
`exercise_logs` row that still carried a style — four instalments, not one event, which is what
points at a save path.

The knock-on is what makes this more than cosmetic: BF-198's fix draws its revert numbers from
`buildRulesPrescription`, which **skips** a style-less exercise and **returns null when every
exercise is one** (`generate-prescription.ts:169`, `:177`). So Pull revives 4 of 5 on
regeneration and **`Lower` revives nothing** — its `Full` toggle is dead on the fixed code for the
same reason it was dead on the broken one.

## A measurement trap worth keeping

`session_exercises.updated_at` reads `2026-09-28T05:17:31.544Z` on **all 25 rows, to the
millisecond**. A program save rewrites every session-exercise row, so the column dates the last
save and never the loss. Anyone bisecting this from the table will conclude it happened today.

## Shipped

- **BF-217** filed at the top of Lane A READY.
- **BF-198** Keep gains ③: the stored-prescription residue, its expiry date, the preset-switch
  workaround, and the two style-less consequences.
- **BF-200** Keep ① widened from one exercise to the 9-of-25 measurement with the dating table.

## Not exercised

No device run and no code change. The workaround is derived from the route and refit source, not
observed on the phone — the owner tapping a duration preset on Pull is what would confirm it.

---

## Follow-up the same morning: `Quick` returned one exercise

The workaround worked — he re-tapped the duration, `Full` took, and Pull came back as
`Accumulation · Accepted`. He then reported that **`Quick · 30 min` gives a single exercise**
(Barbell Chest Supported Row, `~21 min of work`).

**Filed as BF-218.** Dropping whole exercises on a short preset is deliberate and well-argued
(`budget-stage.ts:126`) — five exercises floored at two sets genuinely do overrun 30 minutes. The
defect is that `dropToBudget` has **no floor but one** (`while (kept.length > 1 …)`) and re-fits
survivors from their **original** set counts, so the loop can prefer one exercise at full sets over
three at two, because it only asks whether the result fits.

**The reconstruction is exact, which is what makes the rest trustworthy.** Feeding his stored plan
(5 exercises × 2 sets, rest 180/127/90/90/90) through `estimateSessionDurationSec` at his measured
**319 s** transition reproduces the card's **53 min** to the tenth (53.1). Against the 24-minute
`Quick` working budget: **2 exercises fit as shipped, 3 corrected for BF-197.**

He got one, not two — so the survivor carried more than two sets. **That link is inferred, not
read:** the `Quick` prescription was overwritten by his `Normal` regeneration at 21:26:19Z. One
re-tap and one query settles it.

This is also the sharpest evidence yet for **LA-178**, the open owner question on whether to fix the
duration double-count — added there. His LA-65 answer ("five at two sets fill the hour") was about
the 60-minute case, where the over-protection is invisible. At 30 minutes it costs him the session.
