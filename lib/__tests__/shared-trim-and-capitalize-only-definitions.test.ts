// Issue 2959. `trimLeadingGaps` and `capitalize` were moved into `packages/shared` (#2954), but a
// screen can quietly grow its own copy again — and two copies drift (one lowercases the rest, one
// throws on an empty string). This is a DISCOVERY scan over the tracked source, not a list of the
// copies that existed: a new inline first-letter capitaliser or leading-null trim fails here.
//
// A site that must stay is allow-listed below WITH its reason.
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'

const root = join(__dirname, '..', '..')
const SOURCE_DIRS = ['app', 'components', 'lib', 'hooks', 'mobile/src', 'packages/shared/src']

const sources = execSync(`git ls-files -- ${SOURCE_DIRS.join(' ')}`, { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(f => /\.(ts|tsx)$/.test(f) && !/(__tests__|\.test\.|\.spec\.)/.test(f))

const code = (f: string) => stripComments(readFileSync(join(root, f), 'utf8'))

/** `x.charAt(0).toUpperCase()`, `x[0].toUpperCase()` or `x.slice(0, 1).toUpperCase()`. */
const FIRST_LETTER_UPPER = /(?:\.charAt\(0\)|\[0\]|\.slice\(0,\s*1\))\.toUpperCase\(\)/
/** `rows.findIndex(r => r.v !== null)` / `!= null`: the leading-gap trim. */
const LEADING_NULL_TRIM = /\.findIndex\(.*?!==?\s*null\b/

const ALLOWED_CAPITALISERS: Record<string, string> = {
  'packages/shared/src/format/capitalize.ts': 'the shared helper itself',
  // Owner-area files the local Implementer is working in (More); move to `capitalize` once that lands.
  'app/more/more-content.tsx': 'More screen, owned by the in-flight Implementer batch',
  'components/more/friend-leaderboard.tsx': 'More screen, owned by the in-flight Implementer batch',
}

const ALLOWED_TRIMS: Record<string, string> = {
  'packages/shared/src/health/series-gaps.ts': 'the shared helper itself',
}

describe('the shared helpers are the only definitions (#2959)', () => {
  it('scans a plausible number of files', () => {
    expect(sources.length).toBeGreaterThan(500)
  })

  it('no inline first-letter capitaliser outside `format/capitalize.ts`', () => {
    const offenders = sources.filter(f => !(f in ALLOWED_CAPITALISERS) && FIRST_LETTER_UPPER.test(code(f)))
    expect(offenders, 'use `capitalize` from @trainingai/shared/format/capitalize').toEqual([])
  })

  it('no inline leading-null trim outside `health/series-gaps.ts`', () => {
    const offenders = sources.filter(f => !(f in ALLOWED_TRIMS) && LEADING_NULL_TRIM.test(code(f)))
    expect(offenders, 'use `trimLeadingGaps` from @trainingai/shared/health/series-gaps').toEqual([])
  })

  it('every allow-listed file still exists and still needs its entry', () => {
    for (const [f, re] of [
      ...Object.keys(ALLOWED_CAPITALISERS).map(f => [f, FIRST_LETTER_UPPER] as const),
      ...Object.keys(ALLOWED_TRIMS).map(f => [f, LEADING_NULL_TRIM] as const),
    ]) {
      expect(sources, `${f} is allow-listed but not tracked`).toContain(f)
      expect(re.test(code(f)), `${f} no longer has the pattern — drop its allow-list entry`).toBe(true)
    }
  })
})
