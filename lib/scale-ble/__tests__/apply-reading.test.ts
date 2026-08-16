// Q-25(b): both scale write paths keyed body_metrics on `todayInTz` while the raw sample kept
// `measuredAt`, so a weigh-in could land on a day it did not happen on.
import { describe, it, expect, vi } from 'vitest'
import { applyScaleReadingToBodyMetrics } from '../apply-reading'
import type { WorkoutRepository } from '@/lib/data/repository'

const TZ = 'Australia/Brisbane' // UTC+10, no DST

/** `existingTrendKg` = the weight a scale reading has already set for that day, or null for none. */
function repoStub(existingTrendKg: number | null = null) {
  const upsertBodyMetrics = vi.fn(async () => {})
  const getConfirmedScaleTrendForDate = vi.fn(async () =>
    existingTrendKg == null ? null : { weightKg: existingTrendKg })
  return {
    repo: { upsertBodyMetrics, getConfirmedScaleTrendForDate } as unknown as WorkoutRepository,
    upsertBodyMetrics,
    getConfirmedScaleTrendForDate,
  }
}

describe('applyScaleReadingToBodyMetrics', () => {
  it('files the reading on its own local day, not on today', async () => {
    // 2026-07-27 22:30 UTC is 2026-07-28 08:30 in Brisbane — a morning weigh-in.
    const { repo, upsertBodyMetrics } = repoStub()
    const r = await applyScaleReadingToBodyMetrics(repo, 'u1', {
      measuredAt: new Date('2026-07-27T22:30:00Z'), tz: TZ, weightKg: 82.4, composition: null,
    })
    expect(r.readingDay).toBe('2026-07-28')
    expect(upsertBodyMetrics.mock.calls[0][1][0].date).toBe('2026-07-28')
  })

  it('files a reading confirmed days later against the day it was taken', async () => {
    // The failure the confirm route hit every time: a pending sample staged on the 20th and
    // confirmed on the 29th used to write to the 29th.
    const { repo, upsertBodyMetrics } = repoStub()
    const r = await applyScaleReadingToBodyMetrics(repo, 'u1', {
      measuredAt: new Date('2026-07-20T21:05:00Z'), tz: TZ, weightKg: 81.9, composition: null,
    })
    expect(r.readingDay).toBe('2026-07-21')
    expect(upsertBodyMetrics.mock.calls[0][1][0].date).toBe('2026-07-21')
  })

  it('resolves the day in the user’s timezone, not UTC', async () => {
    // 2026-07-28 23:00 UTC is already the 29th in Brisbane. A UTC read would say the 28th.
    const { repo } = repoStub()
    const r = await applyScaleReadingToBodyMetrics(repo, 'u1', {
      measuredAt: new Date('2026-07-28T23:00:00Z'), tz: TZ, weightKg: 82, composition: null,
    })
    expect(r.readingDay).toBe('2026-07-29')
  })

  it('checks the trend gate against the reading’s day, not today', async () => {
    const { repo, getConfirmedScaleTrendForDate } = repoStub()
    await applyScaleReadingToBodyMetrics(repo, 'u1', {
      measuredAt: new Date('2026-07-20T21:05:00Z'), tz: TZ, weightKg: 81.9, composition: null,
    })
    expect(getConfirmedScaleTrendForDate).toHaveBeenCalledWith('u1', '2026-07-21')
  })

  // ── Q-69: lowest reading of the day wins the trend, not the first ──────────────────────────
  it('sets the trend when it is the day’s first reading', async () => {
    const { repo, upsertBodyMetrics } = repoStub(null)
    const r = await applyScaleReadingToBodyMetrics(repo, 'u1', {
      measuredAt: new Date('2026-07-28T08:00:00Z'), tz: TZ, weightKg: 82.4, composition: null,
    })
    expect(r.trendUpdated).toBe(true)
    expect(upsertBodyMetrics).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite the trend with a HIGHER later reading', async () => {
    // The ordinary evening case: food and water only add weight.
    const { repo, upsertBodyMetrics } = repoStub(82.4)
    const r = await applyScaleReadingToBodyMetrics(repo, 'u1', {
      measuredAt: new Date('2026-07-28T08:00:00Z'), tz: TZ, weightKg: 83.9, composition: null,
    })
    expect(r.trendUpdated).toBe(false)
    expect(upsertBodyMetrics).not.toHaveBeenCalled()
  })

  it('DOES overwrite the trend with a LOWER later reading — the clothed-first case', async () => {
    // The whole point of Q-69: the first reading was taken clothed, a later nude one is lower.
    const { repo, upsertBodyMetrics } = repoStub(84.1)
    const r = await applyScaleReadingToBodyMetrics(repo, 'u1', {
      measuredAt: new Date('2026-07-28T08:00:00Z'), tz: TZ, weightKg: 82.4, composition: null,
    })
    expect(r.trendUpdated).toBe(true)
    expect(upsertBodyMetrics.mock.calls[0][1][0].weightKg).toBe(82.4)
  })

  it('treats a reading equal to the current trend as a no-op', async () => {
    const { repo, upsertBodyMetrics } = repoStub(82.4)
    const r = await applyScaleReadingToBodyMetrics(repo, 'u1', {
      measuredAt: new Date('2026-07-28T08:00:00Z'), tz: TZ, weightKg: 82.4, composition: null,
    })
    expect(r.trendUpdated).toBe(false)
    expect(upsertBodyMetrics).not.toHaveBeenCalled()
  })

  it('carries the lower reading’s composition too, not just its weight', async () => {
    // A replaced trend must not leave the earlier reading's body-fat figures paired with the new
    // weight — they were measured on different bodies-in-different-states.
    const { repo, upsertBodyMetrics } = repoStub(84.1)
    await applyScaleReadingToBodyMetrics(repo, 'u1', {
      measuredAt: new Date('2026-07-28T08:00:00Z'), tz: TZ, weightKg: 82.4,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      composition: { bodyFatPct: 17.1, bmrKcal: 1795 } as any,
    })
    const written = upsertBodyMetrics.mock.calls[0][1][0]
    expect(written.weightKg).toBe(82.4)
    expect(written.bodyFatPct).toBe(17.1)
  })

  it('carries the composition fields through when impedance was valid', async () => {
    const { repo, upsertBodyMetrics } = repoStub()
    await applyScaleReadingToBodyMetrics(repo, 'u1', {
      measuredAt: new Date('2026-07-28T08:00:00Z'), tz: TZ, weightKg: 82.4,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      composition: { bodyFatPct: 18.2, bmrKcal: 1810 } as any,
    })
    const written = upsertBodyMetrics.mock.calls[0][1][0]
    expect(written.bodyFatPct).toBe(18.2)
    expect(written.bmrKcal).toBe(1810)
  })

  it('writes the weight alone when composition was skipped', async () => {
    const { repo, upsertBodyMetrics } = repoStub()
    await applyScaleReadingToBodyMetrics(repo, 'u1', {
      measuredAt: new Date('2026-07-28T08:00:00Z'), tz: TZ, weightKg: 82.4, composition: null,
    })
    const written = upsertBodyMetrics.mock.calls[0][1][0]
    expect(written.weightKg).toBe(82.4)
    expect(written.bodyFatPct).toBeUndefined()
  })
})
