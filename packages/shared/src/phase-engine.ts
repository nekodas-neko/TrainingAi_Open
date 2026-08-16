import { formatInTimeZone } from 'date-fns-tz'
import type { ProgramPhase, ExerciseRole } from '@trainingai/shared/types/program'

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return formatInTimeZone(d, 'UTC', 'yyyy-MM-dd')
}

export interface PhaseResult {
  phase: ProgramPhase
  cycleInPhase: number
  totalPhaseCycles: number
  completedCycles: number
  totalProgramCycles: number
  blockComplete: boolean
  approxWeeksRemaining(avgSessionsPerWeek: number): number
}

export function getCurrentPhase(
  phases: ProgramPhase[],
  sessionsPerCycle: number,
  sessionsLoggedSinceStart: number,
): PhaseResult {
  if (!phases.length) throw new Error('phases must not be empty')
  if (sessionsPerCycle < 1) throw new Error('sessionsPerCycle must be >= 1')

  const completedCycles = Math.floor(sessionsLoggedSinceStart / sessionsPerCycle)
  const totalProgramCycles = phases.reduce((s, p) => s + p.durationCycles, 0)

  if (completedCycles >= totalProgramCycles) {
    const lastPhase = phases[phases.length - 1]
    return {
      phase: lastPhase,
      cycleInPhase: lastPhase.durationCycles,
      totalPhaseCycles: lastPhase.durationCycles,
      completedCycles,
      totalProgramCycles,
      blockComplete: true,
      approxWeeksRemaining: () => 0,
    }
  }

  let accumulated = 0
  for (const phase of phases) {
    if (completedCycles < accumulated + phase.durationCycles) {
      const cycleInPhase = completedCycles - accumulated + 1
      const cyclesRemaining = totalProgramCycles - completedCycles
      return {
        phase,
        cycleInPhase,
        totalPhaseCycles: phase.durationCycles,
        completedCycles,
        totalProgramCycles,
        blockComplete: false,
        approxWeeksRemaining(avgSessionsPerWeek: number) {
          if (avgSessionsPerWeek <= 0) return 0
          const phaseCyclesLeft = phase.durationCycles - cycleInPhase + 1
          return Math.ceil((phaseCyclesLeft * sessionsPerCycle) / avgSessionsPerWeek)
        },
      }
    }
    accumulated += phase.durationCycles
  }

  throw new Error('Phase calculation error: fell through all phases')
}

export interface AutomaticPhaseStatus {
  phase: ProgramPhase
  cycleInPhase: number
  totalPhaseCycles: number
  completedCycles: number
  totalProgramCycles: number
  sessionsPerCycle: number
  sessionsInCurrentCycle: number
  blockComplete: boolean
  approxWeeksRemaining: number | null
  isDeloadActive: boolean
  isBaseline: boolean
}

// Builds the PhaseStatus shape shared by workout-data's per-session-summary loop
// and its per-session-detail branch (previously duplicated inline in both places —
// also reused by the daily digest for "today's trained session type").
export function buildAutomaticPhaseStatus(
  phases: ProgramPhase[],
  sessionsLoggedSinceStart: number,
  program: { earlyDeloadWeekStart?: string },
  todayStr: string,
  sessionPerWeek: number,
): AutomaticPhaseStatus {
  const result = getCurrentPhase(phases, 1, sessionsLoggedSinceStart)
  return {
    phase: result.phase,
    cycleInPhase: result.cycleInPhase,
    totalPhaseCycles: result.totalPhaseCycles,
    completedCycles: result.completedCycles,
    totalProgramCycles: result.totalProgramCycles,
    sessionsPerCycle: 1,
    sessionsInCurrentCycle: 0,
    blockComplete: result.blockComplete,
    approxWeeksRemaining: sessionPerWeek > 0 ? result.approxWeeksRemaining(sessionPerWeek) : null,
    isDeloadActive: isDeloadActive(result.phase, program, todayStr),
    isBaseline: result.phase.phaseType === 'baseline',
  }
}

export function isDeloadActive(
  phase: ProgramPhase,
  program: { earlyDeloadWeekStart?: string },
  today: string,
): boolean {
  if (phase.phaseType === 'deload') return true
  return isEarlyDeloadWeek(program, today)
}

// The confirmed early-deload window on its own, with no phase to consult. ai_dynamic programs have
// no ProgramPhase rows at all, so `isDeloadActive` above cannot answer for them — and until Q-175
// that meant a confirmed deload *week* never reached the AI prescription and the user trained at
// full intensity for seven days believing they had backed off.
export function isEarlyDeloadWeek(
  program: { earlyDeloadWeekStart?: string },
  today: string,
): boolean {
  if (!program.earlyDeloadWeekStart) return false
  const end = addDays(program.earlyDeloadWeekStart, 7)
  return today >= program.earlyDeloadWeekStart && today < end
}

// The phase whose styles should be prescribed. During a confirmed early-deload window
// (`isDeloadActive` true but the natural phase isn't itself a deload phase), swap in the program's
// deload phase so the prescribed load is genuinely reduced — a real deload phase already resolves
// its own lighter style. Falls back to the natural phase when the program has no deload phase
// (no reduction possible). W5 §4.1 — early deload previously only suppressed PRs + showed a banner.
export function deloadAwareStylePhase(
  currentPhase: ProgramPhase | null,
  allPhases: ProgramPhase[],
  isDeloadActive: boolean,
): ProgramPhase | null {
  if (isDeloadActive && currentPhase && currentPhase.phaseType !== 'deload') {
    return allPhases.find(p => p.phaseType === 'deload') ?? currentPhase
  }
  return currentPhase
}

export function resolveStyleForExercise(
  phase: ProgramPhase,
  phases: ProgramPhase[],
  exercise: { exerciseRole: ExerciseRole; styleId?: string },
): string | 'own' | null {
  // Accessory exercises use the Accessory phase's primary style, always
  if (exercise.exerciseRole === 'accessory') {
    const accessoryPhase = phases.find(p => p.phaseType === 'accessory')
    return accessoryPhase?.primaryStyleId ?? 'own'
  }
  if (exercise.exerciseRole === 'primary') return phase.primaryStyleId ?? null
  // 'secondary'
  if (phase.phaseType === 'peak') {
    const precedingNonPeak = [...phases]
      .filter(p => p.position < phase.position && p.phaseType !== 'peak' && p.phaseType !== 'deload')
      .sort((a, b) => b.position - a.position)[0]
    if (precedingNonPeak?.secondaryStyleId) return precedingNonPeak.secondaryStyleId
    return phase.primaryStyleId ?? null
  }
  return phase.secondaryStyleId ?? phase.primaryStyleId ?? null
}
