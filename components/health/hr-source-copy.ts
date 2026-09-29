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
        detail: 'No resting readings yet, so 60 is assumed — wear your ring overnight and this becomes yours.',
      }
    default:
      return null
  }
}
