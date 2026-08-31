import QRCode from 'qrcode'
import {
  encodeMealLabelToken, encodeSharedMeal, fitIngredientLines, wrapIngredientRun,
  qrModulesForVersion, QR_BYTE_CAPACITY_M, MEAL_SHARE_MAX_BYTES, qrVersionForBytes,
  MEAL_LABEL_TOKEN_LENGTH,
  type MealLabelFigures,
} from '@trainingai/shared/nutrition/label-payload'
import type { SavedMeal } from '@trainingai/shared/types/nutrition'

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
const SHEET = 189
const SQUARE_MARGIN = 9
const SQUARE_W = SHEET - SQUARE_MARGIN * 2   // 171
/** Ingredient line height in the centred stack. Shared so the budget and the painter agree. */
const STACK_LINE_H = 8
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
const DEFAULT_RENDER_SCALE = 6.24

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
const USABLE_W = SQUARE_W
const USABLE_H = SQUARE_W

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
interface StyleSpec {
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

const SPECS: Record<MealLabelStyle, StyleSpec> = {
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

/**
 * Resolve a `next/font` CSS variable to the family list canvas needs.
 *
 * `ctx.font` cannot take a `var(--x)` — the same class of bug as passing a custom property to
 * chart.js paint, which this repo has shipped before. Reading the computed value converts it to the
 * real family list; the fallback keeps a server render or a stripped stylesheet from producing an
 * empty font string, which canvas ignores silently.
 */
function resolveFamily(spec: StyleSpec): string {
  if (typeof window === 'undefined') return spec.fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(spec.fontVar).trim()
  return v ? `${v}, ${spec.fallback}` : spec.fallback
}

/** Shrink a string's font size until it fits `maxWidth`, so a long meal name never overruns. */
function fitText(ctx: CanvasRenderingContext2D, text: string, family: string, weight: string, size: number, maxWidth: number): number {
  let s = size
  for (let i = 0; i < 24; i++) {
    ctx.font = `${weight} ${s}px ${family}`
    if (ctx.measureText(text).width <= maxWidth) break
    s -= 0.5
  }
  return s
}


/** The usable box: the sheet inset by a uniform margin. Square for every style (Q-411). */

/** Draw the code's modules into a box, quiet zone included inside it. */
/**
 * Draw the code, quiet zone included.
 *
 * **This is the only place a code is drawn.** The round painter carried a byte-identical copy of
 * this arithmetic inline until Q-399, which is the "One Formula, One Place" bug class and is how a
 * defect can sit in one copy and not the other.
 *
 * **The module grid is snapped to whole device pixels (Q-358).** Sized in sheet units the cell is
 * `box / 33`, so its width in device pixels is `box × scale / 33` — fractional for every style at
 * every scale tried. Every module edge then lands mid-pixel and antialiases to grey, by a different
 * sub-pixel amount per module, and a decoder reading the render sees a grid whose boundaries do not
 * agree with each other. That is why the same label decoded on one run of `e2e/meal-label.spec.ts`
 * and not the next. Q-399 raised `DEFAULT_RENDER_SCALE` to buy margin and the flake went quiet;
 * Q-411 then resized every code and it came straight back, on `plaque` (14.94 px/module) and
 * `square` (17.02) in consecutive runs — which is the proof that margin was never the fix.
 *
 * So this paints in DEVICE space: reset the transform, floor the cell to a whole pixel, and centre
 * the snapped grid inside the box the layout allotted. Every module is then pixel-identical and the
 * render is deterministic. The cost is at most one device pixel per module row — 561 px against
 * 561.6 for `square`, under 0.2% — which is why the reported millimetre figures still derive from
 * `codeUnits` rather than from the snapped size.
 */
function drawCode(
  ctx: CanvasRenderingContext2D,
  qr: { modules: { size: number; data: ArrayLike<number> } },
  x: number, y: number, box: number, ink: string, paper: string,
) {
  const n = qr.modules.size
  const quiet = 4
  const grid = n + quiet * 2

  const t = ctx.getTransform()
  const cellPx = Math.max(1, Math.floor((box * Math.min(t.a, t.d)) / grid))
  const sizePx = cellPx * grid
  const originX = Math.round(t.e + x * t.a + (box * t.a - sizePx) / 2)
  const originY = Math.round(t.f + y * t.d + (box * t.d - sizePx) / 2)

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  // The quiet zone is part of the symbol, so it is painted from the snapped origin too — a paper
  // rect drawn in sheet units would leave a fractional border the binarizer has to guess at.
  ctx.fillStyle = paper
  ctx.fillRect(originX, originY, sizePx, sizePx)
  ctx.fillStyle = ink
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.data[r * n + c]) {
        // No antialiasing bleed here any more: whole-pixel rects on a whole-pixel grid abut exactly,
        // so the `+0.04` seam patch this replaced has nothing left to cover.
        ctx.fillRect(originX + (c + quiet) * cellPx, originY + (r + quiet) * cellPx, cellPx, cellPx)
      }
    }
  }
  ctx.restore()
}

