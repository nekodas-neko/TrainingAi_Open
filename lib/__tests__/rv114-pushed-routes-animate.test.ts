import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * RV-114 — six pushed routes had no transition, and one pair opened hard then animated closed.
 *
 * `useTransitionRouter` is a drop-in for `useRouter` whose `push`/`replace`/`back` animate, and it
 * already no-ops for bottom-nav hrefs and same-URL pushes, so the swap is import-only.
 *
 * **The asymmetric pair is the reason this is pinned rather than left to review.** Both friends
 * surfaces push `/profile/${userId}` with a plain router while that screen's own back runs the
 * `"back"` keyframes — open hard, close animated, which is the exact inversion
 * `lib/hooks/use-back-or-fallback.ts` exists to prevent. A file reverting to `useRouter` restores
 * that inversion silently, because nothing about it looks wrong at the call site.
 *
 * Deliberately NOT a repo-wide ratchet: 16 files still use a plain `useRouter` and most are right
 * to — a tab href or a `refresh()` needs no transition. Widening this belongs to its own entry.
 */
const SWAPPED = [
  'components/more/friend-leaderboard.tsx',
  'components/more/friend-feed.tsx',
  'app/nutrition/nutrition-content.tsx',
  'app/register/register-form.tsx',
  'app/coach/coach-content.tsx',
  'app/coach/confirm/[toolCallId]/confirm-content.tsx',
  'app/collection/collection-content.tsx',
]

describe('RV-114 — pushed routes animate', () => {
  for (const file of SWAPPED) {
    it(`${file} navigates through the transition router`, () => {
      const s = src(file)
      expect(s, 'must use useTransitionRouter').toMatch(/useTransitionRouter\(\)/)
      expect(s, 'a bare useRouter here is the untransitioned push RV-114 removed')
        .not.toMatch(/\buseRouter\b/)
    })
  }

  it('both friends surfaces open the profile the same way its back closes it', () => {
    // The inversion this entry was filed for: animated close, unanimated open.
    for (const file of ['components/more/friend-leaderboard.tsx', 'components/more/friend-feed.tsx']) {
      const s = src(file)
      expect(s, `${file} still pushes a profile`).toMatch(/router\.push\(`\/profile\/\$\{/)
      expect(s, `${file} must animate that push`).toMatch(/useTransitionRouter/)
    }
  })

  it('the transition router is still a drop-in, so the swap cannot silently drop a method', () => {
    // It spreads the real router and overrides only push/replace/back. If that stops being true,
    // every site above loses `refresh`/`prefetch` without a type error at the call site.
    expect(src('lib/view-transition.ts')).toMatch(/\.\.\.router,\s*push,\s*replace,\s*back/)
  })
})
