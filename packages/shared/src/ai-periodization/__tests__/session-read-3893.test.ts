// #3893 (step 1 of #3889): the session read, in shadow. Every rule of the owner's 20 Nov gradient,
// every missing-data path, the set k−1 rest pairing and the first set. No model, no database.
import { describe, it, expect } from 'vitest'
import {
  readSession, restExcuse, missBand, nextBarUnderRead, replaySessionReads, isReadableLog,
  type SessionReadSet, type SessionReadInput, type SessionReadLog,
} from '../session-read'
import { sessionReadsFor } from '../session-read-plan'

/** A set as planned: 8 reps at 80 kg, 80 %, 120 s planned rest, rested in full, effort pre-filled. */
const set = (setNumber: number, over: Partial<SessionReadSet> = {}): SessionReadSet => ({
  setNumber, reps: 8, weightKg: 80, plannedReps: 8, plannedWeightKg: 80, plannedPct: 80,
  restTimeSec: 120, plannedRestSec: 120, rpe: null, rpeSource: null, hr: null, ...over,
})
const three = (...over: Partial<SessionReadSet>[]) => [1, 2, 3].map((n, i) => set(n, over[i]))
const read = (sets: SessionReadSet[], over: Partial<SessionReadInput> = {}) =>
  readSession({ sets, effort: null, hrDense: null, weightStepKg: 2.5, ...over })
const tapped = (vsPlan: -1 | 0 | 1) => ({ effort: { vsPlan, source: 'tapped' } })

describe('how much a rest before a set excuses', () => {
  it('80 % or more excuses nothing, 50–80 % one rep, under 50 % two', () => {
    expect([1, 0.8, 0.79, 0.5, 0.49, 0].map(restExcuse)).toEqual([0, 0, 1, 1, 2, 2])
  })
})

describe('the rest before set k is set k−1\'s rest', () => {
  it('a short rest after set 1 excuses a miss on set 2, though set 2\'s own rest was full', () => {
    const r = read(three({ restTimeSec: 48 }, { reps: 7 }))
    expect(r.sets[1]).toMatchObject({ cls: 'miss', missReps: 1, excusedReps: 1, restBeforeRatio: 0.4 })
    expect(r).toMatchObject({ verdict: 'hold-rest-more', nextLoad: 'hold', band: 'none', restShort: true })
  })
  it('set 2\'s own short rest (the rest after it) does not excuse its miss', () => {
    const r = read(three({}, { reps: 6, restTimeSec: 30 }))
    expect(r.sets[1]).toMatchObject({ excusedReps: 0, restBeforeRatio: 1 })
    expect(r.verdict).toBe('reduce')
  })
  it('the excuse is never bigger than the miss', () => {
    const r = read(three({ restTimeSec: 10 }, { reps: 7 }))
    expect(r.sets[1]).toMatchObject({ missReps: 1, excusedReps: 1 })
  })
})

describe('the first set gets no excuse', () => {
  it('has no rest before it, and a miss there counts in full', () => {
    const r = read(three({ reps: 6 }))
    expect(r.sets[0]).toMatchObject({ cls: 'miss', excusedReps: 0, restBeforeRatio: null })
    expect(r).toMatchObject({ verdict: 'reduce', nextLoad: 'down-1', band: 'clear', unexplainedReps: 2 })
  })
  it('missed by 3 or more is a large miss whatever its share: two steps down', () => {
    expect(read(three({ reps: 5 }))).toMatchObject({ band: 'large', nextLoad: 'down-2' })
  })
})

describe('the bands of the unexplained miss', () => {
  it('small: one rep and under 15 % → same weight', () => {
    expect(read(three({}, {}, { reps: 7 }))).toMatchObject({ verdict: 'hold', nextLoad: 'hold', band: 'small' })
  })
  it('one rep that is 15 % or more of the target is clear', () => {
    expect(missBand(1, 6, 0)).toBe('clear')
    expect(missBand(1, 7, 0)).toBe('small')
  })
  it('clear: 2–3 reps, or 15–35 % → one step down', () => {
    expect(missBand(2, 100, 0)).toBe('clear')
    expect(missBand(3, 100, 0)).toBe('clear')
    expect(missBand(35, 100, 0)).toBe('clear')
  })
  it('large: over 35 % → two steps down', () => {
    expect(missBand(36, 100, 0)).toBe('large')
    const r = read([1, 2, 3].map(n => set(n, { plannedReps: 5, reps: n === 1 ? 5 : 2 })))
    expect(r).toMatchObject({ unexplainedReps: 6, targetReps: 15, band: 'large', verdict: 'reduce', nextLoad: 'down-2' })
  })
  it('nothing unexplained is "none"', () => {
    expect(missBand(0, 24, 0)).toBe('none')
  })
})

