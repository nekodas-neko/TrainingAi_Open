# 2026-08-19 — Q-416: the label's block is centred, and the calorie figure sits on the axis

**Branch:** `fix/label-vertical-centring` · **Lane B** · v1.332.1

The owner, comparing a printed label to the mockup they approved: *"that looks different to what we
decided on — our one looked much better more gap between the text etc."* Two separate geometry bugs
under one complaint, both in `components/nutrition/meal-label-render.ts`.

## The vertical half

The centred layout pinned its two ends to **opposite margins**: the header flowed down from the top
margin, the code was anchored up from the bottom. Whatever the ingredient list did not use became a
void immediately above the code — the two anchors never met in the middle.

For the shipped default, with the header ending at 69.5 units and the code starting at 110:

| ingredient lines | slack | void at 50 mm |
|---|---|---|
| 1 | 32.5 | **8.6 mm** |
| 2 | 24.5 | **6.5 mm** |
| 4 (the budget) | 8.5 | 2.2 mm |

The owner's `Protein Shake` prints two lines, so it carried **6.5 mm of nothing** — about an eighth
of the label. **A four-ingredient meal looked fine and a one-ingredient meal looked broken**, which
is exactly why it survived review: the mockups were drawn with fuller lists.

The fix is one offset — half the slack — applied to the header, rule and ingredient block. Every gap
the style specifies is preserved exactly; only the leftover is shared. **`codeTop` does not move**,
so a batch of labels still puts every code in the same place, which was the reason the code was
bottom-anchored to begin with.

That required turning the painter into **measure-then-paint**: the block cannot centre itself until
it knows its own finished height, and that height depends on how many lines the ingredient run wraps
to. The wrap is now resolved once, before the draw pass, and reused — the top-anchored composition
existed because it was computed mid-draw.

`centredStackOffset()` is exported and pure, so the arithmetic is unit-tested rather than left inside
a canvas call nothing in this repo can execute.

## The horizontal half

*"Id rather it look more like that with the number for calories centered with small text KCAL next
to it."* One expression:

```js
const startX = cx - (numW + 3 + unitW) / 2
```

That centres **number + gap + unit as one run**, so the numeral's own midpoint sits left of the axis
by `(3 + unitW) / 2` — roughly **3 mm** on a 50 mm label. Every other element is symmetric about
`cx`, which is what makes it read as misaligned rather than merely offset.

The numeral is now centred and `KCAL` overhangs to the right. **The trade is deliberate and worth
stating:** the composition is no longer symmetric about the axis. That is the right call for a figure
whose whole job is to be read at a glance, and it is what the approved prototype did. A bound guards
the overhang — if a wide figure would push `KCAL` past the right margin, it falls back to the
run-centred form rather than clipping.

`band` uses a different, left-aligned calorie path and is untouched.

## Verification

- 22 tests across the label files, including six on the new offset, **mutation-checked in both
  directions**: returning `0` (the old behaviour) fails three of them, and shifting by the *full*
  slack instead of half fails two.
- One test asserts every style clears its code at every line count from 0 to its budget, so the
  shift cannot push a block into the code on a style nobody printed.
- `e2e/meal-label.spec.ts` — which decodes the QR off the rendered canvas at every style — **passed
  three consecutive runs**, 5 of 5 each.
- 4,264 unit tests · 49 of 49 custom rules · `tsc` clean · lint 0 errors.

**Not verified:**
- **No physical print.** This is a change to how the artwork *looks*, and the complaint that started
  it came from a printed label, so the print is the real acceptance test. It is owner-owed.
- **One E2E run failed before the three clean ones** and its detail could not be recovered. It was
  the first run against a cold `.next` immediately after a container restart, which has produced
  spurious failures earlier in this session — but that is an explanation, not evidence, and it is
  recorded here as unexplained rather than dismissed.
- No device run: JS-only, reaches the APK on the next Railway deploy with no rebuild.
