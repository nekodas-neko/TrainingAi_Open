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

// Issue 2236: the daytime-stress bucket backfill shares the slot but redecodes nothing.
describe('the stress-backfill kinds (issue 2236)', () => {
  const DRY = { fullHistory: true, stressBackfill: true, dryRun: true }
  const WRITE = { fullHistory: true, stressBackfill: true, dryRun: false }

  it('reads a literal dryRun:false as the write and anything else as the dry run', () => {
    expect(redecodeJobKind(WRITE)).toBe('stress-backfill')
    expect(redecodeJobKind(DRY)).toBe('stress-backfill-dry-run')
    for (const v of [true, 'false', 0, null, undefined]) {
      expect(redecodeJobKind({ stressBackfill: true, dryRun: v }), String(v)).toBe('stress-backfill-dry-run')
    }
    // A stringly or missing flag is not the stress backfill at all.
    expect(redecodeJobKind({ stressBackfill: 'true', dryRun: false })).toBe('redecode')
  })

  it('refuses a stress backfill behind a plain redecode or a step backfill, and the reverse', () => {
    for (const other of ['redecode', 'step-backfill'] as const) {
      for (const stress of ['stress-backfill', 'stress-backfill-dry-run'] as const) {
        expect(canFollowRunningRedecode(stress, other), `${stress} behind ${other}`).toBe(false)
        expect(canFollowRunningRedecode(other, stress), `${other} behind ${stress}`).toBe(false)
      }
    }
  })

  it('never lets a write follow a dry run, or a dry run follow a write', () => {
    expect(canFollowRunningRedecode('stress-backfill', 'stress-backfill-dry-run')).toBe(false)
    expect(canFollowRunningRedecode('stress-backfill-dry-run', 'stress-backfill')).toBe(false)
  })

  it('lets each stress kind follow its own', () => {
    expect(canFollowRunningRedecode('stress-backfill', 'stress-backfill')).toBe(true)
    expect(canFollowRunningRedecode('stress-backfill-dry-run', 'stress-backfill-dry-run')).toBe(true)
  })
})
