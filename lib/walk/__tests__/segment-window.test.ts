import { describe, it, expect } from 'vitest'
import { samplesInWindow } from '@/lib/walk/segment-window'

interface Sample { at: number; v: string }

const byAt = (s: Sample) => s.at

describe('samplesInWindow', () => {
  it('returns empty for an empty input', () => {
    expect(samplesInWindow<Sample>([], byAt, 0, 100)).toEqual([])
  })

  it('returns empty when the single sample falls outside the window', () => {
    const samples: Sample[] = [{ at: 200, v: 'a' }]
    expect(samplesInWindow(samples, byAt, 0, 100)).toEqual([])
  })

  it('includes a single sample inside the window', () => {
    const samples: Sample[] = [{ at: 50, v: 'a' }]
    expect(samplesInWindow(samples, byAt, 0, 100)).toEqual(samples)
  })

  it('filters multiple samples to only those inside the window', () => {
    const samples: Sample[] = [
      { at: -10, v: 'before' },
      { at: 0, v: 'at-start' },
      { at: 50, v: 'inside' },
      { at: 99, v: 'inside-2' },
      { at: 100, v: 'at-end' },
      { at: 150, v: 'after' },
    ]
    const result = samplesInWindow(samples, byAt, 0, 100)
    expect(result.map(s => s.v)).toEqual(['at-start', 'inside', 'inside-2'])
  })

  it('is inclusive of fromMs and exclusive of toMs at the exact boundary', () => {
    const samples: Sample[] = [{ at: 0, v: 'from' }, { at: 100, v: 'to' }]
    expect(samplesInWindow(samples, byAt, 0, 100).map(s => s.v)).toEqual(['from'])
  })
})
