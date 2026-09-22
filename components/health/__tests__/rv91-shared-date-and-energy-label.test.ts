import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { formatDateDisplay } from '@trainingai/shared/date-utils'

/** RV-91. Two activity surfaces rendered `{log.date}` — the raw `2026-09-15` — on the line
 *  directly above a correctly formatted `formatTime12h()`, so the same day read
 *  "2026-09-15 · 6:42 am" in the activity history and "Monday, 15 September" in the day detail.
 *  And one energy label out of 156 said `Cal` where the rest say `kcal`.
 *
 *  The label half is a repo-wide count rather than one file, because the defect WAS the count: a
 *  single site disagreeing with 155 others is invisible when you only read that file. */

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('RV-91 — a date string reaches the screen through the shared formatter', () => {
  const SITES = [
    'components/health/activity-history-card.tsx',
    'components/activity/activity-detail-sheet.tsx',
  ]
  for (const file of SITES) {
    it(`${file} does not render a raw date`, () => {
      const src = code(read(file))
      expect(src, 'a raw YYYY-MM-DD reaches the screen — the shape RV-91 found twice')
        .not.toMatch(/\{\s*log\.date\s*\}/)
      expect(src, 'and it is the shared formatter it goes through, not a fifth option bag')
        .toMatch(/formatDateDisplay\(\s*log\.date/)
    })
  }

  it('the day detail reaches the same string through the helper, not its own option bag', () => {
    const src = code(read('app/health/day/day-detail-content.tsx'))
    expect(src, 'the long-form date is hand-rolled again — the sibling surface of the two above')
      .not.toMatch(/weekday:\s*["']long["']/)
    expect(src).toMatch(/formatDateDisplay\(\s*selectedDate\s*,\s*["']long["']\s*\)/)
  })

  it('the formatter still returns the two shapes these sites rely on', () => {
    // Component-wise construction, so this is the same answer in every timezone (Q-130).
    // "15 Sept", not "Sep 15": the helper renders `en-AU`, which is day-first and abbreviates
    // September to four letters. Its own header comment says 'short' gives "Jan 5" — that comment
    // is wrong, and it is in `packages/shared`, which is Lane A's. Filed rather than edited here.
    expect(formatDateDisplay('2026-09-15')).toBe('15 Sept')
    // No comma, either — `en-AU` does not put one before the day. RV-91 quotes "Monday, 15
    // September" for the day detail; that string is the doc comment's, not the function's, and
    // the day detail actually renders this one through a hand-rolled bag that now calls here too.
    expect(formatDateDisplay('2026-09-15', 'long')).toBe('Tuesday 15 September')
    // A value that is not a date passes through rather than throwing.
    expect(formatDateDisplay('not a date')).toBe('not a date')
  })
})

describe('RV-91 — one energy label', () => {
  it('no rendered copy says "Cal" where the rest of the app says "kcal"', () => {
    // `git ls-files` rather than a glob, so a new untracked scratch file cannot fail this.
    // **Tests are excluded, and that is not a convenience.** This assertion is about RENDERED
    // COPY, and a test that states the rule has to quote the banned word to state it — this file
    // says "Cal" four times. It passed locally while untracked and went red on the first CI run
    // that saw it committed, which is the sharpest possible demonstration that a repo-wide source
    // scan must exclude the file making the claim.
    // The `-- '*.tsx'` this used to carry did NOT filter: git unions pathspecs, so `app` and
    // `components` matched every file beneath them, `.ts` included. Found while writing RV-98's
    // equivalent sweep, which has the same shape.
    const files = execFileSync('git', ['ls-files', 'app', 'components'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(f => f.endsWith('.tsx') && !f.includes('__tests__'))

    const offenders = files.filter(f => /\bCal\b/.test(code(read(f))))
    expect(offenders, `"Cal" is a food calorie and so is "kcal" — the defect is the disagreement`)
      .toEqual([])

    // The other half of the count: kcal is genuinely the house unit, not a tie being broken.
    const kcal = files.filter(f => /\bkcal\b/.test(code(read(f)))).length
    expect(kcal, 'kcal has stopped being the majority label — re-read this rule before extending it')
      .toBeGreaterThan(20)
  })
})
