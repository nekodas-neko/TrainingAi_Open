import type { ErrorEvent, EventHint } from '@sentry/nextjs'

/**
 * Everything that decides what does NOT leave this app for a third party (Q-404).
 *
 * **This is a health app, and that is the whole reason the config is a module rather than three
 * inline options.** Sentry's defaults capture URLs, breadcrumbs and sometimes request bodies, and
 * the data behind these routes is body weight, food, sleep and heart rate. The backlog entry is
 * explicit that the scrubbing ships in the same PR as the DSN, not after — so it is here, imported
 * by all three runtimes, and tested.
 *
 * There is also a **prior decision on record against a vendor at all** (*"single user, data stays in
 * Railway, no CSP changes"*), since reversed by the owner. The reversal was about alerting, not
 * about sending health data anywhere, and this module is what keeps those two apart.
 */

/**
 * Query-string keys whose VALUE is a health reading or an identifier. The key is kept so a stack
 * trace still says which parameter was involved; only the value goes.
 */
const SENSITIVE_QUERY_KEYS = [
  'date', 'localdate', 'day', 'from', 'to',
  'userid', 'user_id', 'email', 'token', 'secret', 'key', 'signature',
  'weight', 'calories', 'barcode', 'q', 'query', 'search', 'name',
]

/** Header names that carry credentials. Sentry does not send these by default; belt and braces. */
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-webhook-signature']

/**
 * Path segments that are opaque identifiers — a uuid, a barcode, a date. Replaced positionally so
 * `/api/supplements/<uuid>` groups as one issue instead of one per row, which is also what makes
 * the issue list readable.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}[-/]\d{2}[-/]\d{2}$/
const NUMERIC_RE = /^\d{6,}$/

const YEAR_RE = /^(19|20)\d{2}$/
const MM_DD_RE = /^\d{2}$/

/**
 * Replace identifying path segments, keeping the route shape that makes the error legible.
 *
 * **A slash-separated date is collapsed too**, and that is not hypothetical: `localDateString()`
 * (`packages/shared/src/utils.ts`) emits **`YYYY/MM/DD`**, which arrives here as three separate
 * segments that individually look like harmless numbers. Handling only the dashed form would let
 * the app's own date format through untouched.
 */
export function scrubPath(path: string): string {
  const segs = path.split('/')
  const out: string[] = []
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    if (YEAR_RE.test(seg) && MM_DD_RE.test(segs[i + 1] ?? '') && MM_DD_RE.test(segs[i + 2] ?? '')) {
      out.push(':date')
      i += 2
      continue
    }
    out.push(UUID_RE.test(seg) ? ':id' : DATE_RE.test(seg) ? ':date' : NUMERIC_RE.test(seg) ? ':n' : seg)
  }
  return out.join('/')
}

/** Drop the value of every sensitive query key, keeping the key so the shape is still readable. */
export function scrubUrl(raw: string): string {
  const qIndex = raw.indexOf('?')
  const path = scrubPath(qIndex === -1 ? raw : raw.slice(0, qIndex))
  if (qIndex === -1) return path

  const pairs = raw.slice(qIndex + 1).split('&').map(pair => {
    const eq = pair.indexOf('=')
    if (eq === -1) return pair
    const key = pair.slice(0, eq)
    return SENSITIVE_QUERY_KEYS.includes(key.toLowerCase()) ? `${key}=[scrubbed]` : pair
  })
  return `${path}?${pairs.join('&')}`
}

/**
 * The `beforeSend` hook every runtime shares.
 *
 * Deliberately a **denylist of shapes rather than of routes.** A route allowlist goes stale the
 * moment someone adds a route — and this app adds routes constantly — whereas "a uuid in a path is
 * an id" and "a `date` query value is health data" stay true.
 */
export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url)
    // Never send a body. There is no version of a request body in this app that is safe to forward:
    // it is food, weight, sleep or a credential.
    delete event.request.data
    delete event.request.cookies
    if (event.request.query_string) event.request.query_string = '[scrubbed]'
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADERS.includes(name.toLowerCase())) delete event.request.headers[name]
      }
    }
  }

  // Breadcrumbs are the quiet leak: every fetch the app made, with its URL, is in here by default.
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(b => {
      const data = b.data as Record<string, unknown> | undefined
      if (data && typeof data.url === 'string') return { ...b, data: { ...data, url: scrubUrl(data.url) } }
      return b
    })
  }

  // The user id is deliberately kept — it is how a fault is attributed, and it is meaningless to
  // anyone without this database. Everything else about the user is not.
  if (event.user) {
    event.user = { id: event.user.id }
  }

  return event
}
