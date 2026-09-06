import type { SupplementWithStatus } from '@trainingai/shared/types/supplement'

/**
 * The line under a supplement's name: what the day actually recorded, falling back to what the
 * definition says.
 *
 * **Two different questions, and the order matters (BF-112, BF-3 gap 1).** `loggedAmount` is what
 * was taken today; `defaultAmount` is what the definition currently says. Editing the definition
 * must not rewrite what a past day shows, which is why the log's number wins whenever there is one
 * — the same reason `supplement_logs.dose_text` is stamped at log time rather than joined.
 *
 * **A null amount is not zero.** A tick with no number means "taken", not "took none of it", so an
 * amount-less log falls through to the definition rather than rendering `0`.
 */
export function supplementSubtitle(s: Pick<SupplementWithStatus, 'dose' | 'defaultAmount' | 'unit' | 'loggedAmount'>): string | null {
  const withUnit = (n: number, unit: string | null | undefined) => `${n}${unit ? ` ${unit}` : ''}`

  const logged = s.loggedAmount
  if (logged && logged.amount != null) {
    const base = withUnit(logged.amount, logged.unit ?? s.unit)
    // Two doses in a day is not a bug — the count says so rather than hiding one of them.
    return logged.contributions > 1 ? `${base} today · ${logged.contributions} doses` : `${base} today`
  }

  if (s.defaultAmount != null) return withUnit(s.defaultAmount, s.unit)
  return s.dose?.trim() || null
}
