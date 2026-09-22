// `POST /api/day-checkin` with a body of exactly `{}` returned 201 and wrote a row with every
// metric null (Q-465) — indistinguishable from a real check-in in which the user answered nothing.
// Verified by mutation: removing the guard from the route fails the first three cases.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authMock = vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } }) as unknown)
vi.mock('@/auth', () => ({ auth: () => authMock() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))

// Declared with its real parameters, not zero-arg: the assertions below read
// `saveDayCheckin.mock.calls[0][1]` to check WHAT was written, and a zero-arg declaration types
// that as undefined while the runtime quietly hands back the object — a test that looks like it
// inspects the write and cannot.
const saveDayCheckin = vi.fn(async (_userId: string, _checkin: Record<string, unknown>) => ({ id: 'c1' }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({ saveDayCheckin })) }))

import { POST } from '@/app/api/day-checkin/route'

const post = (body: unknown) => POST(new Request('http://x/api/day-checkin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}))

describe('POST /api/day-checkin — a check-in has to say something', () => {
  beforeEach(() => { saveDayCheckin.mockClear() })

  it('refuses an empty body, and writes nothing', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Check-in carries no answers')
    expect(saveDayCheckin).not.toHaveBeenCalled()
  })

  it('refuses a body that is only addressing', async () => {
    expect((await post({ phase: 'morning', date: '2026-08-23' })).status).toBe(400)
    expect(saveDayCheckin).not.toHaveBeenCalled()
  })

  it('refuses the touched flags on their own', async () => {
    expect((await post({ perceivedRecoveryTouched: true, sleepQualityFeelTouched: true })).status).toBe(400)
    expect(saveDayCheckin).not.toHaveBeenCalled()
  })

  it('accepts what the morning sheet sends', async () => {
    const res = await post({
      phase: 'morning', perceivedRecovery: 3, sleepQualityFeel: 3,
      perceivedRecoveryTouched: false, sleepQualityFeelTouched: false,
      illnessContext: null, motivation: null, restingSoreness: null, wakeMood: null,
      soreMuscles: [], journal: null,
    })
    expect(res.status).toBe(201)
    expect(saveDayCheckin).toHaveBeenCalledTimes(1)
  })

  it('accepts a journal with no scales at all', async () => {
    expect((await post({ journal: 'slept badly' })).status).toBe(201)
    expect(saveDayCheckin).toHaveBeenCalledTimes(1)
  })
})

/**
 * TN-57 — the row still writes, and the columns stop lying.
 *
 * The entry's instruction was to make a body carrying only untouched defaults count as carrying no
 * answers. That would have dropped the check-in: the morning sheet sends nothing else that counts
 * as an answer, so every untouched save would 400 — and `pushMutations` rejects the same body as a
 * poison pill with no retry, while the sheet re-prompts until a row exists for the day. So the
 * Q-465 guard reads the SUBMITTED body and the nulling applies to what is STORED. "The lifter
 * opened the sheet and had no opinion" is a fact worth keeping; "the lifter reported 3" is not.
 */
describe('POST /api/day-checkin — an untouched scale is stored as null (TN-57)', () => {
  beforeEach(() => { saveDayCheckin.mockClear() })

  const sheetPayload = (over: Record<string, unknown> = {}) => ({
    phase: 'morning', perceivedRecovery: 3, sleepQualityFeel: 3,
    perceivedRecoveryTouched: false, sleepQualityFeelTouched: false,
    illnessContext: null, motivation: null, restingSoreness: null, wakeMood: null,
    soreMuscles: [], journal: null,
    ...over,
  })
  const written = () => saveDayCheckin.mock.calls[0][1]

  it('still writes the row — the guard runs before the nulling, not after', async () => {
    expect((await post(sheetPayload())).status).toBe(201)
    expect(saveDayCheckin).toHaveBeenCalledTimes(1)
  })

  it('stores null for both untouched scales', async () => {
    await post(sheetPayload())
    expect(written().perceivedRecovery).toBeNull()
    expect(written().sleepQualityFeel).toBeNull()
  })

  it('keeps the flags themselves, which are how the 78 existing rows stay distinguishable', async () => {
    await post(sheetPayload())
    expect(written().perceivedRecoveryTouched).toBe(false)
    expect(written().sleepQualityFeelTouched).toBe(false)
  })

  it('stores a scale the lifter actually moved', async () => {
    await post(sheetPayload({ perceivedRecovery: 5, perceivedRecoveryTouched: true }))
    expect(written().perceivedRecovery).toBe(5)
    expect(written().sleepQualityFeel).toBeNull()
  })

  /** The seeded value is 3, so a genuinely-answered 3 is the case a value-based check gets wrong. */
  it('stores a touched 3', async () => {
    await post(sheetPayload({ perceivedRecoveryTouched: true }))
    expect(written().perceivedRecovery).toBe(3)
  })

  /** Only these two scales carry a flag; nothing else on the check-in may be nulled by this. */
  it('leaves the flagless scales alone', async () => {
    await post(sheetPayload({ phase: 'evening', physicalTiredness: 4, hydration: 2 }))
    expect(written().physicalTiredness).toBe(4)
    expect(written().hydration).toBe(2)
  })
})

/**
 * LB-124 / TN-58 — the comparative answer reaches the column, and counts as an answer.
 *
 * The entry filed this rather than attempting it because the failure mode is silent: `Body` is not
 * `.strict()`, so before the field existed in the schema, a sheet posting `vsYesterday` got **201**
 * and wrote nothing. A control that looks like it works and stores nothing is worse than a 400 —
 * it would burn TN-58's two-week pass test and report "no self-report available from this owner"
 * when the truth was a dropped field.
 */
describe('POST /api/day-checkin — the comparative answer (LB-124)', () => {
  beforeEach(() => { saveDayCheckin.mockClear() })
  const written = () => saveDayCheckin.mock.calls[0][1]

  it('stores the answer rather than silently dropping it', async () => {
    const res = await post({ phase: 'morning', vsYesterday: 'worse' })
    expect(res.status).toBe(201)
    expect(written().vsYesterday).toBe('worse')
  })

  /**
   * The load-bearing one. TN-58's control REPLACES the absolute scale rather than joining it, so a
   * check-in whose only answer is this one is the expected shape. Without `vsYesterday` in
   * `dayCheckinHasAnswers` that body carries "no answers" — a 400 here, and in `pushMutations` a
   * per-item rejection with no retry, which drops the check-in permanently.
   */
  it('counts on its own, with no other answer in the body', async () => {
    expect((await post({ phase: 'morning', vsYesterday: 'same' })).status).toBe(201)
    expect(saveDayCheckin).toHaveBeenCalledTimes(1)
  })

  it('stores null when the question was skipped — there is no neutral', async () => {
    await post({ phase: 'morning', journal: 'nothing to add' })
    expect(written().vsYesterday).toBeNull()
  })

  it('refuses a value outside the three, rather than storing it', async () => {
    expect((await post({ phase: 'morning', vsYesterday: 'much better' })).status).toBe(400)
    expect(saveDayCheckin).not.toHaveBeenCalled()
  })

  /** An explicit null is a skip, not an answer — it must not satisfy the guard by itself. */
  it('treats an explicit null as no answer at all', async () => {
    expect((await post({ phase: 'morning', vsYesterday: null })).status).toBe(400)
    expect(saveDayCheckin).not.toHaveBeenCalled()
  })

  it('rides alongside the scales when both are given', async () => {
    await post({ phase: 'morning', perceivedRecovery: 2, perceivedRecoveryTouched: true, vsYesterday: 'better' })
    expect(written().vsYesterday).toBe('better')
    expect(written().perceivedRecovery).toBe(2)
  })
})
