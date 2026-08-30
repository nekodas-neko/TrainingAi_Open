// TN-13 — which night the tile's number comes from.
//
// The bug this guards is invisible when it happens: `bodyMetrics` arrives from the repository with
// no ordering `readiness-payload.ts` may rely on — the module defines its own `asc()` helper before
// building any series for exactly that reason — so taking "the last row" would show a plausible bpm
// from the wrong night, and nothing on screen would say so.
import { describe, it, expect } from 'vitest'
import { latestRestingHrRow } from '@/lib/health/readiness-payload'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const row = (date: string, restingHeartRate: number | null) => ({ date, restingHeartRate })

describe('latestRestingHrRow', () => {
  it('takes the newest date, not the last element', () => {
    // Deliberately unsorted, and the newest is in the middle.
    const rows = [row('2026-08-25', 55), row('2026-08-30', 50), row('2026-08-27', 53)]
    expect(latestRestingHrRow(rows)).toEqual(row('2026-08-30', 50))
  })

  it('is unaffected by the order the rows arrive in', () => {
    const rows = [row('2026-08-25', 55), row('2026-08-30', 50), row('2026-08-27', 53)]
    const reversed = [...rows].reverse()
    expect(latestRestingHrRow(reversed)).toEqual(latestRestingHrRow(rows))
  })

  // A row exists for the day but the ring recorded nothing — that is an older night's reading
  // showing, not today's, and the date field is what lets a consumer say so.
  it('skips rows with no reading rather than returning a null bpm', () => {
    const rows = [row('2026-08-28', 53), row('2026-08-30', null), row('2026-08-29', 51)]
    expect(latestRestingHrRow(rows)).toEqual(row('2026-08-29', 51))
  })

  it('treats a zero as no reading', () => {
    expect(latestRestingHrRow([row('2026-08-30', 0), row('2026-08-29', 51)]))
      .toEqual(row('2026-08-29', 51))
  })

  it('returns null when nothing qualifies', () => {
    expect(latestRestingHrRow([])).toBeNull()
    expect(latestRestingHrRow([row('2026-08-30', null)])).toBeNull()
  })
})

// The wiring, asserted at source: a payload field nothing reads is not a fix, and the entry says so
// — *"a change that keeps the 7-day average and merely adds a cue beside it fails this entry."*
// Source-level because `oura-score-chip-row.tsx` cannot be imported in either vitest project (both
// run in `node`, and the file pulls in Next/React chrome); proved by trying it.
describe('the tile reads last night, and falls back rather than blanking (TN-13)', () => {
  const src = readFileSync(join(process.cwd(), 'components/oura-score-chip-row.tsx'), 'utf8')

  it('prefers the nightly value over the 7-day mean', () => {
    expect(src).toContain('readiness.restingHrLastNight ?? readiness.restingHr ?? readiness.hrCurrent')
  })

  // A user with no reading in the last 7 days must still get a tile — and `hrCurrent` stays LAST,
  // because it is a live BLE sample rather than a resting rate: a desk reading, not a night.
  it('keeps the fallback chain in that order', () => {
    const i = src.indexOf('readiness.restingHrLastNight ??')
    const chain = src.slice(i, src.indexOf(';', i))
    expect(chain.indexOf('restingHrLastNight')).toBeLessThan(chain.indexOf('restingHr '))
    expect(chain.indexOf('restingHr ')).toBeLessThan(chain.indexOf('hrCurrent'))
  })

  // The empty-state guard has to know about the new field, or a user whose ONLY reading is last
  // night's gets no row at all.
  it('counts the nightly value when deciding whether to render', () => {
    const i = src.indexOf('readiness.readinessDisplayScore == null')
    expect(src.slice(i, src.indexOf('return null', i))).toContain('readiness.restingHrLastNight == null')
  })

  it('renders the shared cue rather than a second copy of the rule', () => {
    expect(src).toContain('from "@trainingai/shared/health/resting-hr-cue"')
    expect(src).not.toMatch(/function restingHrCue/)
  })
})
