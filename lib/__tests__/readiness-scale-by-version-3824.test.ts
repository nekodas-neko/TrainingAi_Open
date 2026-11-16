// #3824 review fixes, server side: the training-stress cut is chosen by the stored row's own model
// version, the early-deload card moves at 51, and the shadow measure compares one scale.
import { describe, expect, it, vi } from 'vitest'
import { READINESS_MODEL_VERSION } from '@trainingai/shared/health/readiness-composite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { otsHighThreshold } from '@/lib/oura-models/inference/ots'

const V17 = 'v17:version-keyed-baselines:2026-11-04'
const V18 = READINESS_MODEL_VERSION

vi.mock('@/lib/data', () => ({ getRepository: async () => ({}) }))

describe('training stress: the low-readiness bar follows the score\'s scale', () => {
  const lowered = (readiness: number, mv: string | null) => otsHighThreshold(4, readiness, mv) < 4

  it('a v18 score lowers the bar under 67, not from 67', () => {
    expect(lowered(66, V18)).toBe(true)
    expect(lowered(67, V18)).toBe(false)
  })

  it('a stored pre-release score of 60–66 does not flip it (old cut 60)', () => {
    for (let r = 60; r <= 66; r++) expect(lowered(r, V17)).toBe(false)
    expect(lowered(59, V17)).toBe(true)
    expect(lowered(62, null)).toBe(false)
    expect(otsHighThreshold(4, 59, V17)).toBeCloseTo(3.6, 10)
  })

  it('the scorer reads its bar through that seam', () => {
    const src = readFileSync(join(process.cwd(), 'lib/oura-models/inference/ots.ts'), 'utf8')
    expect(src).toContain('const threshold = otsHighThreshold(C.highOtsThreshold, input.readiness, input.readinessModelVersion)')
  })
})

describe('early-deload card at the moved boundary', () => {
  it('fires under 51 with ACWR over its bound, not from 51', async () => {
    const { earlyDeloadFires, EARLY_DELOAD_ACWR_MIN } = await import('@/lib/health/readiness-payload')
    const acwr = EARLY_DELOAD_ACWR_MIN + 0.05
    expect(earlyDeloadFires(50, acwr)).toBe(true)
    expect(earlyDeloadFires(51, acwr)).toBe(false)
    expect(earlyDeloadFires(50, EARLY_DELOAD_ACWR_MIN)).toBe(false)
  })
})

describe('shadow days-moved compares the shadow with live readiness on one scale', () => {
  const atBaseline = (s: number) => ({
    restingHeartRate: { score: s, input: 0, provisional: false, gap: null },
    hrvBalance: { score: s, input: 0, provisional: false, gap: null },
    sleepBalance: { score: s, input: 0, provisional: false, gap: null },
  })

  it('puts a v17 composite on the current scale, so the centre move is not counted as the shadow moving', async () => {
    const { liveCompositeOf, daysMoved } = await import('@/lib/health/shadow-readiness-service')
    const v17 = liveCompositeOf('2026-11-10', 55, 'normal', '2026-10-29', { modelVersion: V17, contributors: atBaseline(50) })
    expect(v17).toEqual({ liveComposite: 66, liveGap: null })
    const v18 = liveCompositeOf('2026-11-16', 66, 'normal', '2026-10-29', { modelVersion: V18, contributors: atBaseline(75) })
    expect(v18).toEqual({ liveComposite: 66, liveGap: null })
    expect(daysMoved([{ shadowReadiness: 66, ...v17 }, { shadowReadiness: 66, ...v18 }])).toMatchObject({ compared: 2, moved: 0 })
  })

  it('converts the composite behind a suppressed score too', async () => {
    const { liveCompositeOf } = await import('@/lib/health/shadow-readiness-service')
    // Elevated suppresses 10: served 45 → composite 55 on v17 → 66 on the current scale.
    expect(liveCompositeOf('2026-11-10', 45, 'elevated', '2026-10-29', { modelVersion: V17, contributors: atBaseline(50) }))
      .toEqual({ liveComposite: 66, liveGap: null })
  })

  it('leaves out, and counts, a v17 day it cannot convert', async () => {
    const { liveCompositeOf, daysMoved } = await import('@/lib/health/shadow-readiness-service')
    const live = liveCompositeOf('2026-11-10', 55, 'normal', '2026-10-29', { modelVersion: V17, contributors: null })
    expect(live).toEqual({ liveComposite: null, liveGap: 'old-scale' })
    expect(daysMoved([{ shadowReadiness: 66, ...live }]).excluded['old-scale']).toBe(1)
  })
})
