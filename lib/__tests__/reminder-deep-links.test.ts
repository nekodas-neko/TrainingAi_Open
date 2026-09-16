import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { TABS } from '@/components/shell/tabs'

const root = path.join(__dirname, '..', '..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const exists = (p: string) => fs.existsSync(path.join(root, p))

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
 *
 * **Two row shapes, because a param is one way to reach content and not the only one (BF-5).** The
 * weekly recap became its own page, so its reminder points at `/health/week` with no query — and
 * `/api/weekly-digest` computes the recap week itself and takes none, so a param there would be a
 * control that does nothing, which is the very thing this file exists to catch. Rather than invent
 * one to keep the old row shape, a query-less route asserts what actually makes it land somewhere
 * real: it has its own `page.tsx`, **and it is not a tab href**. That second half is the original
 * failure restated — `/` was wrong because it opens a tab and leaves the user to find a banner, and
 * so would `/nutrition` be.
 */
type Row =
  | { file: string; route: string; readBy: string; page?: never }
  | { file: string; route: string; page: string; readBy?: never }

const ROUTES: Row[] = [
  { file: 'lib/day-review-reminders.ts', route: '/nutrition?review=day', readBy: 'app/nutrition/nutrition-content.tsx' },
  { file: 'lib/day-review-reminders.ts', route: '/health/week', page: 'app/health/week/page.tsx' },
  { file: 'lib/meal-reminders.ts', route: '/nutrition?chat=backfill', readBy: 'app/nutrition/nutrition-content.tsx' },
]

describe('reminder deep links reach something that reads them', () => {
  for (const row of ROUTES) {
    const { file, route } = row

    it(`${file} schedules ${route}`, () => {
      expect(read(file)).toContain(`route: '${route}'`)
    })

    if (row.readBy) {
      const [, query] = route.split('?')
      const [key, value] = query.split('=')
      it(`${row.readBy} reads ${key}=${value}`, () => {
        // The get AND the comparison, in one pattern. Asserting the key alone would pass while the
        // screen ignored what it said; asserting the value alone passes on any string in the file.
        // Deliberately not anchored to a `searchParams` variable — one caller stores it, the other
        // calls `useSearchParams().get(…)` inline, and neither is the thing under test.
        expect(read(row.readBy)).toMatch(
          new RegExp(`\\.get\\(["']${key}["']\\)\\s*===\\s*["']${value}["']`),
        )
      })
    } else {
      it(`${route} is a page of its own, not a tab`, () => {
        expect(route, 'a query-less route must carry no query').not.toContain('?')
        expect(exists(row.page), `${row.page} must exist`).toBe(true)
        // The tab hrefs come from the shell rather than a list written here, so adding a tab cannot
        // leave this check quietly approving a reminder that lands on it.
        expect(TABS.map(t => t.href), 'a tab leaves the user to find the content').not.toContain(route)
      })
    }
  }

  it('no day reminder lands on a bare route again', () => {
    const src = read('lib/day-review-reminders.ts')
    // `/` alone is the shape this entry removed: it opens the app and says nothing about why.
    expect(src).not.toMatch(/route:\s*['"]\/['"]/)
  })
})
