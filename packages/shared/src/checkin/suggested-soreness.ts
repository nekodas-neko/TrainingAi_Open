import { moodMuscleMatches } from '@trainingai/shared/muscles'

// "Sore" in the check-in means NOT RECOVERED (owner call 2026-07-29) — training a muscle again
// before it has recovered is the thing worth flagging, and it is derivable from the training log
// rather than something the lifter has to remember.
//
// Two conditions, both required:
//
//  1. Trained within this window. DOMS peaks ~24-48h out; past that the muscle has usually
//     settled even if the recovery curve hasn't formally topped out.
export const SORENESS_EXPECTED_WITHIN_HOURS = 48
//  2. Still measurably under-recovered. computeMuscleRecovery scales its time constant with how
//     hard the muscle was hit (16-48h), so this is strictly better than the clock alone: 47h
//     after a heavy leg day is ~63% recovered, while 47h after a light one is ~95%. Without this
//     the light case would be flagged as sore purely for having happened recently.
export const RECOVERED_PCT = 85

export interface RecoveryLike {
  muscle: string
  hoursAgo: number
  pct: number
}

// Which check-in pills to mark as not-recovered, given per-muscle recovery data.
//
// Matching goes through moodMuscleMatches so the recovery feed's canonical names ("quadriceps",
// "gluteal") line up with the broader regional pill labels ("Quads", "Glutes", "Back") instead
// of needing a second synonym table here.
//
// Safe to auto-select on this program: only muscles in TODAY'S session can deload anything
// (soreMusclesInSession), and a measurement of the last 10 real sessions found 8 with zero
// overlap against the session before. The two that overlapped were back-to-back leg days at
// 46-47h — glutes and hamstrings — which is exactly the case worth deloading.
export function suggestedSoreMuscles(
  recovery: RecoveryLike[] | null | undefined,
  pillLabels: string[],
  withinHours: number = SORENESS_EXPECTED_WITHIN_HOURS,
): string[] {
  if (!recovery?.length) return []
  const unrecovered = recovery.filter(r =>
    Number.isFinite(r.hoursAgo) && r.hoursAgo >= 0 && r.hoursAgo <= withinHours
    && Number.isFinite(r.pct) && r.pct < RECOVERED_PCT,
  )
  if (unrecovered.length === 0) return []
  return pillLabels.filter(label => unrecovered.some(r => moodMuscleMatches(r.muscle, label)))
}
