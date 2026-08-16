import { describe, it, expect } from 'vitest'
import { recommendRunType } from '../recommend-run-type'
import type { ZoneQuota, ZoneQuotaRow } from '@trainingai/shared/health/zone-quota'

function row(zoneId: ZoneQuotaRow['zoneId'], remainingMin: number, status: ZoneQuotaRow['status'] = 'open'): ZoneQuotaRow {
  return { zoneId, targetMin: remainingMin + 10, doneMin: 10, remainingMin, pctComplete: 50, status }
}

function quota(zones: ZoneQuotaRow[]): ZoneQuota {
  const training = zones.filter((z) => z.zoneId !== 1)
  return {
    zones,
    trainingTargetMin: training.reduce((s, z) => s + z.targetMin, 0),
    trainingDoneMin: training.reduce((s, z) => s + z.doneMin, 0),
    trainingRemainingMin: training.reduce((s, z) => s + z.remainingMin, 0),
  }
}

describe('recommendRunType', () => {
  it('recommends interval when Z4/5 have the biggest open gap', () => {
    const q = quota([row(1, 4), row(2, 10), row(3, 2), row(4, 20), row(5, 15)])
    const rec = recommendRunType(q)
    expect(rec?.type).toBe('interval')
    expect(rec?.reason).toContain('Zone 4')
  })

  it('recommends easy/long when Z2 has the biggest open gap', () => {
    const q = quota([row(1, 4), row(2, 90), row(3, 5), row(4, 3), row(5, 0, 'not-required')])
    const rec = recommendRunType(q)
    expect(['easy', 'long']).toContain(rec?.type)
  })

  it('recommends tempo when Z3/4 dominate but not enough for interval to win', () => {
    const q = quota([row(1, 4), row(2, 5), row(3, 25), row(4, 10), row(5, 0, 'not-required')])
    const rec = recommendRunType(q)
    // tempo covers [3,4] = 35, interval covers [4,5] = 10 — tempo should win.
    expect(rec?.type).toBe('tempo')
  })

  it('ignores Z1 entirely — a fully-passive week recommends nothing from it', () => {
    const q = quota([row(1, 200), row(2, 0, 'complete'), row(3, 0, 'not-required'), row(4, 0, 'not-required'), row(5, 0, 'not-required')])
    expect(recommendRunType(q)).toBeNull()
  })

  it('returns null once every training zone is complete or not-required', () => {
    const q = quota([row(1, 4), row(2, 0, 'complete'), row(3, 0, 'not-required'), row(4, 0, 'complete'), row(5, 0, 'not-required')])
    expect(recommendRunType(q)).toBeNull()
  })
})
