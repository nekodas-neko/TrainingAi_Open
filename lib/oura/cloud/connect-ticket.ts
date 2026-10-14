// The connect ticket (#2858): one signed value that is both the link the app opens and the OAuth
// `state` Oura hands back.
//
// The flow, the same from the web app and the native app:
//   1. POST /api/oura/connect (signed in) → a ticket naming the user, the client that asked, and a
//      fresh nonce, and a URL to GET /api/oura/connect?ticket=… on the app's own origin.
//   2. The client opens that URL in a browser (the native app uses the system browser, which has no
//      session cookie). The GET sets the nonce in an httpOnly cookie in THAT browser and redirects
//      to Oura with the ticket as `state`.
//   3. Oura sends the same browser to /api/oura/callback?code=…&state=…. The callback accepts only a
//      ticket this server signed, unexpired, whose nonce matches the cookie: the browser that comes
//      back is the one that went out. Then it returns to the client the ticket names.
//
// Signed with `AUTH_SECRET` under its own issuer, as `lib/auth/mobile/native-transaction.ts` does,
// so a mobile sign-in transaction can never be replayed as a ticket or the other way round.
import { SignJWT, jwtVerify } from 'jose'
import { randomBytes } from 'node:crypto'
import { NATIVE_CALLBACKS, isNativeClient, type NativeClient } from '@/lib/auth/mobile/native-transaction'

export const CONNECT_TICKET_ISSUER = 'trainingai-oura-connect'
export const CONNECT_TICKET_AUDIENCE = 'oura-cloud'
export const CONNECT_TICKET_MAX_AGE = 10 * 60
export const CONNECT_NONCE_COOKIE = 'ta_oura_connect'
/** The cookie is only ever sent to the connect and callback routes. */
export const CONNECT_NONCE_COOKIE_PATH = '/api/oura'
const NONCE_RE = /^[A-Za-z0-9_-]{43}$/
const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Where the user lands when the connection finishes: the web app, or one of the native apps. */
export type ConnectClient = 'web' | NativeClient
export interface ConnectTicket {
  userId: string
  client: ConnectClient
  nonce: string
}

export function isConnectClient(value: unknown): value is ConnectClient {
  return value === 'web' || isNativeClient(value)
}

function signingKey() {
  if (!process.env.AUTH_SECRET) throw new Error('Oura connection is not configured.')
  return new TextEncoder().encode(process.env.AUTH_SECRET)
}

export async function createConnectTicket(userId: string, client: ConnectClient): Promise<{ ticket: string; nonce: string }> {
  const nonce = randomBytes(32).toString('base64url')
  const ticket = await new SignJWT({ client, nonce })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(CONNECT_TICKET_ISSUER)
    .setAudience(CONNECT_TICKET_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${CONNECT_TICKET_MAX_AGE}s`)
    .sign(signingKey())
  return { ticket, nonce }
}

/** The ticket's claims, or `null` for anything this server did not sign in the last ten minutes. */
export async function readConnectTicket(ticket: string): Promise<ConnectTicket | null> {
  try {
    const { payload } = await jwtVerify(ticket, signingKey(), {
      algorithms: ['HS256'],
      issuer: CONNECT_TICKET_ISSUER,
      audience: CONNECT_TICKET_AUDIENCE,
      maxTokenAge: CONNECT_TICKET_MAX_AGE,
      requiredClaims: ['exp', 'iat', 'sub'],
    })
    const { sub, client, nonce } = payload
    if (
      typeof sub !== 'string' || !USER_ID_RE.test(sub) ||
      !isConnectClient(client) ||
      typeof nonce !== 'string' || !NONCE_RE.test(nonce)
    ) return null
    return { userId: sub, client, nonce }
  } catch {
    return null
  }
}

export type ConnectOutcome =
  | { status: 'connected' }
  | { status: 'error'; error: 'denied' | 'expired' | 'in_use' | 'failed' | 'not_configured' }

/** The web page the user returns to. Part 4 builds the connect screen; Devices is where it goes. */
export const WEB_RETURN_PATH = '/more/devices'

/**
 * Where the browser goes when the connection finishes. Native clients come from the same allow-list
 * as mobile sign-in (`NATIVE_CALLBACKS`): only the scheme is reused, with its own `/oura/callback`
 * path, so the native app can tell the two apart. `origin` is the app's own origin; a client name
 * that is not on the list cannot reach here, because `isConnectClient` rejected it at the ticket.
 */
export function connectReturnUrl(client: ConnectClient, origin: string, outcome: ConnectOutcome): string {
  const params = new URLSearchParams(
    outcome.status === 'connected' ? { oura: 'connected' } : { oura: 'error', reason: outcome.error },
  )
  if (client === 'web') return new URL(`${WEB_RETURN_PATH}?${params}`, origin).toString()
  const scheme = NATIVE_CALLBACKS[client].split(':')[0]
  return `${scheme}:/oura/callback?${params}`
}
