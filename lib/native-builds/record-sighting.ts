import { getPool } from '@/lib/data/postgres/client'
import { reportServerError } from '@/lib/observability'
import { APP_BUILD_HEADER, APP_VERSION_HEADER } from '@trainingai/shared/native-min-build'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'

/**
 * #3739 — the one write path for `native_build_sightings`: which native builds still call the
 * server, one row per user, build and local day. Called from `/api/sync/pull` and `/api/sync/push`
 * after the route has resolved the user; every native build calls those on open and after a change.
 *
 * Deliberately not in auth, the bearer-token code or `middleware.ts` (auth is confirm-first, and the
 * middleware runs without the pool).
 *
 * Fire-and-forget: `recordNativeBuildSighting` returns nothing, never throws and never awaits the
 * database on the request's behalf. A failure is reported and dropped — a lost sighting costs a
 * count, a failed sync costs the user's data.
 */

// `^[1-9]\d{0,9}$` admits up to 9,999,999,999; `build_code` is a Postgres integer, so anything past
// int4 is treated as malformed rather than left to fail the insert.
const BUILD_RE = /^[1-9]\d{0,9}$/
const INT4_MAX = 2_147_483_647
// Printable ASCII only, 1–40 chars: the value is stored as text and never interpreted.
const VERSION_RE = /^[\x20-\x7E]{1,40}$/

export const SIGHTING_THROTTLE_MS = 60_000
// Bounds the throttle map if something sends many distinct builds; at this size it is cleared,
// which at worst lets one extra write per key through.
const THROTTLE_MAX_KEYS = 1_000

const lastWrite = new Map<string, number>()

export interface ParsedAppBuild { buildCode: number; versionName: string | null }

/**
 * The build headers, or null when `X-App-Build` is missing or malformed (the web app sends none).
 * A malformed `X-App-Version` makes the whole sighting null: the two are sent together, so one bad
 * value means the pair can't be trusted.
 */
export function parseAppBuildHeaders(headers: Headers): ParsedAppBuild | null {
  const rawBuild = headers.get(APP_BUILD_HEADER)
  if (rawBuild === null || !BUILD_RE.test(rawBuild)) return null
  const buildCode = Number(rawBuild)
  if (buildCode > INT4_MAX) return null
  const rawVersion = headers.get(APP_VERSION_HEADER)
  if (rawVersion === null) return { buildCode, versionName: null }
  if (!VERSION_RE.test(rawVersion)) return null
  return { buildCode, versionName: rawVersion }
}

/** The upsert, awaited. Exported for tests; routes call `recordNativeBuildSighting`. */
export async function writeNativeBuildSighting(
  userId: string, sighting: ParsedAppBuild, day: string,
): Promise<void> {
  await getPool().query(
    `INSERT INTO native_build_sightings (user_id, build_code, version_name, day)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, build_code, day) DO UPDATE SET
       last_seen_at  = now(),
       request_count = native_build_sightings.request_count + 1,
       version_name  = COALESCE(EXCLUDED.version_name, native_build_sightings.version_name)`,
    [userId, sighting.buildCode, sighting.versionName, day],
  )
}

/**
 * Record that this user's native build called the server. Throttled in memory to one write per
 * user, build and minute, so `request_count` counts throttle windows that saw a call, not requests.
 * Returns the write's promise only so tests can await it; routes ignore it.
 */
export function recordNativeBuildSighting(
  headers: Headers, userId: string, timezone: string | null | undefined,
): Promise<void> | undefined {
  try {
    const sighting = parseAppBuildHeaders(headers)
    if (!sighting) return undefined
    const key = `${userId}:${sighting.buildCode}`
    const now = Date.now()
    const last = lastWrite.get(key)
    if (last !== undefined && now - last < SIGHTING_THROTTLE_MS) return undefined
    if (lastWrite.size >= THROTTLE_MAX_KEYS) lastWrite.clear()
    lastWrite.set(key, now)
    const day = todayInTz(timezone || DEFAULT_TZ)
    return writeNativeBuildSighting(userId, sighting, day).catch((err: unknown) => {
      reportServerError(err, { userId, url: 'native-build-sighting' })
    })
  } catch (err) {
    reportServerError(err, { userId, url: 'native-build-sighting' })
    return undefined
  }
}

/** Test-only: forget the throttle. */
export function resetSightingThrottleForTests(): void {
  lastWrite.clear()
}
