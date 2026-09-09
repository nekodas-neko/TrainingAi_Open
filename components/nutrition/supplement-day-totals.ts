import type { SupplementDayAmount } from '@trainingai/shared/types/supplement'

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
