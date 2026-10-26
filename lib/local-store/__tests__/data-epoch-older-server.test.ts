import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchServerEpoch } from '../data-epoch'
import { sessionPredatesFromResponse } from '../device-owner'

// A page newer than the server answering it (a deploy's overlap, a rollback) meets a server with no
// /api/account/data-epoch. That server has never reset an account and never stamped a sign-in.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('the data-epoch route on a server from before #3369', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads a 404 as an account never reset, and any other failure as unknown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ epoch: 1793000000 })))
    expect(await fetchServerEpoch()).toBe(1793000000)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html/>', { status: 404 })))
    expect(await fetchServerEpoch()).toBe(0)
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 503)))
    expect(await fetchServerEpoch()).toBeNull()
  })

  it('reads a 404 as a session that predates any owner record, so the rows are adopted', async () => {
    expect(await sessionPredatesFromResponse(new Response('<html/>', { status: 404 }))).toBe(true)
    expect(await sessionPredatesFromResponse(json({ epoch: 0, signedInAt: null }))).toBe(true)
    expect(await sessionPredatesFromResponse(json({ epoch: 0, signedInAt: 1793000000 }))).toBe(false)
    await expect(sessionPredatesFromResponse(json({}, 503))).rejects.toThrow(/HTTP 503/)
  })
})
