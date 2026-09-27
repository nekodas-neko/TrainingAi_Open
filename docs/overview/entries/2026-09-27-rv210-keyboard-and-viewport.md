# The keyboard can resize what it covers — and nothing in the sandbox can prove it

Implementation Lane B, 2026-09-27. `RV-210`, all three items.

## What shipped

1. **`interactiveWidget: "resizes-content"`** in `app/layout.tsx`'s viewport export. This is the
   load-bearing one and the other two do nothing without it: Android's default is
   `resizes-visual`, which draws the keyboard *over* a page that keeps its full height, so neither
   `dvh` nor `env(safe-area-inset-bottom)` moves at all. Confirmed in the **built** HTML —
   `interactive-widget=resizes-content` in the viewport meta — rather than only in the source.
2. **All 23 `vh` heights → `dvh`**, across 22 files.
3. **`enterKeyHint="done"` on all 42 `type="number"` inputs**, across 28 files.

## What the entry got wrong, and the part worth keeping

It said "about 30 sheets". It was **23 across 22 files** — and **22 other sheets were already on
`dvh`**. A 22/23 split, recorded nowhere, so every new sheet was a coin toss between the two units.
That is the finding: not that some sheets were wrong, but that nothing said which was right. It is
why this shipped with a check rather than as a one-off sweep.

`enterKeyHint` was genuinely zero, as claimed. The entry named three files; the sweep took all 42
numeric inputs, because that is a tractable set (its "135 inputs" counts every input type) and a
partial fix here is indistinguishable from none.

**`done` everywhere, never `next`.** Every one of these forms is saved by an explicit button, so
Enter should dismiss the keyboard. `next` would promise a field-to-field traversal that the forms
do not define an order for.

## The guard holds both conditions, because either alone is a half-fix

`scripts/check-keyboard-viewport.js` (Custom Rules, now **81** steps) fails on a `vh` height *or* a
missing `interactiveWidget`. Control-run both ways: removing the viewport line fails it, putting one
`vh` back fails it. It blanks comments first — the two surviving `90vh`/`35vh` strings in the tree
are both prose explaining a height, and a check that flags its own explanation teaches people to
delete the explanation.

## None of this was verified behaviourally, and the sandbox cannot do it

A headless Chromium has no soft keyboard, so `interactive-widget` is inert there and `dvh` resolves
exactly as `vh`. Measured rather than assumed: a converted `max-h-[90dvh]` sheet computes
**823.5 px at a 915 px viewport** — 90% to the decimal. The conversion is a no-op in the harness
**by construction**. That is the correct outcome and it is not evidence the fix works. The
verification is RV-205's P26 on the S25, and it is owed.

## One interaction found while checking, not a defect

`components/ui/weight-dial.tsx` sizes itself from `window.innerHeight`, which `resizes-content`
makes shrink when a keyboard opens. It already listens for `resize` and re-snaps to an odd multiple
of its item height, and it is capped at 320 px, so it degrades rather than breaking. Worth a glance
during P26 rather than a pre-emptive change.

## Not exercised

Native/WebView keyboard behaviour, safe-area insets with a keyboard up, and the S25 itself — all of
which is the entire point of the change. A `projectOverview.md` Known-Issues row records that. No
APK is needed: this is viewport metadata and CSS units, delivered through a normal Railway deploy.
