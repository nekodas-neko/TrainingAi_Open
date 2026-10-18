import {
  qrModulesForVersion, QR_BYTE_CAPACITY_M, MEAL_SHARE_MAX_BYTES, qrVersionForBytes,
} from '@trainingai/shared/nutrition/label-payload'

/**
 * The meal label's GEOMETRY — every decision that can be made without a canvas (LB-33).
 *
 * Split out of `meal-label-render.ts` when that file reached 1,049 lines. The boundary is not
 * arbitrary and it is not about size: everything here is pure arithmetic over a style and a byte
 * count, while everything left behind needs a `CanvasRenderingContext2D`. Both vitest projects run
 * `environment: 'node'`, so this half is the only half that can be asserted at all — every existing
 * test imports from here and none of them can reach a painter. The split makes that boundary
 * structural instead of conventional.
 *
 * `scripts/check-component-size.js` never flagged the file because it is `.ts` rather than `.tsx`,
 * so the ~800-line guidance applied by spirit and not by CI.
 */

/**
 * Draws a saved meal's printable 50 × 50 mm label (Q-389).
 *
 * **Canvas, not SVG → PNG, and that is load-bearing.** Fonts referenced inside an SVG that is then
 * loaded as an `<img>` do not resolve — the browser rasterises it in an isolated context with no
 * access to document fonts, so every style would silently fall back and the layout has no slack to
 * absorb the metric change. Drawing with `ctx.fillText` uses the real document faces, which is what
 * makes the `next/font` self-hosting in `app/layout.tsx` actually do anything.
 *
 * **Every style draws SQUARE** (Q-411, owner's call). The round die is handled at the printer, not
 * here: the artwork is a square with no circular framing, guide or vignette. All geometry below is
 * expressed against a 189 × 189 unit sheet with a 171 × 171 usable box inset by a 9-unit margin,
 * then scaled. The old 130 × 137 inscribed box — what survives a round crop — cost 64% of the area
 * and is what Q-393, Q-397 and Q-399 each spent their effort designing around.
 */

/** The sheet is 50 mm; these are its design units, not pixels. */
export const SHEET = 189
export const SQUARE_MARGIN = 9
export const SQUARE_W = SHEET - SQUARE_MARGIN * 2   // 171
/** Ingredient line height in the centred stack. Shared so the budget and the painter agree. */
export const STACK_LINE_H = 8
/**
 * Canvas scale. 6.24 makes a 50 mm label 1,179 px — **600 dpi**, doubled from the 3.12 (300 dpi)
 * that shipped through v1.324.6.
 *
 * This is not a preview-quality tweak: the canvas IS the printed artwork, since the share/save path
 * hands the viewer these exact pixels. At 300 dpi the default's module was **4.7 device pixels**
 * with fractional, antialiased edges (see `drawCode`), and the E2E's decode of the rendered label
 * became a coin flip — the same geometry decoded on one run and not the next. Doubling takes the
 * module to 9.5 px, which is what made it decode reliably again, and it costs a 1.4 MP canvas.
 *
 * `band`, the tightest style, was already at 4.35 px per module before this and was never checked
 * at 300 dpi against a real printer, so this is likely to have helped the owed print test too.
 */
export const DEFAULT_RENDER_SCALE = 6.24

/** The sheet is 50 mm across. Not a setting — it is what the label stock is. */
export const LABEL_SHEET_MM = 50

/**
 * The dpi a rendered label actually carries, derived from the canvas rather than written down
 * (Q-400). The PNG the save/share paths hand out has no `pHYs` chunk of its own — the canvas API
 * cannot write one — so every print path assumes 96 dpi and a 50 mm label arrives at ~312 mm.
 * `withPngDensity` stamps this figure in before the bytes leave.
 *
 * Computed from the canvas width so it cannot drift the next time `DEFAULT_RENDER_SCALE` moves; at
 * 6.24 the canvas is 1,179 px and this returns ~599, which is the 600 dpi the scale was chosen for.
 */
