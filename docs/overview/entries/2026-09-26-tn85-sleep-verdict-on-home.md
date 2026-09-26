# The sleep verdict now has a home that lasts the day

Implementation Lane B, 2026-09-26. `TN-85`, and deliberately not `TN-82`.

## What shipped

Under the Home Sleep card, `components/home/sleep-verdict-note.tsx` states last night's verdict:

- **Ordinary night, quietly:** *Sleep looks normal — filled in for you.*
- **Outlier night, prominently, numbers first:** *Slept 5h10, 65 min later than usual. Marked this
  a poor night.*
- **A `That's wrong` control** in both cases, which records the disagreement against
  `POST /api/sleep-verdict` and opens the morning check-in, where the value a correction sets
  actually lives (TN-57 owns writing it).
- **Nothing at all** when there is no verdict — the baseline is still filling, or the ring has not
  drained the night. A card that says "not enough data" every morning is a card that gets tuned
  out, and this one must not be.

The wording lives in `components/health/sleep/sleep-verdict-copy.ts` rather than in the component,
so `TN-82`'s modal reuses it instead of growing a second wording that then drifts.

## Why Home, when the design said modal

`TN-85` is a constraint on `TN-82`, not a polish item. The morning sheet auto-opens once a day from
an effect on `/session-select`, `markMorningCheckinPromptDone` retires it on close, and dismissing
it is indistinguishable from reading it. The owner has saved **82** of those sheets in three months
and touched a scale in **3** of them.

The whole instrument is him **disagreeing** with a verdict. Deliver the announcement once, into the
one surface with a three-month record of reflexive dismissal, and the silence that comes back
cannot be told from agreement — which is exactly the failure `OR-171`'s guard then has to
interpret. So the verdict also lives somewhere that lasts the day and stays correctable.

## Two wording deviations, both filed for the owner on TN-84

**`— tap if that's wrong` is a separate button, not a phrase in the sentence.** A phrase in a
paragraph is not a tap target on a touch-only product, and the Sleep card is already a
`role="button"` that navigates — so the affordance has to be a real control outside it, or it is a
button inside a button, which is both invalid and what `check-nested-buttons.js` fails on.

**"90 min later than usual" cannot be said from a stored verdict.** `sleep_verdicts` snapshots the
band's `low`/`high` and drops `ComponentBand.median`, so there is no middle to measure from without
re-deriving one the verdict never saw. The line measures to the **edge** of the band instead: "65
min later than usual" means 65 minutes past the late end of the usual range. It is the smallest
true claim, and it is the one the verdict actually acted on. Saying it against a median would need
TN-81 to snapshot the median — Lane A, and a migration.

## A length rule the render forced

Two full clauses ran to **three lines** at 412 px, and a three-line announcement is precisely the
failure mode this design exists to avoid. So the first fact carries the night's own number and any
follow-on carries only the distance — which lands on TN-84's own draft shape, *"Slept 5h10, 65 min
later than usual."* Efficiency is the one exception and keeps its percentage, because "6 points
below your usual" on its own names no quantity a reader can place.

## What is deliberately not done

**`TN-82` is untouched, and it is now the modal half only.** Its removal of the two scales from the
morning sheet is an information-architecture change to a screen the owner uses daily, so per
CLAUDE.md it owes a mockup and a yes before any code is written. This entry removed nothing and
added a surface, which is why it could ship first.

## Failure surfaces not exercised

The S25. The note is new furniture on the owner's daily screen and no sandbox drives a Samsung
WebView; the device pass rides with `TN-82`'s, as that entry already states.

## Verification run here

`pnpm lint` 0 errors / 828 warnings (unchanged against the base) · `pnpm check:rules` Ran 80 of 80 ·
`pnpm test` · `pnpm build` · `tsc --noEmit` · `check-test-typecheck` none above baseline ·
14 unit tests on the copy and `e2e/tn85-sleep-verdict-on-home.spec.ts` 3 passed, which is also the
dev-server pass. Rendered at 412 px dark and looked at. Control run: replacing the correction
callback with a no-op fails the wiring test.
