// The Oura Cloud connector's settings (#2858). Every Oura Cloud URL in the codebase is in this
// directory: `lib/oura/__tests__/cloud-calls-only-from-connector.test.ts` fails a PR that builds one
// anywhere else.
//
// Endpoints and scopes come from the pinned spec, `.claude/skills/oura-api/references/openapi-v1.34.json`
// (`components.securitySchemes.OAuth2`). The revoke URL is the one exception: the spec does not
// describe revocation, so it comes from Oura's authentication page (cloud.ouraring.com/docs/authentication),
// and disconnecting never depends on it succeeding.

export const OURA_AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize'
export const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token'
export const OURA_REVOKE_URL = 'https://api.ouraring.com/oauth/revoke'
export const OURA_API_BASE = 'https://api.ouraring.com'

/**
 * What we ask the user to share, by the spec's scope names. `spo2Daily` is the spec's spelling;
 * the skill's prose once said `spo2`, which Oura would reject as an unknown scope. `email` and `tag`
 * are left out: nothing in #2808 reads them.
 */
export const OURA_SCOPES = ['personal', 'daily', 'heartrate', 'workout', 'session', 'spo2Daily'] as const

/** Every request to Oura gives up after this long; a hung Oura must not hold a route open. */
export const OURA_REQUEST_TIMEOUT_MS = 10_000

export interface OuraOAuthConfig {
  clientId: string
  clientSecret: string
  /** Registered with Oura; the callback route answers here, so its origin is the app's origin. */
  redirectUri: string
}

/**
 * The OAuth settings from the environment, or `null` when any is missing or the redirect URI is not
 * an absolute http(s) URL. A `null` means connecting is switched off; callers answer 503, never
 * guess a value.
 */
export function ouraOAuthConfig(env: NodeJS.ProcessEnv = process.env): OuraOAuthConfig | null {
  const clientId = env.OURA_CLIENT_ID?.trim()
  const clientSecret = env.OURA_CLIENT_SECRET?.trim()
  const redirectUri = env.OURA_REDIRECT_URI?.trim()
  if (!clientId || !clientSecret || !redirectUri) return null
  try {
    const url = new URL(redirectUri)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  } catch {
    return null
  }
  return { clientId, clientSecret, redirectUri }
}

/** The page Oura shows to ask the user for consent. `state` is the signed connect ticket. */
export function buildAuthorizeUrl(config: OuraOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: OURA_SCOPES.join(' '),
    state,
  })
  return `${OURA_AUTHORIZE_URL}?${params}`
}
