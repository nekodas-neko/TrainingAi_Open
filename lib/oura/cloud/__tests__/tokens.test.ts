// The Oura token lifecycle with Oura mocked at `fetch` (#2858). No test here reaches Oura.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OuraCloudTokenRow, SaveOuraCloudTokensInput } from '@/lib/data/postgres/slices/oura-cloud-tokens'
import { OURA_REVOKE_URL, OURA_TOKEN_URL, type OuraOAuthConfig } from '../config'
import { decryptOuraToken, encryptOuraToken } from '../token-cipher'
import {
  confirmOuraTokenRefused, connectOuraAccount, disconnectOuraAccount, getOuraAccessToken, getOuraConnection,
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
        reauthRequiredAt: null,
      }
    },
    // As the slice does: only a row not saved since `since`, and an earlier mark is kept.
    async markOuraCloudReauthRequired(userId, since) {
      if (!row || row.userId !== userId || row.updatedAt.getTime() > since.getTime()) return false
      row = { ...row, reauthRequiredAt: row.reauthRequiredAt ?? new Date(NOW) }
      return true
    },
    async deleteOuraCloudTokens(userId) { const had = row?.userId === userId; row = null; return had },
    async getUserIdByOuraUserId(ouraUserId) { return row && row.ouraUserId === ouraUserId ? row.userId : null },
  }
  return store
}

