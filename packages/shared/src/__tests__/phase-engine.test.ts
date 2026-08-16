import { describe, it, expect } from 'vitest'
import { getCurrentPhase, isDeloadActive, isEarlyDeloadWeek, resolveStyleForExercise, buildAutomaticPhaseStatus, deloadAwareStylePhase } from '../phase-engine'
import type { ProgramPhase } from '@trainingai/shared/types/program'

const phases: ProgramPhase[] = [
  { id: 'a', phaseSetId: 'p', position: 0, name: 'Accumulation',    durationCycles: 4, phaseType: 'normal',  primaryStyleId: 'sA',  secondaryStyleId: 'sAs' },
  { id: 'b', phaseSetId: 'p', position: 1, name: 'Intensification', durationCycles: 4, phaseType: 'normal',  primaryStyleId: 'sI',  secondaryStyleId: 'sIs' },
  { id: 'c', phaseSetId: 'p', position: 2, name: 'Peak',            durationCycles: 2, phaseType: 'peak',    primaryStyleId: 'sP'  },
  { id: 'd', phaseSetId: 'p', position: 3, name: 'Deload',          durationCycles: 1, phaseType: 'deload' },
]

describe('getCurrentPhase', () => {
  it('returns first phase at session 0', () => {
    const r = getCurrentPhase(phases, 3, 0)
    expect(r.phase.id).toBe('a')
    expect(r.cycleInPhase).toBe(1)
    expect(r.completedCycles).toBe(0)
    expect(r.blockComplete).toBe(false)
  })

  it('stays in first phase at session 11 (cycle 4 of 4)', () => {
    const r = getCurrentPhase(phases, 3, 11)   // 11 sessions = 3 complete cycles, cycle 4 in progress
    expect(r.phase.id).toBe('a')
    expect(r.cycleInPhase).toBe(4)
  })

  it('advances to second phase after 12 sessions', () => {
    const r = getCurrentPhase(phases, 3, 12)   // 12 sessions = 4 complete cycles
    expect(r.phase.id).toBe('b')
    expect(r.cycleInPhase).toBe(1)
  })

  it('advances to Peak phase after 24 sessions', () => {
    const r = getCurrentPhase(phases, 3, 24)
    expect(r.phase.id).toBe('c')
    expect(r.cycleInPhase).toBe(1)
  })

  it('advances to Deload phase after 30 sessions', () => {
    const r = getCurrentPhase(phases, 3, 30)
    expect(r.phase.id).toBe('d')
    expect(r.cycleInPhase).toBe(1)
  })

  it('sets blockComplete and pins to last phase when all cycles done', () => {
    const r = getCurrentPhase(phases, 3, 33)   // 33 = 11 cycles * 3 sessions
    expect(r.blockComplete).toBe(true)
    expect(r.phase.id).toBe('d')
    expect(r.approxWeeksRemaining(3)).toBe(0)
  })

  it('computes approxWeeksRemaining for the current phase only', () => {
    const r = getCurrentPhase(phases, 3, 12)   // 4 cycles done, entering Intensification cycle 1/4
    // Phase has 4 cycles, on cycle 1 → 4 cycles left in phase
    // 4 cycles * 3 sessions/cycle = 12 sessions; at 3/week = 4 weeks
    expect(r.approxWeeksRemaining(3)).toBe(4)
  })

  it('approxWeeksRemaining reflects progress within the phase', () => {
    const r = getCurrentPhase(phases, 3, 21)   // 7 cycles done, Intensification cycle 4/4
    // 4 - 4 + 1 = 1 cycle left in phase; at 3/week = 1 week
    expect(r.approxWeeksRemaining(3)).toBe(1)
  })

  it('throws on empty phases', () => {
    expect(() => getCurrentPhase([], 3, 0)).toThrow()
  })

  it('throws on sessionsPerCycle < 1', () => {
    expect(() => getCurrentPhase(phases, 0, 0)).toThrow()
  })
})

