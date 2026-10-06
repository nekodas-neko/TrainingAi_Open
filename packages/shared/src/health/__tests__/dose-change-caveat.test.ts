// #2184 — name a logged dose start, stop or change inside the maintenance window. Supplement-agnostic,
// and a caveat only: nothing here feeds a number.
import { describe, it, expect } from 'vitest'
import {
  doseChangesInWindow, doseChangeCaveat, type DoseLogEntry, type SupplementCourse,
} from '../dose-change-caveat'
import { formatDateDisplay } from '../../date-utils'

const RETA = 'sup-reta'
const reta = (date: string, amount: number | null, doseText: string | null = null, unit: string | null = 'mg'): DoseLogEntry =>
  ({ supplementId: RETA, supplementName: 'Retatrutide', date, amount, unit, doseText })
const vitD = (date: string, doseText: string | null, amount: number | null = null): DoseLogEntry =>
  ({ supplementId: 'sup-d', supplementName: 'Vitamin D', date, amount, unit: null, doseText })

// A 28-day window ending the day before 2026-10-06, the shape the service passes.
const WIN_START = '2026-09-08'
const WIN_END = '2026-10-05'
const changes = (logs: DoseLogEntry[], courses: SupplementCourse[] = []) =>
  doseChangesInWindow(logs, courses, WIN_START, WIN_END)

describe('doseChangesInWindow', () => {
  it('reads the first logged dose inside the window as a start', () => {
    expect(changes([reta('2026-09-10', 0.5)])).toEqual([
      { supplementId: RETA, supplementName: 'Retatrutide', date: '2026-09-10', kind: 'start' },
    ])
  })

  it('does not call a dose a start when the substance was logged before the window', () => {
    expect(changes([reta('2026-09-01', 0.5), reta('2026-09-15', 0.5)])).toEqual([])
  })

  it('reads an amount change as a change, even when the previous dose was before the window', () => {
    expect(changes([reta('2026-09-01', 0.5), reta('2026-09-13', 1)]).map(c => [c.date, c.kind]))
      .toEqual([['2026-09-13', 'change']])
  })

  it('reads a unit change as a change', () => {
    expect(changes([reta('2026-09-01', 1, null, 'mg'), reta('2026-09-13', 1, null, 'g')]).map(c => c.kind))
      .toEqual(['change'])
  })

  it('compares the amount, not the text, when an amount exists — the vial-strength trap', () => {
    // The owner's real first row: dose_text is the 10 mg VIAL, the amount is the 0.5 mg dose.
    const logs = [reta('2026-09-01', 0.5, '10mg'), reta('2026-09-13', 0.5, '0.5 mg')]
    expect(changes(logs)).toEqual([])
  })

  it('falls back to the text only when neither dose has an amount', () => {
    const logs = [vitD('2026-09-01', '1 capsule'), vitD('2026-09-20', '2 capsules')]
    expect(changes(logs).map(c => [c.supplementName, c.date, c.kind])).toEqual([['Vitamin D', '2026-09-20', 'change']])
  })

  it('ignores whitespace and case in the text comparison', () => {
    expect(changes([vitD('2026-09-01', '2 Capsules'), vitD('2026-09-20', '2capsules')])).toEqual([])
  })

  it('does not read a dose gaining a value as a change (null → value)', () => {
    expect(changes([vitD('2026-09-01', null), vitD('2026-09-20', '2 capsules')])).toEqual([])
    expect(changes([vitD('2026-09-01', '2 capsules'), vitD('2026-09-20', null, 2)])).toEqual([])
  })

  it('does not let a dose that skipped the amount make the next one look changed', () => {
    const logs = [reta('2026-09-01', 1), reta('2026-09-10', null, 'injection'), reta('2026-09-17', 1)]
    expect(changes(logs)).toEqual([])
  })

  it('treats two logs on the first day as one start', () => {
    expect(changes([reta('2026-09-10', 0.5), reta('2026-09-10', 1)]).map(c => c.kind)).toEqual(['start'])
  })

  it('reads a definition stopped inside the window as a stop, only when it was taken', () => {
    const courses: SupplementCourse[] = [
      { supplementId: RETA, supplementName: 'Retatrutide', stoppedOn: '2026-09-25' },
      { supplementId: 'never-taken', supplementName: 'Fish oil', stoppedOn: '2026-09-25' },
    ]
    expect(changes([reta('2026-09-01', 1)], courses)).toEqual([
      { supplementId: RETA, supplementName: 'Retatrutide', date: '2026-09-25', kind: 'stop' },
    ])
  })

  it('ignores events outside the window on both sides', () => {
    expect(changes([reta('2026-10-06', 0.5)])).toEqual([])
    expect(changes([reta('2026-08-01', 0.5), reta('2026-08-20', 1)])).toEqual([])
  })

  it('keys identity on the supplement id, not the name', () => {
    const a: DoseLogEntry = { supplementId: 'a', supplementName: 'Creatine', date: '2026-09-01', amount: 5, unit: 'g', doseText: null }
    const b: DoseLogEntry = { supplementId: 'b', supplementName: 'Creatine', date: '2026-09-20', amount: 3, unit: 'g', doseText: null }
    // A second definition with the same name is a new substance starting, not a dose change.
    expect(changes([a, b]).map(c => [c.supplementId, c.kind])).toEqual([['b', 'start']])
  })

  it('reproduces the owner\'s retatrutide series as a start and a change, oldest first', () => {
    const logs = [reta('2026-09-07', 0.5, '10mg'), reta('2026-09-13', 1), reta('2026-09-20', 1)]
    expect(doseChangesInWindow(logs, [], '2026-09-01', '2026-09-28').map(c => [c.date, c.kind]))
      .toEqual([['2026-09-07', 'start'], ['2026-09-13', 'change']])
  })
})

describe('doseChangeCaveat', () => {
  const d = formatDateDisplay

  it('is null when nothing changed', () => {
    expect(doseChangeCaveat([])).toBeNull()
  })

  it('names one change and anchors "since" on it', () => {
    const text = doseChangeCaveat([{ supplementId: RETA, supplementName: 'Retatrutide', date: '2026-09-13', kind: 'change' }])
    expect(text).toBe(`You changed your Retatrutide dose on ${d('2026-09-13')}, so weight changes since ${d('2026-09-13')} may not reflect your metabolism.`)
  })

  it('names two events and anchors "since" on the earlier', () => {
    const text = doseChangeCaveat([
      { supplementId: RETA, supplementName: 'Retatrutide', date: '2026-09-07', kind: 'start' },
      { supplementId: RETA, supplementName: 'Retatrutide', date: '2026-09-13', kind: 'change' },
    ])
    expect(text).toBe(`You started Retatrutide on ${d('2026-09-07')} and changed your Retatrutide dose on ${d('2026-09-13')}, so weight changes since ${d('2026-09-07')} may not reflect your metabolism.`)
  })

  it('counts the rest past two', () => {
    const text = doseChangeCaveat([
      { supplementId: 'a', supplementName: 'Creatine', date: '2026-09-07', kind: 'start' },
      { supplementId: RETA, supplementName: 'Retatrutide', date: '2026-09-13', kind: 'change' },
      { supplementId: RETA, supplementName: 'Retatrutide', date: '2026-09-27', kind: 'change' },
      { supplementId: 'c', supplementName: 'Fish oil', date: '2026-09-28', kind: 'stop' },
    ])
    expect(text).toBe(`You started Creatine on ${d('2026-09-07')}, changed your Retatrutide dose on ${d('2026-09-13')} and made 2 other dose changes, so weight changes since ${d('2026-09-07')} may not reflect your metabolism.`)
  })
})
