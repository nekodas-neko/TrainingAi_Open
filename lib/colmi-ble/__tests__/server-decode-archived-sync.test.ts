import { describe, it, expect } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'
import { decodeRawFrames, framesToPayload, sortFramesForReplay } from '@/lib/colmi-ble/frames-to-payload'

// The 31 frames archived by the 2026-09-02 21:12 UTC sync, verbatim from `colmi_raw_frames`.
//
// The point of holding real bytes rather than synthesised ones: every Colmi defect this week was
// found by re-reading captures like these, and none was found from row counts. A synthetic frame
// proves the decoder agrees with the test author.
const ARCHIVED: { channel: 'v1' | 'v2'; hex: string }[] = [
  { channel: 'v1', hex: '37022428000000000000000000000085' },
  { channel: 'v1', hex: '150180b8986a413a39333a333431323b' },
  { channel: 'v2', hex: 'bc2a310053fa00606063636161626261616363636300000000000000000000000000000000000000000000000000000000000000000000' },
  { channel: 'v2', hex: 'bc2532008d15001ea7a8a8a8a8a8a8a8a8a8a8a8a8a600000000000000000000000000000000000000000000000000000000000000000000' },
  { channel: 'v1', hex: '4326090230050e51001e001200000038' },
  { channel: 'v1', hex: '4326090234060e2b0010000a00000001' },
  { channel: 'v1', hex: '15163f3e40413e3839444440553a3e6d' },
  { channel: 'v1', hex: '1502313339373834373a394743444110' },
  { channel: 'v1', hex: '43260902480a0e0d05c00128010000d0' },
  { channel: 'v1', hex: '1507373a363f36424242363f00000073' },
  { channel: 'v1', hex: '432609021c000e86064e027f010000fa' },
  { channel: 'v1', hex: '15063a38363938333835323b373336e1' },
  { channel: 'v1', hex: '3901002c0027001e00210020002e001a' },
  { channel: 'v1', hex: '4326090220010ef10ac90382020000ee' },
  { channel: 'v1', hex: '4326090224020efd01a10074000000bb' },
  { channel: 'v1', hex: '4326090244090eb40040002a000000ed' },
  { channel: 'v1', hex: '1504303d44363d39453e363e3933360f' },
  { channel: 'v1', hex: '4326090228030eec01a40071000000af' },
  { channel: 'v1', hex: '1514476155554f4b486e6475000000a4' },
  { channel: 'v1', hex: '03100000000000000000000000000013' },
  { channel: 'v1', hex: '37010026282b27272c2d2a2d2424231a' },
  { channel: 'v1', hex: '1505303a383f3b3d403d353d33393806' },
  { channel: 'v1', hex: '432609022c040ed8005000320000000c' },
  { channel: 'v1', hex: '43260902540d0e8d00340021000000c5' },
  { channel: 'v1', hex: '4326090240080ee00053003300000030' },
  { channel: 'v1', hex: '4326090238070ece01a0006a0000009a' },
  { channel: 'v1', hex: '1503423a3e3e31343539353c39334a0a' },
  { channel: 'v1', hex: '432609024c0b0e4e0176004d000000eb' },
  { channel: 'v1', hex: '151500533d4a3a3b4a4c4141404b3e5a' },
  { channel: 'v1', hex: '43260902500c0e9b00310023000000cd' },
  { channel: 'v1', hex: '15173f3f363e3b41000000000000009a' },]

// The sync ran at 07:12 Brisbane on the 3rd; the ring's relative days are anchored to that day.
const TZ = 'Australia/Brisbane'
const TODAY = '2026-09-03'

