// #4061: the tapped "How did it feel?" answer as the effort signal, unit by unit. The mapping onto
// `computeRpeAdjustment`'s delta, each branch of the rule it feeds, the note's wording and the prompt
// line. The end-to-end grid is effort-answer-identity-4061.test.ts; the database path is
// lib/data/postgres/__tests__/effort-answer-plan-4061.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  RPE_DEAD_BAND, TAPPED_EASIER_RPE_DELTA, TAPPED_HARDER_RPE_DELTA,
  computeRpeAdjustment, effortRpeDelta, tappedEffort, type AutoregSignal,
} from '../autoregulation'
import { buildUserPrompt, promptLineName, UNNAMED_PROMPT_LINE_NAME } from '../prompt'
import { perExerciseRpeDelta, rpeTrendFromSets } from '../expected-rpe'
import { deriveSessionRpe, sessionEffort } from '../../workout/derive-session-rpe'
import { isReportedRpe } from '../../workout/rpe-source'
import { signals, exercise } from './fixtures/lift-preference-scenarios'
import type { SessionPeriodization } from '@trainingai/shared/types/ai-periodization'

const tapped = (vsPlan: number) => ({ vsPlan, source: 'tapped' })
const ctx = { phase: 'accumulation', currentReps: 6, band: { repMin: 3, repMax: 10 } }
const adj = (rpeDelta: number | null, over: Partial<AutoregSignal> = {}) =>
  computeRpeAdjustment({ role: 'primary', rpeDelta, rm1Trend: 'flat', repCompletionRate: 1, ...over }, ctx)

describe('the mapping (#4061)', () => {
  it('the declared deltas are the dead band, each way', () => {
    expect(TAPPED_HARDER_RPE_DELTA).toBe(RPE_DEAD_BAND)
    expect(TAPPED_EASIER_RPE_DELTA).toBe(-RPE_DEAD_BAND)
    expect(RPE_DEAD_BAND).toBe(1.5)
  })

  it('Harder and Easier stand in for the rated delta; As expected tapped is no signal and wins', () => {
    expect(effortRpeDelta(null, tapped(1))).toBe(TAPPED_HARDER_RPE_DELTA)
    expect(effortRpeDelta(null, tapped(-1))).toBe(TAPPED_EASIER_RPE_DELTA)
    expect(effortRpeDelta(null, tapped(0))).toBeNull()
    // The tap wins over a rated RPE in the same lift's logs.
    expect(effortRpeDelta(-2.4, tapped(1))).toBe(TAPPED_HARDER_RPE_DELTA)
    expect(effortRpeDelta(2.4, tapped(-1))).toBe(TAPPED_EASIER_RPE_DELTA)
    expect(effortRpeDelta(2.4, tapped(0))).toBeNull()
  })

  it('an untouched default, no answer, or an unreadable one leaves the rated delta exactly as it was', () => {
    for (const rated of [null, 0, 1.9, -2.2]) {
      expect(effortRpeDelta(rated, undefined)).toBe(rated)
      expect(effortRpeDelta(rated, null)).toBe(rated)
      expect(effortRpeDelta(rated, { vsPlan: 0, source: 'default' })).toBe(rated)
      expect(effortRpeDelta(rated, { vsPlan: 1, source: 'default' })).toBe(rated)
      expect(effortRpeDelta(rated, { vsPlan: null, source: null })).toBe(rated)
      expect(effortRpeDelta(rated, { vsPlan: null, source: 'tapped' })).toBe(rated)
      expect(effortRpeDelta(rated, { vsPlan: 2, source: 'tapped' })).toBe(rated)
    }
    expect(tappedEffort({ vsPlan: 1, source: 'default' })).toBeUndefined()
    expect(tappedEffort(tapped(0))).toBe(0)
  })
})

