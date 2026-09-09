## 2026-09-09 — `food-row-shared.spec.ts` walked past the source tabs #1038 added (Lane B)

**What broke.** `#1038` (BF-51 ③) put the ingredient picker's two sources behind tabs, opening on
`Your foods`. `e2e/food-row-shared.spec.ts` searches that picker and asserts on the **external**
food-database row — which is now a tab away rather than below the local results — so it failed on
`main` from the moment #1038 landed. Reproduced on clean `main` before changing anything.

**Mine, and a missed sweep.** The standing sibling-surface rule says a pattern change on one surface
is followed through every surface handling the same domain in the same PR. #1038 shipped the tabs
and its own new spec and did not check what else already walked that picker. Three specs do; only
this one asserted on a row the tab change moved.

**The fix.** The spec taps `Food database` before looking for the external row, scoped to the
picker's own `tablist` — the sheet hosting it has a `My Foods` tab of its own, so an unscoped
`getByRole('tab')` would be ambiguous. Test-only: the tabbed behaviour is what BF-51 ③ asked for and
is unchanged.

**Verification.** Failed on clean `main` at `e7f6a576ed`, passes with the change (4 passed). The two
sibling specs that also drive the picker — `recipe-image-to-meal` and `single-foods-database-search`
— plus #1038's own `ingredient-source-tabs` were run together and are green (8 passed), which is the
sweep that should have run in #1038.

**Not exercised.** Test-only, no app code — nothing reaches the device and no APK is involved.
