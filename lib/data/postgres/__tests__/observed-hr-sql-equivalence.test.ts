// RV-181 — `getObservedHrProfile` computes in SQL what `computeObservedHr` computes in JavaScript
// over `getHrForWindow`'s rows, so that the seven callers of `resolveHrProfile` stop dragging 90
// days of raw heart rate back to read six numbers off it.
//
// **The equivalence is the whole change**, so it is tested rather than argued: every case below
// runs BOTH paths over the same rows in the same window and compares the two profiles field for
// field. Nothing here asserts a hand-written expected value — an expectation copied from one side
// would pass while both sides were wrong together.
//
// The cases are chosen where the two implementations could plausibly diverge: the chest-strap
// bucket merge (including a strap row that sits outside the window and so must NOT thin a ring row
// inside it), the plausibility band at both edges, the corroboration depth either side of k, the
// reliability gate either side of its threshold, ties at the k-th value, and rows landing exactly
// on each inclusive end of the window.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  computeObservedHr, CORROBORATION, MIN_RELIABLE_SAMPLES,
  PLAUSIBLE_MIN_BPM, PLAUSIBLE_MAX_BPM,
} from '@trainingai/shared/health/observed-hr'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000hr181'.replace('0000000hr181', '00000000a181')
const OTHER = '00000000-0000-4000-8000-00000000a182'

/** The window every case is written against. `BASE` is well clear of both ends. */
const FROM = new Date('2026-05-01T00:00:00.000Z')
const TO = new Date('2026-05-31T00:00:00.000Z')
const BASE = new Date('2026-05-15T00:00:00.000Z').getTime()

type Row = { at: Date; bpm: number; source: string | null }
/** `n` seconds past BASE — `n` may be fractional, which is how a 10-second bucket gets shared. */
const at = (n: number) => new Date(BASE + n * 1000)
const ring = (n: number, bpm: number): Row => ({ at: at(n), bpm, source: 'ble' })
const strap = (n: number, bpm: number): Row => ({ at: at(n), bpm, source: 'chest_strap' })

