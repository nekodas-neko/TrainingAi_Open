// The health insight, written from the numbers rather than asked for (RV-201).
//
// This route was the app's most-called prose route — 28 calls in 30 days, measured 2026-09-26 —
// and every fact it handed the model was already computed here. The model's only contribution was
// phrasing, and it phrased badly often enough to matter: 16% of 117 audited insights carried a
// superlative or an imperial unit, including calling a score of 80 "perfect" (Q-292).
//
// The owner's decision (2026-09-25, recorded on RV-200) is to prefer logic: "we use AI more than
// we need to … use logic instead to save on tokens and offline compatibility."
//
// The shape below is the one the prompt asked the model for — the headline reading and its band,
// the weakest contributor, today against the recent values, and an explicit note for anything not
// measured. Three things it can no longer do, which is the point: invent a number, call a value
// good or bad in words the bands do not support, or read an absent metric as a zero.

import { median } from '@trainingai/shared/stats'

/** A recent series to place today against. `values` excludes today. */
export interface RecentComparison {
  /** What the series is, as it appears mid-sentence: "the past week's scores". */
  noun: string
  values: number[]
  today: number | null
  /** true when a LOWER number is the better one (resting heart rate), so wording flips. */
  lowerIsBetter?: boolean
}

export interface InsightParts {
  /** The section's primary reading, already rendered with its unit. */
  headline?: { label: string; value: string; band?: string | null } | null
  /** Every other measured line, `Label: value`, exactly as assembled. */
  lines: string[]
  /** Labels of metrics with no reading today. NOT zeros — see the sentence they produce. */
  absent: string[]
  weakest?: { label: string; value: number } | null
  recent?: RecentComparison | null
  /** Prepended verbatim when the Oura daily fields are older than the requested date. */
  staleNote?: string | null
}

/**
 * Where today sits against the recent values, as a clause, or null when there is nothing to
 * compare. Deliberately three coarse buckets rather than a percentage: the series is short (seven
 * points at most) and a precise-looking delta off seven readings would overstate what it knows.
 *
 * The median, not the mean — one bad night should not move the thing today is being judged
 * against, the same reason the sleep verdict uses order statistics (TN-81).
 */
function comparisonClause(c: RecentComparison): string | null {
  const vals = c.values.filter(v => Number.isFinite(v))
  if (c.today == null || vals.length < 3) return null
  const mid = median(vals)
  if (mid == null) return null
  const delta = c.today - mid
  // Under a point of difference is not a movement worth a sentence.
  if (Math.abs(delta) < 1) return `in line with ${c.noun} (median ${round1(mid)})`
  const higher = delta > 0
  const better = c.lowerIsBetter ? !higher : higher
  return `${higher ? 'above' : 'below'} ${c.noun} (median ${round1(mid)}), which is the ${better ? 'better' : 'weaker'} side`
}

function round1(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1)
}

/**
 * The absent sentence, which exists to stop silence being read as a zero.
 *
 * The prompt used to spend a paragraph instructing the model not to describe a missing reading as
 * low, skipped, or as something the user did or did not do. A template cannot make that mistake,
 * so the instruction becomes one plain clause.
 */
function absentSentence(absent: string[]): string | null {
  if (absent.length === 0) return null
  const list = absent.length === 1
    ? absent[0]
    : `${absent.slice(0, -1).join(', ')} and ${absent[absent.length - 1]}`
  return `No reading was recorded today for ${list}.`
}

/** Join sentences, tolerating nulls, without leaving a double space or a trailing gap. */
function sentences(...parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).map(p => p.trim()).join(' ')
}

export function buildInsightText(parts: InsightParts): string {
  const { headline, lines, absent, weakest, recent, staleNote } = parts

  const lead = headline
    ? `${headline.label} is ${headline.value}${headline.band ? ` (${headline.band})` : ''}.`
    : null

  const comparison = recent ? comparisonClause(recent) : null
  const placed = comparison ? `That is ${comparison}.` : null

  // The label verbatim, never lowercased: `labelFor` returns "HRV balance", and case-folding a
  // metric name to fit mid-sentence produced "hrv balance" on the section it matters most on.
  const weak = weakest
    ? `The weakest contributor is ${weakest.label} at ${weakest.value}/100.`
    : null

  // Everything measured that the sentences above did not already name. A readout rather than
  // prose: these are the user's own numbers and the card is where they come to see them.
  const rest = lines.length > 0 ? `Also recorded — ${lines.join(' · ')}.` : null

  const body = sentences(lead, placed, weak, rest, absentSentence(absent))
  return staleNote ? sentences(staleNote, body) : body
}
