import { getLocalStore } from '@/lib/local-store'
import { pendingDeletedIds } from '@trainingai/shared/sync/pending-deletes'
import { localSleepRowsAsNights } from '@/lib/sleep/merge-sessions'

/** The slice of a sleep row this module reads: any screen's row type satisfies it. */
export interface NightRef {
  id?: string
  date: string
  manualEntry?: boolean
  sleepStart?: string | null
  sleepEnd?: string | null
}

/**
 * Issue 2338 — what the Sleep screen's "log last night" card should do for `today`'s wake date.
 *
 * - `none`    — no row for last night: the entry card shows.
 * - `manual`  — the night on that date was typed by hand: the card shows it with Edit and Remove.
 * - `device`  — a ring / Health Connect night is there: no card at all.
 *
 * This reads the rows the screen already has. A manual night a device night also covers never
 * reaches them (`preferDeviceNights` runs inside both readers), so "a device row exists for this
 * date" is simply "a row that is not `manualEntry`" and there is no second ranking here.
 */
export type LastNightState =
  | { kind: 'none' }
  | { kind: 'device' }
  | { kind: 'manual'; night: { id: string; sleepStart: string; sleepEnd: string } }

export function lastNightState(rows: readonly NightRef[], today: string): LastNightState {
  const onDate = rows.filter(r => r.date === today)
  if (onDate.length === 0) return { kind: 'none' }
  const typed = onDate.find(r => r.manualEntry && r.id && r.sleepStart && r.sleepEnd)
  if (onDate.every(r => r.manualEntry) && typed) {
    return { kind: 'manual', night: { id: typed.id!, sleepStart: typed.sleepStart!, sleepEnd: typed.sleepEnd! } }
  }
  return { kind: 'device' }
}

/**
 * A server list of nights with the user's own unpushed manual-night writes applied.
 *
 * The server copy lags the device in both directions until the outbox pushes: it still holds a night
 * the user just removed (BF-47 class: it would reappear until the push lands), and it does not yet
 * hold one they just typed or edited. `deletedIds` are the ids with a pending `manual_sleep`
 * removal (dropped from the server list); `localManual` are the device's live manual rows (the local
 * reader already drops a tombstoned or shadowed one). A local manual night replaces any manual night the server has for its
 * date, and is added where the server has no row at all; it never replaces a device night.
 */
export function applyPendingManualWrites<T extends NightRef>(
  server: readonly T[],
  localManual: readonly T[],
  deletedIds: ReadonlySet<string>,
): T[] {
  let out = server.filter(r => !(r.id && deletedIds.has(r.id)))
  for (const m of localManual) {
    // Not skipped when its id has a pending removal: the local reader already drops a tombstoned
    // row, so a row it returns is live (a removed night entered again keeps its id and revives).
    const onDate = out.filter(r => r.date === m.date)
    if (onDate.some(r => !r.manualEntry)) continue // a device night owns the date
    out = [...out.filter(r => r.date !== m.date), m]
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/**
 * `rows` (a server reply, a cached copy, or what the screen holds) with this device's pending
 * manual-night writes applied. With no local store (the web build) the rows come back unchanged.
 * Best effort: an outbox or store read that throws leaves the rows as they were.
 */
export async function withPendingManualWrites<T extends NightRef>(
  rows: readonly T[],
  userId: string | undefined,
  cutoffDate: string,
): Promise<T[]> {
  const store = userId ? getLocalStore(userId) : null
  if (!store || !userId) return [...rows]
  try {
    const [local, queued] = await Promise.all([
      store.getSleepSessions(cutoffDate),
      store.getQueuedMutationsForDomain(userId, 'manual_sleep'),
    ])
    const localManual = localSleepRowsAsNights(local.filter(l => l.manualEntry)) as unknown as T[]
    return applyPendingManualWrites(rows, localManual, pendingDeletedIds(queued, 'manual_sleep'))
  } catch {
    return [...rows]
  }
}
