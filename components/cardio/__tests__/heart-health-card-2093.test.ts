// Issue 2093 (was RV-166's card test). What the heart-health activity card says, and the guard that
// completion is decided by measured minutes and never by how an activity was started.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ANY_ACTIVITY, CARD_TITLE, OUTCOME_LABEL, PROGRESS_LABEL, RATIONALE,
  activityLine, criterionLine, progressFigure, shownActivity, zoneLabel, countedMinutesLine,
} from '../todays-cardio-copy'
import { completionsDue } from '@/lib/activity/heart-health-completion'

const walk = { id: 'w', title: 'Treadmill walk', activityType: 'treadmill', durationMin: 34, effortMin: 31 }
const stroll = { id: 's', title: 'Evening stroll', activityType: 'walk', durationMin: 41, effortMin: 6 }

describe('issue 2093 — the card, to the 10-05 mockup, with no run framing', () => {
  it('states the rule as moderate effort or above (issue 2746)', () => {
    expect(CARD_TITLE).toBe('Heart-health activity')
    expect(criterionLine(30)).toBe('30 min at moderate effort or above')
    expect(criterionLine(null)).toBe('Time at moderate effort or above')
    expect(PROGRESS_LABEL).toBe('Moderate-effort minutes today')
    expect(progressFigure(22, 30)).toBe('22 of 30')
  })

  it('never names a run anywhere in its copy', () => {
    const copy = [CARD_TITLE, ANY_ACTIVITY, RATIONALE, PROGRESS_LABEL, criterionLine(30), ...Object.values(OUTCOME_LABEL)]
    for (const line of copy) expect(line).not.toMatch(/\brun\b/i)
  })

  it('no user-visible line still says zone 2 is the bar (issue 2746)', () => {
    const copy = [RATIONALE, PROGRESS_LABEL, criterionLine(30), criterionLine(null), countedMinutesLine([walk], 31)]
    for (const line of copy) expect(line).not.toMatch(/zone 2/i)
    const card = readFileSync(join(__dirname, '../todays-cardio-card.tsx'), 'utf8')
    expect(card).not.toMatch(/zone 2 or above|zone 2\+/i)
  })

  it('names zones as a range only when they are contiguous', () => {
    expect(zoneLabel([2])).toBe('Zone 2')
    expect(zoneLabel([3, 2])).toBe('Zones 2–3')
    expect(zoneLabel([1, 3, 4])).toBe('Zones 1, 3 and 4')
    expect(zoneLabel([])).toBeNull()
  })
})

describe('issue 2093 — the history shows what was actually done', () => {
  it('names the activity and its minutes, never the prescription', () => {
    expect(activityLine(walk)).toBe('Treadmill walk · 34 min')
    expect(activityLine({ title: 'Ride', durationMin: null })).toBe('Ride')
  })

  it('shows the credited activity, else the longest one', () => {
    expect(shownActivity([stroll, walk], 'w')?.id).toBe('w')
    expect(shownActivity([walk, stroll], null)?.id).toBe('s')
    expect(shownActivity([], null)).toBeNull()
  })

  it('states the measured minutes, or that nothing measured them', () => {
    expect(countedMinutesLine([walk], 31)).toBe('31 min at moderate effort or above')
    expect(countedMinutesLine([walk, stroll], 37)).toBe('37 min at moderate effort or above across 2 activities')
    expect(countedMinutesLine([{ ...walk, effortMin: null }], 0)).toBe('No heart rate recorded')
    expect(countedMinutesLine([], 0)).toBe('')
  })

  it('labels each outcome as the mockup does', () => {
    expect(OUTCOME_LABEL.counted).toBe('Counted ✓')
    expect(OUTCOME_LABEL['not-counted']).toBe("Didn't count")
    expect(OUTCOME_LABEL.today).toBe('Today')
  })
})

describe('issue 2093 — which measured days the device records as done', () => {
  const day = (over: object) => ({
    date: '2026-10-06', runId: 'r1', status: 'pending', targetMin: 30, countedMin: 31, met: true,
    creditedId: 'w', activities: [walk], ...over,
  })
  it('a pending day that met the rule, whatever the activity', () => {
    expect(completionsDue([day({})])).toEqual([{ date: '2026-10-06', runId: 'r1', activityLogId: 'w', completedAs: 'walk' }])
  })
  it('not a day short of it, nor one already completed or skipped', () => {
    expect(completionsDue([
      day({ met: false, countedMin: 6 }),
      day({ runId: 'r2', status: 'completed' }),
      day({ runId: 'r3', status: 'skipped' }),
    ])).toEqual([])
  })
})

describe('issue 2093 / RV-166 — saving an activity completes nothing by itself', () => {
  // RV-166 dropped the run-only guard so a walk started FROM the prescription could complete it.
  // Under the zone-minutes rule how an activity was started does not matter at all, so neither
  // save path links a prescription any more: the measured verdict does, through
  // `useHeartHealthCompletion`, for any activity.
  it.each([
    '../../activity/done-activity-screen.tsx',
    '../../guided-walk/walk-summary.tsx',
  ])('%s does not call linkPrescribedRun', (rel) => {
    const src = readFileSync(join(__dirname, rel), 'utf8')
    expect(src).not.toMatch(/linkPrescribedRun|prescribedRunId/)
  })
})
