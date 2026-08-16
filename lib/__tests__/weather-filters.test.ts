import { describe, it, expect } from 'vitest'
import { getSkyFilter } from '../background/weather-filters'

describe('getSkyFilter', () => {
  it('returns none for clear skies', () => {
    expect(getSkyFilter('clear')).toBe('none')
  })

  it('returns a filter for every other condition', () => {
    expect(getSkyFilter('cloudy')).toBe('saturate(0.85) brightness(0.95)')
    expect(getSkyFilter('rain')).toBe('saturate(0.6) brightness(0.75) hue-rotate(-5deg)')
    expect(getSkyFilter('fog')).toBe('saturate(0.4) brightness(0.9)')
    expect(getSkyFilter('snow')).toBe('saturate(0.7) brightness(1.05)')
    expect(getSkyFilter('thunderstorm')).toBe('saturate(0.5) brightness(0.6)')
  })
})