/**
 * The square layout (Q-393): name, then calories and macros beside a large code, then the
 * per-serving ingredient breakdown, then the write-on rule.
 *
 * **Square dies only.** It spends the corners a round die crops, which is exactly the trade that
 * buys the room: the round box is 130 × 137 and the shipped default already fills all of it, leaving
 * 7 units — zero ingredient lines. This box is 171 × 171.
 */
function drawSquareLabel(
  ctx: CanvasRenderingContext2D,
  { spec, family, figures, ingredients, qr, INK, PAPER }: {
    spec: StyleSpec
    family: string
    figures: MealLabelFigures
    ingredients: { name: string; weightG: number }[]
    qr: { modules: { size: number; data: ArrayLike<number> } }
    INK: string
    PAPER: string
  },
): { ingredientLines: number; ingredientOverflow: number } {
  const L = SQUARE_MARGIN
  const R = SHEET - SQUARE_MARGIN
  let y = L

  // --- name, reversed in a full-width band ------------------------------------------------------
  const name = spec.uppercaseName ? figures.name.toUpperCase() : figures.name
  const nameSize = fitText(ctx, name, family, '700', spec.nameSize, SQUARE_W - 10)
  const bandH = nameSize + 10
  ctx.fillStyle = INK
  ctx.fillRect(L, y, SQUARE_W, bandH)
  ctx.fillStyle = PAPER
  ctx.font = `700 ${nameSize}px ${family}`
  ctx.textAlign = 'center'
  ctx.letterSpacing = `${spec.nameTracking}em`
  ctx.fillText(name, SHEET / 2, y + nameSize + 2)
  ctx.letterSpacing = '0em'
  y += bandH + 8

  // --- calories + macros on the left, code on the right -----------------------------------------
  const code = spec.codeUnits
  const codeX = R - code
  ctx.fillStyle = INK
  ctx.textAlign = 'left'
  ctx.font = `700 ${spec.caloriesSize}px ${family}`
  ctx.fillText(String(figures.calories), L, y + spec.caloriesSize)
  const calW = ctx.measureText(String(figures.calories)).width
  ctx.font = `400 ${spec.macroSize}px ${family}`
  ctx.letterSpacing = '0.14em'
  ctx.fillText('KCAL', L + calW + 4, y + spec.caloriesSize)
  ctx.letterSpacing = '0em'
  ctx.font = `500 ${spec.macroSize}px ${family}`
  ctx.fillText(`P ${figures.proteinG}   C ${figures.carbsG}   F ${figures.fatG}`, L, y + spec.caloriesSize + spec.macroSize + 6)

  drawCode(ctx, qr, codeX, y, code, INK, PAPER)
  y += code + 8

  // --- ingredients ------------------------------------------------------------------------------
  // Five lines, because that is what the box holds; anything beyond is summarised rather than
  // silently dropped — a list that stops without saying so is worse than no list.
  ctx.strokeStyle = INK
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.moveTo(L, y)
  ctx.lineTo(R, y)
  ctx.stroke()
  y += 9

  // Stacked, one ingredient per line — deliberately, since this variant exists for anyone who
  // prefers that alignment on square stock (Q-397 keeps it for exactly that). How many lines fit is
  // still DERIVED: the write-on rule is bottom-anchored, so a hardcoded count would run the list
  // through it, and `fitIngredientLines` is the property-tested arithmetic for that.
  const lineH = 9
  const listBottom = SHEET - SQUARE_MARGIN - 12
  const fit = fitIngredientLines({ room: Math.max(0, listBottom - y), lineHeight: lineH, count: ingredients.length })
  const shown = ingredients.slice(0, fit.shown)
  ctx.fillStyle = INK
  ctx.textAlign = 'left'
  for (const ing of shown) {
    const text = `${Math.round(ing.weightG)}g ${ing.name}`
    const size = fitText(ctx, text, family, '400', 7.5, SQUARE_W)
    ctx.font = `400 ${size}px ${family}`
    ctx.fillText(text, L, y)
    y += lineH
  }
  if (fit.overflow > 0) {
    ctx.font = `400 7px ${family}`
    ctx.fillText(`+${fit.overflow} more — scan for the full list`, L, y)
    y += lineH
  }
  if (ingredients.length === 0) {
    ctx.font = `400 7px ${family}`
    ctx.fillText('Scan for the ingredient breakdown', L, y)
  }

  // --- write-on rule, bottom-anchored -----------------------------------------------------------
  if (spec.writeOnLine) {
    const lineY = SHEET - SQUARE_MARGIN - 2
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(L + 6, lineY)
    ctx.lineTo(R - 6, lineY)
    ctx.stroke()
  }

  // Reported so the caller can SAY how much of the list reached the paper. A list that stops at five
  // without telling anyone is the failure this feature is most likely to ship quietly.
  return { ingredientLines: shown.length, ingredientOverflow: fit.overflow }
}