describe('the owner\'s worked examples (20 Nov)', () => {
  it('set 1 missed by 2, harder: a clear miss moved one band down → two steps down', () => {
    expect(read(three({ reps: 6 }), tapped(1))).toMatchObject({ band: 'large', nextLoad: 'down-2' })
  })
  it('set 3 missed by 1 after 40 % of the rest, as expected → same weight, "rest the full time"', () => {
    const r = read(three({}, { restTimeSec: 48 }, { reps: 7 }), tapped(0))
    expect(r).toMatchObject({ verdict: 'hold-rest-more', nextLoad: 'hold', band: 'none' })
  })
  it('sets 2 and 3 each missed by 3 after 60 % rest: 4 of 24 left → one step down', () => {
    const r = read(three({ restTimeSec: 72 }, { reps: 5, restTimeSec: 72 }, { reps: 5 }), tapped(0))
    expect(r).toMatchObject({ unexplainedReps: 4, targetReps: 24, band: 'clear', nextLoad: 'down-1' })
  })
})

describe('the effort answer moves the band one step', () => {
  it('harder makes a small miss one step down', () => {
    expect(read(three({}, {}, { reps: 7 }), tapped(1))).toMatchObject({ band: 'clear', nextLoad: 'down-1' })
  })
  it('harder leaves "the rest explains it" as it is', () => {
    expect(read(three({ restTimeSec: 48 }, { reps: 7 }), tapped(1))).toMatchObject({ verdict: 'hold-rest-more' })
  })
  it('easier with a miss is a likely logging slip: hold, and flag it', () => {
    const r = read(three({ reps: 5 }), tapped(-1))
    expect(r).toMatchObject({ verdict: 'hold', nextLoad: 'hold', easierWithMiss: true, effort: -1 })
  })
  it('an answer left on its default is no answer', () => {
    const r = read(three({}, {}, { reps: 7 }), { effort: { vsPlan: 1, source: 'default' } })
    expect(r).toMatchObject({ band: 'small', nextLoad: 'hold', effort: null })
  })
})

describe('every rep met', () => {
  it('a beaten set adds weight, as today', () => {
    expect(read(three({ reps: 9 }))).toMatchObject({ verdict: 'progress-load', nextLoad: 'as-today' })
  })
  it('the last set at planned + 1 is the pre-fill, not a beat; at planned + 2 it is', () => {
    expect(read(three({}, {}, { reps: 9 }))).toMatchObject({ verdict: 'hold', nextLoad: 'as-today' })
    expect(read(three({}, {}, { reps: 10 }))).toMatchObject({ verdict: 'progress-load' })
  })
  it('met as planned with no answer keeps today\'s basis', () => {
    expect(read(three())).toMatchObject({ verdict: 'hold', nextLoad: 'as-today', band: null })
  })
  it('harder holds the weight, even with a beaten set', () => {
    expect(read(three({ reps: 9 }), tapped(1))).toMatchObject({ verdict: 'hold', nextLoad: 'hold' })
  })
  it('easier adds one step', () => {
    expect(read(three(), tapped(-1))).toMatchObject({ verdict: 'progress-load', nextLoad: 'up-1' })
  })
})

describe('add reps: every set exactly met and hand-rated as comfortable', () => {
  // 80 % for 5 is about RPE 7 expected; a rated 5 is 2 under it.
  const easy = (rpeSource: string | null) => [1, 2, 3].map(n => set(n, { plannedReps: 5, reps: 5, rpe: 5, rpeSource }))
  it('with room under the rep ceiling, adds reps and holds the weight', () => {
    expect(read(easy('rated'), { repCeiling: 8 })).toMatchObject({ verdict: 'progress-reps', nextLoad: 'hold' })
  })
  it('a pre-filled effort is not a rating', () => {
    expect(read(easy('expected'), { repCeiling: 8 }).verdict).toBe('hold')
  })
  it('at the ceiling, or with no ceiling known, it cannot fire', () => {
    expect(read(easy('rated'), { repCeiling: 5 }).verdict).toBe('hold')
    expect(read(easy('rated')).verdict).toBe('hold')
  })
})

