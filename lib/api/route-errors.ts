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
