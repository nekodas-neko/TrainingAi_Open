/**
 * #2184 (BF-137) — say so when a logged dose started, stopped or changed inside the window a
 * calibrated maintenance was learned from.
 *
 * **A caveat, never a correction.** The owner's decision (2026-10-06) replaced the proposed pause:
 * *"If I start taking more or less fish oil or creatine it will need to rebaseline? Not exactly
 * good."* So the estimator keeps ignoring the supplement log and this module changes no number. It
 * only names the event, because early GLP-1 loss (and a creatine load, and the next drug) moves the
 * scale for reasons that are not metabolism, and the maintenance figure is read off the scale.
 *
 * **Supplement-agnostic.** No substance, dose or date is known here; every logged substance is
 * treated alike. Identity is the supplement's id; the name is only for the sentence.
 *
 * **The dose is the log's `amount` + `unit`, never its `doseText`, whenever an amount exists.** The
 * first Retatrutide row's `dose_text` is `"10mg"`, the VIAL strength, beside an `amount` of 0.5 mg —
 * comparing text would report a 20× change that never happened. Text is compared only when neither
 * dose carries an amount, and a dose with no value at all (null → "2 capsules") is never a change.
 */

import type { DoseEvent } from './dose-context'
import { formatDateDisplay } from '../date-utils'

/** One live `supplement_logs` row, of ANY supplement — not only vial-dosed ones (contrast
 *  `DoseEvent`, which TN-46 restricts to administered vial doses and so always carries an amount). */
export interface DoseLogEntry extends Omit<DoseEvent, 'amount'> {
  supplementId: string
  amount: number | null
  doseText: string | null
}

/** A supplement definition's dated end, for the `stop` half. */
export interface SupplementCourse {
  supplementId: string
  supplementName: string
  stoppedOn: string | null
}

export type DoseChangeKind = 'start' | 'change' | 'stop'

export interface DoseChange {
  supplementId: string
  supplementName: string
  /** The local day it happened, YYYY-MM-DD. */
  date: string
  kind: DoseChangeKind
}

/**
 * How far before the window the log is read, so a dose inside the window can be told apart from
 * the first one. A substance with no log in this span before a dose reads as STARTED on it, so
 * resuming after three months off is a start — which it is, as far as the scale is concerned.
 */
export const DOSE_HISTORY_LOOKBACK_DAYS = 90

const normUnit = (u: string | null) => (u ?? '').trim().toLowerCase()
const normText = (t: string | null) => (t ?? '').trim().toLowerCase().replace(/\s+/g, '')
const sameAmount = (a: number, b: number) => Math.abs(a - b) < 1e-6

/** Does `cur` record a different dose from `prev`? Amount wins; text only when neither has one. */
export function doseDiffers(prev: DoseLogEntry, cur: DoseLogEntry): boolean {
  if (prev.amount != null && cur.amount != null) {
    return !sameAmount(prev.amount, cur.amount) || normUnit(prev.unit) !== normUnit(cur.unit)
  }
  if (prev.amount == null && cur.amount == null) {
    const a = normText(prev.doseText)
    const b = normText(cur.doseText)
    return a !== '' && b !== '' && a !== b
  }
  return false
}

/**
 * Every start, dose change and stop dated in `[windowStart, windowEnd]`, oldest first.
 *
 * `logs` should reach back `DOSE_HISTORY_LOOKBACK_DAYS` before `windowStart`; a log outside that
 * span is harmless. A change is judged against the substance's previous dose of the SAME kind of
 * value (an amount against the last amount, text against the last text), so a log that skipped the
 * dose does not make the next one look like a change. A stop is the definition's `stoppedOn`, and
 * only for a substance that was actually logged before it.
 */
export function doseChangesInWindow(
  logs: DoseLogEntry[],
  courses: SupplementCourse[],
  windowStart: string,
  windowEnd: string,
): DoseChange[] {
  const inWindow = (d: string) => d >= windowStart && d <= windowEnd
  const bySupplement = new Map<string, DoseLogEntry[]>()
  for (const l of logs) {
    const list = bySupplement.get(l.supplementId) ?? []
    list.push(l)
    bySupplement.set(l.supplementId, list)
  }

  const out: DoseChange[] = []
  for (const [supplementId, list] of bySupplement) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date))
    const first = sorted[0]
    if (inWindow(first.date)) {
      out.push({ supplementId, supplementName: first.supplementName, date: first.date, kind: 'start' })
    }
    let lastWithAmount: DoseLogEntry | null = first.amount != null ? first : null
    let lastWithTextOnly: DoseLogEntry | null = first.amount == null ? first : null
    for (const cur of sorted.slice(1)) {
      const prev = cur.amount != null ? lastWithAmount : lastWithTextOnly
      // Two logs on the first day are one start, not a start and a change.
      if (prev && cur.date !== first.date && inWindow(cur.date) && doseDiffers(prev, cur)) {
        const already = out.some(c => c.supplementId === supplementId && c.date === cur.date && c.kind === 'change')
        if (!already) out.push({ supplementId, supplementName: cur.supplementName, date: cur.date, kind: 'change' })
      }
      if (cur.amount != null) lastWithAmount = cur
      else lastWithTextOnly = cur
    }
  }

  for (const c of courses) {
    if (c.stoppedOn == null || !inWindow(c.stoppedOn)) continue
    const taken = bySupplement.get(c.supplementId)?.some(l => l.date <= c.stoppedOn!)
    if (taken) out.push({ supplementId: c.supplementId, supplementName: c.supplementName, date: c.stoppedOn, kind: 'stop' })
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.supplementName.localeCompare(b.supplementName))
}

const clause = (c: DoseChange) =>
  c.kind === 'start' ? `started ${c.supplementName} on ${formatDateDisplay(c.date)}`
  : c.kind === 'stop' ? `stopped ${c.supplementName} on ${formatDateDisplay(c.date)}`
  : `changed your ${c.supplementName} dose on ${formatDateDisplay(c.date)}`

/**
 * One plain sentence for the recommendation, or null when nothing changed. Names the two earliest
 * events (the earliest is where "since" anchors) and counts the rest:
 * *"You started Retatrutide on 7 Sept and changed your Retatrutide dose on 13 Sept, so weight
 * changes since 7 Sept may not reflect your metabolism."*
 */
export function doseChangeCaveat(changes: DoseChange[]): string | null {
  if (changes.length === 0) return null
  const [a, b] = changes
  const more = changes.length - 2
  const events = b == null
    ? clause(a)
    : `${clause(a)}${more > 0 ? `, ` : ' and '}${clause(b)}${more > 0 ? ` and made ${more} other dose change${more === 1 ? '' : 's'}` : ''}`
  return `You ${events}, so weight changes since ${formatDateDisplay(a.date)} may not reflect your metabolism.`
}
