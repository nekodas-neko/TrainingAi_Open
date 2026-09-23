import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../..')
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * LB-131 / DV-9 — two sleep surfaces took Brisbane by default.
 *
 * `computeSleepStartConsistency(starts, tz = DEFAULT_TZ)` and `timingPoints(nights, mode, tz =
 * DEFAULT_TZ)` both already accepted a zone; nothing on the client passed one. That is the shape
 * CLAUDE.md calls a safety net that makes forgetting silent — correct for the owner, wrong for
 * anyone whose phone and profile disagree, and invisible until they do.
 *
 * The helpers' own maths is covered by DV-7's fixtures. What had no guard, and is what regressed,
 * is whether the CALL SITES pass anything at all.
 */
const HELPERS = ['computeSleepStartConsistency', 'timingPoints'] as const

function clientCallSites(fn: string) {
  const files = execFileSync('git', ['ls-files', 'app', 'components'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(f => /\.tsx?$/.test(f) && !f.includes('__tests__'))
  const hits: Array<{ file: string; line: number; call: string }> = []
  for (const f of files) {
    const text = src(f)
    const re = new RegExp(`\\b${fn}\\(`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const lineStart = text.lastIndexOf('\n', m.index) + 1
      if (/^\s*(import|export)\b/.test(text.slice(lineStart, text.indexOf('\n', m.index)))) continue
      // Read to the balanced close. The route spells this call across three lines, so a
      // line-at-a-time regex reports it as bare — a false positive that cost a run.
      let depth = 0
      let end = m.index + m[0].length - 1
      for (; end < text.length; end++) {
        if (text[end] === '(') depth++
        else if (text[end] === ')') { depth--; if (depth === 0) break }
      }
      hits.push({
        file: f,
        line: text.slice(0, m.index).split('\n').length,
        call: text.slice(m.index, end + 1).replace(/\s+/g, ' '),
      })
    }
  }
  return hits
}

describe('LB-131 / DV-9 — sleep timing is resolved in the user\'s zone, not a default', () => {
  it('finds the call sites at all, so nothing below passes vacuously', () => {
    for (const fn of HELPERS) expect(clientCallSites(fn).length, fn).toBeGreaterThan(0)
  })

  it('passes a timezone at every client call site', () => {
    const bare: string[] = []
    for (const fn of HELPERS) {
      for (const { file, line, call } of clientCallSites(fn)) {
        // Both helpers take the zone LAST, so a call whose arguments never mention one is the
        // defect. Matched across the whole call, not one line.
        if (!/\btz\b/.test(call)) bare.push(`${file}:${line} — ${call}`)
      }
    }
    expect(bare, 'a call with no zone silently uses Brisbane').toEqual([])
  })

  it('takes the zone from the session, never the device or a literal', () => {
    // `useUserTimezone()` is fed from the root layout's `auth()` call. A `DEFAULT_TZ` literal or an
    // `Intl` read would typecheck and be exactly the bug.
    for (const f of ['app/health/sleep/sleep-content.tsx', 'components/health/sleep-timing-trend-card.tsx']) {
      expect(src(f), f).toMatch(/const tz = useUserTimezone\(\)/)
      expect(src(f), `${f} must not re-derive a zone`).not.toMatch(/Intl\.DateTimeFormat\(\)\.resolvedOptions/)
      expect(src(f), `${f} must not hardcode a zone`).not.toMatch(/['"]Australia\/Brisbane['"]/)
    }
  })

  it('reads the context in the card rather than threading a prop through the toggle', () => {
    // The card renders through sleep-trend-toggle-card.tsx, which has no other use for a timezone.
    // A threaded prop would be one a future render site can omit — the same hazard as the default.
    expect(src('components/health/sleep-trend-toggle-card.tsx')).not.toMatch(/\btz\b/)
  })
})
