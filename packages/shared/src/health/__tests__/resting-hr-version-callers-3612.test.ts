// #3612 — every remaining caller of the one resting-HR rule keys it by (source, the source's algorithm
// version), read from the same window's sleep, as Body Battery's has since #3601. With one version per
// source (production today) each gives exactly what it gave before; a second version splits the mean
// at the change. Synthetic values and generic source names only; dates are counted back from today.
import { describe, it, expect, vi } from 'vitest'

const captured = vi.hoisted(() => ({ restingHr: [] as (number | null)[] }))
vi.mock('../activity-day', async (orig) => {
  const real = await orig<typeof import('../activity-day')>()
  return {
    ...real,
    scoreActivityForDay: (i: Parameters<typeof real.scoreActivityForDay>[0]) => {
      captured.restingHr.push(i.restingHr ?? null)
      return real.scoreActivityForDay(i)
    },
  }
})

import { restingHrOnDay, meanRestingHr } from '../resting-hr-mean'
import { nightAlgorithmVersion } from '../per-device-normal'
import { resolveHrProfile } from '../hr-profile'
import { EMPTY_OBSERVED_HR } from '../observed-hr'
import { loadActivityDay } from '../activity-day-load'
import { resolveSnapshot } from '../../running/assemble-plan-context'
import { todayInTz, shiftDateStr } from '../../date-utils'

const TZ = 'Australia/Brisbane'
const today = todayInTz(TZ)
const daysAgo = (n: number) => shiftDateStr(today, -n)

/** 42 nights from `source_a`: 52 bpm up to 15 nights ago, 58 for the newest 15. Today's 28-day
 *  window pools to 55. */
const metrics = Array.from({ length: 42 }, (_, i) => {
  const back = 41 - i
  return { date: daysAgo(back), restingHeartRate: back >= 15 ? 52 : 58, restingHeartRateSource: 'source_a' }
})
const sleepNight = (back: number, version: string | null) =>
  ({ date: daysAgo(back), durationSource: 'source_a', sourceAlgorithmVersion: version })
/** No sleep at all: the rule as `main` called it (no version), the reference for "before". */
const NO_SLEEP: ReturnType<typeof sleepNight>[] = []
/** One version across the window. */
const ONE_VERSION = Array.from({ length: 42 }, (_, back) => sleepNight(back, '1.0'))
/** The source changed its algorithm 14 nights ago, so yesterday already has 14 nights of the new one. */
const TWO_VERSIONS = Array.from({ length: 42 }, (_, back) => sleepNight(back, back >= 15 ? '1.0' : '2.0'))

describe('restingHrOnDay with a version (#3612)', () => {
  it('one version gives exactly what no version gave', () => {
    expect(restingHrOnDay(metrics, today, nightAlgorithmVersion(ONE_VERSION))).toBe(restingHrOnDay(metrics, today))
    expect(restingHrOnDay(metrics, today)).toBe(55)
  })
  it('two versions: the new version’s own mean once it has the nights', () => {
    expect(restingHrOnDay(metrics, today, nightAlgorithmVersion(TWO_VERSIONS))).toBe(58)
  })
  it('a finished day still never reads a later night', () => {
    // As of 14 nights ago version 2.0 had one night: version 1.0's mean carries over while it warms.
    expect(restingHrOnDay(metrics, daysAgo(14), nightAlgorithmVersion(TWO_VERSIONS))).toBe(52)
  })
  it('is meanRestingHr over the window, passed through', () => {
    const v = nightAlgorithmVersion(TWO_VERSIONS)
    const inWindow = metrics.filter(m => m.date >= daysAgo(28))
    expect(restingHrOnDay(metrics, today, v)).toBe(meanRestingHr(inWindow, v))
    expect(restingHrOnDay(metrics, today)).toBe(meanRestingHr(inWindow))
  })
})

/** A repository serving the rows above for any window, with the given sleep. */
function repoWith(sleep: unknown[] | 'fails') {
  const sleepWindows: [string, string][] = []
  const repo = {
    getUserById: async () => ({ dateOfBirth: null }),
    listBodyMetrics: async (_u: string, from: string, to: string) => metrics.filter(m => m.date >= from && m.date <= to),
    listSleepSessions: async (_u: string, from: string, to: string) => {
      sleepWindows.push([from, to])
      if (sleep === 'fails') throw new Error('sleep read failed')
      return sleep
    },
    getObservedHrProfile: async () => EMPTY_OBSERVED_HR,
    listFitnessTests: async () => [],
  }
  return { repo: repo as never, sleepWindows }
}

