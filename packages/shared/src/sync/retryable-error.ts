// Q-475 — tell a database that cannot write from a mutation that must not be written.
//
// `pushMutations` catches per-mutation (that is what makes the poison-pill rule work), so at the
// wire a dead database is indistinguishable from a validation rejection: both arrive as
// `HTTP 200 {errors:[{error: "Error: Failed query: …"}]}`. The client then counts each one against
// `MAX_MUTATION_ATTEMPTS`, and with the 30 s → 2 m → 8 m → 32 m ladder **≈ 42.5 minutes of outage
// dead-letters every queued mutation** — an ordinary outage length; this repo has recorded two.
//
// The client already states the principle: *"Transport failures … are deliberately NOT counted —
// they say nothing about the mutation itself."* A dead database says nothing about the mutation
// either. It was counted only because it did not *look* like a transport failure.
//
// Both shapes below were measured against a genuinely stopped local Postgres (`pg_ctl -m fast
// stop`), not written from memory — Drizzle wraps every driver error, so the signal is always one
// level down the `cause` chain:
//
//   DrizzleQueryError "Failed query: SELECT 1"  →  cause: pg DatabaseError { code: '57P01' }
//   DrizzleQueryError "Failed query: SELECT 1"  →  cause: Error { code: 'ECONNREFUSED', syscall: 'connect' }
//   DrizzleQueryError "Failed query: insert …"  →  cause: Error { code: 'ENOENT', syscall: 'connect' }
//
// That third shape is why `syscall === 'connect'` is checked as well as the code list, and it was
// found only by pushing at a live `pnpm dev` with the database stopped — not by the unit tests,
// which all passed. A **Unix-socket** connection to a dead server fails with `ENOENT` ("no such
// file": the socket is gone), not `ECONNREFUSED`. Production is TCP and gives ECONNREFUSED, but the
// dev DATABASE_URL is the socket form, so the first live rehearsal classified a real outage as a
// permanent failure. A bare `ENOENT` is far too generic to trust on its own; paired with
// `syscall: 'connect'` it means exactly one thing — we could not open a connection.

// Node socket-level failures: the server is unreachable, not the payload wrong.
const RETRYABLE_SYSCALL_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE',
  'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ECONNABORTED',
])

// SQLSTATEs that describe the server's condition rather than the statement's content. Whole
// classes, because every member of these two classes is an infrastructure fault:
//   08 — connection exception
//   53 — insufficient resources (53100 disk_full is the 2026-08-17 incident; 53300 too_many_connections)
const RETRYABLE_SQLSTATE_CLASSES = ['08', '53']
const RETRYABLE_SQLSTATES = new Set([
  '57P01', // admin_shutdown — the connection was terminated by an administrator command
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now — the server is starting up
  '57014', // query_canceled — statement_timeout fired; the app sets one deliberately
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '55006', // object_in_use
])

// `pg`'s pool surfaces some faults as a plain Error with no code at all. These strings are the
// pool's own, not user data, and each names a condition that resolves on its own.
const RETRYABLE_MESSAGE_FRAGMENTS = [
  'connection terminated',
  'client has encountered a connection error',
  'timeout exceeded when trying to connect',
  'the database system is starting up',
  'the database system is shutting down',
  'terminating connection due to',
  'connection ended unexpectedly',
]

/**
 * True when `err` describes the *server's* inability to write, rather than anything about the
 * mutation. Walks the `cause` chain because Drizzle wraps the driver error, and stops at a small
 * depth so a self-referencing chain cannot spin.
 *
 * Deliberately conservative: an unrecognised error stays non-retryable, so the failure mode of a
 * wrong answer here is the *current* behaviour (bounded retry, then dead-letter with the row kept
 * and a retry affordance), never an unbounded loop.
 */
export function isRetryableWriteError(err: unknown, depth = 0): boolean {
  if (depth > 5 || err == null || typeof err !== 'object') return false
  const e = err as { code?: unknown; message?: unknown; cause?: unknown; syscall?: unknown }

  // A failed `connect(2)` is unreachability by definition, whatever errno it carries.
  if ((e as { syscall?: unknown }).syscall === 'connect') return true

  if (typeof e.code === 'string') {
    if (RETRYABLE_SYSCALL_CODES.has(e.code)) return true
    if (RETRYABLE_SQLSTATES.has(e.code)) return true
    if (e.code.length === 5 && RETRYABLE_SQLSTATE_CLASSES.includes(e.code.slice(0, 2))) return true
  }

  if (typeof e.message === 'string') {
    const m = e.message.toLowerCase()
    if (RETRYABLE_MESSAGE_FRAGMENTS.some(f => m.includes(f))) return true
  }

  return isRetryableWriteError(e.cause, depth + 1)
}
