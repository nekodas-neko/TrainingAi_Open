import { estimateOneRm, mround, BW_REF } from '../1rm'
import { computeIntensityPct } from './set-aggregates'
import type { StylelessLogChange, StylelessRederivePlan } from './styleless-one-rm-rederive'

/**
 * #2760 (owner decided 2026-10-09: "yes, re-encode once"). A bodyweight "1RM" is not kilograms but
 * an index (`BW_REF` plus added load) that screens turn back into a rep max. Issue 2193 (a) made the
 * AMRAP discount a straight line; rows stored before it carry the old stepped encoding, and at a few
 * values the two collide (an old 10-rep set stored what 9 reps stores now), so they read back a rep
 * low wherever no logged reps are to hand. This plans re-encoding each stored bodyweight estimate
 * under the current map, through the same `estimateOneRm` the log path calls.
 *
 * Exact, not guessed: a bodyweight estimate is a pure function of the logged reps and added load,
 * and of which sets counted, which `set_logs.use_for_1rm` recorded at log time. The target keeps the
 * percentage it was stored with (inferred from the stored pair, 80 when none fits).
 *
 * **Upward only.** A legacy row almost always rises. The old encoding rounded twice, so at one rep
 * count per load (30 reps at bodyweight, 20 at +5 kg) it sits one 0.25 step above the smooth value;
 * that row, and any stored under some other formula, is reported in `wouldLower` and never written,
 * and it already reads back the reps it was. A row already at its value is `unchanged`, so a second
 * run writes nothing. Pure: `lib/workout/reencode-bodyweight-one-rm.ts` selects and writes.
 */

export interface BodyweightLogInput {
  exerciseLogId: string
  exerciseName: string
  loggedAt: Date
  estimated1rm: number
  target80: number | null
  sets: { setLogId: string; weightKg: number; reps: number; useFor1rm: boolean; intensityPct: number | null }[]
}

/** The target percentage a stored (estimate, target) pair was written with: the whole or half
 *  percent from 50 to 100 that reproduces the stored target exactly, else 80, the log path's default. */
export function storedTargetPct(estimated1rm: number, target80: number | null): number {
  if (target80 == null || !(estimated1rm > 0)) return 80
  const guess = Math.round((target80 / estimated1rm) * 200) / 2
  for (const pct of [guess, 80]) {
    if (pct >= 50 && pct <= 100 && mround(estimated1rm * pct / 100, 0.25) === target80) return pct
  }
  return 80
}

export function planBodyweightOneRmReencode(logs: readonly BodyweightLogInput[]): StylelessRederivePlan {
  const changes: StylelessLogChange[] = []
  const wouldLower: StylelessRederivePlan['wouldLower'] = []
  let unchanged = 0
  for (const log of logs) {
    if (log.sets.length === 0 || !(log.estimated1rm > 0)) { unchanged++; continue }
    // A style of flags only: `amrapAverage1Rm` reads `useFor1rm` to pick the counted sets, exactly
    // as it did at log time; no percentage, so `targetPct` below decides the target.
    const style = log.sets.map(s => ({ pct: 0, reps: s.reps, useFor1rm: s.useFor1rm }))
    const { estimated1rm, target80 } = estimateOneRm(
      log.sets.map(s => ({ weightKg: s.weightKg, reps: s.reps })),
      { exerciseType: 'bodyweight', style, targetPct: storedTargetPct(log.estimated1rm, log.target80) },
    )
    if (estimated1rm === log.estimated1rm) { unchanged++; continue }
    if (estimated1rm < log.estimated1rm) {
      wouldLower.push({ exerciseLogId: log.exerciseLogId, exerciseName: log.exerciseName, loggedAt: log.loggedAt, stored: log.estimated1rm, rederived: estimated1rm })
      continue
    }
    changes.push({
      exerciseLogId: log.exerciseLogId,
      exerciseName: log.exerciseName,
      loggedAt: log.loggedAt,
      before: { estimated1rm: log.estimated1rm, target80: log.target80 },
      after: { estimated1rm, target80 },
      // The intensity the edit path writes for a bodyweight set: priced at BW_REF plus the load.
      sets: log.sets.map(s => ({ setLogId: s.setLogId, intensityPct: computeIntensityPct(Math.max(1, BW_REF + s.weightKg), estimated1rm) })),
    })
  }
  return { changes, unchanged, wouldLower }
}
