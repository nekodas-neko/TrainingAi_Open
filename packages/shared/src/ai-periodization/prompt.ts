import type { PrescriptionSignals } from './signals'
import type { SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import { volumeLandmarks } from './volume-targets'
import { SECONDS_PER_REP, SET_SETUP_SEC, fitBudgetMin, fitBudgetWholeMin } from '@trainingai/shared/workout/duration-model'
import { PCT_BANDS } from '@trainingai/shared/workout/time-profile'
import { displayOneRm, displayOneRmDelta } from '@trainingai/shared/1rm'
import { FEVER_TEMP_Z } from '@trainingai/shared/health/illness-radar'
import {
  PROMPT_REST_DAY_READINESS_BELOW, REST_DAY_SLEEP_TREND_BELOW, REST_DAY_HRV_TREND_BELOW, REST_DAY_SPO2_TREND_BELOW, cutFor,
} from '@trainingai/shared/health/readiness-decision-thresholds'
import { formatTrendRatio } from '@trainingai/shared/health/trend-ratio-shown'
import { READINESS_MODEL_VERSION } from '@trainingai/shared/health/readiness-composite'
import { goalRange } from './goal-ranges'
import { EFFORT_VS_PLAN_LABELS } from '@trainingai/shared/workout/effort-vs-plan'
import { userTextBlock, USER_TEXT_NOTE } from '../ai/untrusted-text'
// The units, superlative and no-diagnosis rules: `reasoning` is shown to the lifter (#3803).
import { PROSE_FIELD_GUARDS } from '@/lib/ai/prompt-guards'

export interface IntensityZone {
  pctMin: number; pctMax: number
  repMin: number; repMax: number
  setsMin: number; setsMax: number
}

type Phase = 'accumulation' | 'intensification' | 'realisation' | 'deload'

const INTENSITY_ZONES: Record<string, Record<Phase, IntensityZone>> = {
  strength: {
    accumulation:     { pctMin: 70,   pctMax: 77.5, repMin: 5, repMax: 8,  setsMin: 4, setsMax: 5 },
    intensification:  { pctMin: 80,   pctMax: 87.5, repMin: 3, repMax: 5,  setsMin: 4, setsMax: 5 },
    realisation:      { pctMin: 87.5, pctMax: 92.5, repMin: 1, repMax: 3,  setsMin: 3, setsMax: 5 },
    deload:           { pctMin: 50,   pctMax: 55,   repMin: 6, repMax: 8,  setsMin: 2, setsMax: 3 },
  },
  hypertrophy: {
    accumulation:     { pctMin: 65,   pctMax: 72.5, repMin: 8,  repMax: 12, setsMin: 3, setsMax: 4 },
    intensification:  { pctMin: 72.5, pctMax: 80,   repMin: 6,  repMax: 8,  setsMin: 4, setsMax: 5 },
    realisation:      { pctMin: 80,   pctMax: 85,   repMin: 5,  repMax: 6,  setsMin: 3, setsMax: 4 },
    deload:           { pctMin: 50,   pctMax: 55,   repMin: 10, repMax: 12, setsMin: 2, setsMax: 3 },
  },
  power: {
    accumulation:     { pctMin: 72.5, pctMax: 80,   repMin: 3, repMax: 5, setsMin: 4, setsMax: 5 },
    intensification:  { pctMin: 80,   pctMax: 87.5, repMin: 2, repMax: 4, setsMin: 5, setsMax: 6 },
    realisation:      { pctMin: 87.5, pctMax: 95,   repMin: 1, repMax: 2, setsMin: 4, setsMax: 6 },
    deload:           { pctMin: 55,   pctMax: 60,   repMin: 4, repMax: 5, setsMin: 2, setsMax: 3 },
  },
  endurance: {
    accumulation:     { pctMin: 50,   pctMax: 62.5, repMin: 15, repMax: 20, setsMin: 3, setsMax: 4 },
    intensification:  { pctMin: 62.5, pctMax: 70,   repMin: 12, repMax: 15, setsMin: 3, setsMax: 4 },
    realisation:      { pctMin: 70,   pctMax: 75,   repMin: 8,  repMax: 10, setsMin: 3, setsMax: 4 },
    deload:           { pctMin: 40,   pctMax: 50,   repMin: 15, repMax: 20, setsMin: 2, setsMax: 2 },
  },
  // Powerbuilding — strength-leaning blend: build muscle in accumulation, peak strength later.
  powerbuilding: {
    accumulation:     { pctMin: 72.5, pctMax: 80,   repMin: 6, repMax: 8,  setsMin: 4, setsMax: 5 },
    intensification:  { pctMin: 80,   pctMax: 87.5, repMin: 4, repMax: 6,  setsMin: 4, setsMax: 5 },
    realisation:      { pctMin: 85,   pctMax: 92.5, repMin: 2, repMax: 4,  setsMin: 3, setsMax: 4 },
    deload:           { pctMin: 50,   pctMax: 55,   repMin: 8, repMax: 10, setsMin: 2, setsMax: 3 },
  },
  // Strength + hypertrophy — hypertrophy-leaning blend: more volume, still progressing load.
  'strength+hypertrophy': {
    accumulation:     { pctMin: 67.5, pctMax: 75,   repMin: 8,  repMax: 10, setsMin: 4, setsMax: 5 },
    intensification:  { pctMin: 75,   pctMax: 82.5, repMin: 6,  repMax: 8,  setsMin: 4, setsMax: 5 },
    realisation:      { pctMin: 80,   pctMax: 87.5, repMin: 4,  repMax: 6,  setsMin: 3, setsMax: 4 },
    deload:           { pctMin: 50,   pctMax: 55,   repMin: 10, repMax: 12, setsMin: 2, setsMax: 3 },
  },
}

// Machine-readable intensity zone for a goal/phase pair — the single source of truth for
// both the prompt text and the deterministic combined-deviation clamp (autoregulation.ts).
export function intensityZone(trainingGoal: string, phase: string): IntensityZone {
  const goalZones = INTENSITY_ZONES[trainingGoal] ?? INTENSITY_ZONES.strength
  return goalZones[phase as Phase] ?? goalZones.accumulation
}

/**
 * The most sets any exercise may carry in `phase` (#3713) — the zone's `setsMax`, which is the
 * same for every role (`intensityZoneForRole` passes it through unchanged).
 *
 * - No phase (null, undefined, empty): returns null, and the caller applies the role ceiling alone.
 * - A phase string the goal's zone table does not name (e.g. `baseline`): returns that goal's
 *   ACCUMULATION `setsMax`, because `intensityZone` falls back to accumulation for any unknown
 *   phase. Never null for a non-empty string. An unknown goal reads strength's table, as
 *   `intensityZone` does.
 */
export function phaseSetsMax(trainingGoal: string, phase: string | null | undefined): number | null {
  if (!phase) return null
  return intensityZone(trainingGoal, phase).setsMax
}

// Goals where a SECONDARY compound is prescribed a moderate step below the primary anchor
// (lighter load, a couple more reps) instead of at the same near-max band. Powerbuilding's
// "building" half should be hypertrophy-leaning volume — one heavy anchor per session, not
// three near-max compounds. Strength/power deliberately keep heavy secondaries.
const MODERATE_SECONDARY_GOALS = new Set(['powerbuilding'])

// Shift a primary phase zone down into the moderate band a secondary compound trains in —
// ~7.5% lighter with ~2 more reps. It still tracks the phase: accumulation → realisation get
// heavier, deload lighter, always relative to (and below) the primary anchor.
/**
 * #3900 review (B): the rest a compound row may carry in a phase on the AI plan, where every plan is
 * stored applied. The schema allows 30-600 s, so an extreme answer would otherwise reach the bar with
 * no tap in between. Wide on purpose: it stops an absurd answer and leaves every ordinary one alone
 * (heavier phases rest longer, as the prompt tells the model). Not rendered into the prompt, which
 * stays byte-identical for every program kind; the zone table above is the load, rep and set half.
 */
const PHASE_REST_SEC: Record<Phase, { restSecMin: number; restSecMax: number }> = {
  accumulation:    { restSecMin: 60,  restSecMax: 240 },
  intensification: { restSecMin: 90,  restSecMax: 300 },
  realisation:     { restSecMin: 120, restSecMax: 360 },
  deload:          { restSecMin: 60,  restSecMax: 180 },
}

export function phaseRestBounds(phase: string): { restSecMin: number; restSecMax: number } {
  return PHASE_REST_SEC[phase as Phase] ?? PHASE_REST_SEC.accumulation
}

export function secondaryIntensityZone(zone: IntensityZone): IntensityZone {
  return {
    pctMin: Math.max(45, zone.pctMin - 7.5),
    pctMax: Math.max(50, zone.pctMax - 7.5),
    repMin: zone.repMin + 2,
    repMax: zone.repMax + 2,
    setsMin: zone.setsMin,
    setsMax: zone.setsMax,
  }
}

// The intensity zone a specific exercise should be clamped into, given its role. For goals in
// MODERATE_SECONDARY_GOALS a 'secondary' exercise gets the shifted-lighter zone; everything
// else gets the primary phase zone.
export function intensityZoneForRole(trainingGoal: string, phase: string, role: string): IntensityZone {
  const base = intensityZone(trainingGoal, phase)
  if (role === 'accessory') {
    // Accessories get their own goal-aware, RPE-derived band (not the primary zone) so this clamp
    // agrees with the RPE-target load the prescribe route derives — otherwise it would re-floor the
    // accessory into the heavier primary zone and fight that override.
    const acc = goalRange(trainingGoal, 'accessory')
    return { pctMin: acc.pctMin, pctMax: acc.pctMax, repMin: acc.repMin, repMax: acc.repMax, setsMin: base.setsMin, setsMax: base.setsMax }
  }
  if (role === 'secondary' && MODERATE_SECONDARY_GOALS.has(trainingGoal)) return secondaryIntensityZone(base)
  return base
}

function renderZones(trainingGoal: string): string {
  const goalZones = INTENSITY_ZONES[trainingGoal] ?? INTENSITY_ZONES.strength
  return (['accumulation', 'intensification', 'realisation', 'deload'] as const)
    .map(phase => {
      const z = goalZones[phase]
      return `\n    ${phase}: ${z.pctMin}-${z.pctMax}%, ${z.repMin}-${z.repMax} reps, ${z.setsMin}-${z.setsMax} sets`
    })
    .join('')
}

export function buildSystemPrompt(trainingGoal: string): string {
  const zones = renderZones(trainingGoal)
  const secondaryNote = MODERATE_SECONDARY_GOALS.has(trainingGoal)
    ? `\n\nRole loading: keep ONE heavy anchor (the primary compound) per session at the phase zone. Prescribe SECONDARY compounds a moderate step lighter — about 7.5% below the zone with ~2 more reps (a hypertrophy load) — and accessories lighter still. A deterministic guard enforces this, so aim there yourself.`
    : ''
  return `You are an AI workout prescription engine. Given training signals, output the optimal prescription for the next session.

Training goal: ${trainingGoal}

Intensity zones for ${trainingGoal}:${zones}${secondaryNote}

Pick a neutral pct inside the phase zone for each exercise. do NOT pre-emptively lower pct for fatigue, RPE, soreness or recovery signals — a deterministic autoregulation layer applies those cuts after you, and lowering it yourself double-applies the reduction.

The phase belongs to the whole program, not to this session: every session type trains in it,
and time in it is counted in training weeks (a Monday-to-Sunday week with at least one completed
session of the program). Your phase_action is this session type's vote; the program moves when at
least half of the session types trained this week agree.

Phase transition rules. These are ELIGIBILITY FLOORS, not triggers — meeting the minimum
does not by itself mean the block is finished. Default to "stay" and only
recommend a transition when the current phase's work is genuinely complete (the strength
signal has stopped improving within the phase, or the phase is at its documented cap):
- accumulation→intensification: eligible from 4+ training weeks in phase, RPE delta ≤+0.3, 1RM trending up
- intensification→realisation: eligible from 3+ training weeks, RPE delta ≤+0.5, 1RM flat or up
- realisation→deload: always after 2 training weeks
- deload→accumulation: after 1 training week with low soreness

When phase_action is "transition_recommended", the "phase" field MUST be the phase you are
moving TO, and it must differ from current_phase. A transition to the phase already in
progress is invalid — use "stay" instead.

Strength trend: use rm1_trend and rm1_change_kg only (the latest 1RM estimate vs the one before it; current_1rm is the all-time best and is not the figure compared).
Do NOT compare current_1rm against baseline_1rm as a strength metric — baseline is only
the starting weight anchor from the AMRAP week and will be exceeded quickly.

Time constraint: total session duration must fit within effective_time_budget_min.
Duration formula: for each exercise, time = sets × (${SET_SETUP_SEC} + reps × sec_per_rep) + (sets − 1) × rest + transition_sec. No rest follows the last set: the walk to the next exercise is its transition_sec.
sec_per_rep is the exercise's measured_sec_per_rep when given in the exercise list, else ${SECONDS_PER_REP}.
rest is the exercise's measured rest for the band your prescribed pct falls in (light <70%, moderate 70-80%, heavy 80-90%, max ≥90%) when measured_rest_by_band lists that band, else your prescribed rest_sec. Measured values are this user's real logged times — trust them over the defaults.
transition_sec is given per exercise in the exercise list (equipment-dependent: barbell setups cost more than machines).
Total = sum across all exercises, less the FIRST exercise's transition_sec (its setup happens during the warm-up), converted to minutes.
If over budget: cut sets on accessory exercises first. Never cut compound exercises entirely.
Heavier phases use longer rest, so fewer sets fit the same budget — prefer fewer, harder
sets over many sets that overrun the time. (A deterministic guard also trims to fit, but
aim to be within budget yourself.)

phase_action rules:
- "stay": normal progression, no recovery concerns — this is the default
- "transition_recommended": the current phase's work is complete and its eligibility floor
  above is met; "phase" must be the NEXT phase, never current_phase
- "deload_recommended": accumulated fatigue; prescribe reduced load/volume for this session
- "session_swap_recommended": sore_muscles_in_session is non-empty and hours_since_last_session < 36,
  OR active_injuries_in_session is non-empty; the user should consider training a different
  session today that avoids those muscles. Still provide a full exercise prescription
  (used if they choose to train anyway), but reduce load/volume on any exercise whose
  muscles overlap an active injury — never prescribe an increase there.
  EXCEPTION: if the input states per-exercise deloads were already applied for this
  soreness, it is handled — do not use this action (or rest_day_recommended) for that
  soreness alone.
- "rest_day_recommended": multiple systemic stress indicators simultaneously poor
  (sleep_score_trend < ${REST_DAY_SLEEP_TREND_BELOW} AND hrv_trend < ${REST_DAY_HRV_TREND_BELOW} — use sleep_trend in place of
  sleep_score_trend when the quality trend is not given; OR external_readiness < ${PROMPT_REST_DAY_READINESS_BELOW},
  OR spo2_trend < ${REST_DAY_SPO2_TREND_BELOW}, OR temp_z >= ${FEVER_TEMP_Z} [skin temperature fever-consistent
  vs personal baseline]),
  OR the illness radar is elevated or fever (temperature/RHR/HRV moving together against the
  user's own baseline — training hard while fighting something makes both worse);
  recommend skipping training entirely today.
  An illness radar of "watch" is context only — never recommend a rest day from watch alone.
  If no sleep/HRV/SpO2/illness/temperature data, do NOT output rest_day_recommended from those signals alone.

Null values in recovery signals mean "no data recorded" — omit those signals from your
reasoning entirely. Do not infer or guess from absent data.

Output field notes:
- session_exercise_id: copy exactly from the exercise list — never invent one.
- reasoning: 1-2 sentences. Never state a time budget or any duration in minutes: the app adds
  the sentence about time itself, and removes any minutes figure you write.

${PROSE_FIELD_GUARDS}`
}


/**
 * #3824. The system prompt's rest-day rule names the cut for the current readiness scale. A score
 * stored before #3778 (today's row on release day, until it is recomputed) is on the old scale, so
 * its line says which cut applies to it. On the current scale the line is unchanged.
 */
function externalReadinessScaleNote(modelVersion: string | null | undefined): string {
  const cut = cutFor('promptRestDay', modelVersion === undefined ? READINESS_MODEL_VERSION : modelVersion)
  return cut === PROMPT_REST_DAY_READINESS_BELOW
    ? ''
    : `; scored on the earlier scale, so its rest-day cut is ${cut}, not ${PROMPT_REST_DAY_READINESS_BELOW}`
}
/** #3766: the program's phase and its training weeks, beside this type's own sessions in it. */
function phaseLine(signals: PrescriptionSignals): string {
  const own = `${signals.sessionsInPhase} session${signals.sessionsInPhase === 1 ? '' : 's'} of this type in it`
  const p = signals.programPhase
  if (!p) return `${signals.phase} (${own})`
  const cap = p.capWeeks != null ? `, cap ${p.capWeeks}` : ''
  return `${signals.phase} for the whole program (training week ${p.trainingWeeksDone + 1}; ${p.trainingWeeksDone} training weeks done${cap}; ${own})`
}

/** A user-named exercise as one prompt line's worth of text (#4061, #4124).
 *  Blank or not is decided on a COPY with every invisible character removed: format characters
 *  (`\p{Cf}`: zero-width, direction marks, invisible math operators, tag characters), the fillers that
 *  render as nothing (U+2800 braille blank, U+034F, U+061C, U+115F, U+1160, U+3164, U+FFA0), variation
 *  selectors, and whitespace. Nothing visible left: the name reads `UNNAMED_PROMPT_LINE_NAME`.
 *  Otherwise the ORIGINAL name is printed with only what is unsafe on one prompt line changed: line
 *  breaks, tabs and runs of whitespace become one space; zero-width space U+200B, U+FEFF and the
 *  direction overrides (U+202A-U+202E, U+2066-U+2069) are removed. Joiners (U+200C, U+200D) and variation
 *  selectors inside visible text stay, so Persian names and emoji sequences are not altered. (A stray
 *  U+200B inside a name is removed: "Bench<U+200B>Press" prints "BenchPress".) A name longer than
 *  `PROMPT_LINE_NAME_MAX_CHARS` code points is cut there with an ellipsis; the exercise API accepts
 *  120 and the longest name in the `exercise_library` seed is 34, so no real name is touched.
 *  The text is only ever printed: a plan row's name comes from the session's own exercise. */
export const UNNAMED_PROMPT_LINE_NAME = 'Unnamed exercise'
export const PROMPT_LINE_NAME_MAX_CHARS = 120
const INVISIBLE_FOR_BLANK_TEST = /[\p{Cf}\p{Cc}\s\u2800\u034F\u061C\u115F\u1160\u3164\uFFA0\u180E\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu
const UNSAFE_ON_A_LINE_REMOVED = /[\u200B\uFEFF\u202A-\u202E\u2066-\u2069]/g
const LINE_WHITESPACE = /[\s\u0085]+/g
export function promptLineName(name: string): string {
  if (name.replace(INVISIBLE_FOR_BLANK_TEST, '') === '') return UNNAMED_PROMPT_LINE_NAME
  const line = name.replace(UNSAFE_ON_A_LINE_REMOVED, '').replace(LINE_WHITESPACE, ' ').trim()
  const chars = Array.from(line)
  return chars.length > PROMPT_LINE_NAME_MAX_CHARS
    ? `${chars.slice(0, PROMPT_LINE_NAME_MAX_CHARS - 1).join('').trimEnd()}\u2026`
    : line
}

export function buildUserPrompt(
  signals: PrescriptionSignals,
  state: SessionPeriodization,
  today: string,
  perExerciseDeloadedNames?: string[],
): string {
  // Q-19b: the change is reps for a bodyweight movement, kilograms otherwise. `rm1ChangeKg`
  // is a kg-domain delta by name, so it cannot be printed with a unit without this.
  const rm1Change = (ex: PrescriptionSignals['exercises'][number]): string => {
    // The change is latest − previous estimate (#3891), so the delta is built from `latest1rm`,
    // not from `current1rm` (the all-time best).
    const latest = ex.latest1rm ?? ex.current1rm
    if (latest == null) return `${ex.rm1ChangeKg > 0 ? '+' : ''}${ex.rm1ChangeKg.toFixed(1)} kg`
    const previous = latest - ex.rm1ChangeKg
    return displayOneRmDelta(latest, previous, ex.exerciseType)?.text
      ?? `${ex.rm1ChangeKg > 0 ? '+' : ''}${ex.rm1ChangeKg.toFixed(1)} kg`
  }

  const preferencesApply = state.phase !== 'deload' && state.phase !== 'baseline'
  const exerciseLines = signals.exercises.map(ex => {
    const musclesStr = ex.muscleAssignments.length > 0
      ? ex.muscleAssignments.map(ma => `${ma.muscle} (${ma.role})`).join(', ')
      : ex.muscleGroups.join(', ')
    const tp = ex.timeProfile
    const restBands = tp
      ? PCT_BANDS.filter(b => tp.restSecByBand[b] != null)
          .map(b => `${b} ${Math.round(tp.restSecByBand[b]!)}s`).join(', ')
      : ''
    const measuredStr =
      (tp?.secPerRep != null ? `, measured_sec_per_rep: ${tp.secPerRep.toFixed(1)}` : '') +
      (restBands ? `, measured_rest_by_band: [${restBands}]` : '')
    // Q-19b: a bodyweight 1RM is an internal kg-domain number, meaningless as a weight —
    // render it through the shared helper so the model is given "6 RM", not "118 kg".
    const oneRm = (v: number | null | undefined) =>
      v == null ? 'unknown' : displayOneRm(v, ex.exerciseType).text
    // #3896: the lifter's own rep range for this lift, so the plan and its reasoning agree with the
    // clamp code applies after the answer. Code enforces it; this line only keeps the text coherent.
    // Not said in a deload or baseline, where a preference does not apply. Absent: the line is as before.
    const range = preferencesApply ? ex.liftPreference?.preference.repRange : null
    const rangeStr = range ? `, rep_range: ${range.min}-${range.max} (the lifter's choice for this lift; keep reps inside it)` : ''
    // #3890: the week's check-in hold ("Heavy"), so the plan's text does not argue with the ceiling code
    // applies after the answer. Code enforces it. Absent for every lift without a hold.
    const holdBar = preferencesApply && ex.exerciseType !== 'bodyweight' ? ex.liftPreference?.preference.checkinHold?.barKg : null
    const holdStr = holdBar != null && holdBar > 0
      ? `, held_this_week: no heavier than ${holdBar} kg (the lifter called last week heavy; do not add load)`
      : ''
    return `  - ${promptLineName(ex.name)} (id: ${ex.sessionExerciseId}, role: ${ex.role}, muscles: ${musclesStr}, ` +
      `baseline_1rm: ${oneRm(ex.baseline1rm)} [anchor only — do not use for trend], ` +
      `current_1rm: ${oneRm(ex.current1rm)}, ` +
      `rm1_trend: ${ex.rm1Trend} ${rm1Change(ex)}, ` +
      `avg_set_duration: ${ex.avgSetDurationSec}s, transition_sec: ${ex.transitionSec}${measuredStr}${rangeStr}${holdStr})` +
      (ex.plateau ? ' [1RM flat ≥3 weeks — consider a stimulus change]' : '')
  }).join('\n')

  const rpeInfo = signals.rpeTrend
    ? `avg actual: ${signals.rpeTrend.avgActual.toFixed(1)}, avg expected: ${signals.rpeTrend.avgExpected.toFixed(1)}, delta: ${signals.rpeTrend.delta > 0 ? '+' : ''}${signals.rpeTrend.delta.toFixed(1)}`
    : 'no data'
  // #4061: the lifter's tapped "How did it feel?" on a lift's latest log, which code reads in place of
  // that lift's rated RPE and enforces after the answer, as it does RPE's. Told here so the plan's text
  // does not argue with it. Written from the stored value only; no line when no lift has one.
  const effortAnswers = signals.exercises
    .filter(ex => ex.effortAnswer === 1 || ex.effortAnswer === -1)
    .map(ex => `${promptLineName(ex.name)}: ${EFFORT_VS_PLAN_LABELS[ex.effortAnswer!].toLowerCase()}`)
  const effortInfo = effortAnswers.length > 0
    ? `\nEffort answer (the lifter's tap after the lift's last set, latest session; read in place of RPE for that lift): ${effortAnswers.join('; ')}`
    : ''

  const hasVolumeTargets = Object.keys(signals.weeklyTargets).length > 0
  const volumeLines = hasVolumeTargets
    ? `  (weighted: main muscle = 1.0 set, secondary muscle = 0.5 set per set performed)\n` +
      Object.keys({ ...signals.weeklyTargets, ...signals.weeklyLogged })
        .map(mg => {
          const lm = volumeLandmarks(signals.trainingGoal, mg)
          return `  ${mg}: logged ${(signals.weeklyLogged[mg] ?? 0).toFixed(1)} / target ${signals.weeklyTargets[mg] ?? 0} sets/week, budget ${signals.volumeBudgetPerMuscleGroup[mg] ?? 0} sets this session (MEV ${lm.mev} · MRV ${lm.mrv})`
        })
        .join('\n')
    : '  no volume targets configured (unconstrained)'

  const soreSuffix = signals.sorenessLogDate === 'yesterday' ? ' [from yesterday — may have resolved]' : ''
  const recoveryLines: string[] = [
    `  Hours since last session of this type: ${signals.hoursSinceLastSession != null ? signals.hoursSinceLastSession.toFixed(1) : 'no data'}`,
    `  Consecutive days trained (this session type): ${signals.consecutiveSessionDaysOfThisType}`,
    `  Sore muscles in today's session: ${signals.soreMusclesInSession.length > 0 ? signals.soreMusclesInSession.join(', ') + soreSuffix : 'none'}`,
    `  Sore muscles not in today's session (ignore): ${signals.soreMusclesOutOfSession.length > 0 ? signals.soreMusclesOutOfSession.join(', ') + soreSuffix : 'none'}`,
    // LA-69: an injury's `muscleName` is free text (`z.string().min(1).max(100)`), unlike the sore
    // muscles above, which come from a picker. The note line is added below only when something was
    // actually fenced, so a session with no injuries — the common case — sends the prompt unchanged.
    `  Active injuries in today's session: ${signals.activeInjuredMusclesInSession.length > 0 ? userTextBlock(signals.activeInjuredMusclesInSession) : 'none'}`,
    signals.activeInjuredMusclesInSession.length > 0 ? `  ${USER_TEXT_NOTE}` : '',
    signals.sleepTrend != null
      ? `  Sleep trend (recent/baseline ratio): ${formatTrendRatio(signals.sleepTrend)}`
      : `  Sleep trend: no data`,
    signals.sleepScoreTrend != null
      ? `  Sleep quality trend (recent/baseline ratio, our 0-100 sleep score): ${formatTrendRatio(signals.sleepScoreTrend)}`
      : `  Sleep quality trend: no data`,
    signals.hrvTrend != null
      ? `  HRV trend (recent/baseline ratio): ${formatTrendRatio(signals.hrvTrend)}`
      : `  HRV trend: no data`,
    signals.spo2Trend != null
      ? `  SpO2 trend (recent/baseline ratio): ${formatTrendRatio(signals.spo2Trend)}`
      : `  SpO2 trend: no data`,
    signals.tempZ != null
      ? `  Skin temp deviation (temp_z, z-score vs personal baseline; >=${FEVER_TEMP_Z} fever-consistent): ${signals.tempZ > 0 ? '+' : ''}${signals.tempZ.toFixed(1)}`
      : `  Skin temp deviation (temp_z): no data`,
    signals.illness != null
      ? `  Illness radar (vs personal baseline): ${signals.illness.flag} (score ${signals.illness.score}/100)`
      : `  Illness radar: no data`,
    signals.externalReadiness != null
      ? `  External readiness score: ${signals.externalReadiness}/100 (one signal among many${externalReadinessScaleNote(signals.externalReadinessModelVersion)})`
      : `  External readiness: no data`,
    signals.trainingLoadOts != null
      ? `  Training stress (own OTS model): ${signals.trainingLoadOts.toFixed(1)}${signals.trainingLoadHigh ? ' — HIGH today' : ''}`
      : `  Training stress (OTS): no data`,
    signals.resilienceLevel != null
      ? `  Stress resilience level: ${signals.resilienceLevel}/5 (higher = more resilient lately)`
      : signals.resilienceOura
        ? `  Stress resilience (Oura's own level, not a 1-5 score): ${signals.resilienceOura}`
        : `  Stress resilience: no data`,
    signals.morningCheckin
      ? `  Morning check-in (1=best, 5=worst): recovery ${signals.morningCheckin.perceivedRecovery ?? '—'}, ` +
        `sleep feel ${signals.morningCheckin.sleepQualityFeel ?? '—'}, soreness ${signals.morningCheckin.restingSoreness ?? '—'}` +
        (signals.morningCheckin.illnessContext ? `, context flagged: ${signals.morningCheckin.illnessContext}` : '')
      : `  Morning check-in: not logged today`,
  ]

  if (perExerciseDeloadedNames && perExerciseDeloadedNames.length > 0) {
    recoveryLines.push(
      `  Per-exercise deloads already applied to: ${perExerciseDeloadedNames.map(promptLineName).join(', ')} — ` +
      `this soreness is handled; prescribe the session normally and do NOT recommend a rest day or session swap for this soreness alone.`,
    )
  }

  const acwrLine = signals.acwr != null
    ? `  ACWR: ${signals.acwr.toFixed(2)}`
    : `  ACWR: no data (needs ≥3 weeks of session history)`

  return `Current date: ${today}
Program goal: ${signals.trainingGoal}
Time budget: ${fitBudgetMin(signals) === 0 ? 'No time limit. Choose appropriate training volume; do not trim or add work to fit a duration.' : `${fitBudgetWholeMin(signals)} min`}

Phase: ${phaseLine(signals)}

Session exercises:
${exerciseLines}

RPE trend (last 3 sessions): ${rpeInfo}${effortInfo}
${signals.repCompletionRate != null ? `Rep completion rate (last session): ${(signals.repCompletionRate * 100).toFixed(0)}%` : 'Rep completion rate: no data'}

Recovery:
${recoveryLines.join('\n')}
${acwrLine}

Weekly volume (Mon–Sun):
${volumeLines || '  no data'}

Confidence tier: ${signals.confidenceTier} (confidence: ${signals.confidence.toFixed(2)})

Provide the prescription.`
}
