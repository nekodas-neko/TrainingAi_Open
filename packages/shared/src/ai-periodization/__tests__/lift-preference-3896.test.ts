// #3896 step 4: a lift's stored preference, enforced after the model. Each field on its own and
// combined, D3 (a phase change moves the effort, not the reps; the cap holds), D4 (the load at the new
// reps is what `pctForExpectedRpe` and `prescribedBar` give), autoregulation and the session read
// judging against the preferred range, deload and baseline left alone, and every bound.
// 0 real model calls: the model is a mock.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import {
  liftPreferenceFromRow, pctOnePlateStep, setsWithDelta, logMayConsumeOneShot, appliedAfterBudgetRest, ONE_SHOT_TTL_DAYS,
  preferredRepBand, applyLiftPreferenceToStyle, oneShotDue,
  PREFERENCE_REST_MAX_SEC, PREFERENCE_REST_MIN_SEC, type LiftPreference, type LiftPreferenceRow,
} from '../lift-preference'
import { preferredPct, roleTargetRpe, roleLoadCapPct, mainEffortCeiling } from '../lift-preference-plan'
import { intensityZoneForRole } from '../prompt'
import { expectedRpe, pctForExpectedRpe } from '../expected-rpe'
import { applyAutoregulation } from '../autoregulation'
import { prescribedBar, weightStepFor } from '../../workout/load-rounding'
import { sessionReadsFor } from '../session-read-plan'
import type { SessionReadLog, SessionReadSet } from '../session-read'
import { buildWorkoutExercises } from '../../workout/session-data'
import { SCENARIOS, SESSION_ID, fakeRepo, STATIC_SESSION, staticCtx, exercise, signals as signalsWith } from './fixtures/lift-preference-scenarios'
import type { PrescriptionSignals } from '../signals'

const SET_AT = new Date('2026-11-20T00:00:00Z')
const row = (over: Partial<LiftPreferenceRow>): LiftPreferenceRow => ({
  repMin: null, repMax: null, restSec: null, nextLoadStep: null, setsDelta: null, oneShotSetAt: null, ...over,
})
const pref = (over: Partial<LiftPreference>): LiftPreference => ({ repRange: null, restSec: null, oneShot: null, ...over })

// ── Bounds on the row: the table's CHECKs, applied again in code ──────────────────────────────────

describe('liftPreferenceFromRow: bounds in code, not trust in the table', () => {
  it('a row with nothing set is no preference', () => {
    expect(liftPreferenceFromRow(row({}))).toBeNull()
    expect(liftPreferenceFromRow(null)).toBeNull()
  })
  it('keeps a rep range only inside the CHECK limits (1 <= min <= max <= 30, both ends, integers)', () => {
    expect(liftPreferenceFromRow(row({ repMin: 10, repMax: 15 }))?.repRange).toEqual({ min: 10, max: 15 })
    expect(liftPreferenceFromRow(row({ repMin: 1, repMax: 30 }))?.repRange).toEqual({ min: 1, max: 30 })
    for (const bad of [{ repMin: 0, repMax: 5 }, { repMin: 5, repMax: 31 }, { repMin: 12, repMax: 10 },
      { repMin: 10, repMax: null }, { repMin: null, repMax: 10 }, { repMin: 8.5, repMax: 10 }]) {
      expect(liftPreferenceFromRow(row(bad))).toBeNull()
    }
  })
  it('holds a rest to what a prescription may carry (30-600 s) and drops a negative one', () => {
    expect(liftPreferenceFromRow(row({ restSec: 90 }))?.restSec).toBe(90)
    expect(liftPreferenceFromRow(row({ restSec: 5 }))?.restSec).toBe(PREFERENCE_REST_MIN_SEC)
    expect(liftPreferenceFromRow(row({ restSec: 3600 }))?.restSec).toBe(PREFERENCE_REST_MAX_SEC)
    expect(liftPreferenceFromRow(row({ restSec: -1 }))).toBeNull()
  })
  it('keeps a one-shot only with a known step or ±1 and a valid time', () => {
    expect(liftPreferenceFromRow(row({ nextLoadStep: 'lighter', oneShotSetAt: SET_AT }))?.oneShot)
      .toEqual({ loadStep: 'lighter', setsDelta: null, setAt: SET_AT })
    expect(liftPreferenceFromRow(row({ setsDelta: 1, oneShotSetAt: SET_AT }))?.oneShot?.setsDelta).toBe(1)
    expect(liftPreferenceFromRow(row({ nextLoadStep: 'much-lighter', oneShotSetAt: SET_AT }))).toBeNull()
    expect(liftPreferenceFromRow(row({ setsDelta: 2, oneShotSetAt: SET_AT }))).toBeNull()
    expect(liftPreferenceFromRow(row({ nextLoadStep: 'heavier', oneShotSetAt: null }))).toBeNull()
    expect(liftPreferenceFromRow(row({ nextLoadStep: 'heavier', oneShotSetAt: new Date('nope') }))).toBeNull()
  })
})

