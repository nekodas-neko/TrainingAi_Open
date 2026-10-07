// #2505 — Health's local-store seed handed `metaRecent` the store's rows OLDEST-first and ~31 days
// wide, where every reader of `metaRecent` assumes the network payload's shape: the NEWEST 7 days,
// newest first. So the latest-weight tile picked the oldest weigh-in of the month and the sparklines
// drew backwards over a month. The window is defined once and both producers use it.
import { describe, it, expect } from 'vitest'
import { recentBodyRows, BODY_RECENT_DAYS, bodyRecentFromDay } from '../body-recent-window'

const row = (date: string, weightKg?: number) => ({ date, weightKg })
const TODAY = '2026-03-31'

describe('recentBodyRows (#2505)', () => {
  it('is the 7-day window the route reads', () => {
    expect(BODY_RECENT_DAYS).toBe(7)
    expect(bodyRecentFromDay(TODAY)).toBe('2026-03-24')
  })

  it('returns newest first, so `find(weight != null)` is the latest weigh-in', () => {
    // The local store returns ORDER BY date ascending.
    const asStored = [row('2026-03-25', 80), row('2026-03-27', 79.5), row('2026-03-31', 79)]
    const recent = recentBodyRows(asStored, TODAY)
    expect(recent.map(r => r.date)).toEqual(['2026-03-31', '2026-03-27', '2026-03-25'])
    expect(recent.find(r => r.weightKg != null)?.weightKg).toBe(79)
  })

  it('cuts a month of rows down to the window instead of passing them all through', () => {
    const month = Array.from({ length: 31 }, (_, i) => row(`2026-03-${String(i + 1).padStart(2, '0')}`, 80 - i / 10))
    const recent = recentBodyRows(month, TODAY)
    expect(recent[0].date).toBe('2026-03-31')
    expect(recent.every(r => r.date >= '2026-03-24')).toBe(true)
    // Never more than 7 rows, whatever the window holds: the route slices the same way.
    expect(recent.length).toBe(7)
  })

  it('keeps the oldest-weigh-in trap shut: the month\'s first row is not what a reader gets', () => {
    const month = Array.from({ length: 31 }, (_, i) => row(`2026-03-${String(i + 1).padStart(2, '0')}`, 90 - i))
    expect(recentBodyRows(month, TODAY).find(r => r.weightKg != null)?.weightKg).toBe(60)   // 31 March, not 1 March's 90
  })

  it('includes the boundary day and excludes the day before it', () => {
    const recent = recentBodyRows([row('2026-03-23'), row('2026-03-24'), row('2026-03-31')], TODAY)
    expect(recent.map(r => r.date)).toEqual(['2026-03-31', '2026-03-24'])
  })

  it('drops a row dated after today, as the route\'s query does', () => {
    expect(recentBodyRows([row('2026-04-02'), row('2026-03-31')], TODAY).map(r => r.date)).toEqual(['2026-03-31'])
  })

  it('does not mutate its input', () => {
    const input = [row('2026-03-25'), row('2026-03-31')]
    const copy = JSON.stringify(input)
    recentBodyRows(input, TODAY)
    expect(JSON.stringify(input)).toBe(copy)
  })

  it('crosses a month end by calendar day, not by 86,400,000 ms', () => {
    expect(bodyRecentFromDay('2026-03-02')).toBe('2026-02-23')
    expect(recentBodyRows([row('2026-02-22'), row('2026-02-23'), row('2026-03-02')], '2026-03-02').map(r => r.date))
      .toEqual(['2026-03-02', '2026-02-23'])
  })

  it('is empty for no rows', () => {
    expect(recentBodyRows([], TODAY)).toEqual([])
  })
})

// The seed only runs on the device (the web build has no local store), so the wiring is pinned at the
// source: a guard that matches text surviving the feature being disabled is not coverage, so each
// pattern ties the helper to the call it must be inside.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../../../../../scripts/lib/strip-comments.js'

describe('both producers of `recent` use the one window (#2505)', () => {
  const root = join(__dirname, '..', '..', '..', '..', '..')
  const code = (rel: string) => stripComments(readFileSync(join(root, rel), 'utf8'))

  it('the local seed feeds setMetaRecent through recentBodyRows', () => {
    expect(code('app/health/health-content.tsx'))
      .toMatch(/setMetaRecent\(prev => \{[\s\S]*?return recentBodyRows\(filtered, todayInTz\(tz\)\)\.map\(/)
  })

  it('the route reads the same window and the same row count', () => {
    const route = code('app/api/body-metadata/route.ts')
    expect(route).toMatch(/const from = bodyRecentFromDay\(today\)/)
    expect(route).toMatch(/metrics\.slice\(0, BODY_RECENT_DAYS\)/)
  })
})
