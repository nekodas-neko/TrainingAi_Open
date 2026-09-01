import QRCode from 'qrcode'
import {
  encodeMealLabelToken, encodeSharedMeal, fitIngredientLines, wrapIngredientRun,
  MEAL_LABEL_TOKEN_LENGTH,
  type MealLabelFigures,
} from '@trainingai/shared/nutrition/label-payload'
import type { SavedMeal } from '@trainingai/shared/types/nutrition'
import {
  SPECS, mealLabelCarriesRecipe, mealLabelShareBudget, centredStackOffset,
  SHEET, SQUARE_MARGIN, SQUARE_W, USABLE_W, USABLE_H, STACK_LINE_H, DEFAULT_RENDER_SCALE,
  type StyleSpec, type MealLabelStyle,
} from './meal-label-geometry'

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
