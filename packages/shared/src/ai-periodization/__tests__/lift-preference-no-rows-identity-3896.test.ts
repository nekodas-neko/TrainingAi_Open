// #3896 step 4: "no plan changes until something writes a preference". Nothing writes
// `exercise_preferences` yet, so with no rows every prescription and every prompt must be what `main`
// produced before the reader existed. The golden file (fixtures/lift-preference-identity-3896.golden.json) was written by this test on `main`
// (ec5bc50e3) BEFORE the reader was added, and is compared byte for byte; it covers the AI path, the
// rules fallback (including a deload phase) and the static-style path in both phase modes.
// 0 real model calls: the model is a mock that records the prompt it was sent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import { SCENARIOS, SESSION_ID, fakeRepo, STATIC_SESSION, staticCtx } from './fixtures/lift-preference-scenarios'
import { buildWorkoutExercises } from '../../workout/session-data'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// The golden file is committed; a test may not write tracked source (LB-194). To re-record it on a
// tree you have checked is `main`, run with LIFT_PREF_RECORD=1: the outputs go to the gitignored
// `__check_fixture__/` beside this file, to be copied over the golden by hand.
const GOLDEN = join(__dirname, 'fixtures', 'lift-preference-identity-3896.golden.json')
const golden: Record<string, string> = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {}
const recorded: Record<string, string> = {}
function matchesMain(key: string, value: unknown) {
  const text = JSON.stringify(value, null, 2)
  recorded[key] = text
  if (process.env.LIFT_PREF_RECORD) {
    const dir = join(__dirname, '__check_fixture__')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'lift-preference-identity-3896.golden.json'), JSON.stringify(recorded, null, 2) + '\n')
    return
  }
  expect(golden[key], `no golden output recorded for ${key}`).toBeDefined()
  expect(text).toBe(golden[key])
}

const mocks = vi.hoisted(() => ({
  signals: null as unknown,
  model: null as Record<string, unknown> | null,
  prompts: [] as Array<{ system: string; prompt: string }>,
}))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async () => mocks.signals,
}))
vi.mock('ai', async importOriginal => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: async (args: { system: string; prompt: string }) => {
    mocks.prompts.push({ system: args.system, prompt: args.prompt })
    if (!mocks.model) throw new Error('model unavailable (test)')
    return { object: structuredClone(mocks.model) }
  },
}))
vi.mock('@/lib/ai/instrument', () => ({
  loggedGenerateObject: async (_opts: unknown, run: (signal: undefined, settings: object) => Promise<unknown>) => run(undefined, {}),
}))
const { generatePrescriptionForSession } = await import('../generate-prescription')

let n = 0
async function generateFor(i: number): Promise<{ stored: AiPrescription | undefined; prompt: { system: string; prompt: string } | undefined }> {
  const sc = SCENARIOS[i]
  mocks.signals = structuredClone(sc.signals)
  mocks.model = sc.model
  mocks.prompts = []
  const stored: AiPrescription[] = []
  await generatePrescriptionForSession(`user-3896-identity-${++n}`, SESSION_ID, fakeRepo(sc.phase, stored), 'Australia/Brisbane')
  return { stored: stored[0], prompt: mocks.prompts[0] }
}

describe('with no preference rows, the AI path and the rules fallback are unchanged from main', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-21T02:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  for (let i = 0; i < SCENARIOS.length; i++) {
    it(SCENARIOS[i].name, async () => {
      const out = await generateFor(i)
      expect(out.stored).toBeDefined()
      matchesMain(`ai:${i}`, out)
    })
  }
})

describe('with no preference rows, the static-style path is unchanged from main', () => {
  for (const mode of ['automatic', 'ai_dynamic'] as const) {
    it(`${mode}: the session as the workout screen receives it`, async () => {
      const out = buildWorkoutExercises(STATIC_SESSION, staticCtx(mode))
      matchesMain(`static:${mode}`, out)
    })
  }
})
