import { isSQLiteAvailable } from '@/lib/sqlite/sqlite-service'

/**
 * #3369 — a device that holds data from before an admin reset wipes it before it can push it back.
 *
 * The offline-first store is the source of truth, so a reset on the server alone would be undone by
 * the next outbox push from a phone that still has the old rows. The server already refuses every
 * sign-in older than the reset (`users.sessions_valid_from`), which ends the old session. This is
 * the other half: the phone that signs in AGAIN afterwards, with the old rows still in its local
 * store, must not push them under the fresh session.
 *
 * The server reports the reset moment as a number of seconds (`/api/account/data-epoch`, 0 when the
 * account was never reset). A device records the number it last saw, per user. When the server's is
 * newer than the record, or there is no record and the server's is not 0, everything on the device
 * that belongs to the account is wiped (the same wipe as a sign-out), the number is recorded, and the
 * page reloads so no mounted screen keeps the old state.
 *
 * **Fails closed.** The gate answers `ok` only when the server has been asked and the answer is
 * settled; if it cannot be reached or does not parse, the sync engine skips this push or pull and
 * the next one asks again. The cost is one request per app start (an `ok` is remembered for the page).
 *
 * **What a wipe costs.** A change made on this phone and never synced is discarded with the rest:
 * it belonged to the account as it was before the reset. The one case this also wipes for no reason
 * is a phone that signs in for the first time after a reset (no record, server number above 0): its
 * store is empty, so the wipe loses nothing and the page reloads once.
 */
export const DATA_EPOCH_KEY = 'ta_data_epoch'
/** sessionStorage: this tab session already wiped for this epoch, so a failed record cannot loop. */
export const DATA_EPOCH_WIPED_KEY = 'ta_data_epoch_wiped'

export type DataEpochCheck = 'ok' | 'wiped' | 'unknown'

export interface DataEpochDeps {
  fetchEpoch(): Promise<number | null>
  readRecord(): string | null
  writeRecord(value: string): boolean
  readWipedFlag(): string | null
  writeWipedFlag(value: string): void
  wipe(): Promise<void>
  reload(): void
}

const recordOf = (userId: string, epoch: number) => `${userId}:${epoch}`

function parseRecord(raw: string | null, userId: string): number | null {
  if (!raw) return null
  const at = raw.lastIndexOf(':')
  if (at < 0 || raw.slice(0, at) !== userId) return null
  const n = Number(raw.slice(at + 1))
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** Pure of the browser: every effect comes in through `deps`, so the decision is testable. */
export async function checkDataEpoch(userId: string, deps: DataEpochDeps): Promise<DataEpochCheck> {
  const server = await deps.fetchEpoch()
  if (server === null) return 'unknown'

  const recorded = parseRecord(deps.readRecord(), userId)
  if (recorded !== null && recorded >= server) return 'ok'
  if (recorded === null && server === 0) {
    deps.writeRecord(recordOf(userId, 0))
    return 'ok'
  }

  // This tab session already wiped for this epoch but could not record it: do not wipe again.
  if (deps.readWipedFlag() === recordOf(userId, server)) return 'ok'

  await deps.wipe()
  deps.writeWipedFlag(recordOf(userId, server))
  // Recorded AFTER the wipe, which clears this key with the rest of the account's storage.
  if (deps.writeRecord(recordOf(userId, server))) deps.reload()
  return 'wiped'
}

async function fetchServerEpoch(): Promise<number | null> {
  try {
    const res = await fetch('/api/account/data-epoch', { cache: 'no-store' })
    if (!res.ok) return null
    const body = await res.json() as { epoch?: unknown }
    return typeof body.epoch === 'number' && Number.isInteger(body.epoch) && body.epoch >= 0 ? body.epoch : null
  } catch {
    return null
  }
}

/** Dynamic imports: this module is imported by the sync engine, and the wipe reaches back into it. */
async function wipeDevice(): Promise<void> {
  const [{ clearLocalStoreData }, cache, { clearAccountStorage }] = await Promise.all([
    import('./index'),
    import('@/lib/sqlite/cache'),
    import('@/lib/sign-out-storage'),
  ])
  // The same order as a sign-out (`lib/sign-out.ts`), minus the server half: the session is fine.
  cache.disableCacheWrites()
  await clearLocalStoreData().catch(() => {})
  await cache.clearAllCache().catch(() => {})
  clearAccountStorage()
}

const browserDeps: DataEpochDeps = {
  fetchEpoch: fetchServerEpoch,
  readRecord: () => { try { return window.localStorage.getItem(DATA_EPOCH_KEY) } catch { return null } },
  writeRecord: value => {
    try {
      window.localStorage.setItem(DATA_EPOCH_KEY, value)
      return window.localStorage.getItem(DATA_EPOCH_KEY) === value
    } catch { return false }
  },
  readWipedFlag: () => { try { return window.sessionStorage.getItem(DATA_EPOCH_WIPED_KEY) } catch { return null } },
  writeWipedFlag: value => { try { window.sessionStorage.setItem(DATA_EPOCH_WIPED_KEY, value) } catch { /* unavailable */ } },
  wipe: wipeDevice,
  reload: () => window.location.reload(),
}

const settled = new Map<string, Promise<DataEpochCheck>>()

/**
 * The sync engine's gate. Only a device with the real local store has anything to wipe, so the web
 * build and tests pass straight through. An `ok` is remembered for the page; anything else asks
 * again next time. Concurrent callers share one request.
 */
export function verifyDataEpoch(userId: string, deps: DataEpochDeps = browserDeps): Promise<DataEpochCheck> {
  if (deps === browserDeps && (typeof window === 'undefined' || !isSQLiteAvailable())) return Promise.resolve('ok')
  const existing = settled.get(userId)
  if (existing) return existing
  const run = checkDataEpoch(userId, deps).catch((): DataEpochCheck => 'unknown').then(result => {
    if (result !== 'ok') settled.delete(userId)
    return result
  })
  settled.set(userId, run)
  return run
}

/** Test seam: forget what this page has already verified. */
export function _resetDataEpochGate(): void { settled.clear() }
