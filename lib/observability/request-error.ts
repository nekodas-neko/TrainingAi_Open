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
    if (!shouldRecordRequestError(`${userId ?? ''}|${url ?? ''}|${baseMessage}`, Date.now())) return

    // The pool, not the repository: see the file header. Raw SQL rather than the Drizzle schema
    // keeps this import graph to `pg` alone.
    const { getPool } = await import('@/lib/data/postgres/client')
    const insert = `INSERT INTO error_events (user_id, source, message, stack, url) VALUES ($4, 'server', $1, $2, $3)`
    const params = [message.slice(0, 2000), fullStack?.slice(0, 8000) ?? null, url]
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
