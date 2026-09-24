# RV-111 — the scanner had no back entry of its own, so back threw away the whole flow

**Branch:** `fix/rv111-scanner-back-dismiss` · **Entry:** RV-111 (shipped, device re-check owed) · **Version:** unchanged

## The defect

Log Food → Barcode, then one hardware back, and **no dialog is left** — the scanner and the Log Food
sheet both gone, the capture flow discarded. Confirmed on the S25 in sweep 2, with
`body.scanner-active` set and the app's own window holding focus, so the JS listener really did run.

The scanner **replaces the sheet's body** rather than opening a surface of its own, and neither host
registered a back-stack entry. `SheetContent` renders `BackDismiss` once, so the listener saw exactly
one open surface — the sheet — and popped that.

## Fix

`useSheetBackDismiss(showBarcode, …)` in `capture-actions.tsx` and `useSheetBackDismiss(scanning, …)`
in `ingredient-picker.tsx`. Two lines, exactly what the entry specified.

**Nothing in the stack needed changing, and I checked rather than assumed**, because the entry flags
an ordering risk that is not cosmetic: the scanner injects a global
`body.scanner-active > *:not([data-scanner-overlay]) { visibility: hidden }` and only removes it on
unmount, so a press that closed both surfaces at once would leave the app blank.

It cannot. `handlePop` closes every surface whose `depth > arrivedDepth`, and popping the scanner's
entry (depth 2) lands on the sheet's (depth 1), so `arrivedDepth` is 1 and only the scanner closes.
`sheet-back-stack.test.ts`'s LB-17 case already proves the general property — three layers unwind one
press at a time — which is why this change re-tests the **call sites** rather than the logic.

## Verification

- Three new tests: both hosts register the surface; the hook sits **before** the early return that
  swaps the body (a hook after it would run conditionally, which React forbids and which would also
  miss the exact frame the surface is needed); and neither file hand-rolls `popstate`/`pushState`,
  which is how BF-34's sibling bug happened.
- **Control-run against `origin/main`: two of the three go red.** The third — the no-hand-rolling
  guard — passes on `main` too, and that is correct: it guards a future wrong approach rather than
  this change. Worth stating rather than letting "three tests" imply otherwise.
- `components/nutrition/__tests__` + `components/__tests__` + `lib/hooks/__tests__`: 60 files,
  **462 tests** green. `pnpm check:rules` **Ran 77 of 77** · `tsc --noEmit` clean · lint clean.

**Not exercised:** the scanner itself. It wants a camera, so the sandbox cannot drive it at all —
there is no browser-level check of this fix, only the stack logic it relies on and the source
assertions. The entry keeps a `Keep:` under `Lane: DV` for the S25 re-check: one back returns to the
Log Food sheet with the scanner gone and nothing hidden, a second closes the sheet. Samsung WebView
rendering, safe-area and drifted production data untested.
