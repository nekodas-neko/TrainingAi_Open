// A live step window OVERRIDES the ring's own step model for the span it covers, so an impossible
// count does not merely add noise — it replaces good data. On 2026-07-28 a window claiming 3,605
// steps in 13 minutes (289/min) turned a real 1,578-step day into a displayed 4,903.
//
// The route now rejects a count above the gait detector's own cadence ceiling. These tests drive the
// real handler. Four of the five need no database — the rejection happens before any repo call — but
// the fifth deliberately gets past validation and therefore does reach one; see its own note.
import { describe, it, expect, vi, beforeAll } from 'vitest'

// Unique to this file. Sharing an id with another DB-touching test file lets the two delete each
// other's rows in parallel workers — `scripts/check-test-user-ids.js` keeps them distinct.
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d0a1'

const canRun = !!process.env.DATABASE_URL

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } })),
}))

// Imported in a hook, not inside `post()`. Resolving this route's module graph costs ~4.2 s, and
// with the import inside the helper that whole cost was billed to whichever test called it first —
// against vitest's 5 s per-test default. Measured: the first test took 4162 ms while the other four
// took 1–31 ms, so the file failed 2 runs in 10 on its own and 5 in 10 alongside two other files.
// Hooks have their own (10 s) budget, so the same work no longer sits 16% under a timeout.
let POST: (req: never) => Promise<Response>
beforeAll(async () => {
  ({ POST } = await import('../route'))
  if (!canRun) return

  // The route allows 20 calls/minute keyed on the user id, and the limiter's L2 is the
  // `rate_limits` **table** — so the bucket outlives the process and the run. Five requests per
  // run means four runs inside a minute start returning 429, which is what turned the timeout
  // above into a second, unrelated flake once the import was fast enough to expose it.
  //
  // BOTH layers have to go, in this order. `flushKey` treats the DB as authoritative and raises
  // L1's count back to the DB's, and the flush is fire-and-forget — so clearing L1 alone passes on
  // a fast machine and fails on a slow one, and a late flush re-creates the row after the DELETE.
  const { _resetRateLimitL1, _awaitRateLimitFlushes } = await import('@/lib/rate-limit')
  const { getPool } = await import('@/lib/data/postgres/client')
  await _awaitRateLimitFlushes()
  _resetRateLimitL1()
  await getPool().query(`DELETE FROM rate_limits WHERE key = $1`, [`oura-ble-live-steps:${TEST_USER_ID}`])
})

const post = async (body: unknown) =>
  POST(new Request('http://localhost/api/oura-ble/live-steps', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never)

describe('POST /api/oura-ble/live-steps — implausible cadence', () => {
  it('rejects the real window that caused the over-count (ds form)', async () => {
    // 3,605 steps over 7,496 ds = 12.5 min → 289 steps/min.
    const res = await post({ startDs: 19568972, endDs: 19576468, steps: 3605 })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('implausible_cadence')
  })

  it('rejects the worst stored window (1,145 steps/min)', async () => {
    const res = await post({ startDs: 16166442, endDs: 16167341, steps: 1716 })
    expect(res.status).toBe(400)
  })

  it('rejects an impossible wall-clock window before it needs a clock anchor', async () => {
    // Deliberately checked ahead of the anchor lookup: a bad window is invalid regardless of whether
    // the ring has ever synced, and the response must not depend on account state.
    const res = await post({
      startedAt: '2026-07-28T00:00:00.000Z',
      endedAt: '2026-07-28T00:10:00.000Z',
      steps: 5000, // 500/min
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('implausible_cadence')
  })

  it.skipIf(!canRun)('does not reject a brisk but real walk', async () => {
    // 1,400 steps in 10 min = 140/min — comfortably under the ceiling. It gets past validation and
    // fails later (no clock anchor for this synthetic user), which is what proves the gate let it by.
    // Getting that far means reaching `getOuraClockAnchor`, so this one test needs a real database —
    // without the gate it threw `DATABASE_URL is not set` instead of skipping, like its siblings do.
    const res = await post({
      startedAt: '2026-07-28T00:00:00.000Z',
      endedAt: '2026-07-28T00:10:00.000Z',
      steps: 1400,
    })
    expect(res.status).not.toBe(400)
  })

  it('still rejects a malformed body on the schema, not the cadence gate', async () => {
    const res = await post({ startDs: 100, endDs: 50, steps: 10 })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBeUndefined()
  })
})