describe('the one-shot is due outside deload and baseline, and a log consumes it once', () => {
  const shot = pref({ oneShot: { loadStep: 'lighter', setsDelta: null, setAt: SET_AT } })
  it('is due in a normal session, not in a deload or a baseline', () => {
    expect(oneShotDue(shot, { deload: false, baseline: false })).not.toBeNull()
    expect(oneShotDue(shot, { deload: true, baseline: false })).toBeNull()
    expect(oneShotDue(shot, { deload: false, baseline: true })).toBeNull()
  })
  it('only a new, normal log may consume it; whether it carried this one-shot is decided by the write', () => {
    const base = { isNewLog: true, deloaded: false, baseline: false }
    expect(logMayConsumeOneShot(base)).toBe(true)
    expect(logMayConsumeOneShot({ ...base, isNewLog: false })).toBe(false) // a retry of a stored log
    expect(logMayConsumeOneShot({ ...base, deloaded: true })).toBe(false)
    expect(logMayConsumeOneShot({ ...base, baseline: true })).toBe(false)
  })
  it('expires after one named limit', () => {
    expect(ONE_SHOT_TTL_DAYS).toBe(14)
  })
})

// ── The plate step and the set bounds ─────────────────────────────────────────────────────────────

describe('one plate step (D5), through prescribedBar', () => {
  it('lighter is exactly one plate under the bar the pct gave, for a barbell and a cable', () => {
    for (const [equipment, basis, pct] of [[['barbell'], 140, 75], [['cable'], 63, 70], [['dumbbell'], 37, 72.5]] as const) {
      const bar = prescribedBar(basis, pct, [...equipment])!
      const stepped = pctOnePlateStep(pct, basis, [...equipment], 'lighter', 100)!
      expect(prescribedBar(basis, stepped, [...equipment])).toBe(bar - weightStepFor([...equipment]))
      const up = pctOnePlateStep(pct, basis, [...equipment], 'heavier', 100)!
      expect(prescribedBar(basis, up, [...equipment])).toBe(bar + weightStepFor([...equipment]))
    }
  })
  it('heavier never passes the cap: a step the cap blocks is not applied', () => {
    expect(pctOnePlateStep(80, 140, ['barbell'], 'heavier', 80)).toBeNull()
  })
  it('lighter never goes under the bar minimum, and no basis means no step', () => {
    expect(pctOnePlateStep(10, 40, ['cable'], 'lighter', 100)).toBeNull() // 40 x 10 % is already the 5 kg minimum
    expect(pctOnePlateStep(75, null, ['barbell'], 'lighter', 100)).toBeNull()
    expect(pctOnePlateStep(75, 0, ['barbell'], 'lighter', 100)).toBeNull()
  })
})

describe('±1 set is held to the role floor and the phase ceiling', () => {
  it('never under 2 sets, never over the role ceiling or the phase setsMax', () => {
    expect(setsWithDelta(3, -1, 'accessory')).toBe(2)
    expect(setsWithDelta(2, -1, 'accessory')).toBeNull()
    expect(setsWithDelta(4, 1, 'accessory')).toBeNull() // accessory ceiling 4
    expect(setsWithDelta(5, 1, 'primary')).toBe(6)
    expect(setsWithDelta(5, 1, 'primary', 5)).toBeNull() // accumulation setsMax 5
  })
  it('"one fewer" never adds a set: 1 with -1 is no change, not 2', () => {
    expect(setsWithDelta(1, -1, 'accessory')).toBeNull()
    expect(setsWithDelta(1, -1, 'primary')).toBeNull()
    expect(setsWithDelta(0, -1, 'accessory')).toBeNull() // never reaches 0, never "adds" one either
  })
  it('"one more" never removes a set: a count above the ceiling is no change, not a clamp down', () => {
    expect(setsWithDelta(6, 1, 'primary', 5)).toBeNull() // 6 against a phase maximum of 5 (was 5)
    expect(setsWithDelta(6, 1, 'accessory')).toBeNull() // 6 against an accessory ceiling of 4 (was 4)
  })
  it('the normal cases still move by exactly one', () => {
    expect(setsWithDelta(3, 1, 'accessory')).toBe(4)
    expect(setsWithDelta(4, -1, 'primary')).toBe(3)
    expect(setsWithDelta(3, -1, 'secondary')).toBe(2)
  })
})

// ── D3 and D4 ─────────────────────────────────────────────────────────────────────────────────────

