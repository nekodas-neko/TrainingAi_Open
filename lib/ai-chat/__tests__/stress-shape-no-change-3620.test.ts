// Issue 3620 — a refactor that must move nothing: the weekly digest's daytime-stress average and the
// coach's stress tool read daytime stress through the generic `DaytimeHighStress` shape a connector
// maps (`ouraDaytimeHighStress`), never Oura's own `stressHigh` field by name.
//
// `fixtures/no-change-3620.json` was recorded on `main` before either reader changed
// (RECORD_3620=1 writes a fresh copy to the temp dir); the refactor must reproduce it exactly. Model
// version strings are replaced by placeholders before anything is compared, so a version bump
// elsewhere is never read as an output change. Fixtures are seeded and the clock is fixed.
//
// The coach's data function runs directly through `buildChatTools(...).getRecoveryData.execute`. No
// model is called: `execute` is plain data code, and nothing here imports a model client.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { READINESS_MODEL_VERSION } from '@trainingai/shared/health/readiness-composite'
import { ACTIVITY_MODEL_VERSION } from '@trainingai/shared/health/activity-score'
import { SLEEP_SCORE_MODEL_VERSION } from '@trainingai/shared/health/sleep-score'
import { OURA_CLOUD_REKEY_DATE } from '@/lib/oura/cloud-freshness'
import type { WorkoutRepository } from '@/lib/data/repository'
import { buildChatTools } from '@/lib/ai-chat/tools'

let repo: Record<string, unknown>
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))

import { computeWeeklyDigestMetrics } from '@/app/api/weekly-digest/metrics'

const TZ = 'Australia/Brisbane'
// Wednesday. The digest's recap week is Mon 6 – Sun 12 July and the prior week 29 June – 5 July, so the
// re-key date (7 July) falls inside the recap week and both sides of it are read.
const NOW = new Date('2026-07-15T02:00:00Z')
const TODAY = '2026-07-15'
const FROM = '2026-06-29'
const TO = '2026-07-12'

const EXPECTED_PATH = join(__dirname, 'fixtures', 'no-change-3620.json')
const RECORD = process.env.RECORD_3620 === '1'
const recorded: Record<string, unknown> = {}

/** Model version strings out, so a bump is never an output change. */
function unversioned(value: unknown): unknown {
  let text = JSON.stringify(value) ?? 'null'
  for (const [v, tag] of [
    [READINESS_MODEL_VERSION, '<readiness-model-version>'],
    [ACTIVITY_MODEL_VERSION, '<activity-model-version>'],
    [SLEEP_SCORE_MODEL_VERSION, '<sleep-score-model-version>'],
  ] as const) text = text.split(v).join(tag)
  return JSON.parse(text)
}
function check(name: string, value: unknown) {
  const actual = unversioned(value)
  if (RECORD) { recorded[name] = actual; return }
  const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')) as Record<string, unknown>
  expect(expected[name], `${name} was recorded on main`).toBeDefined()
  expect(actual).toEqual(expected[name])
}
/** A bulky value as a digest of its unversioned form. */
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(unversioned(v))).digest('hex')

afterAll(() => {
  if (RECORD) writeFileSync(join(tmpdir(), 'no-change-3620.json'), JSON.stringify(recorded, null, 1) + '\n')
})

// Stress seconds as the source sent them: absent, null, 0, non-multiples of 60, a .5 minute that rounds
// up, a value above a waking span, and a negative.
const ABSENT = Symbol('absent')
const SECONDS: (number | null | typeof ABSENT)[] = [
  ABSENT, null, 0, 1, 29, 30, 31, 59, 60, 61, 89, 90, 91, 119, 150, 1799, 3600, 5400, 86_400, -30, -90,
]

function days(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = shiftDateStr(d, 1)) out.push(d)
  return out
}

/** One Oura row per date; the stress seconds cycle through every case, offset by `shift`. */
function ouraRows(shift: number, opts: { skip?: string[] } = {}) {
  return days(FROM, TO).filter(d => !opts.skip?.includes(d)).map((date, i) => {
    const s = SECONDS[(i + shift) % SECONDS.length]
    return { date, readinessScore: 70, sleepScore: 70, activityScore: 70, temperatureDeviation: 0.1,
      resilienceLevel: null, ...(s === ABSENT ? {} : { stressHigh: s }) }
  })
}

