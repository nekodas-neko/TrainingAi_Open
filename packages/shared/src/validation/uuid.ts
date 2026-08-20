/**
 * The one canonical-UUID guard, shared by the route boundary and the repository layer (RV-32).
 *
 * It lives here rather than in `lib/api/route-errors.ts`, which is where it started, because that
 * module imports `next/server` — importing it into a Postgres slice would drag Next into the
 * repository layer and into the rollup worker bundle that also loads it.
 *
 * Why any of this matters: `uuid` columns reject a malformed value at the driver with
 * `22P02 invalid_text_representation`, which surfaces as an opaque 500 on a request that is plainly
 * a 400.
 */

/** A v1–v8 UUID in canonical hyphenated form. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}