export function labelPrintDpi(canvasPx: number): number {
  return canvasPx / (LABEL_SHEET_MM / 25.4)
}
/**
 * The usable box. **Square, as of Q-411** — the owner's instruction, in their words: *"could we just
 * have this as a generic square? it will auto fit in the circle template when I need to print it -
 * so they could all start as squares."*
 *
 * It used to be a centred 130 × 137 — what fits inside the *inscribed circle* once the corners are
 * given up — and that constraint is what Q-393, Q-397 and Q-399 each spent their effort designing
 * around. 130 × 137 is 17,810 square units against 171 × 171's 29,241: the round assumption was
 * costing **64% of the area**, and the height it gives back goes to the code.
 *
 * **The round die is now a print-time consideration, not a renderer constraint.** Nothing here
 * draws a circle, a die guide or a vignette.
 *
 * ⚠ **The gain is expected, not proven.** *"It will auto fit in the circle template"* has two
 * readings: if the template CROPS the corners the artwork keeps its 50 mm width and the numbers
 * below hold; if it SCALES the square to fit inside the circle it lands at 50 ÷ √2 = 35.4 mm and
 * every module shrinks by 29%. One test print settles it. Until then do not call this a
 * scannability improvement.
 */
export const USABLE_W = SQUARE_W
export const USABLE_H = SQUARE_W

export type MealLabelStyle = 'inlineCentred' | 'band' | 'editorial' | 'ticket' | 'plaque' | 'square' | 'share'

export const MEAL_LABEL_STYLES: { value: MealLabelStyle; label: string; note: string }[] = [
  // B2 (Q-397), and the DEFAULT. Carries the ingredient list because the run wraps inline instead of
  // stacking, which spends width — the label has it going spare — rather than height, which the code
  // needs. On the square canvas it draws FOUR lines at a larger code than the three it managed on
  // the inscribed box (Q-411).
  //
  // The copy still says "as much of the ingredient list as fits", not "the full list" (Q-399), and
  // that stays true on a bigger canvas: anything past the lines drawn is summarised on the label as
  // "scan for the full list", and the sheet reports the exact split for the meal in hand. Promising
  // the whole list is how a style that printed NONE of it went unnoticed for a release.
  { value: 'inlineCentred', label: 'Ingredients · centred', note: 'The default. Name, calories, macros, as much of the ingredient list as fits, and the code — all centred.' },
  // "The default" until v1.324.0 and still said so here through Q-397 and Q-399. It is not, and a
  // picker that calls two styles the default is worse than one that names neither. Still the
  // tightest code of the six — 0.521 mm per module since Q-411 — which is why it is the one to
  // test-print first.
  { value: 'band', label: 'Black band', note: 'Reversed header. The tightest code of the six — print this one first if you are checking a printer.' },
  { value: 'editorial', label: 'Editorial', note: 'The quietest of the six.' },
  { value: 'ticket', label: 'Deli ticket', note: 'Monospaced, dashed rules.' },
  { value: 'plaque', label: 'Plaque', note: 'Double ring, no write-on line — the second-largest code.' },
  // Q-393, and since Q-411 it is no longer a special case — every style draws square, so this one is
  // simply the layout that puts the code beside the calories rather than under them.
  { value: 'square', label: 'Big code', note: 'The code sits beside the calories rather than under them, so it stays large while the label still prints the ingredient list.' },
  // BF-57. The only style whose code carries the whole recipe, because it is the only one that gives
  // the code the ~30 mm that needs. Everything it drops — calories, macros, the ingredient list — is
  // inside the code, so a scan shows all of it; what is lost is what a human can read off the paper.
  { value: 'share', label: 'Share code', note: 'Name and a full-size code, nothing else. The only style whose code carries the whole recipe — send it to someone and they get the meal, not a link.' },
]

// B2, per the owner's decision (Q-397): "Yes have B2 as the default". It is not merely a nicer
// layout — it prints a *more* forgiving code than `band` did while also carrying the breakdown, so
// leaving it as an opt-in style would have made the better default the one you had to go and find.
/**
 * A style's printed code size. `codeUnits` is the whole drawn box **including** the 4-module quiet
 * zone on each side, so the symbol is 25/33 of it — which is exactly the distinction that made every
 * earlier figure in Q-389/Q-393 read ~24% large.
 *
 * Exported so the numbers can be ASSERTED rather than believed: the preview's own size figure was
 * wrong once already (v1.323.0), and Q-397 asks for a test precisely because a number nobody checks
 * is a number that drifts.
 */
