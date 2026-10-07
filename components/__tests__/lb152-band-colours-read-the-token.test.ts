import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'
import { volumeVerdict } from '../health/volume-band'

/** LB-152 / #2074. A reading whose colour is chosen by a condition — goal reached, on track, over
 *  the line — is a BAND, and the app's good / warning / bad triad is `--accent-green`,
 *  `--accent-amber`, `--destructive`. These files each picked it with a hex literal instead, so the
 *  same state read as two different greens (and two reds) depending on which card showed it: in
 *  dark, `#22c55e` is `rgb(34,197,94)` and the token is `rgb(86,238,102)`.
 *
 *  The owner chose to migrate these to the token as it stands (option a), not to retune the token
 *  to the literal, because the retune would have repainted every one of the ~212 readings already
 *  on it.
 *
 *  This guards the class in the files that were migrated. It deliberately does NOT ban the hex in
 *  them: `health-sections.tsx` still carries identity tints (the lean-mass card is green because it
 *  is the lean-mass card, not because a value is good), and those keep their hex whatever the owner
 *  decides. What it bans is the literal on a line that also holds a condition. */

const ROOT = path.resolve(__dirname, '../..')
const code = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), 'utf8'))

// `components/health/training-load-card.tsx` is deliberately absent. Its ACWR headline takes its
// colour from `acwr.ts` (shared package, #2148) while `monotonyColor` sits beside it, so migrating
// only the monotony half would put two greens on one card. It moves with `acwr.ts`.
const FILES = [
  'app/health/health-sections.tsx',
  'app/session-select/components/deload-banner.tsx',
  'app/session-select/components/streak-card.tsx',
  'components/exercise-history-sheet.tsx',
  'components/health/body-fat-card.tsx',
  'components/health/trends-section.tsx',
  'components/health/weekly-muscle-sets-card.tsx',
  'components/health/volume-band.ts',
]

/** `#22c55e`, `#ef4444`, `#f59e0b`, and their `rgb(a)(…)` spellings. */
const ACCENT_LITERAL = /#22c55e|#ef4444|#f59e0b|rgba?\(\s*(?:34\s*,\s*197\s*,\s*94|239\s*,\s*68\s*,\s*68|245\s*,\s*158\s*,\s*11)\s*[,)]/i
/** A ternary or an `if` on the same line — what separates a band from an identity tint. */
const CONDITION = /\?|\bif\s*\(/
const TOKEN = /var\(--(?:accent-green|accent-amber|destructive)\)/

describe('LB-152 — band colours read the accent token', () => {
  it('finds the files it is scanning', () => {
    // A rename that makes readFileSync throw is loud; this makes an emptied list loud too.
    expect(FILES.length).toBe(8)
    for (const f of FILES) expect(code(f).length, f).toBeGreaterThan(0)
  })

  it('no line picks a green, amber or red by a condition with a hex literal', () => {
    const offenders: string[] = []
    for (const f of FILES) {
      code(f).split('\n').forEach((line, i) => {
        if (ACCENT_LITERAL.test(line) && CONDITION.test(line)) offenders.push(`${f}:${i + 1} ${line.trim()}`)
      })
    }
    expect(offenders, 'a band colour is var(--accent-green) / --accent-amber / --destructive').toEqual([])
  })

  it('every migrated file still paints with the token, not merely stopped colouring', () => {
    // The weekly-muscle-sets card no longer names a colour at all (#2554): its bars and the body map
    // both take theirs from `muscleVolumeColor` in `volume-band.ts`, which is in this list and does.
    for (const f of FILES.filter(f => f !== 'components/health/weekly-muscle-sets-card.tsx')) expect(code(f), f).toMatch(TOKEN)
  })

  it('the volume bands return the tokens, and the two reds stay one colour', () => {
    const at = (sets: number) => volumeVerdict('powerbuilding', 'biceps', sets)
    const { mev, mav, mrv } = at(0)
    expect(at(mev - 1).color).toBe('var(--destructive)')
    expect(at(mev).color).toBe('var(--accent-green)')
    expect(at(mav + 1).color).toBe('var(--accent-amber)')
    expect(at(mrv + 1).color).toBe('var(--destructive)')
  })

  it('the deload banner border is not a hex alpha appended to a var()', () => {
    // `${borderColor}40` with `borderColor = 'var(--accent-amber)'` is `var(--accent-amber)40` —
    // invalid CSS, so the browser drops the whole `border` declaration. That is why the soft tier
    // rendered with no border at all, and why the red tier would have lost its own on migration.
    const src = code('app/session-select/components/deload-banner.tsx')
    expect(src).not.toMatch(/\$\{\s*borderColor\s*\}[0-9a-fA-F]{2}/)
    expect(src).toMatch(/border:\s*`1px solid \$\{edgeColor\}`/)
  })
})
