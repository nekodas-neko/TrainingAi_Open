// #4079: a tapped Harder or Easier the rule read and changed nothing for is said back in the lift's
// note. One test per sentence, one per case that must stay silent, and the guarantee that no number
// of the plan moves. The grid differential is effort-answer-identity-4061.test.ts (its #4079 block);
// the database path is lib/data/postgres/__tests__/effort-answer-plan-4061.test.ts.
import { describe, it, expect } from 'vitest'
import {
  applyAutoregulation, computeRpeAdjustment, effortRpeDelta, unactedEffortNote,
  type AutoregContext, type AutoregExerciseSignal, type AutoregSignal,
} from '../autoregulation'

const band = { repMin: 3, repMax: 10 }
const ctxOf = (phase = 'accumulation', currentReps = 6): AutoregContext => ({ phase, currentReps, band })
/** A signal as the generator builds it for a tapped answer: the delta comes from the tap. */
const tap = (answer: -1 | 1, over: Partial<AutoregSignal> = {}): AutoregSignal => ({
  role: 'primary', rpeDelta: effortRpeDelta(null, { vsPlan: answer, source: 'tapped' }), rm1Trend: 'flat', repCompletionRate: 1,
  effortFromAnswer: true, effortAnswer: answer, ...over,
})
const note = (sig: AutoregSignal, ctx = ctxOf()) => unactedEffortNote(sig, ctx)

const TAIL = "so your answer doesn't change the plan."

describe('the sentences (#4079)', () => {
  it('Harder, logged reps on target', () => {
    expect(note(tap(1))).toBe(`You said it felt harder. Your logged reps were on target, ${TAIL}`)
  })
  it('Harder, just short of the target reps (the rule counts 95% as met)', () => {
    expect(note(tap(1, { repCompletionRate: 0.97 }))).toBe(`You said it felt harder. Your logged reps were just short of your target reps, ${TAIL}`)
  })
  it('Harder, with no way to compare the reps', () => {
    expect(note(tap(1, { repCompletionRate: null }))).toBe(`You said it felt harder. The app could not compare your reps with the plan, ${TAIL}`)
  })
  it('Easier, with logged reps short of target', () => {
    expect(note(tap(-1, { repCompletionRate: 0.9 }))).toBe(`You said it felt easier, but your logged reps fell short of your target, ${TAIL}`)
  })
  it('Easier, with a falling 1RM', () => {
    expect(note(tap(-1, { rm1Trend: 'down' }))).toBe(`You said it felt easier, but your 1RM slipped, ${TAIL}`)
  })
  it('Easier, with no way to compare the reps', () => {
    expect(note(tap(-1, { repCompletionRate: null }))).toBe(`You said it felt easier. The app could not compare your reps with the plan, ${TAIL}`)
  })
  it('Easier in a realisation phase (no rep pushes in a peak block)', () => {
    expect(note(tap(-1), ctxOf('realisation'))).toBe(`You said it felt easier. Realisation does not add reps, ${TAIL}`)
  })
  it('Easier on a compound at the top of its rep range', () => {
    expect(note(tap(-1), ctxOf('accumulation', 10))).toBe(`You said it felt easier. You are at the top of the rep range, ${TAIL}`)
  })
  it('either tap in a deload week', () => {
    expect(note(tap(1), ctxOf('deload'))).toBe(`You said it felt harder. This is a deload week, ${TAIL}`)
    expect(note(tap(-1), ctxOf('deload'))).toBe(`You said it felt easier. This is a deload week, ${TAIL}`)
  })
  it('a baseline week gets no sentence: the generator stops an incomplete baseline before this runs', () => {
    expect(note(tap(1), ctxOf('baseline'))).toBeNull()
    expect(note(tap(-1), ctxOf('baseline'))).toBeNull()
  })
  it('Harder in a realisation phase with reps on target is the ordinary Harder sentence (the rule cuts there too)', () => {
    expect(note(tap(1), ctxOf('realisation'))).toBe(`You said it felt harder. Your logged reps were on target, ${TAIL}`)
  })
  it('3 sets planned, 2 logged at target: completion is 1, so the sentence says "logged", never "every rep"', () => {
    // rep-completion.ts: a skipped planned set leaves no row, so 2 of 3 sets on target reads as 1.
    const n = note(tap(1, { repCompletionRate: 1 }))!
    expect(n).toContain('Your logged reps were on target')
    expect(n).not.toMatch(/every rep/i)
  })
  it('no sentence claims what the plan does', () => {
    const all = [
      note(tap(1)), note(tap(1, { repCompletionRate: 0.97 })), note(tap(1, { repCompletionRate: null })),
      note(tap(-1, { repCompletionRate: 0.9 })), note(tap(-1, { rm1Trend: 'down' })), note(tap(-1, { repCompletionRate: null })),
      note(tap(-1), ctxOf('realisation')), note(tap(-1), ctxOf('accumulation', 10)), note(tap(1), ctxOf('deload')),
    ]
    for (const n of all) {
      expect(n).toMatch(/^You said it felt (harder|easier)[.,]/)
      expect(n!.replace('1RM', '')).not.toMatch(/\d/) // the only digit is the word 1RM
      expect(n!.endsWith(TAIL)).toBe(true)
      for (const banned of ['the weight stays', 'nothing changes', 'every rep', 'within a rep', 'no rep counts']) {
        expect(n!.toLowerCase(), banned).not.toContain(banned)
      }
    }
  })
})

