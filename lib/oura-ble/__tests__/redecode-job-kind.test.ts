/**
 * Issue 2383, item 1 — which running redecode a new request may follow.
 *
 * All full-history redecode buttons share one job slot. A request may follow a running job only if
 * that job writes everything the request asked for; otherwise it is refused (never queued).
 */
import { describe, it, expect } from 'vitest'
import { redecodeJobKind, canFollowRunningRedecode } from '../redecode-job-kind'

describe('redecodeJobKind', () => {
  it('is a step backfill only for a literal true', () => {
    expect(redecodeJobKind({ fullHistory: true, allowStepsDecrease: true })).toBe('step-backfill')
    for (const v of [false, 'true', 1, null, undefined]) {
      expect(redecodeJobKind({ allowStepsDecrease: v }), String(v)).toBe('redecode')
    }
    expect(redecodeJobKind({})).toBe('redecode')
    expect(redecodeJobKind(null)).toBe('redecode')
  })
})

describe('canFollowRunningRedecode', () => {
  it('never lets a step backfill follow a plain redecode — the correction would not run', () => {
    expect(canFollowRunningRedecode('step-backfill', 'redecode')).toBe(false)
  })

  it('lets a plain redecode follow a step backfill, which does the full redecode too', () => {
    expect(canFollowRunningRedecode('redecode', 'step-backfill')).toBe(true)
  })

  it('lets a request follow a run of its own kind', () => {
    expect(canFollowRunningRedecode('redecode', 'redecode')).toBe(true)
    expect(canFollowRunningRedecode('step-backfill', 'step-backfill')).toBe(true)
  })
})
