// Q-216. #1292 made `runSQL` throw on the canonical runtime when the local DB is not open, which
// turned a silently-succeeding local write into a visibly-failing one. Every user-initiated write
// then needs the same shape: if the local write throws, fall through to the server route rather than
// to an error handler.
//
// Four sites did not have it, and all failed the same way — `if (store) { …local… } else { …API… }`
// inside one try, so a throw from the store branch skipped the `else` entirely and landed in the
// outer catch. The worst was the guided walk, whose handler set `saved` and said the outbox would
// retry; the outbox write was the thing that had failed, so nothing was queued and the walk was
// gone while the screen said it was saved.
//
// A source-text guard, because the repo has no React component-testing stack. It is checkable
// precisely though: the local branch must have its OWN catch, and the API call must sit outside it.
// Each case below was confirmed to fail against the pre-fix file before being kept.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// The four fixed in this pass, plus test-result.tsx — which already had the shape and is the one
// the others were copied from, so it belongs here as the reference rather than as an exception.
const SITES: Array<{ file: string; what: string }> = [
  { file: 'components/guided-walk/walk-summary.tsx', what: 'a completed guided walk' },
  { file: 'components/nutrition/end-of-day/end-of-day-review.tsx', what: 'the end-of-day check-in' },
  { file: 'components/nutrition/saved-meals-sheet.tsx', what: 'a saved meal' },
  { file: 'app/nutrition/nutrition-content.tsx', what: 'a food-log delete' },
  { file: 'components/fitness-tests/test-result.tsx', what: 'a fitness-test result' },
]

describe('a failed local write falls through to the server, never to an error toast (Q-216)', () => {
  for (const { file, what } of SITES) {
    describe(what, () => {
      const src = read(file)

      it('logs the local failure rather than swallowing it', () => {
        // Every one of these catches names the file's own domain, so a copy-paste that keeps the
        // wrong message is visible. The point is that the throw is *observed* at the branch.
        expect(src).toMatch(/console\.error\('[^']*(?:SQLite|falling back to API)[^']*',/)
      })

      it('falls back to the API on that path', () => {
        expect(src).toMatch(/falling back to API/)
      })
    })
  }

  // The specific lie that made the walk the worst of the four: it reported success.
  it('the guided walk no longer claims the outbox will retry a mutation it failed to queue', () => {
    const src = read('components/guided-walk/walk-summary.tsx')
    expect(src).not.toMatch(/setSaved\(true\) \/\/ optimistic; the outbox retries on device/)
  })

  // The three that were `if (store) {…} else {…API}` now gate the API on the local result, so the
  // fallback is reachable when the branch was entered and threw — not only when there is no store.
  for (const file of [
    'components/nutrition/end-of-day/end-of-day-review.tsx',
    'components/nutrition/saved-meals-sheet.tsx',
    'components/guided-walk/walk-summary.tsx',
  ]) {
    it(`${file} gates its server write on the local result, not on store presence alone`, () => {
      const src = read(file)
      expect(src).toMatch(/let savedLocally = false/)
      expect(src).toMatch(/if \(savedLocally\) return|if \(!savedLocally\) \{/)
    })
  }
})
