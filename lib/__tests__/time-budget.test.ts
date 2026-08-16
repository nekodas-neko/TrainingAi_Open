import { describe, it, expect } from 'vitest'
import {
  setWorkSec, estimateExerciseDurationSec, estimateSessionDurationSec,
  estimateSessionDurationMin, fitToBudget, expandToBudget, dropToBudget, SECONDS_PER_REP, SET_SETUP_SEC,
  applyRoleSetPlausibility,
  type TimedExercise, type MuscleVolumeState,
} from '@trainingai/shared/ai-periodization/time-budget'
import { TRANSITION_SEC_BARBELL, TRANSITION_SEC_STANDARD } from '@trainingai/shared/workout/duration-model'

describe('duration model', () => {
  it('per-set work time grows with reps', () => {
    expect(setWorkSec(3)).toBe(SET_SETUP_SEC + 3 * SECONDS_PER_REP)
    expect(setWorkSec(12)).toBeGreaterThan(setWorkSec(3))
  })

  it('exercise duration = sets*setWork + sets*rest + transition', () => {
    const ex = { sets: 3, reps: 5, restSec: 120, transitionSec: TRANSITION_SEC_BARBELL }
    const expected = 3 * setWorkSec(5) + 3 * 120 + TRANSITION_SEC_BARBELL
    expect(estimateExerciseDurationSec(ex)).toBe(expected)
  })

  it('every set is charged its rest, including the last one', () => {
    expect(estimateExerciseDurationSec({ sets: 1, reps: 5, restSec: 180, transitionSec: TRANSITION_SEC_STANDARD }))
      .toBe(setWorkSec(5) + 180 + TRANSITION_SEC_STANDARD)
  })

  it('session duration sums exercises', () => {
    const exs = [
      { sets: 2, reps: 6, restSec: 90, transitionSec: TRANSITION_SEC_BARBELL },
      { sets: 3, reps: 8, restSec: 60, transitionSec: TRANSITION_SEC_STANDARD },
    ]
    expect(estimateSessionDurationSec(exs))
      .toBe(estimateExerciseDurationSec(exs[0]) + estimateExerciseDurationSec(exs[1]))
  })
})

