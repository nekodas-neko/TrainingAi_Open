// Lifts the real Postgres error out of a Drizzle wrapper. Shared by both error-recording paths.
//
// This file deliberately imports NOTHING. `lib/observability.ts` reaches the DB through
// `getRepositoryAsync()`, which pulls the Drizzle adapter → the onnxruntime-node native addon,
// which webpack cannot bundle from an instrumentation entry point — so `request-error.ts` (called
// from Next's `onRequestError`) can never import that module. Keeping the logic here is what lets
// both callers share one implementation instead of growing a second, drifting copy.

// A `pg` driver error, as Drizzle hands it back on `err.cause`. Every field is optional
// because a cause can also be a plain Error (or a pool acquisition timeout, which carries
// no `code` at all).
type PgCause = {
  code?: unknown
  message?: unknown
  detail?: unknown
  severity?: unknown
  constraint?: unknown
  table?: unknown
}

function readCause(err: unknown): PgCause | null {
  if (!(err instanceof Error)) return null
  const cause = (err as { cause?: unknown }).cause
  if (!cause || typeof cause !== 'object') return null
  return cause as PgCause
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

// Q-107: `DrizzleQueryError` sets its message to `Failed query: <sql>` and puts the REAL
// Postgres error — the one carrying `code`, `severity`, `detail` — on `cause`, which this
// function used to drop. That single omission is why every `Failed query` row in
// `error_events` was undiagnosable and the pool-contention theory needed a manual DB dig.
//
// The code goes in a PREFIX, not a suffix, on purpose: the standing session-start query
// groups by `left(message,120)`, and a `Failed query:` message is far longer than that, so
// anything appended at the end is invisible in exactly the read that matters. `57014` =
// `query_canceled` (statement_timeout); a pool acquisition timeout arrives with no code, so
// its message is used instead.
export function summariseCause(err: unknown): { prefix: string; block: string | null } {
  const cause = readCause(err)
  if (!cause) return { prefix: '', block: null }

  const code = str(cause.code)
  const causeMessage = str(cause.message)
  const prefix = code
    ? `[pg ${code}] `
    : causeMessage
      ? `[cause: ${causeMessage.slice(0, 80)}] `
      : ''

  const parts = [
    str(cause.severity),
    code,
    causeMessage,
    str(cause.detail) && `detail: ${str(cause.detail)}`,
    str(cause.constraint) && `constraint: ${str(cause.constraint)}`,
    str(cause.table) && `table: ${str(cause.table)}`,
  ].filter(Boolean)

  return { prefix, block: parts.length > 0 ? `cause: ${parts.join(' | ')}` : null }
}
