/**
 * LA-135 — the calibration panel used to compute one correlation over a window that could span
 * several models, and say nothing about it.
 *
 * `model_version` was written on every `body_battery_daily` row since the table existed and read by
 * nothing. Measured in production 2026-09-24: four generations stored, and the v4 → v5 boundary
 * alone moves the mean end-of-day value 62.9 → 15.2. CLAUDE.md's own rule is that a correlation
 * across a model change is not evidence.
 *
 * **The window is deliberately NOT narrowed.** Filtering to the newest generation would answer a
 * narrower question than the caller asked and give no sign it had done so — a 90-day request coming
 * back over a handful of rows. The census ships beside the headline figure instead, and a spanning
 * window additionally gets a calibration per generation.
 *
 * Not exercised: the calibration builder itself is a stand-in, as in its sibling suite. What is
 * asserted is which rows reach it and what the route says about them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const getBodyBatteryHistory = vi.fn(async (..._a: unknown[]) => [] as Row[])
const listDayCheckins = vi.fn(async (..._a: unknown[]) => [] as Row[])
const buildBatteryRecoveryCalibration = vi.fn((i: Row) => ({
  from: 'x', to: 'y', rows: [],
  // Echoed so each call's input is visible in the response it produced.
  seenDates: [...((i.batteryByDate as Map<string, unknown>)?.keys() ?? [])],
}))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', isAdmin: true } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/observability', () => ({ reportServerError: () => undefined }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getUserById,
    getBodyBatteryHistory: (...a: unknown[]) => getBodyBatteryHistory(...a),
    listDayCheckins: (...a: unknown[]) => listDayCheckins(...a),
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@trainingai/shared/health/battery-recovery-calibration', () => ({
  buildBatteryRecoveryCalibration: (i: Row) => buildBatteryRecoveryCalibration(i),
}))

import { GET } from '@/app/api/admin/battery-recovery-calibration/route'

const call = async () => {
  const { NextRequest } = await import('next/server')
  const res = await GET(new NextRequest('http://localhost/api/admin/battery-recovery-calibration'))
  return res.json() as Promise<Row>
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserById.mockResolvedValue({ isAdmin: true })
  listDayCheckins.mockResolvedValue([])
})

describe('the calibration panel names the models behind its number (LA-135)', () => {
  it('reports a single generation and does not split the window', async () => {
    getBodyBatteryHistory.mockResolvedValue([
      { date: '2026-09-22', endValue: 40, modelVersion: 'v6:rest0.05:chg0.12' },
      { date: '2026-09-23', endValue: 55, modelVersion: 'v6:rest0.05:chg0.12' },
    ])
    const body = await call()
    expect(body.models).toEqual([{ generation: 'v6', days: 2 }])
    expect(body.spansModelChange).toBe(false)
    expect(body.byModel).toBeNull()
    // One call only — a window that does not span must not pay for a per-generation pass.
    expect(buildBatteryRecoveryCalibration).toHaveBeenCalledTimes(1)
  })

  it('flags a window that spans a boundary, and still computes over every day in it', async () => {
    getBodyBatteryHistory.mockResolvedValue([
      { date: '2026-08-02', endValue: 61, modelVersion: 'v4:rest0.05' },
      { date: '2026-08-05', endValue: 12, modelVersion: 'v5:rest0.05' },
      { date: '2026-08-06', endValue: 0, modelVersion: 'v5:rest0.05' },
    ])
    const body = await call()
    expect(body.spansModelChange).toBe(true)
    expect(body.models).toEqual([{ generation: 'v5', days: 2 }, { generation: 'v4', days: 1 }])

    // The headline figure still sees all three days. This is the anti-truncation guarantee: the
    // caller asked about a window and gets an answer about that window, with the census next to it.
    const headline = buildBatteryRecoveryCalibration.mock.results.at(-1)!.value as { seenDates: string[] }
    expect(headline.seenDates).toEqual(['2026-08-02', '2026-08-05', '2026-08-06'])
  })

  it('gives each generation its own calibration over only its own days', async () => {
    getBodyBatteryHistory.mockResolvedValue([
      { date: '2026-08-02', endValue: 61, modelVersion: 'v4:rest0.05' },
      { date: '2026-08-05', endValue: 12, modelVersion: 'v5:rest0.05' },
      { date: '2026-08-06', endValue: 0, modelVersion: 'v5:rest0.05' },
    ])
    const body = await call() as { byModel: { generation: string; days: number; calibration: { seenDates: string[] } }[] }
    const byGen = Object.fromEntries(body.byModel.map(m => [m.generation, m]))
    expect(byGen.v5.days).toBe(2)
    expect(byGen.v5.calibration.seenDates).toEqual(['2026-08-05', '2026-08-06'])
    expect(byGen.v4.days).toBe(1)
    expect(byGen.v4.calibration.seenDates).toEqual(['2026-08-02'])
  })

  it('a row with no stored version is its own bucket rather than disappearing', async () => {
    getBodyBatteryHistory.mockResolvedValue([
      { date: '2026-08-05', endValue: 12, modelVersion: 'v5:rest0.05' },
      { date: '2026-08-06', endValue: 30, modelVersion: null },
    ])
    const body = await call()
    expect(body.models).toEqual([{ generation: 'unknown', days: 1 }, { generation: 'v5', days: 1 }])
    expect(body.spansModelChange).toBe(true)
  })

  it('an empty window reports no models and does not claim a boundary', async () => {
    getBodyBatteryHistory.mockResolvedValue([])
    const body = await call()
    expect(body.models).toEqual([])
    expect(body.spansModelChange).toBe(false)
    expect(body.byModel).toBeNull()
  })
})
