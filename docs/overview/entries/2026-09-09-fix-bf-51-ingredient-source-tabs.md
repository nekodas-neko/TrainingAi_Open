## 2026-09-09 — The ingredient picker's two sources become tabs (BF-51 ③)

**Branch:** `fix/bf-51-ingredient-source-tabs` · **Lane B** · PR #1038

### What shipped

`Your foods` and `Food database` are a tab strip under the search field. The estimate and
recipe-import actions stay below, where they apply whichever list is showing.

The owner's report was that `Recently used` *"sits in the middle of the ingredient list"*, with
*"this should probably be a tab like the other place"*. It read as mid-list because it was: your own
foods, then the estimate/import action, then the food database — two lists with an action wedged
between them.

### Following the instruction literally would have caused a bug

"the other place" is Log Food, whose tabs are `Recent · My Foods · Search`. Copying those names onto
this screen would put **`My Foods`** on the ingredient picker — where it would mean single foods,
while one screen away the same label means **saved meals**.

That is precisely the confusion BF-103 removed, by owner decision, three days ago: *"we only need
one. lets go with MyFoods."* Rebuilding it while carrying out a request to copy that screen would
have been an easy and invisible regression.

So the two headings already on this screen were used instead. What is kept from Log Food is the
distinction its own note says the labels rest on — one side is what you already own, the other
reaches beyond it.

### Smaller calls

**A pasted recipe URL hides the strip.** That branch replaces both lists with an import offer, and a
tab bar choosing between two things that are not being shown is worse than no tab bar.

**The `Food database` tab says what it needs.** Its results only load at two characters, so opening
it on an empty query used to show nothing at all; it now says *"Type at least two letters to search
the food database."* rather than reading as broken.

**The "no results" line belongs to the tab you are on.** It used to require both lists to be empty,
which is not a sentence that means anything once they are not on screen together.

### What is still held on this entry

① (back from Edit exits the tab) and ② (the two photo controls) are unchanged and still deliberately
unshipped. ① was built, measured, and held because the fix destabilises
`e2e/meal-photo-picker.spec.ts` in a way that is not diagnosed — and `sheet-back-stack.ts`'s three
previous bugs were every one of them found on a device. That reproduction is still owed and is not
something this session could do.

### Verification

`e2e/ingredient-source-tabs.spec.ts` drives the real builder at 412 dp: both tabs render, the
database list is behind its own tab with its two-letter hint, and switching back hides it — so the
two lists are no longer stacked.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite green ·
the new e2e green.

**Not exercised:** the S25 and Samsung WebView. This is a layout change to a screen the owner is
actively iterating on — *"Lets get this into the right section and UI before we deep dive this
more"* — so whether the split reads right is a device judgement, and the reversal cost is one
component.

Patch bump — a layout change to an existing surface.
