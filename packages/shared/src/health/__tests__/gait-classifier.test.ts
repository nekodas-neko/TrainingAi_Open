import { describe, it, expect } from 'vitest'
import { classifyGait } from '../gait-classifier'

const motion = { strideAmpFrac: 0.5, totalAmplitudeMg: 40 }

describe('classifyGait', () => {
  it('classifies a walking-band stride frequency as walk', () => {
    const r = classifyGait({ strideHz: 1.8, ...motion })
    expect(r.state).toBe('walk')
    expect(r.strideHz).toBe(1.8)
  })

  it('classifies a running-band stride frequency as run', () => {
    const r = classifyGait({ strideHz: 3.0, ...motion })
    expect(r.state).toBe('run')
  })

  it('classifies a stride frequency below the walk band as idle', () => {
    const r = classifyGait({ strideHz: 0.5, ...motion })
    expect(r.state).toBe('idle')
  })

  it('classifies a stride frequency above the run band as idle', () => {
    const r = classifyGait({ strideHz: 5.0, ...motion })
    expect(r.state).toBe('idle')
  })

  it('rejects a degenerate (zero-amplitude) reading regardless of Hz', () => {
    const r = classifyGait({ strideHz: 1.8, strideAmpFrac: 0, totalAmplitudeMg: 0 })
    expect(r.state).toBe('idle')
  })

  it('rejects a non-finite reading', () => {
    expect(classifyGait({ strideHz: NaN, ...motion }).state).toBe('idle')
    expect(classifyGait({ strideHz: 1.8, strideAmpFrac: NaN, totalAmplitudeMg: 40 }).state).toBe('idle')
    expect(classifyGait({ strideHz: 1.8, strideAmpFrac: 0.5, totalAmplitudeMg: -1 }).state).toBe('idle')
  })

  it('has no gap between the walk and run bands', () => {
    // The exact boundary (144 spm / 2.4 Hz) must classify as one or the other, never idle.
    const r = classifyGait({ strideHz: 2.4, ...motion })
    expect(r.state).toBe('run')
  })
})
