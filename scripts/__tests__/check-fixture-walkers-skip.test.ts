/**
 * #2560 — a test that walks the source tree must not walk into `__check_fixture__/`.
 *
 * `check-comment-blindness.test.ts` puts a COPY of a real source file in a gitignored
 * `__check_fixture__/` folder beside it (e.g. `components/workout/__check_fixture__/set-card.tsx`),
 * runs a check, and deletes the folder — three times per case, eleven cases, while every other
 * suite runs in parallel. A walker elsewhere that lists `components/` in that window sees the
 * folder, then finds it gone when it stats or reads it: `dv21-notification-channels-exist` failed
 * with ENOENT in a full run on 2026-10-07 and passed alone. A walker that does not crash can do
 * worse and read the copy, whose appended fixture line is the banned construct some other test
 * looks for.
 *
 * The folder cannot move somewhere walkers do not look, because the checks under test must find it
 * (it has to sit under the directory and filename filter each check scans), and the walkers look
 * everywhere those checks do. So every walker skips it by name, the way `__tests__` and
 * `node_modules` are already skipped, and this file keeps it that way: a test file that walks a
 * directory recursively has to name `__check_fixture__` in code.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../lib/strip-comments.js'

const root = path.join(__dirname, '..', '..')
const SKIP = new Set(['node_modules', '.next', '.git', '.claude', 'android', 'coverage', 'test-results', 'playwright-report'])

function testFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name === '__check_fixture__') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) testFiles(p, out)
    else if (/\.test\.[cm]?[jt]sx?$/.test(e.name)) out.push(p)
  }
  return out
}

/** A recursive walk: a directory listing plus either a descent into what it lists, or node's own. */
const walksRecursively = (code: string) =>
  /\breaddirSync\s*\(/.test(code) && (/\.isDirectory\s*\(\s*\)/.test(code) || /readdirSync\s*\([^)]*recursive\s*:\s*true/.test(code))

describe('source-tree walkers in tests skip __check_fixture__ (#2560)', () => {
  const walkers = testFiles(root)
    .map(abs => ({ rel: path.relative(root, abs).replace(/\\/g, '/'), code: stripComments(readFileSync(abs, 'utf8')) as string }))
    .filter(f => walksRecursively(f.code))

  it('finds the walkers, or it proves nothing', () => {
    // Twenty-odd on 2026-10-07, among them dv21's, which is the one that failed.
    expect(walkers.length).toBeGreaterThan(15)
    expect(walkers.map(w => w.rel)).toContain('components/__tests__/dv21-notification-channels-exist.test.ts')
  })

  it('every one of them names __check_fixture__ in code', () => {
    const offenders = walkers.filter(w => !w.code.includes('__check_fixture__')).map(w => w.rel)
    expect(offenders, 'skip `__check_fixture__` alongside `node_modules`/`__tests__` in this walker').toEqual([])
  })
})
