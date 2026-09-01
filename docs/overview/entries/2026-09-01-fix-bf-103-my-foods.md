# 2026-09-01 — BF-103: one label, `My Foods`, on every surface

**Branch:** `fix/bf-103-my-foods-one-label` · **Domain:** `nutrition` · **Lane:** B · **Version:** v1.425.0

Owner: *"can we change Meals to → My foods, so we can have meals + singular items saved."* Then,
deciding it the same day: *"no I'm happy to rename Saved to → My Foods. the issue was having saved +
MyFoods. we only need one. lets go with MyFoods."*

## Why the owner's version is better than the entry's

The entry originally proposed `Saved` for the tab with `My Meals` left on the page button — a
*second* name, which is the thing that caused the trouble in the first place. **The historical
failure was never the wording; it was two labels for one list.** One name cannot be confused with
itself.

It also describes the contents more honestly: of the owner's 10 saved meals, **5 contain exactly one
item**, saved as one-item meals because that was the only shelf available. The label had been
mis-describing the list.

## The sweep, and the two comments that would have undone it

Eight files carry the user-visible strings — tab, page button, toast (both arms), picker hint and
empty state, two plan buttons, and a badge, an action and an **`aria-label`** on the plan row. A
rename that skips the aria-label leaves a screen reader saying a name the screen no longer uses.

**BF-37 and BF-60 both removed `My Foods`**, and their comments read as a standing prohibition:

- `nutrition-action-row.tsx` — *"`My Meals`, not `My Foods` (BF-37)."*
- `saved-meals-sheet.tsx` — *"`My Foods` against `My Meals` is the pair the owner could not tell
  apart."*

Both were solving *two labels differing only in their last word*. Unifying satisfies that reasoning
rather than contradicting it — but left as they were, the next session reverts this on their
authority. Both rewritten in the same PR, saying so.

## The guard found four surfaces the entry did not enumerate

`components/nutrition/__tests__/one-saved-list-label.test.ts` fails on any user-visible `My Meals`,
reading comment-stripped source so the two history-quoting comments do not trip it.

**It immediately caught what the entry's own file table missed: `e2e/` specs clicking a button named
`My Meals`.** Not four — **twelve files**, including aria-label lookups, an `In My Meals` assertion
and a `Save all N to My Meals` regex. A rename that leaves its tests asserting the old label breaks
CI on the next run rather than at review. All swept.

**Four mutations, four failures:** reverting the page button, reverting the tab label, missing *only*
the aria-label, and re-merging the tab strip.

That last one guards a different mistake. **`My Foods` was once the name of a merged list** (v1.382.0),
split back three versions later because a recipe and a single ingredient in one list made "log this"
mean two different things. **That revert was about the merge, not the name.** An implementer who reads
"My Foods" and re-merges the tabs reintroduces a defect the app already paid for, so the guard pins
the strip at `Recent · My Foods · Search`.

## Verified on `pnpm dev`

The Nutrition page button reads `My Foods`; the sheet it opens shows `Recent · My Foods · Search`;
neither the page nor the sheet contains the string `My Meals` anywhere.

## Not exercised

- **The S25.** A label change is low-risk, but `My Foods` is two characters longer than `Meals` in
  the tab strip, and three tabs share that width. Whether it wraps or truncates at 412 dp is unchecked.
- The changelog's historical entries still say `My Meals`. Left alone deliberately — they describe
  what shipped at the time, and rewriting them would make the record wrong.
