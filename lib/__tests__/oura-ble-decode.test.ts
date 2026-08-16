import { describe, it, expect } from 'vitest'
import {
  parseFrame,
  parseHistoryEvent,
  decodeEventBody,
  historyEventFromHex,
  hexToBytes,
  eventName,
  frameLabel,
  measuredAtMs,
  cadenceSecFromDs,
} from '../oura-ble/decode'

const body = (hex: string) => hexToBytes(hex)

describe('oura-ble decode — ported from open_oura events.rs (captured vectors)', () => {
  it('green_ibi_quality (0x80): ibi = (b1&7)|(b0<<3), HR from good beats', () => {
    // Captured Ring-5 0x80 body, resting beats.
    const v = decodeEventBody(0x80, body('9d09940b9d0d9a099a09a62e946e'))!
    expect((v.ibi_ms as number[]).length).toBe(7)
    expect((v.ibi_ms as number[])[0]).toBe(1257) // (0x09&7)|(0x9d<<3) = 1|1256
    // good-quality beats -> plausible resting HR
    for (const hr of v.hr_bpm as number[]) expect(hr).toBeGreaterThanOrEqual(30)
  })

  it('temperatures (0x46/0x69/0x75): i16 LE centi-°C, rejects out-of-range', () => {
    const seven = decodeEventBody(0x46, body('1c0dec0b8d0aa90e1f0dae0c9c0c'))!
    expect((seven.temps_c as number[]).length).toBe(7)
    expect((seven.temps_c as number[])[0]).toBe(33.56)
    expect((seven.temps_c as number[])[3]).toBe(37.53)
    expect(decodeEventBody(0x69, body('6c0d'))!.temps_c).toEqual([34.36])
    // garbage out of sensor range stays raw
    expect(decodeEventBody(0x46, body('ff7f'))).toBeNull()
  })

  it('hrv_event (0x5d): (hr, rmssd) pairs per 5 min', () => {
    const v = decodeEventBody(0x5d, body('3c283e2d3a32'))! // [60,40,62,45,58,50]
    expect(v.hr_bpm).toEqual([60, 62, 58])
    expect(v.rmssd_ms).toEqual([40, 45, 50])
    expect(v.interval_min).toBe(5)
  })

  it('spo2_r_pi (0x8b): header + 3-byte (R BE/16384, PI)', () => {
    const v = decodeEventBody(0x8b, body('00321f8c323795328b9532bb95'))!
    expect((v.r as number[]).length).toBe(4)
    expect((v.r as number[])[0]).toBe(0.783)
    expect((v.perfusion_index as number[]).length).toBe(4)
  })

  it('spo2_event (0x6f): header + %/sample, trailing 0xff sentinel dropped', () => {
    const v = decodeEventBody(0x6f, body('00616263ff'))! // header + 97,98,99 + sentinel
    expect(v.spo2_percent).toEqual([97, 98, 99])
  })

  it('debug_data (0x61) subtype 0x24: battery level + voltage', () => {
    const v = decodeEventBody(0x61, body('245f6810'))!
    expect(v.kind).toBe('battery_level_changed')
    expect(v.battery_pct).toBe(95)
    expect(v.voltage_mv).toBe(4200)
  })

  it('debug_data (0x61) printable → ascii', () => {
    expect(decodeEventBody(0x61, body('6769743b636132323332'))!.ascii).toBe('git;ca2232')
  })

  it('time_sync (0x42): u32 LE unix', () => {
    expect(decodeEventBody(0x42, body('4fd2376a0000000000'))!.unix_time).toBe(1782043215)
  })

  it('state_text (0x45/0x53): state byte + ascii', () => {
    const v = decodeEventBody(0x53, body('016368672e2073746f70706564'))!
    expect(v.state).toBe(1)
    expect(v.text).toBe('chg. stopped')
  })

  it('sleep_phases (0x4b/0x4e/0x5a): 2-bit hypnogram codes', () => {
    const v = decodeEventBody(0x4b, body('001b'))! // 0b00_01_10_11
    expect(v.phases).toEqual(['deep', 'light', 'rem', 'awake'])
  })

  it('ibi_and_amplitude (0x60): fixed 14-byte packet → 6 IBIs', () => {
    const v = decodeEventBody(0x60, body('0102030405060708090a0b0c0d0e'))!
    expect((v.ibi_ms as number[]).length).toBe(6)
    expect((v.amplitude as number[]).length).toBe(6)
  })

  it('unknown tags stay raw (null)', () => {
    expect(decodeEventBody(0x99, body('deadbeef'))).toBeNull()
    expect(decodeEventBody(0x44, body('deadbeef'))).toBeNull() // ibi_event: no decoder in events.rs either
  })
})

