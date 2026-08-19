import { describe, it, expect } from 'vitest'
import { scrubEvent, scrubUrl, scrubPath } from '../sentry-scrub'
import type { ErrorEvent } from '@sentry/nextjs'

/**
 * Q-404. These are not style assertions — this app's request data is body weight, food, sleep and
 * heart rate, and the entry is explicit that the scrubbing ships with the DSN rather than after it.
 * Each case is a thing that would otherwise leave for a third party.
 */
describe('scrubPath', () => {
  it('replaces a row id, so one issue does not become one issue per row', () => {
    expect(scrubPath('/api/supplements/0db7ea82-57c1-4669-b07c-660fa15c9356')).toBe('/api/supplements/:id')
  })

  it('replaces a date segment — a date IS health data here', () => {
    expect(scrubPath('/health/day/2026-08-19')).toBe('/health/day/:date')
  })

  it('collapses the SLASH-separated date too, which is the format this app emits', () => {
    // `localDateString()` produces `YYYY/MM/DD`, so a date reaches this function as three separate
    // segments that each look like a harmless number. Handling only the dashed form would let the
    // app's own date format through untouched — this assertion is here because the first version
    // of the function did exactly that.
    expect(scrubPath('/health/day/2026/08/19')).toBe('/health/day/:date')
    expect(scrubPath('/api/day-log/2026/08/19/detail')).toBe('/api/day-log/:date/detail')
  })

  it('does not collapse a year-like number that is not part of a date', () => {
    expect(scrubPath('/api/programs/2026')).toBe('/api/programs/2026')
    expect(scrubPath('/api/x/2026/08')).toBe('/api/x/2026/08')
  })

  it('replaces a long numeric segment, which is what a barcode looks like', () => {
    expect(scrubPath('/api/nutrition/barcode/9300675024235')).toBe('/api/nutrition/barcode/:n')
  })

  it('keeps the route shape, which is the whole point of scrubbing rather than dropping', () => {
    expect(scrubPath('/api/nutrition/food-logs')).toBe('/api/nutrition/food-logs')
  })
})

describe('scrubUrl', () => {
  it('drops the VALUE of a sensitive query key and keeps the key', () => {
    expect(scrubUrl('/api/energy-balance?date=2026-08-19'))
      .toBe('/api/energy-balance?date=[scrubbed]')
  })

  it('drops a credential in a query string', () => {
    expect(scrubUrl('/api/x?token=abc123&secret=s3cret')).toBe('/api/x?token=[scrubbed]&secret=[scrubbed]')
  })

  it('leaves a harmless parameter alone', () => {
    expect(scrubUrl('/api/x?page=2')).toBe('/api/x?page=2')
  })

  it('scrubs the path and the query together', () => {
    expect(scrubUrl('/api/supplements/0db7ea82-57c1-4669-b07c-660fa15c9356?date=2026-08-19'))
      .toBe('/api/supplements/:id?date=[scrubbed]')
  })
})

describe('scrubEvent', () => {
  const evt = (over: Partial<ErrorEvent>): ErrorEvent => ({ ...over }) as ErrorEvent

  it('NEVER sends a request body — there is no safe version of one in this app', () => {
    const out = scrubEvent(evt({ request: { url: '/api/nutrition/food-logs', data: { calories: 2400, weightKg: 82.5 } } }))!
    expect(out.request!.data).toBeUndefined()
  })

  it('drops cookies and the Authorization header', () => {
    const out = scrubEvent(evt({
      request: {
        url: '/api/x',
        cookies: { session: 'abc' },
        headers: { Authorization: 'Bearer x', Cookie: 'session=abc', 'User-Agent': 'test' },
      },
    }))!
    expect(out.request!.cookies).toBeUndefined()
    expect(out.request!.headers).toEqual({ 'User-Agent': 'test' })
  })

  it('scrubs breadcrumb URLs — every fetch the app made is in there by default', () => {
    const out = scrubEvent(evt({
      breadcrumbs: [{ category: 'fetch', data: { url: '/api/day-log?date=2026-08-19', method: 'GET' } }],
    }))!
    expect((out.breadcrumbs![0].data as { url: string }).url).toBe('/api/day-log?date=[scrubbed]')
  })

  it('keeps the user id and nothing else about the user', () => {
    const out = scrubEvent(evt({
      user: { id: 'u1', email: 'someone@example.com', username: 'someone', ip_address: '1.2.3.4' },
    }))!
    // The id is how a fault is attributed and is meaningless without this database. The rest is not.
    expect(out.user).toEqual({ id: 'u1' })
  })

  it('drops a raw query_string wholesale rather than trying to parse it', () => {
    const out = scrubEvent(evt({ request: { url: '/api/x', query_string: 'date=2026-08-19&weight=82.5' } }))!
    expect(out.request!.query_string).toBe('[scrubbed]')
  })

  it('passes an event with nothing sensitive through unchanged', () => {
    const out = scrubEvent(evt({ request: { url: '/api/version' } }))!
    expect(out.request!.url).toBe('/api/version')
  })
})
