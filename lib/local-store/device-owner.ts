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
 * **A device with no record is not adopted blindly.** Local rows carry no account id, so a phone
 * that never opened the app as the old user (it predates this record) cannot say whose rows it
 * holds. Adopting them hands a deleted account's rows, and its stranded unsynced workouts, to
 * whoever signs in next. So with no record the device looks: an empty store is claimed for the
 * signed-in account; a store with any rows is wiped first, because "we cannot tell whose it is"
 * means "do not adopt it". The cost is real: a phone upgrading with changes it never synced loses
 * them once, on the first launch of the version that records an owner. A look that fails (the
 * query throws) leaves the store closed and the next call tries again.
 *
 * A falsy user id (no session yet) is ignored: it is never recorded as an owner, and a record that
 * holds the empty string counts as no record.
 */
export const STORE_OWNER_KEY = 'ta_store_owner'
/** sessionStorage: this tab already wiped for this owner, so a record that cannot be written cannot loop. */
export const STORE_OWNER_WIPED_KEY = 'ta_store_owner_wiped'

export interface OwnerDeps {
  read(): string | null
  write(userId: string): boolean
  /** Does the local store hold any rows? Throws when it cannot tell. */
  hasData(): Promise<boolean>
  readWiped(): string | null
  writeWiped(userId: string): void
  wipe(): Promise<void>
  reload(): void
}

/** `unclaimed`: no usable record, so whose rows are on the device is not known yet. */
export type OwnerCheck = 'owned' | 'unclaimed' | 'mismatch' | 'ignored'

/** Synchronous, because `getLocalStore` is. Writes nothing: claiming needs to look at the store first. */
export function checkStoreOwner(userId: string, deps: OwnerDeps = browserDeps): OwnerCheck {
  if (!userId) return 'ignored'
  const owner = deps.read()
  if (owner === userId) return 'owned'
  if (!owner) return 'unclaimed'
  return 'mismatch'
}

let resolving: Promise<void> | null = null

/** Wipe everything on the device, then claim it for `userId` and reload. */
async function wipeAndClaim(userId: string, deps: OwnerDeps): Promise<void> {
  await deps.wipe()
  deps.writeWiped(userId)
  // After the wipe, which clears this key with the rest of the account's storage.
  if (deps.write(userId)) deps.reload()
}

/** Wipe everything the previous owner left, then claim the device and reload. One at a time. */
export function resolveStoreOwnerMismatch(userId: string, deps: OwnerDeps = browserDeps): Promise<void> {
  if (!userId) return Promise.resolve()
  if (resolving) return resolving
  // This tab already wiped for this user but could not record it: do not wipe in a loop.
  if (deps.readWiped() === userId) return Promise.resolve()
  resolving = (async () => {
    try {
      await wipeAndClaim(userId, deps)
    } catch {
      /* the next call retries; until then the store stays closed */
    } finally {
      resolving = null
    }
  })()
  return resolving
}

/**
 * A device with no owner record: claim it if the store is empty, wipe it first if it is not.
 * Nothing local is read or written meanwhile (`getLocalStore` answers null). One at a time.
 */
export function resolveUnclaimedStore(userId: string, deps: OwnerDeps = browserDeps): Promise<void> {
  if (!userId) return Promise.resolve()
  if (resolving) return resolving
  if (deps.readWiped() === userId) return Promise.resolve()
  resolving = (async () => {
    try {
      if (await deps.hasData()) await wipeAndClaim(userId, deps)
      else deps.write(userId)
    } catch {
      /* could not tell, or could not wipe: stay closed, and the next call tries again */
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
  if (result === 'owned' || result === 'ignored') return false
  void (result === 'unclaimed' ? resolveUnclaimedStore(userId) : resolveStoreOwnerMismatch(userId))
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
  hasData: async () => (await import('./index')).deviceHasLocalData(),
  readWiped: () => { try { return window.sessionStorage.getItem(STORE_OWNER_WIPED_KEY) } catch { return null } },
  writeWiped: userId => { try { window.sessionStorage.setItem(STORE_OWNER_WIPED_KEY, userId) } catch { /* unavailable */ } },
  wipe: wipeDevice,
  reload: () => window.location.reload(),
}

/** Test seam. */
export function _resetStoreOwnerGate(): void { resolving = null }
