/**
 * PS-39 — the three routes that decide what a nutrition DAY means:
 * `food-logging-complete`, `nutrition/plan-meal-answers` and `nutrition/dietary-restrictions`.
 *
 * Batched because each one answers a different half of the same question — *is this day's food
 * record finished, and what was deliberately not eaten* — and each carries a decision the response
 * shape hides:
 *
 *   · **`food-logging-complete` writes ONE field into a row it does not own.** `saveDayCheckin`
 *     overwrites every column it is handed a value for, so the route reads the evening check-in
 *     first and passes all fourteen of its fields back through untouched. Dropping any one of them
 *     silently erases a wellness answer the user typed, and the response body — which reports only
 *     the date and the flag — would look correct either way.
 *   · **`complete: false` is the Undo**, and it has to reach `null` rather than a falsy date: the
 *     maintenance calibration reads null as EXCLUDED, so a day marked by accident poisons the
 *     estimate until it can be unmarked.
 *   · **The response reports what was STORED, not what was asked for.** `complete` is derived from
 *     the saved row, so a write the repository refused cannot read back as done.
 *   · **`plan-meal-answers` answers 404 identically for "not yours" and "no such meal"**, which is
 *     what stops the route from being used to enumerate real plan-meal ids.
 *   · **Both date routes accept BOTH separators.** The client fills these params from
 *     `localDateString()`, which emits `YYYY/MM/DD`; a dash-only regex rejects every real request
 *     with a Zod error before the handler runs, which is how ai-chat's `localDate` shipped dead for
 *     a full release.
 *   · **`dietary-restrictions` PUT replaces the whole set**, so its caps are the only thing standing
 *     between a picker bug and an unbounded write.
 *
 * Fixture discipline (the PS-39 note): every case fails on the ONE rule it names and satisfies the
 * others, so a guard cannot be deleted while a different guard rejects the input on its behalf. The
 * passthrough fixture below takes that further — see the comment on `EXISTING`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

type Row = Record<string, unknown>

const getDayCheckin = vi.fn(async (..._a: unknown[]) => null as Row | null)
const saveDayCheckin = vi.fn(async (..._a: unknown[]) => ({}) as Row)
const listPlanMealAnswers = vi.fn(async (..._a: unknown[]) => [] as Row[])
const savePlanMealAnswer = vi.fn(async (..._a: unknown[]) => ({ id: 'a-1' }) as Row | null)
const deletePlanMealAnswer = vi.fn(async (..._a: unknown[]) => true)
const listDietaryRestrictions = vi.fn(async () => [] as Row[])
const listUserDietaryRestrictions = vi.fn(async (_u: string) => [] as Row[])
const replaceUserDietaryRestrictions = vi.fn(async (..._a: unknown[]) => [] as Row[])

// Controllable rather than stubbed to `true`: the 429 is a case here, and a blanket-true mock is
// exactly the shape that makes a rate limit untestable while looking tested.
const rateLimit = vi.fn((..._a: unknown[]) => true)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    getDayCheckin, saveDayCheckin,
    listPlanMealAnswers, savePlanMealAnswer, deletePlanMealAnswer,
    listDietaryRestrictions, listUserDietaryRestrictions, replaceUserDietaryRestrictions,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { POST as postComplete } from '@/app/api/food-logging-complete/route'
import {
  GET as getAnswers, POST as postAnswer, DELETE as deleteAnswer,
} from '@/app/api/nutrition/plan-meal-answers/route'
import {
  GET as getRestrictions, PUT as putRestrictions,
} from '@/app/api/nutrition/dietary-restrictions/route'

const PLAN_MEAL = '00000000-0000-4000-8000-0000000000b1'
const ANSWER_ID = '00000000-0000-4000-8000-0000000000b2'
const RESTRICTION = '00000000-0000-4000-8000-0000000000b3'

const jsonReq = (method: string, body: unknown, url = 'http://localhost/x') =>
  new Request(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never

const complete = (body: unknown) => postComplete(jsonReq('POST', body))
// A real `NextRequest`: the GET reads `req.nextUrl`, which a plain `Request` does not have — it
// throws before any guard runs, so every case would "pass" a status check that never happened.
const answersFor = (query: string) =>
  getAnswers(new NextRequest(`http://localhost/api/nutrition/plan-meal-answers${query}`))
const putRestr = (body: unknown) => putRestrictions(jsonReq('PUT', body))

beforeEach(() => {
  for (const m of [getDayCheckin, saveDayCheckin, listPlanMealAnswers, savePlanMealAnswer,
                   deletePlanMealAnswer, listDietaryRestrictions, listUserDietaryRestrictions,
                   replaceUserDietaryRestrictions, rateLimit]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getDayCheckin.mockResolvedValue(null)
  saveDayCheckin.mockImplementation(async (_u: unknown, c: Row) => ({ ...c }))
  savePlanMealAnswer.mockResolvedValue({ id: ANSWER_ID })
  deletePlanMealAnswer.mockResolvedValue(true)
  sessionUser = { id: 'u-1' }
})
afterEach(() => { vi.useRealTimers() })

describe('POST /api/food-logging-complete', () => {
  /**
   * **Every field carries a DIFFERENT value, and that is the point of the fixture.**
   *
   * The route's job is to hand fourteen existing values back to `saveDayCheckin` unchanged while
   * replacing one. If the scales all held the same number, swapping two of them — or reading
   * `hydration` where `mentalDrain` was meant — would produce an identical call and the test would
   * pass. This is the fixture trap in its general form: *when two quantities are equal in your
   * fixture, nothing that reads either one is under test.*
   *
   * The two `*Touched` booleans are `true` for the same reason. The route writes
   * `existing?.x ?? false`, so a fixture holding `false` cannot tell the passthrough from the
   * fallback — both produce `false`.
   */
  const EXISTING = {
    physicalTiredness: 1, mentalDrain: 2, barelyMoved: 3, hydration: 4, lateHeavyMeal: 5,
    wakeMood: 2, perceivedRecovery: 4, motivation: 1, sleepQualityFeel: 5, restingSoreness: 3,
    illnessContext: 'alcohol',
    perceivedRecoveryTouched: true, sleepQualityFeelTouched: true,
    soreMuscles: ['quads', 'lats'],
    journal: 'Long day, ate late.',
  }

  it('preserves every field of the evening check-in it is writing one flag into', async () => {
    getDayCheckin.mockResolvedValue({ ...EXISTING, logDate: '2026-03-05', phase: 'evening' })
    await complete({ date: '2026-03-05', complete: true })

    const [, written] = saveDayCheckin.mock.calls[0] as [string, Row]
    // `toMatchObject` over each key rather than a whole-object compare: the route also sets
    // logDate/phase/foodLoggingCompletedAt, and an equality check here would have to restate them
    // and would then pass even if a passthrough field went missing from the schema.
    for (const [key, value] of Object.entries(EXISTING)) {
      expect(written[key], `${key} was not carried through`).toEqual(value)
    }
  })

  it('reads the row it is about to overwrite, for the same day and phase it writes', async () => {
    await complete({ date: '2026-03-05', complete: true })
    expect(getDayCheckin).toHaveBeenCalledWith('u-1', '2026-03-05', 'evening')
    const [userId, written] = saveDayCheckin.mock.calls[0] as [string, Row]
    expect(userId).toBe('u-1')
    expect(written.logDate).toBe('2026-03-05')
    expect(written.phase).toBe('evening')
  })

  it('falls back per field when there is no check-in yet, rather than writing undefined', async () => {
    getDayCheckin.mockResolvedValue(null)
    await complete({ date: '2026-03-05', complete: true })
    const [, written] = saveDayCheckin.mock.calls[0] as [string, Row]
    expect(written.physicalTiredness).toBeNull()
    expect(written.perceivedRecoveryTouched).toBe(false)
    expect(written.soreMuscles).toEqual([])
    expect(written.journal).toBeNull()
  })

  it('unmarks a day by writing null, because the calibration reads null as excluded', async () => {
    getDayCheckin.mockResolvedValue({ ...EXISTING, foodLoggingCompletedAt: new Date('2026-03-05T09:00:00Z') })
    await complete({ date: '2026-03-05', complete: false })
    const [, written] = saveDayCheckin.mock.calls[0] as [string, Row]
    // Null exactly — a falsy date, or the field simply omitted, both leave the poisoned day counted:
    // `saveDayCheckin` only overwrites a column it is given a value for.
    expect(written.foodLoggingCompletedAt).toBeNull()
  })

  it('marks a day with the current instant', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-05T09:30:00Z'))
    await complete({ date: '2026-03-05', complete: true })
    const [, written] = saveDayCheckin.mock.calls[0] as [string, Row]
    expect(written.foodLoggingCompletedAt).toEqual(new Date('2026-03-05T09:30:00Z'))
  })

  it('reports what was stored, not what was asked for', async () => {
    // A repository that refused the flag must not read back as done — the client renders this
    // response directly, and a client that believes the day is complete stops offering the button.
    saveDayCheckin.mockResolvedValue({ foodLoggingCompletedAt: null })
    const res = await complete({ date: '2026-03-05', complete: true })
    expect(await res.json()).toMatchObject({ date: '2026-03-05', complete: false, completedAt: null })
  })

  it("defaults the day to the USER's timezone, not the server's and not the default", async () => {
    // 2026-03-10T20:00Z is the 10th at 15:00 in UTC-5 and already the 11th in Brisbane, so the two
    // answers differ and the assertion can tell which zone was read. A fixture whose timezone IS
    // `DEFAULT_TZ` proves nothing about that — it is the same trap as the equal-values one above.
    expect(DEFAULT_TZ).toBe('Australia/Brisbane')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-10T20:00:00Z'))

    sessionUser = { id: 'u-1', timezone: 'Etc/GMT+5' }
    await complete({ complete: true })
    expect((saveDayCheckin.mock.calls[0][1] as Row).logDate).toBe('2026-03-10')

    saveDayCheckin.mockClear()
    sessionUser = { id: 'u-1' }
    await complete({ complete: true })
    expect((saveDayCheckin.mock.calls[0][1] as Row).logDate).toBe('2026-03-11')
  })

  it('accepts the slash date the client actually sends, and normalises it', async () => {
    await complete({ date: '2026/03/05', complete: true })
    expect(getDayCheckin).toHaveBeenCalledWith('u-1', '2026-03-05', 'evening')
    expect((saveDayCheckin.mock.calls[0][1] as Row).logDate).toBe('2026-03-05')
  })

  it('refuses without a session, over the rate limit, and on a body it cannot trust', async () => {
    sessionUser = null
    expect((await complete({ complete: true })).status).toBe(401)

    sessionUser = { id: 'u-1' }
    rateLimit.mockReturnValue(false)
    expect((await complete({ complete: true })).status).toBe(429)

    rateLimit.mockReturnValue(true)
    // Each of these fails on ONE rule: a missing `complete`, a non-boolean `complete`, a malformed
    // date, and an extra key the strict schema does not know.
    for (const body of [
      {},
      { complete: 'yes' },
      { date: '05-03-2026', complete: true },
      { complete: true, phase: 'morning' },
    ]) {
      saveDayCheckin.mockClear()
      expect((await complete(body)).status, JSON.stringify(body)).toBe(400)
      expect(saveDayCheckin).not.toHaveBeenCalled()
    }
    expect(getDayCheckin).not.toHaveBeenCalled()
  })

  it('checks the session before the rate limit, so an anonymous flood cannot spend a real bucket', async () => {
    sessionUser = null
    await complete({ complete: true })
    expect(rateLimit).not.toHaveBeenCalled()
  })
})

