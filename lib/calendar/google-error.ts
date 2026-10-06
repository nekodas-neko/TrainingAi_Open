/**
 * Whether a failed Google Calendar write means "the user never granted the calendar scope" (a
 * consent state, answered 403 and kept out of `error_events`) or something else (a fault, reported).
 *
 * #2426. The route used to match the error TEXT — "403", "forbidden", "insufficientpermissions" or
 * "calendar" — so nearly every Google failure, whose message names the calendar, was filed as a
 * consent state and never reached `error_events`. It also compared `code` to the string
 * `'ERR_HTTP_403'`, which cannot match.
 *
 * Read from the pinned `gaxios` source (7.1.4 and 7.3.1 agree), not guessed. For an HTTP failure
 * `GaxiosError.status` is the response's numeric status, and `GaxiosError.code` is the JSON body's
 * `error.code`, a NUMBER (403), not a string. Google's reason strings live on the parsed body at
 * `response.data.error.errors[].reason`, and again on `cause.errors[].reason` (the cause is that
 * same `error` object, merged with `message`/`code`/`status`).
 *
 * A 403 is not always a missing scope: `rateLimitExceeded`, `userRateLimitExceeded` and
 * `quotaExceeded` are 403s too, and they are faults. So a 403 counts as a missing grant only when
 * its reason is `insufficientPermissions`, or when no reason can be read at all, which keeps the
 * old answer for a bare 403 rather than newly reporting it.
 */

type Row = Record<string, unknown>
const isRow = (v: unknown): v is Row => typeof v === 'object' && v !== null

/** The HTTP status Google answered with, or null when the error did not come from a response. */
export function googleErrorStatus(err: unknown): number | null {
  if (!isRow(err)) return null
  if (typeof err.status === 'number') return err.status
  if (isRow(err.response) && typeof err.response.status === 'number') return err.response.status
  // `code` is a string for a system error ('ECONNRESET') and the body's number for an API error.
  if (typeof err.code === 'number') return err.code
  return null
}

/** Every `reason` Google attached to the failure, wherever the client left it. */
export function googleErrorReasons(err: unknown): string[] {
  if (!isRow(err)) return []
  const lists: unknown[] = [
    err.errors,
    isRow(err.cause) ? err.cause.errors : undefined,
    isRow(err.response) && isRow(err.response.data) && isRow(err.response.data.error)
      ? err.response.data.error.errors : undefined,
  ]
  const reasons: string[] = []
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (isRow(item) && typeof item.reason === 'string') reasons.push(item.reason)
    }
  }
  return reasons
}

export function isCalendarScopeMissing(err: unknown): boolean {
  if (googleErrorStatus(err) !== 403) return false
  const reasons = googleErrorReasons(err)
  return reasons.length === 0 || reasons.includes('insufficientPermissions')
}