describe('fitToBudget', () => {
  const mk = (id: string, role: string, sets: number, reps: number, restSec: number, transitionSec = 120): TimedExercise =>
    ({ sessionExerciseId: id, role, sets, reps, restSec, transitionSec })

  it('leaves an already-fitting session untouched', () => {
    const exs = [mk('a', 'primary', 3, 5, 120)]
    expect(fitToBudget(exs, 60)).toEqual(exs)
  })

  it('does not mutate the input', () => {
    const exs = [mk('a', 'accessory', 5, 12, 90)]
    const before = JSON.parse(JSON.stringify(exs))
    fitToBudget(exs, 10)
    expect(exs).toEqual(before)
  })

  it('trims accessories before compounds', () => {
    const exs = [
      mk('main', 'primary', 5, 5, 180),
      mk('acc', 'accessory', 5, 12, 90),
    ]
    const out = fitToBudget(exs, 32)
    const acc = out.find(e => e.sessionExerciseId === 'acc')!
    const main = out.find(e => e.sessionExerciseId === 'main')!
    expect(acc.sets).toBeLessThan(5)
    expect(main.sets).toBe(5)
  })

  it('a barbell-heavy session trims more sets than a machine session for the same budget', () => {
    const budget = 30
    const machine = fitToBudget([
      mk('a', 'primary', 5, 5, 150, TRANSITION_SEC_STANDARD),
      mk('b', 'accessory', 5, 12, 90, TRANSITION_SEC_STANDARD),
    ], budget)
    const barbell = fitToBudget([
      mk('a', 'primary', 5, 5, 150, TRANSITION_SEC_BARBELL),
      mk('b', 'accessory', 5, 12, 90, TRANSITION_SEC_BARBELL),
    ], budget)
    const totalSets = (out: TimedExercise[]) => out.reduce((n, e) => n + e.sets, 0)
    expect(totalSets(barbell)).toBeLessThan(totalSets(machine))
  })

  it('brings an over-budget session within budget when possible', () => {
    const exs = [
      mk('a', 'primary', 5, 5, 180),
      mk('b', 'secondary', 5, 8, 120),
      mk('c', 'accessory', 5, 12, 90),
    ]
    const budget = 35
    const out = fitToBudget(exs, budget)
    expect(estimateSessionDurationMin(out)).toBeLessThanOrEqual(budget)
  })

  it('never drops an exercise entirely, even on an impossible budget', () => {
    const exs = [
      mk('a', 'primary', 5, 5, 240),
      mk('b', 'accessory', 5, 12, 120),
    ]
    const out = fitToBudget(exs, 5)
    expect(out.find(e => e.sessionExerciseId === 'a')!.sets).toBe(2)
    expect(out.find(e => e.sessionExerciseId === 'b')!.sets).toBe(2) // accessory floor is 2
  })

  it('a protected (earned) set is trimmed last — it steals time from other work', () => {
    const exs = [
      mk('main', 'primary', 4, 5, 150),
      mk('other', 'accessory', 4, 12, 90),
      mk('earned', 'accessory', 4, 12, 90),
    ]
    const budget = 30
    const out = fitToBudget(exs, budget, new Set(['earned']))
    const earned = out.find(e => e.sessionExerciseId === 'earned')!
    const other = out.find(e => e.sessionExerciseId === 'other')!
    expect(estimateSessionDurationMin(out)).toBeLessThanOrEqual(budget)
    expect(earned.sets).toBeGreaterThan(other.sets)
  })

  it('still honours the budget guarantee — a protected set is trimmed if nothing else can give', () => {
    const exs = [
      mk('main', 'primary', 2, 5, 240),
      mk('earned', 'accessory', 4, 12, 180),
    ]
    const out = fitToBudget(exs, 5, new Set(['earned']))
    // main is already at its floor (2), so the protected 'earned' is trimmed down to the
    // 2-set floor too (was 1 before the floor was raised) — nothing can give below that.
    expect(out.find(e => e.sessionExerciseId === 'earned')!.sets).toBe(2)
  })

  it('within a role tier, trims the accessory whose muscle is furthest over its weekly MAV first', () => {
    const exs: TimedExercise[] = [
      { ...mk('overTarget', 'accessory', 4, 10, 90), muscleGroups: [{ muscle: 'biceps', weight: 1.0 }] },
      { ...mk('underTarget', 'accessory', 4, 10, 90), muscleGroups: [{ muscle: 'calves', weight: 1.0 }] },
    ]
    const muscleVolume = new Map<string, MuscleVolumeState>([
      ['biceps', { loggedBeforeSession: 20, mav: 14 }], // already well over MAV
      ['calves', { loggedBeforeSession: 2, mav: 14 }], // well under MAV
    ])
    // Budget leaves room to trim only a couple of sets, so the over-MAV accessory reaches
    // the 2-set floor while the under-MAV one keeps more — showing the priority. (A tighter
    // budget would floor both at 2 and hide the ordering.)
    const out = fitToBudget(exs, 16, new Set(), muscleVolume)
    const overTarget = out.find(e => e.sessionExerciseId === 'overTarget')!
    const underTarget = out.find(e => e.sessionExerciseId === 'underTarget')!
    expect(overTarget.sets).toBeLessThan(underTarget.sets)
  })

  it('a mild imbalance stays role-ordered — accessory still trims before primary', () => {
    const exs: TimedExercise[] = [
      { ...mk('chest', 'primary', 4, 6, 150), muscleGroups: [{ muscle: 'chest', weight: 1.0 }] },
      { ...mk('biceps', 'accessory', 4, 12, 90), muscleGroups: [{ muscle: 'biceps', weight: 1.0 }] },
    ]
    // Both close to their own MAV — a small edge either way, not an outlier.
    const muscleVolume = new Map<string, MuscleVolumeState>([
      ['chest', { loggedBeforeSession: 12, mav: 16 }],
      ['biceps', { loggedBeforeSession: 9, mav: 14 }],
    ])
    const out = fitToBudget(exs, 22, new Set(), muscleVolume)
    expect(out.find(e => e.sessionExerciseId === 'biceps')!.sets)
      .toBeLessThan(out.find(e => e.sessionExerciseId === 'chest')!.sets)
  })

  it('a severe cross-tier outlier lets a primary trim ahead of an accessory', () => {
    // Chest (primary) is already well past its weekly MAV; biceps (accessory) is badly
    // undertrained this week — cutting the accessory further would only widen the gap.
    const exs: TimedExercise[] = [
      { ...mk('chest', 'primary', 4, 6, 150), muscleGroups: [{ muscle: 'chest', weight: 1.0 }] },
      { ...mk('biceps', 'accessory', 4, 12, 90), muscleGroups: [{ muscle: 'biceps', weight: 1.0 }] },
    ]
    const muscleVolume = new Map<string, MuscleVolumeState>([
      ['chest', { loggedBeforeSession: 13, mav: 16 }], // projects to 17 of 16 — over MAV
      ['biceps', { loggedBeforeSession: 0, mav: 14 }], // projects to 4 of 14 — badly under
    ])
    const out = fitToBudget(exs, 21, new Set(), muscleVolume)
    expect(out.find(e => e.sessionExerciseId === 'chest')!.sets)
      .toBeLessThan(out.find(e => e.sessionExerciseId === 'biceps')!.sets)
  })
})

