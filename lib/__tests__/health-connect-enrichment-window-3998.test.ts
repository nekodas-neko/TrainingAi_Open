// #3998: the Health Connect enrichment read is placed by `activityLogWindow`, the one home for a
// log's clock times. Before, it rolled the end a day whenever end <= start, so an end equal to the
// start (a 12-second treadmill log) read 24 hours and PATCHed what it found onto that log.
// Only the pure window is tested; the Capacitor plugin call around it is not exercised here.
import { describe, it, expect } from 'vitest'
import { enrichmentWindowIso } from '../health-connect-sync'

const BRISBANE = 'Etc/GMT-10' // UTC+10, no DST

describe('enrichmentWindowIso (#3998)', () => {
  it('a normal same-day activity asks for exactly its own span', () => {
    expect(enrichmentWindowIso({ id: 'a', date: '2026-03-02', startTime: '07:30', endTime: '08:15' }, BRISBANE))
      .toEqual({ start: '2026-03-01T21:30:00.000Z', end: '2026-03-01T22:15:00.000Z' })
  })

  it('a normal activity with a stored duration is unchanged', () => {
    expect(enrichmentWindowIso({ id: 'a', date: '2026-03-02', startTime: '07:30', endTime: '08:15', durationMin: 45 }, BRISBANE))
      .toEqual({ start: '2026-03-01T21:30:00.000Z', end: '2026-03-01T22:15:00.000Z' })
  })

  it('end equal to start with no duration is skipped, not read as 24 hours', () => {
    expect(enrichmentWindowIso({ id: 'a', date: '2026-03-02', startTime: '07:30', endTime: '07:30' }, BRISBANE)).toBeNull()
  })

  it('end equal to start with a plausible duration reads start + duration', () => {
    expect(enrichmentWindowIso({ id: 'a', date: '2026-03-02', startTime: '07:30', endTime: '07:30', durationMin: 30 }, BRISBANE))
      .toEqual({ start: '2026-03-01T21:30:00.000Z', end: '2026-03-01T22:00:00.000Z' })
  })

  it('an overnight activity ends on the next local day', () => {
    expect(enrichmentWindowIso({ id: 'a', date: '2026-02-28', startTime: '23:50', endTime: '00:20', durationMin: 30 }, BRISBANE))
      .toEqual({ start: '2026-02-28T13:50:00.000Z', end: '2026-02-28T14:20:00.000Z' })
  })

  it('an overnight activity with no duration is accepted while it is a plausible length', () => {
    expect(enrichmentWindowIso({ id: 'a', date: '2026-02-28', startTime: '23:50', endTime: '00:20' }, BRISBANE))
      .toEqual({ start: '2026-02-28T13:50:00.000Z', end: '2026-02-28T14:20:00.000Z' })
  })

  it('a typo\'d end before the start with no duration is skipped, not rolled to nearly 24 hours', () => {
    expect(enrichmentWindowIso({ id: 'a', date: '2026-03-02', startTime: '18:00', endTime: '07:00' }, BRISBANE)).toBeNull()
  })

  it('a typo\'d end before the start with a duration reads start + duration', () => {
    expect(enrichmentWindowIso({ id: 'a', date: '2026-03-02', startTime: '18:00', endTime: '07:00', durationMin: 40 }, BRISBANE))
      .toEqual({ start: '2026-03-02T08:00:00.000Z', end: '2026-03-02T08:40:00.000Z' })
  })

  it('reads the clock in the user\'s zone, not the device\'s', () => {
    expect(enrichmentWindowIso({ id: 'a', date: '2026-03-02', startTime: '07:30', endTime: '08:00' }, 'Etc/GMT+5'))
      .toEqual({ start: '2026-03-02T12:30:00.000Z', end: '2026-03-02T13:00:00.000Z' })
  })
})
