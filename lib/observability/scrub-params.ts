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

// A real stack frame, strictly: `    at fn (file:1:2)`, `    at file:1:2`, `    at async fn (file:1:2)`,
// `    at new Promise (<anonymous>)`. A bare `    at the gym` inside a parameter value is NOT one,
// which is what the first version of this file got wrong (#3673 review).
const FRAME_LINE = /^\s+at (?:[^\n]*\((?:[^\n()]*:\d+:\d+|<anonymous>|native|unknown location)\)|[^\n()\s]*:\d+:\d+|<anonymous>)$/

/** Splits a stack into its text and the trailing run of strict frame lines. */
function splitFrames(stack: string): { head: string; frames: string } {
  const lines = stack.split('\n')
  let i = lines.length
  while (i > 0 && FRAME_LINE.test(lines[i - 1])) i--
  // The first line is always message text, never a frame.
  if (i === 0) i = 1
  return { head: lines.slice(0, i).join('\n'), frames: lines.slice(i).map(l => `\n${l}`).join('') }
}

/**
 * The exact parameter text of a Drizzle query error, from `.params`, walking the cause chain:
 * `${params}` as Drizzle itself writes it into the message, and every string parameter long enough
 * to be a value rather than a SQL fragment. Parameters that cannot be read are skipped, never thrown on.
 */
function paramsOf(err: unknown): { tail: string; values: string[] }[] {
  const out: { tail: string; values: string[] }[] = []
  const seen = new Set<unknown>()
  let cur: unknown = err
  for (let depth = 0; depth < 6 && cur && typeof cur === 'object' && !seen.has(cur); depth++) {
    seen.add(cur)
    const params = (cur as { params?: unknown }).params
    if (Array.isArray(params)) {
      let tail = ''
      try { tail = String(params) } catch { tail = '' }
      const query = typeof (cur as { query?: unknown }).query === 'string' ? (cur as { query: string }).query : ''
      const values: string[] = []
      for (const p of params) {
        let t = ''
        try { t = typeof p === 'object' && p !== null && !(p instanceof Date) ? (Buffer.isBuffer(p) ? p.toString() : JSON.stringify(p) ?? '') : String(p) } catch { t = '' }
        if (t.length >= 8 && !query.includes(t)) values.push(t)
      }
      out.push({ tail, values })
    }
    cur = (cur as { cause?: unknown }).cause
  }
  return out
}

function removeExactParams(text: string, err: unknown): string {
  let t = text
  for (const { tail, values } of paramsOf(err)) {
    if (tail.length > 0) t = t.split(tail).join('[scrubbed]')
    for (const v of values) t = t.split(v).join('[scrubbed]')
  }
  return t
}

/**
 * For a message: everything from the first `params:` line to the end goes, since in a Drizzle message
 * the parameters are the tail and a value can itself contain a newline. A message that quotes
 * another error's message (`first: ${String(err)}`) is cut at the same point. With `err`, the exact
 * parameter text of that error (and of its causes) is removed first, wherever it appears.
 */
export function scrubBoundParams(message: string, err?: unknown): string {
  const text = err === undefined ? message : removeExactParams(message, err)
  const cut = text.indexOf(MARKER)
  return cut === -1 ? text : `${text.slice(0, cut)}\n${SCRUBBED_PARAMS}`
}

/**
 * For a stack: the stack frames after the message are kept, because they say where the query came
 * from. With `err`, its exact parameters are removed first. Without it (or for what that leaves),
 * every `params:` line starts a cut that runs to the next STRICT frame line (`at fn (file:1:2)`),
 * and a later marker is cut the same way. A parameter that fakes a frame line can still end its own
 * cut early, which is why the exact removal comes first and why this is only the fallback.
 */
