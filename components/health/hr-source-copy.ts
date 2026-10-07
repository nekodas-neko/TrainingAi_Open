import type { HrProfile } from '@trainingai/shared/health/hr-profile'

/**
 * LA-82 — say when a zone boundary rests on a stand-in rather than on the user.
 *
 * `resolveHrProfile` guards its three reads, so a transient fault no longer takes a screen down —
 * it substitutes a value and names the substitution in the source field. Nothing rendered it, so an
 * age-unread max read exactly like a real age estimate: the quiet wrong answer the owner's
 * 2026-09-25 decision ruled out.
 *
 * Both surfaces that show these numbers share this wording, so they cannot drift into describing
 * the same provenance two ways.
 */

/**
 * #2338 — empty-state copy that does not assume the reader owns a ring.
 *
 * Every empty heart-rate state used to say "wear your ring", which a user with only a strap, or
 * only Health Connect, or nothing yet, cannot act on. Where a surface KNOWS there is no heart-rate
 * source at all (`hasHrSource === false`, from `health/hr-profile.ts` — the one definition) it names
 * the three things the user can connect. Where there is a source, or it is unknown, it says what is
 * missing without naming a device. Wording lives here so the surfaces cannot drift apart.
 */
export const HR_SOURCES = 'a ring, a chest strap or Health Connect'

/** What resting heart rate is built from: a night of readings, which a strap does not record. */
const RESTING_HR_NEEDS = 'it becomes yours once a ring or Health Connect records a night of heart rate.'

export type NoHrDataContext = 'workout' | 'window' | 'range' | 'day'

/**
 * The line for a heart-rate empty state. `hasHrSource` is `false` only when nothing has recorded
 * this person's heart rate; `true`/`null`/`undefined` all take the neutral wording, because "a
 * source exists but nothing landed here" and "we could not tell" are not the same as "connect one".
 */
export function noHrDataCopy(hasHrSource: boolean | null | undefined, context: NoHrDataContext): string {
  if (hasHrSource === false) {
    switch (context) {
      case 'range':
        return `No heart-rate data yet — connect ${HR_SOURCES} to build your range.`
      case 'day':
        return `No heart rate yet — connect ${HR_SOURCES} to record it through the day.`
      case 'window':
        return `No heart-rate data in this window yet — connect ${HR_SOURCES}, then record a workout.`
      default:
        return `No heart-rate data yet — connect ${HR_SOURCES}, then record a workout.`
    }
  }
  switch (context) {
    case 'range':
      return 'Still learning your range — it sharpens with a few more days of heart-rate data.'
    case 'day':
      return 'No heart rate recorded yet today.'
    case 'window':
      return 'No heart-rate data in this window yet — it fills in when a workout is recorded with a heart-rate sensor.'
    default:
      return 'No heart-rate data yet — it fills in when a workout is recorded with a heart-rate sensor.'
  }
}

export interface SourceNote {
  /** Short parenthetical for beside the number. */
  label: string
  /** True when the number is a substitute for something that could not be read. */
  standIn: boolean
  /** The longer line, present only when there is something the reader should act on. */
  detail?: string
}

export function maxHrSourceNote(source: HrProfile['maxHrSource'] | undefined | null): SourceNote {
  switch (source) {
    case 'observed':
      return { label: 'your recorded max', standIn: false }
    case 'estimated-age-unread':
      // The distinction that matters: this is not 220 − age, it is the no-age 190. For this owner
      // that moves every zone boundary by 6 bpm, so a quota measured against it is measured against
      // a stand-in.
      return {
        label: 'a stand-in',
        standIn: true,
        detail: 'Your age couldn’t be read, so this is a generic 190 rather than an estimate from your age — zone boundaries are approximate until it loads.',
      }
    default:
      return { label: 'age-estimated', standIn: false }
  }
}

export function restingHrSourceNote(source: HrProfile['restingHrSource'] | undefined | null): SourceNote | null {
  switch (source) {
    case 'unavailable':
      return {
        label: 'a stand-in',
        standIn: true,
        detail: 'Your resting heart rate couldn’t be read, so 60 is assumed — zone boundaries are approximate until it loads.',
      }
    case 'default':
      // Not the same thing as a failed read, and the reader can act on this one.
      return {
        label: 'assumed',
        standIn: true,
        detail: `No resting readings yet, so 60 is assumed — ${RESTING_HR_NEEDS}`,
      }
    default:
      return null
  }
}
