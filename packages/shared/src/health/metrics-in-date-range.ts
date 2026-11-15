/**
 * The rows of a wider date-keyed read that a narrower read would have returned (#3793): `from` and
 * `to` inclusive, in the wider read's order. Lets a route read a table once over the widest window
 * it needs and slice the rest, instead of one round trip per window.
 *
 * Both bounds and every row's `date` must be `YYYY-MM-DD` (what Postgres `date` columns return and
 * `todayInTz` produces): the comparison is on the strings, which orders that form exactly as the
 * database orders dates. A slash-form bound would compare wrongly, so it throws rather than
 * returning a silently wrong slice.
 */
export function metricsInDateRange<T extends { date: string }>(rows: readonly T[], from: string, to: string): T[] {
  for (const bound of [from, to]) {
    if (bound.length !== 10 || bound[4] !== '-' || bound[7] !== '-') {
      throw new Error(`metricsInDateRange: bound must be YYYY-MM-DD, got ${bound}`)
    }
  }
  return rows.filter(r => r.date >= from && r.date <= to)
}
