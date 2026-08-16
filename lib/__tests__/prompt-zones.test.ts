import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, intensityZone } from '@trainingai/shared/ai-periodization/prompt'

describe('buildSystemPrompt intensity zones', () => {
  it('uses the powerbuilding zones for a powerbuilding goal', () => {
    const p = buildSystemPrompt('powerbuilding')
    expect(p).toContain('Training goal: powerbuilding')
    expect(p).toContain('72.5-80%, 6-8 reps') // powerbuilding accumulation
    expect(p).toContain('85-92.5%, 2-4 reps') // powerbuilding realisation
  })

  it('uses the strength+hypertrophy zones for that blend', () => {
    const p = buildSystemPrompt('strength+hypertrophy')
    expect(p).toContain('Training goal: strength+hypertrophy')
    expect(p).toContain('67.5-75%, 8-10 reps') // S+H accumulation
  })

  it('still serves the four base goals', () => {
    expect(buildSystemPrompt('strength')).toContain('70-77.5%, 5-8 reps')
    expect(buildSystemPrompt('hypertrophy')).toContain('65-72.5%, 8-12 reps')
    expect(buildSystemPrompt('power')).toContain('72.5-80%, 3-5 reps')
    expect(buildSystemPrompt('endurance')).toContain('50-62.5%, 15-20 reps')
  })

  it('falls back to strength zones for an unknown goal', () => {
    expect(buildSystemPrompt('nonsense')).toContain('70-77.5%, 5-8 reps')
  })
})

describe('intensityZone (machine-readable zones)', () => {
  it('exposes the same numbers the prompt renders', () => {
    expect(intensityZone('strength', 'accumulation')).toEqual({ pctMin: 70, pctMax: 77.5, repMin: 5, repMax: 8, setsMin: 4, setsMax: 5 })
    expect(intensityZone('powerbuilding', 'realisation')).toEqual({ pctMin: 85, pctMax: 92.5, repMin: 2, repMax: 4, setsMin: 3, setsMax: 4 })
  })
  it('falls back to strength for unknown goals', () => {
    expect(intensityZone('nonsense', 'deload')).toEqual(intensityZone('strength', 'deload'))
  })
})

describe('anti-double-apply instruction (C7)', () => {
  it('tells the model to prescribe neutral in-zone pct and leave fatigue cuts to the engine', () => {
    expect(buildSystemPrompt('strength')).toContain('do NOT pre-emptively lower pct')
  })
})
