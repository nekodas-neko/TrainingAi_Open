import { describe, it, expect } from 'vitest'
import { summarizeSets, formatProgramExport, type ProgramExport } from '../program-export'

describe('summarizeSets', () => {
  it('collapses a uniform style to N×reps @pct', () => {
    expect(summarizeSets([
      { reps: 6, pct: 80, restSec: 180 },
      { reps: 6, pct: 80, restSec: 180 },
      { reps: 6, pct: 80, restSec: 180 },
      { reps: 6, pct: 80, restSec: 180 },
    ])).toBe('4×6 @80% · rest 180s')
  })
  it('lists per-set when reps/pct vary', () => {
    expect(summarizeSets([
      { reps: 8, pct: 70, restSec: 120 },
      { reps: 6, pct: 75, restSec: 120 },
    ])).toBe('2 sets: 8@70%, 6@75% · rest 120s')
  })
  it('handles a missing style', () => {
    expect(summarizeSets([])).toBe('no style assigned')
  })
})

describe('formatProgramExport', () => {
  const data: ProgramExport = {
    programName: 'Powerbuilding',
    goal: 'powerbuilding',
    phaseMode: 'ai_dynamic',
    sessions: [{
      name: 'Push',
      budgetMin: 60,
      estMin: 72,
      exercises: [
        { name: 'Bench Press', role: 'primary', sets: [{ reps: 6, pct: 80, restSec: 180 }], muscles: ['chest', 'triceps'], supersetGroup: null },
        { name: 'Cable Pulldown', role: 'primary', sets: [{ reps: 6, pct: 75, restSec: 150 }], muscles: ['lats'], supersetGroup: null },
        { name: 'Lateral Raise', role: 'accessory', sets: [{ reps: 12, pct: 60, restSec: 60 }], muscles: ['shoulders'], supersetGroup: null },
      ],
    }],
  }

  it('renders header, over-budget flag, role tally and numbered exercises', () => {
    const out = formatProgramExport(data)
    expect(out).toContain('# Powerbuilding · goal: powerbuilding · mode: ai_dynamic')
    expect(out).toContain('## Push — budget 60 min · est ~72 min ⚠️ OVER')
    expect(out).toContain('roles: 2P / 1A')
    expect(out).toContain('1. Bench Press · primary · 1×6 @80% · rest 180s · chest, triceps')
    expect(out).toContain('3. Lateral Raise · accessory · 1×12 @60% · rest 60s · shoulders')
  })

  it('flags a fitting session with ✓', () => {
    const out = formatProgramExport({ ...data, sessions: [{ ...data.sessions[0], estMin: 55 }] })
    expect(out).toContain('✓ fits')
  })
})
