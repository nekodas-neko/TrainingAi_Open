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
 * Sentry's own runtime context keys. Everything here is populated by the SDK and describes the
 * MACHINE — os, node/browser version, the trace id — never the user or their readings.
 *
 * An allowlist rather than a denylist because `contexts` is open: any integration added later can
 * put whatever it likes in there (a state dump is the classic one), and a denylist would not know
 * about it. Nothing in this app calls `setContext`, so the allowlist costs no debugging value today
 * and holds the line if that changes.
 */
const SAFE_CONTEXT_KEYS = ['os', 'runtime', 'device', 'browser', 'app', 'trace', 'culture']

/** Longest exception message forwarded. A message past this is a payload, not a description. */
const MAX_VALUE_LENGTH = 1000

/**
 * Drizzle puts the bound parameters INTO the exception message:
 * `` super(`Failed query: ${query}\nparams: ${params}`) `` — verified in the pinned
 * `drizzle-orm/errors.js`, not from memory. `params` is an array, so the template comma-joins the
 * real values straight into `.message`.
 *
 * The SQL above that line is kept deliberately: Drizzle parameterises, so it carries `$1`/`$2`
 * placeholders rather than values, and it is the part that makes the error diagnosable.
 *
 * Without this, every uncaught database error forwards row values to sentry.io — on the `users`
 * path that is an email address.
 */
export function scrubExceptionValue(value: string): string {
  const cut = value.indexOf('\nparams:')
  const head = cut === -1 ? value : `${value.slice(0, cut)}\nparams: [scrubbed]`
  return head.length > MAX_VALUE_LENGTH ? `${head.slice(0, MAX_VALUE_LENGTH)}… [truncated]` : head
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

  // The exception message itself carries row values — see `scrubExceptionValue`. This was the
  // largest remaining hole: `beforeSend` scrubbed the request and left the thing that actually
  // throws untouched.
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (typeof ex.value === 'string') ex.value = scrubExceptionValue(ex.value)
    }
  }

  // Breadcrumbs are the quiet leak: every fetch the app made, with its URL, is in here by default.
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      // Console breadcrumbs are whatever the app last logged, verbatim. There is no way to know in
      // advance that a `console.log` somewhere did not print a food row or a weight, so the whole
      // category goes rather than being pattern-matched.
      .filter(b => b.category !== 'console')
      .map(b => {
        const data = b.data as Record<string, unknown> | undefined
        if (!data) return b
        const next = { ...data }
        // `url` is the fetch breadcrumb; `from`/`to` are the navigation one, and they are URLs of
        // the same app carrying the same dates and ids.
        for (const k of ['url', 'from', 'to']) {
          if (typeof next[k] === 'string') next[k] = scrubUrl(next[k] as string)
        }
        return { ...b, data: next }
      })
  }

  // Nothing in this app writes `extra`, so anything here came from the SDK or an integration and
  // has no established shape. Dropped outright rather than inspected.
  delete event.extra

  if (event.contexts) {
    for (const key of Object.keys(event.contexts)) {
      if (!SAFE_CONTEXT_KEYS.includes(key)) delete event.contexts[key]
    }
  }

  // The user id is deliberately kept — it is how a fault is attributed, and it is meaningless to
  // anyone without this database. Everything else about the user is not.
  if (event.user) {
    event.user = { id: event.user.id }
  }

  return event
}
