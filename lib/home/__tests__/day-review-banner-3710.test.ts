// #3710: the current app's Home read the Day in review gate (hour ≥ 17, today's dismiss key) only on
// mount, so a Home left resident overnight kept offering yesterday's review the next morning. The
// gate is one helper now, read on mount and on every return to the foreground.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dayReviewDismissKey, dayReviewHidden } from '../day-review-banner'

const TZ = 'Australia/Brisbane' // UTC+10, no DST
const store = new Map<string, string>()
const getItem = (k: string) => store.get(k) ?? null

afterEach(() => { vi.useRealTimers(); store.clear() })

describe('dayReviewHidden (#3710)', () => {
  it('offers the review from 17:00 local until dismissed, and hides it again the next morning', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-10T08:30:00Z')) // 18:30 local, 10 Nov
    expect(dayReviewHidden(TZ, getItem)).toBe(false)
    store.set(dayReviewDismissKey(TZ), '1')
    expect(dayReviewHidden(TZ, getItem)).toBe(true)

    store.clear()
    vi.setSystemTime(new Date('2026-11-10T21:00:00Z')) // 07:00 local, 11 Nov
    expect(dayReviewHidden(TZ, getItem)).toBe(true)
    // Yesterday's dismiss does not carry into this evening.
    store.set('ta_day_review_dismissed_2026-11-10', '1')
    vi.setSystemTime(new Date('2026-11-11T07:30:00Z')) // 17:30 local, 11 Nov
    expect(dayReviewHidden(TZ, getItem)).toBe(false)
    expect(dayReviewDismissKey(TZ)).toBe('ta_day_review_dismissed_2026-11-11')
  })
})

describe('Home re-reads the gate when it returns to the foreground (#3710)', () => {
  it('the visibilitychange handler sets dayReviewDismissed from the helper', () => {
    const src = readFileSync(join(process.cwd(), 'app/session-select/session-select-content.tsx'), 'utf8')
    const start = src.indexOf('const onVisible = () => {')
    const end = src.indexOf("document.addEventListener('visibilitychange', onVisible)", start)
    expect(start).toBeGreaterThan(-1)
    expect(src.slice(start, end)).toMatch(/setDayReviewDismissed\(dayReviewHidden\(tz,/)
  })
})