describe('D4: the load at the new reps is the role\'s target effort, through pctForExpectedRpe and prescribedBar', () => {
  for (const role of ['primary', 'secondary', 'accessory']) {
    it(`${role}: preferredPct is pctForExpectedRpe(role target, reps), capped at the zone top`, () => {
      for (const reps of [6, 10, 12, 15]) {
        const want = Math.min(roleLoadCapPct('powerbuilding', 'accumulation', role),
          Math.max(40, pctForExpectedRpe(roleTargetRpe('powerbuilding', 'accumulation', role), reps)))
        expect(preferredPct('powerbuilding', 'accumulation', role, reps)).toBe(want)
      }
    })
  }
  it('the role targets are the ones generation already uses', () => {
    const z = intensityZoneForRole('powerbuilding', 'intensification', 'primary')
    expect(mainEffortCeiling('powerbuilding', 'intensification')).toBe(expectedRpe(z.pctMax, z.repMin))
    expect(roleTargetRpe('powerbuilding', 'intensification', 'primary')).toBe(expectedRpe(z.pctMax, z.repMin))
    expect(roleTargetRpe('powerbuilding', 'intensification', 'secondary'))
      .toBe(Math.min(8, expectedRpe(z.pctMax, z.repMin)))
  })
  it('more reps means a lighter bar at the same effort', () => {
    expect(preferredPct('powerbuilding', 'accumulation', 'secondary', 12))
      .toBeLessThan(preferredPct('powerbuilding', 'accumulation', 'secondary', 8))
  })
})

describe('D3: the reps stay the person\'s; the phase moves the effort, capped at the zone top', () => {
  it('the primary\'s effort and load rise through the block at the same reps, never past the zone top', () => {
    const phases = ['accumulation', 'intensification', 'realisation']
    const pcts = phases.map(ph => preferredPct('strength', ph, 'primary', 8))
    expect(pcts[1]).toBeGreaterThan(pcts[0])
    expect(pcts[2]).toBeGreaterThanOrEqual(pcts[1])
    phases.forEach((ph, i) => expect(pcts[i]).toBeLessThanOrEqual(intensityZoneForRole('strength', ph, 'primary').pctMax))
  })
  it('a low-rep preference on a heavy phase is held at the zone top, not above it', () => {
    const cap = intensityZoneForRole('strength', 'accumulation', 'primary').pctMax
    expect(preferredPct('strength', 'accumulation', 'primary', 2)).toBe(cap)
  })
})

// ── Autoregulation and the session read judge against the preferred range ─────────────────────────

describe('autoregulation does not fight the preference', () => {
  const easy = { sessionExerciseId: 'a', role: 'accessory', rpeDelta: -2, rm1Trend: 'up' as const, repCompletionRate: 1 }
  it('an easy session climbs inside the preferred range, past the goal band\'s top', () => {
    // Powerbuilding's accessory band tops out at 12; the lifter chose 12-15.
    const out = applyAutoregulation([{ sessionExerciseId: 'a', sets: 3, reps: 12, pct: 65 }],
      [{ ...easy, repBand: { repMin: 12, repMax: 15 } }], 'powerbuilding', 'accumulation')
    expect(out.exercises[0].reps).toBe(14)
  })
  it('and never climbs out of it', () => {
    const out = applyAutoregulation([{ sessionExerciseId: 'a', sets: 3, reps: 10, pct: 70 }],
      [{ ...easy, repBand: { repMin: 8, repMax: 10 } }], 'powerbuilding', 'accumulation')
    expect(out.exercises[0].reps).toBe(10)
  })
  it('without a band it is as before', () => {
    const out = applyAutoregulation([{ sessionExerciseId: 'a', sets: 3, reps: 12, pct: 65 }], [easy], 'powerbuilding', 'accumulation')
    expect(out.exercises[0].reps).toBe(12)
  })
  it('preferredRepBand swaps the band only when a range is set', () => {
    const band = { pctMin: 60, pctMax: 70, repMin: 8, repMax: 12 }
    expect(preferredRepBand(null, band)).toBe(band)
    expect(preferredRepBand(pref({ repRange: { min: 6, max: 8 } }), band)).toEqual({ ...band, repMin: 6, repMax: 8 })
  })
})

describe('the session read (#3889, shadow) takes its rep ceiling from the preference', () => {
  const set = (n: number): SessionReadSet => ({
    setNumber: n, reps: 10, weightKg: 45, plannedReps: 10, plannedWeightKg: 45, plannedPct: 75,
    restTimeSec: 90, plannedRestSec: 90, rpe: 5, rpeSource: 'rated', hr: null,
  })
  const log: SessionReadLog = {
    exerciseLogId: 'el-1', workoutSessionId: 'ws-1', programSessionId: 'ps', exerciseName: 'Lift a',
    loggedAt: new Date('2026-11-18T01:00:00Z'), estimated1rm: 60, exerciseDeloaded: false, exerciseType: 'weighted',
    session: { completed: true, isEarlyDeload: false, wasOverride: false, intensityMode: 'full', phaseType: 'normal', hrDense: null },
    effortVsPlan: null, effortSource: null, sets: [set(1), set(2), set(3)],
  }
  const session = { exercises: [{ id: 'se-a', sessionId: 'ps', exerciseName: 'Lift a', muscleGroups: [], position: 0, exerciseRole: 'accessory' as const }] }
  const opts = { programStart: new Date(0), trainingGoal: 'powerbuilding', equipment: {} }
  it('below the goal band\'s top it would add reps; at the lifter\'s chosen top it holds', () => {
    expect(sessionReadsFor(session, [log], opts)[0].verdict).toBe('progress-reps')
    const prefs = new Map([['Lift a', pref({ repRange: { min: 8, max: 10 } })]])
    expect(sessionReadsFor(session, [log], { ...opts, liftPreferences: prefs })[0].verdict).toBe('hold')
  })
})

