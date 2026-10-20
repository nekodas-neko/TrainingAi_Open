import { describe, it, expect } from 'vitest'
import { dropFirstHandCopies, isFirstHandCopy, OURA_APP_PACKAGE } from '../health-connect-origin'

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
