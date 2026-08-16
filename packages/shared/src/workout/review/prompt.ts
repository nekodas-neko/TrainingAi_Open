import type { PrescriptionSignals } from '@trainingai/shared/ai-periodization/signals'
import { displayOneRm } from '@trainingai/shared/1rm'
import { intensityZone } from '@trainingai/shared/ai-periodization/prompt'
import { PCT_BANDS } from '@trainingai/shared/workout/time-profile'
import { SECONDS_PER_REP, SET_SETUP_SEC } from '@trainingai/shared/workout/duration-model'
import type { SetShape } from './reconcile'

export function buildReviewSystemPrompt(trainingGoal: string, phase: string): string {
  const z = intensityZone(trainingGoal, phase)
  return `You are a workout review engine. The user asked you to review ONE training session and adjust it so it fits its time budget while respecting their weekly muscle-group volume targets and current periodization phase.

Training goal: ${trainingGoal}. Current phase: ${phase}.
Phase intensity zone: ${z.pctMin}-${z.pctMax}%, ${z.repMin}-${z.repMax} reps, ${z.setsMin}-${z.setsMax} sets per exercise.

For EACH exercise output one action:
- "keep":   leave it exactly as it is now (its current sets×reps@pct are already appropriate).
- "adjust": change its sets/reps/pct/rest_sec (e.g. add a set to under-target muscle work, or trim volume). Stay inside the phase intensity zone.
- "drop":   remove the exercise from this session. Provide a short drop_reason.

Your PRIMARY objective: bring the estimated session duration under effective_time_budget_min. If the session is over budget, DROP the least valuable exercise(s) — the strongest drop candidates are accessories whose muscles are already at or above their weekly target. Dropping one exercise frees far more time than trimming sets, and (unlike the automatic set-trimmer) you are allowed to drop.

Hard rules:
- ALWAYS keep at least one primary (main compound lift). If a session has two primaries you may drop one to fit the budget, but never the last.
- NEVER drop the only exercise covering a muscle that is under its weekly target — trim or keep it instead.
- Prefer dropping/trimming muscles already at or over their weekly target; protect under-target muscles.
- Keep every kept/adjusted exercise inside the phase intensity zone above.
- Do NOT pre-lower pct for fatigue/soreness — that is handled elsewhere. Pick a neutral pct in the zone.

Duration formula: for each surviving exercise, time = sets × (${SET_SETUP_SEC} + reps × sec_per_rep) + (sets − 1) × rest + transition_sec.
sec_per_rep is the exercise's measured_sec_per_rep when given, else ${SECONDS_PER_REP}. rest is the measured rest for the band your pct falls in (light <70%, moderate 70-80%, heavy 80-90%, max ≥90%) when listed, else your rest_sec. These measured values are the user's real logged times — trust them. A deterministic guard also enforces the rules and recomputes duration after you, so aim to be correct yourself.

Output field notes:
- session_exercise_id: copy exactly from the list — never invent one, and include every exercise once.
- reasoning: 2-3 sentences explaining the overall change (what you dropped/adjusted and why it now fits).
- confidence: 0.0-1.0.`
}

export function buildReviewUserPrompt(
  signals: PrescriptionSignals,
  currentParams: Map<string, SetShape>,
  today: string,
): string {
  const exerciseLines = signals.exercises.map(ex => {
    const cur = currentParams.get(ex.sessionExerciseId)
    const musclesStr = ex.muscleAssignments.length > 0
      ? ex.muscleAssignments.map(ma => `${ma.muscle} (${ma.role})`).join(', ')
      : ex.muscleGroups.join(', ')
    const tp = ex.timeProfile
    const restBands = tp
      ? PCT_BANDS.filter(b => tp.restSecByBand[b] != null).map(b => `${b} ${Math.round(tp.restSecByBand[b]!)}s`).join(', ')
      : ''
    const measuredStr =
      (tp?.secPerRep != null ? `, measured_sec_per_rep: ${tp.secPerRep.toFixed(1)}` : '') +
      (restBands ? `, measured_rest_by_band: [${restBands}]` : '')
    const curStr = cur ? `current: ${cur.sets}×${cur.reps} @${cur.pct}% rest ${cur.restSec}s` : 'current: unknown'
    return `  - ${ex.name} (id: ${ex.sessionExerciseId}, role: ${ex.role}, muscles: ${musclesStr}, ${curStr}, ` +
      // Q-19b: reps for a bodyweight movement, kilograms otherwise — same helper as every
      // other 1RM surface, so the model is never told a bodyweight record is a weight.
      `current_1rm: ${ex.current1rm == null ? 'unknown' : displayOneRm(ex.current1rm, ex.exerciseType).text}, ` +
      `rm1_trend: ${ex.rm1Trend}, transition_sec: ${ex.transitionSec}${measuredStr})` +
      (ex.plateau ? ' [1RM flat ≥3 weeks]' : '')
  }).join('\n')

  const hasVolumeTargets = Object.keys(signals.weeklyTargets).length > 0
  const volumeLines = hasVolumeTargets
    ? Object.keys({ ...signals.weeklyTargets, ...signals.weeklyLogged })
        .map(mg => `  ${mg}: logged ${(signals.weeklyLogged[mg] ?? 0).toFixed(1)} / target ${signals.weeklyTargets[mg] ?? 0} sets/week`)
        .join('\n')
    : '  no volume targets configured (unconstrained)'

  const soreSuffix = signals.sorenessLogDate === 'yesterday' ? ' [from yesterday]' : ''
  return `Current date: ${today}
Program goal: ${signals.trainingGoal}
effective_time_budget_min: ${signals.effectiveTimeBudgetMin}
Phase: ${signals.phase} (${signals.sessionsInPhase} sessions in phase)

Session exercises (review every one):
${exerciseLines}

Weekly volume so far (Mon–Sun) — protect under-target muscles, prefer trimming over-target ones:
${volumeLines}

Recovery context:
  Sore muscles in this session: ${signals.soreMusclesInSession.length > 0 ? signals.soreMusclesInSession.join(', ') + soreSuffix : 'none'}
  Active injuries in this session: ${signals.activeInjuredMusclesInSession.length > 0 ? signals.activeInjuredMusclesInSession.join(', ') : 'none'}

Review the session now: keep, adjust, or drop each exercise so the estimated duration fits effective_time_budget_min.`
}
