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

// ── #3685: the values Postgres itself echoes back ─────────────────────────────────────────────
//
// Postgres puts row values in the error, not only Drizzle. Two places, both in its documented
// message formats (`src/backend/utils/adt/ri_triggers.c`, `executor/execMain.c`, `access/nbtree`):
//
//   detail   `Key (email)=(a@b.c) already exists.`                  unique violation (23505)
//            `Key (user_id)=(…) is not present in table "users".`   foreign key (23503)
//            `Key (id)=(…) is still referenced from table "logs".`  foreign key, on delete
//            `Key (r)=(…) conflicts with existing key (r)=(…).`     exclusion (23P01)
//            `Failing row contains (…).`                            not-null (23502), check (23514)
//   message  `invalid input syntax for type uuid: "x"`              bad cast (22P02), enum, date…
//
// Kept: the column list, the table name, and the sentence itself — with the code, severity,
// constraint and table fields alongside, that is what makes a row diagnosable. Dropped: every value.

export const SCRUBBED_VALUE = '…'

// The column list is matched lazily up to the first `)=(` (a key can be an expression such as
// `lower(email)`), the value greedily up to the fixed sentence end, so a value that itself contains
// `)` or the sentence text is still swallowed whole rather than half-kept.
const DETAIL_TEMPLATES: { re: RegExp; out: (m: RegExpMatchArray) => string }[] = [
  {
    re: /^Key \(([\s\S]*?)\)=\(([\s\S]*)\) already exists\.$/,
    out: m => `Key (${m[1]})=(${SCRUBBED_VALUE}) already exists.`,
  },
  {
    re: /^Key \(([\s\S]*?)\)=\(([\s\S]*)\) is not present in table ("[^"]*")\.$/,
    out: m => `Key (${m[1]})=(${SCRUBBED_VALUE}) is not present in table ${m[3]}.`,
  },
  {
    re: /^Key \(([\s\S]*?)\)=\(([\s\S]*)\) is still referenced from table ("[^"]*")\.$/,
    out: m => `Key (${m[1]})=(${SCRUBBED_VALUE}) is still referenced from table ${m[3]}.`,
  },
  {
    // The second column list is the same key; reusing the first avoids keeping a fragment of a
    // value if the split between the two halves is ambiguous.
    re: /^Key \(([\s\S]*?)\)=\(([\s\S]*)\) conflicts with existing key \([\s\S]*\)\.$/,
    out: m => `Key (${m[1]})=(${SCRUBBED_VALUE}) conflicts with existing key (${m[1]})=(${SCRUBBED_VALUE}).`,
  },
  {
    re: /^Failing row contains \([\s\S]*\)\.$/,
    out: () => `Failing row contains (${SCRUBBED_VALUE}).`,
  },
]

/**
 * A pg error's `detail`, with every value replaced by `(…)`. A detail in none of the known shapes
 * fails closed: anything after `=(` or `contains (`, and every double-quoted string, goes.
 */
export function scrubPgDetail(detail: string): string {
  for (const { re, out } of DETAIL_TEMPLATES) {
    const m = detail.match(re)
    if (m) return out(m)
  }
  return detail
    .replace(/=\s*\([\s\S]*$/, `=(${SCRUBBED_VALUE})`)
    .replace(/(contains\s*)\([\s\S]*$/, `$1(${SCRUBBED_VALUE})`)
    .replace(/"[^"]*"/g, `"${SCRUBBED_VALUE}"`)
}

/**
 * A pg error's `message`, with the quoted value after a colon replaced by `"…"`. Postgres does not
 * escape quotes inside that value, so everything from `: "` to the last `"` on the line goes.
 * A message with no such value (`canceling statement due to statement timeout`) is unchanged.
 */
export function scrubPgMessage(message: string): string {
  return message.replace(/: "[^\n]*"(?=\n|$)/g, `: "${SCRUBBED_VALUE}"`)
}
