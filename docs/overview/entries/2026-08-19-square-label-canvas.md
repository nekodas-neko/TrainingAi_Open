# 2026-08-19 — every label draws square, and the round constraint was costing 64% of the area (Q-411)

Lane B. v1.325.5. Canvas geometry only — no schema, no route, no APK.

## The owner's call

> *"could we just have this as a generic square? it will auto fit in the circle template when I need
> to print it - so they could all start as squares."*

## What the round assumption cost

The renderer reserved a centred **130 × 137** usable box — what survives a round crop once the
corners are given up — against a square **171 × 171**. That is 17,810 square units against 29,241:
the assumption was costing **64% of the area**, and three prior entries (Q-393, Q-397, Q-399) each
spent their effort designing around it. Q-399 in particular had to trim the header's type and gaps
just to get three ingredient lines onto the default.

`squareOnly` is gone as a concept — the type, the spec field, the picker's amber badge and the
"Square dies only" warning all with it. Nothing draws a circle, a die guide or a vignette; the round
die is a print-time consideration now.

## What the area bought

Every style's code grew, and the default gained a line at the same time:

| style | before | after |
|---|---|---|
| `band` — the tightest | 0.369 mm/module | **0.521** |
| `inlineCentred` — the default | 0.401 | **0.561** |
| `editorial` | 0.481 | 0.593 |
| `ticket` | 0.417 | 0.609 |
| `plaque` | 0.520 | 0.681 |
| `square` | 0.561 | 0.722 |

The centred stack's header drops from 86.5 units to **69.5** (the margin falls from 26 to 9), so the
default now draws **four** ingredient lines where it drew three — *and* a code 40% larger. The
budget was re-derived rather than left at its round-era numbers, which is what the entry asked for:
leaving them would have reserved the extra area and never used it.

## ⚠ The gain is expected, not proven, and one print decides it

*"It will auto fit in the circle template"* has two readings that point opposite ways:

- **The template CROPS the corners** (circle inscribed in a 50 mm square) → the artwork keeps its
  50 mm width and the table above holds.
- **The template SCALES the square to fit inside the circle** → it lands at 50 ÷ √2 = **35.4 mm**,
  every module shrinks by 29%, and the default falls to **0.397** — *fractionally worse than the
  0.401 it replaces.*

So this ships described as **a simplification that is expected to improve scannability**, not as a
scannability improvement. If the template turns out to scale, the follow-up is to keep the square
canvas anyway — it is simpler and the content still benefits — but design the critical content
(name, calories, code) to sit inside the inscribed circle. The print is the same one Q-400 already
owes, and Q-400's delivery fix should land first since its saved PNG currently declares no physical
size at all.

## Two test thresholds raised, because they had stopped being tests

The entry asked for this and it was right: on a square canvas the old assertions could no longer
fail for any style.

- *"no style's module is smaller than the tightest shipped one"* — **0.36 → 0.52**. The tightest
  moved from 0.369 to 0.521, so the old floor was clear by 45%.
- *"the default draws the lines its picker copy promises"* — **3 → 4**, matching what it now draws.

The picker copy stays *"as much of the ingredient list as fits"*, and the overflow summary stays.
A bigger canvas does not make the list finite, and Q-399's lesson was that a style silently printing
**none** of it went unnoticed for a release.

## Plaque's rings broke, and the E2E caught it

Growing every code was not free. `plaque`'s "double ring" was two concentric **circles** at radius
`SHEET/2 − 6` and `− 9`, which cleared its 60-unit code and did **not** clear its 85-unit one: the
outer circle crossed the code's bottom edge at x ± 22.8 against a code spanning ± 42.5. The E2E's
decode of the rendered canvas failed on plaque alone — the one style whose framing is drawn *over*
the content area.

Circles were coherent while the inscribed circle was the binding constraint and are arbitrary on a
square canvas, so they became **two inset rounded rectangles**. They frame the same way, clear the
content by construction (the content box is inset 9; the frames sit at 5 and 8, outside it), and
match the shape the label now is.

Worth naming because it is the failure mode this change invites: enlarging every code moves content
into space that decoration already occupied, and only one of the six styles draws decoration there.

## What was NOT exercised

- **No print, which is the acceptance criterion.** Everything above is arithmetic and a browser
  render. The crop-versus-scale question is unanswered and it is the one that decides whether this
  helped or very slightly hurt.
- **No device run.** JS-only; reaches the APK on the next Railway deploy with no rebuild.
- **Overlap was checked by the E2E's decode, not by eye** — and it caught one (plaque, above). Four
  styles have their rendered code decoded from canvas pixels, which fails if something overruns it.
  But a collision landing on the **ingredient text** rather than the code would not be caught, the
  other two styles are only checked for ink, and nobody has looked at all six at the new sizes.
- The module grid is still fractional in device pixels (**Q-358**), unchanged here.
