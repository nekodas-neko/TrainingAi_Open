import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../..')

/**
 * BF-103. The saved list is called **`My Foods`**, everywhere, by owner decision:
 * *"no I'm happy to rename Saved to → My Foods. the issue was having saved + MyFoods. we only need
 * one. lets go with MyFoods."*
 *
 * **The risk this guards is a revert, not a typo.** Two earlier entries removed `My Foods` — BF-37
 * from the page button, BF-60 from the tab — and both were solving the same thing: *two labels that
 * differ only in their last word*. Their comments read as a standing prohibition on the name, so a
 * session that finds them without this context reverts the rename on their authority. A single name
 * cannot be confused with itself, which is what satisfies their reasoning.
 */

function userVisibleStrings(): { file: string; line: number; text: string }[] {
  // `e2e/` is in scope on purpose, and is why: four specs clicked a button named `My Meals`, which
  // the entry's own file list did not name. A rename that leaves its tests asserting the old label
  // is a rename that breaks CI on the next run rather than at review.
  const files = execFileSync('git', ['ls-files', 'app', 'components', 'e2e'], {
    cwd: ROOT, encoding: 'utf8',
  }).split('\n').filter(f => /\.tsx?$/.test(f))
    // …but not THIS file. The scanner's own regex and its own test name both contain the literal,
    // and comment-stripping cannot reach either — one is code, the other is a string argument. So
    // the guard reported itself twice and `main` went red on it, which is the same shape as the
    // block-comment case above: a source scan whose first finding is its own documentation. Excluded
    // by path rather than by a cleverer matcher, because the next person to add a line quoting the
    // old name here would hit it again.
    .filter(f => f !== 'components/nutrition/__tests__/one-saved-list-label.test.ts')

  const out: { file: string; line: number; text: string }[] = []
  for (const file of files) {
    const src = readFileSync(path.join(ROOT, file), 'utf8')
    // Strip comments file-wide, keeping the newlines so line numbers survive. Per-line stripping was
    // the first version and it cannot see a block comment, so the guard reported 33 hits that were
    // all its own documentation — the two files explaining this history quote the old name on
    // purpose, and they have to.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, '')
    code.split('\n').forEach((line, i) => {
      if (/My Meals/.test(line)) out.push({ file, line: i + 1, text: src.split('\n')[i].trim() })
    })
  }
  return out
}

describe('the saved list has exactly one name', () => {
  it('no user-visible string says "My Meals"', () => {
    // Includes the aria-label on plan-meal-row: a rename that skips it leaves a screen reader saying
    // a name the screen no longer uses, which is the half of a sweep that is easy to miss.
    expect(userVisibleStrings()).toEqual([])
  })

  it('the tab and the page button agree', () => {
    const tab = readFileSync(path.join(ROOT, 'components/nutrition/saved-meals-sheet.tsx'), 'utf8')
    const button = readFileSync(path.join(ROOT, 'components/nutrition/nutrition-action-row.tsx'), 'utf8')
    expect(tab).toMatch(/value: 'meals' as const, label: 'My Foods'/)
    expect(button).toMatch(/>My Foods</)
  })

  it('the tab strip still has three tabs — the rename must not re-merge them', () => {
    // `My Foods` was once the name of a MERGED list (v1.382.0), split back three versions later
    // because a recipe and a single ingredient in one list made "log this" mean two things. That
    // revert was about the merge, not the name. Renaming the tab must not resurrect the merge.
    const tab = readFileSync(path.join(ROOT, 'components/nutrition/saved-meals-sheet.tsx'), 'utf8')
    const labels = [...tab.matchAll(/label: '([^']+)'/g)].map(m => m[1])
    expect(labels).toEqual(['Recent', 'My Foods', 'Search'])
  })
})
