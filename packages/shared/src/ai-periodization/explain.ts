import { isBodyweightType } from '@trainingai/shared/1rm'
// Plain-English rationale for why an exercise got its prescribed sets/reps/load.
// The exact numbers come from the AI within the goal's phase zone; these are the factors
// that shaped them — surfaced so a prescription isn't a black box.

const PHASE_INTENT: Record<string, string> = {
  baseline: 'finding your starting 1RM',
  accumulation: 'higher volume at moderate load to build',
  intensification: 'heavier load, fewer reps',
  realisation: 'peak strength — heaviest load, lowest reps',
  deload: 'light recovery work',
}

export interface ExerciseChoiceInput {
  phase: string
  role: string
  rm1Trend: 'up' | 'flat' | 'down'
  rm1ChangeKg: number
  lastSetMode?: 'amrap' | 'plus1'
  /** Bodyweight movements have no kg change to quote — their strength is a rep max (Q-19). */
  exerciseType?: string | null
}

export function explainExerciseChoice(i: ExerciseChoiceInput): string[] {
  const out: string[] = []
  const phaseLabel = i.phase.charAt(0).toUpperCase() + i.phase.slice(1)
  out.push(`${phaseLabel} phase — ${PHASE_INTENT[i.phase] ?? 'progressing load'} (sets the rep/intensity range)`)

  out.push(
    i.role === 'accessory'
      ? 'Accessory — supporting volume, fewer sets'
      : 'Compound lift — prioritised for sets and load',
  )

  // A bodyweight "1RM change in kg" is a change in an internal index, not in weight lifted, so the
  // direction is reported without the meaningless magnitude.
  const bw = isBodyweightType(i.exerciseType)
  if (i.rm1Trend === 'up') {
    out.push(bw
      ? 'Your rep max is trending up — target reps nudged up'
      : `Your 1RM is trending up (+${i.rm1ChangeKg.toFixed(1)}kg) — load nudged up`)
  } else if (i.rm1Trend === 'down') {
    out.push(bw
      ? 'Your rep max dipped — target reps eased to recover'
      : `Your 1RM dipped (${i.rm1ChangeKg.toFixed(1)}kg) — load eased to recover`)
  } else {
    out.push(bw ? 'Rep max steady — holding target to consolidate' : '1RM steady — holding load to consolidate')
  }

  if (i.lastSetMode === 'amrap') out.push('Last set AMRAP — beat the target to push your 1RM')
  else if (i.lastSetMode === 'plus1') out.push('Last set +1 rep — a small nudge to your 1RM')

  return out
}
