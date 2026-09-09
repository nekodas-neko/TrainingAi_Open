/**
 * PS-39 — three routes that each hand something OUT of the app: `feedback` (to the owner's own
 * queue), `log-calendar-event` (to Google) and `scale-ble/pending` (to the confirm/dismiss triage).
 *
 * Batched because they are the last of the user-facing routes on the PS-39 list, and because two of
 * them make a decision that is invisible in the response body:
 *
 *   · **`log-calendar-event` deliberately does NOT report a missing calendar grant to
 *     `error_events`.** A user who never granted the scope is a consent state, not a server fault,
 *     and it is the common case here — reporting it would bury the real faults in the one table
 *     every session reads at start-up. The 500 branch reports; the 403 branch must not.
 *   · **`feedback` caps the screenshot BELOW the body cap**, so an oversized image is refused as an
 *     image rather than as a malformed request. The two limits are 500 KB and 600 KB, and a fixture
 *     has to sit between them for the inner check to be the one that fires.
 *   · **`scale-ble/pending` exists because the owner's partner uses the same scale.** A jump that
 *     does not look like this account waits for a Confirm rather than auto-saving, so the route's
 *     job is to surface the row with enough to judge it — including when the decode failed.
 *
 * Fixture discipline (the PS-39 note): each case forces apart the two situations it must
 * distinguish, rather than relying on a value that satisfies several guards at once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>

const createFeedback = vi.fn(async (..._a: unknown[]) => undefined)
const listPendingScaleSamples = vi.fn(async (_u: string) => [] as Row[])
const rateLimit = vi.fn((..._a: unknown[]) => true)
const reportServerError = vi.fn((..._a: unknown[]) => undefined)
const eventsInsert = vi.fn(async (..._a: unknown[]) => ({ data: { id: 'evt-1' } }))
const setCredentials = vi.fn()

let session: Row | null = { user: { id: 'u-1' }, refreshToken: 'rt-1' }
vi.mock('@/auth', () => ({ auth: async () => session }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({ createFeedback, listPendingScaleSamples })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class { setCredentials(...a: unknown[]) { setCredentials(...a) } } },
    calendar: () => ({ events: { insert: (...a: unknown[]) => eventsInsert(...a) } }),
  },
}))

import { POST as postFeedback } from '@/app/api/feedback/route'
import { POST as postCalendar } from '@/app/api/log-calendar-event/route'
import { GET as getPending } from '@/app/api/scale-ble/pending/route'

const jsonPost = (handler: (r: NextRequest) => Promise<Response>, body: unknown, path: string) =>
  handler(new NextRequest(`http://localhost${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
const feedback = (b: unknown) => jsonPost(postFeedback, b, '/api/feedback')
const calendar = (b: unknown) => jsonPost(postCalendar, b, '/api/log-calendar-event')

const VALID_EVENT = {
  sessionType: 'Lower', startMs: 1_770_000_000_000, endMs: 1_770_003_600_000,
  exercises: [{ name: 'Squat', setWeights: [100, 105], reps: [5, 5] }],
}

beforeEach(() => {
  for (const m of [createFeedback, listPendingScaleSamples, rateLimit, reportServerError, eventsInsert, setCredentials]) m.mockClear()
  rateLimit.mockReturnValue(true)
  eventsInsert.mockResolvedValue({ data: { id: 'evt-1' } })
  listPendingScaleSamples.mockResolvedValue([])
  session = { user: { id: 'u-1' }, refreshToken: 'rt-1' }
})

describe('POST /api/feedback', () => {
  it('stores a report against the caller, trimmed and capped', async () => {
    const res = await feedback({
      type: 'bug', title: `  ${'t'.repeat(250)}  `, description: '  it broke  ',
    })
    expect(res.status).toBe(201)
    const [userId, data] = createFeedback.mock.calls[0] as [string, Row]
    expect(userId).toBe('u-1')
    expect(data.type).toBe('bug')
    expect(data.title).toBe('t'.repeat(200))     // trimmed FIRST, then cut to 200
    expect(data.description).toBe('it broke')
    expect(data.screenshotData).toBeNull()
  })

  it('stores a whitespace-only description as null rather than as an empty string', async () => {
    // `|| null` after the trim. An empty string reads as "they wrote nothing" in the queue only if
    // it is null — an empty string renders as a blank field that looks like a rendering bug.
    await feedback({ type: 'other', title: 'x', description: '     ' })
    expect((createFeedback.mock.calls[0][1] as Row).description).toBeNull()
  })

  it('refuses a screenshot over its own cap, as a screenshot rather than as a bad request', async () => {
    // **The fixture has to sit BETWEEN the two limits.** The screenshot cap is 500 KB and the body
    // cap 600 KB, so an image of, say, 700 KB would be refused by the body guard and the screenshot
    // check would never run — the case would pass while testing the wrong rule. 520 KB reaches it.
    const over = { type: 'bug', title: 'x', screenshotData: 'd'.repeat(520_000) }
    const res = await feedback(over)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Screenshot too large' })
    expect(createFeedback).not.toHaveBeenCalled()

    // Just under, and it is stored.
    await feedback({ type: 'bug', title: 'x', screenshotData: 'd'.repeat(400_000) })
    expect((createFeedback.mock.calls[0][1] as Row).screenshotData).toBe('d'.repeat(400_000))
  })

  it('refuses a report it could not file, one rule at a time', async () => {
    for (const body of [
      { type: 'crash', title: 'x' },        // not one of the three kinds
      { type: 'bug' },                      // no title
      { type: 'bug', title: '   ' },        // whitespace is not a title
      { type: 'bug', title: 'x', screenshotData: 42 },  // a number is not a data URI
    ]) {
      createFeedback.mockClear()
      expect((await feedback(body)).status, JSON.stringify(body).slice(0, 60)).toBe(400)
      expect(createFeedback).not.toHaveBeenCalled()
    }
  })

  it('refuses without a session and over the rate limit, in that order', async () => {
    session = null
    expect((await feedback({ type: 'bug', title: 'x' })).status).toBe(401)
    expect(rateLimit).not.toHaveBeenCalled()

    session = { user: { id: 'u-1' } }
    rateLimit.mockReturnValue(false)
    expect((await feedback({ type: 'bug', title: 'x' })).status).toBe(429)
    expect(createFeedback).not.toHaveBeenCalled()
  })
})

describe('POST /api/log-calendar-event', () => {
  it('writes the session to the primary calendar with its sets in the description', async () => {
    const res = await calendar(VALID_EVENT)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, eventId: 'evt-1' })
    expect(setCredentials).toHaveBeenCalledWith({ refresh_token: 'rt-1' })

    const arg = eventsInsert.mock.calls[0][0] as { calendarId: string; requestBody: Row }
    expect(arg.calendarId).toBe('primary')
    expect(arg.requestBody.summary).toBe('Lower · TrainingAI')
    expect(arg.requestBody.description).toBe('Squat\n  Set 1: 100kg × 5\n  Set 2: 105kg × 5')
    expect(arg.requestBody.start).toEqual({ dateTime: new Date(VALID_EVENT.startMs).toISOString() })
  })

  it('marks a rep it does not have rather than dropping the set', async () => {
    // A set logged with a weight but no rep count still happened. Writing three sets and describing
    // two would make the calendar entry quietly disagree with the app.
    await calendar({ ...VALID_EVENT, exercises: [{ name: 'Bench', setWeights: [60, 60], reps: [8] }] })
    const arg = eventsInsert.mock.calls[0][0] as { requestBody: Row }
    expect(arg.requestBody.description).toBe('Bench\n  Set 1: 60kg × 8\n  Set 2: 60kg × ?')
  })

  it('caps the exercise list rather than posting an unbounded description', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `Ex ${i}`, setWeights: [50], reps: [5] }))
    await calendar({ ...VALID_EVENT, exercises: many })
    const desc = String((eventsInsert.mock.calls[0][0] as { requestBody: Row }).requestBody.description)
    expect(desc).toContain('Ex 49')
    expect(desc).not.toContain('Ex 50')
  })

  it('answers 403 for a missing calendar grant and does NOT record it as a fault', async () => {
    // **The half that matters is the absence.** `error_events` is the table read at the start of
    // every session; a consent state the user simply has not given would be the most common row in
    // it and would bury the faults that need reading.
    //
    // Each of the four recognised shapes, so no single one carries the case.
    for (const err of [
      new Error('Request failed with status code 403'),
      new Error('Forbidden'),
      new Error('insufficientPermissions on this resource'),
      Object.assign(new Error('write failed'), { code: 'ERR_HTTP_403' }),
    ]) {
      reportServerError.mockClear()
      eventsInsert.mockRejectedValue(err)
      const res = await calendar(VALID_EVENT)
      expect(res.status, err.message).toBe(403)
      expect(await res.json()).toEqual({ code: 'CALENDAR_SCOPE_MISSING' })
      expect(reportServerError, err.message).not.toHaveBeenCalled()
    }
  })

  it("does NOT recognise the shape Google's own client actually throws — pinned, filed as LA-85", async () => {
    // **Recorded because it is a gap, not because it is desired.** Read from the pinned `gaxios`
    // source rather than guessed: `GaxiosError` sets `.code` only from an underlying `cause.code`
    // or from the JSON body's `error.code`, which for Google is the **number** 403 — so
    // `errCode === 'ERR_HTTP_403'`, a strict compare against a string, cannot match it. The status
    // lives on `.status`, which this route never reads. And the message for a scope failure is
    // "Insufficient Permission" (the `reason` field is not joined into it), which contains none of
    // "403", "forbidden", "insufficientpermissions" or "calendar".
    //
    // So the shape below plausibly falls through to the 500 branch and IS reported as a fault —
    // the opposite of what this route decided. I have not observed a live Google 403 from here, so
    // this pins the behaviour and LA-85 carries what must be proven against a real one before
    // anything is narrowed or widened.
    eventsInsert.mockRejectedValue(Object.assign(new Error('Insufficient Permission'), { code: 403, status: 403 }))
    const res = await calendar(VALID_EVENT)
    expect(res.status).toBe(500)
    expect(reportServerError).toHaveBeenCalled()
  })

  it('records a genuine failure, and does not echo the cause', async () => {
    eventsInsert.mockRejectedValue(new Error('ETIMEDOUT connecting to 10.0.0.4:443'))
    const res = await calendar(VALID_EVENT)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Calendar write failed' })
    expect(reportServerError).toHaveBeenCalled()
    expect(await (await calendar(VALID_EVENT)).text()).not.toContain('10.0.0.4')
  })

  it('classifies any error MENTIONING a calendar as a scope problem — pinned, not endorsed', async () => {
    // Current behaviour, recorded as LA-85 alongside the gap above. The scope test includes a bare
    // `message.includes('calendar')`, so a genuine outage whose text names the API is answered as
    // "you need to grant permission" AND is kept out of `error_events` — a fault that is invisible
    // in both directions at once. Narrowing it is a judgement about Google's error shapes, which
    // wants evidence from real failures rather than a guess in a test PR.
    eventsInsert.mockRejectedValue(new Error('The calendar service is temporarily unavailable'))
    const res = await calendar(VALID_EVENT)
    expect(res.status).toBe(403)
    expect(reportServerError).not.toHaveBeenCalled()
  })

  it('refuses without a refresh token — the session alone is not enough here', async () => {
    // This route authorises on `refreshToken`, not on `user.id`: a signed-in user who never granted
    // Google access has a session and cannot write a calendar event.
    session = { user: { id: 'u-1' } }
    expect((await calendar(VALID_EVENT)).status).toBe(401)
    expect(eventsInsert).not.toHaveBeenCalled()
  })

  it('refuses a body missing any of the three required fields', async () => {
    for (const missing of ['sessionType', 'startMs', 'endMs'] as const) {
      eventsInsert.mockClear()
      const body: Row = { ...VALID_EVENT }
      delete body[missing]
      expect((await calendar(body)).status, missing).toBe(400)
      expect(eventsInsert).not.toHaveBeenCalled()
    }
  })
})

describe('GET /api/scale-ble/pending', () => {
  it('lists the caller’s staged weigh-ins with enough to judge them', async () => {
    listPendingScaleSamples.mockResolvedValue([
      { id: 11, measuredAt: new Date('2026-03-01T22:15:00Z'), decoded: { weightKg: 83.4 } },
    ])
    const res = await getPending()
    expect(res.status).toBe(200)
    expect(listPendingScaleSamples).toHaveBeenCalledWith('u-1')
    expect(await res.json()).toEqual({
      pending: [{ id: 11, measuredAt: '2026-03-01T22:15:00.000Z', weightKg: 83.4 }],
    })
  })

  it('still lists a row whose decode failed, rather than hiding it', async () => {
    // A pending row exists because something needs a human decision. Dropping the ones that will not
    // decode leaves them staged forever with nothing on screen to act on.
    listPendingScaleSamples.mockResolvedValue([
      { id: 12, measuredAt: new Date('2026-03-02T22:15:00Z'), decoded: null },
      { id: 13, measuredAt: new Date('2026-03-03T22:15:00Z'), decoded: { batteryPct: 40 } },
    ])
    const body = await (await getPending()).json()
    expect(body.pending.map((p: Row) => [p.id, p.weightKg])).toEqual([[12, null], [13, null]])
  })

  it('refuses without a session, before reading anything', async () => {
    session = null
    expect((await getPending()).status).toBe(401)
    expect(listPendingScaleSamples).not.toHaveBeenCalled()
  })
})
