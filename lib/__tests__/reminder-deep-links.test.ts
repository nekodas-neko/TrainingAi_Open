import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(__dirname, '..', '..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

/**
 * A reminder's `extra.route` has to name a param that something reads (Q-112a).
 *
 * The failure this locks is not a broken link — it is a **valid one that does nothing**. Both day
 * reminders pointed at `/`, which loads fine and leaves the user to find a banner; the plan's words
 * were *"today the reminders land on `/` and ask the user to find the banner"*. Nothing would have
 * caught that, because every assertion you would naturally write still passes.
 *
 * Source-shape rather than behavioural because the scheduling half needs Capacitor, which does not
 * exist in this environment — and the two halves live in different files, which is the only reason
 * they can disagree.
 */
const ROUTES = [
  { file: 'lib/day-review-reminders.ts', route: '/nutrition?review=day', readBy: 'app/nutrition/nutrition-content.tsx' },
  { file: 'lib/day-review-reminders.ts', route: '/?review=week', readBy: 'app/session-select/session-select-content.tsx' },
  { file: 'lib/meal-reminders.ts', route: '/nutrition?chat=backfill', readBy: 'app/nutrition/nutrition-content.tsx' },
]

describe('reminder deep links reach something that reads them', () => {
  for (const { file, route, readBy } of ROUTES) {
    const [, query] = route.split('?')
    const [key, value] = query.split('=')

    it(`${file} schedules ${route}`, () => {
      expect(read(file)).toContain(`route: '${route}'`)
    })

    it(`${readBy} reads ${key}=${value}`, () => {
      // The get AND the comparison, in one pattern. Asserting the key alone would pass while the
      // screen ignored what it said; asserting the value alone passes on any string in the file.
      // Deliberately not anchored to a `searchParams` variable — one caller stores it, the other
      // calls `useSearchParams().get(…)` inline, and neither is the thing under test.
      expect(read(readBy)).toMatch(
        new RegExp(`\\.get\\(["']${key}["']\\)\\s*===\\s*["']${value}["']`),
      )
    })
  }

  it('no day reminder lands on a bare route again', () => {
    const src = read('lib/day-review-reminders.ts')
    // `/` alone is the shape this entry removed: it opens the app and says nothing about why.
    expect(src).not.toMatch(/route:\s*['"]\/['"]/)
  })
})
