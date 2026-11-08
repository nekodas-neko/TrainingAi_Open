// Lifts the real Postgres error out of a Drizzle wrapper. Shared by both error-recording paths.
//
// This file imports nothing but `./scrub-params`, which imports nothing itself.
// `lib/observability.ts` reaches the DB through `getRepositoryAsync()`, which pulls the Drizzle
// adapter → the onnxruntime-node native addon, which webpack cannot bundle from an instrumentation entry point — so `request-error.ts` (called
// from Next's `onRequestError`) can never import that module. Keeping the logic here is what lets
// both callers share one implementation instead of growing a second, drifting copy.

import { scrubPgDetail, scrubPgMessage } from './scrub-params'

// A `pg` driver error, as Drizzle hands it back on `err.cause`. Every field is optional
// because a cause can also be a plain Error (or a pool acquisition timeout, which carries
// no `code` at all).
type PgCause = {
  code?: unknown
  message?: unknown
  detail?: unknown
  severity?: unknown
  constraint?: unknown
  schema?: unknown
  table?: unknown
  column?: unknown
  dataType?: unknown
}

function readCause(err: unknown): PgCause | null {
  if (!(err instanceof Error)) return null
  const cause = (err as { cause?: unknown }).cause
  if (!cause || typeof cause !== 'object') return null
  return cause as PgCause
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

// A `pg` DatabaseError: a five-character SQLSTATE and a severity. A pool timeout or a plain Error
// has neither, and its message is ours, not Postgres's, so it carries no row value.
function isPgError(v: unknown): v is PgCause & { message: string } {
  if (!(v instanceof Error)) return false
  const { code, severity } = v as PgCause
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && typeof severity === 'string'
}

/**
 * #3685: for an error that IS a pg error (a raw `pool.query` failure, not wrapped by Drizzle), its
 * own message reaches `error_events` as the base message and as the first line of the stack. Every
 * copy of that message in `text` is replaced with its scrubbed form. Any other error is untouched.
 */
export function scrubOwnPgMessage(err: unknown, text: string): string {
  if (!isPgError(err) || err.message.length === 0) return text
  const clean = scrubPgMessage(err.message)
  return clean === err.message ? text : text.split(err.message).join(clean)
}

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

  // #3685: Postgres echoes row values in both of these (`Key (email)=(<address>) already exists.`,
  // `invalid input syntax for type uuid: "<value>"`). The values go; the sentence, the column list
  // and the code/severity/constraint/table stay, which is what makes the row diagnosable.
  const code = str(cause.code)
  const rawMessage = str(cause.message)
  const causeMessage = rawMessage && scrubPgMessage(rawMessage)
  const rawDetail = str(cause.detail)
  const detail = rawDetail && scrubPgDetail(rawDetail)
  const prefix = code
    ? `[pg ${code}] `
    : causeMessage
      ? `[cause: ${causeMessage.slice(0, 80)}] `
      : ''

  const parts = [
    str(cause.severity),
    code,
    causeMessage,
    detail && `detail: ${detail}`,
    str(cause.constraint) && `constraint: ${str(cause.constraint)}`,
    str(cause.schema) && `schema: ${str(cause.schema)}`,
    str(cause.table) && `table: ${str(cause.table)}`,
    str(cause.column) && `column: ${str(cause.column)}`,
    str(cause.dataType) && `data type: ${str(cause.dataType)}`,
  ].filter(Boolean)

  return { prefix, block: parts.length > 0 ? `cause: ${parts.join(' | ')}` : null }
}
