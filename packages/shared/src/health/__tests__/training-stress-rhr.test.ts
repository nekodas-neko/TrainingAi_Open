import { describe, it, expect } from 'vitest'
import { restingHrForDay, TRAINING_STRESS_RHR_WINDOW_DAYS } from '../training-stress-rhr'

const EARLIEST = '2026-09-28'
const rows = (r: { date: string; restingHeartRate?: number | null }[]) => r

describe('restingHrForDay (#2401)', () => {
  it("uses the day's own reading when there is one", () => {
    const rhr = restingHrForDay(rows([
      { date: '2026-10-03', restingHeartRate: 52 }, { date: '2026-10-05', restingHeartRate: 49 },
    ]), '2026-10-05', EARLIEST)
    expect(rhr).toEqual({ value: 49, day: '2026-10-05' })
  })

  it('borrows the most recent earlier reading when the day has none', () => {
    const rhr = restingHrForDay(rows([
      { date: '2026-10-01', restingHeartRate: 53 }, { date: '2026-10-03', restingHeartRate: 52 },
      { date: '2026-10-05' },
    ]), '2026-10-05', EARLIEST)
    expect(rhr).toEqual({ value: 52, day: '2026-10-03' })
  })

  it('ignores a day with a null, zero or non-finite rate', () => {
    const rhr = restingHrForDay(rows([
      { date: '2026-10-02', restingHeartRate: 55 }, { date: '2026-10-04', restingHeartRate: 0 },
      { date: '2026-10-05', restingHeartRate: null }, { date: '2026-10-05', restingHeartRate: NaN },
    ]), '2026-10-05', EARLIEST)
    expect(rhr).toEqual({ value: 55, day: '2026-10-02' })
  })

  it('does not look beyond the window or past the asked day', () => {
    expect(restingHrForDay(rows([{ date: '2026-09-27', restingHeartRate: 50 }]), '2026-10-05', EARLIEST)).toBeNull()
    expect(restingHrForDay(rows([{ date: '2026-10-06', restingHeartRate: 50 }]), '2026-10-05', EARLIEST)).toBeNull()
  })

  it('returns null with nothing to borrow', () => {
    expect(restingHrForDay([], '2026-10-05', EARLIEST)).toBeNull()
    expect(TRAINING_STRESS_RHR_WINDOW_DAYS).toBe(7)
  })
})
