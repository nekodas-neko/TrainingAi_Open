// Issue 2939: a server-side rename of an exercise stamps the logs it rewrites (`client_edited_at`,
// `updated_at`), so a stale phone replay cannot put the old name back, and phones pull the new one.
// Issue 2763: the sync delta carries every personal best, so one re-dated into the past still
// reaches a phone whose last pull is newer than the best's `achieved_at`.
//
// DB-backed, driven through `pushMutations` and `getSyncDelta`, because both depend on the real
// trigger, columns and the delta's SQL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { SUPERSEDED_WARNING } from '@trainingai/shared/sync/edited-at'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002939'
const LOGGED_AT_MS = Date.parse('2026-01-10T12:00:00+10:00')
const MIN = 60_000

describe.skipIf(!canRun)('server rename stamps the logs; the delta carries every best (issues 2939, 2763)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  function logPayload(ids: { ws: string; el: string; sets: string[] }, lift: string, editedAt: number) {
    return {
      sessionName: 'S', workoutSessionId: ids.ws, exerciseLogId: ids.el, setLogIds: ids.sets,
      exercise: lift, weights: [100, 100], sets: 2, reps: [5, 5], localDate: '2026-01-10',
      workoutStartedAt: LOGGED_AT_MS - 30 * MIN, setEndTimes: [LOGGED_AT_MS, LOGGED_AT_MS + MIN], editedAt,
    }
  }
  const freshIds = () => ({ ws: randomUUID(), el: randomUUID(), sets: [randomUUID(), randomUUID()] })
  const push = (mutations: Array<{ domain: string; payload: Record<string, unknown> }>) =>
    repo.pushMutations(USER, mutations.map(m => ({ id: randomUUID(), date: '2026-01-10', ...m })) as never)
  const logRow = async (id: string) =>
    (await pool.query(`SELECT exercise_name, client_edited_at, updated_at FROM exercise_logs WHERE id = $1`, [id])).rows[0] as
      { exercise_name: string; client_edited_at: Date | null; updated_at: Date }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, `rename-2939-${USER}@example.com`],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM personal_records WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM user_stats WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM exercise_library WHERE created_by = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  async function loggedUnderLibraryName(name: string) {
    const entry = await repo.createExercise({ name, muscles: [], equipment: [], createdBy: USER })
    const ids = freshIds()
    const first = await push([{ domain: 'workout_log', payload: logPayload(ids, name, Date.now() - 120 * MIN) }])
    expect(first.errors).toEqual([])
    return { entry, ids }
  }

  async function expectStaleReplaySuperseded(ids: ReturnType<typeof freshIds>, oldName: string, newName: string, before: Awaited<ReturnType<typeof logRow>>) {
    const mutationId = randomUUID()
    const result = await repo.pushMutations(USER, [{
      id: mutationId, domain: 'workout_log', date: '2026-01-10',
      payload: logPayload(ids, oldName, Date.now() - 60 * MIN),
    }] as never)
    expect(result.processed).toBe(1)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([{ id: mutationId, domain: 'workout_log', date: '2026-01-10', warning: SUPERSEDED_WARNING }])
    const after = await logRow(ids.el)
    expect(after.exercise_name).toBe(newName)
    expect(after.client_edited_at!.getTime()).toBeGreaterThanOrEqual(before.client_edited_at!.getTime())
  }

  it('renameExercise stamps the rewritten log, moves updated_at, and a stale replay is superseded', async () => {
    const { entry, ids } = await loggedUnderLibraryName('Rename 2939 Old A')
    const before = await logRow(ids.el)
    const setsBefore = new Date((await pool.query(`SELECT max(updated_at) AS m FROM set_logs WHERE exercise_log_id = $1`, [ids.el])).rows[0].m).getTime()

    await repo.renameExercise(USER, entry.id, 'Rename 2939 New A')

    const renamed = await logRow(ids.el)
    expect(renamed.exercise_name).toBe('Rename 2939 New A')
    expect(renamed.client_edited_at!.getTime()).toBeGreaterThan(before.client_edited_at!.getTime())
    expect(renamed.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime())
    await expectStaleReplaySuperseded(ids, 'Rename 2939 Old A', 'Rename 2939 New A', renamed)
    expect(setsBefore).toBeGreaterThan(0)
  })

  it('adminUpdateExercise stamps the rewritten log too, and a stale replay is superseded', async () => {
    const { entry, ids } = await loggedUnderLibraryName('Rename 2939 Old B')
    const before = await logRow(ids.el)

    await repo.adminUpdateExercise({ id: entry.id, name: 'Rename 2939 New B', muscles: [], equipment: [] })

    const renamed = await logRow(ids.el)
    expect(renamed.exercise_name).toBe('Rename 2939 New B')
    expect(renamed.client_edited_at!.getTime()).toBeGreaterThan(before.client_edited_at!.getTime())
    expect(renamed.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime())
    await expectStaleReplaySuperseded(ids, 'Rename 2939 Old B', 'Rename 2939 New B', renamed)
  })

  it('the delta carries a best dated before the device\'s last pull, and says the set is complete', async () => {
    await pool.query(
      `INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at)
       VALUES ($1, 'Delta 2763 Old Best', 120, '2026-01-05T00:00:00Z'), ($1, 'Delta 2763 Newer Best', 90, '2026-02-01T00:00:00Z')
       ON CONFLICT (user_id, exercise_name) DO NOTHING`,
      [USER],
    )
    const delta = await repo.getSyncDelta(USER, new Date('2026-06-01T00:00:00Z'))
    const names = (delta.personalRecords as Array<{ exerciseName: string }>).map(r => r.exerciseName)
    expect(names).toEqual(expect.arrayContaining(['Delta 2763 Old Best', 'Delta 2763 Newer Best']))
    expect(delta.personalRecordsComplete).toBe(true)
  })
})
