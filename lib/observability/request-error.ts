import { summariseCause } from './pg-cause'

// Records an error that escaped a route handler, for Next's `onRequestError` hook.
//
// Why this exists separately from `lib/observability.ts`: that one goes through
// `getRepositoryAsync()`, which pulls the Drizzle adapter → the onnxruntime-node native addon,
// which webpack cannot bundle from an instrumentation entry point (the same constraint
// `instrumentation-node.ts` documents). This talks to the pool directly instead.
//
// It also covers a different population. `reportServerError` is called from a route's own catch
// block, so it only ever sees errors the route already knew about — 13 routes call it. This sees
// the ones **nobody caught**: 80 of the 200 route files have no `catch` anywhere, so today their
// failures reach the client as a bare 500 and leave no trace at all.

/**
 * An identical failure repeating is not 200 rows of information. The DB is the binding constraint
 * on this project (~9 MB/day growth against a 1 GB volume), so a hot loop in a broken route must
 * not be able to fill it. Same route + same message inside this window records once.
 */
const DEDUPE_WINDOW_MS = 60_000
const DEDUPE_MAX_KEYS = 200

const recentlySeen = new Map<string, number>()

/**
 * The dedupe key must not vary when the *fault* does not.
 *
 * Q-539: one fault — the `oura_heartrate` `cardinality_violation` fixed by Q-214 — wrote **5,771
 * rows**, when a 60 s window over ~200 routes should have capped it near 1,440/day. The window was
 * not broken; the key was. Drizzle embeds the whole generated `VALUES` list in its failure message,
 * so a batch of 40 rows and a batch of 41 are different strings describing the same broken query.
 * **Measured on those rows: 18 distinct messages, all sharing 1 distinct 60-character prefix** — so
 * the window was bypassed 18-fold, and the incident cost 49 MB instead of single digits.
 *
 * Normalising collapses the parts that carry no information: runs of `($1, $2, …)` tuples, bare
 * `$N` placeholders, and long digit runs. Two genuinely different faults still differ in the text
 * around those, which is where a query's identity actually lives.
 */
export function normaliseErrorKey(message: string): string {
  return message
    // A generated VALUES list: `(default, $1, $2), (default, $3, $4), …` → one marker, however long.
    .replace(/\((?:\s*(?:default|\$\d+)\s*,?)+\)(?:\s*,\s*\((?:\s*(?:default|\$\d+)\s*,?)+\))*/gi, '(…)')
    // Any surviving placeholder run, e.g. an IN list rendered as `$1, $2, $3`.
    .replace(/\$\d+(?:\s*,\s*\$\d+)*/g, '$N')
    // Row counts, ids and byte offsets that ride along in driver messages.
    .replace(/\d{3,}/g, 'N')
    .slice(0, KEY_MAX_CHARS)
}

/**
 * The key needs only enough of the message to tell two faults apart. Q-539's 5,771 rows shared a
 * 60-character prefix; past that the message was pure boilerplate. 500 leaves generous headroom
 * over that observation while keeping the key map small.
 */
const KEY_MAX_CHARS = 500

/**
 * Q-539 defect 2: every one of those 5,771 stored messages was truncated to exactly 2,000 chars
 * (`avg = max = 2000`) and was almost entirely `(default, $N, $N, $N),` repeated — 2 kB of
 * boilerplate per row for a message whose information ended at character 60. The cap worked as
 * written; it was simply far too generous for what these messages contain.
 *
 * 1,000 still holds a long stack-free driver message whole. What it stops is a generated VALUES
 * list being archived at full width, 5,771 times.
 */
const MESSAGE_MAX_CHARS = 1_000

/** Exported for tests; also lets a long-lived process drop keys it will never see again. */
export function shouldRecordRequestError(key: string, nowMs: number, windowMs = DEDUPE_WINDOW_MS): boolean {
  const last = recentlySeen.get(key)
  if (last !== undefined && nowMs - last < windowMs) return false
  // Bound the map before inserting, so a high-cardinality error stream cannot grow it without limit.
  if (recentlySeen.size >= DEDUPE_MAX_KEYS) {
    for (const [k, t] of recentlySeen) {
      if (nowMs - t >= windowMs) recentlySeen.delete(k)
    }
    if (recentlySeen.size >= DEDUPE_MAX_KEYS) recentlySeen.clear()
  }
  recentlySeen.set(key, nowMs)
  return true
}

export function resetRequestErrorDedupe(): void {
  recentlySeen.clear()
}

export interface RequestErrorContext {
  path?: string
  method?: string
  /** Raw `Cookie` header from Next's `onRequestError` request argument, if any. */
  cookieHeader?: string
}

/**
 * Auth.js v5 names the session cookie `authjs.session-token`, prefixed `__Secure-` over HTTPS —
 * which production always is, so the prefixed form is the one that matters there.
 */
