import { describe, expect, it } from 'vitest'
import { gapDataset, seriesShape, VISIBLE_POINT_RADIUS } from '../trend-sparkline-gaps'

describe('seriesShape', () => {
  it('draws no isolated dots on a complete series, and says nothing about coverage', () => {
    const s = seriesShape([1, 2, 3, 4])
    expect(s.isolated).toEqual([false, false, false, false])
    expect(s.present).toBe(4)
    expect(s.drawn).toBe(4)
    // The note is for a series with holes. On a full one it is a caveat about nothing.
    expect(s.coverage).toBeNull()
  })

  it('marks a lone reading between two gaps — the case that would otherwise draw nothing', () => {
    const s = seriesShape([null, 42, null])
    expect(s.isolated).toEqual([false, true, false])
    expect(s.coverage).toBe('2 days missing')
  })

  it('leaves a value with a neighbour undotted — a segment already makes it visible', () => {
    expect(seriesShape([1, 2, null]).isolated).toEqual([false, false, false])
    expect(seriesShape([null, 1, 2]).isolated).toEqual([false, false, false])
  })

  it('treats the ends as gaps, so a single reading at either edge still draws', () => {
    expect(seriesShape([5, null, null]).isolated).toEqual([true, false, false])
    expect(seriesShape([null, null, 5]).isolated).toEqual([false, false, true])
  })

  it('marks every reading in an alternating series — none of them has a neighbour', () => {
    const s = seriesShape([1, null, 2, null, 3])
    expect(s.isolated).toEqual([true, false, true, false, true])
    expect(s.present).toBe(3)
    expect(s.coverage).toBe('2 days missing')
  })

  it('separates a run of two from a lone reading in the same series', () => {
    // 7 is alone; 1 and 2 hold each other up.
    const s = seriesShape([1, 2, null, null, 7, null])
    expect(s.isolated).toEqual([false, false, false, false, true, false])
    expect(s.coverage).toBe('3 days missing')
  })

  it('counts an all-null series as fully absent rather than throwing', () => {
    const s = seriesShape([null, null])
    expect(s.isolated).toEqual([false, false])
    expect(s.present).toBe(0)
    expect(s.coverage).toBe('2 days missing')
  })

  it('reads undefined as absent — the trends row omits a field it never computed', () => {
    const s = seriesShape([undefined, 3, undefined])
    expect(s.isolated).toEqual([false, true, false])
    expect(s.present).toBe(1)
  })

  it('does not treat 0 as absent — a zero drop is a measurement, not a missing one', () => {
    const s = seriesShape([0, null, 0])
    expect(s.isolated).toEqual([true, false, true])
    expect(s.present).toBe(2)
    expect(s.coverage).toBe('1 day missing')
  })

  it('handles the empty series without inventing a coverage note', () => {
    const s = seriesShape([])
    expect(s.isolated).toEqual([])
    expect(s.present).toBe(0)
    expect(s.drawn).toBe(0)
    expect(s.coverage).toBeNull()
  })
})

describe('gapDataset', () => {
  it('never spans a gap — the flag whose reversion puts the invented line back', () => {
    expect(gapDataset([1, null, 2]).spanGaps).toBe(false)
  })

  it('dots the latest reading and every stranded one, and nothing else', () => {
    // index 0 has a neighbour, 3 is stranded, 5 is last.
    expect(gapDataset([1, 2, null, 7, null, 9]).pointRadius)
      .toEqual([0, 0, 0, VISIBLE_POINT_RADIUS, 0, VISIBLE_POINT_RADIUS])
  })

  it('still dots the final slot when the final day has no reading', () => {
    // Chart.js draws nothing for a null point, so the radius there is inert — but the rule stays
    // index-based rather than value-based, and this pins that it does not throw or shift.
    expect(gapDataset([1, 2, null]).pointRadius).toEqual([0, 0, VISIBLE_POINT_RADIUS])
  })

  it('carries the coverage note through unchanged', () => {
    expect(gapDataset([1, null, 3]).coverage).toBe('1 day missing')
    expect(gapDataset([1, 2, 3]).coverage).toBeNull()
  })

  it('returns an empty dataset for an empty series', () => {
    expect(gapDataset([]).pointRadius).toEqual([])
  })
})