describe('fitToBudget with measured time profiles', () => {
  it('a session that fits on constants gets trimmed when measured rest is longer', () => {
    const ex = {
      sessionExerciseId: 'a', role: 'accessory', sets: 4, reps: 10,
      restSec: 60, transitionSec: 120,
    }
    // Constants: 4×50 + 3×60 + 120 = 500s — fits a 10-min budget untouched.
    expect(fitToBudget([ex], 10)[0].sets).toBe(4)
    // Measured reality: 300s actual rest → 4×50 + 3×300 + 120 = 1220s > 600s.
    // Trimming must see the measured values, not the optimistic constants.
    const measured = { ...ex, measuredRestSec: 300 }
    expect(fitToBudget([measured], 10)[0].sets).toBeLessThan(4)
  })

  it('measured sec/rep flows into the estimate too', () => {
    const ex = {
      sessionExerciseId: 'a', role: 'accessory', sets: 4, reps: 10,
      restSec: 60, transitionSec: 120, measuredSecPerRep: 12, // slow tempo: 130s sets
    }
    // 4×130 + 3×60 + 120 = 820s > 600s → must trim.
    expect(fitToBudget([ex], 10)[0].sets).toBeLessThan(4)
  })
})

describe('expandToBudget', () => {
  const mk = (id: string, role: string, sets: number, reps: number, restSec: number, transitionSec = 120): TimedExercise =>
    ({ sessionExerciseId: id, role, sets, reps, restSec, transitionSec })

  it('adds sets while they fit, and stops before overrunning', () => {
    const exs = [mk('a', 'primary', 2, 5, 120)]
    const out = expandToBudget(exs, 30)
    expect(out[0].sets).toBeGreaterThan(2)
    expect(estimateSessionDurationMin(out)).toBeLessThanOrEqual(30)
  })

  it('does not mutate the input', () => {
    const exs = [mk('a', 'primary', 2, 5, 120)]
    const before = JSON.parse(JSON.stringify(exs))
    expandToBudget(exs, 60)
    expect(exs).toEqual(before)
  })

  it('never exceeds the per-role set ceiling, however large the budget', () => {
    const out = expandToBudget([
      mk('main', 'primary', 2, 5, 120),
      mk('acc', 'accessory', 2, 12, 60),
    ], 600)
    expect(out.find(e => e.sessionExerciseId === 'main')!.sets).toBe(6)
    expect(out.find(e => e.sessionExerciseId === 'acc')!.sets).toBe(4)
  })

  it('spends extra time on the muscle furthest BELOW its weekly target', () => {
    const exs: TimedExercise[] = [
      { ...mk('ahead', 'accessory', 2, 10, 90), muscleGroups: [{ muscle: 'biceps', weight: 1.0 }] },
      { ...mk('behind', 'accessory', 2, 10, 90), muscleGroups: [{ muscle: 'calves', weight: 1.0 }] },
    ]
    const muscleVolume = new Map<string, MuscleVolumeState>([
      ['biceps', { loggedBeforeSession: 13, mav: 14 }], // nearly at target
      ['calves', { loggedBeforeSession: 1, mav: 14 }],  // badly behind
    ])
    const out = expandToBudget(exs, 22, muscleVolume)
    expect(out.find(e => e.sessionExerciseId === 'behind')!.sets)
      .toBeGreaterThan(out.find(e => e.sessionExerciseId === 'ahead')!.sets)
  })

  it('stops at MRV headroom rather than buying unrecoverable volume', () => {
    const exs: TimedExercise[] = [
      { ...mk('a', 'primary', 2, 5, 120), muscleGroups: [{ muscle: 'chest', weight: 1.0 }] },
    ]
    const muscleVolume = new Map<string, MuscleVolumeState>([
      ['chest', { loggedBeforeSession: 18, mav: 16 }],
    ])
    // MRV 20, 18 already logged, 2 in session -> no headroom for a third set.
    const out = expandToBudget(exs, 600, muscleVolume, new Map([['chest', 20]]))
    expect(out[0].sets).toBe(2)
  })
})

