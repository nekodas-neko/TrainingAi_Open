/**
 * PS-39 — how food gets found and reused: `nutrition/barcode`, `nutrition/food-search`,
 * `nutrition/recent-for-meal` and `nutrition/saved-meals`.
 *
 * Batched because they are the four ways an item reaches a meal — scan it, search for it, reuse
 * something recent, reuse something saved — and two of them share one flaky third-party dependency
 * whose failure modes are the whole point. Each carries a decision the response shape hides:
 *
 *   · **"The database is down" and "your food is not in it" are different answers**, rendered
 *     differently: one offers a retry, the other sends you to the photo scanner. Collapsing them
 *     told the user their food was unknown during Open Food Facts' 2026-08-13 outage. `barcode`
 *     answers 503 `unavailable` or 404 `notFound`, never one for the other.
 *   · **A failed lookup is reported to `error_events`, not just the console.** When the owner
 *     reported barcode scanning broken there was no record to read, and the cause is now
 *     unrecoverable.
 *   · **`food-search` matches whole words in the NAME**, because OFF's free-text search matches
 *     ingredient lists — "milk" legitimately returns cheddar — and a substring match puts "Milka"
 *     at the top of a search for milk.
 *   · **Region first, widened only when that leaves too little**, and the search is unavailable
 *     only when BOTH calls fail. An empty list reads as a broken feature; a wrong one is worse.
 *   · **`origin: 'barcode'` is what makes the stored row say where it came from** (BF-70).
 *     `confidence` cannot: the shared mapper sets it to 'high' for text search too.
 *   · **A refused saved-meal write is a 400, not a 500** — the outbox retries 5xx forever and
 *     quarantines 4xx, so a mutation that can never succeed must not look retryable.
 *
 * Fixture discipline (the PS-39 note): every case below fails on the ONE rule it names and
 * satisfies the others, so a guard cannot be deleted while another rejects the input for it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const offFetchJson = vi.fn(async (..._a: unknown[]) => null as unknown)
const fetchOffThumbDataUri = vi.fn(async (..._a: unknown[]) => null as string | null)
const reportServerError = vi.fn((..._a: unknown[]) => undefined)

const listRecentFoodItems = vi.fn(async (..._a: unknown[]) => [] as Row[])
const listRecentFoodItemsForMealType = vi.fn(async (..._a: unknown[]) => [] as Row[])
const listSavedMeals = vi.fn(async (_u: string) => [] as Row[])
const createSavedMeal = vi.fn(async (..._a: unknown[]) => ({ id: 'meal-1' }) as Row)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    listRecentFoodItems, listRecentFoodItemsForMealType, listSavedMeals, createSavedMeal,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
// Only the network seam is stubbed. `offProductToNutrition` stays real, so the mapping from an OFF
// product to a stored item — including the serving-size arithmetic — is exercised rather than faked.
vi.mock('@trainingai/shared/nutrition/open-food-facts', async (orig) => {
  const actual = await orig<typeof import('@trainingai/shared/nutrition/open-food-facts')>()
  return {
    ...actual,
    offFetchJson: (...a: unknown[]) => offFetchJson(...a),
    fetchOffThumbDataUri: (...a: unknown[]) => fetchOffThumbDataUri(...a),
  }
})

import { GET as getBarcode } from '@/app/api/nutrition/barcode/route'
import { GET as getSearch } from '@/app/api/nutrition/food-search/route'
import { GET as getRecent } from '@/app/api/nutrition/recent-for-meal/route'
import { GET as getSaved, POST as postSaved } from '@/app/api/nutrition/saved-meals/route'

const CODE = '93851234'
const MEAL_TYPE = '00000000-0000-4000-8000-0000000000a7'
const ITEM = '00000000-0000-4000-8000-0000000000a8'

/** A complete OFF product: every case below varies ONE field away from this. */
const offProduct = (over: Row = {}) => ({
  product_name: 'Milk', brands: 'Dairy Co', serving_size: '250 ml', code: CODE,
  nutriments: { 'energy-kcal_100g': 64, 'proteins_100g': 3.3, 'carbohydrates_100g': 4.8, 'fat_100g': 3.6 },
  image_front_thumb_url: 'https://images.openfoodfacts.org/thumb.jpg',
  ...over,
})

const barcode = (code = CODE) => getBarcode(new Request(`http://localhost/api/nutrition/barcode?code=${code}`))
const search = (q: string) => getSearch(new Request(`http://localhost/api/nutrition/food-search?q=${encodeURIComponent(q)}`))
const recent = (query = '') => getRecent(new Request(`http://localhost/api/nutrition/recent-for-meal${query}`))
const savedMeal = (body: unknown) =>
  postSaved(new Request('http://localhost/api/nutrition/saved-meals', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))

