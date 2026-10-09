'use client'

import { clearLocalStoreData } from '@/lib/local-store'
import { clearAllCache, disableCacheWrites } from '@/lib/sqlite/cache'
import { signOut as serverSignOut } from '@/app/actions'
import { clearAccountStorage } from '@/lib/sign-out-storage'

export async function signOutAndClearDevice(): Promise<void> {
  // Stop in-flight reads from restoring the outgoing account's cached data.
  disableCacheWrites()
  await clearLocalStoreData().catch(() => {})
  await clearAllCache().catch(() => {})
  // Browser storage: everything but the device settings in `DEVICE_STORAGE`, with the persisted
  // stores reset in memory first so a mounted screen cannot write the old state back (#2453).
  // After the cache clear, which empties the cache's own mirror keys; this then takes the rest.
  clearAccountStorage()
  await serverSignOut()
}
