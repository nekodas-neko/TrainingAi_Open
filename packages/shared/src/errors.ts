/**
 * Typed errors the repository layer throws, so a route can map them to a status instead of letting
 * Next's default handler answer 500.
 *
 * Q-463 — measured across every `app/api` route with a dynamic segment and a write method, called
 * as an authenticated user with a fabricated UUID: **five answered 500** and four of those with an
 * empty body. One cause, repeated: sixteen bare `throw new Error('… not found')` in
 * `lib/data/postgres/`, and routes with nothing mapping them.
 *
 * Three things that costs, each against a rule this repo already wrote:
 *   1. **The sync client retries what can never succeed** — `CLAUDE.md` makes 4xx a poison pill to
 *      quarantine and 5xx a reason to back off and retry. A permanent "not there" reported as 5xx is
 *      classified as transient.
 *   2. **An empty body** makes a client's `res.json()` throw on top of the failure, so it never
 *      renders its error state.
 *   3. **It pollutes `error_events`** — the only view of faults that never reach a human — with
 *      stack traces from correctly-refused requests.
 */

/** Marker property, checked in preference to `instanceof`. Two bundles (the Next server and the
 *  rollup worker's separate esbuild output) can hold two copies of this class, and `instanceof`
 *  silently returns false across them. A string marker cannot. */
const NOT_FOUND_MARKER = 'trainingai/not-found'

export class NotFoundError extends Error {
  readonly __kind = NOT_FOUND_MARKER
  readonly resource?: string

  constructor(resource?: string) {
    super(resource ? `${resource} not found` : 'Not found')
    this.name = 'NotFoundError'
    this.resource = resource
  }
}

export function isNotFoundError(err: unknown): err is NotFoundError {
  return (
    err instanceof NotFoundError ||
    (typeof err === 'object' && err !== null && (err as { __kind?: unknown }).__kind === NOT_FOUND_MARKER)
  )
}

/**
 * There is deliberately **no separate `NotOwnedError` with its own status**, though the backlog
 * entry named one.
 *
 * A row owned by someone else must not be distinguishable from a row that does not exist — that is
 * the reasoning already written into `app/api/nutrition/meal-plans/[id]/route.ts`, this repo's own
 * reference for the correct shape. Two statuses would turn the write surface into a membership
 * oracle for other users' ids. Both conditions are `NotFoundError`, and the resource label is for
 * the log, never for the client.
 */

/**
 * Marker for a refusal whose message was **written to be read by the user**.
 *
 * Q-320 — the routes could not tell one from the other. A caught error's `.message` was used as
 * both the status router (`msg.includes('default')`) and the response body, so a Drizzle failure
 * published `Failed query: select "id", "user_id", …` with the same confidence as "Already friends".
 * Two habits, one variable. Marking the deliberate ones is what separates them: anything unmarked
 * is a fault, gets a fixed string, and keeps its detail in the log.
 *
 * Substring status-matching goes with it. `msg.includes('default')` matched any error carrying the
 * word — the status now travels on the error that chose it.
 */
const USER_FACING_MARKER = 'trainingai/user-facing'

export class UserFacingError extends Error {
  readonly __kind = USER_FACING_MARKER
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'UserFacingError'
    this.status = status
  }
}

export function isUserFacingError(err: unknown): err is UserFacingError {
  return (
    err instanceof UserFacingError ||
    (typeof err === 'object' && err !== null && (err as { __kind?: unknown }).__kind === USER_FACING_MARKER)
  )
}
