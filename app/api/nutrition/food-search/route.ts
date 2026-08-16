import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { rateLimit } from '@/lib/rate-limit'
import {
  offProductToNutrition, OFF_FIELDS, OFF_TIMEOUT_MS, type OffProduct, offFetchJson } from '@trainingai/shared/nutrition/open-food-facts'
import type { NutritionScanResult } from '@trainingai/shared/types/nutrition'

/**
 * Search a real food database by name.
 *
 * Best-effort by design: this endpoint is measurably flaky (1 of 3 probes returned 503) and its
 * free-text relevance is poor, so it is an ADDITION to the search list, never the thing the UI
 * promises. The dependable way to get a food that is not already in the library is the AI estimate
 * the client offers alongside these results.
 *
 * Building a saved meal could only search food items this user had already created, so the library
 * could never grow past what was already in it — searching "Milk" returned the four things you had
 * saved and nothing else.
 *
 * Open Food Facts is the same source the barcode scanner already trusts, so this adds no new
 * dependency, no key and no new provenance to explain. The caller merges these with the user's own
 * items; this route deliberately returns ONLY external hits so the client can label them.
 */

const MAX_RESULTS = 20
/** Enough hits to be worth showing without widening to the world index. */
const MIN_LOCAL_RESULTS = 5

/**
 * OFF's country tag for the shopping region. The app is AU-only today (`food_items.region`
 * defaults to `'AU'`), and this is the single biggest relevance lever there is: unfiltered, a search
 * for "Milk" comes back with Moroccan and French products nobody here can buy.
 */
const REGION_TAG = 'australia'

/**
 * Does the product's own name (or brand) contain every word of the query?
 *
 * OFF's free-text search matches **ingredient lists**, not just names, so "milk" legitimately
 * returns cream cheese, cheddar and processed cheese — they all contain milk. `sort_by` cannot fix
 * that; it only reorders the same wrong set. Filtering on the name is what makes the list answer the
 * question that was asked.
 */
function nameMatchesQuery(name: string, brand: string | undefined, terms: RegExp[]): boolean {
  const haystack = `${brand ?? ''} ${name}`
  return terms.every(t => t.test(haystack))
}

/**
 * Whole-word matchers for the query.
 *
 * Substring matching is not enough: "milk" is inside "Milka", so a plain `includes` puts a chocolate
 * bar at the top of a search for milk. The boundaries are what make the match mean the word.
 */
function queryMatchers(q: string): RegExp[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean)
    .map(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'))
}

export interface FoodSearchResponse {
  results: (NutritionScanResult & { externalId: string })[]
  /** True when the lookup itself failed, so the UI can say so instead of showing "no results". */
  unavailable?: boolean
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Open Food Facts asks for no more than ~10 searches a minute and answers 503 past that — and a
  // 503 we caused reads to the user exactly like an outage. Our own limit sits just above theirs so
  // we refuse before they do, and one request here can be two upstream calls (region, then world).
  if (!rateLimit(`food-search:${session.user.id}`, 12, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 80)
  if (q.length < 2) return NextResponse.json({ results: [] } satisfies FoodSearchResponse)

  const terms = queryMatchers(q)

  // OFF can be slow or down; a search box must not hang on it. On failure we say the lookup is
  // unavailable rather than letting the UI render "nothing found", which would be a lie.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS)
  try {
    const local = await search(q, controller.signal, true)
    let results = local ? rank(local, terms) : []

    // Own-region first, because it is what the user can actually buy. Widen when that leaves too
    // little to be useful — a short honest list beats a long irrelevant one, but an empty one reads
    // as "the feature is broken". This also covers the region call *failing*: only when both calls
    // fail is the lookup genuinely unavailable.
    let worldFailed = false
    if (results.length < MIN_LOCAL_RESULTS) {
      const world = await search(q, controller.signal, false)
      if (world) {
        const seen = new Set(results.map(r => r.externalId))
        results = [...results, ...rank(world, terms).filter(r => !seen.has(r.externalId))]
      } else {
        worldFailed = true
      }
    }
    if (local == null && worldFailed) {
      return NextResponse.json({ results: [], unavailable: true } satisfies FoodSearchResponse)
    }

    return NextResponse.json({ results: results.slice(0, MAX_RESULTS) } satisfies FoodSearchResponse, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (e) {
    console.error('[food-search] Open Food Facts lookup failed', e)
    return NextResponse.json({ results: [], unavailable: true } satisfies FoodSearchResponse)
  } finally {
    clearTimeout(timeout)
  }
}

/** One OFF page. Returns null when OFF itself failed, which is different from "no matches". */
async function search(q: string, signal: AbortSignal, regionOnly: boolean): Promise<OffProduct[] | null> {
  const url = 'https://world.openfoodfacts.org/cgi/search.pl'
    + `?search_terms=${encodeURIComponent(q)}`
    // Over-fetch: the name filter below discards most of a page, so asking for MAX_RESULTS would
    // leave a handful.
    + `&search_simple=1&action=process&json=1&page_size=60&fields=${OFF_FIELDS}`
    // Scan count is the only popularity signal OFF exposes; it surfaces products people buy rather
    // than one-off contributor entries.
    + '&sort_by=unique_scans_n'
    + (regionOnly ? `&tagtype_0=countries&tag_contains_0=contains&tag_0=${REGION_TAG}` : '')
  const data = await offFetchJson<{ products?: OffProduct[] }>(url, { signal, revalidateSec: 3600, label: 'food-search' })
  return data ? data.products ?? [] : null
}

function rank(products: OffProduct[], terms: RegExp[]): (NutritionScanResult & { externalId: string })[] {
  const seen = new Set<string>()
  const scored: { row: NutritionScanResult & { externalId: string }; score: number }[] = []

  for (const p of products) {
    const parsed = offProductToNutrition(p)
    if (!parsed || !parsed.name || parsed.name === 'Unknown product') continue
    if (!nameMatchesQuery(parsed.name, parsed.brand, terms)) continue
    // OFF returns the same product under several barcodes; a list of near-identical rows is worse
    // than a short one.
    const key = `${parsed.name.toLowerCase()}|${parsed.brand?.toLowerCase() ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    // A product actually called "Milk" should beat "Chocolate Milk Drink Powder". Shorter names
    // carrying the query are closer to the plain thing the user typed.
    scored.push({ row: { ...parsed, externalId: p.code ?? key }, score: Math.min(999, parsed.name.length) })
  }

  return scored.sort((a, b) => a.score - b.score).map(s => s.row)
}