describe('dropToBudget', () => {
  const mk = (id: string, role: string, sets: number, reps: number, restSec: number, transitionSec = 120): TimedExercise =>
    ({ sessionExerciseId: id, role, sets, reps, restSec, transitionSec })

  it('drops exercises when trimming to the set floors still overruns', () => {
    // Five exercises at the 2-set floor cannot fit a 15-minute budget.
    const exs = Array.from({ length: 5 }, (_, i) => mk(`e${i}`, 'accessory', 4, 10, 90))
    const { exercises, droppedIds } = dropToBudget(exs, 15)
    expect(droppedIds.length).toBeGreaterThan(0)
    expect(exercises.length).toBe(5 - droppedIds.length)
    expect(estimateSessionDurationMin(exercises)).toBeLessThanOrEqual(15)
  })

  it('drops accessories before compounds', () => {
    const exs = [
      mk('main', 'primary', 4, 5, 180),
      mk('acc', 'accessory', 4, 12, 90),
    ]
    const { droppedIds } = dropToBudget(exs, 12)
    expect(droppedIds).toContain('acc')
    expect(droppedIds).not.toContain('main')
  })

  it('always keeps at least one exercise, however impossible the budget', () => {
    const exs = [mk('a', 'primary', 4, 5, 240), mk('b', 'accessory', 4, 12, 120)]
    const { exercises } = dropToBudget(exs, 1)
    expect(exercises.length).toBe(1)
  })

  it('is a no-op when trimming alone already fits', () => {
    const exs = [mk('a', 'primary', 3, 5, 120)]
    const { exercises, droppedIds } = dropToBudget(exs, 60)
    expect(droppedIds).toEqual([])
    expect(exercises).toEqual(exs)
  })

  it('gives sets back to the survivors after a drop frees time', () => {
    const exs = [
      mk('main', 'primary', 5, 5, 120),
      mk('acc', 'accessory', 5, 12, 90),
    ]
    // 12 min is below what both exercises cost even at the 2-set floor (~14 min), so a
    // drop is forced; the survivor is then re-fitted against the full budget.
    const { exercises, droppedIds } = dropToBudget(exs, 12)
    expect(droppedIds).toContain('acc')
    // main is re-fitted against the whole budget, not left at the count it was cut to
    // while competing with the dropped accessory.
    const main = exercises.find(e => e.sessionExerciseId === 'main')!
    expect(main.sets).toBeGreaterThan(2)
  })
})

