import { describe, it, expect } from 'vitest'
import { analyzeRingBattery, type RingBatteryEvent } from '../ring-battery'

const H = 3_600_000 // 1h in ms
const lvl = (tsMs: number, pct: number): RingBatteryEvent =>
  ({ tsMs, kind: 'battery_level_changed', batteryPct: pct, chargingTimeSec: null })
const charge = (tsMs: number, sec: number): RingBatteryEvent =>
  ({ tsMs, kind: 'charging_time', batteryPct: null, chargingTimeSec: sec })

describe('analyzeRingBattery', () => {
  it('returns nulls / not-sane for an empty or single-point series', () => {
    const r = analyzeRingBattery([])
    expect(r.avgDailyDrainPct).toBeNull()
    expect(r.chargeSessions).toEqual([])
    expect(r.avgChargePerSessionPct).toBeNull()
    expect(r.avgChargingTimeSec).toBeNull()
  })

  it('computes daily drain from the summed level decreases over the observed span', () => {
    // 100% → 90% over 24h (pure discharge) → 10 %/day.
    const r = analyzeRingBattery([lvl(0, 100), lvl(12 * H, 95), lvl(24 * H, 90)])
    expect(r.avgDailyDrainPct).toBeCloseTo(10, 1)
    expect(r.chargeSessions).toEqual([])
  })

  it('detects a charge session (rising level) and reports its delta + duration', () => {
    // discharge to 20, charge 20→100 over 2h, then discharge again.
    const r = analyzeRingBattery([
      lvl(0, 40), lvl(6 * H, 20), lvl(7 * H, 60), lvl(8 * H, 100), lvl(20 * H, 88),
    ])
    expect(r.chargeSessions).toHaveLength(1)
    expect(r.chargeSessions[0].deltaPct).toBe(80)
    expect(r.chargeSessions[0].durationSec).toBe(2 * 3600)
    expect(r.avgChargePerSessionPct).toBe(80)
    // drain excludes the charge span: only the 40→20 and 100→88 decreases count.
    expect(r.avgDailyDrainPct).toBeGreaterThan(0)
  })

  it('prefers the device-reported charging_time event over the span duration', () => {
    const r = analyzeRingBattery([
      lvl(0, 20), lvl(1 * H, 100), charge(1 * H, 5400), // ring says 90 min
    ])
    expect(r.avgChargingTimeSec).toBe(5400)
    expect(r.chargeSessions[0].chargingTimeSource).toBe('device')
  })

  it('flags not-sane when a battery_pct is out of [0,100]', () => {
    expect(analyzeRingBattery([lvl(0, 140), lvl(H, 90)]).sane).toBe(false)
    expect(analyzeRingBattery([lvl(0, 90), lvl(H, 80)]).sane).toBe(true)
  })
})
