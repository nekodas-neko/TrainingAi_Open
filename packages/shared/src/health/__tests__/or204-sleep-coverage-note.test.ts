import { describe, it, expect } from 'vitest'
import { sleepCoverageNote } from '../sleep-coverage-note'

describe('sleepCoverageNote (OR-204)', () => {
  it('says nothing on a full night or without coverage', () => {
    expect(sleepCoverageNote({ ratio: 1, missing: [], level: 'full' })).toBeNull()
    expect(sleepCoverageNote(null)).toBeNull()
  })
  it('is a quiet note on a partial night, and names what is missing on a low one', () => {
    expect(sleepCoverageNote({ ratio: 0.95, missing: ['latency'], level: 'partial' })).toEqual({ text: 'Partial data', strong: false })
    expect(sleepCoverageNote({ ratio: 0.75, missing: ['hrv', 'hr'], level: 'low' })).toEqual({ text: 'Less complete: no HRV, heart rate', strong: true })
  })
})
