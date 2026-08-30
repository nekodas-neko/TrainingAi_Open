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

// ─────────────────────────────────────────────────────────────────────────────
// BF-57 — the self-contained label: the whole meal in the QR, not a pointer to it
// ─────────────────────────────────────────────────────────────────────────────
//
// The token above is a **private bookmark**. It carries a `saved_meals.id`, and the scan path
// resolves that against the SCANNING user's own meals — local store first, then
// `GET /api/nutrition/saved-meals`, which returns only their rows. Another person's id is never in
// that list, so a shared label fell to *"That saved meal no longer exists"*: wrong twice over, since
// the meal exists and the real answer is "not yours".
//
// **Making ids globally resolvable was rejected outright.** It would turn a photograph of a label
// into read access to someone's meal — name, ingredients, macros — on an app heading for a Play
// Store health-data declaration, and it couples two users' data so that the author editing theirs
// reaches into everyone else's history.
//
// The owner chose the opposite: put the meal in the code. No round-trip, so it scans offline and for
// a user with no account; no privacy surface, because the data is on paper physically handed over;
// and it is inherently a COPY, so nothing stays coupled. What it costs is that a printed label
// cannot be updated — already true — and that the ingredient list has a cap.

/**
 * Byte-mode capacity per QR version at error-correction level **M**, indexed by version.
 *
 * From the QR spec, not from the `qrcode` package: `packages/shared` stays dependency-free, and the
 * renderer is the only place that should import a QR library. The two are checked against each other
 * in `__tests__/label-payload.test.ts` — this table decides the payload BUDGET while the library
 * decides the version actually drawn, and if they ever disagree the library wins and the code merely
 * comes out bigger, which is safe rather than wrong.
 *
 * Index 0 is unused so the index is the version. `QR_V2_M_BYTE_CAPACITY` above is this table's [2].
 */
export const QR_BYTE_CAPACITY_M: readonly number[] = [
  0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213,
  251, 287, 331, 362, 412, 450, 504, 560, 624, 666,
]

/** The smallest version at EC M that holds `bytes`, or null past version 20. */
export function qrVersionForBytes(bytes: number): number | null {
  for (let v = 1; v < QR_BYTE_CAPACITY_M.length; v++) {
    if (bytes <= QR_BYTE_CAPACITY_M[v]) return v
  }
  return null
}

/** Modules per side for a QR version — 21 at v1, +4 per version. */
export function qrModulesForVersion(version: number): number {
  return 17 + 4 * version
}

/**
 * The payload budget: **version 11 at EC M**.
 *
 * The binding constraint is the LABEL, not the format. What decides whether a phone reads a code is
 * millimetres per module, and the current circle-safe layout gives the code 12.2–16.4 mm — at which
 * a 3-ingredient meal (167 bytes, version 9, 53 modules) lands at **0.31 mm/module**, below the
 * 0.49–0.66 mm this design was built to and too fine for a home printer.
 *
 * Given the code ~30 mm of the 50 mm label, version 11 (61 modules) is **0.49 mm/module** — the
 * bottom of that range, and the largest version that stays inside it. Version 12 is 0.46 and falls
 * out. So 251 bytes is where the payload has to give way, which is what the roll-up below is for.
 *
 * **Growing the code on the label is Lane B's half and is the half that matters** — this constant is
 * only meaningful once the layout hands the code that space.
 */
export const MEAL_SHARE_MAX_BYTES = QR_BYTE_CAPACITY_M[11]

/** Wire format version, first element of the array. Two bytes (`1,`), and worth them: without it a
 *  later format change is mis-parsed by an old decoder rather than refused. */
export const MEAL_SHARE_FORMAT = 1

