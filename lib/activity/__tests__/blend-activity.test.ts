import { describe, it, expect } from 'vitest'
import { blendActivityScore } from '../blend-activity'

describe('blendActivityScore', () => {
  it('leaves the score untouched on a rest day (no logged volume)', () => {
    const r = blendActivityScore({
      ouraActivityScore: 62,
      trainingVolumeContrib: 46,
      todayWorkoutVolumeKg: 0,
      typicalSessionVolumeKg: 8000,
    })
    expect(r.trained).toBe(false)
    expect(r.adjustment).toBe(0)
    expect(r.final).toBe(62)
  })

  it('gives a strong bump on a typical-volume day Oura under-counted', () => {
    const r = blendActivityScore({
      ouraActivityScore: 62,
      trainingVolumeContrib: 46,   // low → Oura missed most of the training
      todayWorkoutVolumeKg: 8000,
      typicalSessionVolumeKg: 8000,
    })
    // raw = 6 + 8*1 = 14; missed = 1 - 0.46 = 0.54; 14*0.54 ≈ 7.56 → 8
    expect(r.trained).toBe(true)
    expect(r.adjustment).toBe(8)
    expect(r.final).toBe(70)
  })

  it('adds almost nothing when Oura already scored training high', () => {
    const r = blendActivityScore({
      ouraActivityScore: 80,
      trainingVolumeContrib: 90,   // Oura already captured the session
      todayWorkoutVolumeKg: 8000,
      typicalSessionVolumeKg: 8000,
    })
    // missed = 0.1; 14*0.1 = 1.4 → 1
    expect(r.adjustment).toBe(1)
    expect(r.final).toBe(81)
  })

  it('respects the MAX_ADJ cap on a huge session Oura entirely missed', () => {
    const r = blendActivityScore({
      ouraActivityScore: 50,
      trainingVolumeContrib: 0,
      todayWorkoutVolumeKg: 100000,
      typicalSessionVolumeKg: 8000,
    })
    expect(r.adjustment).toBe(14)
    expect(r.final).toBe(64)
  })

  it('never exceeds 100', () => {
    const r = blendActivityScore({
      ouraActivityScore: 95,
      trainingVolumeContrib: 0,
      todayWorkoutVolumeKg: 9000,
      typicalSessionVolumeKg: 8000,
    })
    expect(r.final).toBe(100)
  })

  it('returns a null final when there is no Oura activity base, even if trained', () => {
    const r = blendActivityScore({
      ouraActivityScore: null,
      trainingVolumeContrib: null,
      todayWorkoutVolumeKg: 8000,
      typicalSessionVolumeKg: 8000,
    })
    expect(r.trained).toBe(true)
    expect(r.adjustment).toBe(0)
    expect(r.final).toBeNull()
  })

  it('scales the bump down for a light (below-typical) session', () => {
    const r = blendActivityScore({
      ouraActivityScore: 60,
      trainingVolumeContrib: 0,
      todayWorkoutVolumeKg: 2000,
      typicalSessionVolumeKg: 8000,
    })
    // volRatio = 0.25; raw = 6 + 8*0.25 = 8; missed = 1 → 8
    expect(r.adjustment).toBe(8)
    expect(r.final).toBe(68)
  })
})
