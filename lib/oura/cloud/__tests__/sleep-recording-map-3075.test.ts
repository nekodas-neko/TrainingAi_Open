// #3075 stages 4 and 5: the Oura connector maps its own fields into the generic night shapes.
import { describe, it, expect } from 'vitest'
import { ouraMovementSeries, ouraRecordingIncomplete, ouraAlgorithmVersion, OURA_MOVEMENT_EPOCH_SEC } from '@/lib/oura/cloud/sleep-recording-map'
import { restlessnessFromMovement } from '@trainingai/shared/health/sleep-recording'

const START = new Date('2026-10-19T13:00:00.000Z')

describe('ouraMovementSeries', () => {
  it('maps classes 1-4 onto our 0-3 scale, one 30-second epoch per character', () => {
    expect(ouraMovementSeries('1234', START)).toEqual({ epochSec: OURA_MOVEMENT_EPOCH_SEC, startAt: START, levels: [0, 1, 2, 3] })
  })

  it('reads a character Oura did not classify as unmeasured, not still', () => {
    expect(ouraMovementSeries('1x2', START)!.levels).toEqual([0, null, 1])
  })

  it('has no series without a string or a start', () => {
    expect(ouraMovementSeries(null, START)).toBeNull()
    expect(ouraMovementSeries('', START)).toBeNull()
    expect(ouraMovementSeries('1121', null)).toBeNull()
  })

  it('feeds the generic restlessness rule: an 8-hour night with every fourth epoch moving is 25% restless', () => {
    const str = Array.from({ length: 960 }, (_, i) => (i % 4 === 0 ? '2' : '1')).join('')
    const r = restlessnessFromMovement(ouraMovementSeries(str, START), { from: START, to: new Date(START.getTime() + 8 * 3_600_000) })
    expect(r).toEqual({ restlessMin: 120, measuredMin: 480, restlessFraction: 0.25 })
  })
})

describe('the recording flags', () => {
  it('only a true low-battery alert says the recording is incomplete', () => {
    expect(ouraRecordingIncomplete(true)).toBe(true)
    expect(ouraRecordingIncomplete(false)).toBe(false)
    expect(ouraRecordingIncomplete(null)).toBe(false)
  })

  it('the algorithm version passes through, and an empty one is none', () => {
    expect(ouraAlgorithmVersion('v2')).toBe('v2')
    expect(ouraAlgorithmVersion(' ')).toBeNull()
    expect(ouraAlgorithmVersion(null)).toBeNull()
  })
})
