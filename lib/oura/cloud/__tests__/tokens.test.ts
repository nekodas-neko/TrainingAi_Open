// The Oura token lifecycle with Oura mocked at `fetch` (#2858). No test here reaches Oura.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OuraCloudTokenRow, SaveOuraCloudTokensInput } from '@/lib/data/postgres/slices/oura-cloud-tokens'
import { OURA_REVOKE_URL, OURA_TOKEN_URL, type OuraOAuthConfig } from '../config'
import { decryptOuraToken, encryptOuraToken } from '../token-cipher'
import {
  connectOuraAccount, disconnectOuraAccount, getOuraAccessToken, getOuraConnection,
  OuraAccountInUseError, OuraReauthRequiredError, REFRESH_MARGIN_MS, type OuraTokenStore,
} from '../tokens'

const USER = '11111111-1111-4111-8111-111111111111'
const CONFIG: OuraOAuthConfig = { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'http://localhost:3000/api/oura/callback' }
const NOW = Date.parse('2026-10-14T02:00:00Z')

function fakeStore(initial: OuraCloudTokenRow | null = null) {
  let row = initial
  let tick = 0
  const store: OuraTokenStore & { row: () => OuraCloudTokenRow | null; saves: SaveOuraCloudTokensInput[] } = {
    saves: [],
    row: () => row,
    async getOuraCloudTokens(userId) { return row && row.userId === userId ? { ...row } : null },
    async saveOuraCloudTokens(userId, input) {
      store.saves.push(input)
      row = {
        userId, accessToken: input.accessToken, refreshToken: input.refreshToken, expiresAt: input.expiresAt,
        scope: input.scope, ouraUserId: input.ouraUserId ?? row?.ouraUserId ?? null, updatedAt: new Date(NOW + ++tick),
      }
    },
    async deleteOuraCloudTokens(userId) { const had = row?.userId === userId; row = null; return had },
  }
  return store
}

