// Q-292: the AI told the owner he had "a perfect activity score" on a day the stored score was 80,
// and "a perfect recovery index" on a day that contributor scored 21 of 100 — then advised keeping
// the bedroom at "65 degrees Fahrenheit" to a user whose app is metric throughout. Across all 117
// audited insights: 12 absolute superlatives and 7 Fahrenheit errors, ~16% carrying at least one.
//
// PS-32: the file claimed to be "imported by every prose-generating AI route" and reached 5 of 10.
// The reason the other five were skipped is real and is why they do not simply carry the full set:
// four of them exist to PRODUCE numbers (calorie and macro targets, sets/reps/%1RM), so the
// "quote, never recompute" rule contradicts their job. They carry PROSE_FIELD_GUARDS — the units
// and superlative rules, which apply to any text a model writes for this user.
//
// The guard is prompt text, so what is testable is that it reaches every route that writes prose
// and says the things it has to. An eleventh route added without either constant is what this
// catches.
//
// RV-173 / RV-179: the two lists of routes that used to sit here were written by hand, and a list
// cannot notice a route nobody adds to it (Coach was missing from it for as long as Coach existed).
// Both are DISCOVERED now, from the model call each route makes: a route that streams or generates
// text must carry PROSE_GUARDS; a route that returns an object against a schema must carry
// PROSE_FIELD_GUARDS or be named in KNOWN_UNGUARDED below, which can only shrink.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PROSE_GUARDS, PROSE_FIELD_GUARDS, METRIC_UNITS_RULE, NO_SUPERLATIVE_RULE, NO_DIAGNOSIS_RULE, QUOTE_NUMBERS_RULE } from '../prompt-guards'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const root = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const PROSE_CALL = /\b(loggedStreamText|streamText|loggedGenerateText|generateText)\s*\(/
// `generateObject` is not a prose generator: it returns data against a schema, and its text fields
// are the user-facing part. Those routes carry PROSE_FIELD_GUARDS (units and superlatives, no
// "quote, never recompute", because several of them exist to produce numbers).
const OBJECT_CALL = /\b(loggedGenerateObject|generateObject|streamObject)\s*\(/

/**
 * #3803: model calls made OUTSIDE a route file. The workout prescription
 * (`packages/shared/src/ai-periodization/generate-prescription.ts`) and the meal top-up
 * (`lib/nutrition/meal-top-up.ts`) call the model from a module the route imports, so a scan of
 * `route.ts` alone never saw them — and the prescription's `reasoning` is shown in Preview. Found
 * through their import of the logged chokepoint, `@/lib/ai/instrument`, which every model call
 * must go through; `lib/ai/` itself is the chokepoint, not a caller.
 */
function modelModules(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) {
      if (!['__tests__', '__check_fixture__', 'node_modules'].includes(e.name) && rel !== 'lib/ai') out.push(...modelModules(rel))
    } else if (/\.tsx?$/.test(e.name) && !(rel.startsWith('app/api/') && e.name === 'route.ts')) {
      const src = stripComments(read(rel))
      if (/from '@\/lib\/ai\/instrument'/.test(src) && (PROSE_CALL.test(src) || OBJECT_CALL.test(src))) out.push(rel)
    }
  }
  return out
}

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== '__check_fixture__') out.push(...routeFiles(rel)) }
    else if (e.name === 'route.ts') out.push(rel)
  }
  return out
}

/** The INTERPOLATION, not the identifier: an import that is never spliced into a prompt is a
 *  route with no guards and a tidy import list. Matching the bare name let that pass. */
const interpolates = (src: string, constant: string) => src.includes('${' + constant + '}')

/**
 * The file that splices `constant` into the route's prompt: the route itself, or a sibling it
 * imports (health-insight built its prompt in ./prompt). `null` when there is none.
 */
function interpolatingFile(rel: string, constant: string): string | null {
  const src = stripComments(read(rel))
  if (interpolates(src, constant)) return rel
  const dir = rel.slice(0, rel.lastIndexOf('/'))
  // A relative sibling, or (#3803) a module reached through an alias: the prescription builds its
  // prompt in `@trainingai/shared/ai-periodization/prompt`. The guard module itself is not a prompt.
  for (const m of src.matchAll(/from\s+'(\.[^']+|@\/[^']+|@trainingai\/shared\/[^']+)'/g)) {
    const base = m[1].startsWith('@/') ? m[1].slice(2)
      : m[1].startsWith('@trainingai/shared/') ? `packages/shared/src/${m[1].slice('@trainingai/shared/'.length)}`
      : join(dir, m[1]).split('\\').join('/')
    if (base === 'lib/ai/prompt-guards') continue
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const cand = join(root, base + ext)
      if (existsSync(cand) && interpolates(stripComments(readFileSync(cand, 'utf8')), constant)) {
        return `${base}${ext}`
      }
    }
  }
  return null
}

const allRoutes = routeFiles('app/api')
const outsideRoutes = ['app', 'lib', 'packages', 'components'].flatMap(modelModules)
// Every file that calls the model: the routes, and the modules above. The lists below cover both.
const allCallers = [...allRoutes, ...outsideRoutes]
const calls = (rel: string, re: RegExp) => re.test(stripComments(read(rel)))
// Routes that stream or generate TEXT, and routes that return an OBJECT (and no text).
const proseRoutes = allCallers.filter(f => calls(f, PROSE_CALL))
const objectRoutes = allCallers.filter(f => calls(f, OBJECT_CALL) && !calls(f, PROSE_CALL))

