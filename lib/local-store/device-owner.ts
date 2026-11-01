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
 * - **Rows, and the session is a fresh sign-in** (it has a `signedInAt`): either the same account
 *   signing in again after an expired or lost cookie, or the delete-then-re-signup case. The outbox
 *   tells them apart. An entry stamped with the signed-in `user_id`, of any status (pending, in
 *   retry backoff, failed), proves the rows are that account's: a deleted account's replacement
 *   never has its new id in the outbox. **Such an entry means adopt, nothing wiped.** With none,
 *   the account's own queued writes are pushed first (best effort), the outbox is looked at again,
 *   and only if it still holds nothing for the account is everything wiped and claimed.
 * - **Cannot tell** (the store look, the outbox look or the session look fails): stay closed, and
 *   ask again after a short backoff rather than on every call.
 *
 * The push before a wipe is capped at 10 s. At the cap it is aborted and waited for, so a push never
 * runs alongside the wipe; if it will not stop, the wipe does not happen.
 *
 * The one place this adopts without proof of the outbox is the first rule's session, and only
 * because a session that was signed in before the update is the session that wrote the rows.
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

/** How long a push before a wipe may run before it is told to stop. */
export const PUSH_BEFORE_WIPE_MS = 10_000
/** After the cap aborts it, how long it may take to actually stop. Past this the wipe is not done. */
export const PUSH_SETTLE_GRACE_MS = 3_000
/** First wait after a failed attempt; doubles per failure up to the max. */
const RETRY_BACKOFF_MS = 5_000
const RETRY_BACKOFF_MAX_MS = 60_000

export interface OwnerDeps {
  read(): string | null
  write(userId: string): boolean
  /** Does the local store hold any rows or queued uploads? Throws when it cannot tell. */
  hasData(): Promise<boolean>
  /** Did this session begin before this update (no `signedInAt`)? Throws when the server cannot say. */
  sessionPredatesOwnerRecord(): Promise<boolean>
  /**
   * Is any outbox entry stamped with this account's id, **whatever its status or retry time**?
   * Throws when it cannot tell.
   */
  outboxHoldsEntriesFor(userId: string): Promise<boolean>
  /**
   * Push this account's queued writes before a wipe. Best effort. **Resolves only once nothing of
   * the push is still running** (it is aborted at the cap and waited for), so a wipe never overlaps
   * it. Rejects if it cannot be stopped.
   */
  pushOutbox(userId: string): Promise<void>
  readWiped(): string | null
  writeWiped(userId: string): void
  wipe(): Promise<void>
  reload(): void
  /** Clock for the retry backoff; tests inject one. */
  now?(): number
}

/**
 * Reads `/api/account/data-epoch`'s answer. `signedInAt: null` is a session that began before the
 * stamp existed; a number is a fresh sign-in; **anything else, a missing field included, is "cannot
 * tell"** and throws. A native bearer session gets no `signedInAt` (its stamp is the token's issue
 * time, not the sign-in), so it can never be taken as either.
 */
export function sessionPredatesFromAnswer(body: unknown): boolean {
  const signedInAt = (body as { signedInAt?: unknown } | null)?.signedInAt
  if (signedInAt === null) return true
  if (typeof signedInAt === 'number') return false
  throw new Error('session look failed: unreadable answer')
}

/**
 * The data-epoch answer as a session look. A server from before #3369 has no such route and never
 * stamped a sign-in, so its session predates any record: the device adopts its rows, as it would for
 * a session carried over the update. Any other failure still throws: not knowing is not "adopt".
 */
