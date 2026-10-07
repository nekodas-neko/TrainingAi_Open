import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments } from '../../../scripts/lib/strip-comments.js'
import { formatHoursMinutes, formatMinutes } from '@trainingai/shared/format/units'

/**
 * RV-208 — one duration form, and one place that decides it.
 *
 * `packages/shared/src/format/units.ts` already owns this: RV-90 consolidated five hand-rolled
 * variants onto `formatHoursMinutes` after the same sleep total read differently on adjacent
 * cards. The sweep found **four more copies** — `55m` where every other surface says `55 min`,
 * and two `fmtHours`/`fmt` helpers taking HOURS, which is why they were written rather than
 * imported.
 *
 * **One of the four was a defect, not a difference.** `home-day-timeline`'s copy floored to the
 * hour and dropped the remainder, so a 45-minute nap rendered `0h`. The shared formatter returns
 * `45m` there. That is the argument for this guard over a style note: a second implementation is
 * a place for a bug to live alone.
 */
const ROOTS = ['components', 'app']
const repoRoot = join(__dirname, '..', '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '__tests__' || name === '__check_fixture__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/**
 * Relative age is not a duration. `formatSyncAge` renders "3m ago" / "2h ago" — the elapsed-time
 * idiom, where the abbreviated unit is the convention and "3 min ago" reads wrong. Consolidating
 * it onto a duration formatter would be this sweep overreaching, so it is named here with the
 * reason rather than quietly matched.
 */
const EXEMPT = new Set(['components/more/oura-section.tsx'])

const sources = ROOTS
  .flatMap(d => walk(join(repoRoot, d)))
  .map(f => ({ file: f.slice(repoRoot.length + 1).replace(/\\/g, '/'), code: stripComments(readFileSync(f, 'utf8')) as string }))

describe('RV-208 — durations', () => {
  it('has sources to scan, or it is checking nothing', () => {
    expect(sources.length).toBeGreaterThan(200)
  })

  /**
   * Deliberately narrow: it matches an interpolated name that SAYS it is minutes. A bare `${v}m`
   * is usually metres — the elevation and pace chart axes are full of them — and failing those
   * would make this guard something people delete rather than obey.
   */
  it('renders no hand-rolled minute duration', () => {
    const hits = sources.filter(s => !EXEMPT.has(s.file)).flatMap(({ file, code }) =>
      [...code.matchAll(/\$\{[A-Za-z_.?[\]]*[Mm]in(?:utes)?[A-Za-z_.?[\]]*\}m(?=[`"'<\s])/g)]
        .map(m => `${file}: ${m[0]}`))
    expect(hits, 'use formatMinutes/formatHoursMinutes — see packages/shared/src/format/units.ts')
      .toEqual([])
  })

  it('formatHoursMinutes keeps the minutes under an hour, which the copy it replaced did not', () => {
    // `home-day-timeline`'s own helper returned `0h` for this.
    expect(formatHoursMinutes(0.75 * 60)).toBe('45m')
    expect(formatHoursMinutes(7.5 * 60)).toBe('7h 30m')
    expect(formatHoursMinutes(7 * 60)).toBe('7h 00m')
  })

  it('formatMinutes is the `55 min` form the stray sites disagreed with', () => {
    expect(formatMinutes(55)).toBe('55 min')
    expect(formatMinutes(55, { unit: false })).toBe('55')
  })
})
