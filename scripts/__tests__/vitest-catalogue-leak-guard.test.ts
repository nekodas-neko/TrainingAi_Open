import { describe, it, expect } from 'vitest'
import { leftoverRows, describeLeak } from '../vitest-catalogue-leak-guard'

const row = (id: string, name: string) => ({ id, name })

describe('catalogue leak guard comparison (#4055)', () => {
  it('reports nothing when the table is unchanged', () => {
    const t = [row('1', 'Squat'), row('2', 'Bench')]
    expect(leftoverRows(t, [...t])).toEqual([])
  })

  it('names one leftover row', () => {
    expect(leftoverRows([row('1', 'Squat')], [row('1', 'Squat'), row('2', 'leak-a')])).toEqual([row('2', 'leak-a')])
  })

  it('still sees a leftover that was renamed after insert, because it compares ids', () => {
    // The #4053 shape: inserted as "rename-before", renamed, cleanup deleted by the old name.
    expect(leftoverRows([row('1', 'Squat')], [row('1', 'Squat'), row('9', 'rename-after')])).toEqual([row('9', 'rename-after')])
  })

  it('ignores rows that existed before the run, even a renamed pre-existing one', () => {
    const before = [row('1', 'Squat'), row('7', 'old-leftover')]
    expect(leftoverRows(before, [row('1', 'Squat renamed'), row('7', 'old-leftover')])).toEqual([])
  })

  it('does not complain about rows the run deleted', () => {
    expect(leftoverRows([row('1', 'Squat'), row('2', 'Bench')], [row('1', 'Squat')])).toEqual([])
  })

  it('lists the leftover names and ids in the message', () => {
    const msg = describeLeak([row('abc', 'leak-a')], ['lib/x.test.ts'])
    expect(msg).toContain('"leak-a" (abc)')
    expect(msg).toContain('lib/x.test.ts')
  })
})
