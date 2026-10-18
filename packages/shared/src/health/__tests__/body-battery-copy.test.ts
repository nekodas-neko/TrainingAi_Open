import { describe, expect, it } from 'vitest'
import { bodyBatteryBand, bodyBatteryColor } from '../body-battery-band'
import {
  BODY_BATTERY_PROVISIONAL_SUFFIX,
  BODY_BATTERY_SPARSE_DAY,
  bodyBatteryAnchorSuffix,
} from '../body-battery-copy'
import { DEFAULT_SLEEP_GOAL_HOURS } from '../daily-goals'

describe('body battery wording shared by both apps', () => {
  it('names where the starting level came from, and nothing for the default', () => {
    expect(bodyBatteryAnchorSuffix('readiness')).toBe(' from readiness')
    expect(bodyBatteryAnchorSuffix('sleep')).toBe(' from sleep')
    expect(bodyBatteryAnchorSuffix('default')).toBe('')
    expect(BODY_BATTERY_PROVISIONAL_SUFFIX).toBe(' · provisional until readiness lands')
  })

  it('reads as the sparse-day paragraph once the two figures are slotted in', () => {
    const [a, b, c] = BODY_BATTERY_SPARSE_DAY
    expect(`${a}12${b}1.5${c}`).toBe(
      "Your ring recorded only 12 heart-rate readings since you woke — about 1.5 an hour. The ring stops sampling when you are still, so today's line is mostly gaps held flat rather than a measured calm. Treat the number as a rough guide.",
    )
  })
})

describe('body battery colour bands', () => {
  it('puts Charged and Good in one band, and the CSS colour follows the band', () => {
    expect(bodyBatteryBand('Charged')).toBe('good')
    expect(bodyBatteryBand('Good')).toBe('good')
    expect(bodyBatteryBand('Low')).toBe('low')
    expect(bodyBatteryBand('Drained')).toBe('drained')
    expect(bodyBatteryColor('Charged')).toBe('var(--accent-green)')
    expect(bodyBatteryColor('Low')).toBe('var(--accent-amber)')
    expect(bodyBatteryColor('Drained')).toBe('var(--destructive)')
  })
})

describe('sleep goal default', () => {
  it('is eight hours until the user saves one', () => {
    expect(DEFAULT_SLEEP_GOAL_HOURS).toBe(8)
  })
})
