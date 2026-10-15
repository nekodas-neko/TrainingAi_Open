// Bundled by `activity-finalise-replay-2435.cjs`. The scoring is the shipped loader, re-exported, so
// the count the replay prints is the count the finalise would produce. The repository is built
// directly rather than through `getRepository`, which would run migrations.
export { PostgresWorkoutRepository } from '@/lib/data/postgres/adapter'
export { loadActivityDay } from '@trainingai/shared/health/activity-day-load'
export { activityFinalisedAt } from '@trainingai/shared/health/activity-day'
export { todayInTz, shiftDateStr, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { getPool } from '@/lib/data/postgres/client'

/** What the server says this session's `default_transaction_read_only` is. */
export async function readOnlyState(): Promise<string> {
  const { rows } = await getPool().query('SHOW default_transaction_read_only')
  return String(rows[0]?.default_transaction_read_only)
}