describe('applyRoleSetPlausibility', () => {
  const mk = (id: string, role: string, sets: number, muscle: string): TimedExercise => ({
    sessionExerciseId: id, role, sets, reps: 8, restSec: 90, transitionSec: 120,
    muscleGroups: [{ muscle, weight: 1.0 }],
  })
  const vol = (entries: Array<[string, MuscleVolumeState]>) => new Map<string, MuscleVolumeState>(entries)

  it('clamps every role to its set ceiling, with no budget pass involved', () => {
    // The production case: an accessory returned at 5 sets on a standard-preset session,
    // where nothing consulted SET_CEILING at all.
    const out = applyRoleSetPlausibility([
      mk('bench', 'primary', 4, 'chest'),
      mk('skullcrusher', 'accessory', 5, 'triceps'),
    ])
    expect(out.find(e => e.sessionExerciseId === 'skullcrusher')!.sets).toBe(4)
    expect(out.find(e => e.sessionExerciseId === 'bench')!.sets).toBe(4)
  })

  it('caps a non-anchor exercise at the anchor\'s set count when its muscle is not behind', () => {
    const out = applyRoleSetPlausibility(
      [mk('bench', 'primary', 3, 'chest'), mk('curl', 'accessory', 4, 'biceps')],
      vol([
        ['chest', { loggedBeforeSession: 8, mav: 16 }],
        ['biceps', { loggedBeforeSession: 12, mav: 14 }], // projects to 16 of 14 — over target
      ]),
    )
    expect(out.find(e => e.sessionExerciseId === 'curl')!.sets).toBe(3)
  })

  it('lets a lagging muscle keep more sets than the anchor — role order yields to weekly need', () => {
    const out = applyRoleSetPlausibility(
      [mk('bench', 'primary', 3, 'chest'), mk('curl', 'accessory', 4, 'biceps')],
      vol([
        ['chest', { loggedBeforeSession: 8, mav: 16 }],
        ['biceps', { loggedBeforeSession: 0, mav: 14 }], // projects to 4 of 14 — badly behind
      ]),
    )
    expect(out.find(e => e.sessionExerciseId === 'curl')!.sets).toBe(4)
  })

  it('does not qualify as lagging when the exercise also hammers an already-over muscle', () => {
    // muscleOverageRatio reports the most OVER-target muscle, so a movement training one
    // lagging and one maxed-out muscle is not a way to buy the lagging one extra volume.
    const ex: TimedExercise = {
      sessionExerciseId: 'row', role: 'accessory', sets: 4, reps: 8, restSec: 90, transitionSec: 120,
      muscleGroups: [{ muscle: 'biceps', weight: 1.0 }, { muscle: 'back', weight: 1.0 }],
    }
    const out = applyRoleSetPlausibility([mk('squat', 'primary', 3, 'quads'), ex], vol([
      ['quads', { loggedBeforeSession: 6, mav: 16 }],
      ['biceps', { loggedBeforeSession: 0, mav: 14 }], // behind
      ['back', { loggedBeforeSession: 18, mav: 16 }], // already over
    ]))
    expect(out.find(e => e.sessionExerciseId === 'row')!.sets).toBe(3)
  })

  it('anchors on the highest role present when a session has no primary', () => {
    // Owner-confirmed intentional program design, not a misconfiguration to route around.
    const out = applyRoleSetPlausibility([
      mk('hipthrust', 'secondary', 3, 'glutes'),
      mk('forearm', 'accessory', 4, 'forearms'),
    ])
    expect(out.find(e => e.sessionExerciseId === 'forearm')!.sets).toBe(3)
    expect(out.find(e => e.sessionExerciseId === 'hipthrust')!.sets).toBe(3)
  })

  it('reads role from the role field, not list position', () => {
    // One program's primary sits second in its session; an implementation that assumed the
    // first exercise is the anchor would cap everything against a secondary here.
    const out = applyRoleSetPlausibility([
      mk('hipthrust', 'secondary', 4, 'glutes'),
      mk('squat', 'primary', 3, 'quads'),
      mk('calf', 'accessory', 4, 'calves'),
    ])
    expect(out.find(e => e.sessionExerciseId === 'hipthrust')!.sets).toBe(3)
    expect(out.find(e => e.sessionExerciseId === 'calf')!.sets).toBe(3)
  })

  it('does not strip accessory volume in a realisation phase when the muscle needs it', () => {
    // A realisation primary is deliberately low-set (3x2 heavy) while isolation work stays
    // high-volume. Clamping accessories to the primary's count year-round would quietly
    // delete that volume — the lagging exception is what prevents it.
    const out = applyRoleSetPlausibility(
      [mk('squat', 'primary', 2, 'quads'), mk('lateral', 'accessory', 4, 'delts')],
      vol([
        ['quads', { loggedBeforeSession: 10, mav: 16 }],
        ['delts', { loggedBeforeSession: 2, mav: 16 }], // projects to 6 of 16 — behind
      ]),
    )
    expect(out.find(e => e.sessionExerciseId === 'lateral')!.sets).toBe(4)
  })

  it('never caps below the role floor, even against a tiny anchor', () => {
    const out = applyRoleSetPlausibility(
      [mk('squat', 'primary', 1, 'quads'), mk('calf', 'accessory', 4, 'calves')],
      vol([
        ['quads', { loggedBeforeSession: 6, mav: 16 }],
        ['calves', { loggedBeforeSession: 14, mav: 14 }], // over target — not exempt
      ]),
    )
    expect(out.find(e => e.sessionExerciseId === 'calf')!.sets).toBe(2)
  })

  it('does not mutate the input', () => {
    const exs = [mk('bench', 'primary', 3, 'chest'), mk('skull', 'accessory', 5, 'triceps')]
    applyRoleSetPlausibility(exs)
    expect(exs[1].sets).toBe(5)
  })
})
