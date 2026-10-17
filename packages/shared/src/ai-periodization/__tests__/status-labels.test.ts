import { describe, expect, it } from 'vitest'
import { PHASE_LABELS, lastTrainedLabel } from '../status-labels'

describe('lastTrainedLabel', () => {
  it('says Yesterday, never "1 days ago"', () => {
    expect(lastTrainedLabel(1)).toBe('Yesterday')
    expect(lastTrainedLabel(0)).toBe('Trained today')
    expect(lastTrainedLabel(5)).toBe('5d ago')
    expect(lastTrainedLabel(null)).toBe('Never trained')
  })

  it('has a label for every phase the engine writes', () => {
    expect(Object.keys(PHASE_LABELS).sort()).toEqual(
      ['accumulation', 'baseline', 'deload', 'intensification', 'realisation'],
    )
  })
})
