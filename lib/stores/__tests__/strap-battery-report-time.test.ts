// BF-140 — the strap battery chip could not go stale, so a reading from any point in the past
// rendered as current.
//
// `PolarStrapService.battery` is written once per connection and never cleared, and the JS stamped
// `at: Date.now()` every time it read it. The stored time was therefore *when JS last looked*, not
// when the strap last reported — so `ageMinutes` reset on every Home mount, `stale` was permanently
// false, and `DeviceBatteryChip` never dimmed and never named an age. The owner's screenshot showed
// a months-old 100% at full opacity, which is exactly what that code believed.
//
// **This file tests the JS half only.** The native half (`batteryAt` in `status()`) cannot run here:
// `getPolarBle()` returns null off-device and there is no Android SDK in the sandbox. What is
// testable is the contract between them, including the version-skew case that matters in practice.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readStrapBattery, writeStrapBattery } from '../strap-battery'

// `node` environment, so `window` is stubbed the way the sibling `strap-battery.test.ts` does it.
const store = new Map<string, string>()

const STALE_AFTER_MINUTES = 180

const ageMinutes = (at: number, now: number) => Math.max(0, (now - at) / 60_000)

describe('BF-140 — a strap reading carries its own time', () => {
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v) },
      },
    })
  })

  it('stores the reported time when native supplies one', () => {
    const reportedAt = Date.now() - 5 * 60 * 60 * 1000   // five hours ago
    writeStrapBattery(100, reportedAt)
    expect(readStrapBattery()?.at).toBe(reportedAt)
  })

  it('a five-hour-old reading reads as STALE, which is the whole bug', () => {
    const reportedAt = Date.now() - 5 * 60 * 60 * 1000
    writeStrapBattery(100, reportedAt)
    const stored = readStrapBattery()!
    // Before the fix this was ~0 on every mount, so the chip stayed bright indefinitely.
    expect(ageMinutes(stored.at, Date.now())).toBeGreaterThan(STALE_AFTER_MINUTES)
  })

  it('re-recording the SAME reading does not refresh its age', () => {
    const reportedAt = Date.now() - 4 * 60 * 60 * 1000
    writeStrapBattery(100, reportedAt)
    // A second Home mount reads the same unchanged native field and records it again.
    writeStrapBattery(100, reportedAt)
    expect(ageMinutes(readStrapBattery()!.at, Date.now())).toBeGreaterThan(STALE_AFTER_MINUTES)
  })

  // The version-skew case: the JS half ships through Railway, the native half waits for an APK, so
  // there is a real window where the new bundle runs against an APK that sends no `batteryAt`.
  it('falls back to now when native sends no time, rather than storing undefined', () => {
    writeStrapBattery(100, undefined)
    const stored = readStrapBattery()!
    expect(Number.isFinite(stored.at)).toBe(true)
    expect(ageMinutes(stored.at, Date.now())).toBeLessThan(1)
  })

  it('falls back when native sends a non-finite time', () => {
    writeStrapBattery(100, Number.NaN)
    const stored = readStrapBattery()!
    // A NaN would make ageMinutes NaN, leaving the chip neither fresh nor stale.
    expect(Number.isFinite(stored.at)).toBe(true)
  })

  it('still refuses an implausible percentage whatever the time says', () => {
    writeStrapBattery(0, Date.now())
    writeStrapBattery(101, Date.now())
    expect(readStrapBattery()).toBeNull()
  })

  // The hook is where the defect actually lived — it called `writeStrapBattery(percent)` with no
  // time, so the store's `Date.now()` default did the damage. Checked from source because the hook
  // needs a live Capacitor plugin, and `getPolarBle()` returns null everywhere this can run.
  it('the hook passes the reported time to both writers', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('lib/hooks/use-strap-battery.ts', 'utf8')
    expect(src).toContain('record(s.battery, s.batteryAt)')
    expect(src).toContain('record(status.battery, status.batteryAt)')
    // The bare form is what re-stamped an old reading on every mount.
    expect(src).not.toMatch(/record\((?:s|status)\.battery\)/)
    expect(src).toContain('writeStrapBattery(percent, at ?? undefined)')
  })

  // The contract with the native side, checked from source: the field must be published, and it
  // must be stamped where the reading arrives rather than where it is read.
  it('the native service stamps and publishes the report time', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('android/app/src/main/java/com/trainingai/app/polar/PolarStrapService.kt', 'utf8')
    expect(src).toContain('private var batteryAt: Long? = null')
    expect(src).toMatch(/battery = percent\s*\n\s*batteryAt = System\.currentTimeMillis\(\)/)
    expect(src).toContain('.put("batteryAt", batteryAt ?: JSONObject.NULL)')
  })
})
