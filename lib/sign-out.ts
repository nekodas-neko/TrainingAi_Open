'use client'

import { clearLocalStoreData } from '@/lib/local-store'
import { clearAllCache, disableCacheWrites } from '@/lib/sqlite/cache'
import { signOut as serverSignOut } from '@/app/actions'
import { clearAccountStorage } from '@/lib/sign-out-storage'
import { allowSignOutRequest, beginSignOut, endSignOut } from '@/lib/sign-out-fence'

/**
 * #3854 item 3: how long one on-device clear may take before the sign-out moves on without it. The
 * fence refuses every `fetch` until the sign-out ends, so a clear that never settles must not hold
 * the page there; the cookie clear runs regardless. A clear cut off here keeps running behind it.
 */
export const SIGN_OUT_CLEAR_TIMEOUT_MS = 10_000

/** Settles when `step` does or after the bound, whichever is first; never rejects. */
async function bounded(step: () => Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = (async () => step())().catch(() => {})
  try {
    await Promise.race([run, new Promise<void>(resolve => { timer = setTimeout(resolve, ms) })])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Signs out and empties this device of the outgoing account's data. Every sign-out in the web app
 * goes through here (More, the native sign-in page's "Use another account"), so the #3806 fence
 * holds on all of them. `serverAction` is the request that clears the cookie: `signOut` lands on
 * `/sign-in`; a page that stays where it is passes `signOutInPlace`.
 */
export async function signOutAndClearDevice(serverAction: () => Promise<void> = serverSignOut): Promise<void> {
  // #3806: abort and refuse every request first, so no response sent with the old session cookie
  // can re-set it after the sign-out clears it, or write the outgoing account's data into the
  // stores emptied below.
  beginSignOut()
  // #3854: whatever happens below, the fence lifts. Each clear is bounded and its failure swallowed,
  // so the cookie clear always runs, and the cookie clear stays the one request let through.
  try {
    // Stop in-flight reads from restoring the outgoing account's cached data.
    disableCacheWrites()
    await bounded(clearLocalStoreData, SIGN_OUT_CLEAR_TIMEOUT_MS)
    await bounded(clearAllCache, SIGN_OUT_CLEAR_TIMEOUT_MS)
    // Browser storage: everything but the device settings in `DEVICE_STORAGE`, with the persisted
    // stores reset in memory first so a mounted screen cannot write the old state back (#2453).
    // After the cache clear, which empties the cache's own mirror keys; this then takes the rest.
    try {
      clearAccountStorage()
    } catch {
      // A storage clear that throws must not leave the session cookie in place.
    }
    // The one request let through: its response clears the cookie, last. Not bounded: lifting the
    // fence while it is in flight would let requests carrying the old cookie race its clear again
    // (#3806). It settles when the network gives up, and the fence lifts then.
    allowSignOutRequest()
    await serverAction()
  } finally {
    endSignOut()
  }
}