function storedRow(access: string, refresh: string, expiresAt: number): OuraCloudTokenRow {
  return {
    userId: USER,
    accessToken: encryptOuraToken(access, USER, 'access_token'),
    refreshToken: encryptOuraToken(refresh, USER, 'refresh_token'),
    expiresAt: new Date(expiresAt), scope: 'daily', ouraUserId: 'oura-u1', updatedAt: new Date(NOW - 60_000),
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const fetchMock = vi.fn<typeof fetch>()
// The connect hook starts the history read (#2859); here it only has to be called, never run.
const startBackfill = vi.hoisted(() => vi.fn())
vi.mock('../backfill', () => ({ startOuraConnectBackfill: startBackfill }))

describe('Oura tokens: connect, refresh before expiry, disconnect (#2858)', () => {
  const savedKey = process.env.OURA_TOKEN_KEY
  beforeEach(() => {
    process.env.OURA_TOKEN_KEY = 'k'.repeat(48)
    fetchMock.mockReset()
    startBackfill.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    process.env.OURA_TOKEN_KEY = savedKey
    vi.unstubAllGlobals()
  })

  it('connect trades the code, learns the Oura user id, and stores only ciphertext', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 86400, token_type: 'bearer', scope: 'daily heartrate' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'oura-u1', age: 40 }))
    const store = fakeStore()
    await connectOuraAccount(store, CONFIG, USER, 'the-code')

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]
    expect(tokenUrl).toBe(OURA_TOKEN_URL)
    const form = new URLSearchParams(String(tokenInit?.body))
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'authorization_code', code: 'the-code', redirect_uri: CONFIG.redirectUri, client_id: 'cid', client_secret: 'csecret',
    })
    expect((fetchMock.mock.calls[1][1]?.headers as Record<string, string>).Authorization).toBe('Bearer acc-1')

    const row = store.row()!
    expect(row.accessToken).not.toContain('acc-1')
    expect(row.refreshToken).not.toContain('ref-1')
    expect(decryptOuraToken(row.accessToken, USER, 'access_token')).toBe('acc-1')
    expect(decryptOuraToken(row.refreshToken, USER, 'refresh_token')).toBe('ref-1')
    expect(row.ouraUserId).toBe('oura-u1')
    expect(row.scope).toBe('daily heartrate')
    expect(await getOuraConnection(store, USER)).toMatchObject({ connected: true, scope: 'daily heartrate' })
    // #2859: a stored connection starts its history read, once.
    expect(startBackfill).toHaveBeenCalledExactlyOnceWith(USER)
  })

  it('connect refuses an Oura account another user holds, and revokes the grant it just got', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 86400 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'oura-taken' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    const store = fakeStore()
    store.saveOuraCloudTokens = async () => { throw Object.assign(new Error('dup'), { cause: { code: '23505' } }) }
    await expect(connectOuraAccount(store, CONFIG, USER, 'c')).rejects.toBeInstanceOf(OuraAccountInUseError)
    expect(String(fetchMock.mock.calls[2][0])).toBe(`${OURA_REVOKE_URL}?access_token=acc-1`)
    expect(startBackfill).not.toHaveBeenCalled()
  })

  it('connect stores nothing when the token response is malformed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'acc-1' }))
    const store = fakeStore()
    await expect(connectOuraAccount(store, CONFIG, USER, 'c')).rejects.toThrow(/unexpected shape/)
    expect(store.row()).toBeNull()
  })

  it('hands back the stored token without calling Oura while it has more than the margin left', async () => {
    const store = fakeStore(storedRow('acc-1', 'ref-1', NOW + REFRESH_MARGIN_MS + 60_000))
    expect(await getOuraAccessToken(store, CONFIG, USER, () => NOW)).toBe('acc-1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes before expiry, inside the margin, and stores the rotated pair encrypted', async () => {
    const store = fakeStore(storedRow('acc-1', 'ref-1', NOW + REFRESH_MARGIN_MS - 60_000))
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'acc-2', refresh_token: 'ref-2', expires_in: 86400 }))
    expect(await getOuraAccessToken(store, CONFIG, USER, () => NOW)).toBe('acc-2')

    const form = Object.fromEntries(new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)))
    expect(form).toEqual({ grant_type: 'refresh_token', refresh_token: 'ref-1', client_id: 'cid', client_secret: 'csecret' })
    const row = store.row()!
    expect(decryptOuraToken(row.refreshToken, USER, 'refresh_token')).toBe('ref-2')
    expect(row.expiresAt?.getTime()).toBe(NOW + 86400_000)
    expect(row.ouraUserId).toBe('oura-u1')
  })

  it('runs one refresh for concurrent callers, because Oura rotates the refresh token', async () => {
    const store = fakeStore(storedRow('acc-1', 'ref-1', NOW - 1))
    let release!: (r: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>(r => { release = r }))
    const a = getOuraAccessToken(store, CONFIG, USER, () => NOW)
    const b = getOuraAccessToken(store, CONFIG, USER, () => NOW)
    await new Promise(r => setTimeout(r, 0))
    release(jsonResponse({ access_token: 'acc-2', refresh_token: 'ref-2', expires_in: 86400 }))
    expect(await Promise.all([a, b])).toEqual(['acc-2', 'acc-2'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('asks for a reconnect when Oura rejects the refresh token', async () => {
    const store = fakeStore(storedRow('acc-1', 'ref-1', NOW - 1))
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400))
    await expect(getOuraAccessToken(store, CONFIG, USER, () => NOW)).rejects.toBeInstanceOf(OuraReauthRequiredError)
    expect(store.row()).not.toBeNull() // the row is the user's to disconnect, not ours to drop
  })

  it('uses the token another replica just refreshed instead of asking for a reconnect', async () => {
    const store = fakeStore(storedRow('acc-1', 'ref-1', NOW - 1))
    fetchMock.mockImplementationOnce(async () => {
      // The other replica wins the race while this request is in flight.
      await store.saveOuraCloudTokens(USER, {
        accessToken: encryptOuraToken('acc-other', USER, 'access_token'),
        refreshToken: encryptOuraToken('ref-other', USER, 'refresh_token'),
        expiresAt: new Date(NOW + 86400_000), scope: 'daily',
      })
      return jsonResponse({ error: 'invalid_grant' }, 400)
    })
    expect(await getOuraAccessToken(store, CONFIG, USER, () => NOW)).toBe('acc-other')
  })

  it('treats a row that does not decrypt as no connection, and never sends it to Oura', async () => {
    const store = fakeStore({ ...storedRow('a', 'r', NOW + 86400_000), accessToken: 'plaintext-from-2026-07' as never })
    expect(await getOuraAccessToken(store, CONFIG, USER, () => NOW)).toBeNull()
    expect(await getOuraConnection(store, USER)).toEqual({ connected: false, scope: null, expiresAt: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('disconnect revokes at Oura and deletes the row', async () => {
    const store = fakeStore(storedRow('acc-1', 'ref-1', NOW + 86400_000))
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))
    expect(await disconnectOuraAccount(store, USER)).toEqual({ deleted: true, revoked: true })
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${OURA_REVOKE_URL}?access_token=acc-1`)
    expect(store.row()).toBeNull()
  })

  it('disconnect still deletes the row when Oura is unreachable or the key is gone', async () => {
    const store = fakeStore(storedRow('acc-1', 'ref-1', NOW + 86400_000))
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await disconnectOuraAccount(store, USER)).toEqual({ deleted: true, revoked: false })

    const keyless = fakeStore(storedRow('acc-1', 'ref-1', NOW + 86400_000))
    delete process.env.OURA_TOKEN_KEY
    expect(await disconnectOuraAccount(keyless, USER)).toEqual({ deleted: true, revoked: false })
    expect(keyless.row()).toBeNull()
  })
})
