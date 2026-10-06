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
const listRecentDismissedScaleSamples = vi.fn(async (_u: string, _limit: number) => [] as Row[])
const rateLimit = vi.fn((..._a: unknown[]) => true)
const reportServerError = vi.fn((..._a: unknown[]) => undefined)
const eventsInsert = vi.fn(async (..._a: unknown[]) => ({ data: { id: 'evt-1' } }))
const setCredentials = vi.fn()

let session: Row | null = { user: { id: 'u-1' } }
// RV-193 — the refresh token is no longer ON the session. It is read from the encrypted cookie,
// because the session object is what `GET /api/auth/session` hands to page JavaScript. These two
// are now separate knobs on purpose: a signed-in caller with no calendar grant is
// `session` set and `refreshToken` null, which is the 401 case below.
let refreshToken: string | null = 'rt-1'
vi.mock('@/auth', () => ({ auth: async () => session }))
vi.mock('@/lib/auth/session-token', () => ({ googleRefreshTokenFrom: async () => refreshToken }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({ createFeedback, listPendingScaleSamples, listRecentDismissedScaleSamples })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@googleapis/calendar', () => ({
  auth: { OAuth2: class { setCredentials(...a: unknown[]) { setCredentials(...a) } } },
  calendar: () => ({ events: { insert: (...a: unknown[]) => eventsInsert(...a) } }),
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
  for (const m of [createFeedback, listPendingScaleSamples, listRecentDismissedScaleSamples, rateLimit, reportServerError, eventsInsert, setCredentials]) m.mockClear()
  rateLimit.mockReturnValue(true)
  eventsInsert.mockResolvedValue({ data: { id: 'evt-1' } })
  listPendingScaleSamples.mockResolvedValue([])
  listRecentDismissedScaleSamples.mockResolvedValue([])
  session = { user: { id: 'u-1' } }
  refreshToken = 'rt-1'
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

    // Just under, and it is stored. The payload is a REAL PNG now (RV-191): the route validates the
    // leading bytes, so a run of 'd' is no longer an image — while the size rule above is still
    // measured on the stored string, which is why that half of this case is unchanged.
    const png = `data:image/png;base64,iVBORw0KGgoAAAAN${'A'.repeat(400_000)}`
    await feedback({ type: 'bug', title: 'x', screenshotData: png })
    expect((createFeedback.mock.calls[0][1] as Row).screenshotData).toBe(png)
  })

  /**
   * RV-191. The column is rendered by the admin panel as an image, and nothing checked that it was
   * one — any 500 KB string was stored. The declared type is not the check: it is written by
   * whoever sends the data URI.
   *
   * **The entry called this a HIGH-severity admin-RCE and that part did not reproduce.** Executed
   * on Chromium 2026-09-25: `window.open` to a `data:` URI does not navigate, and SVG inside
   * `<img>` is script-inert. These cases pin the boundary doing its own job.
   */
  it('refuses a screenshot that is not really an image', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64')
    for (const screenshotData of [
      'just a string',                                   // not a data URI at all
      `data:image/svg+xml;base64,${svg}`,                // a type outside the allowlist
      `data:image/png;base64,${svg}`,                    // SVG wearing a PNG label
      'data:image/png;base64,/9j/4AAQSkY=',              // a real JPEG declared as a PNG
    ]) {
      createFeedback.mockClear()
      const res = await feedback({ type: 'bug', title: 'x', screenshotData })
      expect(res.status, screenshotData.slice(0, 40)).toBe(400)
      expect(await res.json()).toEqual({ error: 'Screenshot must be a PNG, JPEG or WebP image' })
      expect(createFeedback).not.toHaveBeenCalled()
    }
  })

  // The control for the case above: a report with no screenshot at all is still filed.
  it('still files a report that carries no screenshot', async () => {
    createFeedback.mockClear()
    expect((await feedback({ type: 'bug', title: 'x' })).status).toBe(201)
    expect(createFeedback).toHaveBeenCalledTimes(1)
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

  // The shapes below are what `GaxiosError` builds, read from the pinned source (#2426): `.status` is
  // the response's numeric status, `.code` the body's numeric `error.code`, and Google's `reason`
  // sits on `response.data.error.errors[]` and on `cause.errors[]`.
  const googleError = (message: string, status: number, reason?: string) => {
    const errors = reason ? [{ message, domain: 'global', reason }] : undefined
    return Object.assign(new Error(message), {
      status, code: status,
      response: { status, data: { error: { code: status, message, ...(errors ? { errors } : {}) } } },
      cause: { message, code: status, ...(errors ? { errors } : {}) },
    })
  }

  it('answers 403 for a missing calendar grant and does NOT record it as a fault', async () => {
    // **The half that matters is the absence.** `error_events` is the table read at the start of
    // every session; a consent state the user simply has not given would be the most common row in
    // it and would bury the faults that need reading.
    for (const err of [
      googleError('Insufficient Permission', 403, 'insufficientPermissions'),
      // A 403 whose reason cannot be read keeps the answer it always had, rather than newly reporting.
      googleError('Forbidden', 403),
      // Only the response carries it, as when the client does not populate `status`.
      Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data: { error: { errors: [{ reason: 'insufficientPermissions' }] } } } }),
    ]) {
      reportServerError.mockClear()
      eventsInsert.mockRejectedValue(err)
      const res = await calendar(VALID_EVENT)
      expect(res.status, err.message).toBe(403)
      expect(await res.json()).toEqual({ code: 'CALENDAR_SCOPE_MISSING' })
      expect(reportServerError, err.message).not.toHaveBeenCalled()
    }
  })

  // #2426 inverted the two cases this file used to pin as current behaviour.
  it("recognises the shape Google's own client actually throws (was pinned as a gap, LA-85)", async () => {
    eventsInsert.mockRejectedValue(googleError('Insufficient Permission', 403, 'insufficientPermissions'))
    const res = await calendar(VALID_EVENT)
    expect(res.status).toBe(403)
    expect(reportServerError).not.toHaveBeenCalled()
  })

  it('treats a 403 that is not a missing grant as a fault', async () => {
    // A rate limit and a quota are 403s too. Answering them "grant calendar access" sends the user
    // to fix something that is not wrong, and keeps a real Google fault out of `error_events`.
    for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']) {
      reportServerError.mockClear()
      eventsInsert.mockRejectedValue(googleError('Rate Limit Exceeded', 403, reason))
      const res = await calendar(VALID_EVENT)
      expect(res.status, reason).toBe(500)
      expect(reportServerError, reason).toHaveBeenCalled()
    }
  })

  it('does NOT classify on the message text any more', async () => {
    // The old test matched "403", "forbidden", "insufficientpermissions" and "calendar" in the text.
    // A plain Error carrying them has no status, so it is not a Google answer at all.
    for (const text of ['Request failed with status code 403', 'Forbidden', 'insufficientPermissions on this resource']) {
      reportServerError.mockClear()
      eventsInsert.mockRejectedValue(new Error(text))
      const res = await calendar(VALID_EVENT)
      expect(res.status, text).toBe(500)
      expect(reportServerError, text).toHaveBeenCalled()
    }
  })

  it('records a failure whose message merely mentions the calendar (was pinned, #2426)', async () => {
    // Nearly every Google failure names the API. Answered as a scope problem it was both told to
    // the user as "grant permission" and kept out of `error_events`: invisible in both directions.
    eventsInsert.mockRejectedValue(new Error('The calendar service is temporarily unavailable'))
    const res = await calendar(VALID_EVENT)
    expect(res.status).toBe(500)
    expect(reportServerError).toHaveBeenCalled()
  })

  it('records a Google 5xx whose body names the calendar', async () => {
    eventsInsert.mockRejectedValue(googleError('Calendar backend error', 503, 'backendError'))
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

  it('refuses without a refresh token — the session alone is not enough here', async () => {
    // This route authorises on `refreshToken`, not on `user.id`: a signed-in user who never granted
    // Google access has a session and cannot write a calendar event. Since RV-193 the token comes
    // from the cookie rather than the session object, so this is the knob that moves; the session
    // stays exactly as it is for a signed-in caller.
    refreshToken = null
    expect((await calendar(VALID_EVENT)).status).toBe(401)
    expect(eventsInsert).not.toHaveBeenCalled()
  })

  it('refuses when there is no session at all, without reaching for a token', async () => {
    // The two halves are independent now, so the signed-out case needs saying separately: a
    // present refresh token must not admit a caller `auth()` refused.
    session = null
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
      dismissed: [],
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

  // LA-108: the readings this account DECLINED ride alongside the pending ones, shaped identically,
  // because the confirm route accepts either — a declined reading has to be reclaimable or nothing
  // re-anchors the weight band and every later reading is declined too.
  it('lists the declined readings beside the staged ones, newest first', async () => {
    listRecentDismissedScaleSamples.mockResolvedValue([
      { id: 21, measuredAt: new Date('2026-03-05T22:15:00Z'), decoded: { weightKg: 57.8 } },
      { id: 20, measuredAt: new Date('2026-03-04T22:15:00Z'), decoded: null },
    ])
    const body = await (await getPending()).json()
    expect(body.dismissed).toEqual([
      { id: 21, measuredAt: '2026-03-05T22:15:00.000Z', weightKg: 57.8 },
      { id: 20, measuredAt: '2026-03-04T22:15:00.000Z', weightKg: null },
    ])
  })

  it('bounds the declined list rather than returning every decline ever made', async () => {
    await getPending()
    const [userId, limit] = listRecentDismissedScaleSamples.mock.calls[0] as [string, number]
    expect(userId).toBe('u-1')
    expect(limit).toBeGreaterThan(0)
    expect(limit).toBeLessThanOrEqual(50)
  })

  it('refuses without a session, before reading anything', async () => {
    session = null
    expect((await getPending()).status).toBe(401)
    expect(listPendingScaleSamples).not.toHaveBeenCalled()
    expect(listRecentDismissedScaleSamples).not.toHaveBeenCalled()
  })
})
