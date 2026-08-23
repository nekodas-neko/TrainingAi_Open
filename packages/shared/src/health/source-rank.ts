/**
 * The health-source precedence ladder, in one place and free of any database driver.
 *
 * `manual > scale_ble > oura_ble > oura_cloud > health_connect > unknown(legacy)`. A direct scale
 * reading is a real device measurement, so it outranks the ring; the user's own entry still
 * outranks the scale. `oura_cloud` keeps its rung even though nothing writes at it any more —
 * every pre-re-key row's stored `source_map` still names it, and a live BLE write has to out-rank
 * those rows rather than tie them.
 *
 * It lives here rather than in `lib/data/health-source.ts` because the rank is also read by the
 * Oura rollup, which is runtime-agnostic (`lib/oura-ble/rollup/run.ts`) — importing it from the
 * `lib/data` module dragged `drizzle-orm` into a graph that must be able to run in a WebView.
 * `mergeSet` and the rest of the SQL-building half stay there and import this.
 */

export const HEALTH_SOURCES = ['health_connect', 'oura_cloud', 'oura_ble', 'scale_ble', 'manual'] as const
export type HealthSource = (typeof HEALTH_SOURCES)[number]

/** Ascending precedence. Anything absent here — including `null` on a legacy row — ranks 0. */
export const SOURCE_RANK: Record<HealthSource, number> = {
  health_connect: 1,
  oura_cloud: 2,
  oura_ble: 3,
  scale_ble: 4,
  manual: 5,
}

/** Precedence rank; null/unknown (legacy rows written before provenance existed) rank 0. */
export function sourceRank(source: string | null | undefined): number {
  return source && source in SOURCE_RANK ? SOURCE_RANK[source as HealthSource] : 0
}
