// TN-50. The morning check-in's energy level scored 10% of readiness — and the sheet used to
// pre-select it by running `readinessToEnergy(readiness)`, so readiness set the default, the
// default went unchanged, and the check-in then fed 10% of that same readiness back in. The loop
// closed inside one day.
//
// Measured over the 62 days carrying both a check-in and a readiness score, the saved level was
// exactly what the auto-fill would have picked on 45 of them — 73%, against roughly 20-25% by
// chance. So most of the contributor was a re-reading of the score it feeds.
//
// **Seeding a FIXED level instead would not have fixed it.** The value would still be one the
// lifter never chose, and the stored column would stay impossible to read back — which is the
// entry's own item 3. Nothing is pre-selected now: unanswered means no log.
//
// #2224 then took the check-in out of readiness altogether, so the loop cannot re-form even if a
// seed came back. The last block below pins that end of it.
//
// Source-text guard, for the same reason Q-226's is: this repo has no React component-testing
// stack, and the defect is the ABSENCE of a seed — invisible to the type system. The behaviour it
// produces is pinned by `e2e/tn50-checkin-starts-unanswered.spec.ts`.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { READINESS_WEIGHTS, READINESS_MODEL } from '@trainingai/shared/health/readiness-composite'

const SRC = readFileSync(join(process.cwd(), 'components/mood-checkin-sheet.tsx'), 'utf8')

/** `SRC` with comment lines dropped. The file deliberately NAMES the removed mapping in prose, to
 *  say why it must not come back — so an assertion that the mapping is gone has to read the code
 *  rather than the commentary, or it fails on its own explanation. */
const CODE = SRC.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

describe('the check-in no longer infers its answer from the score it feeds (TN-50)', () => {
  it('the readiness→energy mapping is gone entirely, not just unused', () => {
    // Leaving the function behind invites the next reader to wire it back up.
    expect(CODE).not.toMatch(/function readinessToEnergy/)
    expect(CODE).not.toMatch(/readinessToEnergy\s*\(/)
  })

  it('energy starts UNSET and nothing seeds it', () => {
    // Two separate lines, and only the SECOND is load-bearing — measured, not assumed. Mutating the
    // initialiser back to a level leaves `e2e/tn50-checkin-starts-unanswered.spec.ts` GREEN, because
    // the reset effect fires on open and overwrites it; mutating the reset arm turns that spec red.
    // The initialiser still matters for the first render before the effect runs, so both are pinned
    // — but anyone verifying this change must mutate the reset arm or they are testing nothing.
    expect(SRC).toMatch(/useState<EnergyLevel \| null>\(null\)/)
    expect(SRC).toMatch(/setEnergy\(null\)/)
  })

  it('an unanswered sheet cannot be saved, because "unanswered" is not a storable value', () => {
    // `MoodLog.energyLevel` is non-nullable and lives in packages/shared (Lane A), so the absence
    // has to be represented by there being no log at all — which is the path that already scores 50.
    expect(SRC).toMatch(/if \(energy === null\) return/)
    expect(SRC).toMatch(/disabled=\{saving \|\| energy === null\}/)
  })

  it('`readiness` is still shown for context but no longer drives anything', () => {
    expect(SRC).toMatch(/Readiness \{readiness\}/)
    expect(CODE).not.toMatch(/setEnergy\(readinessToEnergy/)
  })
})

describe('the check-in cannot feed the score it once seeded itself from (#2224)', () => {
  it('readiness has no check-in term, so there is no loop left to close', () => {
    expect(Object.keys(READINESS_WEIGHTS)).not.toContain('checkin')
    expect(Object.keys(READINESS_MODEL.directions)).not.toContain('checkin')
  })
})