// ── The static-style path: automatic phases, and ai_dynamic before the AI plan drives ──────────────

describe('the static-style path honours the preference', () => {
  const prefs = (p: LiftPreference) => new Map([['Lift s', p]])
  const find = (out: ReturnType<typeof buildWorkoutExercises>, name: string) => out.find(e => e.name === name)!

  it('rep range: reps clamped, load keeps the set\'s written effort, never heavier than written', () => {
    for (const mode of ['automatic', 'ai_dynamic'] as const) {
      const s = find(buildWorkoutExercises(STATIC_SESSION, staticCtx(mode, { liftPreferences: prefs(pref({ repRange: { min: 10, max: 12 } })) })), 'Lift s')
      // As written: 72.5 % x 8.
      expect(s.progressionStyle!.every(x => x.reps === 10)).toBe(true)
      const want = Math.min(72.5, pctForExpectedRpe(expectedRpe(72.5, 8), 10))
      expect(s.progressionStyle!.every(x => x.pct === want)).toBe(true)
      expect(want).toBeLessThan(72.5)
      expect(s.liftPreference).toEqual({ repRange: { min: 10, max: 12 } })
    }
  })
  it('fewer reps than written keep the written %, never heavier', () => {
    const s = find(buildWorkoutExercises(STATIC_SESSION, staticCtx('automatic', { liftPreferences: prefs(pref({ repRange: { min: 5, max: 6 } })) })), 'Lift s')
    expect(s.progressionStyle!.map(x => [x.reps, x.pct])).toEqual([[6, 72.5], [6, 72.5], [6, 72.5]])
  })
  it('rest, a lighter step and +1 set', () => {
    const p = pref({ restSec: 75, oneShot: { loadStep: 'lighter', setsDelta: 1, setAt: SET_AT } })
    const s = find(buildWorkoutExercises(STATIC_SESSION, staticCtx('automatic', { liftPreferences: prefs(p) })), 'Lift s')
    expect(s.defaultSets).toBe(4)
    expect(s.progressionStyle).toHaveLength(4)
    expect(s.progressionStyle!.every(x => x.restSec === 75)).toBe(true)
    // Basis 90 (last non-deload 1RM), cable: one 1.25 kg step under the written 72.5 %.
    const written = prescribedBar(90, 72.5, ['cable'])!
    expect(s.progressionStyle!.every(x => prescribedBar(90, x.pct, ['cable']) === written - 1.25)).toBe(true)
    expect(s.liftPreference).toEqual({ restSec: 75, loadStep: 'lighter', setsDelta: 1, oneShotSetAt: SET_AT.toISOString() })
  })
  it('a bodyweight lift keeps its load, takes the reps and rest', () => {
    const s = find(buildWorkoutExercises(STATIC_SESSION, staticCtx('automatic', {
      liftPreferences: new Map([['Lift b', pref({ repRange: { min: 12, max: 15 }, oneShot: { loadStep: 'heavier', setsDelta: null, setAt: SET_AT } })]]),
    })), 'Lift b')
    expect(s.progressionStyle!.map(x => [x.reps, x.pct])).toEqual([[12, 65], [12, 65], [12, 65]])
    expect(s.liftPreference).toEqual({ repRange: { min: 12, max: 15 } })
  })
  it('not in a baseline, a deload week, or a lift the AI plan drives', () => {
    const p = prefs(pref({ repRange: { min: 10, max: 12 } }))
    const base = buildWorkoutExercises(STATIC_SESSION, staticCtx('automatic'))
    expect(find(buildWorkoutExercises(STATIC_SESSION, staticCtx('automatic', { liftPreferences: p, isDeloadActive: true })), 'Lift s'))
      .toEqual(find(buildWorkoutExercises(STATIC_SESSION, staticCtx('automatic', { isDeloadActive: true })), 'Lift s'))
    expect(find(buildWorkoutExercises(STATIC_SESSION, staticCtx('automatic', { liftPreferences: p, isBaselinePhase: true })), 'Lift s'))
      .toEqual(find(buildWorkoutExercises(STATIC_SESSION, staticCtx('automatic', { isBaselinePhase: true })), 'Lift s'))
    const plan: AiPrescription = {
      phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: '', confidence: 0.8,
      estimatedSessionDurationMin: 40, weeklyVolumeContribution: {},
      exercises: [{ sessionExerciseId: 'se-s', name: 'Lift s', sets: 3, reps: 8, pct: 70, restSec: 120 }],
    }
    const driven = { aiDrivesLoad: true, aiPrescription: plan, aiPhaseLabel: 'Accumulation' }
    expect(find(buildWorkoutExercises(STATIC_SESSION, staticCtx('ai_dynamic', { ...driven, liftPreferences: p })), 'Lift s'))
      .toEqual(find(buildWorkoutExercises(STATIC_SESSION, staticCtx('ai_dynamic', driven)), 'Lift s'))
    expect(base).toHaveLength(4)
  })
  it('another lift\'s preference changes nothing here', () => {
    const out = buildWorkoutExercises(STATIC_SESSION, staticCtx('automatic', { liftPreferences: new Map([['Some Other Lift', pref({ repRange: { min: 15, max: 20 } })]]) }))
    expect(out).toEqual(buildWorkoutExercises(STATIC_SESSION, staticCtx('automatic')))
  })
  it('applyLiftPreferenceToStyle leaves an empty style alone', () => {
    expect(applyLiftPreferenceToStyle([], pref({ restSec: 60 }), { role: 'accessory', bodyweight: false, basisKg: 50 })).toBeNull()
  })
})

