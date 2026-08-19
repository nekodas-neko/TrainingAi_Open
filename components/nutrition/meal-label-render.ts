import QRCode from 'qrcode'
import { encodeMealLabelToken, fitIngredientLines, wrapIngredientRun, type MealLabelFigures } from '@trainingai/shared/nutrition/label-payload'

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

export type MealLabelStyle = 'inlineCentred' | 'band' | 'editorial' | 'ticket' | 'plaque' | 'square'

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
  { value: 'square', label: 'Big code', note: 'The code sits beside the calories rather than under them, which makes it the largest of the six.' },
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
export function mealLabelCodeMetrics(style: MealLabelStyle): {
  boxMm: number; symbolMm: number; mmPerModule: number
} {
  const MODULES = 25          // a 22-char token is always QR version 2
  const QUIET = 4
  const boxMm = (SPECS[style].codeUnits / SHEET) * 50
  const mmPerModule = boxMm / (MODULES + QUIET * 2)
  return { boxMm, symbolMm: mmPerModule * MODULES, mmPerModule }
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
  layout?: 'beside' | 'stack'
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
  // codeUnits 70 is chosen from the TRUE pitch, not the documented one: the quiet zone is drawn
  // inside this box, so a 25-module symbol occupies 70/33 units per module = 0.56 mm. Every round
  // style is between 0.37 and 0.48 mm by the same measure, so this is the most scannable code the
  // feature has — which is the point of spending the corners.
  square: {
    fontVar: '--font-geist-sans', fallback: 'sans-serif', codeUnits: 90, writeOnLine: true,
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
 * `scale` is the canvas scale, and it is here because the module grid is FRACTIONAL in device
 * pixels for every style that ships — `box × scale / 33` is 4.35 px per module for `band`, 6.24 for
 * the old default, none of them whole. Every module edge therefore lands mid-pixel and antialiases
 * to grey; the `+0.04` bleed below papers over the resulting seams rather than removing them. That
 * is tolerable when a module is 6 px and marginal when it is 4.7: at 0.401 mm per module the same
 * label decoded on one run of `e2e/meal-label.spec.ts` and not the next. Raising the canvas scale
 * is what fixed it here — see `DEFAULT_RENDER_SCALE`. Snapping the grid to whole device pixels is
 * the better fix and is **Q-358**, deliberately not done in the same change because it shrinks the
 * drawn box and every reported figure with it.
 */
function drawCode(
  ctx: CanvasRenderingContext2D,
  qr: { modules: { size: number; data: ArrayLike<number> } },
  x: number, y: number, box: number, ink: string, paper: string,
) {
  const n = qr.modules.size
  const quiet = 4
  const cell = box / (n + quiet * 2)
  ctx.fillStyle = paper
  ctx.fillRect(x, y, box, box)
  ctx.fillStyle = ink
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.data[r * n + c]) {
        // +0.04 closes the hairline antialiasing seams between adjacent modules, which read as a
        // lighter code and cost scan margin.
        ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell + 0.04, cell + 0.04)
      }
    }
  }

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

  let y = L + 4

  // --- name -------------------------------------------------------------------------------------
  const name = spec.uppercaseName ? figures.name.toUpperCase() : figures.name
  const nameSize = fitText(ctx, name, family, '700', spec.nameSize, colWidth)
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
  const startX = cx - (numW + 3 + unitW) / 2
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
  const listSize = 7
  ctx.font = `400 ${listSize}px ${family}`
  const colW = colWidth
  const charW = ctx.measureText('0123456789abcdefghij').width / 20
  const charsPerLine = Math.max(8, Math.floor(colW / charW))

  const code = spec.codeUnits
  const codeTop = bottom - (spec.writeOnLine ? 9 : 0) - code
  const lineH = STACK_LINE_H
  const maxLines = Math.max(0, Math.floor((codeTop - y - 2) / lineH))

  const run = wrapIngredientRun({ items: ingredients, charsPerLine, maxLines })
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

export interface RenderMealLabelOptions {
  mealId: string
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

/**
 * Draw the label onto `canvas`. Returns the QR's module count, which is what the print-size maths
 * in Q-389 is expressed against — the caller surfaces it so the physical pitch is visible rather
 * than assumed.
 */
export async function renderMealLabel(
  canvas: HTMLCanvasElement,
  { mealId, figures, style, ingredients, scale = DEFAULT_RENDER_SCALE }: RenderMealLabelOptions,
): Promise<{ moduleCount: number; codeMm: number; ingredientLines: number; ingredientOverflow: number }> {
  const spec = SPECS[style]

  // Level M, not L: the code is 12.2–16.4 mm on these layouts, so ink spread on a home printer is
  // the expected failure and M is the level that survives it. The 22-character token still fits
  // version 2 (25×25) at M — anything longer would not.
  const qr = QRCode.create(encodeMealLabelToken(mealId), { errorCorrectionLevel: 'M' })
  const moduleCount = qr.modules.size

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

  if (spec.ingredients) {
    const codeMm = (spec.codeUnits / SHEET) * 50
    const args = { spec, family, figures, ingredients: ingredients ?? [], qr, INK, PAPER }
    const drawn = spec.layout === 'stack' ? drawSquareCentredLabel(ctx, args) : drawSquareLabel(ctx, args)
    return { moduleCount, codeMm, ...drawn }
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
  return { moduleCount, codeMm, ingredientLines: 0, ingredientOverflow: 0 }
}
