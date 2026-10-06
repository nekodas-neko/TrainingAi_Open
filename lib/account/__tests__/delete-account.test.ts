// #2120 — the device half of account deletion: server first, then this phone's copy, then sign-in.
//
// The ring's BLE key must survive it (owner, 2026-09-24): it belongs to the phone, and clearing it
// cannot be undone without a factory reset and re-pair. The bridge is mocked at BOTH ways the app can
// reach it — the `getOuraBle()` helper and Capacitor's `registerPlugin` — as a proxy that records any
// method called on it, so the assertion is "nothing touched the ring", not just "not clearKey".
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { bridgeCalls, bridge, order } = vi.hoisted(() => {
  const bridgeCalls: string[] = []
  const bridge = new Proxy({}, {
    get: (_t, k) => (typeof k === 'string' && k !== 'then' ? (...a: unknown[]) => { bridgeCalls.push(k); void a; return Promise.resolve({}) } : undefined),
  })
  return { bridgeCalls, bridge, order: [] as string[] }
})

vi.mock('@/lib/oura-ble/plugin', () => ({ getOuraBle: vi.fn(async () => ({ plugin: bridge })) }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => bridge,
}))

const clearLocalStoreData = vi.fn(async () => { order.push('clear-local-store') })
const clearAllCache = vi.fn(async () => { order.push('clear-cache') })
const disableCacheWrites = vi.fn(() => { order.push('disable-cache-writes') })
const serverSignOut = vi.fn(async () => { order.push('server-sign-out') })
vi.mock('@/lib/local-store', () => ({ clearLocalStoreData: () => clearLocalStoreData() }))
vi.mock('@/lib/sqlite/cache', () => ({ clearAllCache: () => clearAllCache(), disableCacheWrites: () => disableCacheWrites() }))
vi.mock('@/app/actions', () => ({ signOut: () => serverSignOut() }))

const replace = vi.fn()
vi.stubGlobal('window', { location: { replace } })

const respond = (status: number, body: unknown = {}) =>
  vi.fn(async (url: string, init: RequestInit) => {
    order.push(`fetch ${init.method} ${url}`)
    return { ok: status < 400, status, json: async () => body } as Response
  })

import { deleteAccountAndSignOut } from '../delete-account'

describe('deleteAccountAndSignOut (#2120)', () => {
  beforeEach(() => {
    bridgeCalls.length = 0
    order.length = 0
    vi.clearAllMocks()
  })

  it('deletes on the server, THEN wipes this phone and signs out — and never touches the ring', async () => {
    const fetchMock = respond(200, { ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const onDeleted = vi.fn(() => { order.push('on-deleted') })

    expect(await deleteAccountAndSignOut('DELETE', onDeleted)).toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ confirm: 'DELETE' })
    expect(order).toEqual([
      'fetch DELETE /api/account', 'on-deleted',
      'disable-cache-writes', 'clear-local-store', 'clear-cache', 'server-sign-out',
    ])
    expect(bridgeCalls).toEqual([])
  })

  it.each([
    [500, { error: 'Your account could not be deleted, and nothing was removed. Try again.' }, /nothing was removed/],
    [401, {}, /session has ended/],
    [429, {}, /Too many attempts/],
    [400, { error: 'Type DELETE to confirm.' }, /Type DELETE/],
  ])('keeps everything on this phone when the server answers %i', async (status, body, message) => {
    vi.stubGlobal('fetch', respond(status, body))
    const outcome = await deleteAccountAndSignOut('DELETE')
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.error).toMatch(message)
    // Unsynced changes for an account that still exists live only here.
    expect(clearLocalStoreData).not.toHaveBeenCalled()
    expect(serverSignOut).not.toHaveBeenCalled()
    expect(bridgeCalls).toEqual([])
  })

  it('keeps everything on this phone when offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const outcome = await deleteAccountAndSignOut('DELETE')
    expect(outcome.ok === false && outcome.error).toMatch(/No connection/)
    expect(clearLocalStoreData).not.toHaveBeenCalled()
  })

  it('still leaves for sign-in when the server sign-out throws after a completed deletion', async () => {
    vi.stubGlobal('fetch', respond(200, { ok: true }))
    serverSignOut.mockRejectedValueOnce(new Error('action failed'))
    expect(await deleteAccountAndSignOut('DELETE')).toEqual({ ok: true })
    expect(clearLocalStoreData).toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/sign-in')
    expect(bridgeCalls).toEqual([])
  })
})
