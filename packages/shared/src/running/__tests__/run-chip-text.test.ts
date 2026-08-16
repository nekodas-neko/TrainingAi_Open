import { describe, it, expect } from 'vitest'
import { chooseRunChipMode, formatDistanceChipText } from '../run-chip-text'
import type { RunPrescription } from '@/components/running/prescribed-run-card'

const basePrescription: RunPrescription = {
  type: 'easy',
  durationMin: 30,
  distanceKm: null,
  targets: { zoneIds: [2], hrLowBpm: 120, hrHighBpm: 140 },
  rationale: '',
}

describe('chooseRunChipMode', () => {
  it('returns "distance" when the prescription has a distance target', () => {
    expect(chooseRunChipMode({ ...basePrescription, distanceKm: 5 })).toBe('distance')
  })

  it('returns "duration" when only a duration target is set', () => {
    expect(chooseRunChipMode(basePrescription)).toBe('duration')
  })

  it('returns "elapsed" when there is no prescription at all', () => {
    expect(chooseRunChipMode(null)).toBe('elapsed')
  })

  it('returns "elapsed" when the prescription has neither target', () => {
    expect(chooseRunChipMode({ ...basePrescription, durationMin: null, distanceKm: null })).toBe('elapsed')
  })
})

describe('formatDistanceChipText', () => {
  it('formats distance-so-far / target with pace', () => {
    expect(formatDistanceChipText(3.256, 5, '5:42 /km')).toBe('3.26 / 5.00 km · 5:42 /km')
  })

  it('omits the pace segment when pace is null', () => {
    expect(formatDistanceChipText(1.2, 5, null)).toBe('1.20 / 5.00 km')
  })

  it('appends a paused marker when paused', () => {
    expect(formatDistanceChipText(1.2, 5, null, true)).toBe('1.20 / 5.00 km (paused)')
  })
})
