// Issue 2721: a stale phone cannot overwrite a newer workout log.
//
// A phone that edited a log offline pushed it after a server-side fix (the lbs-to-kg fix) and the
// upsert put the old weights back. Pushes for `workout_log` / `exercise_log_edit` now carry
// `editedAt` (the phone's edit time), the row carries `client_edited_at` (when its content was last
// decided), and a push older than the row is skipped — counted as processed, with a `superseded`
// warning, and the row touched so the pull brings the newer copy back down.
//
// DB-backed and driven through `pushMutations`, because the rule is a read-then-write in SQL and the
// interesting failures (server write time vs phone time, the touch reaching `updated_at`) are only
// visible against the real trigger and columns.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { SUPERSEDED_WARNING, UNSTAMPED_WARNING } from '@trainingai/shared/sync/edited-at'
import { LBS_TO_KG } from '@trainingai/shared/workout/units'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002721'
const BEFORE = '2026-03-31'
// Local midday in Brisbane on a day well before the fix cutoff, so the log is in the fix's range.
const LOGGED_AT_MS = Date.parse('2026-01-10T12:00:00+10:00')
const MIN = 60_000

describe.skipIf(!canRun)('pushMutations keeps the newer copy of a workout log (issue 2721)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  function logPayload(ids: { ws: string; el: string; sets: string[] }, lift: string, weights: number[], editedAt?: number) {
    return {
      sessionName: 'S',
      workoutSessionId: ids.ws,
      exerciseLogId: ids.el,
      setLogIds: ids.sets,
      exercise: lift,
      weights,
      sets: weights.length,
      reps: weights.map(() => 5),
      localDate: '2026-01-10',
      workoutStartedAt: LOGGED_AT_MS - 30 * MIN,
      setEndTimes: weights.map((_, i) => LOGGED_AT_MS + i * MIN),
      ...(editedAt == null ? {} : { editedAt }),
    }
  }

  const freshIds = () => ({ ws: randomUUID(), el: randomUUID(), sets: [randomUUID(), randomUUID()] })

  const push = (mutations: Array<{ domain: string; payload: Record<string, unknown> }>) =>
    repo.pushMutations(USER, mutations.map(m => ({ id: randomUUID(), date: '2026-01-10', ...m })) as never)

  async function weightsOf(exerciseLogId: string): Promise<number[]> {
    const { rows } = await pool.query(
      `SELECT weight_kg FROM set_logs WHERE exercise_log_id = $1 AND deleted_at IS NULL ORDER BY set_number`,
      [exerciseLogId],
    )
    return rows.map(r => Number(r.weight_kg))
  }

  async function logRow(exerciseLogId: string) {
    const { rows } = await pool.query(
      `SELECT client_edited_at, updated_at, deleted_at, estimated_1rm FROM exercise_logs WHERE id = $1`,
      [exerciseLogId],
    )
    return rows[0] as { client_edited_at: Date | null; updated_at: Date; deleted_at: Date | null; estimated_1rm: number }
  }

  async function maxSetUpdatedAt(exerciseLogId: string): Promise<number> {
    const { rows } = await pool.query(`SELECT max(updated_at) AS m FROM set_logs WHERE exercise_log_id = $1`, [exerciseLogId])
    return new Date(rows[0].m).getTime()
  }

  /** A log the phone pushed with lbs entered as kg, then the server fix converting it. */
  async function loggedThenFixed(lift: string, phoneLoggedAt: number) {
    const ids = freshIds()
    const first = await push([{ domain: 'workout_log', payload: logPayload(ids, lift, [100, 100], phoneLoggedAt) }])
    expect(first.errors).toEqual([])
    const fix = await repo.applyLbsToKgFix(USER, [lift], BEFORE)
    expect(fix.logs.map(l => l.exerciseLogId)).toEqual([ids.el])
    const fixed = Math.round(100 * LBS_TO_KG * 2) / 2
    expect(await weightsOf(ids.el)).toEqual([fixed, fixed])
    return { ids, fixed }
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, `push-2721-${USER}@example.com`],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM personal_records WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM user_stats WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER]) // cascades to logs and sets
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('a stale workout_log replayed after a server fix keeps the fix, is processed as superseded, and moves updated_at', async () => {
    const lift = 'Push 2721 Stale Replay Lift'
    const now = Date.now()
    const { ids, fixed } = await loggedThenFixed(lift, now - 120 * MIN)
    const before = await logRow(ids.el)
    const setsBefore = await maxSetUpdatedAt(ids.el)
    const prBefore = await pool.query(`SELECT estimated_1rm FROM personal_records WHERE user_id = $1 AND exercise_name = $2`, [USER, lift])

    // The phone's copy, edited offline an hour ago — before the fix — still says 100.
    const mutationId = randomUUID()
    const result = await repo.pushMutations(USER, [{
      id: mutationId, domain: 'workout_log', date: '2026-01-10',
      payload: logPayload(ids, lift, [100, 100], now - 60 * MIN),
    }])

    expect(result.processed).toBe(1)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([{ id: mutationId, domain: 'workout_log', date: '2026-01-10', warning: SUPERSEDED_WARNING }])
    expect(await weightsOf(ids.el)).toEqual([fixed, fixed])

    const after = await logRow(ids.el)
    expect(Number(after.estimated_1rm)).toBe(Number(before.estimated_1rm))
    expect(after.client_edited_at!.getTime()).toBe(before.client_edited_at!.getTime())
    // Touched: the pull cursors both tables on `updated_at`, and the phone's may be past the fix.
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime())
    expect(await maxSetUpdatedAt(ids.el)).toBeGreaterThan(setsBefore)
    // The stale estimate does not re-mint the record the fix corrected.
    const prAfter = await pool.query(`SELECT estimated_1rm FROM personal_records WHERE user_id = $1 AND exercise_name = $2`, [USER, lift])
    expect(prAfter.rows.map(r => Number(r.estimated_1rm))).toEqual(prBefore.rows.map(r => Number(r.estimated_1rm)))
  })

  it('a stale exercise_log_edit after a fix is superseded too; an edit stamped after the fix wins', async () => {
    const lift = 'Push 2721 Edit Lift'
    const now = Date.now()
    const { ids, fixed } = await loggedThenFixed(lift, now - 120 * MIN)

    const stale = await push([{ domain: 'exercise_log_edit', payload: { exerciseLogId: ids.el, weights: [100, 100], reps: [5, 5], editedAt: now - 60 * MIN } }])
    expect(stale.processed).toBe(1)
    expect(stale.errors).toEqual([])
    expect(stale.warnings?.map(w => w.warning)).toEqual([SUPERSEDED_WARNING])
    expect(await weightsOf(ids.el)).toEqual([fixed, fixed])

    // Made on the phone after the fix landed: the user's newer decision.
    const fresh = await push([{ domain: 'exercise_log_edit', payload: { exerciseLogId: ids.el, weights: [47.5, 47.5], reps: [5, 5], editedAt: now + MIN } }])
    expect(fresh.processed).toBe(1)
    expect(fresh.errors).toEqual([])
    expect(fresh.warnings).toBeUndefined()
    expect(await weightsOf(ids.el)).toEqual([47.5, 47.5])
    expect((await logRow(ids.el)).client_edited_at!.getTime()).toBe(now + MIN)

    // And a workout_log stamped later still: it replaces the row as before.
    const later = await push([{ domain: 'workout_log', payload: logPayload(ids, lift, [50, 50], now + 2 * MIN) }])
    expect(later.warnings).toBeUndefined()
    expect(await weightsOf(ids.el)).toEqual([50, 50])
  })

  it('an offline log and its offline edit pushed in one batch both apply, though the server writes them after the edit was made', async () => {
    const lift = 'Push 2721 Offline Batch Lift'
    const ids = freshIds()
    const now = Date.now()
    // Both stamps are in the past, so the server's own write time for the first is later than the
    // second's edit time — the comparison that `updated_at` would have got wrong.
    const result = await push([
      { domain: 'workout_log', payload: logPayload(ids, lift, [60, 60], now - 10 * MIN) },
      { domain: 'exercise_log_edit', payload: { exerciseLogId: ids.el, weights: [62.5, 62.5], reps: [5, 5], editedAt: now - 5 * MIN } },
    ])
    expect(result.processed).toBe(2)
    expect(result.errors).toEqual([])
    expect(result.warnings).toBeUndefined()
    expect(await weightsOf(ids.el)).toEqual([62.5, 62.5])
    expect((await logRow(ids.el)).client_edited_at!.getTime()).toBe(now - 5 * MIN)
  })

  it('a payload without editedAt (an old client) still overwrites, is counted, and clears the stamp', async () => {
    const lift = 'Push 2721 Unstamped Lift'
    const { ids } = await loggedThenFixed(lift, Date.now() - 120 * MIN)
    expect((await logRow(ids.el)).client_edited_at).not.toBeNull()

    const result = await push([{ domain: 'workout_log', payload: logPayload(ids, lift, [70, 70]) }])
    expect(result.processed).toBe(1)
    expect(result.errors).toEqual([])
    expect(result.warnings?.map(w => w.warning)).toEqual([UNSTAMPED_WARNING])
    expect(await weightsOf(ids.el)).toEqual([70, 70])
    // Unknown edit time now, so the next stamped push is not refused against the fix's.
    expect((await logRow(ids.el)).client_edited_at).toBeNull()

    const edit = await push([{ domain: 'exercise_log_edit', payload: { exerciseLogId: ids.el, weights: [72.5, 72.5], reps: [5, 5] } }])
    expect(edit.warnings?.map(w => w.warning)).toEqual([UNSTAMPED_WARNING])
    expect(await weightsOf(ids.el)).toEqual([72.5, 72.5])
  })

  it('a delete stamped before a fix still deletes', async () => {
    const lift = 'Push 2721 Delete Lift'
    const now = Date.now()
    const { ids } = await loggedThenFixed(lift, now - 120 * MIN)
    const result = await push([{ domain: 'exercise_log_delete', payload: { exerciseLogId: ids.el, editedAt: now - 60 * MIN } }])
    expect(result.processed).toBe(1)
    expect(result.errors).toEqual([])
    expect(result.warnings).toBeUndefined()
    expect((await logRow(ids.el)).deleted_at).not.toBeNull()
  })
})
