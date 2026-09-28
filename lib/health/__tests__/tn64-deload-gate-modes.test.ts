import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

/**
 * TN-64(b) — the gate the owner approved widening, and the two properties that must survive it.
 *
 * `earlyDeloadRecommended` is the ONLY place a readiness score automatically changes what the app
 * prescribes, and it had never fired in 118 sessions. Measured on production 2026-09-25: of five
 * programs, three are `ai_dynamic` and two are `automatic` — and the two `automatic` ones are the
 * OLDEST (May 23, Jun 5) and both inactive, while the active program is `ai_dynamic`. So the gate
 * was not firing rarely; it was unreachable for every session logged since that move.
 *
 * Scraped from source rather than imported, for the reason the sibling threshold test gives:
 * importing `readiness-payload.ts` pulls the whole data layer into a unit test.
 */

const root = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
/** Comments here discuss the very strings under test — strip them, or the file matches itself. */
const code = (src: string) => stripComments(src)

const payload = code(read('lib/health/readiness-payload.ts'))

const gate = (() => {
  const at = payload.indexOf('let earlyDeloadRecommended = false')
  expect(at, 'the early-deload block').toBeGreaterThan(-1)
  const open = payload.indexOf('if (', at)
  const end = payload.indexOf('{', open)
  return payload.slice(open, end)
})()

describe('the early-deload gate covers the modes the app periodizes (TN-64b)', () => {
  it('admits ai_dynamic — the mode the active program actually uses', () => {
    expect(gate).toContain("phaseMode === 'ai_dynamic'")
  })

  it('still admits automatic, so widening did not swap one dead mode for another', () => {
    expect(gate).toContain("phaseMode === 'automatic'")
  })

  it('does NOT admit manual — that is a different question, and was not approved', () => {
    // Under `manual` the owner drives the phases himself. Extending the recommender there is a
    // product decision nobody has made; a later "tidy-up" to `!== 'manual'` would make it by
    // accident, which is exactly the shape this pins.
    expect(gate).not.toContain("'manual'")
  })

  it('leaves the thresholds to their named constants, so a prompt means the gate opened', () => {
    // Moving EARLY_DELOAD_SCORE_MAX or EARLY_DELOAD_ACWR_MIN in the same change would make a new
    // prompt ambiguous between "the gate opened" and "the bar dropped". The sibling test pins the
    // values; this pins that the check still reads them rather than inlining a number.
    expect(payload).toContain('score < EARLY_DELOAD_SCORE_MAX && acwr > EARLY_DELOAD_ACWR_MIN')
  })
})

describe('the app still never deloads him on its own (TN-64c)', () => {
  it('the read path recommends and does not apply', () => {
    // The whole reversibility of (b) rests on this: widening the gate widens who is ASKED, not
    // what happens. `readiness-payload.ts` must never reach the write.
    expect(payload).not.toContain('confirmEarlyDeload')
  })

  it('the only caller of the write is the confirm route, behind a POST', () => {
    const route = read('app/api/confirm-early-deload/route.ts')
    expect(route).toContain('export async function POST')
    expect(route).toContain('repo.confirmEarlyDeload(')
    // Unauthenticated callers cannot reach it, and it refuses any program but the active one.
    expect(route).toContain('Unauthorized')
    expect(route).toContain('Can only early-deload the active program')
  })
})
