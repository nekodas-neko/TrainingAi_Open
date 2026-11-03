import { sql } from 'drizzle-orm'
import type { getDb } from '../client'
import type { HealthSource } from '../../health-source'
import { NIGHT_HRV_METHODS, nightHrvMethodKey, type NightHrvMethod } from '@trainingai/shared/health/night-hrv-method'

type Db = ReturnType<typeof getDb>

/**
 * #3376. Stamps how a day's `body_metrics.hrv_ms` was reached (`night-hrv-method.ts`), for any source.
 * Runs after the ranked write, and only where `source` won the field: a write that lost the merge
 * leaves the winner's provenance alone. Any previous method mark is replaced, so a night that moved
 * from the source's average to a series median (a late-arriving series) loses the old mark.
 * Returns the number of rows stamped (0 or 1).
 */
export async function stampNightHrvMethod(
  db: Db, userId: string, date: string, source: HealthSource, method: NightHrvMethod,
): Promise<number> {
  const stale = sql.join(NIGHT_HRV_METHODS.map(m => sql`${nightHrvMethodKey(m)}::text`), sql`, `)
  const rows = await db.execute(sql`
    UPDATE body_metrics
       SET source_map = (COALESCE(source_map, '{}'::jsonb) - ARRAY[${stale}])
                        || jsonb_build_object(${nightHrvMethodKey(method)}::text, ${source}::text)
     WHERE user_id = ${userId} AND date = ${date}::date AND deleted_at IS NULL
       AND source_map->>'hrv_ms' = ${source}::text
     RETURNING 1`)
  return rows.rows.length
}
