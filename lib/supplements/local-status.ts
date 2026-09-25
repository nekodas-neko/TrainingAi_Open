import { summariseSupplementDay } from '@trainingai/shared/nutrition/supplement-day-totals'
import type { SupplementWithStatus } from '@trainingai/shared/types/supplement'
import type { LocalSupplement, LocalSupplementLog } from '@/lib/local-store/types'

/**
 * The on-device supplement rows, shaped the way the server's `listSupplements` shapes them.
 *
 * **Extracted because a second copy is how this breaks.** The mapping lived inline in
 * `useSupplements`, and when it was written it dropped the dose fields — so a dose prompt worked in
 * the browser, where `getLocalStore` is null and the server's own mapping is used, and never fired
 * on the APK (BF-112). The sync-provider's reminder reconcile needs the same shape, and writing it
 * a second time would reproduce exactly that failure, silently and only on device.
 *
 * `createdAt` takes `updatedAt`: the local table carries no creation timestamp, and nothing reading
 * this shape uses the field for more than ordering.
 */
export function localSupplementsToStatus(
  defs: LocalSupplement[],
  logs: LocalSupplementLog[],
  userId: string,
): SupplementWithStatus[] {
  const day = summariseSupplementDay(logs)
  return defs.map(s => ({
    id: s.id,
    userId,
    name: s.name,
    dose: s.dose,
    defaultAmount: s.defaultAmount ?? null,
    unit: s.unit ?? null,
    startedOn: s.startedOn ?? null,
    stoppedOn: s.stoppedOn ?? null,
    dosePrompt: s.dosePrompt === true,
    reminderEnabled: s.reminderEnabled,
    reminderTime: s.reminderTime,
    sortOrder: s.sortOrder,
    active: s.active,
    createdAt: s.updatedAt,
    loggedToday: day.get(s.id)?.loggedToday === true,
    loggedAmount: day.get(s.id)?.loggedAmount ?? null,
  }))
}
