import { describe, expect, it, beforeEach } from 'vitest'
import { LBS_TO_KG } from '@trainingai/shared/workout/units'
import { mround125, mroundStep } from '../utils'
import {
  LB_STEP, UNIT_STORAGE_PREFIX, dialRange, fromDisplay, readUnit, toDisplay, writeUnit,
} from '../weight-unit'

/**
 * BF-141 — the lb/kg toggle on the weight dial.
 *
 * The owner logged Dumbbell Lateral Raise, Preacher Curl and Shoulder Press in pounds into the kg
 * field on 2026-06-15; the repair needed an admin preview/apply tool that still ships. These tests
 * are about the one thing that would silently reinstate that: a converted weight passing through a
 * rounding helper that clamps.
 */
describe('converting a dial value for storage', () => {
  it('leaves kilograms exactly alone', () => {
    for (const kg of [0, 2.5, 8.75, 60, 250]) {
      expect(fromDisplay(kg, 'kg')).toBe(kg)
      expect(toDisplay(kg, 'kg')).toBe(kg)
    }
  })

  it('converts pounds at the defined ratio, within the storage precision', () => {
    // The international pound is exactly 0.45359237 kg by definition since 1959. The stored figure
    // is that ratio rounded to 0.25 kg, so it lands within half a step — 100 lb is 45.359237 kg and
    // stores as 45.25. Asserting the unrounded value would be asserting against the rounding.
    for (const lb of [5, 45, 100, 250]) {
      expect(Math.abs(fromDisplay(lb, 'lb') - lb * LBS_TO_KG), `${lb} lb`).toBeLessThanOrEqual(0.125)
    }
  })

  /**
   * **This is the test the entry was written around.** `mround125` and `mroundStep` are
   * `Math.max(5, …)`, so a 5 lb dumbbell — 2.27 kg — comes out of either as **5 kg**, silently more
   * than doubling it. The conversion must not route through them.
   */
  it('does NOT clamp a light dumbbell up to the 5 kg floor', () => {
    const fiveLb = fromDisplay(5, 'lb')
    expect(fiveLb).toBeLessThan(2.5)
    expect(mround125(fiveLb), 'the clamp this must avoid').toBe(5)
    expect(mroundStep(fiveLb, 1.25), 'and its sibling').toBe(5)
    expect(fiveLb, 'the converted value is not snapped to the kg grid either').not.toBe(2.5)
  })

  it('rounds to 0.25 kg for storage and no finer', () => {
    // The precision the 2026-06-15 repair tool used for derived figures. Snapping to the 1.25 kg
    // dial grid instead would reinstate the inaccuracy the toggle exists to remove.
    for (const lb of [5, 12.5, 20, 47.5, 100]) {
      const kg = fromDisplay(lb, 'lb')
      expect(Math.round(kg * 4) / 4, `${lb} lb`).toBe(kg)
    }
  })

  it('round-trips a pound value through the dial without drift', () => {
    for (const lb of [5, 10, 20, 45, 100]) {
      expect(toDisplay(fromDisplay(lb, 'lb'), 'lb')).toBe(lb)
    }
  })

  it('shows kilograms on pound detents, because the kg grid has no pound dumbbell on it', () => {
    // 1.25 kg is 2.76 lb. A 20 lb dumbbell is 9.07 kg and the kg dial offers 8.75 or 10.00.
    expect(toDisplay(9.07, 'lb') % LB_STEP).toBe(0)
    expect(dialRange('lb', 1.25).step).toBe(LB_STEP)
    expect(dialRange('kg', 1.25).step).toBe(1.25)
    expect(dialRange('kg', 2.5).step, 'barbell keeps its own kg step').toBe(2.5)
  })

  it('keeps the pound grid inside the kilogram ceiling', () => {
    const { max } = dialRange('lb', 1.25)
    expect(fromDisplay(max, 'lb')).toBeLessThanOrEqual(250)
  })
})

/**
 * Both vitest projects run `environment: 'node'`, so there is no `localStorage` here — which is the
 * same condition a private-mode browser presents, and the helpers already swallow it. The stub is
 * what lets the per-exercise behaviour be asserted at all; the unstubbed case is covered below.
 */
function stubLocalStorage() {
  const store = new Map<string, string>()
  const api = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
    get length() { return store.size },
  }
  ;(globalThis as { localStorage?: unknown }).localStorage = api
  return api
}

describe('remembering the unit per exercise', () => {
  beforeEach(() => { stubLocalStorage() })

  it('defaults to kilograms, including with no exercise id', () => {
    expect(readUnit('abc')).toBe('kg')
    expect(readUnit(undefined)).toBe('kg')
  })

  it('remembers pounds against one exercise without touching another', () => {
    writeUnit('lateral-raise', 'lb')
    expect(readUnit('lateral-raise')).toBe('lb')
    expect(readUnit('squat'), 'he is 90% metric — one lb exercise must not convert the rest').toBe('kg')
  })

  it('clears the key rather than storing the default', () => {
    writeUnit('x', 'lb')
    writeUnit('x', 'kg')
    expect(localStorage.getItem(UNIT_STORAGE_PREFIX + 'x')).toBeNull()
  })

  it('writes nothing when there is no exercise id', () => {
    writeUnit(undefined, 'lb')
    expect(localStorage.length).toBe(0)
  })

  it('falls back to kilograms when storage is unavailable at all', () => {
    // A private-mode browser throws on access rather than returning null. Reading a unit is not
    // worth a crash on a logging screen, and kilograms is the safe default: the dial's value is
    // stored in kg regardless, so the worst case is a dial that forgot its display preference.
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(readUnit('anything')).toBe('kg')
    expect(() => writeUnit('anything', 'lb')).not.toThrow()
  })
})