export function mealLabelCodeMetrics(
  style: MealLabelStyle,
  /**
   * Modules per side of the symbol actually drawn.
   *
   * **This used to be the constant 25, and BF-57 is why it cannot be one any more.** The old payload
   * was a fixed-length token, so every label of every style drew version 2 and the pitch was a
   * property of the layout alone. The payload is now the recipe, so the version — and therefore the
   * pitch — varies with the meal in hand.
   *
   * The default is the version this style *budgets* for, which is its worst case: the code can come
   * out smaller for a short recipe, never larger. Pass an explicit count to ask about the layout
   * rather than about a particular meal.
   */
  modules: number = mealLabelCarriesRecipe(style) ? mealLabelShareBudget(style).modules : 25,
): {
  boxMm: number; symbolMm: number; mmPerModule: number
} {
  const QUIET = 4
  const boxMm = (SPECS[style].codeUnits / SHEET) * 50
  const mmPerModule = boxMm / (modules + QUIET * 2)
  return { boxMm, symbolMm: mmPerModule * modules, mmPerModule }
}

/**
 * The finest module a home printer is trusted to hold, in millimetres (BF-57).
 *
 * The label design was built to 0.49–0.66 mm per module and this is its floor. It is a **print**
 * constraint: ink spread merges adjacent modules on paper, which is the failure this whole feature
 * risks. Nothing stops a phone reading a finer code off a screen — and the share path hands out a
 * PNG that is displayed far larger than 50 mm — so sizing to the printed floor is the strict case
 * and the screen case comes free.
 */
export const MIN_MM_PER_MODULE = 0.49

/**
 * The smallest payload that is worth calling a shared meal: a real name plus the exact totals.
 *
 * `[1,"Beef Pasta Bake",4,[["+5 more",600,1200,80,120,40]],5]` is 58 bytes, so version 4's 62 is
 * the floor. Below it `encodeSharedMeal` starts **trimming the name** — its documented last resort,
 * and the right one, since the numbers must never be guessed at. But a label whose title has been
 * eaten to fit a code is not a label, which is why this is a threshold rather than a preference.
 */
const MIN_SHAREABLE_VERSION = 4

/**
 * How many payload bytes a style's code can carry and still print legibly (BF-57).
 *
 * **This inverts the dependency the backlog entry assumed, and the reason is measurement.** The
 * entry asked for the code to be given ~30 mm so version 11's 251 bytes would fit, reasoning from
 * a code of 12.2–16.4 mm. That range is pre-Q-411: on the square canvas the five print styles
 * already run 16.4–20.9 mm, and every one of them is *already* the largest value that leaves the
 * 6 units of clearance their own comment requires. **They cannot grow.** 30 mm needs 128 units of
 * a 171-unit box, which is the whole label — there is no arrangement of a name, a calorie figure,
 * a macro line and an ingredient list that leaves it.
 *
 * So the layout cannot be made to serve a fixed budget; the budget is read off the layout instead.
 * And the answer that comes back is the finding: **at 0.49 mm per module, four of the six print
 * styles cannot hold even 62 bytes**, so "make every label shareable" is not available at 50 mm.
 * Forcing it would have shipped labels with trimmed titles — a change that renders, scans, and is
 * quietly wrong, which is the worst shape a change can have here.
 *
 * Hence `share`: a style that drops the calorie block and the ingredient list — both of which the
 * code itself carries — and spends the whole label on the code. It is the only one that reaches
 * version 11, and it is what the entry's ~30 mm actually buys.
 *
 * Capped at `MEAL_SHARE_MAX_BYTES` because the encoder will not emit more, so a larger version
 * would be drawn empty-handed.
 */
export function mealLabelShareBudget(style: MealLabelStyle): {
  version: number; modules: number; maxBytes: number; mmPerModule: number
  /** Can this style's code hold a shareable meal at all? See `MIN_SHAREABLE_VERSION`. */
  shareable: boolean
} {
  const boxMm = (SPECS[style].codeUnits / SHEET) * 50
  const ceiling = qrVersionForBytes(MEAL_SHARE_MAX_BYTES) ?? 1
  let version = 1
  for (let v = ceiling; v >= 1; v--) {
    if (boxMm / (qrModulesForVersion(v) + 8) >= MIN_MM_PER_MODULE) { version = v; break }
  }
  const modules = qrModulesForVersion(version)
  return {
    version,
    modules,
    maxBytes: QR_BYTE_CAPACITY_M[version],
    mmPerModule: boxMm / (modules + 8),
    shareable: version >= MIN_SHAREABLE_VERSION,
  }
}

