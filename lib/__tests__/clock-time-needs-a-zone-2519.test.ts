// #2519 — `msToHHMMInTz(at)` with no zone falls back to Brisbane for everyone, so a user outside
// Brisbane was stored with Brisbane clock times (activity logs and guided walks). That value is
// wrong in the database forever, unlike a rendering bug. #2438 fixed the Health Connect sync; this
// pins the pattern across the tree so a one-argument call cannot come back unnoticed.
//
// The default in `msToHHMMInTz` itself stays (a Brisbane-only caller is legitimate in a test), so the
// guard is on the CALL SITES: every call in app code names its zone.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'

const root = join(__dirname, '..', '..')
const SKIP_DIR = new Set(['node_modules', '.next', '__tests__', 'e2e', 'test-results', '.git', 'docs', 'android', 'coverage'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** `msToHHMMInTz(` + exactly one argument + `)`. Nested parentheses inside the argument count as one. */
function singleArgCalls(src: string): string[] {
  const hits: string[] = []
  for (const m of src.matchAll(/msToHHMMInTz\(/g)) {
    let depth = 1, i = m.index! + m[0].length, commas = 0
    for (; i < src.length && depth > 0; i++) {
      const c = src[i]
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') depth--
      else if (c === ',' && depth === 1) commas++
    }
    if (commas === 0) hits.push(src.slice(m.index!, i))
  }
  return hits
}

describe('every msToHHMMInTz call names the user\'s zone (#2519)', () => {
  it('finds the call sites at all, so an empty scan cannot pass', () => {
    const named = walk(root).filter(f => stripComments(readFileSync(f, 'utf8')).includes('msToHHMMInTz('))
    expect(named.length).toBeGreaterThanOrEqual(3)
  })

  it('has no call with a single argument', () => {
    const offenders: string[] = []
    for (const f of walk(root)) {
      // The definition's own file declares the default; it is not a call site.
      if (f.endsWith(join('packages', 'shared', 'src', 'date-utils.ts'))) continue
      for (const hit of singleArgCalls(stripComments(readFileSync(f, 'utf8')))) offenders.push(`${relative(root, f)}: ${hit}`)
    }
    expect(offenders, `these fall back to Brisbane's clock for every user:\n${offenders.join('\n')}`).toEqual([])
  })

  it('the scan itself recognises a one-argument call and passes a two-argument one', () => {
    expect(singleArgCalls('const a = msToHHMMInTz(startMs)')).toHaveLength(1)
    expect(singleArgCalls('const a = msToHHMMInTz(startedAtMs + actualSec * 1000)')).toHaveLength(1)
    expect(singleArgCalls('const a = msToHHMMInTz(fn(x, y))')).toHaveLength(1)
    expect(singleArgCalls('const a = msToHHMMInTz(startMs, tz)')).toHaveLength(0)
    expect(singleArgCalls('const a = msToHHMMInTz(new Date(x), tz)')).toHaveLength(0)
  })
})

describe('the HR day chart cuts its day at the USER\'s midnight (#2519)', () => {
  const chart = stripComments(readFileSync(join(root, 'components', 'health', 'hr-day-chart.tsx'), 'utf8'))

  it('takes the midnight from the user\'s zone, not `new Date(y, m - 1, d)`', () => {
    expect(chart).toMatch(/const midnightMs = dateStrMidnightInTz\(date, tz\)\.getTime\(\)/)
    expect(chart).not.toMatch(/new Date\(y, m - 1, d/)
    expect(chart).toMatch(/const tz = useUserTimezone\(\)/)
  })
})
