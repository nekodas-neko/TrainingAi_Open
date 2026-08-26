import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { getLocalStoreMock, pushThenRevalidateMock, invalidateSavedMealsMock } = vi.hoisted(() => ({
  getLocalStoreMock: vi.fn(() => null as unknown),
  pushThenRevalidateMock: vi.fn(),
  invalidateSavedMealsMock: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/local-store', () => ({ getLocalStore: getLocalStoreMock }))
vi.mock('@/lib/local-store/push-then-revalidate', () => ({ pushThenRevalidate: pushThenRevalidateMock }))
vi.mock('@/lib/cache-groups', () => ({ invalidateSavedMeals: invalidateSavedMealsMock }))

import { saveMealToLibrary, type SaveMealInput } from '../save-meal'

function fakeStore() {
  return {
    upsertSavedMeal: vi.fn(() => Promise.resolve()),
    queueMutation: vi.fn(() => Promise.resolve()),
    getSavedMeals: vi.fn(() => Promise.resolve([])),
  }
}

const base: SaveMealInput = {
  mealId: 'meal-1',
  name: 'Chilli',
  items: [{ foodItemId: 'food-1', quantityMultiplier: 1 }],
  servings: 2,
  imageDataUri: null,
  mealTypeIds: ['dinner-id'],
  createdAt: '2026-08-26T00:00:00.000Z',
  isUpdate: false,
  userId: 'u1',
  tz: 'Australia/Brisbane',
}

/**
 * BF-11e shipped storage and transport for meal-type tags; BF-11f is the picker. The failure this
 * guards is the one its ⚠ block names: tags reaching the SERVER while the on-device store and the
 * outbox replay never learn about them, so the tag saves on the web and strands on the phone.
 *
 * Both halves are asserted from one call, because the bug is precisely them disagreeing.
 */
describe('saveMealToLibrary — meal-type tags travel on both write paths', () => {
  beforeEach(() => {
    getLocalStoreMock.mockReset()
    pushThenRevalidateMock.mockClear()
    invalidateSavedMealsMock.mockClear()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('sends the tags to the local upsert AND the queued outbox payload', async () => {
    const store = fakeStore()
    getLocalStoreMock.mockReturnValue(store)

    await saveMealToLibrary(base)

    expect(store.upsertSavedMeal).toHaveBeenCalledTimes(1)
    expect(store.upsertSavedMeal.mock.calls[0][2]).toEqual(['dinner-id'])
    expect(store.queueMutation).toHaveBeenCalledTimes(1)
    expect(store.queueMutation.mock.calls[0][0].payload).toMatchObject({ mealTypeIds: ['dinner-id'] })
  })

  it('sends an empty array through both paths, because clearing every tag is an answer', async () => {
    const store = fakeStore()
    getLocalStoreMock.mockReturnValue(store)

    await saveMealToLibrary({ ...base, mealTypeIds: [] })

    // `[]` means "clear them" and `undefined` means "leave them alone" — the local table, the route
    // and the outbox replay all draw that line, so an untick is only saveable if `[]` survives.
    expect(store.upsertSavedMeal.mock.calls[0][2]).toEqual([])
    expect(store.queueMutation.mock.calls[0][0].payload.mealTypeIds).toEqual([])
  })

  it('omits the key entirely when the caller passes undefined', async () => {
    const store = fakeStore()
    getLocalStoreMock.mockReturnValue(store)

    await saveMealToLibrary({ ...base, mealTypeIds: undefined })

    expect(store.upsertSavedMeal.mock.calls[0][2]).toBeUndefined()
    expect(store.queueMutation.mock.calls[0][0].payload.mealTypeIds).toBeUndefined()
  })

  it('sends the tags on the web fallback too', async () => {
    getLocalStoreMock.mockReturnValue(null)
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await saveMealToLibrary({ ...base, userId: undefined })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.mealTypeIds).toEqual(['dinner-id'])
  })

  it('still queues the tags when the local write throws — the Q-216 fallback keeps them', async () => {
    const store = fakeStore()
    store.upsertSavedMeal.mockRejectedValueOnce(new Error('SQLite is unhappy'))
    getLocalStoreMock.mockReturnValue(store)
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    await saveMealToLibrary(base)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.mealTypeIds).toEqual(['dinner-id'])
    err.mockRestore()
  })
})
