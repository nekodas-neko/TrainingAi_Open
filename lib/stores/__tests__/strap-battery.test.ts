import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readStrapBattery, writeStrapBattery, STRAP_BATTERY_KEY } from '../strap-battery'

/**
 * Q-111 — the strap's last-seen battery, and the two writers that must land in one place.
 *
 * The entry claimed **no JS call site reads the strap battery**. One does:
 * `chest-strap-pairing.tsx` reads the Battery Service characteristic over browser BLE while
 * pairing, because at that moment the native service is not running. So the defect was never a
 * missing read — it was **two numbers in two screens with no relationship**, which is the class
 * this repo keeps paying for. These cases pin the store and both of its writers.
 */

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    },
  })
})

describe('the store', () => {
  it('round-trips a reading with its age', () => {
    writeStrapBattery(72, 1_700_000_000_000)
    expect(readStrapBattery()).toEqual({ percent: 72, at: 1_700_000_000_000 })
  })

  it('is empty rather than wrong when nothing has been stored', () => {
    expect(readStrapBattery()).toBeNull()
  })

  it.each([
    ['null, which is what the strap reports before its first read completes', null],
    ['undefined', undefined],
    ['zero, which would render as a flat battery forever', 0],
    ['over 100', 101],
    ['NaN', Number.NaN],
  ])('refuses to store %s', (_label, value) => {
    writeStrapBattery(value as number | null | undefined)
    expect(readStrapBattery()).toBeNull()
  })

  it.each([
    ['a value that is not JSON', 'not json'],
    ['the wrong shape', '{"level":72}'],
    ['an out-of-range percentage', '{"percent":250,"at":1}'],
    ['a missing timestamp', '{"percent":72}'],
  ])('drops %s rather than rendering it', (_label, raw) => {
    store.set(STRAP_BATTERY_KEY, raw)
    expect(readStrapBattery()).toBeNull()
  })

  it('survives a localStorage that throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => { throw new Error('blocked') },
        setItem: () => { throw new Error('full') },
      },
    })
    expect(() => writeStrapBattery(50)).not.toThrow()
    expect(readStrapBattery()).toBeNull()
  })
})

const ROOT = path.resolve(__dirname, '../../..')
const source = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('both writers reach the one store', () => {
  it('the native status listener records it', () => {
    const src = source('lib/hooks/use-strap-battery.ts')
    expect(src).toMatch(/addListener\('polarStatus'/)
    expect(src).toMatch(/getStatus\(\)\)\.battery/)
    expect(src).toContain('writeStrapBattery')
  })

  it('the pairing screen records it too, rather than only showing it', () => {
    // This is the half the entry said did not exist. It stays a direct characteristic read — the
    // native service is not running during pairing — but it no longer ends at a local `useState`.
    const src = source('components/settings/chest-strap-pairing.tsx')
    expect(src).toContain('writeStrapBattery(level)')
  })

  it('the chip reads the strap through the hook, not from its own source', () => {
    const src = source('components/home/header-chips.tsx')
    expect(src).toMatch(/useStrapBattery\(\)/)
    expect(src).not.toMatch(/BleClient|localStorage/)
  })

  it('the ring chip reuses the existing key, endpoint, TTL and variant', () => {
    // A second key for one endpoint is what causes stale and blank first paints; a divergent TTL
    // fails `check-cache-ttl-divergence`. Both are asserted here so the reason survives the diff.
    const src = source('components/home/header-chips.tsx')
    expect(src).toContain("'oura-ble-battery-latest', '/api/oura-ble/battery-latest', TTL_MEDIUM")
    expect(src).toContain('today: true')
  })

  it('the header row does not fetch once and stop', () => {
    // It sits in the persistent tab shell, so a `useEffect(…, [])` around `cachedFetch` would hold
    // its first payload until the app is killed — Q-402. `check-fetch-once-effects` caught the
    // first draft of this file doing exactly that, which is why the rule is asserted here too.
    const src = source('components/home/header-chips.tsx')
    expect(src).toContain('useCachedValue')
    expect(src).not.toMatch(/useEffect\s*\(/)
  })
})
