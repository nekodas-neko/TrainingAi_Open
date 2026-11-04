// #3600 — a merged night carries the generic recording fields as the score's aggregate does:
// flagged when any window is incomplete, restlessness summed only when every window has a series.
import { describe, it, expect } from 'vitest'
import { mergeByDate, type SleepRow } from '../merge-sessions'

const row = (id: string, start: string, end: string, o: Partial<SleepRow> = {}): SleepRow => ({
  id, date: '2026-10-25', ouraId: id, durationHours: 3, deepSleepHours: null, remSleepHours: null, lightSleepHours: null,
  awakHours: null, efficiency: 90, onsetLatencySec: null, averageHrvMs: null, avgHeartRate: null, lowestHeartRate: null,
  restlessPeriods: null, respiratoryRate: null, sleepPhase5Min: null, sleepStart: start, sleepEnd: end, ...o,
} as SleepRow)

describe('mergeByDate recording fields (#3600)', () => {
  it('a one-window night keeps its fields; one without them reads as before', () => {
    const a = mergeByDate([row('a', '2026-10-24T13:00:00.000Z', '2026-10-24T21:00:00.000Z', { restlessMin: 20, movementMeasuredMin: 400, recordingIncomplete: true, sourceAlgorithmVersion: 'v2' })], 'Australia/Brisbane')
    expect(a[0]).toMatchObject({ restlessMin: 20, movementMeasuredMin: 400, recordingIncomplete: true, sourceAlgorithmVersion: 'v2' })
    const b = mergeByDate([row('b', '2026-10-24T13:00:00.000Z', '2026-10-24T21:00:00.000Z')], 'Australia/Brisbane')
    expect(b[0].recordingIncomplete ?? null).toBeNull()
    expect(b[0].restlessMin ?? null).toBeNull()
  })

  it('two windows: the night is incomplete when either is; restlessness sums when both have a series, else none', () => {
    const w1 = row('w1', '2026-10-24T13:00:00.000Z', '2026-10-24T17:00:00.000Z', { restlessMin: 10, movementMeasuredMin: 200, sourceAlgorithmVersion: 'v2' })
    const w2 = row('w2', '2026-10-24T18:00:00.000Z', '2026-10-24T21:00:00.000Z', { restlessMin: 5, movementMeasuredMin: 150, recordingIncomplete: true })
    const [both] = mergeByDate([w1, w2], 'Australia/Brisbane')
    expect(both).toMatchObject({ restlessMin: 15, movementMeasuredMin: 350, recordingIncomplete: true, sourceAlgorithmVersion: 'v2' })
    const [one] = mergeByDate([w1, { ...w2, restlessMin: null, movementMeasuredMin: null }], 'Australia/Brisbane')
    expect(one.restlessMin ?? null).toBeNull()
    expect(one.recordingIncomplete).toBe(true)
  })
})
