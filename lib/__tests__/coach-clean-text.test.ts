import { describe, it, expect } from 'vitest'
import { stripToolCitations } from '@/lib/coach/clean-text'

describe('stripToolCitations', () => {
  it('removes the exact bracket seen on device', () => {
    const observed =
      'Your push progression is trending strongly upward across almost all movements. ' +
      '[default_api:getPlateauReport, default_api:getWorkoutsByExercise].'
    expect(stripToolCitations(observed)).toBe(
      'Your push progression is trending strongly upward across almost all movements.',
    )
  })

  it('removes a single-tool bracket', () => {
    expect(stripToolCitations('Bench is up 4 kg [default_api:getPlateauReport]')).toBe('Bench is up 4 kg')
  })

  it('leaves ordinary brackets and markdown links alone', () => {
    const keep = 'See [the guide](https://example.com) and your [best] set.'
    expect(stripToolCitations(keep)).toBe(keep)
  })

  it('does not swallow text that merely mentions a tool name', () => {
    const keep = 'I checked your plateau report and nothing has stalled.'
    expect(stripToolCitations(keep)).toBe(keep)
  })

  it('returns empty when the reply was nothing but the bracket', () => {
    expect(stripToolCitations('[default_api:getProgramStructure]')).toBe('')
  })
})
