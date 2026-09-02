# 2026-09-02 — LB-38: the failing symbol is structurally perfect, and the suspect is a render race

**Lane B · branch `docs/lb-38-dump-analysis` · no version bump · docs only**

Earlier today LB-38 got its first captured dump and I destroyed it with my own cleanup loop before
thinking to render it. This is the second capture, preserved, rendered, and measured — and it moves
the entry a long way.

## What was caught

Run 3 of a batch, `Ingredients · centred`, and this time the summary printed `1 failed  2 passed`
outright — confirming the earlier count-based reading that a run reporting 2 where the file normally
reports 3 has failed. Copied out of `test-results/` immediately, per the instruction I wrote after
losing the first one.

## The symbol is not defective in any way I can measure

Rendered to a PNG and **looked at**: a clean, complete QR with a clear quiet zone, no overlap with the
text above it, nothing torn.

| property | value |
|---|---|
| symbol box | 325 × 325 px |
| modules | 25 × 25 (version 2) |
| module pitch | **exactly 13 px**, every run-length an exact multiple |
| timing patterns | `1111111 010101010 1111111` on **both** axes |
| alignment pattern (18,18) | textbook 5×5 |
| format info | **byte-identical to a passing symbol's**, both copies agreeing |
| ink | 0.0798 against 0.0800 passing — normal |

And cropping to the symbol alone plus a 4-module quiet zone still decodes to **null under all four**
binarizer × `TRY_HARDER` combinations, which eliminates the detector being confused by the surrounding
text.

**So the fault is in the data/ECC codewords of an otherwise perfectly drawn symbol.** Every structural
and decode-path explanation is now gone.

## The suspect, with a named mechanism

`meal-label-sheet.tsx`'s render effect sets `cancelled = true` in its cleanup — but that flag guards
only `setMetrics` and the toast. **It does not stop the in-flight `renderMealLabel`.** That function
suspends mid-render at `await document.fonts.ready` while holding the canvas, and on resuming does
`canvas.width = px` — **which clears it** — then redraws. The every-style test changes `style` four
times in a row.

So a resumed render can clear and redraw the canvas underneath the one the test is about to sample.
And the styles do not draw the same symbol: `mealLabelCarriesRecipe` picks between the full recipe
payload and the 22-character bookmark, so two interleaved renders encode **different data**.

That fits every measurement — perfectly formed geometry from one complete draw, codewords belonging to
something else. It is a hypothesis with a mechanism, not a finding. Proving it wants an instrumented
run logging render start/finish against each sample.

## Two diagnostics of mine that support nothing

Recorded because both look convincing and are worthless:

- **Diffing the failing matrix against a passing one** gave 134 of 625 modules different. Meaningless:
  each run creates its own meal, so the tokens differ and the symbols *should* differ. Badly designed
  comparison.
- **A hand-rolled BCH(15,5) check** reported `bchOk=false` for a symbol that demonstrably decodes, so
  the implementation is wrong. Only the **equality** of the two format words is trustworthy, and that
  is what the entry now claims.

This is the second time in one day on this entry that a confident reading of a single number turned out
to be wrong — the first was comparing one style's ink against another style's band. Both were caught by
taking one more measurement rather than by thinking harder about the first.

## What shipped

Docs only. LB-38 carries the capture, the measurements, the crop result, the failing 25×25 matrix as
text (the 1.4 MB `.bin` is not committed and the scratchpad is ephemeral), the suspect with its
mechanism, and both dead diagnostics.

**No fix.** The mechanism is not proven, and this entry's own standing warning is that the wrong fix
here masks the flake rather than curing it — which is exactly why the canvas-settling gate written this
morning was reverted unshipped.

**Not exercised:** nothing was changed, so there is nothing to verify beyond `pnpm check:rules`
**Ran 67 of 67**. The device is untouched.
