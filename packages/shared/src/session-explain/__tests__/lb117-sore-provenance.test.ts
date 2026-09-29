import { describe, it, expect } from 'vitest'
import { soreRows } from '../group-signals'

describe('LB-117 — a suggested sore tick did not lower the score, and the page must say so', () => {
  it('splits the lifter’s own ticks from the ones the app suggested', () => {
    const rows = soreRows(['chest', 'quads', 'glutes'], ['quads', 'glutes'])
    expect(rows).toEqual([
      { label: 'Sore muscles', value: 'chest', chip: { text: 'lowered the score', tone: 'warn' } },
      { label: 'Also sore', value: 'quads, glutes', chip: { text: 'already counted', tone: 'ok' } },
    ])
  })

  it('keeps the primary label when every tick was a suggestion', () => {
    // No "Also" without a first row to be "also" to — and it must not read as having cost anything.
    const rows = soreRows(['quads'], ['quads'])
    expect(rows).toEqual([
      { label: 'Sore muscles', value: 'quads', chip: { text: 'already counted', tone: 'ok' } },
    ])
  })

  it('marks a wholly lifter-chosen list as having lowered the score', () => {
    expect(soreRows(['chest'], [])).toEqual([
      { label: 'Sore muscles', value: 'chest', chip: { text: 'lowered the score', tone: 'warn' } },
    ])
  })

  it('⛔ falls back to ONE unchipped line when provenance was never recorded', () => {
    // BF-173's rule: absent means "unknown" and is scored the old way. Reading null as "none were
    // suggestions" would claim every tick lowered the score — a guess dressed as an explanation, on
    // the one page whose rule is to show what the recommendation was actually computed from.
    for (const missing of [null, undefined]) {
      expect(soreRows(['chest', 'quads'], missing)).toEqual([
        { label: 'Sore muscles', value: 'chest, quads' },
      ])
    }
  })

  it('says None when nothing is sore, whatever the provenance', () => {
    expect(soreRows([], null)).toEqual([{ label: 'Sore muscles', value: 'None' }])
    expect(soreRows([], ['quads'])).toEqual([{ label: 'Sore muscles', value: 'None' }])
  })

  it('ignores a suggestion the lifter later unticked', () => {
    // `suggested` is what the app proposed, not what survived. Only ticks present in `sore` render.
    const rows = soreRows(['chest'], ['chest', 'hamstrings'])
    expect(rows).toEqual([
      { label: 'Sore muscles', value: 'chest', chip: { text: 'already counted', tone: 'ok' } },
    ])
  })
})
