import { wipeDevice } from './data-epoch'

/**
 * #3369 — which account the data on this device belongs to.
 *
 * The local tables are not user-scoped (`lib/sqlite/migrations.ts`), so whoever signs in next sees
 * the rows already there, and `getStrandedPendingWorkouts` → `queueMutation({ userId })` would adopt
 * a previous account's unsynced workouts into the new account. Nothing guarded that, because the
 * only wipes were a clean sign-out and an admin reset of the SAME account. The headline case it
 * missed: an admin deletes an account, the person signs up again with a new user id, and the phone
 * still holds the old account's rows.
 *
 * The device records the user id that owns its store. **Signing in as a different id wipes
 * everything before any read or sync**: `getLocalStore` answers null (the online-only path the web
 * build uses) while the owner does not match, so nothing local is read, written, pulled or pushed,
 * and the wipe then reloads the page. This also covers plain account switching without a sign-out.
 *
 * A device with no record yet adopts the signed-in account: it predates this record, and wiping a
 * store whose owner is unknown would throw away unsynced work for nothing.
 */
export const STORE_OWNER_KEY = 'ta_store_owner'
/** sessionStorage: this tab already wiped for this owner, so a record that cannot be written cannot loop. */
export const STORE_OWNER_WIPED_KEY = 'ta_store_owner_wiped'

export interface OwnerDeps {
  read(): string | null
  write(userId: string): boolean
  readWiped(): string | null
  writeWiped(userId: string): void
  wipe(): Promise<void>
  reload(): void
}

export type OwnerCheck = 'owned' | 'adopted' | 'mismatch'

/** Synchronous, because `getLocalStore` is. Records the owner when there is none. */
export function checkStoreOwner(userId: string, deps: OwnerDeps = browserDeps): OwnerCheck {
  const owner = deps.read()
  if (owner === userId) return 'owned'
  if (owner === null) {
    deps.write(userId)
    return 'adopted'
  }
  return 'mismatch'
}

let resolving: Promise<void> | null = null

/** Wipe everything the previous owner left, then claim the device and reload. One at a time. */
export function resolveStoreOwnerMismatch(userId: string, deps: OwnerDeps = browserDeps): Promise<void> {
  if (resolving) return resolving
  // This tab already wiped for this user but could not record it: do not wipe in a loop.
  if (deps.readWiped() === userId) return Promise.resolve()
  resolving = (async () => {
    try {
      await deps.wipe()
      deps.writeWiped(userId)
      // After the wipe, which clears this key with the rest of the account's storage.
      if (deps.write(userId)) deps.reload()
    } catch {
      /* the next call retries; until then the store stays closed */
    } finally {
      resolving = null
    }
  })()
  return resolving
}

/**
 * The gate `getLocalStore` consults. True means "treat the local store as unavailable" and starts
 * the wipe. Off the browser it is always false.
 */
export function storeOwnedByAnotherAccount(userId: string): boolean {
  if (typeof window === 'undefined') return false
  const result = checkStoreOwner(userId)
  if (result !== 'mismatch') return false
  void resolveStoreOwnerMismatch(userId)
  return true
}

const browserDeps: OwnerDeps = {
  read: () => { try { return window.localStorage.getItem(STORE_OWNER_KEY) } catch { return null } },
  write: userId => {
    try {
      window.localStorage.setItem(STORE_OWNER_KEY, userId)
      return window.localStorage.getItem(STORE_OWNER_KEY) === userId
    } catch { return false }
  },
  readWiped: () => { try { return window.sessionStorage.getItem(STORE_OWNER_WIPED_KEY) } catch { return null } },
  writeWiped: userId => { try { window.sessionStorage.setItem(STORE_OWNER_WIPED_KEY, userId) } catch { /* unavailable */ } },
  wipe: wipeDevice,
  reload: () => window.location.reload(),
}

/** Test seam. */
export function _resetStoreOwnerGate(): void { resolving = null }