function storedRow(access: string, refresh: string, expiresAt: number): OuraCloudTokenRow {
  return {
    userId: USER,
    accessToken: encryptOuraToken(access, USER, 'access_token'),
    refreshToken: encryptOuraToken(refresh, USER, 'refresh_token'),
    expiresAt: new Date(expiresAt), scope: 'daily', ouraUserId: 'oura-u1', updatedAt: new Date(NOW - 60_000),
    reauthRequiredAt: null,
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
    store.getUserIdByOuraUserId = async id => (id === 'oura-taken' ? 'someone-else' : null)
    await expect(connectOuraAccount(store, CONFIG, USER, 'c')).rejects.toBeInstanceOf(OuraAccountInUseError)
    expect(String(fetchMock.mock.calls[2][0])).toBe(`${OURA_REVOKE_URL}?access_token=acc-1`)
    expect(startBackfill).not.toHaveBeenCalled()
  })

  // #2911 review: the app finishing one return twice races two saves of the same grant for the same
  // user. The loser hits the `oura_user_id` key; the row that won is this user's, so the connect
  // succeeded and the token must not be revoked.
  it('a unique violation on a row this same user holds is success, and revokes nothing', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 86400 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'oura-mine' }))
    const store = fakeStore()
    const realSave = store.saveOuraCloudTokens
    // The racing finish lands first; this one then collides on `oura_user_id`.
    store.saveOuraCloudTokens = async (userId, input) => {
      await realSave(userId, input)
      throw Object.assign(new Error('dup'), { cause: { code: '23505' } })
    }
    await expect(connectOuraAccount(store, CONFIG, USER, 'c')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.some(c => String(c[0]).startsWith(OURA_REVOKE_URL))).toBe(false)
    expect(store.row()?.userId).toBe(USER)
    expect(startBackfill).toHaveBeenCalledExactlyOnceWith(USER)
  })

  it('a unique violation with no holder found is still refused and revoked', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 86400 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'oura-gone' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    const store = fakeStore()
    store.saveOuraCloudTokens = async () => { throw Object.assign(new Error('dup'), { cause: { code: '23505' } }) }
    await expect(connectOuraAccount(store, CONFIG, USER, 'c')).rejects.toBeInstanceOf(OuraAccountInUseError)
    expect(String(fetchMock.mock.calls[2][0])).toBe(`${OURA_REVOKE_URL}?access_token=acc-1`)
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

  // #2975 review: a refresh answer without `scope` must not wipe the stored grant's list.
  it('keeps the stored scope when the refresh answer has none, and takes a new one when it has', async () => {
    const store = fakeStore({ ...storedRow('acc-1', 'ref-1', NOW - 1), scope: 'extapi:personal extapi:daily' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'acc-2', refresh_token: 'ref-2', expires_in: 86400 }))
    await getOuraAccessToken(store, CONFIG, USER, () => NOW)
    expect(store.row()!.scope).toBe('extapi:personal extapi:daily')

    await store.saveOuraCloudTokens(USER, { ...store.saves[0], expiresAt: new Date(NOW - 1), scope: store.row()!.scope })
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'acc-3', refresh_token: 'ref-3', expires_in: 86400, scope: 'extapi:daily extapi:heartrate' }))
    await getOuraAccessToken(store, CONFIG, USER, () => NOW)
    expect(store.row()!.scope).toBe('extapi:daily extapi:heartrate')
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

  // #3204
  it('records an invalid_grant on the row, then refuses without asking Oura again', async () => {
    const store = fakeStore(storedRow('acc-1', 'ref-1', NOW - 1))
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400))
    await expect(getOuraAccessToken(store, CONFIG, USER, () => NOW)).rejects.toBeInstanceOf(OuraReauthRequiredError)
    expect(store.row()!.reauthRequiredAt).toEqual(new Date(NOW))
    // The tokens are left as they were: the row is the user's to disconnect.
    expect(decryptOuraToken(store.row()!.refreshToken, USER, 'refresh_token')).toBe('ref-1')

    fetchMock.mockClear()
    await expect(getOuraAccessToken(store, CONFIG, USER, () => NOW)).rejects.toBeInstanceOf(OuraReauthRequiredError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a new connect clears the mark, and the new grant is used', async () => {
    const store = fakeStore({ ...storedRow('acc-1', 'ref-1', NOW + 86400_000), reauthRequiredAt: new Date(NOW - 1000) })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'acc-new', refresh_token: 'ref-new', expires_in: 86400, scope: 'extapi:daily' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'oura-u1' }))
    await connectOuraAccount(store, CONFIG, USER, 'code-1')
    expect(store.row()!.reauthRequiredAt).toBeNull()
    expect(await getOuraAccessToken(store, CONFIG, USER, () => NOW)).toBe('acc-new')
  })

  it('does not mark a connection saved while the refused refresh was in flight', async () => {
    const store = fakeStore(storedRow('acc-1', 'ref-1', NOW - 1))
    fetchMock.mockImplementationOnce(async () => {
      // A reconnect lands, with a token already near expiry, so it is not taken as a race's winner.
      await store.saveOuraCloudTokens(USER, {
        accessToken: encryptOuraToken('acc-new', USER, 'access_token'),
        refreshToken: encryptOuraToken('ref-new', USER, 'refresh_token'),
        expiresAt: new Date(NOW + 60_000), scope: 'daily', ouraUserId: 'oura-u1',
      })
      return jsonResponse({ error: 'invalid_grant' }, 400)
    })
    await expect(getOuraAccessToken(store, CONFIG, USER, () => NOW)).rejects.toBeInstanceOf(OuraReauthRequiredError)
    // Oura refused `ref-1`; the row holds `ref-new` now, which nobody has tried.
    expect(store.row()!.reauthRequiredAt).toBeNull()
  })

  describe('confirmOuraTokenRefused (#3204)', () => {
    /** Answers personal_info by the token sent, and the token endpoint with `refresh`. */
    function oura(personalInfo: (token: string) => Response, refresh: () => Response) {
      fetchMock.mockImplementation(async (input, init) => {
        if (String(input) === OURA_TOKEN_URL) return refresh()
        const auth = new Headers(init?.headers).get('Authorization') ?? ''
        return personalInfo(auth.replace(/^Bearer /, ''))
      })
    }
    const refused = () => new Response('', { status: 401 })
    const ok = () => jsonResponse({ id: 'oura-u1' })
    const rotated = () => jsonResponse({ access_token: 'acc-2', refresh_token: 'ref-2', expires_in: 86400 })

    it('is type_refused, with no refresh and no mark, when the token works on personal_info', async () => {
      const store = fakeStore(storedRow('acc-1', 'ref-1', NOW + 86400_000))
      oura(ok, rotated)
      expect(await confirmOuraTokenRefused(store, CONFIG, USER, 'acc-1', () => NOW)).toBe('type_refused')
      expect(store.saves).toHaveLength(0)
      expect(store.row()!.reauthRequiredAt).toBeNull()
    })

    it('is refreshed, with no mark, when only the old access token was dead', async () => {
      const store = fakeStore(storedRow('acc-1', 'ref-1', NOW + 86400_000))
      oura(token => (token === 'acc-2' ? ok() : refused()), rotated)
      expect(await confirmOuraTokenRefused(store, CONFIG, USER, 'acc-1', () => NOW)).toBe('refreshed')
      expect(decryptOuraToken(store.row()!.accessToken, USER, 'access_token')).toBe('acc-2')
      expect(store.row()!.reauthRequiredAt).toBeNull()
    })

    it('marks the row when the freshly refreshed token is refused too', async () => {
      const store = fakeStore(storedRow('acc-1', 'ref-1', NOW + 86400_000))
      oura(refused, rotated)
      expect(await confirmOuraTokenRefused(store, CONFIG, USER, 'acc-1', () => NOW)).toBe('reauth')
      expect(store.row()!.reauthRequiredAt).toEqual(new Date(NOW))
    })

    it('marks the row when the refresh ends in invalid_grant', async () => {
      const store = fakeStore(storedRow('acc-1', 'ref-1', NOW + 86400_000))
      oura(refused, () => jsonResponse({ error: 'invalid_grant' }, 400))
      expect(await confirmOuraTokenRefused(store, CONFIG, USER, 'acc-1', () => NOW)).toBe('reauth')
      expect(store.row()!.reauthRequiredAt).toEqual(new Date(NOW))
    })

    it('tries the token another request stored since, instead of refreshing again', async () => {
      const store = fakeStore(storedRow('acc-other', 'ref-other', NOW + 86400_000))
      oura(token => (token === 'acc-other' ? ok() : refused()), rotated)
      expect(await confirmOuraTokenRefused(store, CONFIG, USER, 'acc-1', () => NOW)).toBe('refreshed')
      expect(fetchMock.mock.calls.some(c => String(c[0]) === OURA_TOKEN_URL)).toBe(false)
    })

    it('marks nothing when a connect lands after the fresh token was read', async () => {
      const store = fakeStore(storedRow('acc-1', 'ref-1', NOW + 86400_000))
      let probes = 0
      oura(() => {
        // The second probe is of the refreshed token; a reconnect lands just before Oura answers it.
        if (++probes === 2) {
          void store.saveOuraCloudTokens(USER, {
            accessToken: encryptOuraToken('acc-new', USER, 'access_token'),
            refreshToken: encryptOuraToken('ref-new', USER, 'refresh_token'),
            expiresAt: new Date(NOW + 86400_000), scope: 'daily', ouraUserId: 'oura-u1',
          })
        }
        return refused()
      }, rotated)
      expect(await confirmOuraTokenRefused(store, CONFIG, USER, 'acc-1', () => NOW)).toBe('reauth')
      expect(store.row()!.reauthRequiredAt).toBeNull()
      expect(decryptOuraToken(store.row()!.accessToken, USER, 'access_token')).toBe('acc-new')
    })

    it('propagates an unreachable Oura and marks nothing', async () => {
      const store = fakeStore(storedRow('acc-1', 'ref-1', NOW + 86400_000))
      oura(() => new Response('', { status: 503 }), rotated)
      await expect(confirmOuraTokenRefused(store, CONFIG, USER, 'acc-1', () => NOW)).rejects.toThrow(/503/)
      expect(store.row()!.reauthRequiredAt).toBeNull()
    })
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

  // #3227: a grant Oura refused must not read as connected, or the screen hides "Connect".
  it('reports a grant Oura refused as not connected, with reauthRequired', async () => {
    const store = fakeStore({ ...storedRow('acc-1', 'ref-1', NOW + 86400_000), reauthRequiredAt: new Date(NOW - 1000) })
    expect(await getOuraConnection(store, USER)).toEqual({ connected: false, scope: null, expiresAt: null, reauthRequired: true })
  })

  it('leaves an unmarked connection as it was, with no reauthRequired field', async () => {
    const store = fakeStore(storedRow('acc-1', 'ref-1', NOW + 86400_000))
    const connection = await getOuraConnection(store, USER)
    expect(connection).toEqual({ connected: true, scope: 'daily', expiresAt: new Date(NOW + 86400_000).toISOString() })
    expect('reauthRequired' in connection).toBe(false)
  })

  it('reads as connected again once a reconnect clears the mark', async () => {
    const store = fakeStore({ ...storedRow('acc-1', 'ref-1', NOW + 86400_000), reauthRequiredAt: new Date(NOW - 1000) })
    expect((await getOuraConnection(store, USER)).connected).toBe(false)
    await store.saveOuraCloudTokens(USER, {
      accessToken: encryptOuraToken('acc-2', USER, 'access_token'),
      refreshToken: encryptOuraToken('ref-2', USER, 'refresh_token'),
      expiresAt: new Date(NOW + 86400_000), scope: 'daily', ouraUserId: 'oura-u1',
    })
    expect(await getOuraConnection(store, USER)).toMatchObject({ connected: true, scope: 'daily' })
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
