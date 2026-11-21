import { describe, it, expect } from 'vitest'
import {
  formatCount,
  formatLifetimeDistance,
  formatLifetimeVolume,
  formatVolumeKg,
  formatWaterMl,
  formatXp,
  waterParts,
} from '@trainingai/shared/format/number'

describe('formatCount', () => {
  it('groups thousands with commas', () => {
    expect(formatCount(12345)).toBe('12,345')
    expect(formatCount(1234567)).toBe('1,234,567')
    expect(formatCount(999)).toBe('999')
  })
  it('rounds to a whole number by default, half up', () => {
    expect(formatCount(1234.5)).toBe('1,235')
    expect(formatCount(2.4)).toBe('2')
  })
  it('keeps the places asked for and no more', () => {
    expect(formatCount(1234.56, { decimals: 1 })).toBe('1,234.6')
    expect(formatCount(1234, { decimals: 1 })).toBe('1,234')
    expect(formatCount(1.005, { decimals: 2 })).toBe('1.01')
  })
  it('writes zero as 0 and never as -0', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(-0.2)).toBe('0')
  })
  it('keeps the sign of a negative', () => {
    expect(formatCount(-1500)).toBe('-1,500')
  })
  it('reads null, undefined and NaN as an em dash, not zero', () => {
    expect(formatCount(null)).toBe('—')
    expect(formatCount(undefined)).toBe('—')
    expect(formatCount(Number.NaN)).toBe('—')
    expect(formatCount(Infinity)).toBe('—')
  })
})

describe('formatXp', () => {
  it('groups and adds the unit', () => {
    expect(formatXp(12345)).toBe('12,345 XP')
    expect(formatXp(0)).toBe('0 XP')
    expect(formatXp(250)).toBe('250 XP')
  })
  it('reads a missing value as an em dash', () => {
    expect(formatXp(null)).toBe('—')
    expect(formatXp(undefined)).toBe('—')
  })
})

describe('formatLifetimeVolume', () => {
  it('uses kg under a tonne, whole', () => {
    expect(formatLifetimeVolume(850.4)).toBe('850 kg')
    expect(formatLifetimeVolume(0)).toBe('0 kg')
  })
  it('uses a lowercase t with a space from a tonne', () => {
    expect(formatLifetimeVolume(1000)).toBe('1.0 t')
    expect(formatLifetimeVolume(1500)).toBe('1.5 t')
    expect(formatLifetimeVolume(999_000)).toBe('999.0 t')
  })
  it('uses kt from a million kg, never 1500.0 t', () => {
    expect(formatLifetimeVolume(1_000_000)).toBe('1.0 kt')
    expect(formatLifetimeVolume(1_500_000)).toBe('1.5 kt')
  })
  it('keeps a negative in kg and reads absence as an em dash', () => {
    expect(formatLifetimeVolume(-12)).toBe('-12 kg')
    expect(formatLifetimeVolume(null)).toBe('—')
    expect(formatLifetimeVolume(undefined)).toBe('—')
    expect(formatLifetimeVolume(Number.NaN)).toBe('—')
  })
})

describe('formatVolumeKg', () => {
  it('writes whole kilograms with separators', () => {
    expect(formatVolumeKg(4320)).toBe('4,320 kg')
    expect(formatVolumeKg(1_500_000)).toBe('1,500,000 kg')
    expect(formatVolumeKg(0)).toBe('0 kg')
    expect(formatVolumeKg(812.6)).toBe('813 kg')
  })
  it('reads absence as an em dash', () => {
    expect(formatVolumeKg(null)).toBe('—')
    expect(formatVolumeKg(undefined)).toBe('—')
  })
})

describe('formatWaterMl', () => {
  it('uses litres with one decimal from 1000 ml', () => {
    expect(formatWaterMl(1000)).toBe('1.0 L')
    expect(formatWaterMl(1800)).toBe('1.8 L')
    expect(formatWaterMl(2500)).toBe('2.5 L')
  })
  it('uses ml below 1000, with a space, no separator', () => {
    expect(formatWaterMl(500)).toBe('500 ml')
    expect(formatWaterMl(999)).toBe('999 ml')
    expect(formatWaterMl(0)).toBe('0 ml')
  })
  it('reads absence as an em dash', () => {
    expect(formatWaterMl(null)).toBe('—')
    expect(formatWaterMl(undefined)).toBe('—')
  })
  it('hands a tile the number and the unit apart', () => {
    expect(waterParts(1800)).toEqual({ value: '1.8', unit: 'L' })
    expect(waterParts(250)).toEqual({ value: '250', unit: 'ml' })
    expect(waterParts(null)).toBeNull()
  })
})

describe('formatLifetimeDistance', () => {
  it('uses one decimal under 100 km and separators from 100 km', () => {
    expect(formatLifetimeDistance(12.34)).toBe('12.3 km')
    expect(formatLifetimeDistance(99.94)).toBe('99.9 km')
    expect(formatLifetimeDistance(100)).toBe('100 km')
    expect(formatLifetimeDistance(1234.5)).toBe('1,235 km')
  })
  it('reads none, zero, negative and missing as an em dash', () => {
    expect(formatLifetimeDistance(0)).toBe('—')
    expect(formatLifetimeDistance(-3)).toBe('—')
    expect(formatLifetimeDistance(null)).toBe('—')
    expect(formatLifetimeDistance(undefined)).toBe('—')
  })
})