let seq = 0
const freshUser = () => { sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane' } }

/** `offFetchJson` is called for the region page first, then the world page. */
const searchPages = (local: Row[] | null, world: Row[] | null) => {
  let call = 0
  offFetchJson.mockImplementation(async () => {
    const page = call++ === 0 ? local : world
    return page === null ? null : { products: page }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  offFetchJson.mockResolvedValue(null)
  fetchOffThumbDataUri.mockResolvedValue(null)
  listRecentFoodItems.mockResolvedValue([])
  listRecentFoodItemsForMealType.mockResolvedValue([])
  listSavedMeals.mockResolvedValue([])
  createSavedMeal.mockImplementation(async () => ({ id: 'meal-1' }))
})

describe('/api/nutrition/barcode', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await barcode()).status).toBe(401)
  })

  // Each of these is a well-formed request in every respect but the barcode itself.
  it('refuses a barcode that is not 8–15 digits', async () => {
    for (const code of ['1234567', '1234567890123456', '12345abc', '']) {
      expect((await barcode(code)).status).toBe(400)
    }
    expect(offFetchJson).not.toHaveBeenCalled()
  })

  // The distinction the 2026-08-13 outage exposed: a down database must not read as an unknown food.
  it('says the database is unavailable when the lookup fails, not that the food is unknown', async () => {
    offFetchJson.mockResolvedValue(null)
    const res = await barcode()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ unavailable: true })
  })

  it('says the same when the lookup throws, and records it somewhere durable', async () => {
    offFetchJson.mockRejectedValue(new Error('ETIMEDOUT'))
    const res = await barcode()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ unavailable: true })
    // A console.error is invisible to `error_events`, which is why the last outage left no record.
    expect(reportServerError).toHaveBeenCalled()
  })

  it('says not-found only when the database answered and had nothing', async () => {
    offFetchJson.mockResolvedValue({ status: 0 })
    expect((await barcode()).status).toBe(404)

    // A success status with no product at all. Separate from the case below: without its own guard
    // this reaches the mapper as `undefined`, and the mapper is not what should be deciding it.
    offFetchJson.mockResolvedValue({ status: 1 })
    expect((await barcode()).status).toBe(404)

    offFetchJson.mockResolvedValue({ status: 1, product: { product_name: 'Mystery', nutriments: {} } })
    expect((await barcode()).status).toBe(404)  // no energy at all is not a usable product
  })

  // BF-70: `confidence` cannot say where a row came from — the mapper sets 'high' for text search
  // too, and the photo scan sets one as well.
  it('stamps the origin so the stored row says it came from a barcode', async () => {
    offFetchJson.mockResolvedValue({ status: 1, product: offProduct() })
    const body = await (await barcode()).json()
    expect(body.origin).toBe('barcode')
    expect(body.notes).toContain('Open Food Facts')
    expect(body.name).toBe('Milk')
    expect(body.calories).toBe(160)  // 64 kcal/100 ml over a 250 ml serving
  })

  // BF-35: the bytes, not the URL — `food_items` is read local-first and a URL renders nothing
  // offline. And a missing image must never turn a working scan into a failed one.
  it('carries the thumbnail bytes, and still succeeds without them', async () => {
    offFetchJson.mockResolvedValue({ status: 1, product: offProduct() })
    fetchOffThumbDataUri.mockResolvedValue('data:image/jpeg;base64,abc')
    expect((await (await barcode()).json()).imageDataUri).toBe('data:image/jpeg;base64,abc')

    fetchOffThumbDataUri.mockResolvedValue(null)
    const res = await barcode()
    expect(res.status).toBe(200)
    expect((await res.json()).imageDataUri).toBeNull()
  })

  it('rate-limits the thirty-first scan in the minute', async () => {
    offFetchJson.mockResolvedValue({ status: 1, product: offProduct() })
    for (let i = 0; i < 30; i++) expect((await barcode()).status).toBe(200)
    expect((await barcode()).status).toBe(429)
  })
})

