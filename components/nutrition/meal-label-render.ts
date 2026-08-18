import QRCode from 'qrcode'
import { encodeMealLabelToken, type MealLabelFigures } from '@trainingai/shared/nutrition/label-payload'

/**
 * Draws a saved meal's printable 50 × 50 mm label (Q-389).
 *
 * **Canvas, not SVG → PNG, and that is load-bearing.** Fonts referenced inside an SVG that is then
 * loaded as an `<img>` do not resolve — the browser rasterises it in an isolated context with no
 * access to document fonts, so every style would silently fall back and the layout has no slack to
 * absorb the metric change. Drawing with `ctx.fillText` uses the real document faces, which is what
 * makes the `next/font` self-hosting in `app/layout.tsx` actually do anything.
 *
 * **The die rotates between square and circular, so the inscribed circle is the binding
 * constraint** — the corners are unusable and everything is composed centred. All geometry below is
 * expressed against a 189 × 189 unit sheet with a centred 130 × 137 usable box, then scaled.
 */

/** The sheet is 50 mm; these are its design units, not pixels. */
const SHEET = 189
/** Centred usable box — what fits inside the inscribed circle once the corners are given up. */
const USABLE_W = 130
const USABLE_H = 137

export type MealLabelStyle = 'band' | 'editorial' | 'ticket' | 'plaque' | 'square'

export const MEAL_LABEL_STYLES: { value: MealLabelStyle; label: string; note: string; squareOnly?: boolean }[] = [
  { value: 'band', label: 'Black band', note: 'Reversed header. The default — and the tightest code.' },
  { value: 'editorial', label: 'Editorial', note: 'The quietest of the four.' },
  { value: 'ticket', label: 'Deli ticket', note: 'Monospaced, dashed rules.' },
  { value: 'plaque', label: 'Plaque', note: 'Double ring, no write-on line — the largest code.' },
  // Q-393. Square-only, and the picker says so: this artwork uses the corners, so a round die crops
  // the ingredient list. That is the trade the owner accepted to get the breakdown printed.
  { value: 'square', label: 'Square · ingredients', note: 'Full ingredient list. SQUARE dies only — a round die crops it. Largest, most scannable code.', squareOnly: true },
]

export const DEFAULT_MEAL_LABEL_STYLE: MealLabelStyle = 'band'

/**
 * Per-style geometry. `codeUnits` is the code's drawn width in sheet units; at 50 mm a unit is
 * 50/189 mm, so band's 46 units is 12.2 mm — the tightest, which is why it is the one to test-print
 * first. `writeOnLine` is a bare rule the owner writes the date on: no label beside it, and plaque
 * carries none at all, which is what buys plaque the largest code.
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
  /** Uses the corners — only safe on a square die, and the picker must say so. */
  squareOnly?: boolean
  /** Print the per-serving ingredient breakdown (Q-393). Needs the corners; square only. */
  ingredients?: boolean
}