/**
 * Does this style's code carry the meal itself, or a private bookmark to it? (BF-57)
 *
 * **Two payloads ship, and that is the reconciliation rather than a hedge.** The five print styles
 * exist to go on a jar in your own kitchen: their job is *scan this to log it*, they have the
 * tightest codes in the feature, and `encodeMealLabelToken`'s 22 characters fit them with room to
 * spare. The `share` style exists to be handed to a person, and carries the recipe.
 *
 * Driving it off `layout === 'code'` rather than off `shareable` is deliberate: `plaque` and
 * `square` are geometrically large enough to hold 62 bytes, but a 62-byte payload names about two
 * ingredients and rolls the rest — so those two would *look* shareable, produce a visibly poorer
 * copy than `share`, and give nobody a reason to pick the style that does it properly. One clearly
 * labelled answer beats three partial ones.
 *
 * Old labels keep working either way: `decodeMealLabelScan` reads both shapes, indefinitely, because
 * a label already stuck to a jar has no upgrade path.
 */
export function mealLabelCarriesRecipe(style: MealLabelStyle): boolean {
  return SPECS[style].layout === 'code'
}

export const DEFAULT_MEAL_LABEL_STYLE: MealLabelStyle = 'inlineCentred'

/** Read-only view of a style's geometry, so tests can ask what a style claims without a canvas. */
export function mealLabelStyleSpec(style: MealLabelStyle): Readonly<StyleSpec> {
  return SPECS[style]
}

/**
 * How many ingredient lines the centred stack can actually draw, from the geometry it actually
 * draws — the one number Q-399 was wrong about.
 *
 * v1.324.6's `codeUnits` was reasoned against gaps the painter did not use, so the style promised
 * the full breakdown and printed **zero lines**, silently, at every name length. Nothing failed:
 * the renderer reported 0, the sheet's "Printing N ingredients" copy is gated on `> 0` so it simply
 * vanished, and the picker went on claiming the list. The fix is not a better constant — it is that
 * the constant and the painter now read the same four gaps, and a test asserts the promise.
 *
 * Pure and canvas-free on purpose: the painter needs a `CanvasRenderingContext2D` and both vitest
 * projects are `environment: 'node'`, so arithmetic left inside the painter cannot be asserted at
 * all. Same split as `fitIngredientLines`/`wrapIngredientRun`, for the same reason.
 *
 * `fitText` shrinking a long name only ever makes this larger, so the figure here is the floor.
 */
export function centredStackLineBudget(style: MealLabelStyle): {
  headerUnits: number; codeTop: number; maxLines: number
} {
  const spec = SPECS[style]
  // Square for every style since Q-411; `squareOnly` no longer exists.
  const L = SQUARE_MARGIN
  const bottom = SHEET - SQUARE_MARGIN
  const [afterName, afterCalories, afterMacros, afterRule] = spec.stackGaps ?? [7, 6, 5, 8]

  let y = L + 4
  y += spec.nameSize + afterName
  y += spec.caloriesSize + afterCalories
  y += spec.macroSize + afterMacros
  y += afterRule

  const codeTop = bottom - (spec.writeOnLine ? 9 : 0) - spec.codeUnits
  return { headerUnits: y, codeTop, maxLines: Math.max(0, Math.floor((codeTop - y - 2) / STACK_LINE_H)) }
}

/**
 * How far to shift the whole composed block down so the leftover space is **shared** between the
 * top margin and the code, instead of piling up above the code (Q-416).
 *
 * The centred layout pins its two ends to opposite margins: the header flows down from the top, the
 * code is anchored up from the bottom. Whatever the ingredient list does not use becomes a void
 * immediately above the code — **8.6 mm of it on a one-ingredient meal**, an eighth of the label's
 * height. A four-ingredient meal looks right and a one-ingredient meal looks broken, which is how
 * this passed review: the mockups were drawn with fuller lists.
 *
 * Half the slack, so the group sits centred between the margins the way the approved prototype's
 * flex column did. Every gap the style specifies is untouched — only the remainder moves, and
 * `codeTop` does not move at all, so a batch of labels still puts every code in the same place.
 */
