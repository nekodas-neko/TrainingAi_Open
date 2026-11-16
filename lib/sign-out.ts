'use client'

import { clearLocalStoreData } from '@/lib/local-store'
import { clearAllCache, disableCacheWrites } from '@/lib/sqlite/cache'
import { signOut as serverSignOut } from '@/app/actions'
import { clearAccountStorage } from '@/lib/sign-out-storage'
import { allowSignOutRequest, beginSignOut, endSignOut } from '@/lib/sign-out-fence'

export async function signOutAndClearDevice(): Promise<void> {
  // #3806: abort and refuse every request first, so no response sent with the old session cookie
  // can re-set it after the sign-out clears it, or write the outgoing account's data into the
  // stores emptied below.
  beginSignOut()
  // Stop in-flight reads from restoring the outgoing account's cached data.
  disableCacheWrites()
  await clearLocalStoreData().catch(() => {})
  await clearAllCache().catch(() => {})
  // Browser storage: everything but the device settings in `DEVICE_STORAGE`, with the persisted
  // stores reset in memory first so a mounted screen cannot write the old state back (#2453).
  // After the cache clear, which empties the cache's own mirror keys; this then takes the rest.
  clearAccountStorage()
  try {
    // The one request let through: its response clears the cookie, last.
    allowSignOutRequest()
    await serverSignOut()
  } finally {
    endSignOut()
  }
}
