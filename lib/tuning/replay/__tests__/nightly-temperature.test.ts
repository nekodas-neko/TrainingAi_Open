// TN-56 — the nightly-temperature replay evaluates exactly the rollup's algorithm, and the bracketed
// constants actually move it. The load half (sleep windows → 0x75 frames) is checked against real
// data on the snapshot database, where the defaults must reproduce what production stored.
import { describe, it, expect } from 'vitest'
import { REPLAY_FUNCTIONS } from '../registry'
import { nightlyTemperatureCentiC, RANGE_THRESHOLD, MIN_WINDOWS } from '@trainingai/shared/health/temperature-baseline'

const fn = REPLAY_FUNCTIONS['nightly-temperature']
const defaults = { RANGE_THRESHOLD, MIN_WINDOWS }

// Five 30-sample windows. The FIRST carries a 3 °C swing (first, because the 7-sample median carries
// values across a window boundary, so a later window would inherit the previous one's maximum),
// so the default range gate (2.5 °C) rejects it (3 °C range) and a wider one accepts it. Its max is the lowest, so admitting it lowers the night.
const flat = (c: number) => new Array(30).fill(c)
const swing = [...new Array(15).fill(3100), ...new Array(15).fill(3400)]
const samples = [...swing, ...flat(3500), ...flat(3510), ...flat(3520), ...flat(3530)]
const inputs = { nights: [{ date: '2026-09-20', samples, stored: 35.3 }, { date: '2026-09-21', samples: [], stored: null }] }

describe('nightly-temperature replay (TN-56)', () => {
  it('at the defaults, is the rollup call exactly', () => {
    const [night, empty] = fn.evaluate(inputs as never, defaults)
    expect(night.value).toBe(nightlyTemperatureCentiC(samples)! / 100)
    expect(night.stored).toBe(35.3)
    expect(empty.value).toBeNull()
  })

  it('a wider range gate admits the swinging window, and a stricter minimum drops the night', () => {
    const wide = fn.evaluate(inputs as never, { ...defaults, RANGE_THRESHOLD: 400 })[0].value
    const narrow = fn.evaluate(inputs as never, defaults)[0].value
    expect(wide).not.toBe(narrow)
    expect(fn.evaluate(inputs as never, { ...defaults, MIN_WINDOWS: 6 })[0].value).toBeNull()
  })
})
