import type { SavedMeal } from '../types/nutrition'
import { oneServingItems } from './saved-meal-ingredients'

/**
 * What a printed saved-meal label encodes, and what its figures say (Q-389).
 *
 * **The payload is the meal id and nothing else, and that is a hard constraint rather than a
 * preference.** A QR at version 1 (21×21 modules) holds 17 bytes in byte mode; a canonical UUID is
 * 36 characters and its bare hex is 32, so neither fits. Base64url of the 16 raw bytes is 22
 * characters, which is the only form that fits version 2 (25×25) at error-correction level **M** —
 * and M is the level that survives ink spread on a home printer.
 *
 * The label is 50 mm and the circle-safe layouts put the code at 12.2–16.4 mm, i.e. roughly
 * 0.49–0.66 mm per module at 25×25. Anything added to this payload pushes it to version 3 (29×29)
 * and the pitch below 0.45 mm, which is why there is no prefix, no URL and no version tag here.
 * Namespacing lives in the decoder instead — see `decodeMealLabelToken`.
 */

/** Length of a base64url-encoded 16-byte UUID. */
export const MEAL_LABEL_TOKEN_LENGTH = 22

/** Byte capacity of a version-2 QR at EC level M — the budget this payload must stay inside. */
export const QR_V2_M_BYTE_CAPACITY = 26

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BASE64URL_RE = /^[A-Za-z0-9_-]{22}$/

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  // btoa exists in the WebView and in node ≥16, which is every runtime this ships to.
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlToBytes(s: string): Uint8Array | null {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '=='
  let bin: string
  try {
    bin = atob(b64)
  } catch {
    return null
  }
  if (bin.length !== 16) return null
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** A saved-meal id as the 22-character token a label carries. */
export function encodeMealLabelToken(mealId: string): string {
  if (!UUID_RE.test(mealId)) throw new Error(`not a uuid: ${mealId}`)
  const hex = mealId.replace(/-/g, '')
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytesToBase64url(bytes)
}

/**
 * A scanned string back to a saved-meal id, or `null` if it is not one.
 *
 * **Recognition is by shape, not by a prefix** — the payload cannot afford one (see the module
 * comment). A 22-character base64url string decoding to exactly 16 bytes is a meal id; an EAN-13 is
 * 13 digits and cannot collide, and nothing else the scanner returns is this shape. Returning
 * `null` rather than throwing keeps the scan handler's fall-through to the barcode lookup simple.
 */
export function decodeMealLabelToken(scanned: string): string | null {
  if (!BASE64URL_RE.test(scanned)) return null
  const bytes = base64urlToBytes(scanned)
  if (!bytes) return null
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export interface MealLabelFigures {
  name: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

/**
 * The figures a label prints — **per serving, not per recipe.**
 *
 * `SavedMeal.totals` is the WHOLE recipe (its own type comment says so), while scanning the label
 * logs one serving, because `logMealItems` iterates `oneServingItems`. A renderer reading `totals`
 * directly would therefore print 624 kcal on a tub whose code logs 312 — the two halves of one
 * feature disagreeing on a physical object stuck to real food, and silently, since the owner
 * removed the per-serving line that would have made it visible.
 *
 * Deriving both from `servings` in one place is what stops that drifting apart.
 */
export function mealLabelFigures(meal: SavedMeal): MealLabelFigures {
  const servings = Number(meal.servings)
  const divisor = servings > 0 ? servings : 1
  return {
    name: meal.name,
    calories: Math.round(meal.totals.calories / divisor),
    proteinG: Math.round(meal.totals.proteinG / divisor),
    carbsG: Math.round(meal.totals.carbsG / divisor),
    fatG: Math.round(meal.totals.fatG / divisor),
  }
}

/**
 * The same figures derived the long way — by summing what `logMealItems` would actually log.
 *
 * Only used by the test that asserts the two agree. It exists so that the assertion compares the
 * label against the *write path* rather than against a second copy of the same arithmetic, which
 * would pass even if both were wrong.
 */
export function mealLabelFiguresFromItems(meal: SavedMeal): Omit<MealLabelFigures, 'name'> {
  let calories = 0, proteinG = 0, carbsG = 0, fatG = 0
  for (const item of oneServingItems(meal)) {
    const q = item.quantityMultiplier
    calories += item.foodItem.calories * q
    proteinG += item.foodItem.proteinG * q
    carbsG += item.foodItem.carbsG * q
    fatG += item.foodItem.fatG * q
  }
  return {
    calories: Math.round(calories),
    proteinG: Math.round(proteinG),
    carbsG: Math.round(carbsG),
    fatG: Math.round(fatG),
  }
}

/**
 * How many ingredient lines fit above a bottom-anchored code, and how many are left over.
 *
 * Pure, and tested, because the failure it prevents is invisible: the code paints a white quiet-zone
 * box before its modules, so a list that overruns is **drawn over** rather than colliding visibly.
 * The code still scans and still decodes to the right meal — an end-to-end check cannot see it at
 * all. What breaks is the label silently claiming to list five ingredients while showing two.
 *
 * `overflow > 0` costs a line of its own for the "+N more" summary, which has to come out of the
 * same room rather than being added after it.
 */
export function fitIngredientLines(
  { room, lineHeight, count }: { room: number; lineHeight: number; count: number },
): { shown: number; overflow: number } {
  if (count <= 0) return { shown: 0, overflow: 0 }
  const capacity = Math.max(0, Math.floor(room / lineHeight))
  if (count <= capacity) return { shown: count, overflow: 0 }
  // When the room holds a single line and there is more than one ingredient, that line goes to the
  // summary and NOTHING is listed. Flooring `shown` at 1 instead — the first draft did — draws an
  // ingredient *and* a summary into a one-line gap, which is the overrun this function exists to
  // prevent. Caught by the property test, not by eye.
  const shown = Math.max(0, capacity - 1)
  return { shown, overflow: count - shown }
}

/**
 * The ingredient run as wrapped lines — `200g Beef mince, 150g pasta, 100g passata` — with `+N more`
 * when it will not fit (Q-397).
 *
 * **Inline, not one line per ingredient, and that is the whole design.** A stacked list spends
 * *height*, which on a 50 mm label is the one thing the code also needs; a wrapping run spends
 * *width*, which is otherwise wasted. Five ingredients become two or three wrapped lines rather than
 * five stacked ones, and the height handed back goes to the code — which is how the complete list
 * fits a **round** label with a bigger code than the stacked version could manage.
 *
 * Measuring by character count rather than by `ctx.measureText` keeps this pure and testable. The
 * caller passes the characters that fit its column at its type size; the renderer is the only place
 * that knows the font.
 */
export function wrapIngredientRun(
  { items, charsPerLine, maxLines }: {
    items: { name: string; weightG: number }[]
    charsPerLine: number
    maxLines: number
  },
): { lines: string[]; shown: number; overflow: number } {
  if (items.length === 0 || maxLines <= 0 || charsPerLine <= 0) {
    return { lines: [], shown: 0, overflow: items.length }
  }
  const label = (i: { name: string; weightG: number }) => `${Math.round(i.weightG)}g ${i.name}`

  // Try the whole list first, then give back one ingredient at a time until what is left — plus its
  // "+N more" tail — fits the line budget. Dropping from the end keeps the order the meal was built
  // in, which is the order the owner reads it in.
  for (let take = items.length; take >= 1; take--) {
    const rest = items.length - take
    const text = items.slice(0, take).map(label).join(', ') + (rest > 0 ? `, +${rest} more` : '')
    const lines = wrapByChars(text, charsPerLine)
    if (lines.length <= maxLines) return { lines, shown: take, overflow: rest }
  }
  // Not even one ingredient fits: say how many there are rather than printing a partial name.
  return { lines: [`${items.length} ingredients — scan`], shown: 0, overflow: items.length }
}

/** Greedy word wrap on a character budget. */
function wrapByChars(text: string, charsPerLine: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (next.length <= charsPerLine) { line = next; continue }
    if (line) lines.push(line)
    line = w
  }
  if (line) lines.push(line)
  return lines
}
