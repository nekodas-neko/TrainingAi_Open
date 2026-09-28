import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { localSupplementsToStatus } from '../local-status'
import type { LocalSupplement, LocalSupplementLog } from '@/lib/local-store/types'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const ROOT = path.resolve(__dirname, '../../..')
const code = (rel: string) =>
  stripComments(readFileSync(path.join(ROOT, rel), 'utf8'))

function def(over: Partial<LocalSupplement> = {}): LocalSupplement {
  return {
    id: 's1', name: 'Creatine', dose: '5 g', defaultAmount: 5, unit: 'g',
    startedOn: null, stoppedOn: null, dosePrompt: true,
    reminderEnabled: true, reminderTime: '08:00', sortOrder: 0, active: true,
    updatedAt: '2026-09-25T00:00:00Z', ...over,
  } as LocalSupplement
}

/**
 * RV-183 — the reminder reconcile read the server for a domain the device owns.
 *
 * Supplements are CLAUDE.md's named reference for offline-first, so `/api/supplements` holds
 * whatever has synced while the device holds the truth. Reconciling notifications from the server
 * meant a supplement added or stopped offline scheduled the wrong reminder until the next pull —
 * and it spent two GETs on every launch and every resume to do it.
 */
describe('RV-183 — the local mapping exists once', () => {
  it('carries the dose fields that a second copy dropped on device (BF-112)', () => {
    const [row] = localSupplementsToStatus([def()], [], 'u1')
    expect(row.dosePrompt).toBe(true)
    expect(row.defaultAmount).toBe(5)
    expect(row.unit).toBe('g')
    expect(row.dose).toBe('5 g')
  })

  it('marks what was logged today, and leaves the rest unlogged', () => {
    const logs = [{ id: 'l1', supplementId: 's1', amount: 5, loggedAt: '2026-09-25T08:01:00Z' }] as unknown as LocalSupplementLog[]
    const rows = localSupplementsToStatus([def(), def({ id: 's2', name: 'Vit D' })], logs, 'u1')
    expect(rows.find(r => r.id === 's1')?.loggedToday).toBe(true)
    expect(rows.find(r => r.id === 's2')?.loggedToday).toBe(false)
  })

  it('stamps the userId the caller owns rather than trusting the row', () => {
    expect(localSupplementsToStatus([def()], [], 'u-42')[0].userId).toBe('u-42')
  })

  it('is the ONLY mapping — the hook no longer builds its own', () => {
    // Two copies is how BF-112 happened: the inline one dropped the dose fields, so a prompt that
    // worked on the web never fired on the APK.
    const hook = code('lib/hooks/use-supplements.ts')
    expect(hook).toMatch(/localSupplementsToStatus\(defs, logs, userId!\)/)
    expect(hook).not.toMatch(/dosePrompt: s\.dosePrompt/)
  })
})

describe('RV-183 — the reconcile reads the device first', () => {
  it('the supplement reconcile goes to the local store before the API', () => {
    const src = code('components/sync-provider.tsx')
    expect(src).toMatch(/store\.getSupplements\(\)/)
    expect(src).toMatch(/localSupplementsToStatus\(defs, logs, userId!\)/)
  })

  it('keeps the API as a fallback, so the web and a dead store still reconcile', () => {
    // getLocalStore returns null on the web and whenever the store failed to open. An empty local
    // table is also indistinguishable from an unhydrated one, so it must fall through rather than
    // reconcile against nothing and cancel live reminders.
    const src = code('components/sync-provider.tsx')
    expect(src).toMatch(/if \(defs\.length > 0\)/)
    expect(src).toMatch(/cachedFetchToday\('supplements', '\/api\/supplements'/)
  })
})

describe('RV-183 — the More tab no longer claims a free re-show', () => {
  /**
   * This asserted that NEITHER fetch passed `freshWithinTtl`, as a tripwire: its comment said the flag
   * must not appear until CLAUDE.md's written invalidation proof existed. **The tripwire fired on
   * exactly the change it was watching for, and the proof was then written** — `more-seasons` is a pure
   * read of two stored tables with no writer anywhere in the repo, so it now carries the flag
   * (2026-09-28). The condition was satisfied rather than bypassed, so this narrows to the half that is
   * still unproven instead of being deleted.
   *
   * `app/__tests__/rv183-more-seasons-ttl.test.ts` owns the proof itself and fails if any of it stops
   * holding. What stays here is the part this file has always been about: the More screen's two keys.
   */
  it('still fetches both keys', () => {
    const src = code('app/more/more-content.tsx')
    expect(src).toMatch(/'more-user-profile'/)
    expect(src).toMatch(/'more-seasons'/)
  })

  it('more-user-profile still pays for its re-show, because it has no proof yet', () => {
    // Its payload carries `countWorkoutSessions()` — a derivation no completion-path group clears —
    // so the flag here would be up to 30 minutes of a stale identity block. `LB-180` removes that
    // dead field; until it lands this must keep revalidating.
    const src = code('app/more/more-content.tsx')
    const at = src.indexOf("'more-user-profile', '/api/user/profile'")
    const next = src.indexOf("'more-seasons', '/api/seasons'")
    expect(at).toBeGreaterThan(-1)
    expect(at, 'the two calls swapped order — re-bound this slice').toBeLessThan(next)
    expect(src.slice(at, next), 'see LB-180 before flagging this one').not.toMatch(/freshWithinTtl/)
  })
})
