// OR-210. One band, one baselining rule.
//
// (b) The chat tool returned a raw ratio over a 56-day window and left the banding to the model; the
//     Health card bands a 28-day window. Measured on the owner's data, 32 of his last 76 days
//     disagreed. They now call one builder, and this runs both on the same data.
// (c) Program-age baselining had three rules: the route fell back to `createdAt`; readiness and the
//     score audit read `startedAt` alone and treated a missing one as infinitely old; signals, chat
//     and running asked nothing. The owner's active program has `started_at = NULL`, which is how
//     July's early-deload card ran on live ACWR while the Health card said "baselining".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACWR_BASELINE_DAYS, acwrBaselineDaysRemaining, programAgeDays, trainingLoadBand, computeVolumeAcwr,
} from '@trainingai/shared/ai-periodization/acwr'
import { buildChatTools } from '@/lib/ai-chat/tools'
import type { WorkoutRepository } from '@/lib/data/repository'

const ASOF = new Date('2026-10-05T00:00:00.000Z')
const daysBefore = (d: number) => new Date(ASOF.getTime() - d * 86_400_000)

describe('programAgeDays / acwrBaselineDaysRemaining', () => {
  it('uses startedAt, else createdAt, and is null for no program or no usable date', () => {
    expect(programAgeDays({ startedAt: daysBefore(40), createdAt: daysBefore(5) }, ASOF)).toBe(40)
    expect(programAgeDays({ startedAt: null, createdAt: daysBefore(5) }, ASOF)).toBe(5)
    expect(programAgeDays({ startedAt: undefined, createdAt: daysBefore(5).toISOString() }, ASOF)).toBe(5)
    expect(programAgeDays(null, ASOF)).toBeNull()
    expect(programAgeDays({}, ASOF)).toBeNull()
    expect(programAgeDays({ createdAt: 'not a date' }, ASOF)).toBeNull()
  })

  // The owner's active program: started_at NULL, created 28 d 8 h before the morning this was found.
  it('does not treat a program with no start date as infinitely old', () => {
    expect(acwrBaselineDaysRemaining({ startedAt: null, createdAt: daysBefore(27.5) }, ASOF)).toBe(1)
    expect(acwrBaselineDaysRemaining({ startedAt: null, createdAt: daysBefore(5) }, ASOF)).toBe(23)
  })

  it('is valid from exactly 28 days on, and withholds nothing without a program to judge', () => {
    expect(ACWR_BASELINE_DAYS).toBe(28)
    expect(acwrBaselineDaysRemaining({ createdAt: daysBefore(28) }, ASOF)).toBe(0)
    expect(acwrBaselineDaysRemaining({ createdAt: daysBefore(27) }, ASOF)).toBe(1)
    expect(acwrBaselineDaysRemaining(null, ASOF)).toBe(0)
  })
})

describe('trainingLoadBand', () => {
  const load = (acwr: number | null) => ({ acwr, acuteLoadKg: 1000, chronicWeeklyAvgKg: 1000, dataSpanWeeks: 4, todayVolumeKg: 0, typicalSessionVolumeKg: 500 })
  const old = { createdAt: daysBefore(90) }

  it('says insufficient data first, then baselining, then the band', () => {
    expect(trainingLoadBand(load(null), { createdAt: daysBefore(3) }, ASOF).interpretation).toBe('insufficient_data')
    expect(trainingLoadBand(load(1.1), { createdAt: daysBefore(3) }, ASOF))
      .toMatchObject({ acwr: null, interpretation: 'baselining', baselineDaysRemaining: 25 })
    expect(trainingLoadBand(load(1.1), old, ASOF)).toMatchObject({ acwr: 1.1, interpretation: 'optimal' })
  })

  it('bands at the canonical boundaries', () => {
    for (const [v, key] of [[0.7, 'low'], [1.0, 'optimal'], [1.3, 'optimal'], [1.4, 'high'], [1.5, 'high'], [1.6, 'very_high']] as const) {
      expect(trainingLoadBand(load(v), old, ASOF).interpretation, String(v)).toBe(key)
    }
  })
})

