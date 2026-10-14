/**
 * The `DataSourceConnector` shape (#2858, part 1 of #2808), proposed in
 * `docs/data-source-connector-guide.md` §10 and built here for the first source that needs it: the
 * Oura Cloud API.
 *
 * A connector is a declaration, not a plugin. It says what a source is (its tier, whether it feeds
 * the scored pipeline, the `HealthSource` its writes carry), which data types it can supply, and
 * which routes carry its data. The existing sources (BLE ring, Health Connect, strap, scale, Colmi)
 * still follow the convention by hand; giving each an entry is PS-40's registry work, not this
 * part's.
 *
 * Driver-free on purpose, like `source-rank.ts`: the connect screen (part 4) reads it on the client.
 */
import type { HealthSource } from './source-rank'

/** The §3 data-type catalog: what a source can hand the pipeline. */
export type DataType =
  | 'heart_rate_series'
  | 'rr_intervals'
  | 'sleep_session'
  | 'daily_body_metrics'
  | 'activity_session'
  | 'raw_signal'

/** How a source reaches the server. A cloud source needs an account connection first. */
export type ConnectorTransport = 'ble' | 'health_connect' | 'cloud_api' | 'manual'

/** The routes that connect and disconnect a per-user account (cloud sources only). */
export interface ConnectorAccountRoutes {
  /** POST starts a connection and returns the URL to open; GET with `?ticket=` sends the browser on. */
  connect: string
  /** Where the provider sends the browser back. Must match the URI registered with the provider. */
  callback: string
  /** POST: a native client finishes a connection with its own bearer (the browser leg has no session). */
  complete: string
  /** GET reports whether an account is connected; DELETE revokes and forgets it. */
  connection: string
}

interface ConnectorBase {
  /** Stable identifier, e.g. `'oura_cloud'`. */
  id: string
  transport: ConnectorTransport
  tier: 'raw' | 'computed' | 'manual'
  /** Which data types (§3) this source can provide. */
  supplies: readonly DataType[]
  /** The route its live data arrives on, or `null` when that part is not built yet. */
  ingestRoute: string | null
  /** Absent = no backfill capability (§9.2). */
  backfill?: {
    maxDaysPerCall: number
    route: string
  }
  /** Present for a source the user connects an account to. */
  account?: ConnectorAccountRoutes
}

/** A scored source must name the `HealthSource` its writes are ranked under. */
export type DataSourceConnector =
  | (ConnectorBase & { isolation: 'scored'; healthSource: HealthSource })
  | (ConnectorBase & { isolation: 'learning_mode'; healthSource?: undefined })

/**
 * The Oura Cloud API (#2808). Its writes carry `oura_cloud`, which is already on the rank ladder for
 * the pre-re-key history. Webhooks and backfill (part 2) fill `ingestRoute` and `backfill`.
 */
export const OURA_CLOUD_CONNECTOR = {
  id: 'oura_cloud',
  transport: 'cloud_api',
  tier: 'computed',
  isolation: 'scored',
  healthSource: 'oura_cloud',
  supplies: ['heart_rate_series', 'sleep_session', 'daily_body_metrics', 'activity_session'],
  ingestRoute: null,
  account: {
    connect: '/api/oura/connect',
    callback: '/api/oura/callback',
    complete: '/api/oura/connect/complete',
    connection: '/api/oura/connection',
  },
} as const satisfies DataSourceConnector

export const DATA_SOURCE_CONNECTORS: readonly DataSourceConnector[] = [OURA_CLOUD_CONNECTOR]