describe('what stays silent (#4079)', () => {
  it('no tap, an untouched default, and a tapped As expected add no note', () => {
    const plain: AutoregSignal = { role: 'primary', rpeDelta: null, rm1Trend: 'flat', repCompletionRate: 1 }
    expect(note(plain)).toBeNull()
    expect(note({ ...plain, rpeDelta: 2 })).toBeNull() // a rated delta alone, untouched by this change
    expect(note({ ...plain, effortFromAnswer: true })).toBeNull() // As expected: no answer direction
  })

  it('a tap the rule acted on gets no sentence of its own: its note comes from the rule, unchanged', () => {
    const cases: Array<[AutoregSignal, AutoregContext]> = [
      [tap(1, { repCompletionRate: 0.8 }), ctxOf()], // cut for a miss
      [tap(1, { rm1Trend: 'down' }), ctxOf()], // cut for a slipping 1RM
      [tap(-1), ctxOf()], // a rep added
      [tap(-1, { role: 'accessory' }), ctxOf('accumulation', 10)], // a set added at the band top
    ]
    for (const [sig, ctx] of cases) {
      const real = computeRpeAdjustment(sig, ctx)
      expect(real.note, 'the rule acted, so it wrote a note').not.toBeNull()
      const out = applyAutoregulation([{ sessionExerciseId: 'a', sets: 3, reps: ctx.currentReps, pct: 75 }], [{ ...sig, sessionExerciseId: 'a' }], 'strength', ctx.phase)
      expect(out.notes.a).toBe(real.note)
    }
  })

  it('an accessory at the top of its band adds a set, so it is not the silent top-of-range case', () => {
    expect(computeRpeAdjustment(tap(-1, { role: 'accessory' }), ctxOf('accumulation', 10)).setDelta).toBe(1)
  })

  it('a note exists exactly where the rule changed nothing, for every tap, role, phase, reps, 1RM and completion', () => {
    let silent = 0
    let said = 0
    for (const answer of [-1, 1] as const) for (const role of ['primary', 'secondary', 'accessory'])
      for (const phase of ['accumulation', 'intensification', 'realisation', 'deload', 'baseline'])
        for (const currentReps of [3, 6, 10]) for (const rm1Trend of ['up', 'flat', 'down'] as const)
          for (const repCompletionRate of [null, 0.5, 0.94, 0.95, 0.99, 1]) {
            const sig = tap(answer, { role, rm1Trend, repCompletionRate })
            const ctx = ctxOf(phase, currentReps)
            const rule = computeRpeAdjustment(sig, ctx)
            const n = note(sig, ctx)
            const changed = rule.pctMultiplier !== 1 || rule.repDelta !== 0 || rule.setDelta !== 0
            expect(rule.note !== null, 'the rule writes a note exactly when it changes the plan').toBe(changed)
            if (changed) continue
            if (phase === 'baseline') { expect(n).toBeNull(); continue } // unreachable in the generator, no sentence
            expect(n, JSON.stringify({ answer, role, phase, currentReps, rm1Trend, repCompletionRate })).not.toBeNull()
            said++
            silent++
          }
    expect(said).toBe(silent)
    expect(said).toBeGreaterThan(0)
  })
})

describe('no number of the plan moves (#4079)', () => {
  const sigs: AutoregExerciseSignal[] = [
    { ...tap(1), sessionExerciseId: 'harder-met' },
    { ...tap(-1, { repCompletionRate: 0.8 }), sessionExerciseId: 'easier-missed' },
    { ...tap(1, { repCompletionRate: 0.7 }), sessionExerciseId: 'harder-missed' },
    { ...tap(-1), sessionExerciseId: 'easier-met' },
  ]
  const exercises = sigs.map(s => ({ sessionExerciseId: s.sessionExerciseId, sets: 3, reps: 6, pct: 77.5 }))

  it('applyAutoregulation returns the same sets, reps and loads whether or not a sentence was written', () => {
    for (const phase of ['accumulation', 'realisation', 'deload', 'baseline']) {
      const withTap = applyAutoregulation(exercises, sigs, 'strength', phase)
      // The same signals without the new field: what `main` ran.
      const asMain = applyAutoregulation(exercises, sigs.map(({ effortAnswer: _a, ...s }) => s), 'strength', phase)
      expect(withTap.exercises).toEqual(asMain.exercises)
      expect([...withTap.earnedSetIds]).toEqual([...asMain.earnedSetIds])
      // Where main wrote a note, so does this, word for word.
      for (const [id, text] of Object.entries(asMain.notes)) expect(withTap.notes[id]).toBe(text)
    }
  })

  it('the sentence lands on the lift the rule left alone and nowhere else', () => {
    const out = applyAutoregulation(exercises, sigs, 'strength', 'accumulation')
    expect(out.notes['harder-met']).toBe(`You said it felt harder. Your logged reps were on target, ${TAIL}`)
    expect(out.notes['easier-missed']).toBe(`You said it felt easier, but your logged reps fell short of your target, ${TAIL}`)
    expect(out.notes['harder-missed']).toMatch(/^−\d/) // the cut's own note, untouched
    expect(out.notes['easier-met']).toMatch(/^\+1 target rep/) // the push's own note, untouched
  })

  it('a lift with no signal row, or a signal without a tap, has no note', () => {
    const out = applyAutoregulation(
      [{ sessionExerciseId: 'x', sets: 3, reps: 6, pct: 70 }, { sessionExerciseId: 'y', sets: 3, reps: 6, pct: 70 }],
      [{ sessionExerciseId: 'y', role: 'primary', rpeDelta: 1, rm1Trend: 'flat', repCompletionRate: 1 }],
      'strength', 'accumulation',
    )
    expect(out.notes).toEqual({})
  })
})
