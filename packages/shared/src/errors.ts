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
