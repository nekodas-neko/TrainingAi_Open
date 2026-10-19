import { describe, it, expect } from 'vitest'
import { decideLowBatteryAlert } from '../low-battery'

describe('decideLowBatteryAlert', () => {
  it('fires once when the level drops below 35', () => {
    expect(decideLowBatteryAlert(34, false, false)).toEqual({ notify: true, fired: true })
    expect(decideLowBatteryAlert(30, false, true)).toEqual({ notify: false, fired: true })
  })

  it('stays quiet at 35 and holds its state in the 35–39 dead band', () => {
    expect(decideLowBatteryAlert(35, false, false)).toEqual({ notify: false, fired: false })
    expect(decideLowBatteryAlert(39, false, true)).toEqual({ notify: false, fired: true })
  })

  it('re-arms at 40, so the next low episode alerts again', () => {
    const recovered = decideLowBatteryAlert(40, false, true)
    expect(recovered).toEqual({ notify: false, fired: false })
    expect(decideLowBatteryAlert(20, false, recovered.fired).notify).toBe(true)
  })

  it('never alerts while charging, and re-arms', () => {
    expect(decideLowBatteryAlert(10, true, true)).toEqual({ notify: false, fired: false })
  })
})
