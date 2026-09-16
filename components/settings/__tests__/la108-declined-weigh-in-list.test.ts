import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
/** The component explains this bug at length, so a raw match would pass on the comment. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/[^\n]*/g, '')

/**
 * LA-108 — a declined weigh-in had no screen, so the recovery path built for it could not be reached.
 *
 * **Why it is more than a lost reading.** The weight band anchors on the last CONFIRMED weight, and
 * only a confirmed reading moves it. So an accidental *Not me* tap was irreversible: a genuine change
 * bigger than `SCALE_WEIGHT_ANOMALY_PCT` — a long gap plus an illness or injury — put the owner
 * outside his own band with nothing able to move it, and **every** reading after that was outside
 * too. Silent and self-sustaining.
 *
 * The engine half shipped 2026-09-14; this pins the list, which was the whole of what was left.
 */
describe('LA-108 — the declined weigh-in list', () => {
  const src = code('components/settings/scale-pairing.tsx')

  it('reads the dismissed array the route already returns', () => {
    // The route half is not this entry's, but the list is worthless if the key it reads is wrong.
    expect(read('app/api/scale-ble/pending/route.ts')).toMatch(/dismissed:/)
    expect(src).toMatch(/dismissed\?:\s*PendingReading\[\]/)
    expect(src, 'an older deploy of the route sends no key — that must read as none, not crash')
      .toMatch(/data\.dismissed \?\? \[\]/)
  })

  it('claims through the SAME confirm route the pending rows use', () => {
    // The engine widened confirmScaleSample to accept pending OR dismissed, so there is deliberately
    // no second write path. A bespoke endpoint here would be the thing to catch.
    const claim = src.slice(src.indexOf('async function claimReading'), src.indexOf('return (', src.indexOf('async function claimReading')))
    expect(claim).toMatch(/\/api\/scale-ble\/pending\/\$\{id\}\/confirm/)
    expect(claim, 'claiming writes body_metrics, so the Q-126 pair must fire')
      .toMatch(/invalidateBodyMetricWrite/)
    expect(claim).toMatch(/invalidateReadinessInputs/)
    // Invalidate BEFORE the refetch, per the ordering rule.
    expect(claim.indexOf('invalidateBodyMetricWrite')).toBeLessThan(claim.indexOf('loadToday()'))
  })

  it('offers no dismiss action on rows that are already dismissed', () => {
    // **The section has to be asserted present first.** `slice` from an `indexOf` that returns -1
    // yields the tail of the file, and a `.not.toMatch` over a section that does not exist passes
    // for the wrong reason — measured: this was the one assertion here that stayed green against
    // the unbuilt component.
    expect(src, 'no declined section at all').toMatch(/dismissed\.length > 0/)
    const list = src.slice(src.indexOf('dismissed.length > 0'))
    expect(list, 'the only move on a declined reading is to claim it back').not.toMatch(/dismissReading/)
    expect(list, 'and it must actually offer the claim').toMatch(/claimReading\(r\.id\)/)
  })

  it('does not sort — the server order is newest-first on purpose', () => {
    // In the lockout this exists for, the readings at the top ARE the wrongly-declined ones.
    const list = src.slice(src.indexOf('dismissed.length > 0'))
    expect(list).not.toMatch(/\.sort\(/)
    expect(list).toMatch(/dismissed\.map\(/)
  })

  it('renders a null weight rather than hiding the row, and times it in the USER\'s zone', () => {
    const list = src.slice(src.indexOf('dismissed.length > 0'))
    // A frame that would not decode is archived too; it still lists.
    expect(list).toMatch(/Unknown weight/)
    // A declined reading can be days old, so the time is what identifies it — and the repo's
    // timezone rule forbids a bare toLocaleTimeString.
    expect(list).toMatch(/formatTimeOfDay\(r\.measuredAt, userTz\)/)
    expect(list).not.toMatch(/toLocaleTimeString/)
  })
})
