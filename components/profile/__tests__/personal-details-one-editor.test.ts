import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * BF-79's central claim, as a check rather than a sentence: **each personal-detail column is
 * written from exactly one file.**
 *
 * It was written from two. `EditProfileSheet` owned the display name and `GoalsSection` owned
 * height, date of birth and biological sex — and until BF-78 each also resent the other's fields,
 * so a save from a stale `user` prop could overwrite a change made in the other editor. BF-78
 * removed the resends; this entry removed the second editor. Nothing stops a third from being
 * added, which is what this is for.
 *
 * **Why source text and not a rendering test.** Both vitest projects run `environment: 'node'`, so
 * no component renders here. The defect is structural anyway — a second `fetch` that names the
 * field — and that is exactly what source text can see.
 *
 * **Comments and imports are stripped before matching.** Three guards in this repo have shipped
 * satisfied by the prose documenting their own fix, which is a guard that cannot fail; the
 * doc comment above this file names `dateOfBirth` and would have done it again.
 */

const ROOT = join(__dirname, '..', '..', '..')

/**
 * The columns this entry consolidated. `activityLevel` and `fitnessGoal` are deliberately absent:
 * `goal-recommendation-sheet.tsx` patches `activityLevel` when the user accepts a recommendation,
 * which is applying a suggestion rather than a second place to edit it, and BF-79 leaves both in
 * Goals on purpose — they are inputs to the calorie target, not facts about the person.
 */
const PERSONAL_DETAIL_FIELDS = ['displayName', 'heightCm', 'dateOfBirth', 'sex'] as const

/** Where each of them is expected to be written. One file, and the same file for all four. */
const EXPECTED_EDITOR = 'app/more/details/details-content.tsx'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git' || name === '__tests__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/** Source with comments and import lines removed, so a guard cannot pass on its own prose. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
    .split('\n')
    .filter(l => !l.trimStart().startsWith('import '))
    .join('\n')
}

/**
 * The object literals that become a request body: the argument to `JSON.stringify({…})`, and to
 * the `patch({…})` helper the details screen funnels through.
 *
 * **Matching the field anywhere in the file is not enough, and this was measured.** The first
 * version of this guard did, and deleting the details screen's `heightCm` write still passed —
 * because the screen also seeds `heightCm` into its own form state, which is not a write. Only the
 * span inside these calls is the payload.
 */
function requestBodies(src: string): string {
  const spans: string[] = []
  for (const call of ['JSON.stringify(', 'patch(']) {
    let from = 0
    for (;;) {
      const at = src.indexOf(call, from)
      if (at < 0) break
      from = at + call.length
      let depth = 0
      for (let i = from; i < src.length; i++) {
        const ch = src[i]
        if (ch === '(' || ch === '{') depth++
        else if (ch === ')' || ch === '}') {
          if (depth === 0) { spans.push(src.slice(from, i)); break }
          depth--
        }
      }
    }
  }
  return spans.join('\n')
}

/** Every file that PATCHes the profile route with the field in its body. */
function writersOf(field: string): string[] {
  const found: string[] = []
  for (const dir of ['app', 'components', 'lib']) {
    for (const file of walk(join(ROOT, dir))) {
      const src = code(file)
      if (!src.includes('/api/user/profile')) continue
      if (!/method:\s*'PATCH'/.test(src)) continue
      if (new RegExp(`\\b${field}\\s*:`).test(requestBodies(src))) found.push(file.slice(ROOT.length + 1))
    }
  }
  return found.sort()
}

describe('BF-79 — the personal details have one editor', () => {
  for (const field of PERSONAL_DETAIL_FIELDS) {
    it(`${field} is written from exactly one file`, () => {
      expect(writersOf(field)).toEqual([EXPECTED_EDITOR])
    })
  }

  it('the Goals section no longer resends the personal details', () => {
    const src = code(join(ROOT, 'components/profile/goals-section.tsx'))
    for (const field of ['heightCm', 'dateOfBirth', 'sex']) {
      expect(new RegExp(`\\b${field}\\s*:`).test(src), `goals-section still sends ${field}`).toBe(false)
    }
  })

  it('the details screen is reachable from the More tab', () => {
    const src = code(join(ROOT, 'components/more/profile-tab.tsx'))
    expect(src).toContain("router.push('/more/details')")
  })

  it('the Goals section offers a way to the fields it can no longer edit', () => {
    const src = code(join(ROOT, 'components/profile/goals-section.tsx'))
    expect(src).toContain("router.push('/more/details')")
  })
})
