import { describe, it, expect } from 'vitest'
import { pickPrimarySleep, MIN_MAIN_SLEEP_H } from '@/lib/sleep/primary-sleep'
import type { SleepSession } from '@trainingai/shared/types/body'

function row(over: Partial<SleepSession>): SleepSession {
  return {
    id: 'x', userId: 'u', date: '2026-07-04',
    sleepStart: new Date('2026-07-03T22:00:00+10:00'),
    sleepEnd: new Date('2026-07-04T06:00:00+10:00'),
    createdAt: new Date(),
    ...over,
  } as SleepSession
}

describe('pickPrimarySleep', () => {
  it('exposes the 3h main-sleep floor', () => {
    expect(MIN_MAIN_SLEEP_H).toBe(3)
  })

  it('returns null for no rows', () => {
    expect(pickPrimarySleep([])).toBeNull()
  })

  it('ignores sub-3h naps when a real night exists', () => {
    const nap = row({ id: 'nap', durationHours: 0.5 })
    const night = row({ id: 'night', durationHours: 8 })
    expect(pickPrimarySleep([nap, night])?.id).toBe('night')
  })

  it('prefers the Oura row (true onset) over a longer non-Oura in-bed row', () => {
    const samsung = row({ id: 's', durationHours: 9, ouraId: null })
    const oura = row({ id: 'o', durationHours: 8, ouraId: 'oura-123' })
    expect(pickPrimarySleep([samsung, oura])?.id).toBe('o')
  })

  it('falls back to the longest row when none clears the 3h floor', () => {
    const a = row({ id: 'a', durationHours: 1 })
    const b = row({ id: 'b', durationHours: 2 })
    expect(pickPrimarySleep([a, b])?.id).toBe('b')
  })
})
