// A user's Oura Cloud connection (#2858): connect, get a usable access token, report, disconnect.
//
// This is where plaintext tokens exist, briefly: they arrive from `client.ts`, are encrypted with
// `token-cipher.ts`, and only ciphertext reaches the store. A token is never logged or returned to a
// browser.
//
// **Refresh before expiry.** `getOuraAccessToken` refreshes when the access token has less than
// `REFRESH_MARGIN_MS` left, so a caller never sends an expired one. Oura rotates the refresh token
// on every use, so two refreshes racing with the same one would leave the loser holding a dead
// token: refreshes are single-flight per user within the process. Across replicas the loser gets
// `invalid_grant`, reads the winner's row, and uses it.
//
// **A refused grant is recorded (#3204).** When Oura refuses a refresh with `invalid_grant`, or
// refuses a freshly refreshed token on the scope-free `personal_info` read (`confirmOuraTokenRefused`),
// `oura_tokens.reauth_required_at` is set. From then on `getOuraAccessToken` refuses without asking
// Oura, and the readiness payload reports the connection as not delivering, until new tokens are
// saved (a connect, which clears the mark).
import type { OuraCloudTokenRow, SaveOuraCloudTokensInput } from '@/lib/data/postgres/slices/oura-cloud-tokens'
import { exchangeAuthorizationCode, fetchOuraUserId, OuraGrantRejectedError, OuraUnavailableError, refreshAccessToken, revokeAccessToken } from './client'
import { grantedOuraScopes, type OuraOAuthConfig } from './config'
import { decryptOuraToken, encryptOuraToken, OuraTokenKeyMissingError } from './token-cipher'
import { startOuraConnectBackfill } from './backfill'

/** Refresh when less than this is left. Oura's access tokens last about a day. */
export const REFRESH_MARGIN_MS = 10 * 60 * 1000

/** The slice of the repository this module needs, so tests can hand it a fake. */
export interface OuraTokenStore {
  getOuraCloudTokens(userId: string): Promise<OuraCloudTokenRow | null>
  saveOuraCloudTokens(userId: string, input: SaveOuraCloudTokensInput): Promise<void>
  markOuraCloudReauthRequired(userId: string, unchangedSince: Date): Promise<boolean>
  /** #2861: when the feed last spoke; see `freshness.ts`. */
  touchOuraCloudWebhook(userId: string): Promise<void>
  touchOuraCloudData(userId: string): Promise<void>
  deleteOuraCloudTokens(userId: string): Promise<boolean>
  getUserIdByOuraUserId(ouraUserId: string): Promise<string | null>
}

/** The Oura account is already linked to another user here (`oura_tokens.oura_user_id` is unique). */
export class OuraAccountInUseError extends Error {
  constructor() {
    super('This Oura account is already connected to another TrainingAI user.')
    this.name = 'OuraAccountInUseError'
  }
}

/** The user has to connect again: the refresh token was revoked, rotated away, or expired. */
export class OuraReauthRequiredError extends Error {
  constructor() {
    super('The Oura connection has to be renewed by connecting again.')
    this.name = 'OuraReauthRequiredError'
  }
}

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '23505') return true
  }
  return false
}

function encrypted(userId: string, grant: { accessToken: string; refreshToken: string }) {
  return {
    accessToken: encryptOuraToken(grant.accessToken, userId, 'access_token'),
    refreshToken: encryptOuraToken(grant.refreshToken, userId, 'refresh_token'),
  }
}

/** A grant Oura issued for one consent, with the Oura account it belongs to. Not stored yet. */
export interface OuraGrant {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scope: string | null
  ouraUserId: string
}

/** Trades the code for tokens and learns which Oura account they belong to. Stores nothing. */
export async function exchangeOuraCode(config: OuraOAuthConfig, code: string): Promise<OuraGrant> {
  const grant = await exchangeAuthorizationCode(config, code)
  const ouraUserId = await fetchOuraUserId(grant.accessToken)
  return { ...grant, ouraUserId }
}

/**
 * Stores a grant for `userId`. The caller must already have proved that the request committing it
 * is authenticated as `userId` (see the callback and `/api/oura/connect/complete`).
 *
 * Once stored, the history read starts in the background (#2859, `backfill.ts`): both connect legs,
 * web and native, finish here, so this is the one place it hooks in. `afterConnect` is replaceable
 * for tests.
 */
export async function storeOuraGrant(
  store: OuraTokenStore, userId: string, grant: OuraGrant,
  afterConnect: (userId: string) => void = startOuraConnectBackfill,
): Promise<void> {
  try {
    await store.saveOuraCloudTokens(userId, {
      ...encrypted(userId, grant),
      expiresAt: grant.expiresAt,
      scope: grant.scope,
      ouraUserId: grant.ouraUserId,
    })
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    // The only other unique key is `oura_user_id`. Two finishes of the same connect racing each
    // other (the app delivering one return twice) collide on it too: both insert for this user, and
    // `ON CONFLICT (user_id)` covers only one key. Then the row that won is this user's, holding the
    // same grant, and revoking would kill the token just stored (#2911 review).
    const holder = await store.getUserIdByOuraUserId(grant.ouraUserId)
    if (holder !== userId) {
      // Do not leave a live grant behind for an account we refused to store.
      await revokeAccessToken(grant.accessToken)
      throw new OuraAccountInUseError()
    }
  }
  afterConnect(userId)
}

