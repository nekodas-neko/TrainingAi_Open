// #2634: the still-period resting HR from Oura Cloud data. A fake repository holds what the real one
// would return, so each case is one day of Oura's MET series, ~5-minute heart rate and stored sleep.
import { describe, it, expect } from 'vitest'
import { dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { refreshStillRhr, stillRhrDaysBetween, stillRhrDaysForDocuments, type StillRhrRepo } from '../still-rhr'

const MIN = 60_000
const HOUR = 60 * MIN

interface Fixture {
  tz: string
  day: string
  /** Local hour -> MET value, over the whole activity day (default 1.0 = still). */
  met?: (localMinute: number) => number
  hr: { atMinute: number; bpm: number }[]
  naps?: { fromMinute: number; toMinute: number }[]
  /** `class_5_min` for the day's document, if any. */
  class5Min?: string
}

/** A repository returning one local day: MET from 04:00 local (Oura's activity day) for 24 h. */
function repoFor(f: Fixture) {
  const midnight = dateStrMidnightInTz(f.day, f.tz).getTime()
  const actStart = midnight + 4 * HOUR
  const items = Array.from({ length: 1440 }, (_, i) => (f.met ?? (() => 1.0))(4 * 60 + i))
  const writes: { day: string; patch: Record<string, unknown> }[] = []
  const repo = {
    getUserById: async () => ({ timezone: f.tz }),
    getOuraCloudActivitySeries: async () => [{
      date: f.day,
      met: { interval: 60, items, timestamp: new Date(actStart).toISOString() },
      class5Min: f.class5Min ?? null,
    }],
    getOuraHeartrateBySource: async (_u: string, source: string) =>
      source === 'oura_cloud' ? f.hr.map(h => ({ timestamp: new Date(midnight + h.atMinute * MIN), bpm: h.bpm })) : [],
    listSleepSessions: async () => (f.naps ?? []).map(n => ({ sleepStart: new Date(midnight + n.fromMinute * MIN), sleepEnd: new Date(midnight + n.toMinute * MIN) })),
    upsertOuraDailyDerived: async (_u: string, day: string, patch: Record<string, unknown>) => { writes.push({ day, patch }) },
  } as unknown as StillRhrRepo
  return { repo, writes }
}

/** A reading every 5 minutes between two local clock minutes. */
const every5 = (fromMin: number, toMin: number, bpm: number) =>
  Array.from({ length: Math.floor((toMin - fromMin) / 5) + 1 }, (_, i) => ({ atMinute: fromMin + i * 5, bpm }))

describe('refreshStillRhr (Oura Cloud)', () => {
  it('a typical day in Los Angeles: the median of the still readings and their minutes', async () => {
    // Readings 08:00–20:00 at 61 bpm, a walk 12:00–12:30 at 130 bpm that MET marks active.
    const hr = [...every5(8 * 60, 20 * 60, 61).filter(h => h.atMinute < 12 * 60 || h.atMinute > 12 * 60 + 30),
      ...every5(12 * 60, 12 * 60 + 30, 130)]
    const { repo, writes } = repoFor({ tz: 'America/Los_Angeles', day: '2026-07-14', hr, met: m => (m >= 12 * 60 && m < 12 * 60 + 30 ? 3.0 : 1.0) })
    expect(await refreshStillRhr(repo, 'u', ['2026-07-14'])).toEqual(['2026-07-14'])
    // 145 readings less the 7 whose 5 minutes touch the walk: 138 × 5 minutes.
    expect(writes).toEqual([{ day: '2026-07-14', patch: { stillRhrBpm: 61, stillRhrCoverageMin: 690 } }])
  })

  it('the same day across a daylight-saving change (23 hours long) still lands on its local date', async () => {
    const { repo, writes } = repoFor({ tz: 'America/Los_Angeles', day: '2026-03-08', hr: every5(11 * 60, 14 * 60, 66) })
    await refreshStillRhr(repo, 'u', ['2026-03-08'])
    expect(writes).toHaveLength(1)
    expect(writes[0].patch.stillRhrBpm).toBe(66)
  })

  it('a thin day (under an hour of still time) is null: nothing is written, never 0', async () => {
    const { repo, writes } = repoFor({ tz: 'America/Los_Angeles', day: '2026-07-14', hr: every5(12 * 60, 12 * 60 + 40, 62) })
    expect(await refreshStillRhr(repo, 'u', ['2026-07-14'])).toEqual([])
    expect(writes).toEqual([])
  })

  it('a day with no heart rate at all writes nothing', async () => {
    const { repo, writes } = repoFor({ tz: 'Europe/London', day: '2026-07-14', hr: [] })
    expect(await refreshStillRhr(repo, 'u', ['2026-07-14'])).toEqual([])
    expect(writes).toEqual([])
  })

  it('a day split by a nap leaves the nap out: its low readings do not set the median', async () => {
    // 10:00–16:00 readings: 62 bpm awake, 48 bpm across a nap 11:00–14:00.
    const hr = every5(10 * 60, 16 * 60, 62).map(h => (h.atMinute >= 11 * 60 && h.atMinute <= 14 * 60 ? { ...h, bpm: 48 } : h))
    const { repo, writes } = repoFor({ tz: 'Europe/London', day: '2026-07-14', hr, naps: [{ fromMinute: 11 * 60, toMinute: 14 * 60 }] })
    await refreshStillRhr(repo, 'u', ['2026-07-14'])
    // 73 readings less the 37 whose 5 minutes touch 11:00–14:00: 36 × 5 minutes, all at 62.
    expect(writes).toEqual([{ day: '2026-07-14', patch: { stillRhrBpm: 62, stillRhrCoverageMin: 180 } }])
  })

  it('a ring on the charger (non-wear in class_5_min) is not still: its readings do not count', async () => {
    // class_5_min starts at 04:00 local, one character per 5 minutes: 0 = non-wear. Mark 10:00–13:00 non-wear.
    const classes = Array.from({ length: 288 }, (_, i) => {
      const startMin = 4 * 60 + i * 5
      return startMin >= 10 * 60 && startMin < 13 * 60 ? '0' : '4'
    }).join('')
    const { repo, writes } = repoFor({ tz: 'America/Los_Angeles', day: '2026-07-14', hr: every5(10 * 60, 13 * 60, 55), class5Min: classes })
    expect(await refreshStillRhr(repo, 'u', ['2026-07-14'])).toEqual([])
    expect(writes).toEqual([])
  })

  it('skips today and any day not yet over', async () => {
    const { repo, writes } = repoFor({ tz: 'America/Los_Angeles', day: '2026-07-14', hr: every5(12 * 60, 15 * 60, 60) })
    const far = '2999-01-01'
    expect(await refreshStillRhr(repo, 'u', [far])).toEqual([])
    expect(writes).toEqual([])
  })
})

describe('which days a write refreshes', () => {
  it('a document with MET names its day and the next; one without names none', () => {
    expect(stillRhrDaysForDocuments([{ date: '2026-07-14', met: { interval: 60 } }, { date: '2026-07-20', met: null }]))
      .toEqual(['2026-07-14', '2026-07-15'])
  })

  it('a heart-rate span names the local days it touches, in the user\'s zone', () => {
    // 2026-07-15 06:30Z to 2026-07-15 08:30Z is 23:30 on the 14th to 01:30 on the 15th in Los Angeles.
    expect(stillRhrDaysBetween(new Date('2026-07-15T06:30:00Z'), new Date('2026-07-15T08:30:00Z'), 'America/Los_Angeles'))
      .toEqual(['2026-07-14', '2026-07-15'])
  })
})
