import type { PrescriptionSignals } from './signals'
import type { SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import { volumeLandmarks } from './volume-targets'
import { SECONDS_PER_REP, SET_SETUP_SEC } from '@trainingai/shared/workout/duration-model'
import { PCT_BANDS } from '@trainingai/shared/workout/time-profile'
import { displayOneRm, displayOneRmDelta } from '@trainingai/shared/1rm'
import { FEVER_TEMP_Z } from '@trainingai/shared/health/illness-radar'
import { goalRange } from './goal-ranges'

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

// Goals where a SECONDARY compound is prescribed a moderate step below the primary anchor
// (lighter load, a couple more reps) instead of at the same near-max band. Powerbuilding's
// "building" half should be hypertrophy-leaning volume — one heavy anchor per session, not
// three near-max compounds. Strength/power deliberately keep heavy secondaries.
const MODERATE_SECONDARY_GOALS = new Set(['powerbuilding'])

// Shift a primary phase zone down into the moderate band a secondary compound trains in —
// ~7.5% lighter with ~2 more reps. It still tracks the phase: accumulation → realisation get
// heavier, deload lighter, always relative to (and below) the primary anchor.
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

Phase transition rules. These are ELIGIBILITY FLOORS, not triggers — meeting the minimum
session count does not by itself mean the block is finished. Default to "stay" and only
recommend a transition when the current phase's work is genuinely complete (the strength
signal has stopped improving within the phase, or the phase is at its documented cap):
- accumulation→intensification: eligible from 4+ sessions in phase, RPE delta ≤+0.3, 1RM trending up
- intensification→realisation: eligible from 3+ sessions, RPE delta ≤+0.5, 1RM flat or up
- realisation→deload: always after 2 sessions
- deload→accumulation: after 2 sessions with low soreness

When phase_action is "transition_recommended", the "phase" field MUST be the phase you are
moving TO, and it must differ from current_phase. A transition to the phase already in
progress is invalid — use "stay" instead.

Strength trend: use rm1_trend and rm1_change_kg only (current PR vs previous PR).
Do NOT compare current_1rm against baseline_1rm as a strength metric — baseline is only
the starting weight anchor from the AMRAP week and will be exceeded quickly.