describe('isDeloadActive', () => {
  const deloadPhase: ProgramPhase = { ...phases[3] }
  const normalPhase: ProgramPhase = { ...phases[0] }

  it('returns true when phase type is deload', () => {
    expect(isDeloadActive(deloadPhase, {}, '2026-06-01')).toBe(true)
  })

  it('returns false when phase is normal and no early deload', () => {
    expect(isDeloadActive(normalPhase, {}, '2026-06-01')).toBe(false)
  })

  it('returns true when within 7-day early deload window', () => {
    expect(isDeloadActive(normalPhase, { earlyDeloadWeekStart: '2026-06-01' }, '2026-06-01')).toBe(true)
    expect(isDeloadActive(normalPhase, { earlyDeloadWeekStart: '2026-06-01' }, '2026-06-07')).toBe(true)
  })

  it('returns false on day 8 (window closed)', () => {
    expect(isDeloadActive(normalPhase, { earlyDeloadWeekStart: '2026-06-01' }, '2026-06-08')).toBe(false)
  })
})

// ai_dynamic programs have no ProgramPhase rows, so the window has to be answerable without one.
describe('isEarlyDeloadWeek (Q-175 — the window with no phase to consult)', () => {
  it('is true for the seven days from the confirmed start', () => {
    expect(isEarlyDeloadWeek({ earlyDeloadWeekStart: '2026-06-01' }, '2026-06-01')).toBe(true)
    expect(isEarlyDeloadWeek({ earlyDeloadWeekStart: '2026-06-01' }, '2026-06-07')).toBe(true)
  })

  it('is false on day 8 and before the start', () => {
    expect(isEarlyDeloadWeek({ earlyDeloadWeekStart: '2026-06-01' }, '2026-06-08')).toBe(false)
    expect(isEarlyDeloadWeek({ earlyDeloadWeekStart: '2026-06-01' }, '2026-05-31')).toBe(false)
  })

  it('is false when no deload week was ever confirmed', () => {
    expect(isEarlyDeloadWeek({}, '2026-06-01')).toBe(false)
  })

  it('does not answer for a deload PHASE — that is isDeloadActive\'s half', () => {
    expect(isEarlyDeloadWeek({}, '2026-06-01')).toBe(false)
    expect(isDeloadActive({ ...phases[3] }, {}, '2026-06-01')).toBe(true)
  })
})

describe('deloadAwareStylePhase (W5 §4.1 — early deload actually reduces load)', () => {
  const deloadWithStyle: ProgramPhase = { ...phases[3], primaryStyleId: 'deloadStyle', secondaryStyleId: 'deloadStyle' }
  const withDeload = [phases[0], phases[1], phases[2], deloadWithStyle]

  it('swaps in the deload phase for style resolution during an early deload on a normal phase', () => {
    const p = deloadAwareStylePhase(phases[0], withDeload, true)
    expect(p?.id).toBe('d')
    // Prescribed style is now the lighter deload style, not the natural phase's — the actual fix.
    expect(resolveStyleForExercise(p!, withDeload, { exerciseRole: 'primary' })).toBe('deloadStyle')
  })

  it('leaves a real deload phase untouched (it already resolves its own style)', () => {
    expect(deloadAwareStylePhase(deloadWithStyle, withDeload, true)?.id).toBe('d')
  })

  it('returns the natural phase when no deload is active', () => {
    expect(deloadAwareStylePhase(phases[0], withDeload, false)?.id).toBe('a')
  })

  it('falls back to the natural phase when the program has no deload phase', () => {
    const noDeload = [phases[0], phases[1], phases[2]]
    expect(deloadAwareStylePhase(phases[0], noDeload, true)?.id).toBe('a')
  })

  it('returns null when there is no current phase', () => {
    expect(deloadAwareStylePhase(null, withDeload, true)).toBeNull()
  })
})

