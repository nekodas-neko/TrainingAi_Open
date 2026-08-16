// Q-22 §1: the chunk's Tier-2 window was derived from `magnitudes.length / sampleRate` — the
// duration of the SAMPLES — while the client flushes on wall clock. The accel stream gaps by design
// (firmware time-boxes it at ~5 min, a 90 s stall watchdog re-arms it, a reconnect re-arms it), so
// a chunk occupying 120 s of wall clock routinely holds 40-90 s of samples. That placed the chunk's
// steps minutes before they happened and surrendered the rest of the span back to the model, which
// then counted the same minutes again.
//
// Same shape as the 2026-07-28 live-window over-count: a count from one stream, a window from
// another. The client now sends its real `endedAt`.
//
// These assert the WINDOW WRITTEN, not the plausibility flag — the gait counter's refractory caps
// cadence against its own samples, so a too-short window never reads as implausible. Checking the
// flag would have passed with or without the fix.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const TEST_USER_ID = '00000000-0000-4000-8000-00000000d019'
const ANCHOR_DS = 1_000_000
const ANCHOR_UTC = new Date('2026-07-29T00:00:00.000Z')

const upsertStepLiveWindow = vi.fn(async () => ({}))

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: vi.fn(async () => ({
    insertOuraAccelChunk: vi.fn(async () => ({ inserted: true })),
    getOuraClockAnchor: vi.fn(async () => ({ anchorDs: ANCHOR_DS, anchorUtc: ANCHOR_UTC })),
    upsertStepLiveWindow,
  })),
}))

const RATE = 50
const SAMPLE_SEC = 60

/** A walking-cadence magnitude train the gait gate accepts, so a window is actually written. */
const walkingMagnitudes = (seconds: number): number[] => {
  const out: number[] = []
  for (let i = 0; i < RATE * seconds; i++) out.push(i % 25 === 0 ? 1400 : 900)
  return out
}

const post = async (body: unknown) => {
  const { POST } = await import('../route')
  return POST(new Request('http://localhost/api/oura-ble/accel-chunks', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never)
}

/** ds span of the window the route wrote, in seconds. */
const writtenSpanSec = (): number => {
  expect(upsertStepLiveWindow).toHaveBeenCalled()
  const w = upsertStepLiveWindow.mock.calls.at(-1)![1] as { startDs: number; endDs: number }
  return (w.endDs - w.startDs) / 10
}

describe('POST /api/oura-ble/accel-chunks — window span', () => {
  // Relative to now: the route rejects a chunk claiming to start more than 60 s in the future or
  // more than 7 days ago, so a hardcoded date would fail with the clock rather than the logic.
  const startMs = Date.now() - 10 * 60_000
  const startedAt = new Date(startMs).toISOString()
  const at = (offsetMs: number) => new Date(startMs + offsetMs).toISOString()

  beforeEach(() => { upsertStepLiveWindow.mockClear() })

  it('spans the wall clock the samples were collected over, not the sample duration', async () => {
    // 60 s of samples spread across 120 s of wall clock — a mid-chunk stream gap.
    const res = await post({
      startedAt, endedAt: at(120_000), sampleRate: RATE, magnitudes: walkingMagnitudes(SAMPLE_SEC),
    })
    expect(res.status).toBe(200)
    // The defect wrote 60 s here. The window must cover the real 120 s the steps happened across.
    expect(writtenSpanSec()).toBeCloseTo(120, 0)
  })

  it('falls back to the sample duration when an older client omits endedAt', async () => {
    const res = await post({ startedAt, sampleRate: RATE, magnitudes: walkingMagnitudes(SAMPLE_SEC) })
    expect(res.status).toBe(200)
    expect(writtenSpanSec()).toBeCloseTo(SAMPLE_SEC, 0)
  })

  it('never lets a backwards client clock shrink the window below its own samples', async () => {
    const res = await post({
      startedAt, endedAt: at(-3_600_000), sampleRate: RATE, magnitudes: walkingMagnitudes(SAMPLE_SEC),
    })
    expect(res.status).toBe(200)
    // max(sampleDerived, client) — the sample duration is a floor, so a bad clock cannot produce a
    // window shorter than the data it holds (which would read as an impossible cadence).
    expect(writtenSpanSec()).toBeCloseTo(SAMPLE_SEC, 0)
  })

  it('rejects a garbage endedAt on the schema, so no NaN reaches the window math', async () => {
    const res = await post({
      startedAt, endedAt: 'not-a-date', sampleRate: RATE, magnitudes: walkingMagnitudes(SAMPLE_SEC),
    })
    expect(res.status).toBe(400)
    expect(upsertStepLiveWindow).not.toHaveBeenCalled()
  })
})