export function centredStackOffset(
  { contentEnd, codeTop }: { contentEnd: number; codeTop: number },
): number {
  // Never negative: an overfull layout must not be dragged UP through the top margin. `maxLines`
  // already clamps that, so this guards a future style rather than a live case.
  return Math.max(0, (codeTop - contentEnd) / 2)
}


/**
 * Per-style geometry. `codeUnits` is the code's drawn width in sheet units; at 50 mm a unit is
 * 50/189 mm, so band's 46 units is 12.2 mm — the tightest, which is why it is the one to test-print
 * first. `writeOnLine` is a bare rule the owner writes the date on: no label beside it, and plaque
 * carries none at all, which is what buys plaque the largest code.
 */
/**
 * ⚠ **`codeUnits` is bounded by VERTICAL fit, not by the area the square canvas freed.** Q-411's
 * entry predicted a per-style table from the 64% area gain; taking those figures directly gave
 * `editorial` and `ticket` **negative** clearance — the code drawn straight over the macro line —
 * and put `plaque`'s code exactly on it. Only `plaque` failed CI, because it is one of the four
 * styles whose rendered code the E2E decodes; the other two would have shipped broken.
 *
 * Each value below is the largest that leaves **6 units** between where the content stops and where
 * the bottom-anchored code starts. Re-derive it if any of `caloriesSize`, `macroSize`, `rule` or
 * `writeOnLine` changes — those four decide where the content ends.
 */
export interface StyleSpec {
  fontVar: string
  fallback: string
  codeUnits: number
  writeOnLine: boolean
  reversedHeader: boolean
  rule: 'none' | 'solid' | 'dashed' | 'ring'
  nameSize: number
  caloriesSize: number
  macroSize: number
  nameTracking: number
  uppercaseName: boolean
  /**
   * The four vertical gaps the `stack` painter draws, in sheet units: after the name, after the
   * calories, after the macros, and after the rule. **These live here rather than as literals in
   * the painter so `centredStackLineBudget` can see the same numbers**, which is the whole fix for
   * Q-399: the shipped `codeUnits` was computed against a different set of gaps than the ones drawn,
   * so it promised an ingredient list the layout had no room for and silently printed none.
   */
  stackGaps?: [number, number, number, number]
  /** Print the per-serving ingredient breakdown (Q-393). */
  ingredients?: boolean
  /**
   * How the square layouts arrange themselves.
   *
   * `beside` puts the code next to the calories, which is what buys it the biggest code in the
   * feature (0.561 mm per module). `stack` is the owner's requested reading order — name, calories,
   * macros, ingredients, code — every element on the centre line. Stacking spends height on text
   * that `beside` spends on the code, so its code is smaller; it is still larger than every round
   * style. Both ship because the trade is a matter of taste on paper, not of correctness.
   */
  layout?: 'beside' | 'stack' | 'code'
}