describe('oura-ble decode — frame + history-event parsing', () => {
  it('parseFrame is lenient about a padded/short declared length', () => {
    expect(parseFrame(hexToBytes(''))).toBeNull()
    expect(parseFrame(hexToBytes('0d'))).toBeNull() // 1 byte < 2-byte header
    const f = parseFrame(hexToBytes('0d025501'))!
    expect(f.tag).toBe(0x0d)
    expect(Array.from(f.payload)).toEqual([0x55, 0x01])
  })

  it('parseHistoryEvent strips the 4-byte deciseconds timestamp then decodes the body', () => {
    // frame: tag=0x46 (temp) len=6 payload=[ts u32 LE][body 6c0d]
    // timestamp 0x01020304 -> LE 04 03 02 01 ; body 6c0d -> 34.36 °C
    const ev = parseHistoryEvent(parseFrame(hexToBytes('4606040302016c0d'))!)!
    expect(ev.tag).toBe(0x46)
    expect(ev.name).toBe('temp_event')
    expect(ev.timestampDs).toBe(0x01020304)
    expect(ev.bodyHex).toBe('6c0d')
    expect((ev.decoded!.temps_c as number[])[0]).toBe(34.36)
  })

  it('parseHistoryEvent rejects non-history frames (tag < 0x41)', () => {
    expect(parseHistoryEvent(parseFrame(hexToBytes('0d025501'))!)).toBeNull()
  })

  it('historyEventFromHex round-trips a raw frame', () => {
    const ev = historyEventFromHex('4606040302016c0d')!
    expect(ev.name).toBe('temp_event')
    expect(ev.decoded).not.toBeNull()
  })

  it('eventName maps known tags', () => {
    expect(eventName(0x80)).toBe('green_ibi_quality_event')
    expect(eventName(0x00)).toBe('unknown')
  })

  it('frameLabel names history events, command responses and 0x2f sub-ops', () => {
    expect(frameLabel(0x46, null)).toBe('temp_event')          // history event
    expect(frameLabel(0x43, null)).toBe('debug_event')
    expect(frameLabel(0x0d, null)).toBe('battery')             // command response
    expect(frameLabel(0x11, null)).toBe('history_batch_done')
    expect(frameLabel(0x2f, 0x23)).toBe('set_feature_mode_ack') // ext sub-op
    expect(frameLabel(0x2f, 0x2c)).toBe('nonce')
    expect(frameLabel(0x2f, 0x99)).toBe('ext_0x99')            // unmapped sub-op
    expect(frameLabel(0x07, null)).toBe('cmd_0x07')            // unmapped command
  })

  it('measuredAtMs anchors ring deciseconds to wall-clock', () => {
    const anchorDs = 1_650_000
    const anchorUtc = 1_700_000_000_000 // arbitrary epoch ms
    // The anchor event maps to exactly the anchor time.
    expect(measuredAtMs(anchorDs, anchorDs, anchorUtc)).toBe(anchorUtc)
    // An event 6000 ds (= 600 s = 10 min) earlier maps 10 min before the anchor.
    expect(measuredAtMs(anchorDs - 6000, anchorDs, anchorUtc)).toBe(anchorUtc - 600_000)
    // A later event maps after the anchor.
    expect(measuredAtMs(anchorDs + 100, anchorDs, anchorUtc)).toBe(anchorUtc + 10_000)
  })

  // ── decoders ported from events.rs (vectors copied from the Rust tests) ──

  it('decodes activity_information MET scaling', () => {
    const v = decodeEventBody(0x50, body('030a8090'))!
    expect(v.state).toBe(3)
    expect(v.met).toEqual([1.0, 12.8, 16.0]) // 10×0.1; boundary; 12.8+16×0.2
  })

  it('decodes motion_event orientation, axes and intensities', () => {
    const v = decodeEventBody(0x47, new Uint8Array([0x6f, 0x0c, 0x1d, 0x07, 0x0c, 0x07]))!
    expect(v.orientation).toBe(3)
    expect(v.motion_seconds).toBe(0x0f)
    expect(v.avg_x).toBe(12 * 8)
    expect(v.avg_y).toBe(29 * 8)
    expect(v.avg_z).toBe(7 * 8)
    expect(v.low_intensity).toBe(12)
    expect(v.high_intensity).toBe(7)
  })

  it('decodes bedtime_period real bytes (~7.28h window)', () => {
    const v = decodeEventBody(0x76, body('74376100e6366500'))!
    expect(v.bedtime_start_ds).toBe(6_371_188)
    expect(v.bedtime_end_ds).toBe(6_633_190)
    expect(v.duration_hours).toBe(7.28)
  })

  it('decodes sleep_acm_period fixed-point MAD stats', () => {
    const v = decodeEventBody(0x72, body('b1004601f0001e003e000200'))!
    const m = v.acm_mad as number[]
    expect(m).toHaveLength(6)
    expect(m[0]).toBe(0.6941) // 177/255
    expect(m[1]).toBe(1.2745) // 1 + 70/255
  })

  it('decodes motion_period packed 2-bit levels', () => {
    const v = decodeEventBody(0x6b, body('30abefaa596ea89669197afffffb'))!
    expect(v.period_type).toBe(0)
    expect(v.motion_levels as number[]).toHaveLength(51) // 12×4 + final-byte 3
  })

  it('decodes feature_session with optional value', () => {
    const v = decodeEventBody(0x6c, new Uint8Array([0x02, 0x01, 0x05, 0x00]))!
    expect(v).toMatchObject({ feature_id: 2, session_status: 1, value: 5 })
  })

  it('decodes u16 sample bodies (ambient / intensity)', () => {
    expect(decodeEventBody(0x59, body('1000ff00'))).toEqual({ ambient: [16, 255] })
    expect(decodeEventBody(0x74, body('0102'))).toEqual({ intensity: [513] })
  })

  it('decodes cva_raw_ppg cumulative deltas', () => {
    const v = decodeEventBody(0x81, body('8029c50702fefefefdfafbf7fd03'))!
    expect(v.n).toBe(14)
    const s = v.ppg_samples as number[]
    expect(s.slice(0, 4)).toEqual([-128, -87, -146, -139])
    expect(s[s.length - 1]).toBe(-166)
  })

  it('decodes alert_event first byte', () => {
    expect(decodeEventBody(0x56, new Uint8Array([9]))).toEqual({ alert_type: 9 })
  })

  it('decodes telemetry kinds preserving raw body', () => {
    expect(decodeEventBody(0x5b, body('0a01'))).toMatchObject({ kind: 'ble_connection_ind', subtype: 0x0a, raw: '0a01' })
    expect(decodeEventBody(0x82, body('01'))).toMatchObject({ kind: 'scan_start' })
  })

  it('decodes aohr samples at 1920ms (unvalidated)', () => {
    const b = new Uint8Array([0x01, 0x00, 0x06, 50, 1, 51, 1, 52, 1, 53, 1, 54, 1, 55, 1])
    const v = decodeEventBody(0x86, b)!
    expect(v.bpm).toEqual([50, 51, 52, 53, 54, 55])
    expect((v.quality as number[]).length).toBe(6)
    expect(v.interval_ms).toBe(1920)
    expect(v._status).toBe('unvalidated')
  })

  it('decodes ambient_event signed samples (unvalidated)', () => {
    expect((decodeEventBody(0x84, body('1000ffff'))!).values).toEqual([16, -1])
  })

  it('decodes atlas_raw_bioz delta + 24-bit escape (unvalidated)', () => {
    const v = decodeEventBody(0x88, new Uint8Array([5, 5, 0x80, 0x64, 0x00, 0x00]))!
    expect(v.samples).toEqual([5, 10, 100])
  })

  it('decodes sleep summaries structurally (unvalidated)', () => {
    const s1 = decodeEventBody(0x49, body('0a001400'))!
    expect(s1).toMatchObject({ start_offset_min: 10, end_offset_min: 20, _status: 'unvalidated' })
    const s4 = decodeEventBody(0x58, body('01000000020003'))!
    expect(s4).toMatchObject({ field_a_u32: 1, field_b_u16: 2, field_c_u8: 3 })
    // wrong lengths stay raw
    expect(decodeEventBody(0x4c, body('0102'))).toBeNull()
    expect(decodeEventBody(0x4f, body('0102'))).toBeNull()
  })

  it('decodes real_steps bit-packed fields (unvalidated)', () => {
    // p[0]=1,p[3]=0x80 → field0 = (0x80>>7) | (1<<1) = 3; p[3]&0x7f = 0
    const v = decodeEventBody(0x7e, new Uint8Array([1, 2, 3, 0x80, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))!
    const f = v.fields as number[]
    expect(f[0]).toBe(3)
    expect(f[1]).toBe(4) // 2<<1
    expect(f[3]).toBe(0)
    expect(f).toHaveLength(14)
  })

  it('cadenceSecFromDs returns the median inter-event gap in seconds', () => {
    // gaps of 3000 ds (300 s) between samples → 300 s cadence.
    expect(cadenceSecFromDs([0, 3000, 6000, 9000])).toBe(300)
    // duplicate timestamps (same-event batches) are ignored.
    expect(cadenceSecFromDs([1000, 1000, 1000])).toBeNull()
    expect(cadenceSecFromDs([5000])).toBeNull()
    // unsorted input is handled.
    expect(cadenceSecFromDs([9000, 0, 3000, 6000])).toBe(300)
  })
})
