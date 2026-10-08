/**
 * #2578 — a check skips `__check_fixture__/` unless SCAN_CHECK_FIXTURES=1.
 *
 * `check-comment-blindness.test.ts` parks a copy of a real file, with a violation appended, in
 * `__check_fixture__/` while it runs. Another suite running the REAL check against the working tree
 * in parallel (`strict-schema-inert`) used to see that copy and fail on it, or hit ENOENT when it was
 * removed mid-walk. The checks now leave fixtures alone by default; only comment-blindness opts in,
 * and only for its own child processes. A user's `pnpm check:rules` and CI never set the variable.
 *
 * This file uses its OWN parent folders (not goals/ or components/workout/, which comment-blindness
 * uses) so the two suites cannot remove each other's copy.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const root = path.join(__dirname, '..', '..')
const FIXTURE_DIR = '__check_fixture__'

// The checks `check-comment-blindness.test.ts` exercises.
const CHECKS = [
  'check-icon-button-names', 'check-hex-literals', 'check-timezone-rendering', 'check-fetch-once-effects',
  'check-memo-prop-stability', 'check-sparkline-primitive', 'check-tz-aware-cache-guards',
  'check-client-today-timezone', 'check-date-param-regex', 'check-api-no-store',
  'check-strict-request-schemas', 'check-llm-json-parse',
]

const exitOf = (check: string, env: Record<string, string>): number => {
  try {
    execFileSync('node', [path.join(root, 'scripts', `${check}.js`)], {
      cwd: root, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, SCAN_CHECK_FIXTURES: '', ...env },
    })
    return 0
  } catch (err) {
    return (err as { status?: number }).status ?? -1
  }
}

const withFixture = <T>(rel: string, line: string, fn: () => T): T => {
  const dir = path.join(root, path.dirname(rel), FIXTURE_DIR)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, path.basename(rel)), `${readFileSync(path.join(root, rel), 'utf8')}\n${line}\n`)
    return fn()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('a fixture copy is invisible to a real check run (#2578)', () => {
  it('check-strict-request-schemas: exit 0 beside a violating copy, non-zero when asked to scan fixtures', () => {
    const line = 'const S = z.object({ a: z.string() })'
    withFixture('app/api/achievements/route.ts', line, () => {
      // The overlap `strict-schema-inert` used to lose, made deterministic: the copy exists for the whole run.
      expect(exitOf('check-strict-request-schemas', {})).toBe(0)
      expect(exitOf('check-strict-request-schemas', { SCAN_CHECK_FIXTURES: '1' })).not.toBe(0)
    })
  }, 60_000)

  it('check-hex-literals: exit 0 beside a violating copy, non-zero when asked to scan fixtures', () => {
    withFixture('components/home/collection-card.tsx', 'const c = { color: "#ff0000" }', () => {
      expect(exitOf('check-hex-literals', {})).toBe(0)
      expect(exitOf('check-hex-literals', { SCAN_CHECK_FIXTURES: '1' })).not.toBe(0)
    })
  }, 60_000)

  it('every check comment-blindness exercises takes the skip from the one shared helper', () => {
    const offenders = CHECKS.filter((c) => {
      const src = readFileSync(path.join(root, 'scripts', `${c}.js`), 'utf8')
      return !src.includes("require('./lib/fixture-dirs')") || !src.includes('isSkippedFixtureDir(')
    })
    expect(offenders).toEqual([])
    // ...and none re-implements it.
    const copies = CHECKS.filter((c) => readFileSync(path.join(root, 'scripts', `${c}.js`), 'utf8').includes(FIXTURE_DIR))
    expect(copies).toEqual([])
  })

  it('check-route-test-coverage: a parked copy of a route is not counted as an untested route (issue 2697)', () => {
    withFixture('app/api/achievements/route.ts', '// copy', () => {
      expect(exitOf('check-route-test-coverage', {})).toBe(0)
      expect(exitOf('check-route-test-coverage', { SCAN_CHECK_FIXTURES: '1' })).not.toBe(0)
    })
  }, 60_000)

  // Issue 2697: the list above is the twelve checks comment-blindness exercises. This test finds the
  // walkers itself, so a check added later cannot miss the skip. A walker is any check-*.js that reads a
  // directory with `withFileTypes` (it needs the entry type to recurse); a flat `readdirSync(dir)` over
  // one fixed folder cannot reach a nested fixture directory.
  it('every check-*.js that walks the tree skips fixture directories through the shared helper', () => {
    const dir = path.join(root, 'scripts')
    const read = (f: string) => readFileSync(path.join(dir, f), 'utf8')
    const checks = readdirSync(dir).filter((f) => /^check-.*\.js$/.test(f))
    const walkers = checks.filter((f) => /withFileTypes/.test(read(f)))
    // A discovery that finds nothing would pass vacuously.
    expect(walkers.length).toBeGreaterThan(30)
    const offenders = walkers.filter((f) => !read(f).includes("require('./lib/fixture-dirs')"))
    expect(offenders).toEqual([])
    // Every directory read is followed by a call: at least as many calls as reads.
    const short = walkers.filter((f) => {
      const reads = (read(f).match(/withFileTypes/g) ?? []).length
      return (read(f).match(/isSkippedFixtureDir\(/g) ?? []).length < reads
    })
    expect(short).toEqual([])
    // ...and none re-implements the skip.
    expect(walkers.filter((f) => read(f).includes(FIXTURE_DIR))).toEqual([])
  })

  it('comment-blindness sets the variable for its child processes, and only there', () => {
    const src = readFileSync(path.join(root, 'scripts', '__tests__', 'check-comment-blindness.test.ts'), 'utf8')
    expect(src).toContain("SCAN_CHECK_FIXTURES: '1'")
    expect(src).not.toMatch(/process\.env\.SCAN_CHECK_FIXTURES\s*=/)
    expect(process.env.SCAN_CHECK_FIXTURES).not.toBe('1')
  })
})
