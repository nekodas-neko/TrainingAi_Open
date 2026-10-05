import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

/**
 * BF-67 step 3 — the engine half had no caller.
 *
 * `/api/generate-program` has accepted `referenceProgramId` since 2026-08-31, resolving it
 * server-side against `listPrograms(userId)`; the entry's own `Keep:` records that **nothing
 * reached the owner until this ships — the parameter has no caller.** These pin the wiring that
 * makes it reachable, and the two rules the route sets.
 */

const ROOT = path.resolve(__dirname, '../../..')
const read = (f: string) => stripComments(readFileSync(path.join(ROOT, f), 'utf8'))
const WIZARD = read('components/workout-builder/builder-wizard.tsx')
const PICKER = read('components/workout-builder/reference-program-picker.tsx')
const ROUTE = read('app/api/generate-program/route.ts')

describe('BF-67 — the reference reaches the generator', () => {
  it('⭐ the wizard sends `referenceProgramId`, which nothing did before', () => {
    expect(WIZARD, 'the POST does not carry the reference').toMatch(/referenceProgramId[\s\S]{0,60}\.\.\.inputs|\.\.\.inputs[\s\S]{0,60}referenceProgramId/)
  })

  it('⛔ and omits it rather than sending null, because the schema is `.strict()` + `.optional()`', () => {
    // `z.string().uuid().optional()` rejects an explicit `null`, and `.strict()` means a rejected
    // body is a 400 for the whole generation — so "no reference" has to mean "no key".
    expect(ROUTE).toMatch(/referenceProgramId:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/)
    expect(ROUTE).toMatch(/\}\)\.strict\(\)/)
    expect(WIZARD, 'a null reference is sent as a key')
      .toMatch(/referenceProgramId\s*\?\s*\{\s*\.\.\.inputs,\s*referenceProgramId\s*\}\s*:\s*inputs/)
  })

  it('⛔ an ID crosses the boundary, never a program object', () => {
    // The route's own rule: accepting the structure from the client would be an ownership hole and
    // a prompt-injection surface for nothing the id does not already give.
    expect(PICKER).toMatch(/onSelect:\s*\(id:\s*string\s*\|\s*null\)\s*=>\s*void/)
    expect(PICKER, 'the picker hands up a program object')
      .not.toMatch(/onSelect\((?!\s*(null|p\.id|id)\s*\))/)
    expect(WIZARD).not.toMatch(/referenceProgram\s*[:=]\s*\{/)
  })

  it('reads the program list through the key and TTL config-screen already uses', () => {
    // One canonical TTL per key and one fetch variant per key. A second spelling of either is how
    // freshness becomes last-writer-wins.
    expect(WIZARD).toMatch(/useCachedValue<\{\s*programs:\s*Program\[\]\s*\}>\(/)
    expect(WIZARD).toMatch(/'workout-templates',\s*'\/api\/workout-templates',\s*TTL_LONG/)
    const config = read('components/config-screen.tsx')
    expect(config).toMatch(/'workout-templates',\s*'\/api\/workout-templates',\s*TTL_LONG/)
    // Not `cachedFetchToday` at either site — `useCachedValue` without `today` is `cachedFetch`.
    expect(WIZARD).not.toMatch(/today:\s*true/)
  })

  it('⛔ not a fetch-once effect, which would never see a program made behind the sheet', () => {
    // The Q-402 shape: `useEffect(() => { cachedFetch(…) }, [])` never re-runs, so a program
    // created in the config screen under this sheet would never join the list.
    expect(WIZARD).not.toMatch(/useEffect\(\s*\(\)\s*=>\s*\{[\s\S]{0,200}cachedFetch/)
  })

  it('the picker self-hides with nothing to reference, and defaults to no reference', () => {
    // A first program has nothing to base itself on, and an empty picker explaining itself is
    // furniture. Defaulting to none is what makes this safe on an existing step.
    expect(PICKER).toMatch(/programs\.length === 0\)\s*return null/)
    expect(WIZARD).toMatch(/useState<string \| null>\(null\)/)
  })

  it('the empty fallback is module-level, so it cannot defeat the memo', () => {
    // A `[]` literal at the call site is a new array every render — the exact shape
    // `check-memo-prop-stability` exists for, and it would not flag a fallback inside `??`.
    expect(WIZARD).toMatch(/const EMPTY_PROGRAMS: Program\[\] = \[\]/)
    expect(WIZARD).toMatch(/programs=\{templates\?\.programs \?\? EMPTY_PROGRAMS\}/)
  })
})