export function scrubBoundParamsInStack(stack: string, err?: unknown): string {
  const text = err === undefined ? stack : removeExactParams(stack, err)
  if (!text.includes(MARKER) && !text.startsWith('params:')) return text
  const out: string[] = []
  let skipping = false
  for (const line of text.split('\n')) {
    if (skipping) {
      if (FRAME_LINE.test(line)) { skipping = false; out.push(line) }
      continue
    }
    if (line.startsWith('params:')) { out.push(SCRUBBED_PARAMS); skipping = true; continue }
    out.push(line)
  }
  return out.join('\n')
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
export function scrubPgDetail(detail: string, code?: unknown): string {
  // Class 22 details that echo a value without quoting it (invalid XML: the offending line and a
  // caret; untranslatable character: its bytes). Fail closed: the detail goes, the message stays.
  if (typeof code === 'string' && /^22(00[MNST]|P05|021)$/.test(code)) return SCRUBBED_VALUE
  for (const { re, out } of DETAIL_TEMPLATES) {
    const m = detail.match(re)
    if (m) return out(m)
  }
  return detail
    .replace(/=\s*\([\s\S]*$/, `=(${SCRUBBED_VALUE})`)
    .replace(/(contains\s*)\([\s\S]*$/, `$1(${SCRUBBED_VALUE})`)
    .replace(/"[^"]*"/g, `"${SCRUBBED_VALUE}"`)
}

const SQLSTATE_CLASS_22 = /^22[0-9A-Z]{3}$/

/**
 * A pg error's `message`, with every echoed value replaced by `"…"`. Postgres does not escape quotes
 * inside the value and the value can span lines, so a value is taken from its opening quote to the
 * LAST quote in the text, never to the first closing one:
 *   - after a colon:   `invalid input syntax for type uuid: "x"`  (22P02, 22007, enum, date, …)
 *   - the other shapes: `value "x" is out of range for type integer`, `time zone "x" not recognized`,
 *     `invalid value "x" for "YYYY"`, `"x" is out of range for type double precision`
 *   - with `code` of class 22 (data exception), whatever the shape: first quote to last quote, and
 *     any `0x..` byte run. Fail closed: a class 22 message with a shape not listed here still goes.
 * A message with no such value (`canceling statement due to statement timeout`) is unchanged.
 */
export function scrubPgMessage(message: string, code?: unknown): string {
  let m = message
  if (typeof code === 'string' && SQLSTATE_CLASS_22.test(code)) {
    const first = m.indexOf('"')
    const last = m.lastIndexOf('"')
    if (first !== -1 && last > first) m = `${m.slice(0, first)}"${SCRUBBED_VALUE}"${m.slice(last + 1)}`
    m = m.replace(/0x[0-9a-fA-F]{2}(?: 0x[0-9a-fA-F]{2})*/g, `0x${SCRUBBED_VALUE}`)
  }
  // Each shape runs to the last quote, or to the end of the text when it has no closing quote (a
  // message cut at a length limit by its caller): fail closed, never leave a half-quoted value.
  return m
    .replace(/: "(?:[\s\S]*"|[\s\S]*)/, `: "${SCRUBBED_VALUE}"`)
    .replace(/\bvalue "(?:[\s\S]*" is out of range for type|[\s\S]*)/, `value "${SCRUBBED_VALUE}" is out of range for type`)
    .replace(/^"(?:[\s\S]*" is out of range for type|[\s\S]*)/, `"${SCRUBBED_VALUE}" is out of range for type`)
    .replace(/\btime zone "(?:[\s\S]*" not recognized|[\s\S]*)/, `time zone "${SCRUBBED_VALUE}" not recognized`)
    .replace(/\binvalid value "(?:[\s\S]*" for "[^"]*"|[\s\S]*)/, `invalid value "${SCRUBBED_VALUE}" for "${SCRUBBED_VALUE}"`)
}

// ── One entry point for any free text an error leaves behind ──────────────────────────────────

/**
 * Everything a stored or returned error message needs: Drizzle's `params:` tail and the value
 * Postgres quotes in its own message. Use this, not the two parts, wherever an error's text is
 * written to a table or answered to a client (#3673). Pass the error itself when you have it: its
 * exact parameters are then removed wherever they appear.
 */
export function scrubErrorText(text: string, err?: unknown): string {
  return scrubPgMessage(scrubBoundParams(text, err), pgCodeOf(err))
}

/** The same for a stack: the frames stay, the values go. */
export function scrubErrorStack(stack: string, err?: unknown): string {
  const { head, frames } = splitFrames(scrubBoundParamsInStack(stack, err))
  return scrubPgMessage(head, pgCodeOf(err)) + frames
}

/**
 * The SQLSTATE of an error that IS a pg error (code and severity), so the class 22 rule applies to
 * its own message. Not taken from a cause: a Drizzle wrapper's text is SQL with quoted identifiers,
 * which the class rule would swallow; its cause's message is scrubbed on its own, with its code.
 */
function pgCodeOf(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined
  const { code, severity } = err as { code?: unknown; severity?: unknown }
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && typeof severity === 'string' ? code : undefined
}

/** `err` as text that is safe to store or return: never the raw message of a Drizzle or pg error. */
export function safeErrorText(err: unknown): string {
  return scrubErrorText(err instanceof Error ? err.message : String(err), err)
}

/**
 * An error and its whole cause chain as one line of text, each link scrubbed on its own, so the pg
 * code of a Drizzle failure survives (`… [22P02]`) and no parameter or echoed value does. This is
 * what the worker thread flattens an error to, and what the in-process paths use so the two cannot
 * disagree (#3673).
 */
export function safeErrorChainText(err: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let cur: unknown = err
  while (cur != null && !seen.has(cur) && parts.length < 8) {
    seen.add(cur)
    if (cur instanceof Error) {
      const code = (cur as { code?: unknown }).code
      const text = scrubErrorText(cur.message, cur)
      parts.push(code != null ? `${text} [${String(code)}]` : text)
      cur = (cur as { cause?: unknown }).cause
    } else {
      parts.push(scrubErrorText(String(cur)))
      break
    }
  }
  return parts.length > 0 ? parts.join('\n  caused by: ') : scrubErrorText(String(err))
}

/**
 * Every string inside a JSON-like value, scrubbed; shape, numbers and keys unchanged. For the
 * `result` of a job row, whose phases carry error strings at depths a writer should not have to know.
 * Depth-limited and cycle-safe; anything that is not a plain value is returned as it came.
 */
export function scrubStringsDeep<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
  if (typeof value === 'string') return scrubErrorText(value) as unknown as T
  if (value === null || typeof value !== 'object' || depth > 12) return value
  if (seen.has(value as object)) return value
  seen.add(value as object)
  if (Array.isArray(value)) return value.map(v => scrubStringsDeep(v, depth + 1, seen)) as unknown as T
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubStringsDeep(v, depth + 1, seen)
  return out as T
}
