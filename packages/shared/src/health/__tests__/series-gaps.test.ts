import { describe, it, expect } from 'vitest'
import { trimLeadingGaps } from '@trainingai/shared/health/series-gaps'

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
