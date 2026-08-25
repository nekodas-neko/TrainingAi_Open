// Q-292: the AI told the owner he had "a perfect activity score" on a day the stored score was 80,
// and "a perfect recovery index" on a day that contributor scored 21 of 100 — then advised keeping
// the bedroom at "65 degrees Fahrenheit" to a user whose app is metric throughout. Across all 117
// audited insights: 12 absolute superlatives and 7 Fahrenheit errors, ~16% carrying at least one.
//
// The guard is prompt text, so what is testable is that it reaches every route that writes prose
// and says the things it has to. A sixth route added without it is the failure this catches.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROSE_GUARDS } from '../prompt-guards'

const root = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

// Every route that asks a model for user-facing prose. `prompt.ts` is health-insight's builder,
// which is where all 7 Fahrenheit errors landed.
const PROSE_ROUTES = [
  'app/api/ai/health-insight/prompt.ts',
  'app/api/daily-digest/route.ts',
  'app/api/weekly-digest/route.ts',
  'app/api/workout-sessions/[id]/recap/route.ts',
  'app/api/session-explain/insight/route.ts',
]

describe('the prose guards reach every route that writes prose (Q-292)', () => {
  it.each(PROSE_ROUTES)('%s interpolates PROSE_GUARDS', path => {
    expect(read(path)).toContain('${PROSE_GUARDS}')
  })

  it('is one shared string, not a per-route copy', () => {
    // The wording drifting into five versions is how the sleep route ends up without the units
    // clause again. Nothing outside prompt-guards.ts may declare its own.
    for (const path of PROSE_ROUTES) {
      expect(read(path)).toContain("from '@/lib/ai/prompt-guards'")
    }
  })
})

describe('the guards say the two things that actually went wrong', () => {
  it('forbids imperial units by name', () => {
    expect(PROSE_GUARDS).toMatch(/Metric units only/)
    expect(PROSE_GUARDS).toMatch(/Celsius/)
    expect(PROSE_GUARDS).toMatch(/[Nn]ever convert .* to imperial/)
  })

  it('forbids the superlatives that were actually fabricated', () => {
    // "perfect" is the one observed twice, on scores of 80 and 21.
    for (const word of ['perfect', 'record', 'best', 'all-time']) {
      expect(PROSE_GUARDS).toContain(word)
    }
  })

  it('tells the model to quote rather than recompute', () => {
    expect(PROSE_GUARDS).toMatch(/Quote the numbers you were given/)
  })
})