describe('the Health route and the chat tool agree (OR-210 b)', () => {
  const TZ = 'Australia/Brisbane'
  const NOW = new Date('2026-10-05T02:00:00.000Z') // 12:00 Brisbane
  type Row = { startedAt: Date; volume: number }
  let sessions: Row[] = []
  let program: { startedAt?: string; createdAt: Date } | null = null

  const repo = {
    getSessionLoadsFrom: async (_u: string, from: Date) => sessions.filter(s => s.startedAt >= from),
    getActiveProgram: async () => program,
  } as unknown as WorkoutRepository

  vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } }) }))
  vi.mock('@/lib/data', () => ({ getRepository: async () => repoRef.current }))
  const repoRef = vi.hoisted(() => ({ current: null as unknown }))

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); repoRef.current = repo })
  afterEach(() => { vi.useRealTimers() })

  async function both() {
    const { GET } = await import('@/app/api/training-load/route')
    const route = await (await GET()).json() as { interpretation: string; acwr: number | null }
    const tools = buildChatTools(repo, 'u1', TZ, '2026-10-05')
    const tool = await tools.getTrainingLoadRisk.execute!({}, { toolCallId: 't', messages: [] }) as { interpretation: string; acwr: number | null }
    return { route, tool }
  }
  const at = (daysAgo: number, volume: number): Row => ({ startedAt: new Date(NOW.getTime() - daysAgo * 86_400_000), volume })

  // Heavy early in the 56 days, light lately: a 56-day chronic average and a 28-day one disagree,
  // which is exactly the window difference that put the tool and the card on different bands.
  it('agree on the same day, where the two windows would not have', async () => {
    sessions = [
      ...[54, 51, 48, 45, 42, 39, 36, 33, 30].map(d => at(d, 9000)),
      ...[26, 23, 20, 17, 14, 11, 8, 5, 2].map(d => at(d, 3000)),
    ]
    program = { createdAt: new Date(NOW.getTime() - 120 * 86_400_000) }
    const { route, tool } = await both()
    expect(tool.interpretation).toBe(route.interpretation)
    expect(tool.acwr).toBe(route.acwr)

    // The old tool's window, to prove this fixture actually separates the two readings.
    const old56 = computeVolumeAcwr(sessions.map(s => ({ startedAt: s.startedAt, volumeKg: s.volume })), new Date('2026-10-04T14:00:00.000Z')).acwr
    const win28 = computeVolumeAcwr(sessions.filter(s => s.startedAt >= new Date(NOW.getTime() - 28 * 86_400_000)).map(s => ({ startedAt: s.startedAt, volumeKg: s.volume })), new Date('2026-10-04T14:00:00.000Z')).acwr
    expect(old56).not.toBeCloseTo(win28 ?? 0, 1)
  })

  it('both say baselining for a program that started no more than 28 days ago, with a start date missing', async () => {
    sessions = [26, 23, 20, 17, 14, 11, 8, 5, 2].map(d => at(d, 3000))
    program = { createdAt: new Date(NOW.getTime() - 20 * 86_400_000) }
    const { route, tool } = await both()
    expect(route.interpretation).toBe('baselining')
    expect(tool.interpretation).toBe('baselining')
    expect(tool.acwr).toBeNull()
  })

  it('both say insufficient data with too little history', async () => {
    sessions = [at(2, 3000), at(5, 3000)]
    program = { createdAt: new Date(NOW.getTime() - 120 * 86_400_000) }
    const { route, tool } = await both()
    expect(route.interpretation).toBe('insufficient_data')
    expect(tool.interpretation).toBe('insufficient_data')
  })
})

describe('every ACWR consumer applies the one baselining rule (OR-210 c)', () => {
  const root = process.cwd()
  const callers = execFileSync('git', ['grep', '-l', 'computeVolumeAcwr(', '--', 'app', 'lib', 'packages', ':!*__tests__*'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(f => f && !f.endsWith('packages/shared/src/ai-periodization/acwr.ts'))

  it('finds the six consumers it is guarding, so it cannot pass over an empty list', () => {
    expect(callers.length).toBeGreaterThanOrEqual(6)
  })

  for (const file of callers) {
    it(`${file} gates on the shared helper`, () => {
      const src = readFileSync(join(root, file), 'utf8')
      expect(src, 'computes ACWR without the baselining rule').toMatch(/acwrBaselineDaysRemaining|trainingLoadBand/)
      // And does not re-derive program age by hand, the way two of them did.
      expect(src).not.toMatch(/programAgeMs|daysSinceStart/)
    })
  }
})
