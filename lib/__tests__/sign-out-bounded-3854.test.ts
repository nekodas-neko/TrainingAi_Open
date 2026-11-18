// #3854 item 3: a sign-out step that throws or never settles must not leave the #3806 fence up (every
// `fetch` refused until reload), and must not skip the cookie clear.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearLocal: vi.fn<() => Promise<void>>(),
  clearCache: vi.fn<() => Promise<void>>(),
  clearStorage: vi.fn<() => void>(),
  server: vi.fn<() => Promise<void>>(),
}))
vi.mock('@/lib/local-store', () => ({ clearLocalStoreData: () => mocks.clearLocal() }))
vi.mock('@/lib/sqlite/cache', () => ({ disableCacheWrites: () => {}, clearAllCache: () => mocks.clearCache() }))
vi.mock('@/lib/sign-out-storage', () => ({ clearAccountStorage: () => mocks.clearStorage() }))
vi.mock('@/app/actions', () => ({ signOut: () => mocks.server() }))

import { SIGN_OUT_CLEAR_TIMEOUT_MS, signOutAndClearDevice } from '@/lib/sign-out'
import { __resetSignOutFenceForTests, fencedFetch, isSigningOut } from '@/lib/sign-out-fence'

const action = { method: 'POST', headers: { 'Next-Action': 'sign-out' } }
const network = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch
const page = fencedFetch(network)

beforeEach(() => {
  __resetSignOutFenceForTests()
  vi.mocked(network).mockClear()
  mocks.clearLocal.mockReset().mockResolvedValue(undefined)
  mocks.clearCache.mockReset().mockResolvedValue(undefined)
  mocks.clearStorage.mockReset()
  // The server action goes through `fetch`, like Next's own action call does.
  mocks.server.mockReset().mockImplementation(async () => { await page('/more', action) })
})
afterEach(() => {
  vi.useRealTimers()
  __resetSignOutFenceForTests()
})

async function expectFenceLifted() {
  expect(isSigningOut()).toBe(false)
  expect((await page('/sign-in')).status).toBe(200)
}

describe('#3854 sign-out always lifts the fence and always clears the cookie', () => {
  it('a local-store clear that throws: the cookie clear still runs, then the fence lifts', async () => {
    mocks.clearLocal.mockRejectedValue(new Error('sqlite busy'))
    await signOutAndClearDevice()
    expect(mocks.server).toHaveBeenCalledTimes(1)
    expect(vi.mocked(network).mock.calls.map(c => String(c[0]))).toEqual(['/more'])
    await expectFenceLifted()
  })

  it('a storage clear that throws synchronously: the cookie clear still runs, then the fence lifts', async () => {
    mocks.clearStorage.mockImplementation(() => { throw new Error('quota') })
    await signOutAndClearDevice()
    expect(mocks.server).toHaveBeenCalledTimes(1)
    await expectFenceLifted()
  })

  it('a local-store clear that never settles is cut off at the bound; the cookie clear runs and the fence lifts', async () => {
    vi.useFakeTimers()
    mocks.clearLocal.mockReturnValue(new Promise<void>(() => {}))
    const done = signOutAndClearDevice()
    await vi.advanceTimersByTimeAsync(SIGN_OUT_CLEAR_TIMEOUT_MS - 1)
    // Still fenced, and nothing but the sign-out could be sent yet.
    expect(isSigningOut()).toBe(true)
    expect(mocks.server).not.toHaveBeenCalled()
    await expect(page('/api/user/trophy-pins')).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(1)
    await done
    expect(mocks.server).toHaveBeenCalledTimes(1)
    expect(vi.mocked(network).mock.calls.map(c => String(c[0]))).toEqual(['/more'])
    await expectFenceLifted()
  })

  it('a cache clear that never settles is bounded the same way', async () => {
    vi.useFakeTimers()
    mocks.clearCache.mockReturnValue(new Promise<void>(() => {}))
    const done = signOutAndClearDevice()
    await vi.advanceTimersByTimeAsync(SIGN_OUT_CLEAR_TIMEOUT_MS)
    await done
    expect(mocks.server).toHaveBeenCalledTimes(1)
    await expectFenceLifted()
  })

  it('a server sign-out that fails lifts the fence and reports the failure to the caller', async () => {
    mocks.server.mockRejectedValue(new Error('offline'))
    await expect(signOutAndClearDevice()).rejects.toThrow('offline')
    await expectFenceLifted()
  })

  it('the cookie clear itself is not cut off: the fence holds until it answers', async () => {
    vi.useFakeTimers()
    let answer!: () => void
    mocks.server.mockReturnValue(new Promise<void>(resolve => { answer = resolve }))
    const done = signOutAndClearDevice()
    await vi.advanceTimersByTimeAsync(SIGN_OUT_CLEAR_TIMEOUT_MS * 10)
    expect(isSigningOut()).toBe(true)
    answer()
    await done
    await expectFenceLifted()
  })

  it('a page that stays put passes its own server action, and it is the one request let through', async () => {
    const inPlace = vi.fn(async () => { await page('/mobile-signin/native', action) })
    await signOutAndClearDevice(inPlace)
    expect(inPlace).toHaveBeenCalledTimes(1)
    expect(mocks.server).not.toHaveBeenCalled()
    expect(vi.mocked(network).mock.calls.map(c => String(c[0]))).toEqual(['/mobile-signin/native'])
    await expectFenceLifted()
  })
})
