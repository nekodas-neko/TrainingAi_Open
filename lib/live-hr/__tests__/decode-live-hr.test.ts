import { describe, it, expect } from 'vitest'
import { smoothedBpmFromFrames, allBeatsFromFrames } from '@/lib/live-hr/decode-live-hr'

// Build a ring history-event frame hex: tag + length + payload, where payload is
// a 4-byte LE deciseconds timestamp followed by the event body. Mirrors the format
// historyEventFromHex() expects (see lib/oura-ble/decode.ts parseHistoryEvent).
function frameHex(tag: number, ds: number, body: number[]): string {
  const ts = [ds & 0xff, (ds >> 8) & 0xff, (ds >> 16) & 0xff, (ds >> 24) & 0xff]
  const payload = [...ts, ...body]
  return [tag, payload.length, ...payload].map(b => b.toString(16).padStart(2, '0')).join('')
}

// aohr (0x86) body: flag, base_offset, count, then count×(bpm,quality) pairs.
function aohrBody(bpms: number[]): number[] {
  const pairs = bpms.flatMap(b => [b, 1])
  return [0x01, 0x00, bpms.length, ...pairs]
}

describe('smoothedBpmFromFrames', () => {
  it('returns null for no frames', () => {
    expect(smoothedBpmFromFrames([], 0)).toBeNull()
  })

  it('medians the whole batch — NOT the newest single beat', () => {
    // Six beats in one aohr frame: [50,51,52,53,54,55]. The old code returned 55
    // (newest). Median of the six is 53 (sorted[3]). Proves we no longer surface newest.
    const res = smoothedBpmFromFrames([frameHex(0x86, 1000, aohrBody([50, 51, 52, 53, 54, 55]))], 0)
    expect(res).toEqual({ bpm: 53, ringTs: 1000 })
  })

  it('rejects a lone artifact beat via the median', () => {
    // Three steady beats at ts 1000, then a single motion artifact (45) at ts 2000.
    // Newest-beat logic would surface 45; the median of [45,120,121,122] is 121.
    const steady = frameHex(0x86, 1000, aohrBody([120, 122, 121]))
    const artifact = frameHex(0x86, 2000, aohrBody([45]))
    const res = smoothedBpmFromFrames([steady, artifact], 0)
    expect(res).toEqual({ bpm: 121, ringTs: 2000 })
  })

  it('only counts beats newer than afterRingTs (re-drained tail is ignored)', () => {
    // Frame ts 1000 already surfaced (afterRingTs = 1000) → no fresh beats → null.
    expect(smoothedBpmFromFrames([frameHex(0x86, 1000, aohrBody([70, 72]))], 1000)).toBeNull()
  })

  it('advances ringTs to the greatest fresh frame timestamp', () => {
    const older = frameHex(0x86, 1500, aohrBody([80]))
    const newer = frameHex(0x86, 3000, aohrBody([82]))
    const res = smoothedBpmFromFrames([newer, older], 1000)
    // Beats [80,82] (ts order) → median sorted[1] = 82; ringTs = max = 3000.
    expect(res).toEqual({ bpm: 82, ringTs: 3000 })
  })

  it('bounds the median to the most recent window of beats', () => {
    // 12 fresh beats but window is 10: the two oldest (200,200) must be excluded so
    // the median tracks the recent value, not a stale backlog.
    const old = frameHex(0x86, 1000, aohrBody([200, 200])) // excluded by the window
    const recent = frameHex(0x86, 2000, aohrBody([60, 60, 60, 60, 60, 61, 61, 61, 61, 61]))
    const res = smoothedBpmFromFrames([old, recent], 0)
    expect(res?.bpm).toBe(61) // median of ten 60/61 values (sorted[5]) = 61, not skewed by 200s
  })

  it('decodes green_ibi (0x80) frames', () => {
    // b0=0x4b, b1=0x08 → ibi=(0)|(0x4b<<3)=600, quality=1 → 60000/600 = 100 bpm.
    const res = smoothedBpmFromFrames([frameHex(0x80, 1000, [0x4b, 0x08])], 0)
    expect(res).toEqual({ bpm: 100, ringTs: 1000 })
  })

  it('drops out-of-range beats before medianing', () => {
    // count=1, bpm=250 (>220) → no valid beat → null.
    expect(smoothedBpmFromFrames([frameHex(0x86, 1000, aohrBody([250]))], 0)).toBeNull()
  })

  it('ignores non-HR frames', () => {
    const hr = frameHex(0x86, 1000, aohrBody([66, 68]))
    const junk = frameHex(0x84, 1001, [0x10, 0x00]) // ambient_event — no HR
    const res = smoothedBpmFromFrames([hr, junk], 0)
    expect(res).toEqual({ bpm: 68, ringTs: 1000 }) // median of [66,68] sorted[1] = 68
  })
})

describe('allBeatsFromFrames', () => {
  it('returns every valid beat across frames, ignoring timestamp order', () => {
    const a = frameHex(0x86, 2000, aohrBody([60, 61]))
    const b = frameHex(0x86, 1000, aohrBody([120]))
    expect(allBeatsFromFrames([a, b])).toEqual([60, 61, 120])
  })

  it('drops out-of-range beats and non-HR frames', () => {
    const hr = frameHex(0x86, 1000, aohrBody([250, 70])) // 250 out of range
    const junk = frameHex(0x84, 1001, [0x10, 0x00])
    expect(allBeatsFromFrames([hr, junk])).toEqual([70])
  })

  it('returns empty for no frames', () => {
    expect(allBeatsFromFrames([])).toEqual([])
  })
})
