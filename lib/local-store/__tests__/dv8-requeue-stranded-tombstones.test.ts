// DV-8 — heal the food-log DELETE tombstones already stranded at `pending`.
//
// Source-level for the same reason as its siblings: both vitest projects run in `node`, where
// `getLocalStore` returns null, so there is no local SQLite to drive. The device half is DV-8's
// own pass test (zero `pending` rows in `food_logs` against an empty outbox, on the S25).
//
// Measured on the S25 (sweep 4b, 2026-09-26): 36 rows stuck `pending` with both outboxes empty,
// every one a delete tombstone, spread over 14 days. The cause — `pushMutations` clearing the
// batch's outbox entries before running an unguarded per-domain confirm loop — is fixed, but the
// fix reaches nothing already stranded: no outbox entry means no retry, and `applyDelta` only
// overwrites `synced` rows.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const backend = read('lib/local-store/sqlite-backend.ts')
const engine = read('lib/local-store/sync-engine.ts')

/** The body of a named function, so a match cannot be satisfied by a different one in the file. */
function fnBody(src: string, signature: string): string {
  const i = src.indexOf(signature)
  expect(i, `${signature} not found`).toBeGreaterThan(-1)
  const rest = src.slice(i)
  const end = rest.indexOf('\n  }\n')
  return rest.slice(0, end === -1 ? rest.length : end)
}

describe('DV-8 — the sweep re-queues stranded tombstones', () => {
  const body = fnBody(backend, 'async requeueStrandedFoodTombstones(userId: string, cutoffIso: string)')

  it('selects only DELETE tombstones that are still pending', () => {
    // Both halves matter. Without `deleted_at IS NOT NULL` the sweep would also re-queue ordinary
    // pending logs, which the outbox is already responsible for; without `pending` it would
    // re-push every tombstone the device has ever written.
    expect(body).toMatch(/sync_status='pending'/)
    expect(body).toMatch(/deleted_at IS NOT NULL/)
  })

  it('skips any row that still has an outbox entry, scoped to this user and domain', () => {
    expect(body).toMatch(/NOT EXISTS/)
    expect(body).toMatch(/mutations_outbox/)
    expect(body).toMatch(/mo\.user_id = \?/)
    expect(body).toMatch(/mo\.domain='food_logs'/)
  })

  it('honours the grace period, so a push still in flight is not swept', () => {
    // A row mid-push has no outbox entry either, for that moment. Sweeping it queues a duplicate.
    expect(body).toMatch(/updated_at < \?/)
  })

  /**
   * THE load-bearing assertion, and the reason this is a sweep rather than a one-line UPDATE.
   *
   * A stranded tombstone is indistinguishable from one whose mutation was never queued at all.
   * Marking it `synced` drops a delete the server may never have seen — the food comes back on the
   * next device, with its calories. Re-pushing is free: the server arm soft-deletes by id, so a
   * second delete of an already-deleted row is a no-op.
   */
  it('NEVER marks the row synced — it writes to the outbox, not to food_logs', () => {
    expect(body).toMatch(/INSERT INTO mutations_outbox/)
    expect(body).not.toMatch(/UPDATE food_logs/)
    expect(body).not.toMatch(/sync_status='synced'/)
    expect(body).not.toMatch(/markFoodLogSynced/)
  })

  it('queues the payload the server delete arm reads — an id and the deleted flag', () => {
    // `lib/data/postgres/adapter.ts`'s food_logs arm branches on `p.deleted` and calls
    // `deleteFoodLog(String(p.id), userId)`. It reads no other field, and not the date.
    // Matched loosely on purpose: a mutation pass that merely renamed the loop variable killed
    // the tighter form, which pinned the identifier rather than the behaviour.
    expect(body).toMatch(/deleted: true/)
    expect(body).toMatch(/JSON\.stringify\(\{\s*id: String\(\w+\.id\)/)
  })

  it('carries the row\'s own date, not today, so the outbox row reads honestly', () => {
    expect(body).toMatch(/'food_logs',\s*String\(\w+\.date\)/)
  })
})

describe('DV-8 — the sweep runs where the other heals run', () => {
  it('is called from pushMutations, guarded, before the outbox drains', () => {
    const push = engine.slice(engine.indexOf('export async function pushMutations'))
    const call = push.indexOf('requeueStrandedFoodTombstones')
    const drain = push.indexOf('const pending = await store.getPendingMutations')
    expect(call).toBeGreaterThan(-1)
    expect(call).toBeLessThan(drain)
    // Best-effort like its two siblings: a failing heal must not stop the queue draining.
    expect(push.slice(call - 200, call + 200)).toMatch(/catch/)
  })

  it('shares one cutoff with the workout sweep rather than computing a second', () => {
    // Two independently-computed cutoffs drift apart under a slow sweep, and the later one can
    // then see a row the earlier one has just queued.
    const push = engine.slice(engine.indexOf('export async function pushMutations'))
    expect(push).toMatch(/const strandedCutoff = /)
    expect((push.match(/5 \* 60_000/g) ?? []).length).toBe(1)
  })
})