describe('/api/nutrition/food-search', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await search('milk')).status).toBe(401)
  })

  it('asks nothing of the database for a query too short to mean anything', async () => {
    expect((await (await search('m')).json()).results).toEqual([])
    expect(offFetchJson).not.toHaveBeenCalled()
  })

  // OFF matches ingredient lists, so "milk" returns cheddar; and a substring match puts "Milka" —
  // a chocolate bar — at the top of a search for milk. Both products below are otherwise perfect
  // hits: complete nutriments, a name, a brand.
  it('matches whole words in the name, not substrings or ingredients', async () => {
    searchPages([
      offProduct({ product_name: 'Milka Chocolate', code: 'a' }),
      offProduct({ product_name: 'Cheddar Cheese', code: 'b' }),
      offProduct({ product_name: 'Milk', code: 'c' }),
    ], [])
    const { results } = await (await search('milk')).json()
    expect(results.map((r: Row) => r.name)).toEqual(['Milk'])
  })

  // A single-word query cannot tell "every term matches" from "any term matches" — they are the
  // same rule over one term. Two words are what separate them.
  it('needs every word of the query, not just one of them', async () => {
    searchPages([
      offProduct({ product_name: 'Milk', brands: 'A', code: 'a' }),
      offProduct({ product_name: 'Chocolate Bar', brands: 'B', code: 'b' }),
      offProduct({ product_name: 'Chocolate Milk', brands: 'C', code: 'c' }),
    ], [])
    const { results } = await (await search('chocolate milk')).json()
    expect(results.map((r: Row) => r.name)).toEqual(['Chocolate Milk'])
  })

  // The brand counts toward the match, so a product whose NAME carries only one word still
  // qualifies when its brand carries the other.
  it('lets the brand supply a word the name is missing', async () => {
    searchPages([offProduct({ product_name: 'Milk', brands: 'Chocolate Co', code: 'a' })], [])
    const { results } = await (await search('chocolate milk')).json()
    expect(results).toHaveLength(1)
  })

  it('puts the plainer name first', async () => {
    searchPages([
      offProduct({ product_name: 'Chocolate Milk Drink Powder', brands: 'A', code: 'a' }),
      offProduct({ product_name: 'Milk', brands: 'B', code: 'b' }),
    ], [])
    const { results } = await (await search('milk')).json()
    expect(results.map((r: Row) => r.name)).toEqual(['Milk', 'Chocolate Milk Drink Powder'])
  })

  // OFF lists the same product under several barcodes; near-identical rows are worse than a short
  // list. These two differ ONLY in code.
  it('collapses the same product listed under two barcodes', async () => {
    searchPages([
      offProduct({ code: 'a' }),
      offProduct({ code: 'b' }),
    ], [])
    const { results } = await (await search('milk')).json()
    expect(results).toHaveLength(1)
  })

  // Own region first, because it is what the user can buy — widened only when that is too thin.
  it('widens past the region only when the local list is too short', async () => {
    const six = Array.from({ length: 6 }, (_, i) => offProduct({ product_name: `Milk ${i}`, brands: `B${i}`, code: `c${i}` }))
    searchPages(six, [])
    await search('milk')
    expect(offFetchJson).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    searchPages([offProduct({ code: 'a' })], [offProduct({ product_name: 'Milk Powder', brands: 'Z', code: 'z' })])
    const { results } = await (await search('milk')).json()
    expect(offFetchJson).toHaveBeenCalledTimes(2)
    expect(results.map((r: Row) => r.name)).toEqual(['Milk', 'Milk Powder'])
  })

  // Unavailable is reserved for BOTH calls failing: a region call that fails while the world
  // answers is a working search, and an empty list from a working search is not an outage.
  it('calls the search unavailable only when both pages fail', async () => {
    searchPages(null, null)
    expect((await (await search('milk')).json()).unavailable).toBe(true)

    vi.clearAllMocks()
    searchPages(null, [offProduct()])
    const recovered = await (await search('milk')).json()
    expect(recovered.unavailable).toBeUndefined()
    expect(recovered.results).toHaveLength(1)

    vi.clearAllMocks()
    searchPages([], [])
    const empty = await (await search('milk')).json()
    expect(empty.unavailable).toBeUndefined()
    expect(empty.results).toEqual([])
  })

  it('rate-limits below what Open Food Facts itself refuses', async () => {
    searchPages([], [])
    for (let i = 0; i < 12; i++) expect((await search('milk')).status).toBe(200)
    expect((await search('milk')).status).toBe(429)
  })
})