Time constraint: total session duration must fit within effective_time_budget_min.
Duration formula: for each exercise, time = sets × (${SET_SETUP_SEC} + reps × sec_per_rep) + sets × rest + transition_sec.
sec_per_rep is the exercise's measured_sec_per_rep when given in the exercise list, else ${SECONDS_PER_REP}.
rest is the exercise's measured rest for the band your prescribed pct falls in (light <70%, moderate 70-80%, heavy 80-90%, max ≥90%) when measured_rest_by_band lists that band, else your prescribed rest_sec. Measured values are this user's real logged times — trust them over the defaults.
transition_sec is given per exercise in the exercise list (equipment-dependent: barbell setups cost more than machines).
Total = sum across all exercises, converted to minutes.
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
  (sleep_score_trend < 0.75 AND hrv_trend < 0.75 — use sleep_trend in place of
  sleep_score_trend when the quality trend is not given; OR external_readiness < 40,
  OR spo2_trend < 0.97, OR temp_z >= ${FEVER_TEMP_Z} [skin temperature fever-consistent
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
- reasoning: 1-2 sentences.
- confidence: your certainty in this prescription, 0.0-1.0.`
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
    if (ex.current1rm == null) return `${ex.rm1ChangeKg > 0 ? '+' : ''}${ex.rm1ChangeKg.toFixed(1)} kg`
    const previous = ex.current1rm - ex.rm1ChangeKg
    return displayOneRmDelta(ex.current1rm, previous, ex.exerciseType)?.text
      ?? `${ex.rm1ChangeKg > 0 ? '+' : ''}${ex.rm1ChangeKg.toFixed(1)} kg`
  }

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
    return `  - ${ex.name} (id: ${ex.sessionExerciseId}, role: ${ex.role}, muscles: ${musclesStr}, ` +
      `baseline_1rm: ${oneRm(ex.baseline1rm)} [anchor only — do not use for trend], ` +
      `current_1rm: ${oneRm(ex.current1rm)}, ` +
      `rm1_trend: ${ex.rm1Trend} ${rm1Change(ex)}, ` +
      `avg_set_duration: ${ex.avgSetDurationSec}s, transition_sec: ${ex.transitionSec}${measuredStr})` +
      (ex.plateau ? ' [1RM flat ≥3 weeks — consider a stimulus change]' : '')
  }).join('\n')

  const rpeInfo = signals.rpeTrend
    ? `avg actual: ${signals.rpeTrend.avgActual.toFixed(1)}, avg expected: ${signals.rpeTrend.avgExpected.toFixed(1)}, delta: ${signals.rpeTrend.delta > 0 ? '+' : ''}${signals.rpeTrend.delta.toFixed(1)}`
    : 'no data'

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
    `  Active injuries in today's session: ${signals.activeInjuredMusclesInSession.length > 0 ? signals.activeInjuredMusclesInSession.join(', ') : 'none'}`,
    signals.sleepTrend != null
      ? `  Sleep trend (recent/baseline ratio): ${signals.sleepTrend.toFixed(2)}`
      : `  Sleep trend: no data`,
    signals.sleepScoreTrend != null
      ? `  Sleep quality trend (recent/baseline ratio, our 0-100 sleep score): ${signals.sleepScoreTrend.toFixed(2)}`
      : `  Sleep quality trend: no data`,
    signals.hrvTrend != null
      ? `  HRV trend (recent/baseline ratio): ${signals.hrvTrend.toFixed(2)}`
      : `  HRV trend: no data`,
    signals.spo2Trend != null
      ? `  SpO2 trend (recent/baseline ratio): ${signals.spo2Trend.toFixed(2)}`
      : `  SpO2 trend: no data`,
    signals.tempZ != null
      ? `  Skin temp deviation (temp_z, z-score vs personal baseline; >=${FEVER_TEMP_Z} fever-consistent): ${signals.tempZ > 0 ? '+' : ''}${signals.tempZ.toFixed(1)}`
      : `  Skin temp deviation (temp_z): no data`,
    signals.illness != null
      ? `  Illness radar (vs personal baseline): ${signals.illness.flag} (score ${signals.illness.score}/100)`
      : `  Illness radar: no data`,
    signals.externalReadiness != null
      ? `  External readiness score: ${signals.externalReadiness}/100 (one signal among many)`
      : `  External readiness: no data`,
    signals.trainingLoadOts != null
      ? `  Training stress (own OTS model): ${signals.trainingLoadOts.toFixed(1)}${signals.trainingLoadHigh ? ' — HIGH today' : ''}`
      : `  Training stress (OTS): no data`,
    signals.resilienceLevel != null
      ? `  Stress resilience level: ${signals.resilienceLevel}/5 (higher = more resilient lately)`
      : `  Stress resilience: no data`,
    signals.morningCheckin
      ? `  Morning check-in (1=best, 5=worst): recovery ${signals.morningCheckin.perceivedRecovery ?? '—'}, ` +
        `sleep feel ${signals.morningCheckin.sleepQualityFeel ?? '—'}, soreness ${signals.morningCheckin.restingSoreness ?? '—'}` +
        (signals.morningCheckin.illnessContext ? `, context flagged: ${signals.morningCheckin.illnessContext}` : '')
      : `  Morning check-in: not logged today`,
  ]

  if (perExerciseDeloadedNames && perExerciseDeloadedNames.length > 0) {
    recoveryLines.push(
      `  Per-exercise deloads already applied to: ${perExerciseDeloadedNames.join(', ')} — ` +
      `this soreness is handled; prescribe the session normally and do NOT recommend a rest day or session swap for this soreness alone.`,
    )
  }

  const acwrLine = signals.acwr != null
    ? `  ACWR: ${signals.acwr.toFixed(2)}`
    : `  ACWR: no data (needs ≥3 weeks of session history)`

  return `Current date: ${today}
Program goal: ${signals.trainingGoal}
Time budget: ${signals.effectiveTimeBudgetMin} min

Phase: ${signals.phase} (${signals.sessionsInPhase} sessions in this phase)

Session exercises:
${exerciseLines}

RPE trend (last 3 sessions): ${rpeInfo}
${signals.repCompletionRate != null ? `Rep completion rate (last session): ${(signals.repCompletionRate * 100).toFixed(0)}%` : 'Rep completion rate: no data'}

Recovery:
${recoveryLines.join('\n')}
${acwrLine}

Weekly volume (Mon–Sun):
${volumeLines || '  no data'}

Confidence tier: ${signals.confidenceTier} (confidence: ${signals.confidence.toFixed(2)})

Provide the prescription.`
}