describe('the HR zones: resolveHrProfile (#3612)', () => {
  it('one version gives exactly what no version gave', async () => {
    const before = await resolveHrProfile(repoWith(NO_SLEEP).repo, 'u', TZ)
    const after = await resolveHrProfile(repoWith(ONE_VERSION).repo, 'u', TZ)
    expect(before.restingHr).toBe(55)
    expect(after).toEqual(before)
  })
  it('two versions split at the change', async () => {
    const { repo, sleepWindows } = repoWith(TWO_VERSIONS)
    expect((await resolveHrProfile(repo, 'u', TZ)).restingHr).toBe(58)
    // The sleep is the resting-HR window's own: today and the 28 days before.
    expect(sleepWindows).toEqual([[daysAgo(28), today]])
  })
  it('a failed sleep read keys the mean by source only, as before, and is not a failed resting HR', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = await resolveHrProfile(repoWith('fails').repo, 'u', TZ)
    spy.mockRestore()
    expect(p.restingHr).toBe(55)
    expect(p.restingHrSource).toBe('measured')
  })
})

describe('the running plan’s zones: resolveSnapshot (#3612)', () => {
  it('one version gives exactly what no version gave', async () => {
    const before = await resolveSnapshot(repoWith(NO_SLEEP).repo, 'u', TZ)
    const after = await resolveSnapshot(repoWith(ONE_VERSION).repo, 'u', TZ)
    expect(before.restingHr).toBe(55)
    expect(after).toEqual(before)
  })
  it('two versions split at the change, and agree with the HR zones', async () => {
    const snapshot = await resolveSnapshot(repoWith(TWO_VERSIONS).repo, 'u', TZ)
    const profile = await resolveHrProfile(repoWith(TWO_VERSIONS).repo, 'u', TZ)
    expect(snapshot.restingHr).toBe(58)
    expect(snapshot.restingHr).toBe(profile.restingHr)
  })
  it('a failed sleep read keys the mean by source only, as before', async () => {
    expect((await resolveSnapshot(repoWith('fails').repo, 'u', TZ)).restingHr).toBe(55)
  })
})

describe('the Activity zone lane on a finalised day: loadActivityDay (#3612)', () => {
  const dayRepo = (sleep: unknown[] | 'fails') => ({
    ...(repoWith(sleep).repo as object),
    getWorkoutSessionsFrom: async () => [],
    getHrForWindow: async () => [],
    getActiveProgram: async () => null,
    getUserGoals: async () => ({ stepsGoal: null }),
    getPerMinuteMovementSeries: async () => [],
    listActivityLogs: async () => [],
  }) as never
  const load = async (sleep: unknown[] | 'fails', date: string) => {
    captured.restingHr = []
    const day = await loadActivityDay(dayRepo(sleep), 'u', TZ, date, { maxHr: 180 })
    return { day, restingHr: captured.restingHr[0] }
  }
  const yesterday = daysAgo(1)

  it('one version gives exactly what no version gave', async () => {
    const before = await load(NO_SLEEP, yesterday)
    const after = await load(ONE_VERSION, yesterday)
    expect(before.restingHr).toBe(55)
    expect(after.restingHr).toBe(before.restingHr)
    expect(after.day).toEqual(before.day)
  })
  it('two versions split at the change', async () => {
    expect((await load(TWO_VERSIONS, yesterday)).restingHr).toBe(58)
    // 13 nights of the new version are not yet a normal: the previous version's mean carries over.
    expect((await load(TWO_VERSIONS, daysAgo(2))).restingHr).toBe(52)
  })
  it('a finished day fails the load when sleep cannot be read, rather than storing a differently keyed mean', async () => {
    await expect(loadActivityDay(dayRepo('fails'), 'u', TZ, yesterday, { maxHr: 180 })).rejects.toThrow('sleep read failed')
  })
  it('today only loses the version keying', async () => {
    expect((await load('fails', today)).restingHr).toBe(55)
  })
})
