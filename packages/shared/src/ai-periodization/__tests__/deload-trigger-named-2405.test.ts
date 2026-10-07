// #2405 — an emergency deload triggered by a sick check-in explained itself as "sore muscle flagged
// in your check-in". The sheet falls back to that sentence whenever a deloaded row has no
// `deloadNote`, and the whole-session builder never set one, so EVERY whole-session deload said it,
// whatever fired it. The reasoning on the same prescription said "overtraining signals" for the same
// reason. The trigger is now named once, where it is decided, and carried on every row.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../../../../../scripts/lib/strip-comments.js'
import { emergencyDeloadTrigger, shouldTriggerEmergencyDeload, type EmergencySignals } from '../emergency-deload'
import { buildWholeSessionDeloadPrescription } from '../generate-prescription'
import type { PrescriptionSignals } from '../signals'

const quiet: EmergencySignals = {
  consecutiveSessionDaysOfThisType: 0, hoursSinceLastSession: 72, soreMusclesInSession: [],
  activeInjuredMusclesInSession: [], acwr: null, rpeTrend: null, repCompletionRate: null, selfReportedSick: false,
}
const phaseState = { phase: 'accumulation', prescription: null, prescriptionStatus: 'none', prescriptionExpiresAt: null } as const

describe('emergencyDeloadTrigger names what fired the deload (#2405)', () => {
  it('is null when nothing fired', () => {
    expect(emergencyDeloadTrigger(quiet)).toBeNull()
  })

  it('names illness for a self-reported sick day, not soreness', () => {
    const t = emergencyDeloadTrigger({ ...quiet, selfReportedSick: true })!
    expect(t.kind).toBe('illness')
    expect(t.note).toMatch(/unwell/i)
    expect(t.note).not.toMatch(/sore/i)
  })

  it('names each of the other triggers distinctly', () => {
    const kinds = [
      emergencyDeloadTrigger({ ...quiet, consecutiveSessionDaysOfThisType: 4 }),
      emergencyDeloadTrigger({ ...quiet, hoursSinceLastSession: 20, soreMusclesInSession: ['a', 'b', 'c'] }),
      emergencyDeloadTrigger({ ...quiet, acwr: 9 }),
      emergencyDeloadTrigger({ ...quiet, rpeTrend: { delta: 3 } as EmergencySignals['rpeTrend'] }),
      emergencyDeloadTrigger({ ...quiet, repCompletionRate: 0.5 }),
    ].map(t => t?.kind)
    expect(kinds).toEqual(['consecutive-days', 'soreness', 'training-load', 'effort', 'missed-reps'])
    expect(new Set(kinds).size).toBe(5)
  })

  it('reports illness first when several fire at once: the lifter\'s own report outranks the numbers', () => {
    const t = emergencyDeloadTrigger({ ...quiet, selfReportedSick: true, acwr: 9, consecutiveSessionDaysOfThisType: 5 })!
    expect(t.kind).toBe('illness')
  })

  it('fires on exactly the same inputs as shouldTriggerEmergencyDeload (one definition)', () => {
    const cases: EmergencySignals[] = [
      quiet,
      { ...quiet, selfReportedSick: true },
      { ...quiet, consecutiveSessionDaysOfThisType: 3 },
      { ...quiet, consecutiveSessionDaysOfThisType: 4 },
      { ...quiet, hoursSinceLastSession: 20, soreMusclesInSession: ['a', 'b'] },
      { ...quiet, hoursSinceLastSession: 20, soreMusclesInSession: ['a', 'b', 'c'] },
      { ...quiet, hoursSinceLastSession: null, soreMusclesInSession: ['a', 'b', 'c'] },
      { ...quiet, repCompletionRate: 0.7 },
      { ...quiet, repCompletionRate: 0.69 },
    ]
    for (const c of cases) {
      expect(emergencyDeloadTrigger(c) !== null, JSON.stringify(c)).toBe(shouldTriggerEmergencyDeload(c, phaseState as never))
    }
  })
})

type Ex = PrescriptionSignals['exercises'][number]
const exercise = (id: string): Ex => ({
  sessionExerciseId: id, name: id, role: 'primary', muscleGroups: ['chest'],
  muscleAssignments: [{ muscle: 'chest', role: 'main' }], baseline1rm: 100, current1rm: 100,
  exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0, avgSetDurationSec: 45, timeProfile: null,
  equipment: [], transitionSec: 240, plateau: false, rpeDelta: null, repCompletionRate: null,
  baseSets: [{ pct: 80, reps: 5, restSec: 120 }],
}) as Ex
const signals = { trainingGoal: 'strength', effectiveTimeBudgetMin: 60, exercises: [exercise('a'), exercise('b')], phase: 'accumulation' } as unknown as PrescriptionSignals

describe('the whole-session builder carries the trigger on every row (#2405)', () => {
  it('stamps the note it is given on each deloaded exercise', () => {
    const p = buildWholeSessionDeloadPrescription(signals, 'because', 'Deload — you reported feeling unwell')
    expect(p.exercises.every(e => e.deloaded && e.deloadNote === 'Deload — you reported feeling unwell')).toBe(true)
  })

  it('leaves the note off when none is given, rather than inventing one', () => {
    const p = buildWholeSessionDeloadPrescription(signals, 'because')
    expect(p.exercises.every(e => e.deloadNote === undefined)).toBe(true)
  })
})

describe('the sheet no longer claims soreness when it has no reason', () => {
  const sheet = stripComments(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'components', 'workout', 'deload-info-sheet.tsx'), 'utf8'))
  it('falls back to a neutral label, not "sore muscle"', () => {
    expect(sheet).not.toMatch(/sore muscle/i)
    expect(sheet).toMatch(/exercise\.deloadNote \?\? "Deload"/)
  })
})

describe('the call sites pass the trigger', () => {
  const src = readFileSync(join(__dirname, '..', 'generate-prescription.ts'), 'utf8')
  it('the emergency path names the trigger in both the reasoning and the row note', () => {
    expect(src).not.toContain('Emergency deload triggered due to overtraining signals.')
    expect(src).toMatch(/emergencyDeloadTrigger\(signals\)/)
  })
})
