/**
 * #3369 — the write gate for devices that have not yet wiped for an admin reset.
 *
 * An admin reset empties the server; a phone that still holds the old rows would push them back, by
 * the sync outbox or by any of the upload paths (ring samples, accelerometer chunks, live steps,
 * the Colmi ring, Health Connect). Cutting the old sign-in off is not enough, because the phone
 * signs in again and its local store is still full. So every WRITE carries the data epoch the
 * device has wiped for, and once an account has been reset a write from a device that has not seen
 * it is answered 409 and the app wipes and re-reads.
 *
 * **Where it lives.** `middleware.ts`, which every `/api` request already passes through, so no
 * route is edited and a route added later is covered. The middleware is edge code and cannot read
 * the database, so the account's epoch comes from the session token (`dataEpoch`, stamped at
 * sign-in by `userClaims`). That is exact: a reset refuses every earlier sign-in
 * (`users.sessions_valid_from`, checked by `auth()`), so a token that still works was issued after
 * the last reset and carries its epoch. A token with no claim is from before an account was reset
 * and gets no gate; it is refused by `auth()` the moment a reset happens.
 *
 * **How the device says what it has seen.** `X-Data-Epoch: <userId>:<epoch>` from the Preview app's
 * fetch layer, or the same value in the `ta_data_epoch` cookie from the Capacitor app. The cookie
 * is what lets the Kotlin ring service and every `fetch` in the WebView carry it without a code
 * change in each: the service already forwards the WebView's cookies. The user id is part of the
 * value so a record left by another account on a shared phone counts as missing.
 *
 * **What it is not.** A client chooses what it sends, so this is not authorization; it is the
 * safeguard that stops an honest app with stale data from re-uploading it. Reads are never gated
 * (a stale device must be able to read the epoch it needs to wipe for).
 */
export const DATA_EPOCH_HEADER = 'x-data-epoch'
export const DATA_EPOCH_COOKIE = 'ta_data_epoch'
export const DATA_EPOCH_STALE_HEADER = 'x-data-epoch-stale'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Writes that must work from a stale device: signing in and out, and deleting your own account. */
function exempt(method: string, pathname: string): boolean {
  return pathname.startsWith('/api/auth/') || (method === 'DELETE' && pathname === '/api/account')
}

/** The epoch a device claims for `userId`, or null when it claims none (or one for another account). */
export function parseDeviceEpoch(raw: string | null | undefined, userId: string): number | null {
  if (!raw) return null
  const at = raw.lastIndexOf(':')
  if (at < 0 || raw.slice(0, at) !== userId) return null
  const n = Number(raw.slice(at + 1))
  return Number.isInteger(n) && n >= 0 ? n : null
}

export function cookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== name) continue
    try { return decodeURIComponent(part.slice(eq + 1).trim()) } catch { return null }
  }
  return null
}

/**
 * Judge one request. `accountEpoch` is the account's epoch from the verified token; null/0 means the
 * account was never reset and nothing is required. Returns the epoch the device must reach, or null
 * to let the request through.
 */
export function staleDataEpoch(args: {
  method: string
  pathname: string
  userId: string | undefined
  accountEpoch: number | undefined
  header: string | null
  cookieHeader: string | null
}): number | null {
  const { method, pathname, userId, accountEpoch } = args
  if (READ_METHODS.has(method.toUpperCase()) || !pathname.startsWith('/api/') || exempt(method.toUpperCase(), pathname)) return null
  if (!userId || typeof accountEpoch !== 'number' || !Number.isFinite(accountEpoch) || accountEpoch <= 0) return null
  const claimed = parseDeviceEpoch(args.header, userId) ?? parseDeviceEpoch(cookieValue(args.cookieHeader, DATA_EPOCH_COOKIE), userId)
  return claimed !== null && claimed >= accountEpoch ? null : accountEpoch
}
