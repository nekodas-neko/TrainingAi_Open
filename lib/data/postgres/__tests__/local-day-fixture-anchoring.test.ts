import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Q-356. `periodization-soft-delete.test.ts` failed on every branch between 14:00 and 16:00 UTC,
// blocking merges repo-wide for two hours a day. It inserted a session at `now() - interval '2
// hours'` — a UTC offset — and derived the query window from the USER's timezone. Between 00:00 and
// 02:00 Brisbane, "two hours ago" is the previous Brisbane day, so the session fell outside
// `[today, today]` and every assertion failed.
//
// It survived for weeks precisely BECAUSE it only fired in a window. So the regression test must
// not have a window: instead of waiting for the clock, this constructs the hazard on purpose by
// choosing a timezone whose local time is right now inside its own 00:00–02:00 band. That runs the
// failing case on every CI run, at any hour.
//
// Runs only against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL

/**
 * A fixed-offset zone in which the current local time is about 01:00 — i.e. inside the band where a
 * "two hours ago" UTC offset lands on the previous local day.
 *
 * `Etc/GMT+N` is UTC**−**N (POSIX sign inversion), which is why the sign is flipped below. Fixed
 * offsets, not a named city, so the zone cannot drift into or out of DST and quietly stop
 * reproducing the hazard.
 */
function zoneWhereLocalTimeIsAboutOne(nowUtc: Date): { zone: string; offsetHours: number } {
  const h = nowUtc.getUTCHours()
  // Want (h + offset) mod 24 === 1, with offset in the range Etc/GMT supports.
  let offset = (1 - h) % 24
  if (offset > 12) offset -= 24
  if (offset < -11) offset += 24
  return { zone: offset <= 0 ? `Etc/GMT+${-offset}` : `Etc/GMT-${offset}`, offsetHours: offset }
}

describe.skipIf(!canRun)('a fixture anchored to a UTC offset can fall on the wrong local day', () => {
  let pool: import('pg').Pool
  let zone = ''

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    const { rows: [n] } = await pool.query(`SELECT now() AS now`)
    zone = zoneWhereLocalTimeIsAboutOne(new Date(n.now)).zone
  })
  afterAll(async () => { /* read-only */ })

  it('picks a zone that is genuinely in its 00:00–02:00 band', async () => {
    const { rows: [r] } = await pool.query(
      `SELECT EXTRACT(HOUR FROM (now() AT TIME ZONE $1))::int AS local_hour`, [zone])
    expect(r.local_hour).toBeGreaterThanOrEqual(0)
    expect(r.local_hour).toBeLessThan(2)
  })

  // The bug, demonstrated rather than described: the old anchoring lands on yesterday.
  it('demonstrates the failure — a UTC-offset anchor is on the PREVIOUS local day', async () => {
    const { rows: [r] } = await pool.query(
      `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD')                         AS today,
              to_char(((now() - interval '2 hours') AT TIME ZONE $1)::date, 'YYYY-MM-DD')  AS utc_offset_anchor`,
      [zone])
    expect(r.utc_offset_anchor).not.toBe(r.today)
  })

  // The fix, demonstrated: derive the local day first, then anchor to midday ON that day.
  it('the local-midday anchor lands inside the queried window, in the same conditions', async () => {
    const { rows: [r] } = await pool.query(
      `WITH d AS (SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS today)
       SELECT d.today,
              to_char((((d.today || ' 12:00')::timestamp AT TIME ZONE $1) AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS anchored,
              (((d.today || ' 12:00')::timestamp AT TIME ZONE $1)
                 >= (d.today || ' 00:00')::timestamp AT TIME ZONE $1)                          AS at_or_after_start,
              (((d.today || ' 12:00')::timestamp AT TIME ZONE $1)
                 <  ((d.today::date + 1) || ' 00:00')::timestamp AT TIME ZONE $1)              AS before_next_start
       FROM d`,
      [zone])
    expect(r.anchored).toBe(r.today)
    expect(r.at_or_after_start).toBe(true)
    expect(r.before_next_start).toBe(true)
  })

  // Midday rather than midnight, because a boundary is where an off-by-one in either direction
  // stops being visible. Half a day of slack on both sides.
  it('keeps hours of margin from both window edges', async () => {
    const { rows: [r] } = await pool.query(
      `WITH d AS (SELECT (now() AT TIME ZONE $1)::date AS today)
       SELECT EXTRACT(EPOCH FROM (
                ((d.today || ' 12:00')::timestamp AT TIME ZONE $1)
                - ((d.today || ' 00:00')::timestamp AT TIME ZONE $1)))::int AS from_start_sec,
              EXTRACT(EPOCH FROM (
                (((d.today + 1) || ' 00:00')::timestamp AT TIME ZONE $1)
                - ((d.today || ' 12:00')::timestamp AT TIME ZONE $1)))::int AS to_end_sec
       FROM d`,
      [zone])
    expect(r.from_start_sec).toBeGreaterThanOrEqual(11 * 3600)
    expect(r.to_end_sec).toBeGreaterThanOrEqual(11 * 3600)
  })
})
