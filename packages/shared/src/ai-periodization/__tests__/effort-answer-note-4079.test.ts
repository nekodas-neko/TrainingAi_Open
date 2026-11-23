// #4079: a tapped Harder or Easier the rule read and changed nothing for is said back in the lift's
// note. One test per sentence, one per case that must stay silent, and the guarantee that no number
// of the plan moves. The grid differential is effort-answer-identity-4061.test.ts (its #4079 block);
// the database path is lib/data/postgres/__tests__/effort-answer-note-4079.test.ts.
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

describe('the sentences (#4079)', () => {
  it('Harder, every rep done', () => {
    expect(note(tap(1))).toBe('You said it felt harder. You hit every rep, so the weight stays.')
  })
  it('Harder, within a rep of the target (the rule counts 95% as met)', () => {
    expect(note(tap(1, { repCompletionRate: 0.97 }))).toBe('You said it felt harder. You were within a rep of the target, so the weight stays.')
  })
  it('Harder, with no rep counts to check', () => {
    expect(note(tap(1, { repCompletionRate: null }))).toBe('You said it felt harder. There are no rep counts to check, so the weight stays.')
  })
  it('Easier, with a missed rep', () => {
    expect(note(tap(-1, { repCompletionRate: 0.9 }))).toBe('You said it felt easier, but a rep was missed, so nothing changes.')
  })
  it('Easier, with a falling 1RM', () => {
    expect(note(tap(-1, { rm1Trend: 'down' }))).toBe('You said it felt easier, but your 1RM slipped, so nothing changes.')
  })
  it('Easier, with no rep counts to check', () => {
    expect(note(tap(-1, { repCompletionRate: null }))).toBe('You said it felt easier. There are no rep counts to check, so nothing changes.')
  })
  it('Easier in a realisation phase (no rep pushes in a peak block)', () => {
    expect(note(tap(-1), ctxOf('realisation'))).toBe('You said it felt easier. Realisation does not add reps, so nothing changes.')
  })
  it('Easier on a compound at the top of its rep range', () => {
    expect(note(tap(-1), ctxOf('accumulation', 10))).toBe('You said it felt easier. You are at the top of the rep range, so nothing changes until your 1RM rises.')
  })
  it.each(['deload', 'baseline'])('either tap in a %s week', phase => {
    expect(note(tap(1), ctxOf(phase))).toBe(`You said it felt harder. This is a ${phase} week, so nothing changes.`)
    expect(note(tap(-1), ctxOf(phase))).toBe(`You said it felt easier. This is a ${phase} week, so nothing changes.`)
  })
  it('Harder in a realisation phase with every rep done is the ordinary Harder sentence (the rule cuts there too)', () => {
    expect(note(tap(1), ctxOf('realisation'))).toBe('You said it felt harder. You hit every rep, so the weight stays.')
  })
  it('every sentence is one sentence of plain words with no figure', () => {
    const all = [
      note(tap(1)), note(tap(1, { repCompletionRate: 0.97 })), note(tap(1, { repCompletionRate: null })),
      note(tap(-1, { repCompletionRate: 0.9 })), note(tap(-1, { rm1Trend: 'down' })), note(tap(-1, { repCompletionRate: null })),
      note(tap(-1), ctxOf('realisation')), note(tap(-1), ctxOf('accumulation', 10)), note(tap(1), ctxOf('deload')),
    ]
    for (const n of all) {
      expect(n).toMatch(/^You said it felt (harder|easier)[.,]/)
      expect(n!.replace('1RM', '')).not.toMatch(/\d/) // the only digit is the word 1RM
      expect(n!.endsWith('.')).toBe(true)
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
    expect(out.notes['harder-met']).toBe('You said it felt harder. You hit every rep, so the weight stays.')
    expect(out.notes['easier-missed']).toBe('You said it felt easier, but a rep was missed, so nothing changes.')
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
