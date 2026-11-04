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

/**
 * #3597: what a source's data can show, declared once on the source. Scoring reads these, never the
 * source's id, so a new device with the same properties is scored the same way the moment it
 * declares them (owner, 3 Nov: a source is a source, not the product).
 */
export interface SourceCapabilities {
  /**
   * How the source's heart-rate series is spaced, which decides how Activity's density rule
   * (#2437) reads it:
   * - `continuous`: dense by construction (a strap, a ring logging every 5 minutes). No gate.
   * - `sparse_by_hour`: may thin out. An hour of its readings counts only when it is dense across
   *   the worn part of the hour.
   * - `dense_in_stretches`: sparse overall, dense only in stretches (a workout). A reading counts
   *   only inside a run of readings no further apart than the ring's own cadence.
   */
  heartRateSpacing: 'continuous' | 'sparse_by_hour' | 'dense_in_stretches'
  /** Whether its heart rate can say the user moved in a given hour. False when the series is too
   *  thin while awake to tell (#3114): a moved hour then comes from a movement series instead. */
  heartRateDecidesMovedHour: boolean
  /** Whether it supplies a per-minute movement series (MET per minute, with non-wear marked). */
  perMinuteMovement: boolean
}

/** What a source with no declaration is taken to be: a dense heart-rate series that can say an
 *  hour was moved, and no movement series. The ring over BLE, the strap and a typed value are this. */
export const DEFAULT_SOURCE_CAPABILITIES: SourceCapabilities = {
  heartRateSpacing: 'continuous',
  heartRateDecidesMovedHour: true,
  perMinuteMovement: false,
}

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
  /** What its data can show (#3597). */
  capabilities: SourceCapabilities
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
  // Since the switch to the API the ring serves 5-minute points at rest and asleep, irregular bursts
  // while awake and 5-second points only inside an Oura-app workout (#3114), plus `daily_activity.met`
  // per minute with a 5-minute wear class.
  capabilities: {
    heartRateSpacing: 'dense_in_stretches',
    heartRateDecidesMovedHour: false,
    perMinuteMovement: true,
  },
  account: {
    connect: '/api/oura/connect',
    callback: '/api/oura/callback',
    complete: '/api/oura/connect/complete',
    connection: '/api/oura/connection',
  },
} as const satisfies DataSourceConnector

export const DATA_SOURCE_CONNECTORS: readonly DataSourceConnector[] = [OURA_CLOUD_CONNECTOR]

/**
 * Capabilities for the sources that write heart rate but have no connector entry yet (giving each one
 * is PS-40's registry work). Health Connect and Apple Health relay whatever the phone's apps wrote,
 * which can be one reading every ten minutes, so each hour is judged on its own (#2437). Neither feeds
 * a movement series into scoring today. A source in neither list takes `DEFAULT_SOURCE_CAPABILITIES`.
 */
const UNREGISTERED_SOURCE_CAPABILITIES: Readonly<Partial<Record<HealthSource, SourceCapabilities>>> = {
  health_connect: { heartRateSpacing: 'sparse_by_hour', heartRateDecidesMovedHour: true, perMinuteMovement: false },
  health_connect_native: { heartRateSpacing: 'sparse_by_hour', heartRateDecidesMovedHour: true, perMinuteMovement: false },
  apple_health: { heartRateSpacing: 'sparse_by_hour', heartRateDecidesMovedHour: true, perMinuteMovement: false },
}

const CAPABILITIES_BY_SOURCE: ReadonlyMap<string, SourceCapabilities> = new Map<string, SourceCapabilities>([
  ...Object.entries(UNREGISTERED_SOURCE_CAPABILITIES) as [string, SourceCapabilities][],
  ...DATA_SOURCE_CONNECTORS.flatMap(c => [[c.id, c.capabilities], ...(c.healthSource ? [[c.healthSource, c.capabilities]] : [])] as [string, SourceCapabilities][]),
])

/** The capabilities of the source a stored row names (its `source` / `HealthSource`, or a connector id). */
export function sourceCapabilities(source: string | null | undefined): SourceCapabilities {
  return (source != null ? CAPABILITIES_BY_SOURCE.get(source) : undefined) ?? DEFAULT_SOURCE_CAPABILITIES
}

/** Every declared source name whose capabilities pass `test`: for a reader that has to name them,
 *  such as a SQL filter. A source that is not declared has the defaults and is never listed. */
export function sourcesWith(test: (c: SourceCapabilities) => boolean): string[] {
  return [...CAPABILITIES_BY_SOURCE].filter(([, c]) => test(c)).map(([name]) => name)
}