describe('/api/nutrition/plan-meal-answers', () => {
  it('reads a day for the caller only', async () => {
    listPlanMealAnswers.mockResolvedValue([{ id: ANSWER_ID }])
    const res = await answersFor('?date=2026-03-05')
    expect(res.status).toBe(200)
    // **Slashes, and that is what the route really does.** `normalizeDateParam` validates the day
    // and returns `YYYY/MM/DD`; only its `…Iso` sibling converts. Harmless here because `log_date`
    // is a Postgres `date`, so the literal is cast on the way in and read back as dashes either way
    // — but the sync-push branch for this same domain normalises to dashes before calling the very
    // same slice function, so the two write paths agree only by virtue of that cast. Pinned as-is
    // rather than "corrected": changing it is a behaviour change, not a test fix.
    expect(listPlanMealAnswers).toHaveBeenCalledWith('u-1', '2026/03/05')
    expect(await res.json()).toEqual({ answers: [{ id: ANSWER_ID }] })
  })

  it('accepts the slash date the client actually sends', async () => {
    // `localDateString()` emits slashes; a dash-only regex here would reject every real request
    // with a Zod error before the handler ran, which is how ai-chat's `localDate` shipped dead.
    await answersFor('?date=2026/03/05')
    expect(listPlanMealAnswers).toHaveBeenCalledWith('u-1', '2026/03/05')
  })

  it('rejects a date that is well-formed but not a real day', async () => {
    // `2026-02-31` passes the regex and fails the calendar — the case the regex alone cannot catch,
    // and the shape that 500'd several routes with `RangeError: Invalid time value`.
    expect((await answersFor('?date=2026-02-31')).status).toBe(400)
    expect((await answersFor('?date=2026-13-01')).status).toBe(400)
    expect((await answersFor('?date=not-a-date')).status).toBe(400)
    expect((await answersFor('')).status).toBe(400)
    expect(listPlanMealAnswers).not.toHaveBeenCalled()
  })

  it('records a decline against the caller, keeping the client-minted id for outbox replay', async () => {
    // **Dashes in, slashes out — and the input has to be the form that DIFFERS from the output.**
    // A `2026/03/05` here would be normalised to itself, so `normalizeDateParam(x)` and a bare `x`
    // produce the same call and nothing decides whether the route normalises at all. The mutation
    // pass proved that: dropping the normalisation from DELETE survived a slash-in fixture.
    const res = await postAnswer(jsonReq('POST', { id: ANSWER_ID, planMealId: PLAN_MEAL, logDate: '2026-03-05' }))
    expect(res.status).toBe(200)
    expect(savePlanMealAnswer).toHaveBeenCalledWith('u-1', {
      id: ANSWER_ID, planMealId: PLAN_MEAL, logDate: '2026/03/05',
    })
  })

  it('answers 404 with nothing that distinguishes "not yours" from "no such meal"', async () => {
    // The repository collapses both to null, and the route must not re-open the distinction: a
    // different status or a message naming the meal would turn this into an id oracle.
    savePlanMealAnswer.mockResolvedValue(null)
    const res = await postAnswer(jsonReq('POST', { planMealId: PLAN_MEAL, logDate: '2026-03-05' }))
    expect(res.status).toBe(404)
    const body = await res.text()
    expect(body).not.toContain(PLAN_MEAL)
  })

  it('deletes for the caller, normalising the day the same way the write did', async () => {
    // Dashes in for the same reason as the POST above: the undo has to key off the identical string
    // the decline was stored under, and a fixture where both spellings coincide cannot show it.
    deletePlanMealAnswer.mockResolvedValue(false)
    const res = await deleteAnswer(jsonReq('DELETE', { planMealId: PLAN_MEAL, logDate: '2026-03-05' }))
    expect(deletePlanMealAnswer).toHaveBeenCalledWith('u-1', PLAN_MEAL, '2026/03/05')
    expect(await res.json()).toEqual({ removed: false })

    // And the slash spelling the client actually sends reaches the same key, so a decline made on
    // one path can be undone from the other.
    deletePlanMealAnswer.mockClear()
    await deleteAnswer(jsonReq('DELETE', { planMealId: PLAN_MEAL, logDate: '2026/03/05' }))
    expect(deletePlanMealAnswer).toHaveBeenCalledWith('u-1', PLAN_MEAL, '2026/03/05')
  })

  it('refuses every method without a session, before touching the repository', async () => {
    sessionUser = null
    expect((await answersFor('?date=2026-03-05')).status).toBe(401)
    expect((await postAnswer(jsonReq('POST', { planMealId: PLAN_MEAL, logDate: '2026-03-05' }))).status).toBe(401)
    expect((await deleteAnswer(jsonReq('DELETE', { planMealId: PLAN_MEAL, logDate: '2026-03-05' }))).status).toBe(401)
    expect(listPlanMealAnswers).not.toHaveBeenCalled()
    expect(savePlanMealAnswer).not.toHaveBeenCalled()
    expect(deletePlanMealAnswer).not.toHaveBeenCalled()
  })

  it('refuses a write body it cannot trust, one rule at a time', async () => {
    for (const body of [
      { planMealId: 'not-a-uuid', logDate: '2026-03-05' },   // id shape
      { planMealId: PLAN_MEAL, logDate: '05/03/2026' },      // date shape
      { planMealId: PLAN_MEAL, logDate: '2026-02-31' },      // real-calendar
      { logDate: '2026-03-05' },                             // missing id
      { planMealId: PLAN_MEAL, logDate: '2026-03-05', mealType: 'lunch' }, // strict
    ]) {
      savePlanMealAnswer.mockClear()
      expect((await postAnswer(jsonReq('POST', body))).status, JSON.stringify(body)).toBe(400)
      expect(savePlanMealAnswer).not.toHaveBeenCalled()
    }
  })
})

