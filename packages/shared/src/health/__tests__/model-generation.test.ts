import { describe, it, expect } from 'vitest'
import { modelGeneration, generationCensus } from '../model-generation'

// LA-135. Stored versions look like `v6:rest0.05:chg0.12:drn0.08:str0.02:hrmax-observed:oura-rule`.
// The prefix is the model's shape; everything after it is the constants that shape ran with.
describe('modelGeneration', () => {
  it('takes the prefix before the first colon', () => {
    expect(modelGeneration('v6:rest0.05:chg0.12:hrmax-observed:oura-rule')).toBe('v6')
    expect(modelGeneration('v5:rest0.05:chg0.2:drn0.6')).toBe('v5')
  })

  it('treats a tuning pass as the SAME generation', () => {
    // This is the whole reason only the prefix is compared. TN-55 changed three constants inside
    // v6's string; comparing whole versions would call every tuning pass a model change and bury
    // the real boundaries in noise.
    const before = 'v6:rest0.05:chg0.120:drn0.080:str0.020:hrmax-observed:oura-rule'
    const after = 'v6:rest0.05:chg0.090:drn0.060:str0.015:hrmax-observed:oura-rule'
    expect(modelGeneration(before)).toBe(modelGeneration(after))
    expect(generationCensus([before, after])).toEqual([{ generation: 'v6', days: 2 }])
  })

  it('and a real shape change as a different one', () => {
    expect(modelGeneration('v5:rest0.05')).not.toBe(modelGeneration('v6:rest0.05'))
  })

  it('never throws on a row that has no version', () => {
    // A row predating the stamp, or one written by a path that forgot it, must read as its own
    // bucket rather than vanishing — an unexplained day is exactly what the census is for.
    for (const bad of [null, undefined, '', '   ', ':::']) {
      expect(modelGeneration(bad), JSON.stringify(bad)).toBe('unknown')
    }
  })
})

describe('generationCensus', () => {
  it('counts days per generation, most days first', () => {
    // The production shape on 2026-09-24, which is what the route reports beside its correlation.
    const versions = [
      ...Array(52).fill('v5:rest0.05'),
      ...Array(18).fill('v4:rest0.05'),
      ...Array(16).fill('v1:rest0.05'),
      'v2:rest0.05',
    ]
    expect(generationCensus(versions)).toEqual([
      { generation: 'v5', days: 52 },
      { generation: 'v4', days: 18 },
      { generation: 'v1', days: 16 },
      { generation: 'v2', days: 1 },
    ])
  })

  it('breaks a tie by name, so the order is stable rather than insertion-dependent', () => {
    expect(generationCensus(['v6:a', 'v5:a'])).toEqual([
      { generation: 'v5', days: 1 },
      { generation: 'v6', days: 1 },
    ])
    expect(generationCensus(['v5:a', 'v6:a'])).toEqual([
      { generation: 'v5', days: 1 },
      { generation: 'v6', days: 1 },
    ])
  })

  it('reports a single generation as a single entry, which is what "does not span" means', () => {
    expect(generationCensus(['v6:a', 'v6:b', 'v6:c'])).toHaveLength(1)
  })

  it('counts nothing as nothing', () => {
    expect(generationCensus([])).toEqual([])
  })
})
