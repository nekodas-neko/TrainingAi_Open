import { describe, expect, it } from 'vitest'
import {
  GENERIC_HIGH,
  GENERIC_LEGEND,
  GENERIC_TARGET,
  MAX_TARGET,
  muscleVolumeColor,
  targetBand,
  volumeVerdict,
} from '../volume-band'

const palette = { good: 'G', warn: 'A', bad: 'R', none: 'N', brand: 'B' } as const

// The rule both apps colour a muscle's weekly sets by (#2554, #2900); the apps only map tones.
describe('muscleVolumeColor (shared rule, caller palette)', () => {
  it('colours against a program target: green at it, amber from 60%, red below, grey for none', () => {
    expect(muscleVolumeColor(13, 13, null, palette)).toBe('G')
    expect(muscleVolumeColor(8, 13, null, palette)).toBe('A')
    expect(muscleVolumeColor(7, 13, null, palette)).toBe('R')
    expect(muscleVolumeColor(0, 13, null, palette)).toBe('N')
  })

  it('exactly 60% is amber', () => {
    expect(targetBand(6, 10)).toBe('approaching')
    expect(muscleVolumeColor(6, 10, null, palette)).toBe('A')
  })

  it('a program target beats a goal verdict, which beats the generic band', () => {
    expect(muscleVolumeColor(4, 13, 'V', palette)).toBe('R')
    expect(muscleVolumeColor(4, null, 'V', palette)).toBe('V')
    expect(muscleVolumeColor(15, null, null, palette)).toBe('B')
    expect(muscleVolumeColor(12, null, null, palette)).toBe('G')
  })

  it('the goal verdict carries a tone and a word, not a colour', () => {
    const verdict = volumeVerdict('powerbuilding', 'glutes', 30)
    expect(verdict.band).toBe('over')
    expect(verdict.tone).toBe('bad')
    expect(verdict.label).toBe('above MRV')
  })
})

// The legend words and the colours come from the same thresholds, so they cannot drift (#2948).
describe('the generic band legend', () => {
  it('names each band in the words both apps print', () => {
    expect(GENERIC_LEGEND).toEqual([
      { tone: 'brand', label: '15+ sets' },
      { tone: 'good', label: '10–14 sets' },
      { tone: 'warn', label: '6–9 sets' },
      { tone: 'bad', label: 'Under 6' },
    ])
    expect(MAX_TARGET).toBe(20)
  })

  it('agrees with the colour the band gives at every edge it names', () => {
    const colour = (sets: number) => muscleVolumeColor(sets, null, null, palette)
    const toneOf = (label: string) => GENERIC_LEGEND.find(item => item.label === label)!.tone
    const expected = { brand: 'B', good: 'G', warn: 'A', bad: 'R', none: 'N' } as const
    expect(colour(GENERIC_HIGH)).toBe(expected[toneOf('15+ sets')])
    expect(colour(GENERIC_HIGH - 1)).toBe(expected[toneOf('10–14 sets')])
    expect(colour(GENERIC_TARGET)).toBe(expected[toneOf('10–14 sets')])
    expect(colour(GENERIC_TARGET - 1)).toBe(expected[toneOf('6–9 sets')])
    expect(colour(6)).toBe(expected[toneOf('6–9 sets')])
    expect(colour(5)).toBe(expected[toneOf('Under 6')])
  })
})
