import { describe, it, expect } from 'vitest'
import { dropFirstHandCopies, FirstHandFilter, isFirstHandCopy, knownFirstHandSources, OURA_APP_PACKAGE } from '../health-connect-origin'

describe('isFirstHandCopy (#3115)', () => {
  it("skips the Oura app's records only while Oura Cloud is connected", () => {
    expect(isFirstHandCopy(OURA_APP_PACKAGE, { ouraCloud: true })).toBe(true)
    expect(isFirstHandCopy(OURA_APP_PACKAGE, { ouraCloud: false })).toBe(false)
    expect(isFirstHandCopy(OURA_APP_PACKAGE, {})).toBe(false)
    expect(isFirstHandCopy(OURA_APP_PACKAGE, null)).toBe(false)
  })

  it("never skips another app's record or one with no origin", () => {
    for (const origin of ['com.sec.android.app.shealth', 'com.qingniu.renpho', 'com.renpho.health', '', undefined, null])
      expect(isFirstHandCopy(origin, { ouraCloud: true })).toBe(false)
  })
})

describe('isFirstHandCopy per type (#3204)', () => {
  const sources = { ouraCloud: false, ouraCloudTypes: { SleepSession: true, OxygenSaturation: false } }

  it('skips only a type Oura Cloud delivers', () => {
    expect(isFirstHandCopy(OURA_APP_PACKAGE, sources, 'SleepSession')).toBe(true)
    expect(isFirstHandCopy(OURA_APP_PACKAGE, sources, 'OxygenSaturation')).toBe(false)
  })

  it('keeps a type the answer does not list, and never reads the prototype', () => {
    expect(isFirstHandCopy(OURA_APP_PACKAGE, sources, 'Weight')).toBe(false)
    expect(isFirstHandCopy(OURA_APP_PACKAGE, sources, 'constructor')).toBe(false)
  })

  it('keeps another app\'s record of a delivered type', () => {
    expect(isFirstHandCopy('com.sec.android.app.shealth', sources, 'SleepSession')).toBe(false)
  })

  it('falls back to the boolean from a server that sends no per-type answer', () => {
    expect(isFirstHandCopy(OURA_APP_PACKAGE, { ouraCloud: true }, 'SleepSession')).toBe(true)
    expect(isFirstHandCopy(OURA_APP_PACKAGE, { ouraCloud: false }, 'SleepSession')).toBe(false)
  })
})

describe('dropFirstHandCopies (#3115)', () => {
  const rows = [{ o: OURA_APP_PACKAGE }, { o: 'com.sec.android.app.shealth' }, { o: undefined }, { o: OURA_APP_PACKAGE }]
  it('keeps the rest in order and counts what it dropped', () => {
    expect(dropFirstHandCopies(rows, r => r.o, { ouraCloud: true })).toEqual({ kept: [rows[1], rows[2]], skipped: 2 })
  })
  it('drops nothing without a connection', () => {
    expect(dropFirstHandCopies(rows, r => r.o, { ouraCloud: false })).toEqual({ kept: rows, skipped: 0 })
    expect(dropFirstHandCopies(rows, r => r.o, null)).toEqual({ kept: rows, skipped: 0 })
  })
})

describe('knownFirstHandSources, the one cold-start rule (#3197)', () => {
  it('knows the connection only from a payload for today', () => {
    expect(knownFirstHandSources({ ouraCloud: true }, '2026-10-20', '2026-10-20')).toEqual({ ouraCloud: true })
    expect(knownFirstHandSources({ ouraCloud: false }, '2026-10-20', '2026-10-20')).toEqual({ ouraCloud: false })
  })
  it('reads anything else as unknown, which keeps Oura\'s copies', () => {
    expect(knownFirstHandSources({ ouraCloud: true }, '2026-10-19', '2026-10-20')).toBeNull()
    expect(knownFirstHandSources({ ouraCloud: true }, undefined, '2026-10-20')).toBeNull()
    expect(knownFirstHandSources(undefined, '2026-10-20', '2026-10-20')).toBeNull()
    expect(knownFirstHandSources({}, '2026-10-20', '2026-10-20')).toBeNull()
    expect(knownFirstHandSources({ ouraCloud: 'true' }, '2026-10-20', '2026-10-20')).toBeNull()
  })
  it('carries the per-type answer, and drops one that is not a map of booleans (#3204)', () => {
    const types = { SleepSession: true, OxygenSaturation: false }
    expect(knownFirstHandSources({ ouraCloud: false, ouraCloudTypes: types }, '2026-10-20', '2026-10-20'))
      .toEqual({ ouraCloud: false, ouraCloudTypes: types })
    for (const bad of [{ SleepSession: 'yes' }, [true], 'all', null]) {
      expect(knownFirstHandSources({ ouraCloud: false, ouraCloudTypes: bad }, '2026-10-20', '2026-10-20')).toEqual({ ouraCloud: false })
    }
    // Without the boolean the payload is not one we understand, per-type answer or not.
    expect(knownFirstHandSources({ ouraCloudTypes: types }, '2026-10-20', '2026-10-20')).toBeNull()
  })
})

describe('FirstHandFilter (#3197)', () => {
  type R = { id?: string; o?: string }
  const make = (sources: { ouraCloud?: boolean } | null) => new FirstHandFilter<R>(sources, r => r.o, r => r.id)

  it('keeps everything and counts nothing without a connection', () => {
    const f = make({ ouraCloud: false })
    expect(f.keep('Weight', [{ id: 'a', o: OURA_APP_PACKAGE }])).toHaveLength(1)
    expect(f.counts()).toEqual({})
  })
  it('counts per type, and a record seen twice in one pass once', () => {
    const f = make({ ouraCloud: true })
    const oura = { id: 'a', o: OURA_APP_PACKAGE }
    expect(f.keep('HeartRateSeries', [oura, { id: 'b', o: 'other' }])).toEqual([{ id: 'b', o: 'other' }])
    expect(f.keep('HeartRateSeries', [oura])).toEqual([])
    f.keep('Steps', [{ o: OURA_APP_PACKAGE }, { o: OURA_APP_PACKAGE }])
    expect(f.counts()).toEqual({ HeartRateSeries: 1, Steps: 2 })
  })
  it('drops by the record type it is given, with partial scopes (#3204)', () => {
    const f = new FirstHandFilter<R>({ ouraCloud: false, ouraCloudTypes: { HeartRateSeries: true, OxygenSaturation: false } }, r => r.o, r => r.id)
    expect(f.keep('HeartRateSeries', [{ id: 'a', o: OURA_APP_PACKAGE }])).toEqual([])
    expect(f.keep('OxygenSaturation', [{ id: 'b', o: OURA_APP_PACKAGE }])).toHaveLength(1)
    expect(f.counts()).toEqual({ HeartRateSeries: 1 })
  })
})
