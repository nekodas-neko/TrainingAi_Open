import type { LocalSupplementLog } from '@/lib/local-store/types'
import type { SupplementDayAmount } from '@trainingai/shared/types/supplement'

/**
 * BF-112. The day's exposure to each substance, derived from its live contributions.
 *
 * The Postgres adapter derives the same two values on read (`listSupplements`), and the device
 * cannot reach that code — the nutrition page returns early on its local-first branch, so on the
 * APK these fields would otherwise never be populated at all. **This is a second implementation of
 * one formula and is filed as LB-57 for Lane A to hoist into `packages/shared`**; `packages/shared`
 * and `lib/data` are Lane A's, so the extraction is not this lane's to make.
 *
 * The semantics that must match, and each is load-bearing:
 * - `loggedToday` counts the MANUAL contribution only. It is the tick's checked state, and the tick
 *   writes and removes exactly that row — a meal's dose turning it on leaves a control that refuses
 *   to turn off.
 * - `loggedAmount` counts EVERY live contribution, which is what answers "was it taken today".
 * - its `amount` stays null when no contribution carried a number. A tick means "taken", not "took
 *   none of it", and 0 is the unknown-coerced-to-zero mistake the presence model exists to prevent.
 */
export function summariseSupplementDay(
  logs: LocalSupplementLog[],
): Map<string, { loggedToday: boolean; loggedAmount: SupplementDayAmount }> {
  const out = new Map<string, { loggedToday: boolean; loggedAmount: SupplementDayAmount }>()
  for (const l of logs) {
    if (l.deletedAt) continue
    const acc = out.get(l.supplementId)
      ?? { loggedToday: false, loggedAmount: { amount: null, unit: null, contributions: 0 } }
    // `source` is optional on the type because every writer that predates BF-69 omits it, and
    // `upsertSupplementLog` defaults it to 'manual' — so an absent source is a manual tick.
    if ((l.source ?? 'manual') === 'manual') acc.loggedToday = true
    if (l.amount != null) acc.loggedAmount.amount = (acc.loggedAmount.amount ?? 0) + l.amount
    acc.loggedAmount.unit ??= l.unit ?? null
    acc.loggedAmount.contributions += 1
    out.set(l.supplementId, acc)
  }
  return out
}

/**
 * The same total after the page's own tick, without waiting for a round trip.
 *
 * Without this the subtitle keeps rendering the PREVIOUS log's number: `onChanged` used to flip
 * `loggedToday` alone, so un-ticking a 5 mg dose left "5 mg today" on screen and re-ticking it at
 * 7.5 mg still read 5. Measured in the browser before it was fixed.
 */
export function applyManualToggle(
  prev: SupplementDayAmount | null | undefined,
  change: { logging: boolean; amount: number | null; unit: string | null },
): SupplementDayAmount | null {
  const base = prev ?? { amount: null, unit: null, contributions: 0 }
  if (change.logging) {
    return {
      amount: change.amount == null ? base.amount : (base.amount ?? 0) + change.amount,
      unit: base.unit ?? change.unit,
      contributions: base.contributions + 1,
    }
  }
  const contributions = Math.max(0, base.contributions - 1)
  if (contributions === 0) return null
  return {
    // Subtracting only what this contribution carried leaves the others intact; a removed row with
    // no number never contributed to the sum, so the sum does not move.
    amount: change.amount == null || base.amount == null ? base.amount : base.amount - change.amount,
    unit: base.unit,
    contributions,
  }
}
