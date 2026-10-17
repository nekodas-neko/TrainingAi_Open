import { describe, it, expect } from 'vitest'
import { standaloneOrLatest, trimLeadingGaps } from '@trainingai/shared/health/series-gaps'

const read = (row: { v: number | null | undefined }) => row.v

describe('trimLeadingGaps', () => {
  it('drops the empty days before the first reading and keeps the gaps after it', () => {
    const rows = [{ v: null }, { v: undefined }, { v: 4 }, { v: null }, { v: 6 }]
    expect(trimLeadingGaps(rows, read)).toEqual([{ v: 4 }, { v: null }, { v: 6 }])
  })

  it('keeps a zero, which is a reading', () => {
    expect(trimLeadingGaps([{ v: null }, { v: 0 }], read)).toEqual([{ v: 0 }])
  })

  it('is null when no day has a reading, and for no days at all', () => {
    expect(trimLeadingGaps([{ v: null }, { v: undefined }], read)).toBeNull()
    expect(trimLeadingGaps([], read)).toBeNull()
  })
})

describe('standaloneOrLatest', () => {
  it('marks the latest point and any reading with no neighbour', () => {
    expect(standaloneOrLatest([1, null, 2, 3, null, 4, null, 5])).toEqual([true, false, false, false, false, true, false, true])
    expect(standaloneOrLatest([1, 2, 3])).toEqual([false, false, true])
  })
})
