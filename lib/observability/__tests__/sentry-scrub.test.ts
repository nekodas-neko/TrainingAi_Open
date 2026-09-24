import { describe, it, expect } from 'vitest'
import { scrubEvent, scrubUrl, scrubPath, scrubExceptionValue } from '../sentry-scrub'
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

/**
 * RV-194. The four gaps `beforeSend` had: it scrubbed the REQUEST and left untouched the thing that
 * actually throws, what the app last logged, where it navigated, and two open bags.
 */
describe('RV-194 — the parts of an event that carry values', () => {
  const evt = (over: Partial<ErrorEvent>): ErrorEvent => ({ ...over }) as ErrorEvent

  // Built from drizzle-orm's own constructor, read out of the pinned package rather than written
  // from memory: `super(`Failed query: ${query}\nparams: ${params}`)`. `params` is an ARRAY, so the
  // template comma-joins the real bound values into `.message`.
  const realDrizzleError = [
    'Failed query: select "id", "email", "timezone" from "users" where "users"."email" = $1',
    'params: dasa.delan@gmail.com',
  ].join('\n')

  it('cuts the bound parameters out of a real Drizzle message — this one carries an email', () => {
    const out = scrubExceptionValue(realDrizzleError)
    expect(out).not.toContain('dasa.delan@gmail.com')
    expect(out).toContain('params: [scrubbed]')
  })

  it('KEEPS the SQL above the params line, which is the diagnosable half', () => {
    // Drizzle parameterises, so the query carries `$1` rather than a value. Cutting the whole
    // message would make the error useless and is the over-correction to avoid.
    const out = scrubExceptionValue(realDrizzleError)
    expect(out).toContain('from "users"')
    expect(out).toContain('$1')
  })

  it('reaches the message through scrubEvent, not just the exported helper', () => {
    const out = scrubEvent(evt({
      exception: { values: [{ type: 'DrizzleQueryError', value: realDrizzleError }] },
    }))!
    expect(out.exception!.values![0].value).not.toContain('dasa.delan@gmail.com')
  })

  it('truncates a message with no params line at all, so a payload cannot ride in one', () => {
    const out = scrubExceptionValue('x'.repeat(5000))
    expect(out.length).toBeLessThan(1100)
    expect(out.endsWith('… [truncated]')).toBe(true)
  })

  it('leaves an ordinary exception message alone', () => {
    expect(scrubExceptionValue('Cannot read properties of undefined')).toBe('Cannot read properties of undefined')
  })

  it('drops console breadcrumbs — whatever the app last logged, verbatim', () => {
    const out = scrubEvent(evt({
      breadcrumbs: [
        { category: 'console', message: 'saved weight 82.5kg for dasa.delan@gmail.com' },
        { category: 'fetch', data: { url: '/api/version' } },
      ],
    }))!
    expect(out.breadcrumbs).toHaveLength(1)
    expect(JSON.stringify(out.breadcrumbs)).not.toContain('82.5')
  })

  it('scrubs navigation from/to, not only fetch url', () => {
    const out = scrubEvent(evt({
      breadcrumbs: [{
        category: 'navigation',
        data: { from: '/health/day/2026/08/19', to: '/api/x?userId=0db7ea82-57c1-4669-b07c-660fa15c9356' },
      }],
    }))!
    const data = out.breadcrumbs![0].data as Record<string, string>
    expect(data.from).toBe('/health/day/:date')
    expect(data.to).toBe('/api/x?userId=[scrubbed]')
  })

  it('drops `extra` outright and allowlists `contexts`', () => {
    const out = scrubEvent(evt({
      extra: { weightKg: 82.5 },
      // The real shape Sentry's state integration emits, not an invented one — `contexts.state`
      // is typed as `StateContext`, and getting that wrong is what a spec-is-code check catches.
      contexts: { os: { name: 'Android' }, state: { state: { type: 'redux', value: { user: { email: 'a@b.com' } } } } },
    }))!
    expect(out.extra).toBeUndefined()
    expect(out.contexts!.os).toEqual({ name: 'Android' })
    expect(out.contexts!.state).toBeUndefined()
  })

  it('does not throw on an event with none of these fields', () => {
    expect(() => scrubEvent(evt({ request: { url: '/api/version' } }))).not.toThrow()
  })
})