// ── Generation, with the model mocked ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  signals: null as unknown,
  model: null as Record<string, unknown> | null,
  prompts: [] as string[],
}))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async () => mocks.signals,
}))
vi.mock('ai', async importOriginal => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: async (args: { prompt: string }) => {
    mocks.prompts.push(args.prompt)
    if (!mocks.model) throw new Error('model unavailable (test)')
    return { object: structuredClone(mocks.model) }
  },
}))
vi.mock('@/lib/ai/instrument', () => ({
  loggedGenerateObject: async (_opts: unknown, run: (signal: undefined, settings: object) => Promise<unknown>) => run(undefined, {}),
}))
const { generatePrescriptionForSession } = await import('../generate-prescription')

type Ex = PrescriptionSignals['exercises'][number]
const withPref = (s: PrescriptionSignals, id: string, p: LiftPreference, basisKg: number | null = 100): PrescriptionSignals => ({
  ...s, exercises: s.exercises.map(e => e.sessionExerciseId === id ? { ...e, liftPreference: { preference: p, basisKg } } as Ex : e),
})
let n = 0
async function generate(scenarioIndex: number, sig?: PrescriptionSignals, phase?: string, preset?: 'short' | 'standard' | 'long'): Promise<AiPrescription> {
  const sc = SCENARIOS[scenarioIndex]
  mocks.signals = structuredClone(sig ?? sc.signals)
  mocks.model = sc.model
  mocks.prompts = []
  const stored: AiPrescription[] = []
  await generatePrescriptionForSession(`user-3896-pref-${++n}`, SESSION_ID, fakeRepo(phase ?? sc.phase, stored), 'Australia/Brisbane', undefined, preset)
  return stored[0]
}
const byId = (p: AiPrescription, id: string) => p.exercises.find(e => e.sessionExerciseId === id)!

