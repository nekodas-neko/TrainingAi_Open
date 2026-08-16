import { describe, it, expect } from 'vitest'
import { mergeCalendarOverlay, readLocalCalendarOverlay, EMPTY_OVERLAY, type CalendarData } from '../local-overlay'

const server: CalendarData = {
  trainedDays: { '2026/08/01': ['Push'], '2026/08/03': ['Legs'] },
  activityDays: { '2026/08/01': ['walk'] },
}

describe('mergeCalendarOverlay', () => {
  it('adds a day the server does not have', () => {
    const merged = mergeCalendarOverlay(server, {
      trainedDays: {},
      activityDays: { '2026/08/05': ['run'] },
    })
    expect(merged.activityDays['2026/08/05']).toEqual(['run'])
    expect(merged.activityDays['2026/08/01']).toEqual(['walk'])
  })

  it('adds to a day the server already has without losing its entries', () => {
    const merged = mergeCalendarOverlay(server, {
      trainedDays: { '2026/08/01': ['Pull'] },
      activityDays: {},
    })
    expect(merged.trainedDays['2026/08/01']).toEqual(['Push', 'Pull'])
  })

  it('does not duplicate an entry the server already lists', () => {
    const merged = mergeCalendarOverlay(server, {
      trainedDays: { '2026/08/01': ['Push'] },
      activityDays: { '2026/08/01': ['walk'] },
    })
    expect(merged.trainedDays['2026/08/01']).toEqual(['Push'])
    expect(merged.activityDays['2026/08/01']).toEqual(['walk'])
  })

  it('never mutates the server payload it was handed', () => {
    const before = JSON.stringify(server)
    mergeCalendarOverlay(server, { trainedDays: { '2026/08/01': ['Pull'] }, activityDays: {} })
    expect(JSON.stringify(server)).toBe(before)
  })

  it('returns the overlay alone when the server payload has not arrived', () => {
    const merged = mergeCalendarOverlay(null, { trainedDays: {}, activityDays: { '2026/08/05': ['run'] } })
    expect(merged.activityDays).toEqual({ '2026/08/05': ['run'] })
    expect(merged.trainedDays).toEqual({})
  })

  it('is a no-op with an empty overlay — the pre-existing server-only behaviour', () => {
    expect(mergeCalendarOverlay(server, EMPTY_OVERLAY)).toEqual(server)
  })

  it('composes two months into one overlay, which is how the home streak spans a month boundary', () => {
    const july: CalendarData = { trainedDays: { '2026/07/31': ['Pull'] }, activityDays: {} }
    const august: CalendarData = { trainedDays: { '2026/08/02': ['Legs'] }, activityDays: {} }
    const merged = mergeCalendarOverlay(server, mergeCalendarOverlay(august, july))
    expect(Object.keys(merged.trainedDays).sort()).toEqual([
      '2026/07/31', '2026/08/01', '2026/08/02', '2026/08/03',
    ])
  })
})

describe('readLocalCalendarOverlay', () => {
  it('is empty without a user, so the web path renders exactly the server payload', async () => {
    const overlay = await readLocalCalendarOverlay(undefined, 2026, 8)
    expect(overlay).toEqual(EMPTY_OVERLAY)
    expect(mergeCalendarOverlay(server, overlay)).toEqual(server)
  })
})
