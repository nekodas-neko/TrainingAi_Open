import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../..')
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * RV-108 — a weigh-in cleared 3 of 202 cached keys.
 *
 * Measured on the S25: the sheet's local-store branch ended at a bare `pushMutations`, and the
 * only invalidation was the CONSUMER's — which takes its readiness arm when `onSaved` gets a fresh
 * row, so the body-metric keys were never evicted at all. Recovery was TTL expiry.
 *
 * Both halves are load-bearing and for different reasons, which is why this asserts both:
 * immediately so the writing device repaints, and again through `pushThenRevalidate` once the
 * server has the row — an offline write's push never resolves usefully, so a push-only
 * invalidation repaints nothing at all.
 */
const SHEET = 'components/health/metric-log-sheet.tsx'
/** The reference, two files away, that already did it correctly (RV-108 says: copy this exactly). */
const REFERENCE = 'components/profile/water-log-sheet.tsx'

describe('RV-108 — a body-metric write invalidates on both halves', () => {
  it('fires the invalidation immediately, for the device that wrote it', () => {
    expect(src(SHEET)).toMatch(/invalidateBodyMetricWrite\(\)\.catch/)
  })

  it('fires it again once the push resolves, for what the server derives', () => {
    expect(src(SHEET)).toMatch(/pushThenRevalidate\(userId!, invalidateBodyMetricWrite\)/)
  })

  it('no longer leaves a bare pushMutations on the write path', () => {
    // The defect exactly: queue the mutation, push, and evict nothing.
    expect(src(SHEET), 'a bare push clears no cache at all').not.toMatch(/\bpushMutations\(/)
  })

  it('matches the reference sheet it was told to copy', () => {
    // If the reference is ever changed, this fails rather than letting the two drift — the pairing
    // is the whole content of the fix.
    const ref = src(REFERENCE)
    expect(ref).toMatch(/pushThenRevalidate\(userId!, invalidateBodyMetricWrite\)/)
    expect(ref).toMatch(/invalidateBodyMetricWrite\(\)\.catch/)
  })

  it('clears the keys the device measured as stale', () => {
    // The 3-of-202 reading named these as NOT cleared; they are what the group must contain for
    // this fix to mean anything.
    const groups = src('lib/cache-groups.ts')
    const body = groups.slice(groups.indexOf('export async function invalidateBodyMetricWrite'))
    const fn = body.slice(0, body.indexOf('\n}'))
    for (const key of ['body-metadata', 'energy-balance:', 'day-log:', 'health-trends-summary', 'hr-profile']) {
      expect(fn, `invalidateBodyMetricWrite must clear ${key}`).toContain(key)
    }
  })
})