const SPECS: Record<MealLabelStyle, StyleSpec> = {
  band: {
    fontVar: '--font-archivo', fallback: 'sans-serif', codeUnits: 46, writeOnLine: true,
    reversedHeader: true, rule: 'solid', nameSize: 11, caloriesSize: 25, macroSize: 8.5,
    nameTracking: 0.06, uppercaseName: true,
  },
  editorial: {
    fontVar: '--font-geist-sans', fallback: 'sans-serif', codeUnits: 50, writeOnLine: true,
    reversedHeader: false, rule: 'solid', nameSize: 12, caloriesSize: 26, macroSize: 8.5,
    nameTracking: 0, uppercaseName: false,
  },
  ticket: {
    fontVar: '--font-geist-mono', fallback: 'monospace', codeUnits: 52, writeOnLine: true,
    reversedHeader: false, rule: 'dashed', nameSize: 10.5, caloriesSize: 24, macroSize: 8,
    nameTracking: 0.04, uppercaseName: true,
  },
  plaque: {
    fontVar: '--font-instrument-serif', fallback: 'serif', codeUnits: 60, writeOnLine: false,
    reversedHeader: false, rule: 'ring', nameSize: 13, caloriesSize: 27, macroSize: 8.5,
    nameTracking: 0.02, uppercaseName: false,
  },
  // codeUnits 70 is chosen from the TRUE pitch, not the documented one: the quiet zone is drawn
  // inside this box, so a 25-module symbol occupies 70/33 units per module = 0.56 mm. Every round
  // style is between 0.37 and 0.48 mm by the same measure, so this is the most scannable code the
  // feature has — which is the point of spending the corners.
  square: {
    fontVar: '--font-geist-sans', fallback: 'sans-serif', codeUnits: 70, writeOnLine: true,
    reversedHeader: true, rule: 'solid', nameSize: 12, caloriesSize: 24, macroSize: 8,
    nameTracking: 0.04, uppercaseName: true, squareOnly: true, ingredients: true,
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


/** Square usable box — the corners a round die would crop, which is what pays for the list. */
const SQUARE_MARGIN = 9
const SQUARE_W = SHEET - SQUARE_MARGIN * 2   // 171

/** Draw the code's modules into a box, quiet zone included inside it. */
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

  const MAX_LINES = 5
  const lineH = 9
  const shown = ingredients.slice(0, MAX_LINES)
  ctx.fillStyle = INK
  ctx.textAlign = 'left'
  for (const ing of shown) {
    const text = `${Math.round(ing.weightG)}g ${ing.name}`
    const size = fitText(ctx, text, family, '400', 7.5, SQUARE_W)
    ctx.font = `400 ${size}px ${family}`
    ctx.fillText(text, L, y)
    y += lineH
  }
  if (ingredients.length > MAX_LINES) {
    ctx.font = `400 7px ${family}`
    ctx.fillText(`+${ingredients.length - MAX_LINES} more — scan for the full list`, L, y)
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
  return { ingredientLines: shown.length, ingredientOverflow: Math.max(0, ingredients.length - MAX_LINES) }
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
  /** Sheet pixels per design unit. 3.12 ≈ 590 px ≈ 50 mm at 300 dpi. */
  scale?: number
}

/**
 * Draw the label onto `canvas`. Returns the QR's module count, which is what the print-size maths
 * in Q-389 is expressed against — the caller surfaces it so the physical pitch is visible rather
 * than assumed.
 */
export async function renderMealLabel(
  canvas: HTMLCanvasElement,
  { mealId, figures, style, ingredients, scale = 3.12 }: RenderMealLabelOptions,
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
    const drawn = drawSquareLabel(ctx, { spec, family, figures, ingredients: ingredients ?? [], qr, INK, PAPER })
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
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.6
    for (const r of [SHEET / 2 - 6, SHEET / 2 - 9]) {
      ctx.beginPath()
      ctx.arc(cx, SHEET / 2, r, 0, Math.PI * 2)
      ctx.stroke()
    }
    y += 3
  }

  // --- code -----------------------------------------------------------------------------------
  // The quiet zone is drawn, not assumed: the spec is 4 modules of clear white on every side, and a
  // code butted against artwork is a code that will not scan.
  const codeW = spec.codeUnits
  const quiet = 4
  const cell = codeW / (moduleCount + quiet * 2)
  const codeX = cx - codeW / 2
  const bottomBlock = spec.writeOnLine ? codeW + 12 : codeW
  const codeY = top + USABLE_H - bottomBlock

  ctx.fillStyle = PAPER
  ctx.fillRect(codeX, codeY, codeW, codeW)
  ctx.fillStyle = INK
  const data = qr.modules.data
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (data[r * moduleCount + c]) {
        ctx.fillRect(
          codeX + (c + quiet) * cell,
          codeY + (r + quiet) * cell,
          // +0.04 closes the hairline seams antialiasing leaves between adjacent modules, which read
          // as a lighter code and cost scan margin the design does not have.
          cell + 0.04,
          cell + 0.04,
        )
      }
    }
  }

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
