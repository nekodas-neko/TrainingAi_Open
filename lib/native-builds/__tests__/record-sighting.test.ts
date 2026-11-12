// #3739. `native_build_sightings` and its one writer, against a real Postgres: the upsert creates a
// row then counts into it, the in-memory throttle holds a second call in the same minute, a missing
// or malformed header writes nothing, the day is the user's local day either side of midnight, and
// the rows go with the account.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'

vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000373901'
const DOOMED = '00000000-0000-4000-8000-0000003739d1'

const native = (build: string | null, version: string | null = '0.2.0') => {
  const h = new Headers()
  if (build !== null) h.set('X-App-Build', build)
  if (version !== null) h.set('X-App-Version', version)
  return h
}

describe.skipIf(!canRun)('native_build_sightings (#3739)', () => {
  let pool: import('pg').Pool
  let mod: typeof import('../record-sighting')
  const rows = async (userId = USER) =>
    (await pool.query(
      `SELECT build_code, version_name, to_char(day, 'YYYY-MM-DD') AS day, request_count,
              first_seen_at, last_seen_at
         FROM native_build_sightings WHERE user_id = $1 ORDER BY day, build_code`,
      [userId],
    )).rows

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    mod = await import('../record-sighting')
    for (const id of [USER, DOOMED]) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')`,
        [id, `native-build-${id.slice(-4)}@example.com`],
      )
    }
  })

  beforeEach(async () => {
    mod.resetSightingThrottleForTests()
    await pool.query(`DELETE FROM native_build_sightings WHERE user_id = ANY($1::uuid[])`, [[USER, DOOMED]])
  })

  afterEach(() => { vi.useRealTimers() })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER, DOOMED]])
  })

  it('creates a row on the first sighting, then increments it in a later minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T02:00:00Z')) // 12:00 in Brisbane
    await mod.recordNativeBuildSighting(native('2000201'), USER, 'Australia/Brisbane')
    let r = await rows()
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ build_code: 2000201, version_name: '0.2.0', day: '2026-11-12', request_count: 1 })

    vi.setSystemTime(new Date('2026-11-12T02:01:00Z'))
    await mod.recordNativeBuildSighting(native('2000201'), USER, 'Australia/Brisbane')
    r = await rows()
    expect(r).toHaveLength(1)
    expect(r[0].request_count).toBe(2)
    expect(new Date(r[0].last_seen_at).getTime()).toBeGreaterThanOrEqual(new Date(r[0].first_seen_at).getTime())
  })

  it('throttles a second call for the same user and build inside one minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T02:00:00Z'))
    const first = mod.recordNativeBuildSighting(native('2000201'), USER, 'Australia/Brisbane')
    expect(first).toBeInstanceOf(Promise)
    await first
    vi.setSystemTime(new Date('2026-11-12T02:00:59Z'))
    expect(mod.recordNativeBuildSighting(native('2000201'), USER, 'Australia/Brisbane')).toBeUndefined()
    // A different build is its own key.
    await mod.recordNativeBuildSighting(native('2000202'), USER, 'Australia/Brisbane')
    const r = await rows()
    expect(r.map(x => [x.build_code, x.request_count])).toEqual([[2000201, 1], [2000202, 1]])
  })

  it.each([
    ['no headers (the web app)', native(null, null)],
    ['an empty build', native('')],
    ['a leading zero', native('0123')],
    ['a negative build', native('-5')],
    ['a non-numeric build', native('12a')],
    ['eleven digits', native('12345678901')],
    ['past int4', native('2147483648')],
    ['a version over 40 characters', native('512', 'x'.repeat(41))],
    ['a version with a control character', native('512', 'v1\t2')],
    ['a non-ASCII version', native('512', 'vé')],
  ])('writes nothing for %s', async (_label, headers) => {
    expect(mod.recordNativeBuildSighting(headers, USER, 'Australia/Brisbane')).toBeUndefined()
    expect(await rows()).toHaveLength(0)
  })

  it('stores a build with no version header, with a null version', async () => {
    await mod.recordNativeBuildSighting(native('512', null), USER, 'Australia/Brisbane')
    expect(await rows()).toMatchObject([{ build_code: 512, version_name: null, request_count: 1 }])
  })

  it('files the sighting under the user\'s local day either side of local midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 23:59 on 11 Nov in Brisbane (UTC+10) — UTC already says 11 Nov 13:59, so a UTC slice would agree here…
    vi.setSystemTime(new Date('2026-11-11T13:59:00Z'))
    await mod.recordNativeBuildSighting(native('512'), USER, 'Australia/Brisbane')
    // …00:01 on 12 Nov in Brisbane is still 11 Nov in UTC; a UTC slice would put it on the 11th.
    vi.setSystemTime(new Date('2026-11-11T14:01:00Z'))
    await mod.recordNativeBuildSighting(native('512'), USER, 'Australia/Brisbane')
    expect((await rows()).map(x => [x.day, x.request_count])).toEqual([['2026-11-11', 1], ['2026-11-12', 1]])
  })

  it('a write failure is reported and swallowed, never thrown', async () => {
    const { reportServerError } = await import('@/lib/observability')
    const p = mod.recordNativeBuildSighting(native('512'), '00000000-0000-4000-8000-00000000dead', 'Australia/Brisbane')
    await expect(p).resolves.toBeUndefined() // FK violation: no such user
    expect(reportServerError).toHaveBeenCalledTimes(1)
  })

  it('an invalid timezone records nothing and does not throw', () => {
    expect(mod.recordNativeBuildSighting(native('512'), USER, 'Not/AZone')).toBeUndefined()
  })

  it('the rows go with the account', async () => {
    await mod.recordNativeBuildSighting(native('512'), DOOMED, 'Australia/Brisbane')
    expect(await rows(DOOMED)).toHaveLength(1)
    await pool.query(`DELETE FROM users WHERE id = $1`, [DOOMED])
    expect(await rows(DOOMED)).toHaveLength(0)
  })
})
