# 2026-08-18 — Q-389 built: printable saved-meal labels, scannable back into the app

**Branch:** `claude/implementation-lane-b-0o7kb9` · **v1.320.0** · **Lane:** Implementation B

PR 2 of Q-389's two-PR split — [the plan](../../superpowers/plans/2026-08-17-saved-meal-printable-label.md)
landed yesterday, this is the implementation. Q-389's queue entry is removed; what it still owes is a
`projectOverview.md` Known-Issues row, because both remaining checks are physical.

## What shipped

A saved meal now has a code button that opens a preview of a 50 × 50 mm label — name, calories,
per-serving macros, a bare rule to write the date on, and a QR — in the four styles the owner chose,
switchable, with black band the default. **Share or save** hands the PNG to the system share sheet.
Scanning that code in the existing food scanner resolves the meal and logs one serving.

| Piece | Where |
|---|---|
| Payload codec + label figures | `packages/shared/src/nutrition/label-payload.ts` |
| Renderer (canvas, four styles) | `components/nutrition/meal-label-render.ts` |
| Preview + share sheet | `components/nutrition/meal-label-sheet.tsx` |
| Scan branch | `capture-step.tsx` → `food-logger-sheet.tsx` |
| Fonts (Archivo, Instrument Serif) | `app/layout.tsx` via `next/font` |

## Five decisions, and why

**Canvas, not SVG → PNG.** Fonts referenced inside an SVG loaded as an `<img>` do not resolve — the
browser rasterises it with no access to document fonts, so every style would silently fall back and
this layout has no slack to absorb the metric change. `ctx.fillText` uses the real faces, which is
what makes the `next/font` self-hosting actually do anything.

**Web Share, not a Capacitor plugin.** `@capacitor/share` would have meant a new APK.
`navigator.share({files})` reaches the system sheet — which is where a print app lives — and needs no
native code at all; `<a download>` is the browser fallback so the label is reachable in `pnpm dev`.

**Style is picked at print time and not stored.** The spec left this open with three options, one of
which (a per-meal column) is a migration and therefore Lane A's. Picked-at-print-time needs neither a
schema change nor a settings surface, and the renderer takes the style as a parameter either way — so
persisting it later is an addition, not a rewrite.

**EC level M, and the payload is the bare id.** Measured against the real encoder rather than
assumed: the 22-char token is version 2 (25×25) at both L and M; a canonical UUID is version 3. **One
correction to my own plan** — it said a `ta:` prefix would push it to v3, and that is wrong: at 25
chars it still fits v2/M. Only a URL forces v3. The budget is 26 bytes, the token is 22, so there are
four bytes of headroom and the design still cannot carry anything meaningful. A unit test asserts the
length against the budget so a later "let's also put the name in" fails in CI rather than on paper.

**Ink on paper, never a theme token.** The one surface in the app that deliberately does not use
`--accent-*`, with a comment saying so, and previewed on a white ground in both themes.

## Three things found by building rather than reading

**1. The canvas was in the DOM and never drawn.** `SheetContent` mounts into a portal, so on the
render where `open` flips true the draw effect fires *before* the canvas exists; a plain `useRef`
read null and the effect returned early. Fixed with a state-backed callback ref. **The E2E spec found
this** — the sheet opened, the canvas was in the accessibility tree, and nothing was ever painted.
Reading the code would not have shown it.

**2. A `<canvas>` has no implicit ARIA role.** An `aria-label` on it alone is not exposed at all — the
element simply does not appear in the accessibility tree. `role="img"` is what makes it
announceable, and it was also the only way the spec could find it.

**3. The Nutrition action row still swallows mouse clicks.** The spec's first attempts failed
because `.click()` on that screen does nothing — Q-354, diagnosed earlier and parked. The baton's
"first suspect when a click silently does nothing" note is what shortened this to one round. The spec
uses `touchscreen.tap()`, which is the more faithful test anyway.

## Guards

- **Unit** (`label-payload.test.ts`, 13 tests): round-trips including all-zero and all-`f` ids;
  `decode` returns null for EAN-13, UPC-A, wrong length, wrong alphabet, a URL; the token stays
  inside the v2/EC-M byte budget. And **the assertion this feature exists to keep true** — the label's
  figures are compared against a sum of what `logMealItems` would actually log, in one test, for
  1, 1.5, 2 and 0 servings. Checking them separately would pass even if they had drifted apart.
- **E2E** (`meal-label.spec.ts`): seeds a 2-serving meal, opens the sheet, and asserts each of the
  four styles actually **paints ink onto the canvas** — sampling pixels, not just checking the sheet
  opened. **Mutation-checked**: with the painting removed but the metrics still returned, it fails.
- Full suite: **484 files / 3,940 tests**, 24 E2E, `check:rules` **38 of 38**, build clean.
- `saved-meals-sheet.tsx` hit the 800-line ceiling, so `BulkDeleteConfirm` was **extracted** rather
  than the limit raised — and its two red hex literals became the `destructive` token on the way, so
  the hex ratchet went **down** (471 → 469) instead of needing a raise.

## What was NOT exercised

- **Nothing was printed.** The whole physical half is untested: the code is **0.49–0.66 mm per
  module** and ink spread merging fine modules is the expected failure — which presents as "the
  scanner doesn't work", not as a print problem. **Print black band first**; it is the default and
  the tightest, so if it scans the others do.
- **The camera scan path has never run.** QR decoding goes through the Capacitor plugin, inert in the
  sandbox. The decode, lookup and logging are unit-tested; the camera is not.
- **The share path is device-unverified.** `navigator.share({files})` is checked with `canShare`
  first, but whether the S25's WebView offers a print target is unknown.
- **Fonts were not visually checked on device.** Archivo and Instrument Serif are new to the app.
