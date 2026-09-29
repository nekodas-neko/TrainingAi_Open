import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  zoneLabel, cardioCriterion, cardioStatus, countedProgress, completedLine,
} from '../todays-cardio-copy'

describe('RV-166 — what the card says the prescription needs', () => {
  it('states the criterion in zone terms, which is the point of the change', () => {
    expect(cardioCriterion({
      runType: 'easy', durationMin: 25, targetZoneIds: [2], targetHrLow: 107, targetHrHigh: 134,
    })).toEqual({ headline: '25 min in Zone 2', detail: '107–134 bpm · a run or a walk both count' })
  })

  it('falls back to the run type when the prescription has no zone target', () => {
    const c = cardioCriterion({
      runType: 'tempo', durationMin: 30, targetZoneIds: [], targetHrLow: null, targetHrHigh: null,
    })
    expect(c.headline).toBe('Tempo 30 min')
    // The rule that a walk counts must survive even with nothing to state it against.
    expect(c.detail).toBe('a run or a walk both count')
  })

  it('names zones as a range only when they are contiguous', () => {
    expect(zoneLabel([2])).toBe('Zone 2')
    expect(zoneLabel([3, 2])).toBe('Zones 2–3')
    expect(zoneLabel([1, 3, 4])).toBe('Zones 1, 3 and 4')
    expect(zoneLabel([])).toBeNull()
  })
})

describe('RV-166 — how much of it counts', () => {
  it('reads measured zone minutes as observed', () => {
    expect(countedProgress(18, null)).toEqual({ min: 18, source: 'observed' })
  })

  it('counts a walk with NO heart rate from its logged minutes, marked estimated', () => {
    // The owner's decision, 2026-09-27: refusing to complete a walk he actually did is the worse
    // failure. `estimated` is observed-hr.ts's own discriminator, not a new flag.
    expect(countedProgress(0, { durationMin: 30 })).toEqual({ min: 30, source: 'estimated' })
  })

  it('does not invent minutes when there is neither a zone reading nor a walk', () => {
    expect(countedProgress(0, null)).toEqual({ min: 0, source: 'observed' })
    expect(countedProgress(0, { durationMin: null })).toEqual({ min: 0, source: 'observed' })
  })

  it('prefers the measured reading over the estimate when both exist', () => {
    expect(countedProgress(12, { durationMin: 30 }).source).toBe('observed')
  })
})

describe('RV-166 — the day’s verdict', () => {
  it('is in progress once anything counts, and done only when the row says so', () => {
    expect(cardioStatus('pending', 0)).toBe('todo')
    expect(cardioStatus('pending', 8)).toBe('in-progress')
    expect(cardioStatus('completed', 0)).toBe('done')
    expect(cardioStatus('skipped', 30)).toBe('skipped')
  })

  it('names the modality that satisfied it, and reads a null completedAs as a run', () => {
    expect(completedLine('walk', { durationMin: 28 })).toBe('Completed as a walk · 28 min')
    expect(completedLine('walk', null)).toBe('Completed as a walk')
    // LB-179: null means completed before it was tracked, and every such row was a run.
    expect(completedLine(null, { durationMin: 40 })).toBe('Completed as a run · 40 min')
  })
})

describe('RV-166 — the guard that made this dead code', () => {
  it('no longer requires the activity to be a run before linking the prescription', () => {
    const src = readFileSync(join(__dirname, '../../activity/done-activity-screen.tsx'), 'utf8')
    expect(src, 'a walk that cannot satisfy the prescription is the whole defect')
      .not.toMatch(/activityType === 'run' && prescribedRunId/)
    // And every link must SAY how it was satisfied: the server writes null otherwise, and
    // completedAsRun() reads null as a run, so a silent walk re-plans the next quality session.
    const links = src.match(/linkPrescribedRun\(userId[^)]*\)/g) ?? []
    expect(links.length).toBe(2)
    for (const call of links) expect(call).toContain('completedAsFor(activityType)')
  })
})
