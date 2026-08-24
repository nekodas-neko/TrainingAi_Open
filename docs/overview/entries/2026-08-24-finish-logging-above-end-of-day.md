# 2026-08-24 — the finished-logging control moves above End of Day (BF-6)

**PR:** `fix/finish-logging-above-end-of-day` · **Lane B**

## Why a layout preference was not one

The owner asked for the swap in those terms: *"id also like to move the finish logging button and
swap it with the end of day button. end of day should be at the very bottom. finish logging should be
right after the meals."*

The measurement behind it is what makes it a bug rather than a preference. `FoodLoggingComplete`
feeds Q-387's adaptive-TDEE calibration, and that calibration treats an unmarked day as **excluded**,
not as a light one — so an unpressed button does not degrade the estimate, it withholds it entirely.
**0 of 55 `day_checkins` rows carried `food_logging_completed_at`** across 2026-07-02 → 2026-08-24.
The feature had never taken a single input since it shipped seven weeks earlier.

## What shipped

One reorder in `app/nutrition/nutrition-content.tsx`: meal cards → **finished logging** → weekly
chart → supplements → **End of Day**.

## The comment that argued against it

Line 638 carried a note saying End of Day *"deliberately stays put"*. It was defending against
**merging the button into Home's "Your Day in Review" banner** — still Q-112's call, still not this
change — and never against moving it down its own screen. An implementer who read it and stopped
would have done the right thing with the wrong information, so it is rewritten in this diff rather
than deleted or ignored.

The comment on `FoodLoggingComplete` needed the same treatment, and it was one I wrote in #330: it
argued the control belongs last because *"I have finished logging" is a claim about the whole day*.
That reasoning is sound about the sentence and was overtaken by seven weeks of evidence about the
control. It now records both.

## Verification

`e2e/nutrition-tail-order.spec.ts` asserts by **vertical position**, not DOM index — what went wrong
was where the control sat on screen, and an ordering check on DOM index would pass against a page
that paints them anywhere. Two cases, because both the finished-logging card and Supplements are
today-only and the tail of the screen changes shape on a back-dated day, which is what the entry asks
for. The past date is read from Postgres in the user's timezone, never
`new Date().toISOString().slice(0, 10)` — that is the UTC date and it is yesterday in Brisbane until
10am.

**Mutation-checked: both tests fail against the pre-change order.**

**Not verified on device.** This is a scroll-order change on the screen the owner uses most, and the
sandbox is not the S25.
