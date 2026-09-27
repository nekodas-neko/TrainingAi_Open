// RV-177 — the three phase-set write routes took a raw cast. `durationCycles` reached the driver
// unchecked and a bad body answered with a bodiless 500.
//
// The load-bearing cases here are the ones that pin what the schema must NOT reject. A validator
// added after the fact is far more likely to break a payload the app already sends than to miss an
// attack, and two of these bounds were chosen from production data rather than from taste.
import { describe, it, expect } from 'vitest'
import { PhaseSetWriteBody, PhaseSetCloneBody, PHASE_TYPES } from '../phase-set'

const phase = (over: Record<string, unknown> = {}) => ({
  name: 'Accumulation', durationCycles: 4, phaseType: 'normal', ...over,
})

describe('PhaseSetWriteBody (RV-177)', () => {
  it('accepts the shape the phase editor posts, its editor-only keys included', () => {
    // `EditablePhase` carries `localId`, `position` and `primaryStyleName` on top of the real
    // fields, and every route re-derives position and ignores the rest. They are DECLARED rather
    // than stripped: the schema is `.strict()`, so naming them is what keeps the app's own payload
    // valid while an unknown key stays a 400.
    const r = PhaseSetWriteBody.safeParse({
      name: 'My Set',
      phases: [{ ...phase(), localId: 'local-1', position: 7, primaryStyleName: 'Max Strength' }],
    })
    expect(r.success).toBe(true)
  })

  it('refuses a key it does not know, rather than dropping it silently', () => {
    // The first draft of this schema was non-strict, so a typo'd or renamed field vanished without
    // a word. `check-strict-request-schemas` refused that, and this pins the behaviour it wanted.
    expect(PhaseSetWriteBody.safeParse({
      name: 'My Set', phases: [{ ...phase(), durationCyles: 4 }],
    }).success).toBe(false)
    expect(PhaseSetWriteBody.safeParse({ name: 'My Set', phases: [], extra: 1 }).success).toBe(false)
  })

  /**
   * **Zero cycles must pass.** `generated-program.ts` bounds the AI path at `min(1)` and copying it
   * here was the obvious move — but the editor's stepper floors at `Math.max(0, …)` and production
   * holds **8 phases at `duration_cycles = 0`**. `min(1)` would 400 the owner re-saving a phase set
   * already in his database.
   */
  it('accepts 0 cycles, which production already stores', () => {
    expect(PhaseSetWriteBody.safeParse({ name: 'S', phases: [phase({ durationCycles: 0 })] }).success).toBe(true)
  })

  it('accepts every phase type the union declares', () => {
    for (const phaseType of PHASE_TYPES) {
      expect(PhaseSetWriteBody.safeParse({ name: 'S', phases: [phase({ phaseType })] }).success,
        `rejected ${phaseType}`).toBe(true)
    }
  })

  it('accepts a cleared style as null as well as absent', () => {
    const r = PhaseSetWriteBody.safeParse({ name: 'S', phases: [phase({ primaryStyleId: null })] })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.phases[0].primaryStyleId).toBeUndefined()
  })

  it('defaults phases to an empty list rather than failing', () => {
    const r = PhaseSetWriteBody.safeParse({ name: 'S' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.phases).toEqual([])
  })

  // ── what it must refuse ────────────────────────────────────────────────────

  const dateIssueOn = (r: ReturnType<typeof PhaseSetWriteBody.safeParse>, key: string) =>
    r.success ? [] : r.error.issues.filter(i => i.path.includes(key))

  it.each([
    ['a non-integer duration', { durationCycles: 2.5 }],
    ['a negative duration', { durationCycles: -1 }],
    ['a duration past the 52 ceiling', { durationCycles: 53 }],
    ['a duration sent as a string', { durationCycles: '4' }],
    ['a phase type outside the union', { phaseType: 'bulk' }],
    ['an empty phase name', { name: '' }],
    ['a style id that is not a uuid', { primaryStyleId: 'not-a-uuid' }],
  ])('refuses %s, and on that field', (_label, over) => {
    const r = PhaseSetWriteBody.safeParse({ name: 'S', phases: [phase(over)] })
    expect(r.success).toBe(false)
    // Not merely "it failed" — the issue has to be the field under test, or the case proves nothing.
    const key = Object.keys(over)[0]
    expect(dateIssueOn(r, key), `failed for the wrong reason: ${JSON.stringify(r.success ? null : r.error.issues)}`)
      .not.toHaveLength(0)
  })

  it('refuses a missing or blank set name', () => {
    expect(PhaseSetWriteBody.safeParse({ phases: [] }).success).toBe(false)
    expect(PhaseSetWriteBody.safeParse({ name: '   ', phases: [] }).success).toBe(false)
  })
})

describe('PhaseSetCloneBody (RV-177)', () => {
  const CLONE = { phaseSetId: '00000000-0000-4000-8000-000000000001', programName: 'Clone' }

  it('accepts a clone with string-keyed overrides, as JSON delivers them', () => {
    const r = PhaseSetCloneBody.safeParse({ ...CLONE, overrides: { '0': 3, '2': 6 } })
    expect(r.success).toBe(true)
  })

  it('defaults overrides to an empty object', () => {
    const r = PhaseSetCloneBody.safeParse(CLONE)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.overrides).toEqual({})
  })

  it.each([
    ['a phaseSetId that is not a uuid', { phaseSetId: 'nope' }],
    ['a blank program name', { programName: '  ' }],
    ['an override value past the ceiling', { overrides: { '0': 99 } }],
    ['a non-numeric override key', { overrides: { first: 3 } }],
  ])('refuses %s', (_label, over) => {
    expect(PhaseSetCloneBody.safeParse({ ...CLONE, ...over }).success).toBe(false)
  })
})
