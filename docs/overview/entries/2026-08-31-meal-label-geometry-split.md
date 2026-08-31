# 2026-08-31 — the meal label's geometry splits from its painters, and the flake starts reporting itself

**Branch:** `refactor/meal-label-geometry-split` · **Entries:** LB-33, LB-38 · **Lane:** B

## LB-33 — the split

`meal-label-render.ts` had reached 1,049 lines. `scripts/check-component-size.js` never flagged it
because the file is `.ts` rather than `.tsx`, so the ~800-line guidance applied by spirit and not by
CI.

**The boundary is not about size.** Everything moved to `meal-label-geometry.ts` (445 lines) is pure
arithmetic over a style and a byte count; everything left in `meal-label-render.ts` (626) needs a
`CanvasRenderingContext2D`. Both vitest projects run `environment: 'node'`, so the geometry half is
the only half that can be asserted at all — every existing test imports from it and none of them can
reach a painter. The split makes that boundary structural instead of conventional.

**Which symbols cross it was determined by the compiler, not by reading.** Cut the file, let `tsc`
name every unresolved reference, export exactly those (`SHEET`, `SQUARE_MARGIN`, `SQUARE_W`,
`USABLE_W`, `USABLE_H`, `STACK_LINE_H`, `DEFAULT_RENDER_SCALE`, `SPECS`, `StyleSpec`), then let
ESLint's unused-import warnings prune what each half no longer needs. A mechanical move verified
mechanically.

**The three importers were repointed rather than given a re-export shim.** A shim would leave the
old path meaning both things, which is the arrangement the split exists to end. Both test files
import only geometry and moved wholesale; `meal-label-sheet.tsx` takes the painter from one and the
geometry from the other.

**Verification:** `meal-label-code-size.test.ts` and `meal-label-centring.test.ts` pass **unchanged**
— the entry's own bar — along with all 153 tests in `components/nutrition/__tests__`. And
`e2e/meal-label.spec.ts`'s *"a saved meal renders a printable label in every style"* passes, which is
the assertion that proves a pure move across all seven styles. `pnpm check:rules` **Ran 65 of 65**.
No behaviour change, so no version bump and no changelog entry.

## LB-38 — one hypothesis eliminated, and the failure now diagnoses itself

The share-code decode in `e2e/meal-label.spec.ts` fails intermittently on `main`. Two guesses were
made and **both are now falsified**, which is the useful part.

**First guess: `waitForSettledInk`'s `> 0.01` floor lets a text-only canvas through.** Refuted by
reading the render path — `renderMealLabel` is fully synchronous (`QRCode.create` is a sync call and
`drawShareLabel` calls `drawCode` immediately after `fillText`), so text and code land in the same
pass and a text-only canvas cannot exist.

**Second guess: `getImageData` returns a degenerate buffer under pressure,** making the ink fraction
0 or 1 so the gate passes on a canvas that was never drawn. Refuted by measurement: a captured
failure reads **ink = 0.1735**, inside the normal 0.172–0.179 band. **The canvas is drawn correctly
and the pixels arrive intact.** Capture is eliminated; the fault is in the decode.

**The instrumentation ships, and that is the change.** The assertion message now carries the ink at
the last attempt, so the next failure — in CI or anywhere — arrives with its own evidence instead of
needing to be reproduced first. That is what converted this from two guesses into one eliminated
cause, and it costs nothing on the happy path.

**Also established:** it passes **every** time in isolation and fails roughly one run in two when the
whole file runs. Measured across eleven runs. So the reproduction is "run the file", not "run the
test" — which is why several earlier attempts to catch it looked like it had gone away.

**Two process notes, both of which cost time here.** Piping a run through `grep` without
`--line-buffered` leaves the watched output file empty for the entire run, making a slow run
indistinguishable from a hung one — I read twenty minutes of silence as a possible reproduction when
in fact no process was running at all. And a hypothesis that fits one measurement is not a diagnosis:
both guesses above were plausible, and each took under two minutes to falsify once tested rather
than reasoned about.
