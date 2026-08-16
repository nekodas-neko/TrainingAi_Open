'use client'

import { clearLocalStoreData } from '@/lib/local-store'
import { clearAllCache, disableCacheWrites } from '@/lib/sqlite/cache'
import { signOut as serverSignOut } from '@/app/actions'

/**
 * The only way to sign out.
 *
 * Signing out has to wipe the device, not just the session: the on-device SQLite store is the
 * source of truth for every offline-first domain, and most `cachedFetch` keys carry no user id
 * (`weekly-stats`, `readiness-score`, `home-day-timeline`), so the next account to sign in paints
 * from the previous one's data before any fetch returns — `readCacheSync` runs first, by design.
 *
 * Extracted because it had already gone wrong (Q-172): More → Profile did all three steps while
 * `components/chat.tsx`'s two buttons posted a bare `<form action={signOut}>` and did none of them.
 * One correct sequence copied to three call sites is one call site away from being wrong again, so
 * there is now nothing to copy.
 *
 * **Import this, never `@/app/actions`'s `signOut` directly.** A `<form action={…}>` cannot run the
 * clears — it posts straight to the server action — so a sign-out control has to be a button with
 * an `onClick`. `scripts/check-sign-out-clears-device.js` fails the build on either mistake.
 *
 * Both clears are best-effort: a failure to wipe must not strand someone signed in. The server
 * sign-out still runs, and the next sign-in re-syncs.
 */
export async function signOutAndClearDevice(): Promise<void> {
  // Before the clears, not after: `cachedFetch` calls already in flight resolve later and would
  // re-seed the cache with the outgoing account's data. Measured — 4 of 17 keys came back without
  // this. Released when the sign-in screen mounts.
  disableCacheWrites()
  await clearLocalStoreData().catch(() => {})
  await clearAllCache().catch(() => {})
  await serverSignOut()
}