/** Refuses a grant: revokes it at Oura (best effort) and stores nothing. */
export async function discardOuraGrant(grant: Pick<OuraGrant, 'accessToken'>): Promise<void> {
  await revokeAccessToken(grant.accessToken)
}

/** Exchange and store in one step, for a request already authenticated as `userId`. */
export async function connectOuraAccount(store: OuraTokenStore, config: OuraOAuthConfig, userId: string, code: string): Promise<void> {
  await storeOuraGrant(store, userId, await exchangeOuraCode(config, code))
}

export interface OuraConnection {
  connected: boolean
  scope: string | null
  expiresAt: string | null
  /** #2861: when the last verified webhook event arrived (ISO), or null before the first. */
  lastWebhookAt?: string | null
  /** #2861: when Oura data was last written for the user (ISO), or null before the first. */
  lastDataAt?: string | null
  /** Present (and `true`) only when Oura refused the grant (#3204): the user has to connect again. */
  reauthRequired?: true
}

/**
 * Connected means both tokens are stored and open under this key, not merely that a row exists, and
 * that Oura has not refused the grant (#3227). A refused grant reads as not connected with
 * `reauthRequired`, so the existing screens offer "Connect" again; a connect clears the mark.
 */
export async function getOuraConnection(store: OuraTokenStore, userId: string): Promise<OuraConnection> {
  const row = await store.getOuraCloudTokens(userId)
  const stored = !!row &&
    decryptOuraToken(row.accessToken, userId, 'access_token') !== null &&
    decryptOuraToken(row.refreshToken, userId, 'refresh_token') !== null
  if (stored && row.reauthRequiredAt) return { connected: false, scope: null, expiresAt: null, reauthRequired: true }
  if (!row || !stored) return { connected: false, scope: null, expiresAt: null }
  return {
    connected: true,
    scope: row.scope,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastWebhookAt: row.lastWebhookAt?.toISOString() ?? null,
    lastDataAt: row.lastDataAt?.toISOString() ?? null,
  }
}

/**
 * The scopes the user's stored grant covers (`grantedOuraScopes`), or `null` when there is no row or
 * it carries no scope string. Read it after `getOuraAccessToken`, so a refresh's answer counts.
 */
export async function getOuraGrantedScopes(store: Pick<OuraTokenStore, 'getOuraCloudTokens'>, userId: string): Promise<ReadonlySet<string> | null> {
  const row = await store.getOuraCloudTokens(userId)
  return grantedOuraScopes(row?.scope)
}

const inFlight = new Map<string, Promise<string>>()

/**
 * A usable access token for the user, refreshed first when it is near expiry. `null` when the user
 * has no usable connection. Throws `OuraReauthRequiredError` when Oura refused the refresh, or
 * refused the grant earlier (`reauth_required_at`, #3204: a grant Oura has refused is not sent to it
 * again), and the client's `OuraUnavailableError` when Oura could not be reached.
 */
export async function getOuraAccessToken(
  store: OuraTokenStore, config: OuraOAuthConfig, userId: string, now: () => number = Date.now,
): Promise<string | null> {
  const row = await store.getOuraCloudTokens(userId)
  if (!row) return null
  const accessToken = decryptOuraToken(row.accessToken, userId, 'access_token')
  const refreshToken = decryptOuraToken(row.refreshToken, userId, 'refresh_token')
  if (!accessToken || !refreshToken) return null
  if (row.reauthRequiredAt) throw new OuraReauthRequiredError()
  if (row.expiresAt && row.expiresAt.getTime() - now() > REFRESH_MARGIN_MS) return accessToken
  return refreshOnce(store, config, userId, refreshToken, row, now)
}

/** One refresh per user at a time in this process; a caller arriving mid-refresh shares its answer. */
function refreshOnce(
  store: OuraTokenStore, config: OuraOAuthConfig, userId: string, refreshToken: string, row: OuraCloudTokenRow,
  now: () => number,
): Promise<string> {
  const running = inFlight.get(userId)
  if (running) return running
  const refresh = refreshNow(store, config, userId, refreshToken, row.updatedAt, row.scope, now)
    .finally(() => inFlight.delete(userId))
  inFlight.set(userId, refresh)
  return refresh
}

