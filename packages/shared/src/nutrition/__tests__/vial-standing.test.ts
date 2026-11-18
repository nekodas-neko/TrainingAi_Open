import { describe, expect, it } from 'vitest'
import { doseTimelineText, vialStanding } from '../vial-plan'

// #2185 — the dose row on Home's timeline: "Week N of this vial · M doses left".
const VIALS = [
  { strengthMg: 20, openedOn: '2026-10-01' },
  { strengthMg: 10, openedOn: '2026-08-01' },
]
const dose = (date: string, amount: number | null = 2, takenAt: string | null = `${date}T08:00:00+10:00`) => ({
  date, amount, unit: 'mg', takenAt,
})

describe('vialStanding', () => {
  it('counts the week from the day the vial was mixed', () => {
    expect(vialStanding(dose('2026-10-01'), VIALS, [dose('2026-10-01')])?.week).toBe(1)
    expect(vialStanding(dose('2026-10-07'), VIALS, [dose('2026-10-07')])?.week).toBe(1)
    expect(vialStanding(dose('2026-10-08'), VIALS, [dose('2026-10-08')])?.week).toBe(2)
  })

  it('takes this dose and every earlier one from this vial out of its strength', () => {
    const logs = [dose('2026-10-01'), dose('2026-10-08'), dose('2026-10-15')]
    // 20 mg − 3 × 2 mg = 14 mg → 7 doses of 2 mg.
    expect(vialStanding(dose('2026-10-15'), VIALS, logs)).toEqual({ week: 3, dosesLeft: 7 })
  })

  it('ignores doses from the previous vial and doses after this one', () => {
    const logs = [dose('2026-09-24'), dose('2026-10-01'), dose('2026-10-08')]
    expect(vialStanding(dose('2026-10-01'), VIALS, logs)?.dosesLeft).toBe(9)
  })

  it('uses the vial in use on the dose day, not the newest one', () => {
    expect(vialStanding(dose('2026-09-24'), VIALS, [dose('2026-09-24')])).toEqual({ week: 8, dosesLeft: 4 })
  })

  it('leaves a later same-day dose out', () => {
    const later = dose('2026-10-01', 2, '2026-10-01T20:00:00+10:00')
    expect(vialStanding(dose('2026-10-01'), VIALS, [dose('2026-10-01'), later])?.dosesLeft).toBe(9)
  })

  it('reads an exactly empty vial as zero, not minus one', () => {
    const logs = Array.from({ length: 20 }, () => dose('2026-08-02', 0.5))
    expect(vialStanding(dose('2026-08-02', 0.5), VIALS, logs)?.dosesLeft).toBe(0)
  })

  it('is null with no vial on or before the day, or no milligram amount', () => {
    expect(vialStanding(dose('2026-07-01'), VIALS, [])).toBeNull()
    expect(vialStanding(dose('2026-10-01', null), VIALS, [])).toBeNull()
    expect(vialStanding({ ...dose('2026-10-01'), unit: 'mL' }, VIALS, [])).toBeNull()
    expect(vialStanding(dose('2026-10-01'), [], [])).toBeNull()
  })
})

describe('doseTimelineText', () => {
  it('prints the stored amount and unit, and the vial line when known', () => {
    expect(doseTimelineText({ amount: 2, unit: 'mg' }, { week: 6, dosesLeft: 3 })).toEqual({
      title: 'Dose · 2 mg',
      subtitle: 'Week 6 of this vial · 3 doses left',
    })
    expect(doseTimelineText({ amount: 0.25, unit: 'mg' }, { week: 1, dosesLeft: 1 }).subtitle).toBe(
      'Week 1 of this vial · 1 dose left',
    )
  })

  it('shows the title alone without vial facts', () => {
    expect(doseTimelineText({ amount: 2.5, unit: 'mg' }, null)).toEqual({ title: 'Dose · 2.5 mg', subtitle: undefined })
    expect(doseTimelineText({ amount: null, unit: 'mg' }, null).title).toBe('Dose')
  })
})