describe('/api/nutrition/recent-for-meal', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await recent()).status).toBe(401)
  })

  // LB-18: absent means every bucket, and it used to be a 400. Twelve unscoped against five for one
  // bucket, because the global list is drawn from every meal of the day.
  it('answers every bucket when no meal type is named', async () => {
    const res = await recent()
    expect(res.status).toBe(200)
    expect(listRecentFoodItems).toHaveBeenCalledWith(sessionUser!.id, 12)
    expect(listRecentFoodItemsForMealType).not.toHaveBeenCalled()
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('scopes to one bucket, and asks for fewer, when a meal type is named', async () => {
    await recent(`?mealTypeId=${MEAL_TYPE}`)
    expect(listRecentFoodItemsForMealType).toHaveBeenCalledWith(sessionUser!.id, MEAL_TYPE, 5)
    expect(listRecentFoodItems).not.toHaveBeenCalled()
  })
})

describe('/api/nutrition/saved-meals', () => {
  const meal = (over: Row = {}) => ({
    name: 'Post-workout shake',
    items: [{ foodItemId: ITEM, quantityMultiplier: 1 }],
    ...over,
  })

  it('refuses both verbs without a session', async () => {
    sessionUser = null
    expect((await getSaved()).status).toBe(401)
    expect((await savedMeal(meal())).status).toBe(401)
  })

  it('lists only the caller\'s own, uncacheable', async () => {
    const res = await getSaved()
    expect(listSavedMeals).toHaveBeenCalledWith(sessionUser!.id)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('creates under the caller and answers 201', async () => {
    const res = await savedMeal(meal())
    expect(res.status).toBe(201)
    expect(createSavedMeal.mock.calls[0][0]).toBe(sessionUser!.id)
    expect(createSavedMeal.mock.calls[0][1]).toBe('Post-workout shake')
  })

  // `servings` defaults to 1 so an older client that omits it is indistinguishable from a
  // single-portion meal; `mealTypeIds` has NO default, because one would turn "the caller did not
  // mention tags" into "clear the tags" (BF-11e).
  it('defaults the servings but leaves unmentioned tags alone', async () => {
    await savedMeal(meal())
    const [, , , , servings, imageDataUri, mealTypeIds] = createSavedMeal.mock.calls[0]
    expect(servings).toBe(1)
    expect(imageDataUri).toBeUndefined()
    expect(mealTypeIds).toBeUndefined()

    createSavedMeal.mockClear()
    await savedMeal(meal({ servings: 4, mealTypeIds: [MEAL_TYPE] }))
    const [, , , , servings4, , tags] = createSavedMeal.mock.calls[0]
    expect(servings4).toBe(4)
    expect(tags).toEqual([MEAL_TYPE])
  })

  // Each of these is a valid meal in every respect but the field it names.
  it('bounds the name, the multiplier, the item count, the servings and the tags', async () => {
    for (const bad of [
      meal({ name: '' }),
      meal({ name: 'x'.repeat(121) }),
      meal({ items: [{ foodItemId: 'not-a-uuid', quantityMultiplier: 1 }] }),
      meal({ items: [{ foodItemId: ITEM, quantityMultiplier: 0 }] }),
      meal({ items: [{ foodItemId: ITEM, quantityMultiplier: 101 }] }),
      meal({ items: new Array(101).fill({ foodItemId: ITEM, quantityMultiplier: 1 }) }),
      meal({ servings: 0 }),           // a zero would make one portion infinite
      meal({ servings: 51 }),
      meal({ mealTypeIds: new Array(21).fill(MEAL_TYPE) }),
      meal({ mealTypeIds: ['not-a-uuid'] }),
    ]) {
      expect((await savedMeal(bad)).status).toBe(400)
    }
    expect(createSavedMeal).not.toHaveBeenCalled()
  })

  // The outbox retries 5xx forever and quarantines 4xx, so a write that can never succeed — an
  // unknown food item, a meal type that is not this user's — must not look retryable.
  it('turns a refused write into a 400 rather than a bare 500', async () => {
    const { UserFacingError } = await import('@trainingai/shared/errors')
    createSavedMeal.mockRejectedValue(new UserFacingError('That food item does not exist', 400))

    const res = await savedMeal(meal())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('That food item does not exist')
  })

  it('lets a genuine fault propagate rather than quarantining it', async () => {
    createSavedMeal.mockRejectedValue(new Error('connection reset'))
    await expect(savedMeal(meal())).rejects.toThrow('connection reset')
  })

  it('refuses an oversized body before the schema sees it', async () => {
    const res = await savedMeal(meal({ imageDataUri: `data:image/jpeg;base64,${'a'.repeat(80 * 1024)}` }))
    expect(res.status).toBe(413)
    expect(createSavedMeal).not.toHaveBeenCalled()
  })
})