describe.skipIf(!canRun)('getObservedHrProfile — SQL matches computeObservedHr', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let oura: typeof import('@/lib/data/postgres/slices/oura')

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    db = client.getDb()
    oura = await import('@/lib/data/postgres/slices/oura')
    for (const [id, tag] of [[USER, 'owner'], [OTHER, 'other']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `rv181-${tag}@example.com`])
    }
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = ANY($1)`, [[USER, OTHER]])
  })

  async function seed(rows: Row[], userId = USER) {
    if (!rows.length) return
    await pool.query(
      `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source)
       SELECT $1, ts, bpm, src FROM unnest($2::timestamptz[], $3::int[], $4::text[]) AS t(ts, bpm, src)
       ON CONFLICT (user_id, timestamp) DO UPDATE SET bpm = excluded.bpm, source = excluded.source`,
      [userId, rows.map(r => r.at.toISOString()), rows.map(r => r.bpm), rows.map(r => r.source)],
    )
  }

  /** Run both paths over the same window and assert they agree. Returns the profile so a case can
   *  also state what it believes the shared answer to be. */
  async function bothAgree(from = FROM, to = TO) {
    const viaRows = computeObservedHr((await oura.getHrForWindow(db, USER, from, to)).map(r => r.bpm))
    const viaSql = await oura.getObservedHrProfile(db, USER, from, to)
    expect(viaSql).toEqual(viaRows)
    return viaSql
  }

  const flat = (bpm: number, n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => ring(from + i * 60, bpm))

  it('agrees on an empty window', async () => {
    const p = await bothAgree()
    expect(p.sampleCount).toBe(0)
    expect(p.avg).toBeNull()
  })

  it('agrees on a single reading — under the corroboration depth, so there is no max', async () => {
    await seed([ring(0, 140)])
    const p = await bothAgree()
    expect(p.sampleCount).toBe(1)
    expect(p.max).toBeNull()
    expect(p.avg).toBe(140)
  })

  it('agrees either side of the corroboration depth', async () => {
    await seed(flat(150, CORROBORATION - 1))
    expect((await bothAgree()).max).toBeNull()

    await seed(flat(150, CORROBORATION))
    expect((await bothAgree()).max).toBe(150)
  })

  it('agrees either side of the reliability threshold', async () => {
    await seed(flat(150, MIN_RELIABLE_SAMPLES - 1))
    expect((await bothAgree()).isReliable).toBe(false)

    await seed(flat(150, MIN_RELIABLE_SAMPLES))
    expect((await bothAgree()).isReliable).toBe(true)
  })

  it('agrees on the k-th order statistic with a spike above it', async () => {
    // Four readings above the plateau — one short of corroborating a new max, which is the rule
    // an ORDER BY / OFFSET has to reproduce exactly rather than approximately.
    await seed([...flat(150, 80), ring(9001, 210), ring(9061, 205), ring(9121, 200), ring(9181, 195)])
    const p = await bothAgree()
    expect(p.max).toBe(150)
    expect(p.highestPlausible).toBe(210)
  })

  it('agrees when the k-th value is tied, which is the case a distinct-value rule gets wrong', async () => {
    await seed([...flat(150, 80), ...flat(180, CORROBORATION + 3, 9001)])
    expect((await bothAgree()).max).toBe(180)
  })

  it('agrees at both edges of the plausibility band', async () => {
    await seed([
      ...flat(150, 70),
      ring(9001, PLAUSIBLE_MIN_BPM), ring(9061, PLAUSIBLE_MIN_BPM - 1),
      ring(9121, PLAUSIBLE_MAX_BPM), ring(9181, PLAUSIBLE_MAX_BPM + 1),
    ])
    const p = await bothAgree()
    // The two rows OUTSIDE the band are rejected; the two ON it are kept.
    expect(p.outOfBandRejected).toBe(2)
    expect(p.highestPlausible).toBe(PLAUSIBLE_MAX_BPM)
  })

  it('agrees on a window that is entirely out of band', async () => {
    await seed([ring(0, 10), ring(60, 250), ring(120, 300)])
    const p = await bothAgree()
    expect(p.sampleCount).toBe(0)
    expect(p.outOfBandRejected).toBe(3)
  })

  it('agrees when a chest-strap row thins the ring rows sharing its 10-second bucket', async () => {
    // 0.0 and 9.9 are the same bucket; 10.0 starts the next one. The strap row at 0.5 drops the
    // two ring rows beside it and leaves the third.
    // The plateau starts at 1000 s so it shares no bucket with the rows under test — the counting
    // here is the assertion, and a stray plateau row in bucket 0 would silently absorb a miss.
    await seed([...flat(150, 70, 1000), strap(0.5, 190), ring(0.1, 60), ring(9.9, 61), ring(10.1, 62)])
    const p = await bothAgree()
    expect(p.min).not.toBe(60)
    expect(p.sampleCount).toBe(70 + 1 + 1)
  })

  it('agrees that a strap row never thins its own stream', async () => {
    await seed([...flat(150, 70, 1000), strap(0.1, 100), strap(0.5, 101), strap(9.9, 102)])
    expect((await bothAgree()).sampleCount).toBe(73)
  })

  it('agrees that a strap row OUTSIDE the window does not thin a ring row inside it', async () => {
    // `preferStrapBuckets` builds its bucket set from the rows IN THE WINDOW, so a strap row just
    // past the end has no say over a ring row just inside it — even though the two share a bucket.
    //
    // **The straddling bucket is the entire test, and the first version of it missed that.** It
    // put both rows past the end, where the ring row was already excluded for its own sake; the
    // mutation that drops the window bounds from the strap subquery survived it untouched. The
    // window ends at 600 s and buckets are ten seconds wide, so 600 and 605 are the same bucket
    // with the boundary between them: the ring row at 600 is the last row IN, the strap row at
    // 605 is the first row OUT, and only a subquery carrying the window bounds keeps the first.
    const from = at(0)
    const to = at(600)
    await seed([...flat(150, 8, 60), ring(600, 70), strap(605, 190)])
    const viaRows = computeObservedHr((await oura.getHrForWindow(db, USER, from, to)).map(r => r.bpm))
    const viaSql = await oura.getObservedHrProfile(db, USER, from, to)
    expect(viaSql).toEqual(viaRows)
    expect(viaSql.sampleCount, 'the ring row sharing a bucket with the out-of-window strap row was dropped')
      .toBe(9)
  })

  it('agrees on rows landing exactly on each inclusive end of the window', async () => {
    const from = at(0)
    const to = at(600)
    await seed([ring(0, 100), ...flat(150, 8, 60), ring(600, 101), ring(601, 199)])
    const viaRows = computeObservedHr((await oura.getHrForWindow(db, USER, from, to)).map(r => r.bpm))
    const viaSql = await oura.getObservedHrProfile(db, USER, from, to)
    expect(viaSql).toEqual(viaRows)
    // Both ends inclusive: the two boundary rows are in, the one past the end is not.
    expect(viaSql.sampleCount).toBe(10)
    expect(viaSql.highestPlausible).toBe(150)
  })

  it("agrees, and neither path sees another user's rows", async () => {
    await seed(flat(150, 70))
    await seed([...flat(200, 70), strap(0.5, 210)], OTHER)
    const p = await bothAgree()
    expect(p.sampleCount).toBe(70)
    expect(p.highestPlausible).toBe(150)
  })

  it('agrees on a mixed window with every rule in play at once', async () => {
    await seed([
      ...flat(150, 60),
      ...flat(168, CORROBORATION, 9001),
      ring(20000, 250), ring(20060, 12),
      strap(30000.2, 175), ring(30000.4, 90), ring(30009.9, 91), ring(30010.1, 92),
      strap(30020.0, 176), strap(30020.5, 177),
    ])
    const p = await bothAgree()
    expect(p.isReliable).toBe(true)
    expect(p.outOfBandRejected).toBe(2)
  })
})
