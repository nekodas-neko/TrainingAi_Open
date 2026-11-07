import { sql, type AnyColumn, type SQL } from 'drizzle-orm'

/**
 * `ORDER BY date_trunc('milliseconds', <col>) FETCH FIRST <limit> ROWS WITH TIES`, for one page of a
 * sync pull (#3672).
 *
 * A plain `LIMIT` could end a page in the middle of a group of rows sharing one `updated_at`, and the
 * trigger stamps every row of one transaction with the same `now()` (a merge, a catalogue rename, a
 * broad migration). The cursor could not step into the middle of a group, so a group larger than a
 * page came back as the same page forever.
 *
 * The page now ends on a whole millisecond: `WITH TIES` keeps every row of the last row's
 * millisecond in the page, so a page can hold more than `limit` rows. The tie is on the millisecond
 * rather than the raw stamp because the cursor travels as a JS Date, which has no microseconds: the
 * cursor is that millisecond, and the next page reads from the millisecond after it
 * (`getSyncDelta`'s `pagedSince`). Postgres 13 and up.
 *
 * Drizzle has no builder for the clause, so it rides as the ORDER BY's last term: the query must not
 * also call `.limit()` or `.offset()`, which Drizzle would print after it.
 */
export function pageWithTies(col: AnyColumn, limit: number): SQL {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`pageWithTies: bad page limit ${limit}`)
  return sql`date_trunc('milliseconds', ${col}) asc fetch first ${sql.raw(String(limit))} rows with ties`
}