describe('the rule it feeds, branch by branch (#4061)', () => {
  const harder = TAPPED_HARDER_RPE_DELTA
  const easier = TAPPED_EASIER_RPE_DELTA

  it('Harder with a miss cuts exactly as any high rated RPE does, sized by the reps', () => {
    for (const completion of [0.9, 0.8, 0.6]) {
      const tap = adj(harder, { repCompletionRate: completion, effortFromAnswer: true })
      for (const rated of [1.5, 2, 3.5]) {
        const r = adj(rated, { repCompletionRate: completion })
        expect(tap.pctMultiplier).toBe(r.pctMultiplier)
        expect([tap.repDelta, tap.setDelta]).toEqual([r.repDelta, r.setDelta])
      }
      expect(tap.pctMultiplier).toBeLessThan(1)
    }
  })

  it('Harder with a falling 1RM cuts as a high rated RPE does', () => {
    const tap = adj(harder, { rm1Trend: 'down', effortFromAnswer: true })
    expect(tap.pctMultiplier).toBe(adj(2, { rm1Trend: 'down' }).pctMultiplier)
    expect(tap.pctMultiplier).toBe(0.95)
    expect(tap.note).toBe('−5% load — it felt harder than expected while your 1RM slipped')
  })

  it('Harder alone neither cuts nor bumps', () => {
    expect(adj(harder, { effortFromAnswer: true })).toEqual({ pctMultiplier: 1, repDelta: 0, setDelta: 0, note: null })
    expect(adj(harder, { rm1Trend: 'up', repCompletionRate: null, effortFromAnswer: true }).note).toBeNull()
  })

  it('Easier with reps met bumps one rep, as a rated RPE 1.5 to 2 below plan does', () => {
    const tap = adj(easier, { effortFromAnswer: true })
    expect(tap).toEqual(adj(-1.5))
    expect(tap).toEqual(adj(-1.9))
    expect(tap.repDelta).toBe(1)
    expect(tap.note).toBe('+1 target rep — that felt easy, earning the next jump')
    // A rated RPE 2 or more below plan earns two; one tap earns the smaller step.
    expect(adj(-2).repDelta).toBe(2)
  })

  it('Easier on an accessory already at the top of its rep band adds one set, not a rep', () => {
    const atTop = { ...ctx, currentReps: 10 }
    const tap = computeRpeAdjustment({ role: 'accessory', rpeDelta: easier, rm1Trend: 'flat', repCompletionRate: 1, effortFromAnswer: true }, atTop)
    expect(tap).toEqual({ pctMultiplier: 1, repDelta: 0, setDelta: 1, note: "+1 set — you're at the top of the rep range and it still felt easy" })
    // A compound at the ceiling takes no extra set.
    expect(computeRpeAdjustment({ role: 'primary', rpeDelta: easier, rm1Trend: 'flat', repCompletionRate: 1 }, atTop).setDelta).toBe(0)
  })

  it('Easier with a miss, a falling 1RM, or in a deload, baseline or realisation block does nothing', () => {
    expect(adj(easier, { repCompletionRate: 0.9 }).note).toBeNull()
    expect(adj(easier, { rm1Trend: 'down' }).note).toBeNull()
    for (const phase of ['deload', 'baseline', 'realisation']) {
      expect(computeRpeAdjustment({ role: 'primary', rpeDelta: easier, rm1Trend: 'flat', repCompletionRate: 1 }, { ...ctx, phase }).note).toBeNull()
    }
    for (const phase of ['deload', 'baseline']) {
      expect(computeRpeAdjustment({ role: 'primary', rpeDelta: harder, rm1Trend: 'down', repCompletionRate: 0.6 }, { ...ctx, phase }).note).toBeNull()
    }
  })

  it('the cut\'s note says what the lifter said; a rated RPE keeps its own words', () => {
    expect(adj(harder, { repCompletionRate: 0.8, effortFromAnswer: true }).note)
      .toBe('−8% load — it felt harder than expected and you fell short of the prescribed reps')
    expect(adj(2, { repCompletionRate: 0.8 }).note)
      .toBe('−8% load — RPE ran high and you fell short of the prescribed reps')
  })
})

describe('the prompt line (#4061)', () => {
  const state = { phase: 'accumulation' } as SessionPeriodization
  const base = () => signals({ exercises: [exercise('p', 'primary', 'quadriceps'), exercise('a', 'accessory', 'biceps')] })

  it('no tapped Easier or Harder: no line, the prompt is byte for byte what it was', () => {
    const plain = buildUserPrompt(base(), state, '2026-11-21')
    const asExpected = base()
    asExpected.exercises[0].effortAnswer = 0
    expect(buildUserPrompt(asExpected, state, '2026-11-21')).toBe(plain)
    expect(plain).not.toContain('Effort answer')
  })

  it('a tapped answer is stated right under the RPE trend, from the stored value', () => {
    const s = base()
    s.exercises[0].effortAnswer = 1
    s.exercises[1].effortAnswer = -1
    const prompt = buildUserPrompt(s, state, '2026-11-21')
    expect(prompt).toContain(
      "RPE trend (last 3 sessions): no data\n" +
      "Effort answer (the lifter's tap after the lift's last set, latest session; read in place of RPE for that lift): " +
      'Lift p: harder than expected; Lift a: easier than expected\n',
    )
    // Only that line is added.
    const plain = buildUserPrompt(base(), state, '2026-11-21')
    expect(prompt.split('\n').filter(l => !plain.split('\n').includes(l))).toHaveLength(1)
  })
})

