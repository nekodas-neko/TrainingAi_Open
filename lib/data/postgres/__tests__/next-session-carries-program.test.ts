// RV-82 — `getNextSession` hands back the program it already fetched, on EVERY path.
//
// Source-level, and deliberately so: `program` is optional on `NextSessionRecommendation`, so a
// return path that forgets it compiles cleanly and fails silently at runtime — the two routes that
// now read it would see `undefined`, fall back to null, and behave as though the user had no active
// program. That is precisely the shape TypeScript cannot see, which is what a scan is for.
//
// It is not hypothetical. The first cut of this change put `program` into the object spread into
// `computeAiDynamicNextSession`, and the scorer DESTRUCTURES named fields and rebuilds its own
// result — so the program was dropped on the ai_dynamic path, which is the live one for a program
// with `phaseMode === 'ai_dynamic'`. Caught by reading the scorer, not by the compiler.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const adapter = read('lib/data/postgres/adapter.ts')
const aiDynamic = read('packages/shared/src/ai-periodization/ai-dynamic.ts')

/** `getNextSession`'s body: from its signature to the next method at the same indent. */
function getNextSessionBody(): string {
  const start = adapter.indexOf('async getNextSession(userId: string, timezone = DEFAULT_TZ)')
  expect(start, 'getNextSession not found').toBeGreaterThan(-1)
  const rest = adapter.slice(start)
  const end = rest.search(/\n  (?:async |private )/)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('RV-82 — every recommendation carries the program', () => {
  const body = getNextSessionBody()

  it('puts the program on the object every direct return spreads', () => {
    // Order-independent on purpose: `reminders` and `program` share no keys, so which comes first
    // is style. A mutation run caught the first version of this assertion pinning the literal
    // string and failing on a reorder that changed nothing.
    const m = body.match(/const common = \{([^}]*)\}/)
    expect(m, '`common` is not built where this test expects it').not.toBeNull()
    expect(m![1]).toMatch(/\.\.\.reminders\b/)
    expect(m![1]).toMatch(/\bprogram\b/)
  })

  it('leaves the program off ONLY the no-active-program return', () => {
    // Each `return {` in the body either spreads `common` or names `program` — except the early
    // one for a user with no active program, where null is the honest answer.
    const returns = body.split('\n').filter(l => /return\s*\{/.test(l))
    expect(returns.length, 'expected several return paths to check').toBeGreaterThan(5)

    const bad = returns.filter(l =>
      !l.includes('...common') &&
      !l.includes('program') &&
      !l.includes('No active program configured') &&
      // The multi-line ai_dynamic return opens with a bare `return {`; its `program` is asserted
      // separately below, because it is not on this line.
      l.trim() !== 'return {')
    expect(bad, `a return path drops the program: ${bad.join(' | ')}`).toEqual([])
  })

  it('attaches the program to the ai_dynamic return, which is the scorer’s object not ours', () => {
    const i = body.indexOf('...result,')
    expect(i, 'the ai_dynamic spread-return was not found').toBeGreaterThan(-1)
    // Within the returned literal, before `signals:` — the scorer's own fields cannot supply it.
    const literal = body.slice(i, body.indexOf('signals: {', i))
    expect(literal, 'the ai_dynamic return does not attach `program`').toMatch(/\bprogram,/)
  })

  it('does NOT feed the program into the scorer, which would silently drop it', () => {
    // The bug this file exists for. `computeAiDynamicNextSession` is given the reminder pair only.
    const call = body.slice(body.indexOf('computeAiDynamicNextSession({'), body.indexOf('...result,'))
    expect(call).toMatch(/\.\.\.reminders,/)
    expect(call, 'spreading `common` here puts a program into a scoring input that drops it')
      .not.toMatch(/\.\.\.common,/)
  })

  it('the scorer really does rebuild its result from named fields', () => {
    // If this ever changes — if the scorer starts spreading its input — the explicit attach above
    // becomes redundant rather than load-bearing, and this test says so out loud.
    const fn = aiDynamic.slice(aiDynamic.indexOf('export function computeAiDynamicNextSession'))
    expect(fn.slice(0, 600)).toMatch(/const rem = \{ reminderEnabled, reminderTime \}/)
  })
})

describe('RV-82 — the routes read it instead of re-fetching', () => {
  const prescription = read('app/api/next-session/prescription/route.ts')
  const progress = read('app/api/progress-summary/route.ts')
  const nextSession = read('app/api/next-session/route.ts')

  it('neither route calls getActiveProgram any more', () => {
    for (const [name, src] of [['prescription', prescription], ['progress-summary', progress]] as const) {
      expect(src, `${name} still runs the 5-query composite a second time`)
        .not.toMatch(/repo\.getActiveProgram\(/)
      expect(src).toMatch(/\.program \?\? null/)
    }
  })

  it('/api/next-session strips the program before serialising', () => {
    // It returns the recommendation WHOLESALE, so an unstripped field would grow the home card's
    // most-fetched response by the entire program — every session, exercise and schedule row.
    expect(nextSession).toMatch(/const \{ program: _program, \.\.\.body \} = recommendation/)
    expect(nextSession, 'the wholesale response must not be the raw recommendation')
      .not.toMatch(/NextResponse\.json\(recommendation,/)
  })
})