export async function sessionPredatesFromResponse(res: Response): Promise<boolean> {
  if (res.status === 404) return true
  if (!res.ok) throw new Error(`session look failed: HTTP ${res.status}`)
  return sessionPredatesFromAnswer(await res.json())
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

/**
 * A failed attempt (the store, outbox or session look, a record that cannot be written, a wipe)
 * leaves the store closed, and `getLocalStore` asks again on every call. Each ask scans the tables
 * and fetches the session, so after a failure it waits out a short, doubling backoff first.
 */
const retry = { until: 0, failures: 0 }
const clock = (deps: OwnerDeps) => (deps.now ?? Date.now)()
const backingOff = (deps: OwnerDeps) => clock(deps) < retry.until
function noteFailure(deps: OwnerDeps): void {
  retry.failures += 1
  retry.until = clock(deps) + Math.min(RETRY_BACKOFF_MS * 2 ** (retry.failures - 1), RETRY_BACKOFF_MAX_MS)
}
function noteSettled(): void { retry.until = 0; retry.failures = 0 }

/**
 * Run `run` for at most `capMs`, then abort it and wait up to `graceMs` for it to actually stop.
 * Never rejects for the work's own failure (best effort); rejects only when it would not stop, so
 * the caller does not wipe under a push that may still be writing.
 */
export async function runCapped(
  run: (signal: AbortSignal) => Promise<void>,
  capMs: number = PUSH_BEFORE_WIPE_MS,
  graceMs: number = PUSH_SETTLE_GRACE_MS,
): Promise<void> {
  const ctl = new AbortController()
  const done = run(ctl.signal).then(() => true as const, () => true as const)
  const wait = (ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<false>(r => { timer = setTimeout(() => r(false), ms) })
    return { timeout, clear: () => clearTimeout(timer) }
  }
  const cap = wait(capMs)
  const finished = await Promise.race([done, cap.timeout])
  cap.clear()
  if (finished) return
  ctl.abort()
  const grace = wait(graceMs)
  const stopped = await Promise.race([done, grace.timeout])
  grace.clear()
  if (!stopped) throw new Error('the push did not stop after the cap; not wiping while it may still be writing')
}

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
  if (backingOff(deps)) return Promise.resolve()
  resolving = (async () => {
    try {
      await wipeAndClaim(userId, deps)
      noteSettled()
    } catch {
      /* retried after the backoff; until then the store stays closed */
      noteFailure(deps)
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
  if (backingOff(deps)) return Promise.resolve()
  resolving = (async () => {
    // A record that cannot be written leaves the store closed, and counts as a failure for the
    // backoff: the next call would only look again and fail the same way.
    const claim = (reload: boolean) => {
      if (!deps.write(userId)) { noteFailure(deps); return }
      noteSettled()
      if (reload) deps.reload()
    }
    try {
      if (!(await deps.hasData())) { claim(false); return }
      if (await deps.sessionPredatesOwnerRecord()) {
        // The session that wrote these rows carried over the update: adopt them, keep the outbox.
        claim(true)
        return
      }
      // A fresh sign-in. An outbox entry carrying this account's id proves the rows are its own.
      if (await deps.outboxHoldsEntriesFor(userId)) { claim(true); return }
      await deps.pushOutbox(userId)
      // Whatever the push left behind (a failure, a backoff, a dead letter) is this account's
      // unsent work, and a wipe would destroy it.
      if (await deps.outboxHoldsEntriesFor(userId)) { claim(true); return }
      await wipeAndClaim(userId, deps)
      noteSettled()
    } catch {
      /* could not tell, or could not wipe: stay closed, and try again after the backoff */
      noteFailure(deps)
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
  sessionPredatesOwnerRecord: async () =>
    sessionPredatesFromResponse(await fetch('/api/account/data-epoch', { cache: 'no-store' })),
  outboxHoldsEntriesFor: async userId => {
    const { getUngatedLocalStore } = await import('./index')
    const store = getUngatedLocalStore(userId)
    // No store (no SQLite) means no outbox. A query that fails throws: not knowing is not "none".
    if (!store) return false
    const byDomain = await store.countQueuedMutationsByDomain(userId)
    return Object.values(byDomain).some(n => n > 0)
  },
  pushOutbox: async userId => {
    const { pushOwnOutboxBeforeWipe } = await import('./sync-engine')
    await runCapped(signal => pushOwnOutboxBeforeWipe(userId, signal))
  },
  readWiped: () => { try { return window.sessionStorage.getItem(STORE_OWNER_WIPED_KEY) } catch { return null } },
  writeWiped: userId => { try { window.sessionStorage.setItem(STORE_OWNER_WIPED_KEY, userId) } catch { /* unavailable */ } },
  wipe: wipeDevice,
  reload: () => window.location.reload(),
}

/** Test seam. */
export function _resetStoreOwnerGate(): void { resolving = null; noteSettled() }
