import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../../../scripts/lib/strip-comments.js'

// Split from the weight-response model tests when the model moved to `@trainingai/shared` (#2888):
// this one reads the card's own source, so it stays beside the card.

/** The label itself, read off the card, because the defect was one string. */
describe('the chip does not claim a shortage it does not have', () => {
  const raw = readFileSync(
    path.resolve(__dirname, '../weight-response-card.tsx'), 'utf8',
  )
  const code = stripComments(raw)

  it('picks the label from the state rather than falling through to one string', () => {
    expect(code).toMatch(/responseState\(result\) === 'undecided'/)
    expect(code).toMatch(/'Not called yet'/)
    // The regression: the bare fallback that conflated them.
    expect(code).not.toMatch(/tone\?\.label \?\? 'Not enough weigh-ins yet'/)
  })
})