const SESSION_COOKIE_NAMES = ['__Secure-authjs.session-token', 'authjs.session-token']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Exported for tests. Returns the session cookie's `{ name, value }`, or null.
 *
 * The name comes back too because Auth.js v5 uses the cookie name as the decrypt **salt**, so it
 * has to be the exact one the value was found under — `__Secure-authjs.session-token` contains
 * `authjs.session-token` as a substring, and matching on that would pick the wrong salt.
 */
export function sessionCookieFromHeader(
  cookieHeader: string | undefined,
): { name: string; value: string } | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    // Chunked cookies (`…session-token.0`) are deliberately not reassembled: this is best-effort
    // attribution, and a wrong reassembly would decode to nothing anyway.
    if (SESSION_COOKIE_NAMES.includes(name)) {
      const value = part.slice(eq + 1).trim()
      return value.length > 0 ? { name, value: decodeURIComponent(value) } : null
    }
  }
  return null
}

/**
 * The user the failing request belonged to, or null.
 *
 * Best-effort by construction and **never throws**: the session token is a JWE, so reading it means
 * a real decrypt with `AUTH_SECRET`. Anything that goes wrong — no cookie, expired token, rotated
 * secret, missing env — yields null and the row records exactly as it did before this existed.
 * Attribution must never be able to cost us the error report itself.
 *
 * This grants no authority. It reads an identifier for a row that is already being written; no
 * decision anywhere depends on it.
 */
export async function userIdFromSessionCookie(cookieHeader: string | undefined): Promise<string | null> {
  try {
    const cookie = sessionCookieFromHeader(cookieHeader)
    if (!cookie) return null
    const secret = process.env.AUTH_SECRET
    if (!secret) return null
    // `jose` under the hood — pure JS, no native addon, so this stays importable from the
    // instrumentation entry point (see this file's header for why that constraint exists).
    const { decode } = await import('next-auth/jwt')
    const payload = await decode({ token: cookie.value, secret, salt: cookie.name })
    const raw = (payload as { id?: unknown; sub?: unknown } | null)?.id
      ?? (payload as { sub?: unknown } | null)?.sub
    // Shape-checked because `error_events.user_id` is a `uuid` column with an FK: a non-UUID
    // subject would fail the INSERT and lose the error row, which is the opposite of the point.
    return typeof raw === 'string' && UUID_RE.test(raw) ? raw : null
  } catch {
    return null
  }
}

/**
 * Never throws and never rejects: this runs inside Next's error path, and a failure to record an
 * error must not replace the error being reported.
 */
export async function recordRequestError(err: unknown, ctx: RequestErrorContext): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) return

    const baseMessage = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? (err.stack ?? null) : null
    const url = ctx.path ? `${ctx.method ?? 'GET'} ${ctx.path}` : null

    // Same treatment `reportServerError` gives it (Q-107/Q-142): a `DrizzleQueryError`'s own
    // message is only `Failed query: <sql>`, and the Postgres error that says *why* sits on
    // `cause`. Without this, every failure from the 80 catch-less routes is undiagnosable.
    const { prefix, block } = summariseCause(err)
    const message = `${prefix}${baseMessage}`
    const fullStack = block ? `${block}\n${stack ?? ''}` : stack

    // Q-145: every row from this path used to be written with `user_id = NULL`. With one user that
    // cost nothing; with several, "whose session broke?" is unanswerable for the *largest* class of
    // server errors — the 80 route files with no `catch` of their own.
    const userId = await userIdFromSessionCookie(ctx.cookieHeader)

    // Dedupe on the *base* message, not the prefixed one — the prefix is derived from the same
    // error, so including it cannot separate two distinct faults, and a cause that varies between
    // otherwise-identical failures (a pool timeout's message carries no code) would defeat the
    // window this exists to enforce.
    //
    // The user id IS in the key, though: without it the 60 s window silently collapses two users
    // hitting the same fault into one row, so even the count understates it. Anonymous requests
    // share the empty slot, which is the same behaviour as before for them.
    // Normalised, not raw: a generated VALUES list makes every batch size a different string for
    // the same broken query, which is what let Q-539's single fault through 18 times per window.
    if (!shouldRecordRequestError(`${userId ?? ''}|${url ?? ''}|${normaliseErrorKey(baseMessage)}`, Date.now())) return

    // The pool, not the repository: see the file header. Raw SQL rather than the Drizzle schema
    // keeps this import graph to `pg` alone.
    const { getPool } = await import('@/lib/data/postgres/client')
    const insert = `INSERT INTO error_events (user_id, source, message, stack, url) VALUES ($4, 'server', $1, $2, $3)`
    const params = [message.slice(0, MESSAGE_MAX_CHARS), fullStack?.slice(0, 8000) ?? null, url]
    try {
      await getPool().query(insert, [...params, userId])
    } catch (insertErr) {
      if (userId === null) throw insertErr
      // `user_id` carries an FK to `users`, and a session token can outlive the row it names.
      // Losing the error report to save the attribution would invert the priority: retry unscoped.
      await getPool().query(insert, [...params, null])
    }
  } catch {
    // Deliberately silent. Anything thrown here would surface instead of the real error.
  }
}