export const SPECS: Record<MealLabelStyle, StyleSpec> = {
  band: {
    fontVar: '--font-archivo', fallback: 'sans-serif', codeUnits: 62, writeOnLine: true,
    reversedHeader: true, rule: 'solid', nameSize: 11, caloriesSize: 25, macroSize: 8.5,
    nameTracking: 0.06, uppercaseName: true,
  },
  editorial: {
    fontVar: '--font-geist-sans', fallback: 'sans-serif', codeUnits: 64, writeOnLine: true,
    reversedHeader: false, rule: 'solid', nameSize: 12, caloriesSize: 26, macroSize: 8.5,
    nameTracking: 0, uppercaseName: false,
  },
  ticket: {
    fontVar: '--font-geist-mono', fallback: 'monospace', codeUnits: 67, writeOnLine: true,
    reversedHeader: false, rule: 'dashed', nameSize: 10.5, caloriesSize: 24, macroSize: 8,
    nameTracking: 0.04, uppercaseName: true,
  },
  plaque: {
    fontVar: '--font-instrument-serif', fallback: 'serif', codeUnits: 79, writeOnLine: false,
    reversedHeader: false, rule: 'ring', nameSize: 13, caloriesSize: 27, macroSize: 8.5,
    nameTracking: 0.02, uppercaseName: false,
  },
  // **76 is the largest code that still leaves three ingredient lines, and that bound is the point.**
  // Q-411 first set this to 90 — reflexively, because it was resizing every style — and 90 is wrong
  // for a reason worth writing down: `square` was ALREADY drawing on a square canvas before Q-411
  // (it carried the retired `squareOnly` flag), so it is the one style that gained no area from that
  // change and had nothing to spend. The 20 extra units came straight out of the list: 3 of the
  // fixture's 8 ingredients became 1, on the style whose own picker note promises the breakdown.
  // That is the Q-399 failure shape — a layout that claims a list and prints almost none — and
  // `e2e/meal-label.spec.ts` caught it only because the sheet's copy went singular.
  //
  // The list room is `168 − (56 + codeUnits)` against a 9-unit line, so three lines need
  // `codeUnits ≤ 76`. At 76 the module is (76/189)*50/33 = 0.609 mm: still ahead of every style but
  // `plaque`, and ahead of main's own 70 (0.561) — so this remains a gain on both axes, which 90
  // was not.
  square: {
    fontVar: '--font-geist-sans', fallback: 'sans-serif', codeUnits: 76, writeOnLine: true,
    reversedHeader: true, rule: 'solid', nameSize: 12, caloriesSize: 24, macroSize: 8,
    nameTracking: 0.04, uppercaseName: true, ingredients: true, layout: 'beside',
  },
  // 58 units is what the stack can spare once name, calories, macros and five ingredient lines have
  // taken their height: (58/189)*50 / 33 = 0.465 mm per module. Smaller than `square`'s 0.561, and
  // still larger than every round style — the cost of reading top-to-bottom down the centre line.
  //
  // **Q-399 rewrote these numbers, and the reason is the point.** v1.324.6 shipped codeUnits 66 with
  // a taller header (calories 21, gaps 7/6/5/8), which consumed 96.5 of the 137 units before the
  // list started and left `floor((97 − 96.5 − 2) / 8)` = **zero** ingredient lines — a style whose
  // entire premise is the breakdown printed none, at any name length, and the picker still claimed
  // "the full ingredient list". The budget had been computed against a different set of gaps than
  // the painter drew.
  //
  // Q-399 concluded the stack could not carry the list AND a better code than `band`'s 0.369. At the
  // shipped type sizes that is right: three lines forces codeUnits 42.5, i.e. 0.341. It is wrong at
  // the type the mockup was actually drawn at. Giving back 3 units of calories height and 7 of gap
  // takes the header from 96.5 units to 86.5 and buys **three lines at codeUnits 50, 0.401 mm per
  // module** — above `band`'s 0.369, and ~7 ingredients once the run wraps inline. That is the trade
  // resolved rather than dodged, and it is the whole margin: 52 units gives two lines, not three.
  //
  // The 50 is not a guess and not a second guess. `centredStackLineBudget` derives the line count
  // from `stackGaps` — the same array the painter draws — and a test asserts the style draws the
  // three lines its picker copy promises. Raising any of these five numbers without lowering
  // `codeUnits` fails that test, which is exactly what did not happen in v1.324.6.
  inlineCentred: {
    fontVar: '--font-geist-sans', fallback: 'sans-serif', codeUnits: 70, writeOnLine: false,
    reversedHeader: false, rule: 'solid', nameSize: 12, caloriesSize: 18, macroSize: 7.5,
    stackGaps: [5, 4, 4, 6],
    nameTracking: 0.02, uppercaseName: false, ingredients: true, layout: 'stack',
  },
  // **130 units — 34.4 mm — is the number BF-57 is actually about**, and it is why this is a new
  // style rather than a change to the six above. Version 11 is 61 modules; with the 4-module quiet
  // zone on each side that is 69 across, and 0.49 mm apiece needs 33.8 mm. The other five print
  // styles top out at 20.9 mm and each is *already* at the largest value that clears its content by
  // 6 units, so none of them can reach it — the room has to come from dropping content, and the
  // content this drops is exactly the content the code already carries.
  //
  // Vertically: 13 for the top margin and lead-in, ~13 of name, an 8 gap, 130 of code, then the
  // caption. That lands at 175 against a 180 bottom margin, so the 5 units of slack are real rather
  // than assumed. Raising `codeUnits` past 132 puts the caption through the margin.
  share: {
    fontVar: '--font-geist-sans', fallback: 'sans-serif', codeUnits: 130, writeOnLine: false,
    reversedHeader: false, rule: 'none', nameSize: 13, caloriesSize: 0, macroSize: 7,
    nameTracking: 0.02, uppercaseName: false, layout: 'code',
  },
}