async function refreshNow(
  store: OuraTokenStore, config: OuraOAuthConfig, userId: string, refreshToken: string, readAt: Date, storedScope: string | null,
  now: () => number,
): Promise<string> {
  try {
    const grant = await refreshAccessToken(config, refreshToken, now())
    // A refresh answer may leave `scope` out. Writing that `null` would make the grant read as
    // "covers everything" and bring back the 401 stop on an unshared type (#2974), so keep the stored list.
    await store.saveOuraCloudTokens(userId, { ...encrypted(userId, grant), expiresAt: grant.expiresAt, scope: grant.scope ?? storedScope })
    return grant.accessToken
  } catch (err) {
    if (!(err instanceof OuraGrantRejectedError) || err.oauthError !== 'invalid_grant') throw err
    // Another replica may have used this refresh token a moment ago. If the row moved on and now
    // holds a fresh token, that is the answer; otherwise the grant is really gone.
    const latest = await store.getOuraCloudTokens(userId)
    if (latest && latest.updatedAt.getTime() > readAt.getTime() && latest.expiresAt && latest.expiresAt.getTime() - now() > REFRESH_MARGIN_MS) {
      const token = decryptOuraToken(latest.accessToken, userId, 'access_token')
      if (token) return token
    }
    // #3204: recorded, so the connection stops reading as connected. Guarded by the row this refresh
    // token came from: a save since holds other tokens, and Oura refused this one, not those. A failed
    // write throws, and this call fails rather than leaving the grant looking alive.
    await store.markOuraCloudReauthRequired(userId, readAt)
    throw new OuraReauthRequiredError()
  }
}

/**
 * What a 401 on a route the grant covers meant (`confirmOuraTokenRefused`):
 *  - `type_refused`: the token works; Oura refused that one type (a scope our map guessed wrong).
 *  - `refreshed`: the old access token was dead, and a fresh one that works is stored now.
 *  - `reauth`: the grant is gone. Recorded, unless the row moved on meanwhile.
 */
export type OuraRefusalVerdict = 'type_refused' | 'refreshed' | 'reauth'

/** True when `personal_info` answers for `token`, false on a 401. Anything else propagates. */
async function tokenAnswers(token: string): Promise<boolean> {
  try {
    await fetchOuraUserId(token)
    return true
  } catch (err) {
    if (err instanceof OuraUnavailableError && err.status === 401) return false
    throw err
  }
}

/**
 * Called after Oura answered 401 to `refused`, a token from `getOuraAccessToken`, on a route the grant
 * covers by our scope map (#3204). A 401 alone does not prove the grant is gone: Oura answers it for a
 * type whose scope was not granted too, and the map is partly a guess (`OURA_SCOPE_FOR`). So:
 *  1. `refused` is tried on `personal_info`, which needs no scope beyond the `personal` every stored
 *     grant has (connecting reads it, `exchangeOuraCode`). If it answers, the refusal was the type's.
 *  2. Otherwise a fresh token: the one another request has stored since, else a refresh made now,
 *     whatever its expiry. A refresh ending in `invalid_grant` is recorded by `refreshNow`.
 *  3. The fresh token is tried on `personal_info`. If Oura refuses it too, the grant is recorded as
 *     refused, guarded by the row the fresh token came from.
 * Oura unreachable at any step propagates, and nothing is recorded. Never logs or returns a token.
 */
export async function confirmOuraTokenRefused(
  store: OuraTokenStore, config: OuraOAuthConfig, userId: string, refused: string, now: () => number = Date.now,
): Promise<OuraRefusalVerdict> {
  if (await tokenAnswers(refused)) return 'type_refused'
  const row = await store.getOuraCloudTokens(userId)
  if (!row || row.reauthRequiredAt) return 'reauth'
  const stored = decryptOuraToken(row.accessToken, userId, 'access_token')
  const refreshToken = decryptOuraToken(row.refreshToken, userId, 'refresh_token')
  if (!stored || !refreshToken) return 'reauth'
  let fresh: string
  try {
    fresh = stored !== refused ? stored : await refreshOnce(store, config, userId, refreshToken, row, now)
  } catch (err) {
    if (err instanceof OuraReauthRequiredError) return 'reauth'
    throw err
  }
  if (await tokenAnswers(fresh)) return 'refreshed'
  const latest = await store.getOuraCloudTokens(userId)
  if (latest && decryptOuraToken(latest.accessToken, userId, 'access_token') === fresh) {
    await store.markOuraCloudReauthRequired(userId, latest.updatedAt)
  }
  return 'reauth'
}

/**
 * Revokes the access token at Oura (best effort) and deletes the row. The row goes even when the
 * revoke fails, the stored value no longer decrypts, or `OURA_TOKEN_KEY` is missing: the user asked
 * to disconnect, and keeping a credential they asked us to forget is the worse failure.
 */
export async function disconnectOuraAccount(store: OuraTokenStore, userId: string): Promise<{ deleted: boolean; revoked: boolean }> {
  const row = await store.getOuraCloudTokens(userId)
  if (!row) return { deleted: false, revoked: false }
  let accessToken: string | null = null
  try {
    accessToken = decryptOuraToken(row.accessToken, userId, 'access_token')
  } catch (err) {
    // Without the key there is nothing to revoke with, but the row still goes.
    if (!(err instanceof OuraTokenKeyMissingError)) throw err
  }
  const revoked = accessToken ? await revokeAccessToken(accessToken) : false
  const deleted = await store.deleteOuraCloudTokens(userId)
  return { deleted, revoked }
}