describe('the AI path: the preference holds after the model, whatever it answered', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-21T02:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('rep range alone: the model\'s 8 reps on the secondary are clamped into 10-13; the load is D4\'s', async () => {
    const range = { min: 10, max: 13 }
    const base = await generate(0)
    const p = await generate(0, withPref(SCENARIOS[0].signals, 's', pref({ repRange: range })))
    const s = byId(p, 's')
    expect(s.reps).toBe(10)
    expect(s.pct).toBe(preferredPct('strength', 'accumulation', 'secondary', 10))
    expect(s.liftPreference).toEqual({ repRange: range })
    // The other lifts are as without the preference.
    expect(byId(p, 'p')).toEqual(byId(base, 'p'))
    // The model was told the range.
    expect(mocks.prompts[0]).toContain('rep_range: 10-13 (the lifter\'s choice for this lift; keep reps inside it)')
  })

  it('a model answer far outside the range is still clamped (no model number gates anything)', async () => {
    const sig = withPref(SCENARIOS[0].signals, 'a', pref({ repRange: { min: 15, max: 20 } }))
    const p = await generate(0, sig)
    expect(byId(p, 'a').reps).toBe(15)
    expect(byId(p, 'a').pct).toBe(preferredPct('strength', 'accumulation', 'accessory', 15))
  })

  it('rest alone: the preferred rest, nothing else moves', async () => {
    const base = await generate(0)
    const p = await generate(0, withPref(SCENARIOS[0].signals, 'a', pref({ restSec: 60 })))
    expect(byId(p, 'a')).toMatchObject({ ...byId(base, 'a'), restSec: 60, liftPreference: { restSec: 60 } })
  })

  it('lighter next time alone: one plate under the bar the plan would have given', async () => {
    const base = await generate(0)
    const shot = pref({ oneShot: { loadStep: 'lighter', setsDelta: null, setAt: SET_AT } })
    const p = await generate(0, withPref(SCENARIOS[0].signals, 'p', shot, 140))
    const was = prescribedBar(140, byId(base, 'p').pct, ['barbell'])!
    expect(prescribedBar(140, byId(p, 'p').pct, ['barbell'])).toBe(was - 2.5)
    expect(byId(p, 'p').liftPreference).toEqual({ loadStep: 'lighter', oneShotSetAt: SET_AT.toISOString() })
  })

  it('heavier next time is held to the zone top', async () => {
    // Primary at the strength accumulation top (77.5 %) cannot step heavier.
    const sig = withPref(SCENARIOS[0].signals, 'p', pref({ oneShot: { loadStep: 'heavier', setsDelta: null, setAt: SET_AT } }), 140)
    const model = structuredClone(SCENARIOS[0].model!) as { exercises: Array<{ pct: number; session_exercise_id: string }> }
    model.exercises[0].pct = 77.5
    const saved = SCENARIOS[0].model
    SCENARIOS[0].model = model as unknown as Record<string, unknown>
    try {
      const p = await generate(0, sig)
      expect(byId(p, 'p').pct).toBeLessThanOrEqual(intensityZoneForRole('strength', 'accumulation', 'primary').pctMax)
      expect(byId(p, 'p').liftPreference).toBeUndefined()
    } finally { SCENARIOS[0].model = saved }
  })

  it('+1 set alone: one more set than the plan, after the budget, and the session costed for it', async () => {
    const base = await generate(1)
    const p = await generate(1, withPref(SCENARIOS[1].signals, 's', pref({ oneShot: { loadStep: null, setsDelta: 1, setAt: SET_AT } })))
    expect(byId(p, 's').sets).toBe(byId(base, 's').sets + 1)
    expect(p.estimatedSessionDurationMin).toBeGreaterThan(base.estimatedSessionDurationMin)
    expect(byId(p, 's').liftPreference).toEqual({ setsDelta: 1, oneShotSetAt: SET_AT.toISOString() })
  })

  it('+1 set at the role and phase ceiling is not applied', async () => {
    // Scenario 0's accessory is at its ceiling of 4.
    const base = await generate(0)
    const p = await generate(0, withPref(SCENARIOS[0].signals, 'a', pref({ oneShot: { loadStep: null, setsDelta: 1, setAt: SET_AT } })))
    expect(byId(base, 'a').sets).toBe(4)
    expect(byId(p, 'a')).toEqual(byId(base, 'a'))
  })

  it('-1 set alone: one fewer set than the plan, after the budget, and the session costed for it', async () => {
    const base = await generate(0)
    const p = await generate(0, withPref(SCENARIOS[0].signals, 'a', pref({ oneShot: { loadStep: null, setsDelta: -1, setAt: SET_AT } })))
    expect(byId(p, 'a').sets).toBe(byId(base, 'a').sets - 1)
    expect(p.estimatedSessionDurationMin).toBeLessThanOrEqual(base.estimatedSessionDurationMin)
    expect(byId(p, 'a').liftPreference).toEqual({ setsDelta: -1, oneShotSetAt: SET_AT.toISOString() })
    // The re-fit baseline keeps the count before the one-shot, so a re-fit cannot apply it twice.
    expect(p.refitBaseline?.sets.a).toBe(base.refitBaseline?.sets.a)
  })

  it('all of them together', async () => {
    const all = pref({ repRange: { min: 12, max: 15 }, restSec: 75, oneShot: { loadStep: 'lighter', setsDelta: -1, setAt: SET_AT } })
    const base = await generate(0)
    const p = await generate(0, withPref(SCENARIOS[0].signals, 's', all, 90))
    const s = byId(p, 's')
    expect(s.reps).toBe(12)
    expect(s.restSec).toBe(75)
    expect(s.sets).toBe(byId(base, 's').sets - 1)
    const d4 = preferredPct('strength', 'accumulation', 'secondary', 12)
    expect(prescribedBar(90, s.pct, ['cable'])).toBe(prescribedBar(90, d4, ['cable'])! - 1.25)
    expect(s.liftPreference).toEqual({ repRange: { min: 12, max: 15 }, restSec: 75, loadStep: 'lighter', setsDelta: -1, oneShotSetAt: SET_AT.toISOString() })
  })

  it('D3 through generation: the same reps in a later phase, a heavier load, inside the zone', async () => {
    const range = { min: 8, max: 8 }
    const acc = byId(await generate(1, withPref(signalsWith({ ...SCENARIOS[1].signals, phase: 'accumulation' }), 'p', pref({ repRange: range })), 'accumulation'), 'p')
    const int = byId(await generate(1, withPref(SCENARIOS[1].signals, 'p', pref({ repRange: range }))), 'p')
    expect(acc.reps).toBe(8)
    expect(int.reps).toBe(8)
    expect(int.pct).toBeGreaterThanOrEqual(acc.pct)
    expect(int.pct).toBeLessThanOrEqual(intensityZoneForRole('powerbuilding', 'intensification', 'primary').pctMax)
  })

  it('autoregulation climbs inside the range for an easy accessory, not out of it', async () => {
    // Scenario 1's accessory felt easy (rpeDelta -1.6, met reps): +1 rep. Range 9-10 stops it at 10.
    const p = await generate(1, withPref(SCENARIOS[1].signals, 'a', pref({ repRange: { min: 9, max: 10 } })))
    expect(byId(p, 'a').reps).toBe(10)
    const q = await generate(1, withPref(SCENARIOS[1].signals, 'a', pref({ repRange: { min: 9, max: 9 } })))
    expect(byId(q, 'a').reps).toBe(9)
  })

  it('a per-exercise deload is untouched by the lift\'s preference', async () => {
    const base = await generate(2)
    const p = await generate(2, withPref(SCENARIOS[2].signals, 'a', pref({ repRange: { min: 15, max: 20 }, restSec: 45 })))
    expect(byId(p, 'a')).toEqual(byId(base, 'a'))
    expect(byId(p, 'a').deloaded).toBe(true)
  })

  it('the rules fallback honours it', async () => {
    const p = await generate(3, withPref(SCENARIOS[3].signals, 'a', pref({ repRange: { min: 12, max: 15 }, restSec: 60 })))
    expect(p.source).toBe('rules')
    expect(byId(p, 'a')).toMatchObject({ reps: 12, restSec: 60, pct: preferredPct('strength', 'accumulation', 'accessory', 12) })
  })

  it('a deload phase is exactly as without the preference, prompt included', async () => {
    const base = await generate(4)
    const basePrompt = mocks.prompts[0]
    const all = pref({ repRange: { min: 12, max: 15 }, restSec: 60, oneShot: { loadStep: 'heavier', setsDelta: 1, setAt: SET_AT } })
    const p = await generate(4, withPref(SCENARIOS[4].signals, 'a', all))
    expect(p).toEqual(base)
    expect(mocks.prompts[0]).toBe(basePrompt)
  })

  it('the primary keeps its anchor: a lighter role never out-loads it whatever its preference', async () => {
    const p = await generate(0, withPref(SCENARIOS[0].signals, 'a', pref({ repRange: { min: 1, max: 2 } })))
    expect(byId(p, 'a').pct).toBeLessThanOrEqual(byId(p, 'p').pct)
  })
})

