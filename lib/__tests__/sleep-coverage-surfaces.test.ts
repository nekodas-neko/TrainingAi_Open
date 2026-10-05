import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'
import { sleepCoverageNote } from '@/components/health/body-cards/sleep-coverage-note'
import { qualifierPhrase } from '@/components/health/score-qualifier'

/**
 * #2280 (OR-204). The owner, 2026-08-23: *"If its missing data it shouldnt [score] differently
 * [without saying so]. Depending on how much is missing."* #1996 put the note on the Health screen's
 * Sleep card and nowhere else, while the same score is also the Home Sleep chip and the hero of
 * /health/sleep. Every stored night since 2026-08-20 is full coverage (46 of 46, measured
 * 2026-10-06), so these fire rarely — which is the point: when they do, the number means less.
 *
 * Wiring is asserted against source, because these are `.tsx` screens and both vitest projects run
 * `environment: 'node'`, the same approach as `sleep-provisional-surfaces.test.ts`.
 */

const ROOT = path.resolve(__dirname, '..', '..')
const stripped = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), 'utf8')).replace(/\s+/g, ' ')

describe('the Home Sleep chip', () => {
  it('marks the cell limited from the score\'s own coverage', () => {
    const chip = stripped('components/oura-score-chip-row.tsx')
    // Scoped to the sleep cell: from its href up to the next cell's label, so a `limited` on the
    // Readiness cell cannot satisfy it.
    const cell = chip.slice(chip.indexOf('href: "/health/sleep"'), chip.indexOf('label: "Activity"'))
    expect(cell).toMatch(/limited: readiness\.sleepScoreCoverage != null && readiness\.sleepScoreCoverage\.level !== "full"/)
  })

  it('says why out loud, in the words the qualifier already uses', () => {
    expect(qualifierPhrase({ limited: true })).toContain('part of the usual inputs')
  })
})

describe('/health/sleep, where the chip leads', () => {
  it('names what is missing with the shared note, not a second copy of it', () => {
    const page = stripped('app/health/sleep/sleep-content.tsx')
    expect(page).toContain('sleepCoverageNote(data.sleepScoreCoverage)')
    expect(page).not.toMatch(/Partial data|Less complete/)
  })

  it('stays silent on a full night and for a score it did not compute', () => {
    expect(sleepCoverageNote({ ratio: 1, missing: [], level: 'full' })).toBeNull()
    expect(sleepCoverageNote(null)).toBeNull()
  })

  it('is strong once the autonomic quarter of the model is missing, and names it', () => {
    const note = sleepCoverageNote({ ratio: 0.75, missing: ['hrv', 'hr'], level: 'low' })
    expect(note?.strong).toBe(true)
    expect(note?.text).toContain('HRV')
    expect(note?.text).toContain('heart rate')
  })
})
