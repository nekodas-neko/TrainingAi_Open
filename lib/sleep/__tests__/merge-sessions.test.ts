import { describe, it, expect } from 'vitest'
import { mergeByDate, type SleepRow } from '@/lib/sleep/merge-sessions'

// Minimal row factory — only the fields the merge/cluster logic reads matter.
const row = (o: Partial<SleepRow> & { date: string; sleepStart: string; sleepEnd: string }): SleepRow => ({
  ouraId: null, durationHours: null, deepSleepHours: null, remSleepHours: null,
  lightSleepHours: null, awakHours: null, efficiency: null, onsetLatencySec: null,
  averageHrvMs: null, avgHeartRate: null, lowestHeartRate: null, restlessPeriods: null,
  sleepScore: null, respiratoryRate: null, sleepPhase5Min: null, sleepTimeRecommendation: null,
  ...o,
})

describe('mergeByDate — distant fragments do not distort the night (real prod cases)', () => {
  it('07-02: drops the 19:40 evening fragment so bedtime stays 21:40 (not 19:40)', () => {
    const out = mergeByDate([
      row({ date: '2026-07-02', ouraId: 'a', sleepStart: '2026-07-01T19:40:00Z', sleepEnd: '2026-07-01T20:19:00Z', durationHours: 0.2, onsetLatencySec: 1890 }),
      row({ date: '2026-07-02', ouraId: 'b', sleepStart: '2026-07-01T21:40:00Z', sleepEnd: '2026-07-02T06:53:00Z', durationHours: 8.4, onsetLatencySec: 1080 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sleepStart).toBe('2026-07-01T21:40:00Z') // not the 19:40 fragment
    expect(out[0].sleepEnd).toBe('2026-07-02T06:53:00Z')
    expect(out[0].durationHours).toBe(8.4) // not 8.4 + 0.2 summed
    expect(out[0].onsetLatencySec).toBe(1080) // the night's onset, not the fragment's 1890
  })

  it('07-04: drops the 14:39 afternoon nap so wake stays 07:16 (not 14:59)', () => {
    const out = mergeByDate([
      row({ date: '2026-07-04', ouraId: 'a', sleepStart: '2026-07-03T21:56:00Z', sleepEnd: '2026-07-04T07:16:00Z', durationHours: 8.2 }),
      row({ date: '2026-07-04', ouraId: 'b', sleepStart: '2026-07-04T14:39:00Z', sleepEnd: '2026-07-04T14:59:00Z', durationHours: 0.1 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sleepEnd).toBe('2026-07-04T07:16:00Z') // not 14:59
    expect(out[0].durationHours).toBe(8.2)
  })

  it('07-07: drops the stray BLE 10:44 daytime fragment so wake stays 07:02 (not 11:03)', () => {
    const out = mergeByDate([
      row({ date: '2026-07-07', ouraId: 'cloud', sleepStart: '2026-07-06T22:16:00Z', sleepEnd: '2026-07-07T07:02:00Z', durationHours: 7.9 }),
      row({ date: '2026-07-07', ouraId: 'ble:1474260', sleepStart: '2026-07-07T10:44:00Z', sleepEnd: '2026-07-07T11:03:00Z', durationHours: 0.3 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sleepEnd).toBe('2026-07-07T07:02:00Z') // not 11:03
  })

  it('still merges a genuine midnight-split night (adjacent halves within the gap)', () => {
    // Samsung splits one night at midnight — the two halves are contiguous and must still combine.
    const out = mergeByDate([
      row({ date: '2026-07-10', sleepStart: '2026-07-09T22:30:00Z', sleepEnd: '2026-07-10T00:00:00Z', durationHours: 1.5 }),
      row({ date: '2026-07-10', sleepStart: '2026-07-10T00:00:00Z', sleepEnd: '2026-07-10T06:30:00Z', durationHours: 6.5 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sleepStart).toBe('2026-07-09T22:30:00Z')
    expect(out[0].sleepEnd).toBe('2026-07-10T06:30:00Z')
    expect(out[0].durationHours).toBe(8) // 1.5 + 6.5 summed — a split night IS one sleep
  })

  it('passes a single-row date through untouched', () => {
    const r = row({ date: '2026-07-09', ouraId: 'ble:2739761', sleepStart: '2026-07-08T21:53:00Z', sleepEnd: '2026-07-09T06:25:00Z', durationHours: 7.3 })
    expect(mergeByDate([r])).toEqual([r])
  })
})
