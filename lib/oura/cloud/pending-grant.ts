// A native connect's grant between the browser and the app (#2858, Orchestrator review on #2883).
//
// The callback runs in the system browser, which has no session, so it cannot prove WHO approved at
// Oura. Committing there would let anyone who sends a victim their own connect link store the
// victim's Oura grant under their own account. So for a native ticket the callback only exchanges
// the code (it must, while the code is valid) and seals the result into an opaque handle that rides
// the deep link back to the app. The app posts the handle to `/api/oura/connect/complete` with its own
// bearer, and the grant is stored only if that bearer's user is the ticket's user. Otherwise it is
// revoked.
//
// The handle is AES-256-GCM under its own key from `OURA_TOKEN_KEY` (a separate HKDF `info`, so it
// can never be mistaken for a stored token), and it expires with the connect window. Sealed rather
// than held in memory or a table: no migration, and it works whichever replica the app reaches.
// Whoever intercepts the deep link gets ciphertext and still needs the ticket user's own bearer.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { deriveOuraKey } from './token-cipher'
import type { OuraGrant } from './tokens'
import { isConnectClient, type ConnectClient } from './connect-ticket'

const KEY_INFO = 'oura pending grant v1'
const AAD = Buffer.from('oura-pending-grant', 'utf8')
const VERSION = 'p1'
/** The same window as the connect ticket: an abandoned handle is useless ten minutes later. */
export const PENDING_GRANT_MAX_AGE_MS = 10 * 60 * 1000

export interface PendingGrant {
  userId: string
  client: ConnectClient
  grant: OuraGrant
}

const Sealed = z.object({
  u: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  c: z.string(),
  x: z.number().int(),
  a: z.string().min(1),
  r: z.string().min(1),
  e: z.number().int(),
  s: z.string().nullable(),
  o: z.string().min(1),
}).strict()

export function sealPendingGrant(pending: PendingGrant, now = Date.now()): string {
  const body = JSON.stringify({
    u: pending.userId, c: pending.client, x: now + PENDING_GRANT_MAX_AGE_MS,
    a: pending.grant.accessToken, r: pending.grant.refreshToken, e: pending.grant.expiresAt.getTime(),
    s: pending.grant.scope, o: pending.grant.ouraUserId,
  } satisfies z.infer<typeof Sealed>)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveOuraKey(KEY_INFO), iv, { authTagLength: 16 })
  cipher.setAAD(AAD)
  const ct = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()])
  return `${VERSION}.${iv.toString('base64url')}.${ct.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`
}

/** The pending grant, or `null` for anything this server did not seal or that has expired. */
export function openPendingGrant(handle: string, now = Date.now()): PendingGrant | null {
  const key = deriveOuraKey(KEY_INFO)
  const parts = handle.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) return null
  const iv = Buffer.from(parts[1], 'base64url')
  const tag = Buffer.from(parts[3], 'base64url')
  if (iv.length !== 12 || tag.length !== 16) return null
  let json: unknown
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
    decipher.setAAD(AAD)
    decipher.setAuthTag(tag)
    json = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64url')), decipher.final()]).toString('utf8'))
  } catch {
    return null
  }
  const parsed = Sealed.safeParse(json)
  if (!parsed.success || parsed.data.x <= now || !isConnectClient(parsed.data.c)) return null
  const d = parsed.data
  return {
    userId: d.u,
    client: d.c as ConnectClient,
    grant: { accessToken: d.a, refreshToken: d.r, expiresAt: new Date(d.e), scope: d.s, ouraUserId: d.o },
  }
}
