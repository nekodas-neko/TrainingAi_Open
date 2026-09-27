import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments } from '../../../scripts/lib/strip-comments.js'
import { formatLoadKg } from '@trainingai/shared/format/units'

/**
 * RV-208 ② — one spacing for a lifted load, and one place that decides it.
 *
 * The sweep found `7 × 68kg` on one screen against `98 kg` on another. `formatLoadKg` settled the
 * form (Lane A, 2026-09-27); this converts the render sites and stops the next one being written
 * by hand. Sibling of `rv208-one-duration-form.test.ts`, deliberately the same shape.
 *
 * **The entry named six sites and there were nine.** A list in a backlog entry is a snapshot of
 * when it was written — `next-workout-card`, `week-day-sheet` and `formatVolume` were not on it.
 */
const ROOTS = ['components', 'app']
const repoRoot = join(__dirname, '..', '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '__tests__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/**
 * Named, each with its reason, rather than quietly matched.
 *
 * `formatVolume` renders a lifetime TONNAGE with `kT`/`T`/`kg` tiers, deliberately rounded whole —
 * it is not a load anyone lifted in one go, and spacing only its bottom tier would leave the three
 * disagreeing with each other. `components/admin/**` is excluded from this sweep by the entry.
 */
const EXEMPT = new Set(['app/profile/[userId]/page.tsx'])

const sources = ROOTS
  .flatMap(d => walk(join(repoRoot, d)))
  .map(f => ({ file: f.slice(repoRoot.length + 1), code: stripComments(readFileSync(f, 'utf8')) as string }))
  // `app/api/**` is not a render surface and is not this lane's: the five `${x}kg` there are LLM
  // prompt text (`nutrition-goals/recommend`) and a Google Calendar event description
  // (`log-calendar-event`). Neither is the app drawing a load on a screen, and a prompt's wording
  // is tuned against the model rather than for consistency with a card. Noted on the entry for
  // Lane A rather than swept here.
  .filter(s => !s.file.startsWith('app/api/'))
  .filter(s => !s.file.startsWith('components/admin/') && !EXEMPT.has(s.file))

describe('RV-208 — load unit spacing', () => {
  it('has sources to scan, or it is checking nothing', () => {
    expect(sources.length).toBeGreaterThan(200)
  })

  /**
   * An interpolation followed immediately by `kg`. A standalone `<span>kg</span>` label beside its
   * own number is a different construction and is left alone — those are input adornments, not a
   * formatted value.
   */
  it('renders no hand-spaced load', () => {
    // `}kg`, which covers BOTH forms — a template literal's `${weight}kg` and JSX's `{weight}kg`.
    // The first version of this matched only `${…}` and its control run passed with a reverted
    // site still in the tree: half the call sites in this sweep are JSX, so it was checking less
    // than it claimed to.
    const hits = sources.flatMap(({ file, code }) =>
      [...code.matchAll(/\}kg\b/g)].map(m => {
        const at = m.index ?? 0
        return `${file}: …${code.slice(Math.max(0, at - 26), at + m[0].length)}`
      }))
    expect(hits, 'use formatLoadKg — see packages/shared/src/format/units.ts').toEqual([])
  })

  it('formatLoadKg shows a plate step exactly and pads nothing that is not there', () => {
    // One decimal would round a 1.25 kg step to 71.3; a padded tenth turns 68 into "68.0 kg".
    expect(formatLoadKg(68)).toBe('68 kg')
    expect(formatLoadKg(67.5)).toBe('67.5 kg')
    expect(formatLoadKg(71.25)).toBe('71.25 kg')
  })
})
