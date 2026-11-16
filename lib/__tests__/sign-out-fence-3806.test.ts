// #3806: a response that was in flight when the user signed out writes nothing back, and no request
// but the sign-out itself is sent while the sign-out runs, so its cookie clear is the last one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetSignOutFenceForTests, allowSignOutRequest, beginSignOut, endSignOut, fencedFetch,
  isSigningOut, isSignOutAbort,
} from '@/lib/sign-out-fence'

type Pending = { url: string; signal: AbortSignal | undefined; resolve: (r: Response) => void }

function fakeNetwork() {
  const sent: Pending[] = []
  const original = vi.fn((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init?.signal ?? undefined
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    sent.push({ url: String(input), signal, resolve })
  })) as unknown as typeof fetch
  return { sent, fetch: fencedFetch(original) }
}
const ok = () => new Response(JSON.stringify({ pins: ['a'] }), { status: 200 })
const action = { method: 'POST', headers: { 'Next-Action': 'sign-out' } }

beforeEach(() => __resetSignOutFenceForTests())
afterEach(() => __resetSignOutFenceForTests())

describe('#3806 sign-out fence', () => {
  it('a response that resolves after sign-out is discarded, and its request was aborted', async () => {
    const net = fakeNetwork()
    const late = net.fetch('/api/user/trophy-pins')
    beginSignOut()
    net.sent[0].resolve(ok())
    await expect(late).rejects.toMatchObject({ name: 'AbortError' })
    expect(net.sent[0].signal?.aborted).toBe(true)
  })

  it('a body still being read when the sign-out begins is aborted too', async () => {
    const net = fakeNetwork()
    const req = net.fetch('/api/user/trophy-pins')
    net.sent[0].resolve(ok())
    await req
    beginSignOut()
    expect(net.sent[0].signal?.aborted).toBe(true)
  })

  it('refuses new requests, retries and refetches while the sign-out runs, without sending them', async () => {
    const net = fakeNetwork()
    beginSignOut()
    await expect(net.fetch('/api/user/trophy-pins')).rejects.toMatchObject({ name: 'AbortError' })
    await expect(net.fetch('/more', action)).rejects.toMatchObject({ name: 'AbortError' })
    expect(net.sent).toHaveLength(0)
  })

  it('lets exactly one server action through: the sign-out', async () => {
    const net = fakeNetwork()
    beginSignOut()
    allowSignOutRequest()
    await expect(net.fetch('/api/user/trophy-pins')).rejects.toMatchObject({ name: 'AbortError' })
    const signOut = net.fetch('/more', action)
    expect(net.sent.map(s => s.url)).toEqual(['/more'])
    await expect(net.fetch('/more', action)).rejects.toMatchObject({ name: 'AbortError' })
    net.sent[0].resolve(new Response(null, { status: 303 }))
    expect((await signOut).status).toBe(303)
  })

  it('after the sign-out, requests run again (they carry no session cookie)', async () => {
    const net = fakeNetwork()
    beginSignOut()
    endSignOut()
    const next = net.fetch('/sign-in')
    net.sent[0].resolve(ok())
    expect((await next).status).toBe(200)
  })

  it('passes a caller\'s own abort through', async () => {
    const net = fakeNetwork()
    const controller = new AbortController()
    const req = net.fetch('/api/x', { signal: controller.signal })
    controller.abort(new DOMException('mine', 'AbortError'))
    await expect(req).rejects.toMatchObject({ message: 'mine' })
  })
})

describe('signOutAndClearDevice ordering', () => {
  it('fences before clearing, and the server sign-out is the one request let through', async () => {
    vi.resetModules()
    const order: string[] = []
    vi.doMock('@/lib/local-store', () => ({ clearLocalStoreData: async () => { order.push('clear-local') } }))
    vi.doMock('@/lib/sqlite/cache', () => ({ disableCacheWrites: () => order.push('latch'), clearAllCache: async () => { order.push('clear-cache') } }))
    vi.doMock('@/lib/sign-out-storage', () => ({ clearAccountStorage: () => order.push('clear-storage') }))
    vi.doMock('@/lib/sign-out-fence', () => ({
      beginSignOut: () => order.push('fence'), allowSignOutRequest: () => order.push('allow'), endSignOut: () => order.push('unfence'),
    }))
    vi.doMock('@/app/actions', () => ({ signOut: async () => { order.push('server'); throw new Error('offline') } }))
    const { signOutAndClearDevice } = await import('@/lib/sign-out')
    await expect(signOutAndClearDevice()).rejects.toThrow('offline')
    expect(order).toEqual(['fence', 'latch', 'clear-local', 'clear-cache', 'clear-storage', 'allow', 'server', 'unfence'])
    vi.doUnmock('@/lib/local-store'); vi.doUnmock('@/lib/sqlite/cache'); vi.doUnmock('@/lib/sign-out-storage')
    vi.doUnmock('@/lib/sign-out-fence'); vi.doUnmock('@/app/actions')
  })

  // Senders that bypass fetch (the error reporter's beacon, Sentry's transport) read these.
  it('says when a sign-out runs, and recognises its own refusals', async () => {
    const net = fakeNetwork()
    expect(isSigningOut()).toBe(false)
    const late = net.fetch('/api/user/trophy-pins')
    beginSignOut()
    expect(isSigningOut()).toBe(true)
    const reason = await late.catch((e: unknown) => e)
    expect(isSignOutAbort(reason)).toBe(true)
    expect(isSignOutAbort(new Error('network down'))).toBe(false)
    expect(isSignOutAbort(null)).toBe(false)
    endSignOut()
    expect(isSigningOut()).toBe(false)
  })
})