export interface SharedMealIngredient {
  name: string
  /** Grams of this ingredient in the WHOLE recipe, not per serving. */
  weightG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface SharedMeal {
  name: string
  /** How many portions the ingredient list makes. Carried so a copy is the batch, not one plate. */
  servings: number
  ingredients: SharedMealIngredient[]
  /** How many ingredients the last entry stands in for. 0 when the list is complete. */
  rolled: number
}

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length
const r1 = (v: number) => Math.round(v * 10) / 10

/** The whole recipe as shareable ingredients, before any budget is applied. */
function recipeIngredients(meal: SavedMeal): SharedMealIngredient[] {
  const out: SharedMealIngredient[] = []
  for (const item of meal.items ?? []) {
    const food = item.foodItem
    if (!food) continue
    const q = Number(item.quantityMultiplier) || 0
    if (q <= 0) continue
    out.push({
      name: food.brand ? `${food.brand} ${food.name}` : food.name,
      weightG: Math.round((Number(food.servingSizeG) || 0) * q),
      calories: Math.round((Number(food.calories) || 0) * q),
      proteinG: r1((Number(food.proteinG) || 0) * q),
      carbsG: r1((Number(food.carbsG) || 0) * q),
      fatG: r1((Number(food.fatG) || 0) * q),
    })
  }
  return out
}

/** Positional, because the field names would be a third of the payload. */
function toWire(meal: SharedMeal): string {
  const rows = meal.ingredients.map(i => [i.name, i.weightG, i.calories, i.proteinG, i.carbsG, i.fatG])
  const arr: unknown[] = [MEAL_SHARE_FORMAT, meal.name, meal.servings, rows]
  if (meal.rolled > 0) arr.push(meal.rolled)
  return JSON.stringify(arr)
}

/**
 * A saved meal as a self-contained QR payload, trimmed to fit the byte budget.
 *
 * **The totals are sacred; the detail is negotiable.** Dropping an ingredient to save bytes would
 * change the meal's calories and macros, and the person scanning it has no way to know — so nothing
 * is ever dropped. Ingredients that do not fit are **rolled into one remainder entry carrying their
 * combined weight and macros**, so the copy's figures match the original to the gram. That entry is
 * computed as the recipe total minus what the named entries actually say, rather than by re-summing
 * the tail: the two are equal today, and the subtraction is the one that stays correct if the named
 * entries are ever rounded differently from the source.
 *
 * Rolling the tail beats truncating names and it is not close: cutting names to 12 characters buys
 * one QR version and cannot rescue a long recipe, while making brands unreadable. A 10-ingredient
 * meal rolled to 4 named + a remainder fits version 11; the same meal with names cut to 8 characters
 * needs version 16.
 */
export function encodeSharedMeal(
  meal: SavedMeal,
  opts: { maxBytes?: number } = {},
): { text: string; bytes: number; named: number; rolled: number } {
  const maxBytes = opts.maxBytes ?? MEAL_SHARE_MAX_BYTES
  const all = recipeIngredients(meal)
  const servings = Number(meal.servings) > 0 ? Number(meal.servings) : 1
  const name = meal.name

  const total = all.reduce((a, i) => ({
    weightG: a.weightG + i.weightG, calories: a.calories + i.calories,
    proteinG: a.proteinG + i.proteinG, carbsG: a.carbsG + i.carbsG, fatG: a.fatG + i.fatG,
  }), { weightG: 0, calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })

  /** `take` named, the rest as one remainder that makes the totals add up exactly. */
  const shapeFor = (take: number): SharedMeal => {
    const named = all.slice(0, take)
    const rolled = all.length - take
    if (rolled <= 0) return { name, servings, ingredients: named, rolled: 0 }
    const sum = named.reduce((a, i) => ({
      weightG: a.weightG + i.weightG, calories: a.calories + i.calories,
      proteinG: a.proteinG + i.proteinG, carbsG: a.carbsG + i.carbsG, fatG: a.fatG + i.fatG,
    }), { weightG: 0, calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })
    return {
      name, servings, rolled,
      ingredients: [...named, {
        name: `+${rolled} more`,
        weightG: total.weightG - sum.weightG,
        calories: total.calories - sum.calories,
        proteinG: r1(total.proteinG - sum.proteinG),
        carbsG: r1(total.carbsG - sum.carbsG),
        fatG: r1(total.fatG - sum.fatG),
      }],
    }
  }

  for (let take = all.length; take >= 0; take--) {
    const text = toWire(shapeFor(take))
    const bytes = utf8Bytes(text)
    if (bytes <= maxBytes) return { text, bytes, named: take, rolled: all.length - take }
  }

  // Even one remainder line does not fit, which means the NAME is what is over budget. Trim it
  // rather than refusing to print — a shortened title still identifies the food, and the numbers,
  // which are the part that must not be guessed at, are untouched.
  let shape = shapeFor(0)
  while (utf8Bytes(toWire(shape)) > maxBytes && shape.name.length > 1) {
    shape = { ...shape, name: shape.name.slice(0, -1) }
  }
  const text = toWire(shape)
  return { text, bytes: utf8Bytes(text), named: 0, rolled: all.length }
}

/** A scanned string back to a shared meal, or null if it is not one. Never throws. */
export function decodeSharedMeal(scanned: string): SharedMeal | null {
  if (!scanned.startsWith('[')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(scanned)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed[0] !== MEAL_SHARE_FORMAT) return null
  const [, name, servings, rows, rolled] = parsed as [number, unknown, unknown, unknown, unknown]
  if (typeof name !== 'string' || typeof servings !== 'number' || !Array.isArray(rows)) return null

  const ingredients: SharedMealIngredient[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) return null
    const [n, g, kcal, p, c, f] = row as unknown[]
    if (typeof n !== 'string') return null
    if ([g, kcal, p, c, f].some(v => typeof v !== 'number' || !Number.isFinite(v))) return null
    ingredients.push({
      name: n, weightG: g as number, calories: kcal as number,
      proteinG: p as number, carbsG: c as number, fatG: f as number,
    })
  }
  return {
    name, servings: servings > 0 ? servings : 1, ingredients,
    rolled: typeof rolled === 'number' && rolled > 0 ? rolled : 0,
  }
}

/**
 * The one entry point for a scanned meal label — **both formats, one decoder, indefinitely**.
 *
 * Labels already printed carry the 22-character id token, and they must keep working for the person
 * who printed them. The two shapes cannot collide: the token is 22 base64url characters, a shared
 * payload starts with `[`, and an EAN-13 is 13 digits.
 *
 * Returning null rather than throwing keeps the scan handler's fall-through to the barcode lookup
 * simple, exactly as `decodeMealLabelToken` already does.
 */
export function decodeMealLabelScan(scanned: string):
  | { kind: 'meal-id'; mealId: string }
  | { kind: 'shared-meal'; meal: SharedMeal }
  | null {
  const mealId = decodeMealLabelToken(scanned)
  if (mealId) return { kind: 'meal-id', mealId }
  const meal = decodeSharedMeal(scanned)
  return meal ? { kind: 'shared-meal', meal } : null
}
