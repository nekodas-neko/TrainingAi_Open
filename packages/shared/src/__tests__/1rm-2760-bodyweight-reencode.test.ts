import { describe, it, expect } from 'vitest'
import { calc1RM, calcAmrap1RM, mround, repMaxFromAmrapOneRm, BW_REF } from '../1rm'
import { planBodyweightOneRmReencode, storedTargetPct, type BodyweightLogInput } from '../workout/bodyweight-one-rm-reencode'

// #2760 (owner, 2026-10-09: "yes, re-encode once"). A stored bodyweight estimate is a pure function of
// the logged reps and added load. Rows stored before issue 2193 (a) used the stepped AMRAP discount;
// re-encoding them under the smooth one makes every row read back the reps it was.

/** The pre-2193 (a) encoding, as `legacySteppedAmrap1RM` in 1rm.ts reads it. */
const legacy = (addedKg: number, reps: number) => {
  const f = reps <= 5 ? 1.0 : reps <= 8 ? 0.97 : reps <= 12 ? 0.93 : reps <= 20 ? 0.88 : 0.82
  return mround(calc1RM(BW_REF + addedKg, reps) * f, 0.25)
}
const log = (over: Partial<BodyweightLogInput> & { sets: BodyweightLogInput['sets'] }): BodyweightLogInput => ({
  exerciseLogId: 'el-1', exerciseName: 'Push-Up', loggedAt: new Date('2026-09-20T02:00:00Z'),
  estimated1rm: 0, target80: null, ...over,
})
const set = (reps: number, weightKg = 0, useFor1rm = false, id = `s-${reps}-${weightKg}`) =>
  ({ setLogId: id, weightKg, reps, useFor1rm, intensityPct: null })

describe('planBodyweightOneRmReencode (#2760)', () => {
  it('lifts the 10-rep collision: the old value is what 9 reps stores now', () => {
    const old = legacy(0, 10)
    expect(old).toBe(calcAmrap1RM(BW_REF, 9)) // the collision the issue names
    expect(repMaxFromAmrapOneRm(old)).toBe(9)
    const plan = planBodyweightOneRmReencode([log({ estimated1rm: old, target80: mround(old * 0.8, 0.25), sets: [set(10)] })])
    expect(plan.changes).toHaveLength(1)
    const after = plan.changes[0].after.estimated1rm
    expect(after).toBe(calcAmrap1RM(BW_REF, 10))
    expect(after).toBeGreaterThan(old)
    expect(repMaxFromAmrapOneRm(after)).toBe(10)
  })

  // Swept over loads and every rep count. After the re-encode a moved row is exactly what the log
  // path stores today, so it reads back like a fresh row: the only misreads left are the current
  // map's own high-rep collisions, which no inverse can split. Measured: 27 at bodyweight, 29 at
  // +5 kg, 28 at +10 kg, 30 at +20 kg.
  for (const added of [0, 5, 10, 20]) {
    it(`+${added} kg: a re-encoded row reads back like a fresh one, and nothing is lowered by more than a rounding step`, () => {
      const ref = BW_REF + added
      const freshMisreads = new Set<number>()
      for (let r = 1; r <= 30; r++) if (repMaxFromAmrapOneRm(calcAmrap1RM(ref, r), added) !== r) freshMisreads.add(r)
      for (let r = 1; r <= 30; r++) {
        const old = legacy(added, r)
        const plan = planBodyweightOneRmReencode([log({ estimated1rm: old, sets: [set(r, added)] })])
        if (plan.changes.length) {
          expect(plan.changes[0].after.estimated1rm, `${r} reps`).toBe(calcAmrap1RM(ref, r))
          expect(plan.changes[0].after.estimated1rm).toBeGreaterThan(old)
        }
        // The old encoding rounded twice, so at one rep count per load it can sit one 0.25 step
        // above the smooth value. That row is reported, not written, and still reads back right.
        for (const w of plan.wouldLower) {
          expect(w.stored - w.rederived, `${r} reps`).toBeLessThanOrEqual(0.25)
          expect(repMaxFromAmrapOneRm(w.stored, added)).toBe(r)
        }
        const stored = plan.changes[0]?.after.estimated1rm ?? old
        if (!freshMisreads.has(r)) expect(repMaxFromAmrapOneRm(stored, added), `${r} reps`).toBe(r)
      }
    })
  }

  it('leaves a row already under the current map alone, so a second run writes nothing', () => {
    const plan = planBodyweightOneRmReencode([log({ estimated1rm: calcAmrap1RM(BW_REF, 12), sets: [set(12)] })])
    expect(plan).toEqual({ changes: [], unchanged: 1, wouldLower: [] })
  })

  it('reports and never writes a row that would fall', () => {
    const plan = planBodyweightOneRmReencode([log({ estimated1rm: 999, sets: [set(10)] })])
    expect(plan.changes).toEqual([])
    expect(plan.wouldLower).toEqual([expect.objectContaining({ stored: 999, rederived: calcAmrap1RM(BW_REF, 10) })])
  })

  it('counts only the sets that counted at log time (use_for_1rm)', () => {
    // A warm-up set of 20 and a counted set of 10: only the 10 decides the estimate.
    const sets = [set(20, 0, false, 'a'), set(10, 0, true, 'b')]
    const plan = planBodyweightOneRmReencode([log({ estimated1rm: legacy(0, 10), sets })])
    expect(plan.changes[0].after.estimated1rm).toBe(calcAmrap1RM(BW_REF, 10))
  })

  it('keeps the percentage the target was stored with', () => {
    const old = legacy(0, 10)
    const plan = planBodyweightOneRmReencode([log({ estimated1rm: old, target80: mround(old * 0.75, 0.25), sets: [set(10)] })])
    const { estimated1rm, target80 } = plan.changes[0].after
    expect(target80).toBe(mround(estimated1rm * 0.75, 0.25))
  })

  it('prices each set at BW_REF plus its load for intensity, as the edit path does', () => {
    const plan = planBodyweightOneRmReencode([log({ estimated1rm: legacy(10, 10), sets: [set(10, 10)] })])
    const after = plan.changes[0].after.estimated1rm
    expect(plan.changes[0].sets[0].intensityPct).toBe(Math.round(((BW_REF + 10) / after) * 1000) / 10)
  })
})

describe('storedTargetPct', () => {
  it('recovers the percentage that reproduces the stored target, else 80', () => {
    expect(storedTargetPct(124, mround(124 * 0.75, 0.25))).toBe(75)
    expect(storedTargetPct(124, mround(124 * 0.8, 0.25))).toBe(80)
    expect(storedTargetPct(124, null)).toBe(80)
    expect(storedTargetPct(124, 3)).toBe(80)
  })
})
