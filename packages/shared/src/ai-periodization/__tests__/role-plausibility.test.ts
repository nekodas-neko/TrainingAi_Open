import { describe, it, expect } from 'vitest'
import { capLoadToAnchor, sessionAnchorRole, applyStoredRoleCaps } from '@trainingai/shared/ai-periodization/role-plausibility'

describe('sessionAnchorRole', () => {
  it('picks the highest role present, regardless of order', () => {
    expect(sessionAnchorRole(['accessory', 'primary', 'secondary'])).toBe('primary')
    expect(sessionAnchorRole(['accessory', 'secondary'])).toBe('secondary')
    expect(sessionAnchorRole(['accessory'])).toBe('accessory')
  })

  it('returns null rather than inventing a primary for a session that has none', () => {
    expect(sessionAnchorRole([])).toBeNull()
  })
})

describe('capLoadToAnchor', () => {
  it('caps an accessory prescribed heavier than the primary — the production case', () => {
    // Upper shipped Skull Crusher at 77.5% against Incline Bench at 76%. Both sat under the
    // 80% zone ceiling, which is why the pre-existing zone-based caps never bound.
    const out = capLoadToAnchor([
      { role: 'primary', pct: 76 },
      { role: 'secondary', pct: 72.5 },
      { role: 'accessory', pct: 77.5 },
    ])
    expect(out.map(e => e.pct)).toEqual([76, 72.5, 76])
  })

  it('leaves a session alone when nothing out-loads the anchor', () => {
    const exs = [
      { role: 'primary', pct: 82.5 },
      { role: 'secondary', pct: 77.5 },
      { role: 'accessory', pct: 70.5 },
    ]
    expect(capLoadToAnchor(exs).map(e => e.pct)).toEqual([82.5, 77.5, 70.5])
  })

  it('does not bind in a realisation phase, where the primary is far heavier anyway', () => {
    const out = capLoadToAnchor([
      { role: 'primary', pct: 92.5 },
      { role: 'accessory', pct: 70 },
    ])
    expect(out.map(e => e.pct)).toEqual([92.5, 70])
  })

  it('anchors on the highest role present when a session has no primary', () => {
    // Owner-confirmed intentional design: one session is all secondaries plus accessories.
    const out = capLoadToAnchor([
      { role: 'secondary', pct: 75 },
      { role: 'secondary', pct: 75 },
      { role: 'accessory', pct: 80 },
    ])
    expect(out.map(e => e.pct)).toEqual([75, 75, 75])
  })

  it('reads role from the role field, not list position', () => {
    // One program's primary sits second in its session; capping against "the first exercise"
    // would anchor on a secondary and let the accessory through.
    const out = capLoadToAnchor([
      { role: 'secondary', pct: 72.5 },
      { role: 'primary', pct: 76 },
      { role: 'accessory', pct: 79 },
    ])
    expect(out.map(e => e.pct)).toEqual([72.5, 76, 76])
  })

  it('uses the heaviest anchor when a session has two primaries', () => {
    const out = capLoadToAnchor([
      { role: 'primary', pct: 70 },
      { role: 'primary', pct: 85 },
      { role: 'accessory', pct: 80 },
    ])
    expect(out.map(e => e.pct)).toEqual([70, 85, 80])
  })

  it('never raises a light accessory toward the anchor', () => {
    const out = capLoadToAnchor([
      { role: 'primary', pct: 85 },
      { role: 'accessory', pct: 55 },
    ])
    expect(out[1].pct).toBe(55)
  })

  it('is a no-op on an empty session', () => {
    expect(capLoadToAnchor([])).toEqual([])
  })

  it('does not mutate the input', () => {
    const exs = [{ role: 'primary', pct: 76 }, { role: 'accessory', pct: 80 }]
    capLoadToAnchor(exs)
    expect(exs[1].pct).toBe(80)
  })
})

describe('applyStoredRoleCaps', () => {
  const roles = (m: Record<string, string>) => new Map(Object.entries(m))

  it('corrects the live Upper prescription — accessory heavier AND longer than the primary', () => {
    // Generated 2026-07-22, six days before the generation-time rule shipped, and still live:
    // the exact row that proved a generation-only fix cannot reach stored prescriptions.
    const out = applyStoredRoleCaps(
      [
        { sessionExerciseId: 'incline', sets: 4, pct: 76 },
        { sessionExerciseId: 'pulldown', sets: 3, pct: 72.5 },
        { sessionExerciseId: 'skull', sets: 5, pct: 77.5 },
      ],
      roles({ incline: 'primary', pulldown: 'secondary', skull: 'accessory' }),
    )
    expect(out.find(e => e.sessionExerciseId === 'skull')).toEqual({
      sessionExerciseId: 'skull', sets: 4, pct: 76,
    })
    expect(out.find(e => e.sessionExerciseId === 'incline')!.pct).toBe(76)
  })

  it('returns the identical array when there is nothing to correct', () => {
    const exs = [
      { sessionExerciseId: 'a', sets: 4, pct: 80 },
      { sessionExerciseId: 'b', sets: 3, pct: 70 },
    ]
    expect(applyStoredRoleCaps(exs, roles({ a: 'primary', b: 'accessory' }))).toBe(exs)
  })

  it('does NOT apply the anchor set cap — that exception needs weekly-volume data', () => {
    // An accessory with more sets than the primary may be a deliberate lagging-muscle
    // allowance made at generation. Enforcing it here, where we cannot see weekly volume,
    // would delete volume that was granted on purpose. Only its own ceiling binds.
    const out = applyStoredRoleCaps(
      [
        { sessionExerciseId: 'squat', sets: 2, pct: 90 },
        { sessionExerciseId: 'lateral', sets: 4, pct: 65 },
      ],
      roles({ squat: 'primary', lateral: 'accessory' }),
    )
    expect(out.find(e => e.sessionExerciseId === 'lateral')!.sets).toBe(4)
  })

  it('anchors on the highest role present when the session has no primary', () => {
    const out = applyStoredRoleCaps(
      [
        { sessionExerciseId: 'hip', sets: 4, pct: 75 },
        { sessionExerciseId: 'forearm', sets: 3, pct: 80 },
      ],
      roles({ hip: 'secondary', forearm: 'accessory' }),
    )
    expect(out.find(e => e.sessionExerciseId === 'forearm')!.pct).toBe(75)
  })

  it('leaves exercises with no known role untouched, and lets them define no anchor', () => {
    const out = applyStoredRoleCaps(
      [
        { sessionExerciseId: 'ghost', sets: 9, pct: 99 },
        { sessionExerciseId: 'curl', sets: 3, pct: 70 },
      ],
      roles({ curl: 'accessory' }),
    )
    expect(out.find(e => e.sessionExerciseId === 'ghost')).toEqual({
      sessionExerciseId: 'ghost', sets: 9, pct: 99,
    })
    // 'curl' is the only known role, so it is the anchor and caps against itself.
    expect(out.find(e => e.sessionExerciseId === 'curl')!.pct).toBe(70)
  })

  it('does not mutate the input', () => {
    const exs = [
      { sessionExerciseId: 'p', sets: 4, pct: 76 },
      { sessionExerciseId: 'a', sets: 5, pct: 80 },
    ]
    applyStoredRoleCaps(exs, roles({ p: 'primary', a: 'accessory' }))
    expect(exs[1]).toEqual({ sessionExerciseId: 'a', sets: 5, pct: 80 })
  })
})
