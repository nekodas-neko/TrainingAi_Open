import { afterEach, describe, expect, it, vi } from 'vitest'
import { pipPhaseFor, sendPipPhase } from '../pip-phase'

const base = { mode: 'active', workoutPhase: 'rest', currentSet: 1, sets: 3 }

describe('pipPhaseFor', () => {
  it('maps the active modes to the phases the shell enters PiP for', () => {
    expect(pipPhaseFor({ ...base, workoutPhase: 'set' })).toBe('set')
    expect(pipPhaseFor(base)).toBe('rest')
    expect(pipPhaseFor({ ...base, currentSet: 3 })).toBe('complete')
    expect(pipPhaseFor({ ...base, mode: 'exercise-summary' })).toBe('summary')
  })

  it('reports non-running modes as phases the shell will not enter PiP for', () => {
    expect(pipPhaseFor({ ...base, mode: 'pre' })).toBe('pre')
    expect(pipPhaseFor({ ...base, mode: 'warmup' })).toBe('pre')
    expect(pipPhaseFor({ ...base, mode: 'done' })).toBe('done')
  })
})

describe('sendPipPhase', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('forwards the phase to window.AndroidPip', () => {
    const updatePhase = vi.fn()
    vi.stubGlobal('window', { AndroidPip: { updatePhase } })
    sendPipPhase('idle')
    expect(updatePhase).toHaveBeenCalledWith('idle')
  })

  it('does nothing without the bridge (web build)', () => {
    vi.stubGlobal('window', {})
    expect(() => sendPipPhase('idle')).not.toThrow()
  })
})