describe('a budget re-fit keeps a one-shot set the plan applied, once', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-21T02:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('re-fitting to the same length gives the same count; re-fitting twice does not add it twice', async () => {
    const { refitPrescriptionToBudget } = await import('../refit-prescription')
    const plan = await generate(1, withPref(SCENARIOS[1].signals, 's', pref({ oneShot: { loadStep: null, setsDelta: 1, setAt: SET_AT } })))
    mocks.signals = structuredClone(SCENARIOS[1].signals) // a re-fit reads no preference: it reads the plan's record
    let current = plan
    const stored: AiPrescription[] = []
    const repo = fakeRepo('intensification', stored, {
      getSessionPeriodization: async () => ({
        phase: 'intensification', phaseStartedAt: new Date(0), prescription: current, prescriptionStatus: 'pending',
        prescriptionExpiresAt: new Date('2026-11-28T00:00:00Z'),
      }),
    })
    const once = await refitPrescriptionToBudget('u', SESSION_ID, repo, 'Australia/Brisbane', 'standard')
    expect(once.ok).toBe(true)
    if (!once.ok) return
    expect(byId(once.prescription, 's').sets).toBe(byId(plan, 's').sets)
    current = once.prescription
    const twice = await refitPrescriptionToBudget('u', SESSION_ID, repo, 'Australia/Brisbane', 'standard')
    expect(twice.ok && byId(twice.prescription, 's').sets).toBe(byId(plan, 's').sets)
  })
})