/**
 * The centred square layout (Q-393, owner-specified reading order):
 *
 * ```
 *   Beef Pasta Bake
 *   512 KCAL
 *   P 38  C 46  F 18
 *   (ingredients)
 *   [ QR ]
 * ```
 *
 * Every element sits on the centre line, top to bottom, which is the order the owner asked to read
 * it in. It is the sibling of `drawSquareLabel`, not a replacement: stacking spends on height what
 * the beside layout spends on the code, so this one's code is 58 units against 70. Both ship.
 */
function drawSquareCentredLabel(
  ctx: CanvasRenderingContext2D,
  { spec, family, figures, ingredients, qr, INK, PAPER }: {
    spec: StyleSpec
    family: string
    figures: MealLabelFigures
    ingredients: { name: string; weightG: number }[]
    qr: { modules: { size: number; data: ArrayLike<number> } }
    INK: string
    PAPER: string
  },
): { ingredientLines: number; ingredientOverflow: number } {
  // Round-safe styles compose inside the inscribed 130 × 137 box; square-only ones may use the
  // corners. Same painter, different column — which is what lets B2 print on either die.
  // Square for every style since Q-411; `squareOnly` no longer exists.
  const colWidth = SQUARE_W
  const L = SQUARE_MARGIN
  const cx = SHEET / 2
  const bottom = SHEET - SQUARE_MARGIN
  ctx.textAlign = 'center'
  ctx.fillStyle = INK

  // The four gaps come from the spec, NOT from literals here — `centredStackLineBudget` reads the
  // same array, and Q-399 is what happens when the two disagree (a style that promised the
  // ingredient list and drew zero lines).
  const [afterName, afterCalories, afterMacros, afterRule] = spec.stackGaps ?? [7, 6, 5, 8]

  // ── Measure first, then paint (Q-416) ─────────────────────────────────────────────────────────
  // The block has to know its own finished height before it can be centred, and that height depends
  // on how many ingredient lines the run wraps to. So the wrap is resolved here and reused below
  // rather than computed mid-draw, which is what forced the old top-anchored composition.
  const name = spec.uppercaseName ? figures.name.toUpperCase() : figures.name
  const nameSize = fitText(ctx, name, family, '700', spec.nameSize, colWidth)

  const headerEnd = L + 4 + nameSize + afterName + spec.caloriesSize + afterCalories
    + spec.macroSize + afterMacros + afterRule

  const code = spec.codeUnits
  const codeTop = bottom - (spec.writeOnLine ? 9 : 0) - code
  const lineH = STACK_LINE_H
  const listSize = 7
  ctx.font = `400 ${listSize}px ${family}`
  const charW = ctx.measureText('0123456789abcdefghij').width / 20
  const charsPerLine = Math.max(8, Math.floor(colWidth / charW))
  const maxLines = Math.max(0, Math.floor((codeTop - headerEnd - 2) / lineH))
  const run = wrapIngredientRun({ items: ingredients, charsPerLine, maxLines })
  // The empty-list case still draws one line ("Scan for the ingredient breakdown"), so it counts.
  const drawnLines = ingredients.length === 0 ? 1 : run.lines.length
  const offset = centredStackOffset({ contentEnd: headerEnd + drawnLines * lineH, codeTop })

  let y = L + 4 + offset

  // --- name -------------------------------------------------------------------------------------
  ctx.font = `700 ${nameSize}px ${family}`
  ctx.letterSpacing = `${spec.nameTracking}em`
  y += nameSize
  ctx.fillText(name, cx, y)
  ctx.letterSpacing = '0em'
  y += afterName

  // --- calories, with KCAL on the same line so the number reads as one figure -------------------
  y += spec.caloriesSize
  ctx.font = `700 ${spec.caloriesSize}px ${family}`
  const kcalNum = String(figures.calories)
  const numW = ctx.measureText(kcalNum).width
  ctx.font = `500 ${spec.macroSize}px ${family}`
  ctx.letterSpacing = '0.12em'
  const unitW = ctx.measureText('KCAL').width
  // **The NUMERAL is centred, not the number-plus-unit run** (Q-416). Centring the run puts the
  // figure's own midpoint left of the axis by `(3 + unitW) / 2` — about 3 mm on a 50 mm label —
  // and since every other element here is symmetric about `cx`, that reads as misaligned rather
  // than merely offset. The trade is deliberate: `KCAL` now overhangs to the right, so the
  // composition is no longer symmetric, which is the right call for a figure whose whole job is to
  // be read at a glance. Falls back to the run-centred form only if the overhang would clip.
  const axisCentred = cx - numW / 2
  const startX = axisCentred + numW + 3 + unitW <= SHEET - SQUARE_MARGIN
    ? axisCentred
    : cx - (numW + 3 + unitW) / 2
  ctx.letterSpacing = '0em'
  ctx.textAlign = 'left'
  ctx.font = `700 ${spec.caloriesSize}px ${family}`
  ctx.fillText(kcalNum, startX, y)
  ctx.font = `500 ${spec.macroSize}px ${family}`
  ctx.letterSpacing = '0.12em'
  ctx.fillText('KCAL', startX + numW + 3, y)
  ctx.letterSpacing = '0em'
  ctx.textAlign = 'center'
  y += afterCalories

  // --- macros -----------------------------------------------------------------------------------
  y += spec.macroSize
  ctx.font = `500 ${spec.macroSize}px ${family}`
  ctx.letterSpacing = '0.06em'
  ctx.fillText(`P ${figures.proteinG}   C ${figures.carbsG}   F ${figures.fatG}`, cx, y)
  ctx.letterSpacing = '0em'
  y += afterMacros

  // --- rule + ingredients -----------------------------------------------------------------------
  ctx.strokeStyle = INK
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.moveTo(cx - colWidth / 2 + 14, y)
  ctx.lineTo(cx + colWidth / 2 - 14, y)
  ctx.stroke()
  y += afterRule

  // The run wraps INLINE rather than stacking one ingredient per line (Q-397). That spends width,
  // which the label has going spare, instead of height, which the code needs — five ingredients
  // become three wrapped lines rather than five, and the height handed back is what lets a round
  // label carry the complete list AND a bigger code than the previous default.
  //
  // The character budget is measured from the real font at the real size, then handed to a pure
  // function; the renderer is the only thing that knows the font, and the wrapping is the part worth
  // testing.
  ctx.font = `400 ${listSize}px ${family}`
  for (const line of run.lines) {
    ctx.fillText(line, cx, y)
    y += lineH
  }
  if (ingredients.length === 0) {
    ctx.font = `400 7px ${family}`
    ctx.fillText('Scan for the ingredient breakdown', cx, y)
  }
  const shown = run.shown
  const overflow = run.overflow

  // --- code, bottom-anchored above the write-on rule ---------------------------------------------
  // Anchored from the BOTTOM rather than flowed from `y`: a meal with two ingredients and one with
  // six must put the code in the same place, or every label in a batch sits differently.
  drawCode(ctx, qr, cx - code / 2, codeTop, code, INK, PAPER)

  if (spec.writeOnLine) {
    const lineY = bottom - 2
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(cx - colWidth / 2 + 20, lineY)
    ctx.lineTo(cx + colWidth / 2 - 20, lineY)
    ctx.stroke()
  }

  return { ingredientLines: shown, ingredientOverflow: overflow }
}

