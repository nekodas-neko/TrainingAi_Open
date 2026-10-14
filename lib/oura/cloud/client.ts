// The Oura Cloud HTTP calls for connecting an account (#2858): exchange a code, refresh, revoke,
// and read the Oura user id. Every response is parsed with Zod; a body that does not match is an
// error, never a half-filled token.
//
// Nothing here touches the database or sees a ciphertext. `tokens.ts` decides when to call these.
import { z } from 'zod'
import { OURA_API_BASE, OURA_REQUEST_TIMEOUT_MS, OURA_REVOKE_URL, OURA_TOKEN_URL, type OuraOAuthConfig } from './config'

/** Oura refused the grant (bad, used or expired code; revoked or rotated refresh token). */
export class OuraGrantRejectedError extends Error {
  constructor(readonly status: number, readonly oauthError: string | null) {
    super(`Oura rejected the grant (${status}${oauthError ? ` ${oauthError}` : ''})`)
    this.name = 'OuraGrantRejectedError'
  }
}

/** Oura was unreachable, slow, or answered something we cannot use. Worth retrying later. */
export class OuraUnavailableError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message)
    this.name = 'OuraUnavailableError'
  }
}

// RFC 6749 §5.1. Oura's spec does not model the token response, so this is the standard shape,
// with `refresh_token` required: a connection that cannot refresh dies within a day.
const TokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
})

const OAuthErrorBody = z.object({ error: z.string() }).passthrough()

// `GET /v2/usercollection/personal_info`: `id` is the only required field (spec `PersonalInfoResponse`).
const PersonalInfo = z.object({ id: z.string().min(1) }).passthrough()

export interface OuraTokenGrant {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scope: string | null
}

async function postForm(url: string, form: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(OURA_REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    throw new OuraUnavailableError(`Oura could not be reached: ${err instanceof Error ? err.name : 'unknown'}`)
  }
}

async function readGrant(res: Response, now: number): Promise<OuraTokenGrant> {
  const body: unknown = await res.json().catch(() => null)
  if (res.status === 400 || res.status === 401) {
    const parsed = OAuthErrorBody.safeParse(body)
    throw new OuraGrantRejectedError(res.status, parsed.success ? parsed.data.error : null)
  }
  if (!res.ok) throw new OuraUnavailableError(`Oura's token endpoint answered ${res.status}`, res.status)
  const parsed = TokenResponse.safeParse(body)
  if (!parsed.success) throw new OuraUnavailableError("Oura's token response had an unexpected shape")
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresAt: new Date(now + parsed.data.expires_in * 1000),
    scope: parsed.data.scope ?? null,
  }
}

export async function exchangeAuthorizationCode(config: OuraOAuthConfig, code: string, now = Date.now()): Promise<OuraTokenGrant> {
  const res = await postForm(OURA_TOKEN_URL, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  })
  return readGrant(res, now)
}

export async function refreshAccessToken(config: OuraOAuthConfig, refreshToken: string, now = Date.now()): Promise<OuraTokenGrant> {
  const res = await postForm(OURA_TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  })
  return readGrant(res, now)
}

/** Best effort: `true` when Oura confirmed the revoke. Disconnecting forgets the tokens either way. */
export async function revokeAccessToken(accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${OURA_REVOKE_URL}?${new URLSearchParams({ access_token: accessToken })}`, {
      method: 'GET',
      signal: AbortSignal.timeout(OURA_REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

/** Oura's id for the account. Part 2 routes webhook events to our user by it (`oura_tokens.oura_user_id`). */
export async function fetchOuraUserId(accessToken: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${OURA_API_BASE}/v2/usercollection/personal_info`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(OURA_REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    throw new OuraUnavailableError(`Oura could not be reached: ${err instanceof Error ? err.name : 'unknown'}`)
  }
  if (!res.ok) throw new OuraUnavailableError(`Oura's personal_info answered ${res.status}`, res.status)
  const parsed = PersonalInfo.safeParse(await res.json().catch(() => null))
  if (!parsed.success) throw new OuraUnavailableError("Oura's personal_info had an unexpected shape")
  return parsed.data.id
}
