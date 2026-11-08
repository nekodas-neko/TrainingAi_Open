// Drops the bound parameters Drizzle writes into a query error, before the error is stored or sent.
//
// This file deliberately imports NOTHING, for the same reason as `pg-cause.ts`: `request-error.ts`
// runs from Next's instrumentation entry point and cannot pull in the Drizzle adapter, and the
// Sentry hook runs in every runtime. One implementation, shared by all three writers.
//
// Drizzle builds the message as `` `Failed query: ${query}\nparams: ${params}` `` (pinned
// `drizzle-orm/errors.js`), and `params` is an array, so the real row values (food names, weights,
// sleep, a password hash) are comma-joined into `.message`, and so into `.stack` too. The SQL above
// that line is kept: Drizzle parameterises, so it carries `$1`/`$2` placeholders, not values, and it
// is the part that makes the error diagnosable.

const MARKER = '\nparams:'
export const SCRUBBED_PARAMS = 'params: [scrubbed]'

/**
 * For a message: everything from the `params:` line to the end goes, since in a Drizzle message
 * the parameters are the tail and a value can itself contain a newline. A message that quotes
 * another error's message (`first: ${String(err)}`) is cut at the same point.
 */
export function scrubBoundParams(message: string): string {
  const cut = message.indexOf(MARKER)
  return cut === -1 ? message : `${message.slice(0, cut)}\n${SCRUBBED_PARAMS}`
}

/**
 * For a stack: the same cut, but the stack frames that follow the message are kept, because they
 * say where the query came from. The parameters end at the first frame line (`\n    at `).
 */
export function scrubBoundParamsInStack(stack: string): string {
  const cut = stack.indexOf(MARKER)
  if (cut === -1) return stack
  const rest = stack.slice(cut + MARKER.length)
  const frame = rest.search(/\n\s+at /)
  return `${stack.slice(0, cut)}\n${SCRUBBED_PARAMS}${frame === -1 ? '' : rest.slice(frame)}`
}