/**
 * The share layout (BF-57): a name, a full-size code, and a line telling the finder what to do with
 * it.
 *
 * **Everything this style omits is inside the code**, which is what makes the omission a trade
 * rather than a loss: calories, macros and every ingredient travel in the payload and appear the
 * moment it is scanned. What it gives up is what a person can read off the paper without a phone —
 * which is the right thing to give up on a label whose purpose is to be handed to someone.
 *
 * It is the only style that reaches version 11, and that is the entire reason it exists. See the
 * `share` entry in `SPECS` for the arithmetic; the short version is that 0.49 mm per module at 69
 * modules across needs 33.8 mm, and no layout carrying a calorie block has 33.8 mm to give.
 */
function drawShareLabel(
  ctx: CanvasRenderingContext2D,
  { spec, family, figures, qr, INK, PAPER, rolled }: {
    spec: StyleSpec
    family: string
    figures: MealLabelFigures
    qr: { modules: { size: number; data: ArrayLike<number> } }
    INK: string
    PAPER: string
    /** Ingredients the code folded into its one exact remainder entry. */
    rolled: number
  },
): void {
  const cx = SHEET / 2
  let y = SQUARE_MARGIN + 4

  const name = spec.uppercaseName ? figures.name.toUpperCase() : figures.name
  const nameSize = fitText(ctx, name, family, '700', spec.nameSize, SQUARE_W)
  ctx.fillStyle = INK
  ctx.textAlign = 'center'
  ctx.font = `700 ${nameSize}px ${family}`
  ctx.letterSpacing = `${spec.nameTracking}em`
  ctx.fillText(name, cx, y + nameSize)
  ctx.letterSpacing = '0em'
  y += nameSize + 8

  drawCode(ctx, qr, cx - spec.codeUnits / 2, y, spec.codeUnits, INK, PAPER)
  y += spec.codeUnits + 7

  // Not decoration. A label with no calories on it and no explanation is a mystery sticker; this is
  // the one line that says the code is the meal rather than a link to a shop.
  //
  // **And when the recipe did not fit, it says so here** (BF-57 item 2). A 20-ingredient meal is
  // rolled into named entries plus one exact remainder, so the copy the scanner receives has right
  // numbers and fewer rows — true, but a surprise if they find out by counting. `fitText` rather
  // than a fixed size because the sentence grows with the count and the slack below the code is
  // 5 units, not a margin to gamble with.
  const caption = rolled > 0
    ? `Scan to add this meal · ${rolled} ingredient${rolled === 1 ? '' : 's'} grouped`
    : 'Scan to add this meal'
  ctx.font = `400 ${fitText(ctx, caption, family, '400', spec.macroSize, SQUARE_W)}px ${family}`
  ctx.fillText(caption, cx, y)
}

