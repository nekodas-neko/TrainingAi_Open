import { describe, it, expect } from 'vitest'
import { framesToPayload } from '@/lib/colmi-ble/frames-to-payload'
import type { ColmiFrame } from '@/lib/colmi-ble/decode'
import { formatInTimeZone } from 'date-fns-tz'

const REAL: Record<number, number[]> = {
  7:[0,0,0,0,0,0,0,0,98,86,63,0,0], 8:[0,0,80,85,77,80,83,95,70,0,0,0,0],
  9:[106,88,81,103,100,83,91,78,73,90,90,86,78], 10:[95,84,73,86,81,110,85,80,83,74,88,97,95],
  11:[95,88,88,108,101,98,96,78,70,0,0,0,0], 12:[68,88,95,70,68,88,102,67,90,86,88,69,69],
  13:[77,98,81,79,75,68,68,79,82,77,81,71,75], 14:[73,70,90,83,77,79,77,72,64,90,73,80,81],
  15:[95,87,82,87,111,76,82,82,70,78,81,82,98], 16:[81,78,78,69,70,76,78,73,81,71,80,75,89],
  17:[92,77,75,86,72,79,68,80,81,75,71,77,86], 18:[73,73,70,73,86,70,88,76,85,85,98,106,113],
  19:[65,79,81,67,88,72,90,64,83,86,71,96,90], 20:[79,102,104,71,71,65,85,75,0,0,0,0,0],
}
const ANCHOR = 1787788800   // exactly what the ring echoed on 2026-08-27

describe('the 2026-08-27 20:52 sync, decoded from its stored frames', () => {
  it('places the log across the waking day and ends at the sync, not ten hours later', () => {
    const f = (subType: number, values: number[], startedAtUnixSec: number | null = null): ColmiFrame =>
      ({ kind: 'heartRateLog', subType, packetTotal: null, intervalMinutes: null,
         startedAtUnixSec, values, isFinal: false, isEmpty: subType === 255 })

    const frames: ColmiFrame[] = [
      { kind: 'heartRateLog', subType: 0, packetTotal: 24, intervalMinutes: 5,
        startedAtUnixSec: null, values: [], isFinal: false, isEmpty: false },
      f(1, [0,0,0,0,0,0,0,0,0], ANCHOR),
    ]
    for (let s = 2; s <= 23; s++) frames.push(f(s, REAL[s] ?? new Array(13).fill(0)))

    const hr = framesToPayload(frames, { todayStr: '2026-08-27', timezone: 'Australia/Brisbane' })
      .readings.filter(r => r.kind === 'heart_rate')
    const t = (r: { at: number }) => formatInTimeZone(new Date(r.at), 'Australia/Brisbane', 'yyyy-MM-dd HH:mm')

    expect(hr).toHaveLength(157)
    expect(t(hr[0])).toBe('2026-08-27 06:50')
    // The sync ran at 20:52 — the last reading must precede it, which is what the ten-hour shift
    // broke: it put this sample at 06:50 the NEXT day, and 119 of 157 past the future tolerance.
    expect(t(hr[hr.length - 1])).toBe('2026-08-27 20:50')
    expect(Math.min(...hr.map(r => r.value))).toBeGreaterThanOrEqual(63)
    expect(Math.max(...hr.map(r => r.value))).toBeLessThanOrEqual(113)
  })
})
