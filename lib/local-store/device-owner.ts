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
 * **A device with no record is adopted only by the session that already held it.** Local rows carry
 * no account id, so a phone with no record cannot say whose rows it holds. No shipped build wrote
 * this record, so every install starts here on the first launch of the version that does, the
 * owner's own phone included. The device looks at its store, and at how the session began:
 *
 * - **Empty store:** claimed for the signed-in account.
 * - **Rows, and the session predates this update** (its token has no `signedInAt`, which is stamped
 *   only at a sign-in made by a build that records one): **adopted, nothing wiped.** The rows came
 *   from this very session, which carried over the update. Wiping would discard the outbox.
 * - **Rows, and the session is a fresh sign-in** (it has a `signedInAt`): the delete-then-re-signup
 *   case. The deleted account's session is dead, so whoever signed in is new to these rows. The
 *   signed-in account's own queued writes are pushed first, best effort (an outbox entry names its
 *   account, so another account's are never sent), and then everything is wiped and claimed.
 * - **Cannot tell** (the store look or the session look fails): stay closed, ask again next call.
 *
 * The one place this adopts without proof is the first rule's session, and only because a session
 * that was signed in before the update is the session that wrote the rows.
 *
 * Counted as data: the localStorage upload queues. Not counted: cached responses and the exercise
 * catalogue, which a wipe clears with nothing lost.
 *
 * A falsy user id (no session yet) is ignored: it is never recorded as an owner, and a record that
 * holds the empty string counts as no record.
 */
export const STORE_OWNER_KEY = 'ta_store_owner'
/** sessionStorage: this tab already wiped for this owner, so a record that cannot be written cannot loop. */
export const STORE_OWNER_WIPED_KEY = 'ta_store_owner_wiped'

/** How long a push before a wipe may take; a hung one must not keep the store closed. */
const PUSH_BEFORE_WIPE_MS = 10_000

export interface OwnerDeps {
  read(): string | null
  write(userId: string): boolean
  /** Does the local store hold any rows or queued uploads? Throws when it cannot tell. */
  hasData(): Promise<boolean>
  /** Did this session begin before this update (no `signedInAt`)? Throws when the server cannot say. */
  sessionPredatesOwnerRecord(): Promise<boolean>
  /** Push this account's queued writes before a wipe. Best effort; never throws. */
  pushOutbox(userId: string): Promise<void>
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
 * A device with no owner record: claim it if the store is empty, adopt it if the session carried
 * over the update, otherwise push what the account queued, wipe, and claim.
 * Nothing local is read or written meanwhile (`getLocalStore` answers null). One at a time.
 */
export function resolveUnclaimedStore(userId: string, deps: OwnerDeps = browserDeps): Promise<void> {
  if (!userId) return Promise.resolve()
  if (resolving) return resolving
  if (deps.readWiped() === userId) return Promise.resolve()
  resolving = (async () => {
    try {
      if (!(await deps.hasData())) { deps.write(userId); return }
      if (await deps.sessionPredatesOwnerRecord()) {
        // The session that wrote these rows carried over the update: adopt them, keep the outbox.
        if (deps.write(userId)) deps.reload()
        return
      }
      await deps.pushOutbox(userId)
      await wipeAndClaim(userId, deps)
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
  sessionPredatesOwnerRecord: async () => {
    const res = await fetch('/api/account/data-epoch', { cache: 'no-store' })
    if (!res.ok) throw new Error(`session look failed: HTTP ${res.status}`)
    const body = await res.json() as { signedInAt?: unknown }
    if (body.signedInAt === null) return true
    if (typeof body.signedInAt === 'number') return false
    throw new Error('session look failed: unreadable answer')
  },
  pushOutbox: async userId => {
    const { pushOwnOutboxBeforeWipe } = await import('./sync-engine')
    // A push that hangs must not keep the store closed.
    await Promise.race([pushOwnOutboxBeforeWipe(userId), new Promise<void>(r => setTimeout(r, PUSH_BEFORE_WIPE_MS))])
  },
  readWiped: () => { try { return window.sessionStorage.getItem(STORE_OWNER_WIPED_KEY) } catch { return null } },
  writeWiped: userId => { try { window.sessionStorage.setItem(STORE_OWNER_WIPED_KEY, userId) } catch { /* unavailable */ } },
  wipe: wipeDevice,
  reload: () => window.location.reload(),
}

/** Test seam. */
export function _resetStoreOwnerGate(): void { resolving = null }