export interface RenderMealLabelOptions {
  /**
   * The meal itself, not its id (BF-57).
   *
   * The code used to carry `encodeMealLabelToken(meal.id)` — 22 characters that resolve only inside
   * the account that printed them, so a label handed to anyone else scanned as *"that saved meal no
   * longer exists"*. It now carries `encodeSharedMeal`, which is the whole recipe, so the renderer
   * needs the recipe.
   */
  meal: SavedMeal
  figures: MealLabelFigures
  style: MealLabelStyle
  /**
   * Per-serving ingredient breakdown (Q-393). Only the square style prints it — the round layouts
   * have 7 units of slack, which is zero lines. Same basis as `figures`: both come through
   * `oneServingItems`, so "200 g mince" is the amount in the calories printed beside it.
   */
  ingredients?: { name: string; weightG: number }[]
  /** Sheet pixels per design unit. Defaults to `DEFAULT_RENDER_SCALE` — 6.24 ≈ 1,179 px ≈ 50 mm at 600 dpi. */
  scale?: number
}

export interface RenderedMealLabel {
  moduleCount: number
  codeMm: number
  ingredientLines: number
  ingredientOverflow: number
  /** True when the code holds the meal itself rather than a private id (BF-57). */
  carriesRecipe: boolean
  /** Ingredients named individually inside the code. Meaningless when `carriesRecipe` is false. */
  namedInCode: number
  /** Ingredients folded into the code's single exact remainder entry. 0 when the recipe fits whole. */
  rolledInCode: number
  payloadBytes: number
}

