import { describe, it, expect } from 'vitest'
import { actualSleepWindow } from '@/lib/sleep/actual-window'

describe('actualSleepWindow', () => {
  it('trims leading awake into onset but keeps the ring\'s recorded wake time', () => {
    // base 22:00; 2 leading awake epochs (10 min), sleep, then 1 trailing awake epoch. The end is
    // the ring's ACTUAL recorded wake (phaseWindowEnd), not base + codes.length — a trailing awake
    // stretch stays in the window (the 07-08 "lost 15 minutes" bug) but the displayed wake can never
    // exceed the real recorded wake.
    const codes = '44' + '2222223' + '4' // idx 2..8 asleep, idx 9 (trailing) awake
    const win = actualSleepWindow({
      sleepPhase5Min: codes,
      phaseWindowStart: '2026-07-08T22:00:00.000Z',
      phaseWindowEnd: '2026-07-08T22:50:00.000Z',
      sleepStart: null,
    })
    expect(win).not.toBeNull()
    expect(win!.start).toBe('2026-07-08T22:10:00.000Z') // 2 epochs × 5 min in
    expect(win!.end).toBe('2026-07-08T22:50:00.000Z')   // recorded wake, includes the trailing awake epoch
  })

  it('never reports a wake time past the recorded end when the phase string is padded up (future-wake bug)', () => {
    // The BLE aggregate pads the phase string UP to whole 5-min epochs (nEpochs = ceil(window/5min)),
    // so base + codes.length overshoots the real wake. Here the recorded window is 22:00–06:03 but the
    // 97-epoch string spans 22:00 + 97×5min = 06:05. The displayed wake must be the recorded 06:03,
    // NOT 06:05 (which, opened at 06:04, would read as a wake time in the future).
    const codes = '4' + '2'.repeat(96) // 97 epochs = 485 min = 8h05m from 22:00 → 06:05
    const win = actualSleepWindow({
      sleepPhase5Min: codes,
      phaseWindowStart: '2026-07-13T22:00:00.000Z',
      phaseWindowEnd: '2026-07-14T06:03:00.000Z', // ring's real recorded wake, before 06:05
      sleepStart: null,
    })
    expect(win!.start).toBe('2026-07-13T22:05:00.000Z')
    expect(win!.end).toBe('2026-07-14T06:03:00.000Z')
  })

  it('falls back to sleepStart/sleepEnd as the anchors when the phase window is absent', () => {
    const win = actualSleepWindow({
      sleepPhase5Min: '42',
      phaseWindowStart: null,
      phaseWindowEnd: null,
      sleepStart: '2026-07-08T23:00:00.000Z',
      sleepEnd: '2026-07-08T23:12:00.000Z',
    })
    expect(win!.start).toBe('2026-07-08T23:05:00.000Z') // first non-awake is idx 1
    expect(win!.end).toBe('2026-07-08T23:12:00.000Z')   // recorded wake
  })

  it('returns null when there is no hypnogram', () => {
    expect(actualSleepWindow({ sleepPhase5Min: null, sleepStart: '2026-07-08T22:00:00.000Z', sleepEnd: '2026-07-08T23:00:00.000Z' })).toBeNull()
  })

  it('returns null when there is no recorded window end', () => {
    expect(actualSleepWindow({ sleepPhase5Min: '42', phaseWindowStart: '2026-07-08T22:00:00.000Z', sleepEnd: null })).toBeNull()
  })

  it('returns null for an all-awake string (nothing to show)', () => {
    expect(actualSleepWindow({ sleepPhase5Min: '4444', phaseWindowStart: '2026-07-08T22:00:00.000Z', phaseWindowEnd: '2026-07-08T22:20:00.000Z', sleepStart: null })).toBeNull()
  })
})
