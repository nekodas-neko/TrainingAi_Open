// @vitest-environment jsdom
// #3125 — the pins this browser kept before the account held them move over once. The server refuses
// a whole list when any id is locked or unknown, so an old list that was kept and retried on every
// load would never get through: it is cut to unlocked ids first, and a refusal drops it.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const invalidate = vi.fn(async () => {})
vi.mock('@/lib/cache-groups', () => ({ invalidateTrophyPins: () => invalidate() }))

import { carryOverLegacyPins, savePins, readLegacyPins } from '@/lib/trophy/trophy-pins-client'

const LEGACY = 'ta_trophy_case'
const unlocked = new Set(['a', 'b', 'c'])
let status = 200
const put = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status }))

beforeEach(() => {
  localStorage.clear()
  status = 200
  put.mockClear()
  invalidate.mockClear()
  vi.stubGlobal('fetch', put)
})

describe('savePins', () => {
  it('saves and clears the cached pins', async () => {
    expect(await savePins(['a', 'b'])).toBe('saved')
    expect(JSON.parse(String(put.mock.calls[0][1]?.body))).toEqual({ pins: ['a', 'b'] })
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it.each([[403, 'refused'], [400, 'refused'], [500, 'failed'], [429, 'failed']])('maps a %i to %s', async (code, expected) => {
    status = code
    expect(await savePins(['a'])).toBe(expected)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('reports failed when the network is down', async () => {
    put.mockRejectedValueOnce(new TypeError('offline'))
    expect(await savePins(['a'])).toBe('failed')
  })
})

describe('carryOverLegacyPins', () => {
  it('sends only the ids that are unlocked now, then drops the old list', async () => {
    localStorage.setItem(LEGACY, JSON.stringify(['a', 'gone', 'b']))
    await carryOverLegacyPins(null, unlocked)
    expect(JSON.parse(String(put.mock.calls[0][1]?.body))).toEqual({ pins: ['a', 'b'] })
    expect(readLegacyPins()).toEqual([])
  })

  it('drops a list with nothing unlocked in it without sending it', async () => {
    localStorage.setItem(LEGACY, JSON.stringify(['gone']))
    await carryOverLegacyPins(null, unlocked)
    expect(put).not.toHaveBeenCalled()
    expect(readLegacyPins()).toEqual([])
  })

  it('drops the list when the server refuses it, so it is not retried on every load', async () => {
    status = 403
    localStorage.setItem(LEGACY, JSON.stringify(['a']))
    await carryOverLegacyPins(null, unlocked)
    expect(readLegacyPins()).toEqual([])
  })

  it('keeps the list when the failure could clear (offline, server error)', async () => {
    status = 503
    localStorage.setItem(LEGACY, JSON.stringify(['a']))
    await carryOverLegacyPins(null, unlocked)
    expect(readLegacyPins()).toEqual(['a'])
  })

  it('leaves an account that already has pins alone, and drops the old list', async () => {
    localStorage.setItem(LEGACY, JSON.stringify(['a']))
    await carryOverLegacyPins(['b'], unlocked)
    expect(put).not.toHaveBeenCalled()
    expect(readLegacyPins()).toEqual([])
  })

  it('waits when nothing is known to be unlocked yet', async () => {
    localStorage.setItem(LEGACY, JSON.stringify(['a']))
    await carryOverLegacyPins(null, new Set())
    expect(put).not.toHaveBeenCalled()
    expect(readLegacyPins()).toEqual(['a'])
  })
})
