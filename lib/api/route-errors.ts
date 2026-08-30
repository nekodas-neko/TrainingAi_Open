import { NextResponse } from 'next/server'
import { isNotFoundError, isUserFacingError } from '@trainingai/shared/errors'
import { isUuid } from '@trainingai/shared/validation/uuid'

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

// The guard moved to `@trainingai/shared/validation/uuid` so the repository layer can use it without
// importing this module, which pulls in `next/server` (RV-32). Re-exported so existing call sites
// keep working unchanged.
export { isUuid }

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

/**
 * The same guard for a route whose key is a `bigserial`, not a uuid (BF-53).
 *
 * **This exists because the sweep that added `invalidUuidResponse` across the 30 dynamic routes
 * applied it to two whose ids are integers**, and a decimal id can never match a UUID regex — so
 * `/api/scale-ble/pending/[id]/{confirm,dismiss}` returned `400 Invalid id` for **every real
 * request**, and the whole pending weigh-in triage was dead in production. A reading that was not
 * the owner's could not be dismissed and one that was could not be confirmed. Both routes already
 * carried the correct `Number.isInteger` check on the next line, unreachable underneath the wrong
 * one — which is the tell that someone knew the key was numeric.
 *
 * So the point of this helper is not the four lines it saves. It is that the next sweep over
 * `[id]` routes finds a numeric key already guarded, and by a name that says so.
 *
 * Returns `{ ok: true, id }` so the caller cannot forget to parse, or the 400 to send.
 * `/^\d+$/` rather than `Number.isInteger(Number(x))`: the latter accepts `'1e3'`, `'0x10'` and
 * `' 41 '` as ids, which a `bigserial` column never produces. Same 400-not-404 reasoning as
 * `invalidUuidResponse` above — a malformed id is a malformed request, and integer syntax discloses
 * nothing.
 */
export function numericRouteId(id: unknown): { ok: true; id: number } | { ok: false; response: NextResponse } {
  if (typeof id === 'string' && /^\d+$/.test(id)) {
    const parsed = Number(id)
    if (Number.isSafeInteger(parsed) && parsed > 0) return { ok: true, id: parsed }
  }
  return { ok: false, response: NextResponse.json({ error: 'Invalid id' }, { status: 400 }) }
}
