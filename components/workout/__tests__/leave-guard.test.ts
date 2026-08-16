import { describe, it, expect } from 'vitest'
import { wouldDiscardWork } from '../leave-guard'

const guard = (timerStarted: boolean, workoutPhase: 'rest' | 'set', lapCount: number) =>
  wouldDiscardWork({ timerStarted, workoutPhase, lapCount })

describe('wouldDiscardWork', () => {
  it('does not prompt before the timer has started', () => {
    // The pre-set screen. Skipping here loses nothing, and a dialog would be pure friction.
    expect(guard(false, 'rest', 0)).toBe(false)
    expect(guard(false, 'set', 0)).toBe(false)
    expect(guard(false, 'rest', 3)).toBe(false)
  })

  it('prompts mid-set — the case Q-63 was skipping straight past', () => {
    expect(guard(true, 'set', 0)).toBe(true)
  })

  it('prompts during rest once laps have been recorded', () => {
    expect(guard(true, 'rest', 1)).toBe(true)
  })

  it('does not prompt at rest with no laps — the set is already logged', () => {
    // The one "started, but nothing left to lose" state. Prompting here would train the reflex
    // dismissal that makes the real prompt useless.
    expect(guard(true, 'rest', 0)).toBe(false)
  })

  it('is independent of solo mode — nothing about losing sets is solo-specific', () => {
    // Q-63's actual bug was a `soloMode ? confirm : skip` branch at the call site. The rule takes
    // no mode argument by design, so that branch cannot come back through this function.
    expect(wouldDiscardWork.length).toBe(1)
    const keys = Object.keys({ timerStarted: true, workoutPhase: 'set', lapCount: 0 })
    expect(keys).not.toContain('soloMode')
  })
})
