import { describe, it, expect } from 'vitest'
import { sessionContextLabel } from '../utils'
import type { PhaseStatus } from '@trainingai/shared/workout/session-data'

/**
 * BF-8. The active workout's header printed "Deload · " only when the PHASE was a deload week, so a
 * deload the prescription applied for its own reasons ran to the last set looking like a full
 * session. The owner trained one that way and said so.
 */
const phase = (over: Partial<PhaseStatus> = {}): PhaseStatus => ({
  phase: { id: 'p', name: 'Accumulation', position: 0, cycles: 4 } as PhaseStatus['phase'],
  cycleInPhase: 2,
  totalPhaseCycles: 4,
  completedCycles: 1,
  totalProgramCycles: 12,
  sessionsPerCycle: 3,
  sessionsInCurrentCycle: 1,
  blockComplete: false,
  approxWeeksRemaining: 6,
  isDeloadActive: false,
  isBaseline: false,
  ...over,
})

describe('sessionContextLabel', () => {
  it('marks a session deload inside an ordinary phase — the case that was invisible', () => {
    expect(sessionContextLabel(phase(), true)).toBe('Accumulation · C2/4 · Deload · ')
  })

  it('leaves an ordinary session alone', () => {
    expect(sessionContextLabel(phase(), false)).toBe('Accumulation · C2/4 · ')
  })

  it('keeps the phase context rather than replacing it', () => {
    // Dropping "Accumulation · C2/4" to say "Deload" alone would trade one missing fact for another:
    // a readiness deload still happens somewhere in the phase.
    expect(sessionContextLabel(phase(), true)).toContain('Accumulation')
  })

  it('prints a phase deload on its own, which has no cycle position worth showing', () => {
    expect(sessionContextLabel(phase({ isDeloadActive: true }), false)).toBe('Deload · ')
    expect(sessionContextLabel(phase({ isDeloadActive: true }), true)).toBe('Deload · ')
  })

  it('uses the session number on an open-ended phase', () => {
    expect(sessionContextLabel(phase({ openEnded: true, phaseSessionNumber: 7 }), false))
      .toBe('Accumulation · S7 · ')
  })

  it('still says deload with no phase at all', () => {
    expect(sessionContextLabel(null, true)).toBe('Deload · ')
    expect(sessionContextLabel(undefined, false)).toBe('')
  })
})
