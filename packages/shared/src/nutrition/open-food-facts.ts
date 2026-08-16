import type { NutritionScanResult } from '../types/nutrition'

// Mapping an Open Food Facts product to this app's nutrition shape.
//
// Extracted from the barcode route so barcode lookup and text search cannot drift: they read the
// same fields, apply the same per-serving preference, and produce the same units. OFF's numbers are
// per 100 g except for the `_serving` variants, and its `serving_size` is free text ("40g",
// "1 bar (40g)", "250 ml"), so both of those quirks are handled once, here.

export interface OffProduct {
  product_name?: string
  brands?: string
  serving_size?: string
  nutriments?: Record<string, number | undefined>
  code?: string
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`
// The unit has to be followed by a non-letter, or "1 glass (200 ml)" reads the "g" of "glass" and
// declares the serving to be one gram — which then divides every macro by a hundred. Text search
// made that visible: a list of oat drinks came back as "1 g, 44 kcal".
const GRAMS = new RegExp(`${NUM}\\s*(?:g|gr|gram|grams|gramme|grammes|gramos)(?![a-z])`, 'i')
const MILLILITRES = new RegExp(`${NUM}\\s*(?:ml|millilitres?|milliliters?)(?![a-z])`, 'i')

const num = (s: string) => parseFloat(s.replace(',', '.'))

/** Grams per serving from OFF's free-text `serving_size`, defaulting to 100 g. */
export function servingSizeGrams(servingSize: string | undefined): number {
  const s = servingSize ?? ''
  const grams = GRAMS.exec(s)
  if (grams) return num(grams[1])
  // OFF states beverages per 100 ml and writes their servings the same way. Water's density is
  // close enough for a drink that 1 ml ≈ 1 g beats falling back to a flat 100 g.
  const ml = MILLILITRES.exec(s)
  if (ml) return num(ml[1])
  return 100
}

/**
 * One OFF product as a nutrition result.
 *
 * Returns null when the product carries no usable energy value — OFF has many entries that are a
 * name and nothing else, and an ingredient claiming 0 kcal would silently poison every total it
 * ever lands in.
 */
export function offProductToNutrition(p: OffProduct): NutritionScanResult | null {
  const n = p.nutriments ?? {}
  const servingSizeG = servingSizeGrams(p.serving_size)
  const scale = servingSizeG / 100

  const perServing = (servingVal: number | undefined, per100g: number | undefined): number => {
    if (servingVal != null && servingVal > 0) return servingVal
    if (per100g != null) return per100g * scale
    return 0
  }

  const calories = Math.round(perServing(n['energy-kcal_serving'], n['energy-kcal_100g']))
  if (!(calories > 0)) return null

  return {
    name: p.product_name ?? 'Unknown product',
    brand: p.brands ?? undefined,
    servingSizeG,
    calories,
    proteinG: perServing(n['proteins_serving'], n['proteins_100g']),
    carbsG: perServing(n['carbohydrates_serving'], n['carbohydrates_100g']),
    fatG: perServing(n['fat_serving'], n['fat_100g']),
    fiberG: perServing(n['fiber_serving'], n['fiber_100g']) || undefined,
    sugarG: perServing(n['sugars_serving'], n['sugars_100g']) || undefined,
    sodiumMg: n['sodium_serving'] != null && n['sodium_serving'] > 0
      ? n['sodium_serving'] * 1000
      : n['sodium_100g'] != null ? n['sodium_100g'] * scale * 1000 : undefined,
    satFatG: perServing(n['saturated-fat_serving'], n['saturated-fat_100g']) || undefined,
    confidence: 'high',
    notes: 'From Open Food Facts',
  }
}

/** The fields both the barcode and search calls ask OFF for. */
export const OFF_FIELDS = 'code,product_name,brands,serving_size,nutriments'
export const OFF_USER_AGENT = 'TrainingAI/1.0'

export const OFF_TIMEOUT_MS = 9000
export const OFF_RETRY_DELAY_MS = 400

/**
 * One OFF call, with the retry and the failure/absence distinction both callers need.
 *
 * `null` means **OFF itself failed** — unreachable, timed out, or answered 5xx. That is not the same
 * as OFF answering "no such product", and the two must not collapse into one response: rendering
 * "not in the database" during an outage tells the user something false about their food, and they
 * act on it by typing the item in by hand. Measured 2026-08-13, OFF served a 502 downtime page for
 * its whole API while the barcode route reported every scan as `notFound`.
 *
 * A 503 is usually our own rate limiting rather than an outage and clears in well under a second, so
 * it gets one short retry; any other non-2xx is reported as-is and not retried.
 */
export async function offFetchJson<T>(url: string, opts?: { signal?: AbortSignal; revalidateSec?: number; label?: string }): Promise<T | null> {
  const label = opts?.label ?? 'off'
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, OFF_RETRY_DELAY_MS))
    const res = await fetch(url, {
      headers: { 'User-Agent': OFF_USER_AGENT },
      signal: opts?.signal,
      ...(opts?.revalidateSec != null ? { next: { revalidate: opts.revalidateSec } } : {}),
    })
    if (res.ok) return await res.json() as T
    if (res.status !== 503) {
      console.error(`[${label}] Open Food Facts returned`, res.status)
      return null
    }
  }
  console.error(`[${label}] Open Food Facts rate-limited (503) twice`)
  return null
}