/** The app's own rollup rows (ring), some with stress minutes, some with a scaled level only. */
function derivedRows(kind: 'none' | 'minutes' | 'level' | 'mixed') {
  if (kind === 'none') return []
  return days(FROM, TO).flatMap((day, i) => {
    if (kind === 'minutes' && i % 3 !== 0) return []
    if (kind === 'level' && i % 2 !== 0) return []
    if (kind === 'mixed' && i % 4 === 3) return []
    const minutes = kind === 'level' || (kind === 'mixed' && i % 4 === 2) ? null : 20 + i * 7
    const level = kind === 'minutes' || (kind === 'mixed' && i % 4 === 1) ? null : -0.3 + (i % 5) * 0.1
    return [{ day, stressHighMinutes: minutes, daytimeStressScaled: level, resilienceLevel: null, readinessScore: null }]
  })
}

const SCENARIOS: { name: string; shift: number; derived: ReturnType<typeof derivedRows>; switchDay: string | null; skip?: string[] }[] = []
for (const shift of [0, 5, 11]) {
  for (const kind of ['none', 'minutes', 'level', 'mixed'] as const) {
    for (const switchDay of [null, '2026-07-03', OURA_CLOUD_REKEY_DATE, '2026-07-10']) {
      SCENARIOS.push({ name: `shift${shift}-${kind}-switch${switchDay ?? 'none'}`, shift, derived: derivedRows(kind), switchDay })
    }
  }
}
// Rows missing on the re-key date and on its neighbours.
SCENARIOS.push({ name: 'gaps', shift: 2, derived: derivedRows('none'), switchDay: null, skip: ['2026-07-06', '2026-07-07', '2026-07-08'] })

function stubRepo(s: (typeof SCENARIOS)[number], opts: { switchFails?: boolean } = {}) {
  return {
    getWorkoutSessionsFrom: async () => [],
    listBodyMetrics: async () => [],
    listSleepSessions: async () => [],
    listRecentPersonalRecords: async () => [],
    listExerciseLibrary: async () => [],
    getFriendIds: async () => [],
    getOuraDaily: async () => ouraRows(s.shift, { skip: s.skip }),
    getOuraDailyDerived: async () => s.derived,
    getOuraCloudSwitchDay: async () => { if (opts.switchFails) throw new Error('down'); return s.switchDay },
    listActivityLogs: async () => [],
  }
}

describe('daytime stress reads keep their output through the generic shape (#3620)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  it('the weekly digest: its stress block and a digest of the whole metrics, per scenario', async () => {
    const out: Record<string, unknown> = {}
    for (const s of SCENARIOS) {
      repo = stubRepo(s)
      const { metrics } = await computeWeeklyDigestMetrics('u1', TZ)
      out[s.name] = { stress: metrics.stressHighMinutes, metrics: digest(metrics) }
    }
    expect(Object.keys(out)).toHaveLength(SCENARIOS.length)
    check('weekly-digest', out)
  })

  it('the weekly digest, with the switch-day lookup failing', async () => {
    const out: Record<string, unknown> = {}
    for (const s of SCENARIOS.filter(x => x.shift === 0)) {
      repo = stubRepo(s, { switchFails: true })
      const { metrics } = await computeWeeklyDigestMetrics('u1', TZ)
      out[s.name] = { stress: metrics.stressHighMinutes, metrics: digest(metrics) }
    }
    check('weekly-digest-switch-fails', out)
  })

  it("the coach's getRecoveryData tool: its stress rows and a digest of the whole output, per scenario", async () => {
    const out: Record<string, unknown> = {}
    for (const s of SCENARIOS) {
      const tools = buildChatTools(stubRepo(s) as unknown as WorkoutRepository, 'u1', TZ, TODAY)
      const res = await tools.getRecoveryData.execute!({ fromDate: FROM, toDate: TO }, { toolCallId: 't1', messages: [] }) as { daytimeStress: unknown }
      out[s.name] = { daytimeStress: res.daytimeStress, output: digest(res) }
    }
    check('coach-recovery-tool', out)
  })

  it("the coach's label for Oura's rows stays 'oura' (the tool's output text is unchanged)", async () => {
    const s = SCENARIOS.find(x => x.name === 'shift0-none-switchnone')!
    const tools = buildChatTools(stubRepo(s) as unknown as WorkoutRepository, 'u1', TZ, TODAY)
    const res = await tools.getRecoveryData.execute!({ fromDate: FROM, toDate: TO }, { toolCallId: 't1', messages: [] }) as { daytimeStress: { source: string }[] }
    expect(res.daytimeStress.length).toBeGreaterThan(0)
    expect(new Set(res.daytimeStress.map(r => r.source))).toEqual(new Set(['oura']))
  })
})
