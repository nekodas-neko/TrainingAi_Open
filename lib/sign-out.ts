'use client'

import { clearLocalStoreData } from '@/lib/local-store'
import { clearAllCache, disableCacheWrites } from '@/lib/sqlite/cache'
import { signOut as serverSignOut } from '@/app/actions'

export async function signOutAndClearDevice(): Promise<void> {
  // Stop in-flight reads from restoring the outgoing account's cached data.
  disableCacheWrites()
  await clearLocalStoreData().catch(() => {})
  await clearAllCache().catch(() => {})
  await serverSignOut()
}