describe('heart rate, on dense days only', () => {
  const unsettled = { recoveredPreset: false, restAdequate: true, coverageOk: true }
  const settled = { recoveredPreset: true, restAdequate: true, coverageOk: true }
  it('half or more of the measured rests not settling holds the weight', () => {
    const sets = three({ hr: unsettled, reps: 9 }, { hr: settled })
    expect(read(sets, { hrDense: true })).toMatchObject({ verdict: 'hold-recovery', nextLoad: 'hold', hrRead: true })
  })
  it('one unsettled rest of three is under the share: no hold', () => {
    const sets = [1, 2, 3, 4].map(n => set(n, { reps: n === 1 ? 9 : 8, hr: n === 1 ? unsettled : settled }))
    expect(read(sets, { hrDense: true }).verdict).toBe('progress-load')
  })
  it('the rest after a set is read for the set that follows it: the last set\'s rest is not', () => {
    const sets = three({ reps: 9, hr: settled }, { hr: settled }, { hr: unsettled })
    expect(read(sets, { hrDense: true }).verdict).toBe('progress-load')
  })
  it('without dense heart rate, nothing is read', () => {
    const sets = three({ hr: unsettled, reps: 9 }, { hr: unsettled })
    expect(read(sets, { hrDense: null })).toMatchObject({ verdict: 'progress-load', hrRead: false })
    expect(read(sets, { hrDense: false }).verdict).toBe('progress-load')
  })
  it('a rest without coverage is not a measured rest', () => {
    const sets = three({ hr: { ...unsettled, coverageOk: false }, reps: 9 }, { hr: { ...unsettled, coverageOk: false } })
    expect(read(sets, { hrDense: true }).verdict).toBe('progress-load')
  })
})

describe('missing data never counts against the lifter', () => {
  it('an unknown rest before a miss excuses it, and today\'s basis stands', () => {
    const r = read(three({ restTimeSec: null }, { reps: 5 }))
    expect(r.sets[1]).toMatchObject({ excusedReps: 3, restBeforeRatio: null })
    expect(r).toMatchObject({ verdict: 'hold', nextLoad: 'as-today', band: 'none', restShort: false })
  })
  it('no planned rest before a miss is an unknown rest', () => {
    expect(read(three({ plannedRestSec: null }, { reps: 5 })).nextLoad).toBe('as-today')
  })
  it('a miss at a weight the lifter chose heavier is not the plan\'s', () => {
    const r = read(three({ reps: 5, weightKg: 85 }))
    expect(r.sets[0]).toMatchObject({ cls: 'miss-self-heavier', excusedReps: 3 })
    expect(r.nextLoad).toBe('as-today')
  })
  it('one step heavier is still the plan', () => {
    expect(read(three({ reps: 5, weightKg: 82.5 })).nextLoad).toBe('down-2')
  })
  it('no planned weight: the weight comparison is skipped', () => {
    expect(read(three({ reps: 6, weightKg: 200, plannedWeightKg: null })).nextLoad).toBe('down-1')
  })
  it('no sets → can\'t say', () => {
    expect(read([])).toMatchObject({ verdict: 'too-little-data', nextLoad: 'as-today', why: 'no-sets' })
  })
  it('fewer than two sets with planned reps → can\'t say', () => {
    const r = read([set(1, { reps: 3 }), set(2, { plannedReps: null, reps: 1 })])
    expect(r).toMatchObject({ verdict: 'too-little-data', why: 'too-few-planned-sets', nextLoad: 'as-today' })
  })
  it('an overridden session → can\'t say', () => {
    expect(read(three({ reps: 2 }), { overridden: true })).toMatchObject({ verdict: 'too-little-data', why: 'overridden' })
  })
  it('an extra set with no plan is left out of both sides', () => {
    const r = read([...three(), set(4, { plannedReps: null, reps: 2 })])
    expect(r).toMatchObject({ targetReps: 24, verdict: 'hold' })
    expect(r.sets[3].cls).toBe('unplanned')
  })
})

describe('the next bar under the read, against today\'s', () => {
  it('as today, held, down never above today, up never below it', () => {
    expect(nextBarUnderRead('as-today', 77.5, 80, 2.5)).toBe(77.5)
    expect(nextBarUnderRead('hold', 77.5, 80, 2.5)).toBe(80)
    expect(nextBarUnderRead('down-1', 77.5, 80, 2.5)).toBe(77.5)
    expect(nextBarUnderRead('down-1', 80, 80, 2.5)).toBe(77.5)
    expect(nextBarUnderRead('down-2', 77.5, 80, 2.5)).toBe(75)
    // Today's rule already went lower than a step: the read never lifts it back up.
    expect(nextBarUnderRead('down-1', 70, 80, 2.5)).toBe(70)
    expect(nextBarUnderRead('down-2', 70, 80, 2.5)).toBe(70)
    expect(nextBarUnderRead('up-1', 85, 80, 2.5)).toBe(85)
    expect(nextBarUnderRead('up-1', 80, 80, 2.5)).toBe(82.5)
  })
})

