import { formatDateDisplay } from '@trainingai/shared/date-utils'

export interface ResilienceCoverage {
  daysSeen: number
  daysMeetingCoverageGate: number | null
  coverageGateMinutes: number | null
  minValidDays: number | null
  modelWindowDays: number | null
}

/**
 * What the surface may say when no resilience level exists (LA-158).
 *
 * **It is an OBSERVATION and must never become a diagnosis.** The readiness payload looks at a
 * 7-day window while the model gates on `windowDays` (14), so a shortfall the payload can see is
 * *consistent with* the coverage gate having closed without establishing that it did. The sentence
 * therefore states the two counts side by side and draws no line between them — no "because", no
 * "that is why". `readiness-payload.ts` pins the absence of a `reason` field for the same reason,
 * so a later tidy-up cannot turn the pairing into a verdict.
 *
 * It degrades rather than guessing. Every threshold is `null` when the resilience constants were
 * not injected on the request, which is a different thing from a threshold of zero — so each
 * clause appears only when its own numbers are there.
 */
export function resilienceShortfallLine(c: ResilienceCoverage): string | null {
  if (!Number.isFinite(c.daysSeen) || c.daysSeen <= 0) return null

  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

  if (c.daysMeetingCoverageGate == null) {
    // Nothing to compare against: say what was looked at and stop.
    return `Checked the last ${days(c.daysSeen)}.`
  }

  const seen = `${c.daysMeetingCoverageGate} of the last ${days(c.daysSeen)} had enough daytime coverage`
  return c.minValidDays != null && c.modelWindowDays != null
    ? `${seen}; the model needs ${c.minValidDays} of ${c.modelWindowDays}.`
    : `${seen}.`
}

/**
 * The line naming the day a stale level came from, or null when it is today's (LA-158).
 *
 * The level is the most recent one in a 7-day window, **not necessarily today's** — on 2026-09-27
 * the tile rendered 09-22's level as if it were current, with no date, and would have gone silently
 * blank once 09-22 left the window. A surface showing a number it cannot vouch for as current owes
 * the reader its date.
 *
 * `From <date>` rather than a new phrasing: `RV-202`'s amber source pill on the workout screen
 * already says `From 26 Sept` for exactly this — a number built on an earlier day — and one
 * vocabulary for one idea is the point of `RV-208`.
 */
export function resilienceAsOfLine(asOf: string | null, today: string): string | null {
  // A payload from before `ownResilienceAsOf` shipped carries no day. Absent is not stale: say
  // nothing rather than inventing a date or implying the number is old.
  if (asOf == null || asOf >= today) return null
  return `From ${formatDateDisplay(asOf, 'short')}, not today.`
}
