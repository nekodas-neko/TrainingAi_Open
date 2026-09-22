// LA-128. `Body` was built with `.extend()` and not `.strict()`, so Zod DROPPED a key it did not
// know rather than refusing the body: a sheet posting a field whose server half had not landed got
// 201 and wrote nothing. LB-124 was filed rather than attempted over exactly this — a control that
// looks like it works and stores nothing would have burned TN-58's two-week pass test.
//
// The payloads below are copied from the two live clients so this file also answers the entry's
// open question ("does any current client send an unknown key?") in a form that keeps answering it:
// if someone adds a field to a sheet without the server half, these cases go red.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authMock = vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } }) as unknown)
vi.mock('@/auth', () => ({ auth: () => authMock() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))

// Real parameters, not zero-arg — `.mock.calls[0][1]` types as undefined otherwise, and
// check-rules enforces it.
const saveDayCheckin = vi.fn(async (_userId: string, _checkin: Record<string, unknown>) => ({ id: 'c1' }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({ saveDayCheckin })) }))

import { POST } from '@/app/api/day-checkin/route'

const post = (body: unknown) => POST(new Request('http://x/api/day-checkin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}))

// components/morning-checkin-sheet.tsx:94 — verbatim, plus the `date` it spreads in at the fetch.
const MORNING_SHEET_PAYLOAD = {
  date: '2026-09-22',
  phase: 'morning',
  perceivedRecovery: 3,
  sleepQualityFeel: 4,
  perceivedRecoveryTouched: true,
  sleepQualityFeelTouched: false,
  illnessContext: null,
  vsYesterday: 'better',
  // Retired from the sheet, still sent as null so a re-save clears a historical value — and still
  // in DayCheckinScalesSchema, which is why `.strict()` does not reject them.
  motivation: null,
  restingSoreness: null,
  wakeMood: null,
  soreMuscles: [] as string[],
  journal: null,
}

// components/nutrition/end-of-day/end-of-day-review.tsx:168 — verbatim, plus `date`.
const EVENING_REVIEW_PAYLOAD = {
  date: '2026-09-22',
  phase: 'evening',
  physicalTiredness: 2,
  mentalDrain: 3,
  barelyMoved: 1,
  hydration: 4,
  lateHeavyMeal: 5,
  soreMuscles: ['chest'],
  journal: 'ok day',
}

describe('LA-128 — an unknown key is a 400, not a silent strip', () => {
  beforeEach(() => { saveDayCheckin.mockClear() })

  it('rejects a field the server has not learned yet, and writes nothing', async () => {
    const res = await post({ ...MORNING_SHEET_PAYLOAD, moodAfterCoffee: 4 })
    expect(res.status).toBe(400)
    expect(saveDayCheckin).not.toHaveBeenCalled()
  })

  it('names the unknown key, so the cause is in the response', async () => {
    // "Invalid body" alone sends the developer looking at the VALUES they sent rather than the key.
    const res = await post({ ...MORNING_SHEET_PAYLOAD, moodAfterCoffee: 4 })
    expect((await res.json()).error).toBe('Unknown field(s): moodAfterCoffee')
  })

  it('names every unknown key, not just the first', async () => {
    const res = await post({ ...MORNING_SHEET_PAYLOAD, alpha: 1, beta: 2 })
    const { error } = await res.json()
    expect(error).toContain('alpha')
    expect(error).toContain('beta')
  })

  it('still says Invalid body when the failure is a VALUE, not a key', async () => {
    // The strict branch must not swallow the ordinary validation failures that were there before.
    const res = await post({ ...MORNING_SHEET_PAYLOAD, perceivedRecovery: 99 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid body')
  })

  it('accepts the morning sheet payload exactly as that component builds it', async () => {
    expect((await post(MORNING_SHEET_PAYLOAD)).status).toBe(201)
    expect(saveDayCheckin).toHaveBeenCalledTimes(1)
    expect(saveDayCheckin.mock.calls[0][1]).toMatchObject({ phase: 'morning', perceivedRecovery: 3 })
  })

  it('accepts the evening review payload exactly as that component builds it', async () => {
    expect((await post(EVENING_REVIEW_PAYLOAD)).status).toBe(201)
    expect(saveDayCheckin).toHaveBeenCalledTimes(1)
    expect(saveDayCheckin.mock.calls[0][1]).toMatchObject({ phase: 'evening', physicalTiredness: 2 })
  })

  it('still defaults phase to evening when it is omitted', async () => {
    // `.strict()` must not disturb the default — the evening review relies on it historically.
    const { phase: _drop, ...noPhase } = EVENING_REVIEW_PAYLOAD
    expect((await post(noPhase)).status).toBe(201)
    expect(saveDayCheckin.mock.calls[0][1]).toMatchObject({ phase: 'evening' })
  })
})
