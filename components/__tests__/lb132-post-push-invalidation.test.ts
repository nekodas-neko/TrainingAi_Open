import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * LB-132 — five local-first write paths invalidated only on the near side of the push.
 *
 * Each of these queues its mutation, fires a bare `pushMutations`, and evicts its caches on the
 * same beat. That ordering is the one `pushThenRevalidate` exists to stop, and its own docblock
 * names the cost: every `useCachedValue` subscriber wakes on that signal, refetches while the
 * server still holds the pre-write state, and **re-caches the stale payload** — which then stands
 * for the key's full TTL, because nothing invalidates a second time. Home's Energy Balance card
 * read 42 kcal high for exactly this reason (LB-4).
 *
 * Nothing downstream closes the window: `pullDelta` fires no cache invalidation of its own, so the
 * next pull replaces the local rows without touching the entries that went stale.
 *
 * **Both halves are asserted, and they are not redundant.** The immediate call is what repaints the
 * device that did the writing — offline, the push never resolves usefully, so a push-only
 * invalidation repaints nothing at all. The `pushThenRevalidate` call is what picks up everything
 * the SERVER derives from the write, which is the only reason these particular groups matter: every
 * key below is a server-computed aggregate, not a local read.
 */
const SITES: { file: string; revalidate: RegExp; immediate: RegExp }[] = [
  {
    file: 'app/session-select/components/log-value-sheet.tsx',
    revalidate: /pushThenRevalidate\(userId!, \(\) => Promise\.all\(\[invalidateBodyMetricWrite\(\), invalidateReadinessInputs\(\)\]\)\)/,
    immediate: /invalidateBodyMetricWrite\(\)\.catch/,
  },
  {
    file: 'components/mood-checkin-sheet.tsx',
    revalidate: /pushThenRevalidate\(userId!, invalidateCheckinAffectsPrescription\)/,
    immediate: /invalidateCheckinAffectsPrescription\(\)\.catch/,
  },
  {
    file: 'components/morning-checkin-sheet.tsx',
    revalidate: /pushThenRevalidate\(userId!, \(\) => Promise\.all\(\[invalidateCheckinAffectsPrescription\(\), invalidateHealthTrends\(\)\]\)\)/,
    immediate: /invalidateCheckinAffectsPrescription\(\)\.catch/,
  },
  {
    file: 'components/nutrition/end-of-day/end-of-day-review.tsx',
    revalidate: /pushThenRevalidate\(userId!, invalidateHealthTrends\)/,
    immediate: /invalidateHealthTrends\(\)\.catch/,
  },
  {
    file: 'components/activity/exercise-review-sheet.tsx',
    revalidate: /pushThenRevalidate\(userId!, \(\) => Promise\.all\(\[invalidateActivityWrites\(\), invalidateOuraWorkoutReview\(\)\]\)\)/,
    immediate: /invalidateActivityWrites\(\), invalidateOuraWorkoutReview\(\)\]\)/,
  },
]

describe('LB-132 — a local-first write invalidates again once the push lands', () => {
  for (const { file, revalidate, immediate } of SITES) {
    describe(file, () => {
      it('revalidates on the far side of the push', () => {
        expect(src(file)).toMatch(revalidate)
      })

      it('still invalidates immediately, for the writing device offline', () => {
        expect(src(file)).toMatch(immediate)
      })

      it('leaves no bare pushMutations on the write path', () => {
        expect(src(file), 'a bare push evicts nothing the server recomputes').not.toMatch(/\bpushMutations\(/)
      })
    })
  }

  it('every group named above clears at least one server-computed key', () => {
    // The discriminator that emptied LB-132's first group: a missing post-push invalidation is only
    // a defect where some CACHED key holds what the write changed. Each of these does.
    const groups = src('lib/cache-groups.ts')
    const fnBody = (name: string) => {
      const from = groups.indexOf(`export async function ${name}`)
      expect(from, `${name} must exist in cache-groups.ts`).toBeGreaterThan(-1)
      const rest = groups.slice(from)
      return rest.slice(0, rest.indexOf('\n}'))
    }
    for (const [name, key] of [
      ['invalidateBodyMetricWrite', 'body-metadata'],
      ['invalidateReadinessInputs', 'readiness-score'],
      ['invalidateCheckinAffectsPrescription', 'workout-data'],
      ['invalidateHealthTrends', 'health-trends:'],
      ['invalidateActivityWrites', 'day-log:'],
    ] as const) {
      expect(fnBody(name), `${name} must clear ${key}`).toContain(key)
    }
  })

  it('the pull path still does not invalidate, which is why the push side has to', () => {
    // If `pullDelta` ever grows its own invalidation, the far-side calls above become belt-and-
    // braces rather than the only thing closing the window — worth knowing before someone removes
    // them as redundant.
    expect(src('lib/local-store/sync-engine.ts')).not.toMatch(/invalidateBiometrics|invalidateCache\(/)
  })
})
