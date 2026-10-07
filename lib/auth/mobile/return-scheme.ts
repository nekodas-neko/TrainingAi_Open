// Which app an Android Google sign-in returns to (#2540).
//
// The real app (`com.trainingai.app`) answers to `trainingai://auth-complete`; TrainingAi Dev
// (`com.trainingai.app.dev`) answers to `trainingai-dev://auth-complete` so it never puts a chooser
// in front of the owner's real sign-in (android/app/build.gradle, `oauthScheme`). The return scheme
// is picked from an allow-list of exactly those two and never echoed from a request, so this cannot
// become an open redirect. Anything not on the list falls back to, or is rejected in favour of, the
// real app's scheme. Imported by both the client (`client.ts`) and the server routes, so it stays
// free of browser and Node APIs.

export const PRODUCTION_RETURN_SCHEME = 'trainingai'
export const DEV_RETURN_SCHEME = 'trainingai-dev'
export type MobileReturnScheme = typeof PRODUCTION_RETURN_SCHEME | typeof DEV_RETURN_SCHEME

/** The Dev flavour's applicationId: `com.trainingai.app` + `applicationIdSuffix ".dev"`. */
export const DEV_APP_ID = 'com.trainingai.app.dev'

/** The real app's server — capacitor.config.ts `server.url`. */
export const PRODUCTION_BACKEND_ORIGIN = 'https://trainingai-production.up.railway.app'

/** Query parameter `/mobile-signin/begin` reads, and the cookie that carries it to the bridge. */
export const RETURN_SCHEME_PARAM = 'return'
export const MOBILE_RETURN_SCHEME_COOKIE = 'ta_mobile_return'

const ALLOWED: readonly MobileReturnScheme[] = [PRODUCTION_RETURN_SCHEME, DEV_RETURN_SCHEME]

/** Exact allow-list match: no trimming, no case folding, no prefixes. Anything else is null. */
export function parseReturnScheme(value: unknown): MobileReturnScheme | null {
  return typeof value === 'string' && (ALLOWED as readonly string[]).includes(value)
    ? value as MobileReturnScheme
    : null
}

/** The scheme this app build answers to. Anything but the Dev app's id is the real app. */
export function returnSchemeForAppId(appId: string | null | undefined): MobileReturnScheme {
  return appId === DEV_APP_ID ? DEV_RETURN_SCHEME : PRODUCTION_RETURN_SCHEME
}

/**
 * The scheme a server will send a token back to, from the `return` parameter of
 * `/mobile-signin/begin`. Absent is the real app. The Dev scheme is honoured only by a
 * non-production server: the Dev app only ever talks to `pnpm dev`, so production keeps exactly the
 * behaviour it had before this existed. Returns null for anything that must be refused.
 */
export function acceptReturnScheme(value: string | null, isProduction: boolean): MobileReturnScheme | null {
  if (value === null) {
    return PRODUCTION_RETURN_SCHEME
  }
  const scheme = parseReturnScheme(value)
  if (scheme === DEV_RETURN_SCHEME && isProduction) {
    return null
  }
  return scheme
}

/** The bridge's return URL. A missing, unknown or (in production) Dev cookie means the real app. */
export function mobileReturnUrl(token: string, cookieValue: string | undefined, isProduction: boolean): string {
  const scheme = isProduction ? PRODUCTION_RETURN_SCHEME : parseReturnScheme(cookieValue) ?? PRODUCTION_RETURN_SCHEME
  return `${scheme}://auth-complete?token=${token}`
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/**
 * The server a native sign-in opens in the system browser: the WebView's own origin. The real app's
 * WebView loads production over https, so that is what it gets; if its origin is ever not a public
 * https one it falls back to the production server, as it always did. The Dev app loads the
 * laptop's `pnpm dev` at http://localhost:3000 and must sign in there or not at all, so a Dev app
 * on any other origin gets null.
 */
export function mobileBackendOrigin(locationOrigin: string | null | undefined, appId: string | null | undefined): string | null {
  let url: URL | null = null
  try {
    url = locationOrigin ? new URL(locationOrigin) : null
  } catch {
    url = null
  }
  if (returnSchemeForAppId(appId) === DEV_RETURN_SCHEME) {
    return url && (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHost(url.hostname)
      ? url.origin
      : null
  }
  return url && url.protocol === 'https:' && !isLoopbackHost(url.hostname)
    ? url.origin
    : PRODUCTION_BACKEND_ORIGIN
}

/** The URL the system browser opens. The real app's is exactly what it was before #2540. */
export function mobileSignInBeginUrl(origin: string, appId: string | null | undefined, challenge: string): string {
  const base = `${origin}/mobile-signin/begin?challenge=${challenge}`
  const scheme = returnSchemeForAppId(appId)
  return scheme === PRODUCTION_RETURN_SCHEME ? base : `${base}&${RETURN_SCHEME_PARAM}=${scheme}`
}

/** Whether a deep link is this app's sign-in completion. Each app accepts only its own scheme. */
export function isMobileAuthCompleteUrl(url: string, appId: string | null | undefined): boolean {
  return url.startsWith(`${returnSchemeForAppId(appId)}://auth-complete`)
}
