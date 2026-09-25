import { describe, it, expect } from 'vitest'
import { sourceRank, HEALTH_SOURCES, mergeSet, initialSourceMap } from '@/lib/data/health-source'

describe('sourceRank', () => {
  it('ranks manual > oura_ble > oura_cloud > health_connect > unknown', () => {
    expect(sourceRank('manual')).toBeGreaterThan(sourceRank('oura_ble'))
    expect(sourceRank('oura_ble')).toBeGreaterThan(sourceRank('oura_cloud'))
    expect(sourceRank('oura_cloud')).toBeGreaterThan(sourceRank('health_connect'))
    expect(sourceRank('health_connect')).toBeGreaterThan(sourceRank(null))
    expect(sourceRank(null)).toBe(0)
    expect(sourceRank('bogus')).toBe(0)
  })
  it('enumerates the known sources', () => {
    expect(HEALTH_SOURCES).toContain('manual')
    expect(HEALTH_SOURCES).toContain('oura_ble')
    expect(HEALTH_SOURCES).toContain('oura_cloud')
    expect(HEALTH_SOURCES).toContain('health_connect')
  })
})

const COLS = [
  { prop: 'weightKg', col: 'weight_kg' },
  { prop: 'steps', col: 'steps' },
]

describe('initialSourceMap', () => {
  it('stamps only the non-null fields with the source', () => {
    expect(initialSourceMap(COLS, { weightKg: 82, steps: null }, 'manual')).toEqual({ weight_kg: 'manual' })
    expect(initialSourceMap(COLS, { weightKg: 82, steps: 8000 }, 'oura_ble')).toEqual({ weight_kg: 'oura_ble', steps: 'oura_ble' })
    expect(initialSourceMap(COLS, { weightKg: null, steps: null }, 'manual')).toEqual({})
  })
})

describe('mergeSet', () => {
  it('produces a set entry per column plus the sourceMap, keyed by prop', () => {
    const set = mergeSet('body_metrics', COLS, 'health_connect')
    expect(Object.keys(set).sort()).toEqual(['sourceMap', 'steps', 'weightKg'])
  })
})
