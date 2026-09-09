import type { SupplementDayAmount } from '../types/supplement'

/**
 * LB-57. The day's exposure to each substance, derived from its live contributions — the ONE
 * implementation, called by both lanes.
 *
 * There were two. `listSupplements` (the Postgres adapter) derived these on read, and the device
 * never reaches it: the nutrition page's local-first branch returns early once the local store has
 * definitions, so BF-112 had to derive the same totals again from `getSupplementLogs`. Both copies
 * agreed, which is exactly why this was worth hoisting before the next change to the rule — a new
 * `source` value handled on one side, or a mixed-unit day, and the device silently disagrees with
 * the server.
 *
 * The three behaviours that must not drift, each load-bearing:
 *
 * - **`loggedToday` counts the MANUAL contribution only.** It is the checked state of the
 *   supplements page's tick, and that tick writes and removes exactly the manual row — a meal's
 *   dose turning it on would leave a control that refuses to turn off. What answers "was it taken
 *   today" is `loggedAmount`, which counts every contribution.
 * - **`amount` stays null when no contribution carried a number.** A tick means "taken", not "took
 *   none of it"; reporting 0 is the unknown-coerced-to-zero mistake the presence model exists to
 *   prevent, one level down.
 * - **The unit is the first one any contribution supplies**, and a later contribution does not
 *   overwrite it.
 *
 * An absent `source` reads as manual. On the server the column is `NOT NULL DEFAULT 'manual'` so it
 * never arises, but the local row type marks it optional — every writer predating BF-69 omits it and
 * `upsertSupplementLog` defaults it — so the tolerant form is what makes one function serve both.
 */
export interface SupplementDayContribution {
  supplementId: string
  amount?: number | null
  unit?: string | null
  doseText?: string | null
  source?: string | null
  deletedAt?: string | Date | null
}

export interface SupplementDaySummary {
  loggedToday: boolean
  /** The manual contribution's own dose, or null when the day has none. `loggedToday` is `loggedDose != null`. */
  loggedDose: { amount: number | null; unit: string | null; doseText: string | null } | null
  loggedAmount: SupplementDayAmount
}

/**
 * Keyed by supplement id, and a supplement with no live contribution today is ABSENT from the map
 * rather than present with a zeroed entry — which is what lets both callers write
 * `day.get(id)?.loggedAmount ?? null`.
 */
export function summariseSupplementDay(
  logs: SupplementDayContribution[],
): Map<string, SupplementDaySummary> {
  const out = new Map<string, SupplementDaySummary>()
  for (const l of logs) {
    if (l.deletedAt) continue
    const acc = out.get(l.supplementId) ?? {
      loggedToday: false,
      loggedDose: null,
      loggedAmount: { amount: null, unit: null, contributions: 0 } as SupplementDayAmount,
    }
    if ((l.source ?? 'manual') === 'manual') {
      acc.loggedToday = true
      acc.loggedDose = { amount: l.amount ?? null, unit: l.unit ?? null, doseText: l.doseText ?? null }
    }
    if (l.amount != null) acc.loggedAmount.amount = (acc.loggedAmount.amount ?? 0) + l.amount
    acc.loggedAmount.unit ??= l.unit ?? null
    acc.loggedAmount.contributions += 1
    out.set(l.supplementId, acc)
  }
  return out
}
