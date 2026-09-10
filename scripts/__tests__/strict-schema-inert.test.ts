import { execFileSync } from 'child_process'
import path from 'path'
import { describe, expect, it } from 'vitest'

/**
 * LA-88 — the third state: a `.strict()` schema that has nothing to act on.
 *
 * The checker asks whether a schema carries `.strict()`. It cannot see whether the strictness has
 * anything to REJECT — a route handing its schema an object it built key-by-key has already
 * discarded every unknown key. `admin/ai-usage` answers 200 to `?unknown=1` and the file reports
 * clean, which is the failure this note exists to stop: a clean run read as full coverage.
 *
 * The discriminator is structural, which is what makes it detectable at all: a spread means real
 * request keys reach the schema.
 */
const repoRoot = path.resolve(__dirname, '..', '..')
const run = () =>
  execFileSync('node', [path.join(repoRoot, 'scripts', 'check-strict-request-schemas.js')], {
    cwd: repoRoot, encoding: 'utf8',
  })

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { countInertStrict } = require('../lib/inert-strict')

/**
 * Fixtures, because the real files cannot isolate the two rules.
 *
 * The whole-script test below chose `running-plan/runs/[id]` as its witness for "a spread is
 * excluded" — and that file is excluded TWICE: it has a spread AND its schema is imported, so the
 * file carries no `.strict()`. Dropping either rule left the test green. One rule per fixture is
 * the only way to know which guard is doing the work.
 */
describe('countInertStrict (LA-88) — one rule per fixture', () => {
  const strict = 'const S = z.object({ a: z.string() }).strict()\n'

  it('counts an all-literal object — the strictness has nothing to reject', () => {
    expect(countInertStrict(strict + 'S.safeParse({ a: p.get("a") })')).toBe(1)
  })

  it('does NOT count a spread — real request keys reach the schema', () => {
    expect(countInertStrict(strict + 'S.safeParse({ ...body, id })')).toBe(0)
  })

  it('does not count a spread nested anywhere in the literal', () => {
    expect(countInertStrict(strict + 'S.safeParse({ id, ...rest })')).toBe(0)
  })

  it('returns 0 when the file has no `.strict()` at all — nothing to report inert', () => {
    // Without this guard every non-strict route would be listed, which is the OTHER check's job.
    expect(countInertStrict('S.safeParse({ a: 1 })')).toBe(0)
  })

  it('ignores a safeParse handed a variable rather than a literal', () => {
    expect(countInertStrict(strict + 'S.safeParse(body)')).toBe(0)
  })

  it('counts each inert site separately in one file', () => {
    expect(countInertStrict(strict + 'S.safeParse({ a: 1 })\nS.safeParse({ b: 2 })')).toBe(2)
  })

  it('matches braces rather than stopping at the first `}`', () => {
    expect(countInertStrict(strict + 'S.safeParse({ a: { nested: 1 } })')).toBe(1)
    expect(countInertStrict(strict + 'S.safeParse({ a: { ...inner } })')).toBe(0)
    // THE case that pins the brace matching, and the one the first three fixtures missed: a nested
    // object BEFORE the spread. Truncating at the first `}` yields `{ a: { nested: 1 }`, which has
    // no `...` — so a site whose strictness genuinely fires gets reported inert. Caught by mutation
    // (M5 survived until this line existed), not by review.
    expect(countInertStrict(strict + 'S.safeParse({ a: { nested: 1 }, ...rest })')).toBe(0)
  })
})

describe('check-strict-request-schemas inert note (LA-88)', () => {
  const out = run()

  it('reports the note on a PASSING run — a pass is not full coverage', () => {
    expect(out).toContain('check-strict-request-schemas: OK')
    expect(out).toContain('the strictness cannot fire')
  })

  it('names the five routes that build their own object', () => {
    for (const f of [
      'app/api/admin/ai-usage/route.ts',
      'app/api/admin/app-load-report/route.ts',
      'app/api/coach/options/route.ts',
      'app/api/exercise-gif/route.ts',
      'app/api/nutrition/barcode/route.ts',
    ]) {
      expect(out, `${f} should be reported inert`).toContain(f)
    }
  })

  it('does NOT name the route whose spread makes strictness real', () => {
    // `PrescribedRunPatchBody.safeParse({ ...body, id })` — real request keys reach the schema, so
    // an unknown one IS rejected. Counting it would make the note noise.
    expect(out).not.toContain('app/api/running-plan/runs/[id]/route.ts')
  })

  it('is a note, not a failure — these are five routes, not five bugs', () => {
    // For a GET whose only input is one named param, dropping the rest is arguably right and
    // 400-ing on a cache-buster would be worse. The cost is the REPORT, not the routes.
    expect(() => run()).not.toThrow()
  })
})
