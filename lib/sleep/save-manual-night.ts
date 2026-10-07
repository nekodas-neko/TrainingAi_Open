import { getLocalStore } from '@/lib/local-store'
import { pushMutations } from '@/lib/local-store/sync-engine'
import { invalidateManualSleepWrite } from '@/lib/cache-groups'
import { parseManualNight, ManualSleepRemoveSchema } from '@trainingai/shared/health/manual-sleep'

export type SaveManualNightResult =
  | {
      ok: true
      /** The wake date the night was filed under, in the user's timezone. */
      date: string
      /** True when a device already recorded this night, so the device night is the one shown. */
      shadowed: boolean
    }
  | { ok: false; reason: string }

/**
 * #2338 — the ONE client write for a night the user enters by hand. The entry UI (not built yet; it
 * needs a mockup and the owner's yes) calls this and nothing else.
 *
 * Offline-first, as every other sleep write: on the device it writes the local `sleep_sessions`
 * mirror (`manual_entry = 1`, pending) and queues a `manual_sleep` mutation in the same turn, so the
 * night reads back at once and survives being offline; the outbox pushes it to the same repository
 * write the web route calls. Without a local store (the web build) it posts to
 * `POST /api/sleep-sessions/manual`. Either way it invalidates through `invalidateManualSleepWrite`.
 *
 * The same parse and bounds as the server (`parseManualNight`), so a night the server would refuse
 * is refused here rather than being stored locally and then quarantined by the push.
 */
export async function saveManualNight(args: {
  userId: string
  tz: string
  /** Bed time and wake time as ISO instants with an offset. */
  sleepStart: string
  sleepEnd: string
}): Promise<SaveManualNightResult> {
  const parsed = parseManualNight(
    { id: crypto.randomUUID(), sleepStart: args.sleepStart, sleepEnd: args.sleepEnd },
    args.tz,
    new Date(),
  )
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  const night = parsed.night

  const store = getLocalStore(args.userId)
  let shadowed = false
  if (store) {
    const sleepStart = night.sleepStart.toISOString()
    const sleepEnd = night.sleepEnd.toISOString()
    // The id the store actually wrote: the date's existing manual row keeps its own, and the server
    // must be told that one or the mirror would hold two rows for one night.
    const id = await store.upsertManualSleepLocally({
      id: night.id!, date: night.date, sleepStart, sleepEnd,
      durationHours: night.durationHours, timeInBedHours: night.timeInBedHours,
    })
    await store.queueMutation({ userId: args.userId, domain: 'manual_sleep', date: night.date, payload: { id, sleepStart, sleepEnd } })
    pushMutations(args.userId).catch(() => {})
    // The store's read already ranks it below a device night; absent from that read means shadowed.
    shadowed = !(await store.getSleepSessions(night.date)).some(r => r.id === id)
  } else {
    const res = await fetch('/api/sleep-sessions/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: night.id, sleepStart: night.sleepStart.toISOString(), sleepEnd: night.sleepEnd.toISOString() }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      return { ok: false, reason: body?.error ?? `HTTP ${res.status}` }
    }
    shadowed = Boolean(((await res.json()) as { shadowed?: boolean }).shadowed)
  }

  await invalidateManualSleepWrite()
  return { ok: true, date: night.date, shadowed }
}

export type RemoveManualNightResult = { ok: true } | { ok: false; reason: string }

/**
 * Issue 2606 — the ONE client write that removes a night the user entered by hand ("Remove night" on
 * the approved card). `id` is the night's row id, as the sleep read returns it (`manualEntry: true`).
 *
 * Offline-first, as `saveManualNight`: on the device it marks the local row removed (`deleted_at`,
 * pending) and queues `manual_sleep` `{ id, deleted: true }` in the same turn, so the night is gone
 * from every local read at once and the removal survives being offline; the outbox pushes it to the
 * same repository call the web route makes. Without a local store it calls
 * `DELETE /api/sleep-sessions/manual`. Either way it invalidates through `invalidateManualSleepWrite`.
 *
 * Refused, with nothing queued, for a night a device measured or an id the store does not hold. To
 * bring a removed night back, enter it again with `saveManualNight`: the removed row is revived.
 */
export async function removeManualNight(args: { userId: string; id: string }): Promise<RemoveManualNightResult> {
  const valid = ManualSleepRemoveSchema.safeParse({ id: args.id })
  if (!valid.success) return { ok: false, reason: 'invalid night id' }

  const store = getLocalStore(args.userId)
  if (store) {
    // The store answers with the night's wake date, so the outbox entry is filed under the night it
    // removes; null means a device night or an unknown id, and nothing is queued.
    const date = await store.removeManualSleepLocally(args.id)
    if (!date) return { ok: false, reason: 'Only a night you entered can be removed' }
    await store.queueMutation({ userId: args.userId, domain: 'manual_sleep', date, payload: { id: args.id, deleted: true } })
    pushMutations(args.userId).catch(() => {})
  } else {
    const res = await fetch('/api/sleep-sessions/manual', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: args.id }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      return { ok: false, reason: body?.error ?? `HTTP ${res.status}` }
    }
  }

  await invalidateManualSleepWrite()
  return { ok: true }
}
