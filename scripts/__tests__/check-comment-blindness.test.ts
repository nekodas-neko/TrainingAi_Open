/**
 * LA-72 — a source-scanning rule that reads its own explanatory comments is checking the wrong file.
 *
 * LA-64 gave the eight checks that already tried to strip comments one shared implementation; this
 * is the pass that decided which of the rest needed it. **The decision is measured, not judged.**
 * For each check: run it clean, run it with the banned construct as real CODE (the positive
 * control), then with the same construct inside a COMMENT.
 *
 *   · control identical to clean  → the fixture never reaches that check, so the case proves nothing
 *     and must be fixed rather than recorded as a pass. This trap produced two false "strips"
 *     readings while the harness was being written: a fixture in a file the check does not scan
 *     looks exactly like a check that strips comments.
 *   · comment identical to clean  → the check strips. What every case below asserts.
 *
 * What made this worth doing rather than trusting the conversion: `check-hex-literals` had **eight
 * baseline rows for files whose only "hex literal" was a PR number in a comment** — `(#919)`,
 * `#185`. Each of those files carried an allowance for a colour it does not contain, so a real hex
 * could have been added to any of them and the check would have reported clean. That is the silent
 * direction, found by measurement.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.join(__dirname, '..', '..')

/**
 * The API-route paths are joined rather than written whole, and that is not style.
 * `check-route-test-coverage` counts a route covered when a test file contains the literal
 * `app/api/<route>/route` — so spelling it out here would make this file, which never calls the
 * goals handler, register as that route's test and let the ratchet's baseline fall by one. That is
 * the same "a mention counts as a test" defect the ratchet exists to measure, and it appeared in
 * the very PR that added a scanner for it.
 */
const apiRoute = (dir: string) => path.join(dir, 'route.ts')

/** Each check, a file it actually scans, and a construct it is meant to catch. */
const CASES: Array<{ check: string; file: string; fixture: string }> = [
  { check: 'check-icon-button-names', file: 'components/workout/set-card.tsx', fixture: '<button onClick={x}><Icon /></button>' },
  { check: 'check-hex-literals', file: 'components/workout/set-card.tsx', fixture: 'style={{ color: "#ff0000" }}' },
  { check: 'check-timezone-rendering', file: 'components/workout/set-card.tsx', fixture: 'const s = d.toLocaleDateString("en-AU", { day: "numeric" })' },
  { check: 'check-fetch-once-effects', file: 'components/workout/set-card.tsx', fixture: 'useEffect(() => { cachedFetch("k", "/api/x", 60) }, [])' },
  { check: 'check-memo-prop-stability', file: 'components/workout/set-card.tsx', fixture: 'const X = memo(Y); <X style={{a:1}} />' },
  { check: 'check-sparkline-primitive', file: 'components/workout/set-card.tsx', fixture: '<svg><polyline points="1,2 3,4" /></svg>' },
  { check: 'check-tz-aware-cache-guards', file: 'components/workout/set-card.tsx', fixture: 'if (isWorkoutDataToday(x)) return' },
  { check: 'check-client-today-timezone', file: 'components/workout/set-card.tsx', fixture: 'const t = todayInTz()' },
  { check: 'check-date-param-regex', file: apiRoute('app/api/user/goals'), fixture: 'date: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/)' },
  { check: 'check-api-no-store', file: apiRoute('app/api/user/goals'), fixture: "headers: { 'Cache-Control': 'private, max-age=60' }" },
  { check: 'check-strict-request-schemas', file: apiRoute('app/api/user/goals'), fixture: 'const S = z.object({ a: z.string() })' },
]

/** The check's whole output, exit code included — a check may signal by either. */
const run = (check: string): string => {
  try {
    return execFileSync('node', [path.join(root, 'scripts', `${check}.js`)], { cwd: root, encoding: 'utf8' })
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number }
    return `exit=${e.status}\n${e.stdout ?? ''}${e.stderr ?? ''}`
  }
}

/**
 * Appends to a REAL source file and restores it in `finally`. The two files used here are read from
 * disk by no other spec (checked), and each mutation window is a couple of seconds — but it is a
 * shared-tree mutation, so a new case must pick a file nothing else scans during a parallel run.
 */
const withAppended = (rel: string, line: string, fn: () => string): string => {
  const abs = path.join(root, rel)
  const original = readFileSync(abs, 'utf8')
  try {
    writeFileSync(abs, `${original}\n${line}\n`)
    return fn()
  } finally {
    writeFileSync(abs, original)
  }
}

describe.each(CASES)('$check ignores its banned pattern inside a comment', ({ check, file, fixture }) => {
  // Three full scans of app/ + components/ per case; `check-hex-literals` alone needs ~6s.
  it('is not fooled by a comment, and the fixture genuinely reaches it', () => {
    const clean = run(check)
    const asCode = withAppended(file, fixture, () => run(check))
    const asComment = withAppended(file, `// ${fixture}`, () => run(check))

    // Positive control. Without it, "the comment changed nothing" is indistinguishable from
    // "this check never looked at that file", which is the reading that makes the whole pass wrong.
    expect(asCode, `fixture for ${check} must trigger it in ${file}`).not.toEqual(clean)
    expect(asComment, `${check} counts its banned pattern inside a comment`).toEqual(clean)
  }, 30_000)
})