const log = (over: Partial<SessionReadLog> & { sets?: SessionReadSet[] } = {}): SessionReadLog => ({
  exerciseLogId: 'el', workoutSessionId: 'ws', programSessionId: 'ps', exerciseName: 'Bench Press',
  loggedAt: new Date('2026-11-10T00:00:00Z'), estimated1rm: 95, exerciseDeloaded: false, exerciseType: 'weighted',
  session: { completed: true, isEarlyDeload: false, wasOverride: false, intensityMode: 'full', phaseType: 'normal', hrDense: null },
  effortVsPlan: null, effortSource: null, sets: three(), ...over,
})

describe('which logs the read judges', () => {
  it('a completed, non-deload, non-baseline log with an estimate', () => {
    expect(isReadableLog(log())).toBe(true)
    expect(isReadableLog(log({ exerciseDeloaded: true }))).toBe(false)
    expect(isReadableLog(log({ estimated1rm: 0 }))).toBe(false)
    expect(isReadableLog(log({ session: { ...log().session, completed: false } }))).toBe(false)
    expect(isReadableLog(log({ session: { ...log().session, isEarlyDeload: true } }))).toBe(false)
    expect(isReadableLog(log({ session: { ...log().session, intensityMode: 'deload' } }))).toBe(false)
    expect(isReadableLog(log({ session: { ...log().session, phaseType: 'baseline' } }))).toBe(false)
  })
})

describe('the replay counts only', () => {
  // Estimate 95 at 80 % is 76 → 77.5 today; the session's own bar was 80.
  it('counts per exercise how many next bars would differ, and which way', () => {
    const logs = [
      log({ sets: three({ restTimeSec: 48 }, { reps: 7 }) }), // rest explains it: held at 80 → heavier
      log({ sets: three({ reps: 6 }) }),                       // clear: min(77.5, 77.5) → same
      log({ sets: three({ reps: 5 }) }),                       // large: 75 → lighter
      log({ exerciseDeloaded: true }),                         // not readable
      log({ exerciseName: 'Push-up', exerciseType: 'bodyweight' }),
    ]
    const r = replaySessionReads(logs, () => 2.5)
    expect(r.skipped).toBe(1)
    expect(r.perExercise['Bench Press']).toEqual({
      sessions: 3, verdicts: { 'hold-rest-more': 1, reduce: 2 }, notComparable: 0,
      sameNextWeight: 1, heavierNextWeight: 1, lighterNextWeight: 1,
    })
    expect(r.perExercise['Push-up']).toMatchObject({ sessions: 1, notComparable: 1 })
  })
  it('carries no weight, rep or health figure', () => {
    const r = replaySessionReads([log()], () => 2.5)
    expect(JSON.stringify(r)).not.toMatch(/80|95|77\.5|Kg|reps"/)
  })
})

describe('the reads stored beside a plan', () => {
  const session = { exercises: [
    { id: 'se-bench', exerciseName: 'Bench Press', exerciseRole: 'primary' },
    { id: 'se-row', exerciseName: 'Row', exerciseRole: 'secondary' },
  ] } as unknown as Parameters<typeof sessionReadsFor>[0]
  const opts = { programStart: new Date('2026-11-01T00:00:00Z'), trainingGoal: 'strength', equipment: { 'Bench Press': ['barbell'] } }
  it('reads each exercise\'s newest readable log in this program', () => {
    const reads = sessionReadsFor(session, [
      log({ workoutSessionId: 'old', loggedAt: new Date('2026-11-05T00:00:00Z'), sets: three({ reps: 5 }) }),
      log({ workoutSessionId: 'new', loggedAt: new Date('2026-11-08T00:00:00Z') }),
      log({ workoutSessionId: 'deload', loggedAt: new Date('2026-11-09T00:00:00Z'), exerciseDeloaded: true }),
      log({ workoutSessionId: 'other-program', loggedAt: new Date('2026-10-20T00:00:00Z'), exerciseName: 'Row' }),
    ], opts)
    expect(reads).toEqual([expect.objectContaining({ sessionExerciseId: 'se-bench', workoutSessionId: 'new', verdict: 'hold' })])
  })
})