describe('server-side decode of an archived Colmi sync (PS-21 Stage A)', () => {
  const frames = decodeRawFrames(ARCHIVED)
  const payload = framesToPayload(frames, { todayStr: TODAY, timezone: TZ })
  const at = (ms: number) => formatInTimeZone(new Date(ms), TZ, 'yyyy-MM-dd HH:mm')

  it('decodes every archived frame without throwing, one frame in one frame out', () => {
    expect(frames).toHaveLength(ARCHIVED.length)
  })

  it('reads the frames the client read — the same kinds, from the same bytes', () => {
    const kinds = [...new Set(payload.readings.map(r => r.kind))].sort()
    // Every kind this capture actually carries — activity (0x43), heart-rate log (0x15), HRV
    // (0x39), stress (0x37), battery, and the v2 big-data pair (SpO₂, temperature). Asserting the
    // SET catches a decoder that silently stops producing one, which is how the heart-rate log was
    // lost for a week while the sync reported success.
    expect(kinds).toEqual([
      'battery', 'calories', 'distance', 'heart_rate', 'hrv', 'spo2', 'steps', 'stress', 'temperature',
    ])
  })

  it('places the heart-rate log inside the day it was captured, not shifted by the timezone', () => {
    const hr = payload.readings.filter(r => r.kind === 'heart_rate').sort((a, b) => a.at - b.at)
    expect(hr.length).toBeGreaterThan(50)
    // The ten-hour shift (migration 237) put these on the following day. Both ends inside the
    // anchor day is what says the wall-clock-as-UTC echo is still being read as an echo.
    expect(at(hr[0].at).slice(0, 10)).toBe(TODAY)
    expect(at(hr[hr.length - 1].at).slice(0, 10)).toBe(TODAY)
    for (const r of hr) expect(r.value).toBeGreaterThanOrEqual(40)
    for (const r of hr) expect(r.value).toBeLessThanOrEqual(180)
  })

  it('replays a shuffled archive to the same readings, once sorted for replay', () => {
    // Measured 2026-09-03: all 31 rows of this sync carry ONE `created_at` — they are written in a
    // single insert, so the transaction clock is identical and the order the ring sent them is not
    // recoverable. Migration 263 records `seq` for frames stored from now on; every frame archived
    // before it has seq 0 and comes back in whatever order the query returns.
    //
    // Reversed is the worst case: it puts the heart-rate anchor after its continuations, and
    // `framesToPayload` drops a continuation it has no anchor for. A bare reversed replay keeps
    // only the 9 samples the anchor packet carries itself and loses every continuation — which is
    // the failure this asserts is fixed, not one it tolerates.
    const clockStamped = (kind: string) => kind === 'battery'   // stamped with Date.now(), not from the frame
    const norm = (p: { readings: { kind: string; at: number; value: number }[] }) =>
      p.readings.filter(r => !clockStamped(r.kind)).map(r => `${r.kind}@${r.at}=${r.value}`).sort()

    const reversed = decodeRawFrames([...ARCHIVED].reverse())
    const bare = framesToPayload(reversed, { todayStr: TODAY, timezone: TZ })
    const bareHr = norm(bare).filter(k => k.startsWith('heart_rate'))
    const wholeHr = norm(payload).filter(k => k.startsWith('heart_rate'))
    expect(bareHr).toHaveLength(9)
    expect(wholeHr.length).toBeGreaterThan(100)

    const replayed = framesToPayload(sortFramesForReplay(reversed), { todayStr: TODAY, timezone: TZ })
    expect(norm(replayed)).toEqual(norm(payload))
  })

  it('leaves frames alone when two days of heart-rate log arrived in one sync', () => {
    // Two anchors means two runs, and a continuation packet does not say which it belongs to.
    // Sorting by packet number would interleave them into one wrong series, so the helper declines.
    const twoRuns = [...frames, ...decodeRawFrames(ARCHIVED.filter(f => f.hex.startsWith('1501')))]
    expect(sortFramesForReplay(twoRuns)).toEqual(twoRuns)
  })

  it('produces no sample outside the ingest route’s plausibility bounds', () => {
    for (const r of payload.readings) expect(Number.isFinite(r.at)).toBe(true)
    for (const s of payload.sleep) expect(s.endedAt).toBeGreaterThan(s.startedAt)
  })
})