describe('/api/nutrition/dietary-restrictions', () => {
  it('returns the global catalogue beside the caller-scoped selections', async () => {
    listDietaryRestrictions.mockResolvedValue([{ id: RESTRICTION, name: 'Peanuts' }])
    listUserDietaryRestrictions.mockResolvedValue([{ restrictionId: RESTRICTION, severity: 'allergy' }])
    const res = await getRestrictions()
    expect(res.status).toBe(200)
    // The catalogue takes no user — it is seeded reference data. `mine` does, and that asymmetry is
    // the whole authorisation story of this route.
    expect(listDietaryRestrictions).toHaveBeenCalledWith()
    expect(listUserDietaryRestrictions).toHaveBeenCalledWith('u-1')
    expect(await res.json()).toEqual({
      catalogue: [{ id: RESTRICTION, name: 'Peanuts' }],
      mine: [{ restrictionId: RESTRICTION, severity: 'allergy' }],
    })
  })

  it('replaces the whole set for the caller', async () => {
    const entries = [{ restrictionId: RESTRICTION, severity: 'avoid' as const }]
    replaceUserDietaryRestrictions.mockResolvedValue(entries)
    const res = await putRestr({ entries })
    expect(res.status).toBe(200)
    expect(replaceUserDietaryRestrictions).toHaveBeenCalledWith('u-1', entries)
    expect(await res.json()).toEqual({ mine: entries })
  })

  it('accepts an empty set, because removing your last restriction is a real edit', async () => {
    // A replace-the-whole-set write has no other way to say "none" — refusing an empty array would
    // make the last restriction permanent.
    replaceUserDietaryRestrictions.mockResolvedValue([])
    expect((await putRestr({ entries: [] })).status).toBe(200)
    expect(replaceUserDietaryRestrictions).toHaveBeenCalledWith('u-1', [])
  })

  it('caps the set, and the entry that breaks the cap is otherwise valid', async () => {
    // 61 well-formed entries: the ONLY thing wrong is the count, so `.max(60)` is what refuses it
    // rather than a severity or a uuid check standing in for it.
    const entries = Array.from({ length: 61 }, (_, i) => ({
      restrictionId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      severity: 'avoid' as const,
    }))
    expect((await putRestr({ entries })).status).toBe(400)
    expect(replaceUserDietaryRestrictions).not.toHaveBeenCalled()

    replaceUserDietaryRestrictions.mockResolvedValue([])
    expect((await putRestr({ entries: entries.slice(0, 60) })).status).toBe(200)
  })

  it('refuses a body it cannot trust, one rule at a time', async () => {
    for (const body of [
      { entries: [{ restrictionId: 'not-a-uuid', severity: 'avoid' }] },      // id shape
      { entries: [{ restrictionId: RESTRICTION, severity: 'dislike' }] },      // severity enum
      { entries: [{ restrictionId: RESTRICTION }] },                           // missing severity
      { entries: [{ restrictionId: RESTRICTION, severity: 'avoid', note: 'x' }] }, // strict, inner
      { entries: [{ restrictionId: RESTRICTION, severity: 'avoid' }], scope: 'all' }, // strict, outer
      { entries: 'none' },
      {},
    ]) {
      replaceUserDietaryRestrictions.mockClear()
      expect((await putRestr(body)).status, JSON.stringify(body)).toBe(400)
      expect(replaceUserDietaryRestrictions).not.toHaveBeenCalled()
    }
  })

  it('413s a body over the cap rather than buffering it', async () => {
    const huge = { entries: [{ restrictionId: RESTRICTION, severity: 'avoid', pad: 'x'.repeat(20 * 1024) }] }
    expect((await putRestr(huge)).status).toBe(413)
    expect(replaceUserDietaryRestrictions).not.toHaveBeenCalled()
  })

  it('refuses both methods without a session, before touching the repository', async () => {
    sessionUser = null
    expect((await getRestrictions()).status).toBe(401)
    expect((await putRestr({ entries: [] })).status).toBe(401)
    expect(listDietaryRestrictions).not.toHaveBeenCalled()
    expect(listUserDietaryRestrictions).not.toHaveBeenCalled()
    expect(replaceUserDietaryRestrictions).not.toHaveBeenCalled()
  })
})