describe('resolveStyleForExercise', () => {
  const peak = phases[2]

  it('routes accessory exercises to Accessory phase style', () => {
    const accessoryPhase: ProgramPhase = {
      id: 'acc', phaseSetId: 'p', position: 4, name: 'Accessory',
      durationCycles: 0, phaseType: 'accessory', primaryStyleId: 'general', secondaryStyleId: undefined,
    }
    const phasesWithAccessory = [...phases, accessoryPhase]
    const r = resolveStyleForExercise(peak, phasesWithAccessory, { exerciseRole: 'accessory', styleId: 'ownStyle' })
    expect(r).toBe('general')
  })

  it('returns own for accessory when no Accessory phase defined', () => {
    const r = resolveStyleForExercise(peak, phases, { exerciseRole: 'accessory', styleId: 'ownStyle' })
    expect(r).toBe('own')
  })

  it('returns phase primary style for primary exercises', () => {
    const r = resolveStyleForExercise(phases[0], phases, { exerciseRole: 'primary' })
    expect(r).toBe('sA')
  })

  it('returns secondary style for secondary in normal phase', () => {
    const r = resolveStyleForExercise(phases[0], phases, { exerciseRole: 'secondary' })
    expect(r).toBe('sAs')
  })

  it('falls back to primary when no secondary style set in normal phase', () => {
    const phase = { ...phases[0], secondaryStyleId: undefined }
    const r = resolveStyleForExercise(phase, phases, { exerciseRole: 'secondary' })
    expect(r).toBe('sA')
  })

  it('uses preceding non-peak secondary style for secondary in peak phase', () => {
    const r = resolveStyleForExercise(peak, phases, { exerciseRole: 'secondary' })
    expect(r).toBe('sIs')
  })

  it('falls back to peak primary when no preceding non-peak phase has secondary style', () => {
    const phasesNoSec: ProgramPhase[] = [
      { id: 'a', phaseSetId: 'p', position: 0, name: 'A', durationCycles: 4, phaseType: 'normal', primaryStyleId: 'sA' },
      { id: 'c', phaseSetId: 'p', position: 1, name: 'Peak', durationCycles: 2, phaseType: 'peak', primaryStyleId: 'sP' },
    ]
    const r = resolveStyleForExercise(phasesNoSec[1], phasesNoSec, { exerciseRole: 'secondary' })
    expect(r).toBe('sP')
  })
})

describe('buildAutomaticPhaseStatus', () => {
  const twoPhase: ProgramPhase[] = [
    { id: 'p1', phaseSetId: 'ps', position: 0, name: 'Accumulation', durationCycles: 4, phaseType: 'normal' },
    { id: 'p2', phaseSetId: 'ps', position: 1, name: 'Intensification', durationCycles: 3, phaseType: 'normal' },
  ]

  it('builds a PhaseStatus for a session mid-way through the first phase', () => {
    const status = buildAutomaticPhaseStatus(
      twoPhase,
      /* thisSessionCount */ 1,
      /* program */ {},
      /* todayStr */ '2026-07-06',
      /* sessionPerWeek */ 2,
    )
    expect(status.phase.name).toBe('Accumulation')
    expect(status.cycleInPhase).toBe(2)
    expect(status.totalPhaseCycles).toBe(4)
    expect(status.isDeloadActive).toBe(false)
    expect(status.isBaseline).toBe(false)
    expect(status.approxWeeksRemaining).not.toBeNull()
  })

  it('marks isDeloadActive during an early-deload week', () => {
    const status = buildAutomaticPhaseStatus(
      twoPhase, 1, { earlyDeloadWeekStart: '2026-07-01' }, '2026-07-03', 2,
    )
    expect(status.isDeloadActive).toBe(true)
  })

  it('returns null approxWeeksRemaining when sessionPerWeek is 0', () => {
    const status = buildAutomaticPhaseStatus(twoPhase, 1, {}, '2026-07-06', 0)
    expect(status.approxWeeksRemaining).toBeNull()
  })
})
