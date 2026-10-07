import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { UNCLASSIFIED_EXERCISE_ROLE } from '@trainingai/shared/workout/exercise-role'
import {
  EXERCISE_ROLES,
  EXERCISE_ROLE_LABEL,
  MUSCLE_ROLES,
  MUSCLE_ROLE_LABEL,
  exerciseRoleLabel,
  exerciseRoleBadge,
} from '../exercise-role-labels'
import { knownExerciseRoleLabel } from '@trainingai/shared/workout/role-labels'
import { roleLabel } from '@trainingai/shared/workout/intensity-zone'

/**
 * BF-125: the same three enum values carried two wordings — *Main / Compound / Accessory* on the
 * builder review screen, *Main Compound / Secondary Compound / Accessory* in the program editor —
 * and a user meets both while doing one thing: notice a bad role on review, go to the editor to
 * change it. **One Formula, One Place** covers a label the user matches across screens.
 */

const root = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const CONSUMERS = [
  'components/workout-builder/builder-review.tsx',
  'components/config/program-editor-sheet.tsx',
]

/** Every screen that shows a role word for either axis (#2240). Each reads the shared helper. */
const ROLE_WORD_SCREENS = [
  ...CONSUMERS,
  'components/config/phase-editor.tsx',
  'components/exercises/add-exercise-sheet.tsx',
  'components/exercise-history-sheet.tsx',
  'components/admin/exercise-manager.tsx',
  'packages/shared/src/workout/intensity-zone.ts',
  'packages/shared/src/ai-periodization/explain.ts',
]

describe('exercise role labels (BF-125)', () => {
  it('names all three roles, in display order', () => {
    expect([...EXERCISE_ROLES]).toEqual(['primary', 'secondary', 'accessory'])
    expect(EXERCISE_ROLES.map(r => EXERCISE_ROLE_LABEL[r])).toEqual(['Primary', 'Secondary', 'Accessory'])
  })

  it('names the muscle axis with its own words, not the exercise axis\'s (#2240)', () => {
    // The stored values stay `main` / `secondary` — the data rename was declined — so only the
    // words differ. The editor used to call the muscle value `main` "Primary" while calling the
    // exercise value `primary` "Main Compound": each axis wearing the other's word.
    expect([...MUSCLE_ROLES]).toEqual(['main', 'secondary'])
    expect(MUSCLE_ROLES.map(r => MUSCLE_ROLE_LABEL[r])).toEqual(['Target', 'Assisting'])
    const exerciseWords = new Set(Object.values(EXERCISE_ROLE_LABEL))
    for (const w of Object.values(MUSCLE_ROLE_LABEL)) expect(exerciseWords.has(w), w).toBe(false)
    // The editor renders both axes a few lines apart; the muscle one reads the shared map too.
    const editor = read('components/config/program-editor-sheet.tsx')
    expect(editor).toContain('MUSCLE_ROLE_LABEL[role]')
    expect(editor).not.toMatch(/"Primary"\s*:\s*"Secondary"/)
  })

  it('the workout pills read the same words as the editor (#2240)', () => {
    for (const r of EXERCISE_ROLES) expect(roleLabel(r)).toBe(EXERCISE_ROLE_LABEL[r])
    expect(roleLabel(null)).toBeNull()
    expect(roleLabel('compound')).toBeNull()
    expect(knownExerciseRoleLabel('main')).toBeNull()
  })

  it('reads a missing or unrecognised role as the unclassified one (BF-15)', () => {
    // Has to agree with the editor's own `ex.exerciseRole ?? UNCLASSIFIED_EXERCISE_ROLE`, or the badge
    // would name one role while the selected pill highlighted another — the mismatch this file removes.
    expect(exerciseRoleLabel(null)).toBe('Accessory')
    expect(exerciseRoleLabel(undefined)).toBe('Accessory')
    expect(exerciseRoleLabel('compound')).toBe('Accessory')
    expect(exerciseRoleBadge(null)).toBe(exerciseRoleBadge(UNCLASSIFIED_EXERCISE_ROLE))
  })

  it('is the only place the words live', () => {
    for (const file of CONSUMERS) {
      const src = read(file)
      expect(src, file).toContain('exercise-role-labels')
      // The long form is what overflowed the editor's role row (BF-124); the short form must not
      // come back as a literal at a call site either, which is how the two wordings drifted apart.
      expect(src, file).not.toContain('Main Compound')
      expect(src, file).not.toContain('Secondary Compound')
    }
  })

  it('no screen carries a retired role word as a literal (#2240)', () => {
    for (const file of ROLE_WORD_SCREENS) {
      const src = read(file)
      expect(src, file).toContain('role-labels')
      // Each retired word in the quoted or JSX-text positions a label would occupy.
      expect(src, file).not.toMatch(/["'>]\s*(Main|Compound|Main lifts|Primary Muscles)\s*["'<]/)
      expect(src, file).not.toMatch(/Compound (lift|·)/)
      expect(src, file).not.toMatch(/title="(Primary|Secondary)"/)
    }
  })

  it('and no other component re-declares the mapping', () => {
    // Asserted by search rather than by listing files: a third screen showing roles is exactly the
    // case this guard exists for, and it would not be in any list written today.
    const hits = execSync(
      "grep -rlE \"secondary: *'(Compound|Secondary Compound)'|primary: *'Main'|main: *'(Primary|Main)'\" --include=*.tsx --include=*.ts app components lib packages/shared/src || true",
      { cwd: root, encoding: 'utf8' },
    ).trim()
    expect(hits, 'a role-label map outside packages/shared/src/workout/role-labels.ts').toBe('')
  })
})

/**
 * BF-124: the editor's role row could not fit its three buttons and the selected one read as
 * disabled. Both halves are layout/token choices with no runtime behaviour to assert, so they are
 * pinned against the source — the same shape as the tap-target guards, and for the same reason:
 * this project's vitest runs `environment: 'node'`, so a `.tsx` cannot be imported and rendered.
 */
describe('the editor role row (BF-124)', () => {
  const src = () => read('components/config/program-editor-sheet.tsx')

  it('wraps instead of clipping the last option', () => {
    // Was `flex gap-1` with no wrap: the longest label pushed `Accessory` past the right edge.
    // The `Role` caption also moved off the chips' flex line — sharing it cost the row ~40px of the
    // ~295px this card leaves at 412dp, which was enough on its own to push the third chip down.
    expect(src()).toContain('<div className="flex flex-wrap gap-1.5">')
    expect(src()).toContain('<span className="block text-xs text-muted-foreground">Role</span>')
  })

  it('shows the chosen role in the brand colour, not the near-white primary token', () => {
    // `--primary` is oklch(0.922 0 0) in dark — a near-white slab with near-black text, which reads
    // as disabled next to its own `bg-muted` siblings. The rest of this sheet marks a chosen option
    // with `bg-brand`, which is why the schedule-mode buttons read correctly and this did not.
    expect(src()).toContain('bg-brand text-brand-foreground border-brand')
    expect(src()).not.toContain('bg-primary text-primary-foreground border-primary')
    expect(read('components/config/phase-editor.tsx'))
      .not.toContain('bg-primary text-primary-foreground border-primary')
  })
})