// Object routes that are exempt from PROSE_FIELD_GUARDS because they return no prose of their own.
// Empty since the four routes found by this discovery (exercise generator, meal, meal plan, scan)
// took the guard. A route belongs here only with the reason beside it: a NEW object route with
// user-facing text fields fails outright rather than being waved through.
const KNOWN_UNGUARDED = new Set<string>([
  // Returns ingredient names, gram weights and per-100g values for code to scale — no sentence of
  // its own, and grams are already the only unit it is asked for. Its prompt is not this file's to
  // reword (#3803 added the guard to the prescription only).
  'lib/nutrition/meal-top-up.ts',
])

const guardedObjectRoutes = objectRoutes.filter(f => !KNOWN_UNGUARDED.has(f))

describe('the prose guards reach every route that writes prose (Q-292, PS-32, RV-173)', () => {
  it('finds the routes at all — a scan that matches nothing would pass silently', () => {
    // Floors, not targets: they exist so a scan that silently matches nothing cannot pass. The prose
    // floor was 7 until RV-200 deleted `running-plan/explain`, 6 until RV-201 did the same to
    // `ai/health-insight`, and 5 until RV-201's second half took `weekly-digest`, and 4 until #3286 did the same to
    // `daily-digest` and `session-explain/insight`, and 2 until #3748 did the same to the workout
    // recap — each one a model rewording facts its own handler had already computed. Lower one when
    // a route genuinely goes; never raise it to paper over a route that stopped matching.
    expect(proseRoutes.length).toBeGreaterThanOrEqual(1)
    // 6 until #3803 counted the two model callers outside a route file.
    expect(objectRoutes.length).toBeGreaterThanOrEqual(8)
    // #3803: the prescription and the meal top-up. A scan outside `app/api` that finds nothing
    // would pass silently, which is how the prescription went unguarded.
    expect(outsideRoutes.length).toBeGreaterThanOrEqual(2)
  })

  it.each(proseRoutes)('%s streams or generates text and interpolates PROSE_GUARDS', rel => {
    expect(interpolatingFile(rel, 'PROSE_GUARDS'), `${rel} writes prose about the owner's data with no guards`).not.toBeNull()
  })

  it.each(guardedObjectRoutes)('%s returns an object and interpolates PROSE_FIELD_GUARDS', rel => {
    expect(
      interpolatingFile(rel, 'PROSE_FIELD_GUARDS'),
      `${rel} returns user-facing text fields with no guards — add \${PROSE_FIELD_GUARDS} to its prompt, or (if it truly has no prose) name it in KNOWN_UNGUARDED with the reason`,
    ).not.toBeNull()
  })

  it('KNOWN_UNGUARDED is shrink-only: each entry is still an object route and still unguarded', () => {
    for (const rel of KNOWN_UNGUARDED) {
      expect(objectRoutes, `${rel} no longer returns an object — delete its row`).toContain(rel)
      expect(interpolatingFile(rel, 'PROSE_FIELD_GUARDS'), `${rel} now has the guard — delete its row`).toBeNull()
    }
  })

  it('is one shared string, not a per-route copy', () => {
    // The wording drifting into ten versions is how the sleep route ends up without the units
    // clause again. Nothing outside prompt-guards.ts may declare its own.
    const pairs: Array<[string, string]> = [
      ...proseRoutes.map((r): [string, string] => [r, 'PROSE_GUARDS']),
      ...guardedObjectRoutes.map((r): [string, string] => [r, 'PROSE_FIELD_GUARDS']),
    ]
    for (const [rel, constant] of pairs) {
      const file = interpolatingFile(rel, constant)!
      expect(read(file), file).toMatch(/from '@\/lib\/ai\/prompt-guards'/)
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

// #2421. The 2026-07-19 insight that inferred illness from skin temperature is the class the units
// and superlative rules do not touch. Because every route reaches one of the two constants, the
// rule reaching both is what makes it reach every route — the lists above pin that.
describe('the guards forbid quasi-medical inference (#2421)', () => {
  it('names the conditions the model must not reach for', () => {
    expect(NO_DIAGNOSIS_RULE).toMatch(/never diagnose/)
    for (const word of ['medical condition', 'illness', 'infection', 'sick']) {
      expect(NO_DIAGNOSIS_RULE).toContain(word)
    }
  })

  it('names the signals it was observed on, so it is not read as only about temperature', () => {
    for (const signal of ['temperature', 'resting heart rate', 'HRV']) {
      expect(NO_DIAGNOSIS_RULE).toContain(signal)
    }
  })

  it('still lets the model say how far a reading is from the usual', () => {
    // A rule that forbade describing the deviation would blank every insight about a body signal.
    expect(NO_DIAGNOSIS_RULE).toMatch(/above or below the usual/)
  })

  it('is spliced into the prompt of every route that carries a guard set', () => {
    for (const path of [...proseRoutes, ...guardedObjectRoutes]) {
      expect(
        interpolatingFile(path, 'PROSE_GUARDS') ?? interpolatingFile(path, 'PROSE_FIELD_GUARDS'),
        path,
      ).not.toBeNull()
    }
  })
})

describe('the two guard sets differ only where they have to', () => {
  it('both carry the units, superlative and no-diagnosis rules', () => {
    for (const guards of [PROSE_GUARDS, PROSE_FIELD_GUARDS]) {
      expect(guards).toContain(METRIC_UNITS_RULE)
      expect(guards).toContain(NO_SUPERLATIVE_RULE)
      expect(guards).toContain(NO_DIAGNOSIS_RULE)
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
