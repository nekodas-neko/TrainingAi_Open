// Q-292: the AI told the owner he had "a perfect activity score" on a day the stored score was 80,
// and "a perfect recovery index" on a day that contributor scored 21 of 100 — then advised keeping
// the bedroom at "65 degrees Fahrenheit" to a user whose app is metric throughout. Across all 117
// audited insights: 12 absolute superlatives and 7 Fahrenheit errors, ~16% carrying at least one.
//
// PS-32: the file claimed to be "imported by every prose-generating AI route" and reached 5 of 10.
// The reason the other five were skipped is real and is why they are not simply added to the list
// above: four of them exist to PRODUCE numbers (calorie and macro targets, sets/reps/%1RM), so the
// "quote, never recompute" rule contradicts their job. They carry PROSE_FIELD_GUARDS — the units
// and superlative rules, which apply to any text a model writes for this user.
//
// The guard is prompt text, so what is testable is that it reaches every route that writes prose
// and says the things it has to. An eleventh route added without either constant is what this
// catches.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PROSE_GUARDS, PROSE_FIELD_GUARDS, METRIC_UNITS_RULE, NO_SUPERLATIVE_RULE, QUOTE_NUMBERS_RULE } from '../prompt-guards'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const root = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

// Routes whose whole output is prose, and which therefore need the shared guards in their prompt.
//
// `app/api/ai/health-insight/prompt.ts` headed this list — it was where all 7 Fahrenheit errors
// landed — and RV-201 removed it by removing the model: the insight is now assembled from the
// numbers by `insight-text.ts`, which cannot pick a unit or a superlative at all. A route leaves
// this list when its model call goes, never because the guards became inconvenient.
const PROSE_ROUTES = [
  'app/api/daily-digest/route.ts',
  'app/api/workout-sessions/[id]/recap/route.ts',
  'app/api/session-explain/insight/route.ts',
]

// Routes that return structured data with a user-facing text field in it, and whose numbers are
// theirs to compute.
const PROSE_FIELD_ROUTES = [
  'app/api/nutrition-goals/recommend/route.ts',
  'app/api/generate-program/route.ts',
  'app/api/builder-chat/route.ts',
  'app/api/workout-review/session/[sessionId]/route.ts',
]

describe('the prose guards reach every route that writes prose (Q-292, PS-32)', () => {
  it.each(PROSE_ROUTES)('%s interpolates PROSE_GUARDS', path => {
    expect(read(path)).toContain('${PROSE_GUARDS}')
  })

  it.each(PROSE_FIELD_ROUTES)('%s interpolates PROSE_FIELD_GUARDS', path => {
    expect(read(path)).toContain('${PROSE_FIELD_GUARDS}')
  })

  it('is one shared string, not a per-route copy', () => {
    // The wording drifting into ten versions is how the sleep route ends up without the units
    // clause again. Nothing outside prompt-guards.ts may declare its own.
    for (const path of [...PROSE_ROUTES, ...PROSE_FIELD_ROUTES]) {
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

describe('the two guard sets differ only where they have to', () => {
  it('both carry the units and superlative rules', () => {
    for (const guards of [PROSE_GUARDS, PROSE_FIELD_GUARDS]) {
      expect(guards).toContain(METRIC_UNITS_RULE)
      expect(guards).toContain(NO_SUPERLATIVE_RULE)
    }
  })

  it('only the prose set forbids stating a number it was not given', () => {
    // A route that returns the calorie target cannot be told never to state a number that is not
    // already in its prompt. Adding this rule to PROSE_FIELD_GUARDS would break four routes at
    // once, silently, in a way only a model run would show.
    expect(PROSE_GUARDS).toContain(QUOTE_NUMBERS_RULE)
    expect(PROSE_FIELD_GUARDS).not.toContain(QUOTE_NUMBERS_RULE)
  })
})

// RV-173 — the list above is hand-written, and Coach was not on it for as long as Coach existed.
// It streams free prose about the owner's own numbers and carried none of the guards, while its
// docstring still claimed "no user-facing entry point yet" — `app/coach/coach-content.tsx` has
// driven it the whole time. A list cannot notice a route nobody adds to it, so this block DISCOVERS
// them instead: anything that calls a prose generator must be able to reach the guards.
//
// `generateObject` is deliberately not a prose generator here. It returns structured data against a
// schema, and its routes carry PROSE_FIELD_GUARDS only where a user-facing text field is in the
// object — which the explicit list above already covers.
const PROSE_CALL = /\b(loggedStreamText|streamText|generateText)\s*\(/

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) { if (e.name !== '__tests__') out.push(...routeFiles(rel)) }
    else if (e.name === 'route.ts') out.push(rel)
  }
  return out
}

/** The guards may live in a sibling the route imports — health-insight builds its prompt in ./prompt. */
/** The INTERPOLATION, not the identifier: an import that is never spliced into a prompt is a
 *  route with no guards and a tidy import list. Matching the bare name let that pass. */
const interpolates = (src: string) =>
  src.includes('${PROSE_GUARDS}') || src.includes('${PROSE_FIELD_GUARDS}')

function reachesGuards(rel: string): boolean {
  const src = stripComments(read(rel))
  if (interpolates(src)) return true
  const dir = rel.slice(0, rel.lastIndexOf('/'))
  for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const cand = join(root, dir, m[1] + ext)
      if (existsSync(cand)) {
        if (interpolates(stripComments(readFileSync(cand, 'utf8')))) return true
      }
    }
  }
  return false
}

describe('every route that writes prose can reach the guards (RV-173)', () => {
  const prose = routeFiles('app/api').filter(f => PROSE_CALL.test(stripComments(read(f))))

  it('finds the prose routes at all — a scan that matches nothing would pass silently', () => {
    // A floor, not a target: it exists so a scan that silently matches nothing cannot pass. It was
    // 7 until RV-200 deleted `running-plan/explain`, 6 until RV-201 did the same to
    // `ai/health-insight`, and 5 until RV-201's second half took `weekly-digest` — each one a
    // model rewording facts its own handler had already computed. Lower it when a prose route
    // genuinely goes; never raise it to paper over one that stopped matching.
    expect(prose.length).toBeGreaterThanOrEqual(4)
  })

  it.each(prose)('%s reaches PROSE_GUARDS or PROSE_FIELD_GUARDS', rel => {
    expect(reachesGuards(rel), `${rel} streams prose about the owner's data with no guards`).toBe(true)
  })
})
