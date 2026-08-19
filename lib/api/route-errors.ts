import { NextResponse } from 'next/server'
import { isNotFoundError, isUserFacingError } from '@trainingai/shared/errors'

/**
 * Q-463 — the single mapper at the route boundary.
 *
 * One place, not sixteen call sites each remembering: the repository throws a typed error and this
 * turns it into a status. Anything it does not recognise is re-thrown unchanged, so a genuine bug
 * still reaches `onRequestError` and `error_events` — the point is to clear correctly-refused
 * requests out of that table, not to swallow failures.
 *
 * The body is always `{ error }`. Four of the five routes this fixes returned an **empty** body, so
 * a client calling `res.json()` threw a parse exception on top of the failure and never rendered its
 * error state.
 */
export function routeErrorResponse(err: unknown): NextResponse {
  // Q-320's typed refusal belongs here too, or a `UserFacingError` thrown inside `withRouteErrors`
  // rethrows into Next's default handler and answers 500 — the exact failure this helper exists to
  // stop, one error type later.
  if (isUserFacingError(err)) return NextResponse.json({ error: err.message }, { status: err.status })
  if (isNotFoundError(err)) {
    // The message, not the bare label: `new NotFoundError('Supplement')` reads "Supplement not
    // found", which matches what the routes already answering correctly say.
    return NextResponse.json({ error: err.message }, { status: 404 })
  }
  throw err
}

/** Wraps a handler body so a typed repository error becomes a status and everything else
 *  propagates. Sugar over `try { … } catch (err) { return routeErrorResponse(err) }`, for the routes
 *  with no catch of their own — four of the five had none. */
export async function withRouteErrors(run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run()
  } catch (err) {
    return routeErrorResponse(err)
  }
}

/**
 * The one answer to a caught error in a write route (Q-320).
 *
 * A `UserFacingError` carries a message someone wrote for the user and the status they chose, so it
 * is echoed. Everything else is a fault: the client gets `fallback`, and the detail stays in the log
 * and in `reportServerError`, which already have it. Callers report the fault themselves — this
 * helper must not decide what is worth reporting.
 */
export function refusalResponse(err: unknown, fallback: string): NextResponse {
  if (isNotFoundError(err)) return NextResponse.json({ error: err.message }, { status: 404 })
  if (isUserFacingError(err)) return NextResponse.json({ error: err.message }, { status: err.status })
  return NextResponse.json({ error: fallback }, { status: 500 })
}

/** True when `refusalResponse` will echo the error rather than hide it — for callers deciding
 *  whether a fault is worth reporting. A refused request is not a fault. */
export function isRefusal(err: unknown): boolean {
  return isNotFoundError(err) || isUserFacingError(err)
}

// A v1–v8 UUID in canonical hyphenated form. Anything else reaching the driver is a Postgres
// `22P02 invalid_text_representation`, which surfaces as a 500 on a request that is plainly a 400.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/**
 * The guard every dynamic `[id]` route runs before its id reaches the repository (Q-482).
 *
 * Returns the 400 to send, or null to proceed — `const bad = invalidUuidResponse(id); if (bad)
 * return bad`. Measured across all 30 dynamic route files: **21 route/method pairs answered 5xx**
 * on `not-a-uuid` while answering a well-formed-but-missing id correctly, which is what makes it a
 * missing input guard rather than a broken route.
 *
 * **400, not 404.** A malformed id means the request is malformed, and it is not a disclosure
 * question: UUID syntax is public — anyone can apply the same regex — so answering 400 for
 * "not a UUID" and 404 for "no such UUID" distinguishes nothing an attacker could not already tell.
 * That is a different case from `errors.ts`'s ownership rule, where 403-vs-404 WOULD be an oracle.
 *
 * The message is the same for every route and names no column or table — the detail belongs in the
 * log. Same reasoning as `refusalResponse`.
 */
export function invalidUuidResponse(id: unknown): NextResponse | null {
  return isUuid(id) ? null : NextResponse.json({ error: 'Invalid id' }, { status: 400 })
}
