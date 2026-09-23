# 2026-09-23 — home-ia-merge, part 1: the APK banner and the picker's duplicate question

**Branch:** `fix/home-ia-merge-part1` · **Lane B** · v1.465.22

## What shipped

**RV-116 — the widget picker offered two entries for one question.** `nutritionDonut` and
`energyBalanceWidget` both read `energy-balance:${today}` through the same hook, and the pair has
already shipped two budgets 271–274 kcal apart, both labelled "left" (Q-401/Q-415). The picker now
says under its heading that Energy Balance is an **alternative** to Nutrition, not an addition, and
the Energy Balance chip dims while Nutrition is on and it is off.

Dimmed, never disabled: it is a real choice, just not one to make *on top of* Nutrition. Disabling
would hide the alternative rather than rank it.

**Deviation from the entry's letter.** It said "relabel the picker entry". The chips sit in a
wrapping row built for 384 px and a label long enough to carry "alternative to Nutrition" wraps that
row, so the sentence went under the heading where it has room to say the whole thing. Same intent,
better fit; reversal is moving one `<p>`.

**RV-119, first half — the APK banner is gone**, along with its `apkBannerDismissed` state, its
`apk-banner-dismissed` key, and the `Download` and `X` imports it was the last user of. No design
judgement was involved: the canonical runtime *is* the APK, and the same download row already sits
at More → About.

## Why the rest of RV-119 did NOT ship

The entry says *"Owner gate SATISFIED 2026-09-22 — mockup shown at 384 px dark … Build to it; a
departure from it needs a fresh yes."*

**The mockup was not preserved.** Nothing in `docs/design/` from that date; the sweep write-up
describes the problems, not the approved layouts. So "build to it" cannot be followed — an
implementer either invents a collapse layout, which is the precise departure the gate exists to
prevent, or re-asks the owner something he already answered.

The banner split itself is written down and unambiguous (illness advisory and early deload stay
full-width; exercise-detected, goals check-in, day-review and weekly recap collapse). What is missing
is what a "collapsed strip" LOOKS like, which is exactly what a mockup carries and prose does not.

Filed as **LB-135**: an owner gate recorded as satisfied without preserving the artefact is not
actionable, and the same wall is waiting in RV-117 and RV-118, which carry the identical line.

## Verification

- Full suite **811 files / 8231 tests / 0 failed** (exit 0) · `pnpm build` clean · `tsc --noEmit`
  clean · `pnpm check:rules` **Ran 77 of 77** · lint clean on both changed files (the `X` import
  warning my own deletion created is fixed, not baselined).

## Not exercised

Device. Both changes are visual — a removed banner and a dimmed chip — and the sandbox can only
prove the code paths changed. Also not exercised: native SQLite, safe-area, Samsung WebView.
