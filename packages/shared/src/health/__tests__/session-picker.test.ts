import { describe, it, expect } from 'vitest'
import { recommendSession } from '../session-picker'
import type { ZoneQuota } from '../zone-quota'

// Z1 defaults to 'not-required' (not 'open') since it's excluded from training-zone
// recommendations by design (spec D-10) — a test that wants Z1 open must say so explicitly.
function quotaWith(zones: Partial<Record<number, { remainingMin: number; status: 'open' | 'complete' | 'not-required' }>>): ZoneQuota {
  const base = [1, 2, 3, 4, 5].map((zoneId) => ({
    zoneId: zoneId as 1 | 2 | 3 | 4 | 5,
    targetMin: 100, doneMin: 0, remainingMin: 0, pctComplete: 0,
    status: (zoneId === 1 ? 'not-required' : 'open') as 'open' | 'complete' | 'not-required',
    ...(zones[zoneId] ?? {}),
  }))
  return { zones: base, trainingTargetMin: 300, trainingDoneMin: 0, trainingRemainingMin: 300 }
}

describe('recommendSession', () => {
  it('recommends run when a pending prescription fits the time budget', () => {
    const rec = recommendSession({
      minutesAvailable: 30,
      runningPlan: {
        hasPlan: true, runPending: true, prescriptionDurationMin: 28,
        prescriptionType: 'easy', gateAction: 'proceed', gateReasons: [],
      },
      quota: quotaWith({}),
    })
    expect(rec.modality).toBe('run')
    expect(rec.reason).toContain('easy run')
  })

  it('does not recommend run when the time budget is too short', () => {
    const rec = recommendSession({
      minutesAvailable: 15,
      runningPlan: {
        hasPlan: true, runPending: true, prescriptionDurationMin: 40,
        prescriptionType: 'long', gateAction: 'proceed', gateReasons: [],
      },
      quota: quotaWith({ 2: { remainingMin: 40, status: 'open' } }),
    })
    expect(rec.modality).not.toBe('run')
  })

  it('does not recommend run when today\'s run is already done', () => {
    const rec = recommendSession({
      minutesAvailable: 30,
      runningPlan: {
        hasPlan: true, runPending: false, prescriptionDurationMin: 30,
        prescriptionType: 'easy', gateAction: 'proceed', gateReasons: [],
      },
      quota: quotaWith({ 2: { remainingMin: 40, status: 'open' } }),
    })
    expect(rec.modality).toBe('walk')
  })

  it('carries the gate reason when recommending a softened run', () => {
    const rec = recommendSession({
      minutesAvailable: 30,
      runningPlan: {
        hasPlan: true, runPending: true, prescriptionDurationMin: 25,
        prescriptionType: 'easy', gateAction: 'soften',
        gateReasons: ['You trained legs hard in the last day — this is an easy run.'],
      },
      quota: quotaWith({}),
    })
    expect(rec.modality).toBe('run')
    expect(rec.gate).toEqual({ action: 'soften', reasons: ['You trained legs hard in the last day — this is an easy run.'] })
  })

  it('recommends walk when there is an open zone gap and no fitting run', () => {
    const rec = recommendSession({
      minutesAvailable: 30,
      runningPlan: { hasPlan: false, runPending: false, prescriptionDurationMin: null, prescriptionType: null, gateAction: null, gateReasons: [] },
      quota: quotaWith({ 2: { remainingMin: 40, status: 'open' } }),
    })
    expect(rec.modality).toBe('walk')
    expect(rec.reason).toContain('Z2')
    expect(rec.estimateMin).toBe(30) // min(minutesAvailable, remainingMin)
  })

  it('recommends activity when the week is fully on track', () => {
    const rec = recommendSession({
      minutesAvailable: 30,
      runningPlan: { hasPlan: false, runPending: false, prescriptionDurationMin: null, prescriptionType: null, gateAction: null, gateReasons: [] },
      quota: quotaWith({
        1: { remainingMin: 0, status: 'complete' }, 2: { remainingMin: 0, status: 'complete' },
        3: { remainingMin: 0, status: 'not-required' }, 4: { remainingMin: 0, status: 'not-required' },
        5: { remainingMin: 0, status: 'not-required' },
      }),
    })
    expect(rec.modality).toBe('activity')
  })

  it('picks the zone with the most remaining minutes when several are open', () => {
    const rec = recommendSession({
      minutesAvailable: 30,
      runningPlan: { hasPlan: false, runPending: false, prescriptionDurationMin: null, prescriptionType: null, gateAction: null, gateReasons: [] },
      quota: quotaWith({ 2: { remainingMin: 10, status: 'open' }, 3: { remainingMin: 50, status: 'open' } }),
    })
    expect(rec.reason).toContain('Z3')
  })
})
