// Bundled by `readiness-centre-replay.cjs`. The projection and the curve are the shipped code,
// re-exported, so the counts the replay prints are the counts #3778 produces.
export { projectCentreShift, summariseCentreShift, syntheticStoredRows, SYNTHETIC_POPULATIONS } from './readiness-centre-replay-report'
import { getPool } from '@/lib/data/postgres/client'

/** What the server says this session's `default_transaction_read_only` is. */
export async function readOnlyState(): Promise<string> {
  const { rows } = await getPool().query('SHOW default_transaction_read_only')
  return String(rows[0]?.default_transaction_read_only)
}

/** The user's stored readiness rows, oldest first. SELECT only. */
export async function storedReadinessRows(userId: string): Promise<{ day: string; score: number; contributors: unknown }[]> {
  const { rows } = await getPool().query(
    `SELECT day::text AS day, readiness_score AS score, readiness_contributors AS contributors
       FROM oura_daily_derived
      WHERE user_id = $1 AND readiness_score IS NOT NULL
      ORDER BY day`,
    [userId],
  )
  return rows.map(r => ({ day: r.day, score: Number(r.score), contributors: r.contributors }))
}

export async function closePool(): Promise<void> {
  await getPool().end()
}
