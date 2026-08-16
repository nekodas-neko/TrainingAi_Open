import { describe, it, expect } from 'vitest'
import { buildTransitionRationale } from '../transition-rationale'
import { intensityZone } from '../prompt'
import { canAutoApplyTransition } from '../phase-guards'

describe('buildTransitionRationale', () => {
  const evidence = { sessionsInPhase: 5, rm1Trend: 'up' as const, rpeDelta: -0.3 }

  it('quotes the eligibility floor the engine actually gates on', () => {
    const text = buildTransitionRationale('accumulation', 'intensification', 'powerbuilding', evidence)!
    expect(text).toContain('5 accumulation sessions logged')
    expect(text).toContain('eligibility floor 4')
    expect(text).toContain('threshold ≤ +0.3')
  })

  it('quotes the real load zones for the goal, not hardcoded numbers', () => {
    const from = intensityZone('powerbuilding', 'accumulation')
    const to = intensityZone('powerbuilding', 'intensification')
    const text = buildTransitionRationale('accumulation', 'intensification', 'powerbuilding', evidence)!
    expect(text).toContain(`${from.pctMin}–${from.pctMax}%`)
    expect(text).toContain(`${to.pctMin}–${to.pctMax}%`)
  })

  it('renders a positive RPE delta with an explicit sign', () => {
    const text = buildTransitionRationale('accumulation', 'intensification', 'strength', {
      ...evidence, rpeDelta: 0.2,
    })!
    expect(text).toContain('+0.2')
  })

  it('states the physiological mechanism, not just the numbers', () => {
    const text = buildTransitionRationale('intensification', 'realisation', 'strength', {
      sessionsInPhase: 3, rm1Trend: 'flat', rpeDelta: 0.1,
    })!
    expect(text).toContain('fitness-fatigue')
    expect(text.length).toBeGreaterThan(200)
  })

  it('omits signals that are unavailable rather than inventing them', () => {
    const text = buildTransitionRationale('accumulation', 'intensification', 'strength', {
      sessionsInPhase: 4, rm1Trend: null, rpeDelta: null,
    })!
    expect(text).not.toContain('1RM trending')
    expect(text).not.toContain('RPE running')
    expect(text).toContain('4 accumulation sessions logged')
  })

  it('never claims a direction the lifts do not support', () => {
    const text = buildTransitionRationale('accumulation', 'intensification', 'strength', {
      ...evidence, rm1Trend: 'down',
    })!
    expect(text).toContain('trending down')
    expect(text).not.toContain('trending up')
  })

  it('returns null for a phase with no documented mechanism', () => {
    expect(buildTransitionRationale('accumulation', 'baseline', 'strength', evidence)).toBeNull()
  })

  it('covers deload→accumulation, the cycle restart', () => {
    const text = buildTransitionRationale('deload', 'accumulation', 'powerbuilding', {
      sessionsInPhase: 2, rm1Trend: 'flat', rpeDelta: null,
    })!
    expect(text).toContain('dissipated accumulated fatigue')
    // No documented floor for this transition — it must not fabricate one.
    expect(text).not.toContain('eligibility floor')
  })
})

describe('canAutoApplyTransition — which transitions may skip the lifter', () => {
  it('allows a transition the model itself asked for', () => {
    expect(canAutoApplyTransition(
      'transition_recommended', 'intensification',
      'transition_recommended', 'intensification',
    )).toBe(true)
  })

  it('refuses a ceiling-forced transition — the loads are still the old phase’s', () => {
    // Model said "stay" in accumulation; applyAccumulationCeiling rewrote the result.
    expect(canAutoApplyTransition(
      'stay', 'accumulation',
      'transition_recommended', 'intensification',
    )).toBe(false)
  })

  it('refuses when the model asked for a DIFFERENT phase than the guards settled on', () => {
    expect(canAutoApplyTransition(
      'transition_recommended', 'intensification',
      'transition_recommended', 'deload',
    )).toBe(false)
  })

  it('refuses every non-transition action, including deloads', () => {
    expect(canAutoApplyTransition('deload_recommended', 'deload', 'deload_recommended', 'deload')).toBe(false)
    expect(canAutoApplyTransition('stay', 'accumulation', 'stay', 'accumulation')).toBe(false)
    expect(canAutoApplyTransition('rest_day_recommended', 'accumulation', 'rest_day_recommended', 'accumulation')).toBe(false)
    expect(canAutoApplyTransition('session_swap_recommended', 'accumulation', 'session_swap_recommended', 'accumulation')).toBe(false)
  })

  it('refuses a realisation-ceiling-forced deload (model wanted to stay)', () => {
    expect(canAutoApplyTransition('stay', 'realisation', 'transition_recommended', 'deload')).toBe(false)
  })
})