/**
 * Draw the label onto `canvas`. Returns the QR's module count, which is what the print-size maths
 * in Q-389 is expressed against — the caller surfaces it so the physical pitch is visible rather
 * than assumed — plus how much of the recipe the code names outright (BF-57).
 */
export async function renderMealLabel(
  canvas: HTMLCanvasElement,
  { meal, figures, style, ingredients, scale = DEFAULT_RENDER_SCALE }: RenderMealLabelOptions,
): Promise<RenderedMealLabel> {
  const spec = SPECS[style]

  // Level M, not L: ink spread on a home printer is the expected failure and M is the level that
  // survives it. `mealLabelShareBudget` picks the payload budget from THIS style's printed geometry
  // at the same level, so the version the encoder aims at and the version drawn agree.
  const budget = mealLabelShareBudget(style)
  const shared = mealLabelCarriesRecipe(style)
    ? encodeSharedMeal(meal, { maxBytes: budget.maxBytes })
    // The private bookmark, unchanged since Q-389, and still the right payload for a jar in your own
    // kitchen: 22 characters is version 2, which is what lets these layouts print the finest codes
    // in the feature while also carrying the ingredient list. It resolves only inside the account
    // that printed it — see `mealLabelCarriesRecipe` for why that is a choice and not a gap.
    : { text: encodeMealLabelToken(meal.id), bytes: MEAL_LABEL_TOKEN_LENGTH, named: 0, rolled: 0 }
  const qr = QRCode.create(shared.text, { errorCorrectionLevel: 'M' })
  const moduleCount = qr.modules.size
  // The library decides the version actually drawn and it wins, exactly as the capacity table's own
  // note says — so the reported pitch is measured off the symbol, never off the budget.
  const code = {
    carriesRecipe: mealLabelCarriesRecipe(style),
    namedInCode: shared.named, rolledInCode: shared.rolled, payloadBytes: shared.bytes,
  }

  // Without this the first draw uses a fallback face and the layout reflows on the second — the
  // exact silent substitution the spec warns about.
  if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready

  const px = SHEET * scale
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.scale(scale, scale)

  const family = resolveFamily(spec)
  const INK = '#000000'
  const PAPER = '#ffffff'

  // Ink on paper, always — never a theme token. A label is printed, often greyscale, and must be
  // legible with no colour at all, so this is the one surface in the app that deliberately does not
  // use `--accent-*`. Do not "fix" this to theme-aware.
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, SHEET, SHEET)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  const cx = SHEET / 2

  if (spec.layout === 'code') {
    drawShareLabel(ctx, { spec, family, figures, qr, INK, PAPER, rolled: shared.rolled })
    return { moduleCount, codeMm: (spec.codeUnits / SHEET) * 50, ingredientLines: 0, ingredientOverflow: 0, ...code }
  }

  if (spec.ingredients) {
    const codeMm = (spec.codeUnits / SHEET) * 50
    const args = { spec, family, figures, ingredients: ingredients ?? [], qr, INK, PAPER }
    const drawn = spec.layout === 'stack' ? drawSquareCentredLabel(ctx, args) : drawSquareLabel(ctx, args)
    return { moduleCount, codeMm, ...drawn, ...code }
  }

  const top = (SHEET - USABLE_H) / 2
  const maxW = USABLE_W

  let y = top + 14

  // --- name -----------------------------------------------------------------------------------
  const name = spec.uppercaseName ? figures.name.toUpperCase() : figures.name
  const nameSize = fitText(ctx, name, family, '700', spec.nameSize, maxW - (spec.reversedHeader ? 12 : 0))
  if (spec.reversedHeader) {
    const bandH = nameSize + 9
    ctx.fillStyle = INK
    ctx.fillRect(cx - USABLE_W / 2, y - nameSize - 2, USABLE_W, bandH)
    ctx.fillStyle = PAPER
  } else {
    ctx.fillStyle = INK
  }
  ctx.font = `700 ${nameSize}px ${family}`
  if (spec.nameTracking) ctx.letterSpacing = `${spec.nameTracking}em`
  ctx.fillText(name, cx, y)
  ctx.letterSpacing = '0em'
  y += spec.reversedHeader ? 11 : 8

  // --- calories -------------------------------------------------------------------------------
  ctx.fillStyle = INK
  y += spec.caloriesSize
  ctx.font = `700 ${spec.caloriesSize}px ${family}`
  ctx.fillText(String(figures.calories), cx, y)
  ctx.font = `400 ${spec.macroSize}px ${family}`
  ctx.letterSpacing = '0.14em'
  ctx.fillText('KCAL', cx, y + spec.macroSize + 2)
  ctx.letterSpacing = '0em'
  y += spec.macroSize + 7

  // --- macros ---------------------------------------------------------------------------------
  y += spec.macroSize + 4
  ctx.font = `500 ${spec.macroSize}px ${family}`
  ctx.letterSpacing = '0.06em'
  ctx.fillText(`P ${figures.proteinG}   C ${figures.carbsG}   F ${figures.fatG}`, cx, y)
  ctx.letterSpacing = '0em'
  y += 6

  // --- rule -----------------------------------------------------------------------------------
  if (spec.rule === 'solid' || spec.rule === 'dashed') {
    ctx.strokeStyle = INK
    ctx.lineWidth = spec.rule === 'dashed' ? 0.6 : 0.5
    if (spec.rule === 'dashed') ctx.setLineDash([2, 2])
    ctx.beginPath()
    ctx.moveTo(cx - USABLE_W / 2, y)
    ctx.lineTo(cx + USABLE_W / 2, y)
    ctx.stroke()
    ctx.setLineDash([])
    y += 7
  } else if (spec.rule === 'ring') {
    // Plaque's double frame. It was two concentric CIRCLES until Q-411, which was coherent while the
    // inscribed circle was the binding constraint and is not on a square canvas — and worse, it
    // broke: with the code grown to 85 units the outer circle passed straight through the code's
    // bottom edge (crossing at x ± 22.8 against a code spanning ± 42.5), and the E2E's decode of the
    // rendered label failed on plaque alone. Two inset rounded rectangles frame the same way, clear
    // the content by construction, and match the shape the label now is.
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.6
    for (const inset of [5, 8]) {
      ctx.beginPath()
      ctx.roundRect(inset, inset, SHEET - inset * 2, SHEET - inset * 2, 6)
      ctx.stroke()
    }
    y += 3
  }

  // --- code -----------------------------------------------------------------------------------
  // The quiet zone is drawn, not assumed: the spec is 4 modules of clear white on every side, and a
  // code butted against artwork is a code that will not scan. `drawCode` owns both that and the
  // device-pixel snapping — this block used to be a byte-identical copy of it (Q-399).
  const codeW = spec.codeUnits
  const codeX = cx - codeW / 2
  const bottomBlock = spec.writeOnLine ? codeW + 12 : codeW
  const codeY = top + USABLE_H - bottomBlock
  drawCode(ctx, qr, codeX, codeY, codeW, INK, PAPER)

  // --- write-on line ---------------------------------------------------------------------------
  // A bare rule, no "MADE" label beside it (owner, 2026-08-17). Plaque has none, which is what buys
  // plaque the largest code.
  if (spec.writeOnLine) {
    const lineY = top + USABLE_H - 3
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(cx - USABLE_W / 2 + 10, lineY)
    ctx.lineTo(cx + USABLE_W / 2 - 10, lineY)
    ctx.stroke()
  }

  const codeMm = (codeW / SHEET) * 50
  // The round layouts print no list — the box has 7 units of slack, which is zero lines. Reported as
  // 0 rather than omitted so the caller never has to know which style it asked for.
  return { moduleCount, codeMm, ingredientLines: 0, ingredientOverflow: 0, ...code }
}