describe('a rest the time budget shortened is not recorded as the preferred rest (fix 3)', () => {
  it('the record keeps restSec only while the final rest is that rest', () => {
    expect(appliedAfterBudgetRest({ restSec: 120, repRange: { min: 10, max: 12 } }, 120)).toEqual({ restSec: 120, repRange: { min: 10, max: 12 } })
    expect(appliedAfterBudgetRest({ restSec: 120, repRange: { min: 10, max: 12 } }, 90)).toEqual({ repRange: { min: 10, max: 12 } })
    expect(appliedAfterBudgetRest({ restSec: 120 }, 90)).toBeUndefined()
    expect(appliedAfterBudgetRest(undefined, 90)).toBeUndefined()
    expect(appliedAfterBudgetRest({ loadStep: 'lighter' }, 90)).toEqual({ loadStep: 'lighter' })
  })

  it('a shorter session: the budget wins and the stored plan does not claim the preferred rest', async () => {
    const full = await generate(0, withPref(SCENARIOS[0].signals, 'a', pref({ restSec: 120 })), undefined, 'standard')
    expect(byId(full, 'a')).toMatchObject({ restSec: 120, liftPreference: { restSec: 120 } })
    const short = await generate(0, withPref(SCENARIOS[0].signals, 'a', pref({ restSec: 120 })), undefined, 'short')
    expect(byId(short, 'a').restSec).toBeLessThan(120) // an accessory's rest is cut a quarter on a short day
    expect(byId(short, 'a').liftPreference?.restSec).toBeUndefined()
  })

  it('a re-fit to a shorter day drops the claim too, and keeps it when the rest is unchanged', async () => {
    const { refitPrescriptionToBudget } = await import('../refit-prescription')
    const plan = await generate(0, withPref(SCENARIOS[0].signals, 'a', pref({ restSec: 120 })), undefined, 'standard')
    mocks.signals = structuredClone(SCENARIOS[0].signals)
    const stored: AiPrescription[] = []
    const repo = fakeRepo(SCENARIOS[0].phase, stored, {
      getSessionPeriodization: async () => ({
        phase: SCENARIOS[0].phase, phaseStartedAt: new Date(0), prescription: plan, prescriptionStatus: 'pending',
        prescriptionExpiresAt: new Date('2026-11-28T00:00:00Z'),
      }),
    })
    const same = await refitPrescriptionToBudget('u', SESSION_ID, repo, 'Australia/Brisbane', 'standard')
    expect(same.ok && byId(same.prescription, 'a').liftPreference?.restSec).toBe(120)
    const short = await refitPrescriptionToBudget('u', SESSION_ID, repo, 'Australia/Brisbane', 'short')
    expect(short.ok).toBe(true)
    if (!short.ok) return
    expect(byId(short.prescription, 'a').restSec).toBeLessThan(120)
    expect(byId(short.prescription, 'a').liftPreference?.restSec).toBeUndefined()
  })
})

describe('loadLiftPreferences: one read, bounded, and a failure plans as written', () => {
  it('bounds each row and drops a row with nothing usable', async () => {
    const { loadLiftPreferences } = await import('../lift-preference-read')
    const repo = { listExercisePreferences: async () => new Map([
      ['Lift a', row({ repMin: 10, repMax: 12 })],
      ['Lift b', row({ repMin: 12, repMax: 10 })],
    ]) } as never
    const got = await loadLiftPreferences(repo, 'u', ['Lift a', 'Lift b'])
    expect([...got.keys()]).toEqual(['Lift a'])
  })
  it('a repository without the method, or a failed read, gives no preferences', async () => {
    const { loadLiftPreferences } = await import('../lift-preference-read')
    expect((await loadLiftPreferences({} as never, 'u', ['Lift a'])).size).toBe(0)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = { listExercisePreferences: async () => { throw new Error('db down') } } as never
    expect((await loadLiftPreferences(failing, 'u', ['Lift a'])).size).toBe(0)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('reads the bar basis only for a lift with a plate step, by the screen\'s resolver', async () => {
    const { liftPreferenceBases } = await import('../lift-preference-read')
    const calls: string[][] = []
    const repo = {
      getLastRealOneRmBatch: async (_u: string, names: string[]) => { calls.push(names); return new Map([['Lift a', { estimated1rm: 120 }]]) },
      getExerciseEstimates: async () => [{ exerciseName: 'Lift a', estimated1rm: 150 }],
    } as never
    const prefs = new Map([
      ['Lift a', pref({ oneShot: { loadStep: 'lighter', setsDelta: null, setAt: SET_AT } })],
      ['Lift b', pref({ repRange: { min: 8, max: 10 } })],
    ])
    const got = await liftPreferenceBases(repo, 'u', prefs, new Map())
    expect(calls).toEqual([['Lift a']])
    expect(got.get('Lift a')).toBe(120) // the last non-deload 1RM wins over a seed, as on the screen
    expect((await liftPreferenceBases(repo, 'u', new Map([['Lift b', prefs.get('Lift b')!]]), new Map())).size).toBe(0)
  })
})

describe('signal fixtures', () => {
  it('a lift built without a preference carries no preference key', () => {
    expect('liftPreference' in exercise('x', 'primary', 'chest')).toBe(false)
  })
})
