// Q-274: production carries 17 daytime sleep fragments — every one starting between 09:32 and 22:14
// local, of 0.00–1.45 h. Fifteen of their dates carry TWO rows: the fragment and the real night.
//
// `/api/day-log` picked `sleepRes.value[0]`, and `listSleepSessions` orders by DATE only — so within
// a date the order is whatever Postgres returns and the day log chose between nap and night by coin
// flip. These drive the selection directly rather than the route, because the defect is which row is
// chosen, and the route's own shape (Promise.allSettled over three optional sources) is not the part
// under test.
import { describe, it, expect } from 'vitest'
import { nightSessions } from '@trainingai/shared/health/sleep-night'

const TZ = 'Australia/Brisbane'
// Brisbane is UTC+10 and never observes DST, so these offsets are stable.
const at = (localHHMM: string, day = '2026-08-13') => new Date(`${day}T${localHHMM}:00+10:00`)

const row = (start: Date, end: Date, durationHours: number, tag: string) => ({
  date: '2026-08-13', sleepStart: start, sleepEnd: end, durationHours, tag,
})

/** What the route now does: aggregate to nights, then take the longest. */
const pick = <T extends { durationHours?: number | null }>(rows: T[]) => {
  const nights = nightSessions(rows as never, TZ) as T[]
  return nights.length
    ? nights.reduce((best, n) => ((n.durationHours ?? 0) > (best.durationHours ?? 0) ? n : best))
    : undefined
}

describe('the day log picks the night, not whichever row came back first (Q-274)', () => {
  // The real 2026-08-13 shape: a 16:47–18:32 afternoon fragment alongside the night.
  const nap = row(at('16:47'), at('18:32'), 1.42, 'nap')
  const night = row(at('22:30', '2026-08-12'), at('06:20'), 7.5, 'night')

  it('picks the night when the fragment is returned first', () => {
    expect(pick([nap, night])?.tag).toBe('night')
  })

  it('picks the night when the night is returned first', () => {
    // Both orders, because the old code was order-dependent and passing one proves nothing.
    expect(pick([night, nap])?.tag).toBe('night')
  })

  it('reports NO sleep for a day whose only row is a daytime fragment', () => {
    // Better than showing the nap as the night: a nap is not the night, and saying so beats
    // reporting 1.42 h of "sleep" for the day.
    expect(pick([nap])).toBeUndefined()
  })

  it('reports NO sleep for a zero-duration row', () => {
    // 2026-08-22 in production: the sole row for the date, 17:44–18:39, duration 0.00, efficiency 0.
    // A bed period the recorder never resolved into sleep is not a short night.
    expect(pick([row(at('17:44', '2026-08-22'), at('18:39', '2026-08-22'), 0, 'zero')])).toBeUndefined()
  })

  it('still reassembles a genuinely fragmented night rather than picking one half', () => {
    const a = row(at('22:40', '2026-08-12'), at('00:38'), 1.9, 'first')
    const b = row(at('02:23'), at('06:25'), 4.02, 'second')
    const got = pick([b, a])
    expect(got?.durationHours).toBeCloseTo(5.92, 2)
  })
})
