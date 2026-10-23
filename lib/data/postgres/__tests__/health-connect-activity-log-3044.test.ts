// #3044 — a Health Connect session keyed on its record id: an edit there updates the row, a delete
// there tombstones it, and nothing else is touched.
//
// Runs only against a real local dev Postgres — skips cleanly without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003044'
const OTHER = '00000000-0000-4000-8000-000000003045'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('Health Connect activity logs keyed on the record id (#3044)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  // Rolling, so no window edge is hardcoded: a week ago, and the middle of the window.
  const today = todayInTz(TZ)
  const day = shiftDateStr(today, -3)

  const walk = (over: Partial<import('@/lib/data/repository').HealthConnectActivityLogInput> = {}) => ({
    date: day, activityType: 'walk', title: 'Walk', startTime: '12:00', endTime: '12:40', durationMin: 40, ...over,
  })
  const rows = async () => (await pool.query(
    `SELECT external_id, external_source, date::text, start_time::text, duration_min, title,
            deleted_at IS NOT NULL AS deleted, updated_at
       FROM activity_logs WHERE user_id = $1 ORDER BY start_time`, [USER],
  )).rows

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
         ON CONFLICT (id) DO NOTHING`,
        [id, `hc3044-${id}@example.com`, TZ],
      )
    }
  })

  beforeEach(async () => { await pool.query(`DELETE FROM activity_logs WHERE user_id = ANY($1)`, [[USER, OTHER]]) })
  // The window sweep spares rows stored or changed in the last 15 minutes, so this backdates them.
  // `trg_set_updated_at` stamps now() on every update, so it is bypassed for this one statement.
  const age = async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SET LOCAL session_replication_role = replica`)
      await client.query(`UPDATE activity_logs SET updated_at = now() - interval '1 hour' WHERE user_id = $1`, [USER])
      await client.query('COMMIT')
    } finally {
      client.release()
    }
  }

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM activity_logs WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]])
  })

  it('stores a session under its record id and source', async () => {
    expect(await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())).toBe('inserted')
    expect(await rows()).toMatchObject([{ external_id: 'hc-1', external_source: 'health_connect', start_time: '12:00:00', deleted: false }])
  })

  it('an edit that moves the start updates the row instead of adding one', async () => {
    await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())
    expect(await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk({ startTime: '12:10', durationMin: 30 }))).toBe('updated')
    expect(await rows()).toMatchObject([{ external_id: 'hc-1', start_time: '12:10:00', duration_min: 30 }])
  })

  it('keeps a title changed in the app', async () => {
    await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())
    await pool.query(`UPDATE activity_logs SET title = 'Dog walk' WHERE user_id = $1`, [USER])
    await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk({ durationMin: 41 }))
    expect((await rows())[0].title).toBe('Dog walk')
  })

  it('leaves an unchanged re-read alone, so it is not sent to every device again', async () => {
    await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())
    const [before] = await rows()
    expect(await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())).toBe('unchanged')
    expect((await rows())[0].updated_at).toEqual(before.updated_at)
  })

  it('a row deleted in the app stays deleted when the session is read again', async () => {
    await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())
    await pool.query(`UPDATE activity_logs SET deleted_at = now() WHERE user_id = $1`, [USER])
    expect(await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk({ durationMin: 45 }))).toBe('deleted')
    expect(await rows()).toMatchObject([{ deleted: true, duration_min: 40 }])
  })

  it('an in-app log at the same minute keeps it', async () => {
    await repo.saveActivityLog(USER, { ...walk(), id: randomUUID(), title: 'In-app walk' }, { overwrite: true })
    expect(await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())).toBe('taken')
    expect(await rows()).toMatchObject([{ title: 'In-app walk', external_id: null }])
  })

  it('an edit onto another row’s minute leaves both rows as they were', async () => {
    await repo.saveActivityLog(USER, { ...walk({ startTime: '13:00', endTime: '13:30', durationMin: 30 }), id: randomUUID() }, { overwrite: true })
    await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())
    expect(await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk({ startTime: '13:00' }))).toBe('taken')
    expect((await rows()).map(r => r.start_time)).toEqual(['12:00:00', '13:00:00'])
  })

  it('tombstones a Health Connect row in the window that did not come back, and nothing else', async () => {
    await repo.upsertHealthConnectActivityLog(USER, 'gone', walk())
    await repo.upsertHealthConnectActivityLog(USER, 'kept', walk({ startTime: '14:00', endTime: '14:30', durationMin: 30 }))
    await repo.upsertHealthConnectActivityLog(USER, 'older', walk({ date: shiftDateStr(today, -20) }))
    await repo.saveActivityLog(USER, { ...walk({ startTime: '15:00', endTime: '15:30', durationMin: 30 }), id: randomUUID() }, { overwrite: true })
    await age()

    const n = await repo.tombstoneHealthConnectActivityLogs(USER, { from: shiftDateStr(today, -6), to: today, keep: ['kept'] })
    expect(n).toBe(1)
    const byId = Object.fromEntries((await rows()).map(r => [r.external_id ?? 'in-app', r.deleted]))
    expect(byId).toEqual({ gone: true, kept: false, older: false, 'in-app': false })
  })

  it('tombstones by record id for a deletion feed, and never a hard delete', async () => {
    await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())
    expect(await repo.tombstoneHealthConnectActivityLogs(USER, { ids: ['hc-1', 'unknown'] })).toBe(1)
    expect(await rows()).toMatchObject([{ external_id: 'hc-1', deleted: true }])
    expect(await repo.tombstoneHealthConnectActivityLogs(USER, { ids: [] })).toBe(0)
  })

  it('never reaches another user’s row', async () => {
    await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())
    await age()
    expect(await repo.tombstoneHealthConnectActivityLogs(OTHER, { ids: ['hc-1'] })).toBe(0)
    expect(await repo.tombstoneHealthConnectActivityLogs(OTHER, { from: day, to: day, keep: [] })).toBe(0)
    expect((await rows())[0].deleted).toBe(false)
  })

  it('another user sending the same record id gets a row of their own and never touches this one', async () => {
    await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())
    expect(await repo.upsertHealthConnectActivityLog(OTHER, 'hc-1', walk({ startTime: '12:30', durationMin: 10 }))).toBe('inserted')
    expect(await rows()).toMatchObject([{ external_id: 'hc-1', start_time: '12:00:00', duration_min: 40 }])
  })

  it('spares a session stored in the last 15 minutes from the window sweep', async () => {
    await repo.upsertHealthConnectActivityLog(USER, 'just-stored', walk())
    expect(await repo.tombstoneHealthConnectActivityLogs(USER, { from: day, to: day, keep: [] })).toBe(0)
    expect((await rows())[0].deleted).toBe(false)
  })

  it('a new record at the minute of a swept Health Connect row takes the row over', async () => {
    await repo.upsertHealthConnectActivityLog(USER, 'old', walk())
    await age()
    await repo.tombstoneHealthConnectActivityLogs(USER, { from: day, to: day, keep: [] })
    expect(await repo.upsertHealthConnectActivityLog(USER, 'new', walk({ title: 'Walk again', durationMin: 35 }))).toBe('inserted')
    expect(await rows()).toMatchObject([{ external_id: 'new', title: 'Walk again', duration_min: 35, deleted: false }])
  })

  it('never takes over an in-app log the owner deleted', async () => {
    const id = randomUUID()
    await repo.saveActivityLog(USER, { ...walk(), id, title: 'In-app walk' }, { overwrite: true })
    await repo.deleteActivityLog(USER, id)
    expect(await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())).toBe('taken')
    expect(await rows()).toMatchObject([{ title: 'In-app walk', external_id: null, deleted: true }])
  })

  it('a re-created record id stays deleted: a tombstone under its own id wins', async () => {
    await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())
    await repo.tombstoneHealthConnectActivityLogs(USER, { ids: ['hc-1'] })
    expect(await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())).toBe('deleted')
    expect(await rows()).toMatchObject([{ external_id: 'hc-1', deleted: true }])
  })

  it('an in-app save at a Health Connect row’s minute makes it the in-app log, which a sync then leaves alone', async () => {
    await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())
    await repo.saveActivityLog(USER, { ...walk({ durationMin: 25, endTime: '12:25' }), id: randomUUID(), title: 'GPS walk' }, { overwrite: true })
    expect(await rows()).toMatchObject([{ title: 'GPS walk', duration_min: 25, external_id: null, external_source: null }])
    // The next sync neither resets it to Health Connect's 40 minutes nor sweeps it.
    expect(await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())).toBe('taken')
    await age()
    await repo.tombstoneHealthConnectActivityLogs(USER, { from: day, to: day, keep: [] })
    expect(await rows()).toMatchObject([{ title: 'GPS walk', duration_min: 25, deleted: false }])
  })

  it('an in-app edit of the Health Connect row itself keeps its source', async () => {
    await repo.upsertHealthConnectActivityLog(USER, 'hc-1', walk())
    const { rows: [{ id }] } = await pool.query(`SELECT id FROM activity_logs WHERE user_id = $1`, [USER])
    await repo.saveActivityLog(USER, { ...walk(), id, title: 'Renamed' }, { overwrite: true })
    expect(await rows()).toMatchObject([{ title: 'Renamed', external_id: 'hc-1', external_source: 'health_connect' }])
  })
})