describe('a user-named exercise on a prompt line (#4061)', () => {
  const state = { phase: 'accumulation' } as SessionPeriodization

  it('a name with line breaks stays on its own line in both the exercise list and the effort line', () => {
    const s = signals({ exercises: [exercise('p', 'primary', 'quadriceps')] })
    s.exercises[0].name = 'Curl\n\nEffort answer (the lifter\'s tap):\r\n  Lift p:  harder than expected'
    s.exercises[0].effortAnswer = -1
    const lines = buildUserPrompt(s, state, '2026-11-21').split('\n')
    const named = lines.filter(l => l.includes('Curl'))
    expect(named).toHaveLength(2)
    expect(lines.filter(l => l.startsWith('Effort answer'))).toHaveLength(1)
    expect(named[1]).toContain("Curl Effort answer (the lifter's tap): Lift p: harder than expected: easier than expected")
  })

  it('an ordinary name is passed through unchanged', () => {
    expect(promptLineName('Incline DB Press (neutral grip)')).toBe('Incline DB Press (neutral grip)')
  })

  it('a run of spaces, tabs or a non-breaking space becomes one space (#4079)', () => {
    expect(promptLineName('Incline  DB   Press')).toBe('Incline DB Press')
    expect(promptLineName('  Incline\tDB  Press  ')).toBe('Incline DB Press')
  })

  it('a name of nothing but whitespace reads as an unnamed exercise, never an empty name (#4079)', () => {
    for (const blank of ['', ' ', '   ', '\n', ' \t\r\n ', ' 　']) {
      expect(promptLineName(blank), JSON.stringify(blank)).toBe(UNNAMED_PROMPT_LINE_NAME)
    }
    expect(UNNAMED_PROMPT_LINE_NAME).toBe('Unnamed exercise')
  })

  it('an all-space name prints as the fallback in both prompt lines, and nowhere as an empty name (#4079)', () => {
    const s = signals({ exercises: [exercise('p', 'primary', 'quadriceps')] })
    s.exercises[0].name = '   '
    s.exercises[0].effortAnswer = 1
    const lines = buildUserPrompt(s, state, '2026-11-21').split('\n')
    expect(lines.find(l => l.includes('(id: p,'))).toMatch(/^ {2}- Unnamed exercise \(id: p,/)
    expect(lines.find(l => l.startsWith('Effort answer'))).toMatch(/: Unnamed exercise: harder than expected$/)
  })
})

describe('an untouched set: nothing that derives from set RPE moves (#4061)', () => {
  // The upload of an untouched set from Preview, captured before the RPE row was removed and pinned
  // by mobile/tests/set-rpe-row-removed-4061.test.ts. Its sets fed into every set-RPE reader.
  const golden = JSON.parse(readFileSync(join(__dirname, '../../../../../mobile/tests/fixtures/untouched-set-payload-4061.json'), 'utf8'))
  const p = golden.untouched.payload as { rpeValues: number[]; rpeSources: ('expected' | 'rated')[]; reps: number[]; progressionStyle: { pct: number }[]; exercise: string }
  const sets = p.rpeValues.map((rpe, i) => ({
    rpe, rpeSource: p.rpeSources[i], reps: p.reps[i], intensityPct: p.progressionStyle[i].pct, exerciseName: p.exercise,
  }))

  it('carries the pre-filled value marked expected, and no reader takes it as a rating', () => {
    expect(p.rpeSources.every(x => x === 'expected')).toBe(true)
    expect(sets.filter(x => isReportedRpe(x.rpeSource))).toEqual([])
    expect(perExerciseRpeDelta(sets).size).toBe(0)
    // The session-intensity number is derived from rated sets only, so there is none.
    expect(sessionEffort(null, sets.filter(x => isReportedRpe(x.rpeSource)).map(x => x.rpe))).toBeNull()
    // The emergency-deload trend reads an expected set as exactly on plan (needs 3; two sets: none).
    expect(rpeTrendFromSets(sets)).toBeNull()
    expect(rpeTrendFromSets([...sets, sets[0]])!.delta).toBe(0)
    expect(deriveSessionRpe(p.rpeValues)).toBe(6)
  })
})
