// #2381 (PR a). The agent action log (migration 202610071523): a run round-trips, finishes exactly
// once, and after that nothing can change it: not the repository, not a raw UPDATE, not a DELETE.
// The one write the trigger allows is the account-deletion FK unlinking the target. The CHECKs
// refuse a bad outcome, job id or approval link, and claude_ro shows the owner's and global runs only.
//
// The table is append-only, so these rows cannot be cleaned up afterwards. Every run uses its own
// job id and filters by it, so leftovers from earlier runs never reach an assertion.
//
// Runs only against a real local dev Postgres. It skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

const canRun = !!process.env.DATABASE_URL
const OWNER = '00000000-0000-4000-8000-000000238101'
const OTHER = '00000000-0000-4000-8000-000000238102'
const DOOMED = '00000000-0000-4000-8000-000000238103'
const RUN = Math.random().toString(36).slice(2, 8)
const JOB = `test-2381-${RUN}`

describe.skipIf(!canRun)('agent_action_log (#2381)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of [OWNER, OTHER, DOOMED]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `agent-log-${id.slice(-4)}@example.com`],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    // The rows stay (append-only); deleting the users unlinks them through the FK.
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[OWNER, OTHER, DOOMED]])
  })

  const raw = (sql: string, params: unknown[] = []) => pool.query(sql, params)

  it('starts a run as running, with the parameters redacted on the way in', async () => {
    const run = await repo.startAgentAction({
      job: JOB,
      parameters: { date: '2026-09-15', full: true, AGENT_ACTIONS_SECRET: 'nope', nested: { token: 'nope', n: 1 } },
      actor: 'bugfix',
      approvalRef: 'https://github.com/nekodas-neko/TrainingAi_Open/issues/2381#issuecomment-1',
      targetUserId: OWNER,
    })
    expect(run).toMatchObject({
      job: JOB, actor: 'bugfix', targetUserId: OWNER, outcome: 'running',
      finishedAt: null, affectedRows: null, daysMoved: null, error: null,
      parameters: { date: '2026-09-15', full: true, nested: { n: 1 } },
    })
    expect(JSON.stringify(run.parameters)).not.toContain('nope')
    const { rows: [stored] } = await raw(`SELECT parameters::text AS p FROM agent_action_log WHERE id = $1`, [run.id])
    expect(stored.p).not.toContain('nope')
    expect(await repo.getAgentAction(run.id)).toEqual(run)
  })

  it('finishes a run once; a second finish matches nothing and changes nothing', async () => {
    const run = await repo.startAgentAction({ job: JOB, actor: 'orchestrator' })
    const done = await repo.finishAgentAction(run.id, { outcome: 'succeeded', affectedRows: 1234, daysMoved: 17 })
    expect(done).toMatchObject({ id: run.id, outcome: 'succeeded', affectedRows: 1234, daysMoved: 17, error: null })
    expect(done!.finishedAt!.getTime()).toBeGreaterThanOrEqual(run.startedAt.getTime())

    expect(await repo.finishAgentAction(run.id, { outcome: 'failed', error: 'late' })).toBeNull()
    expect(await repo.getAgentAction(run.id)).toEqual(done)
  })

  it('finishing an unknown id is null, not an error', async () => {
    expect(await repo.finishAgentAction(randomUUID(), { outcome: 'failed' })).toBeNull()
  })

  it('keeps only the first line of an error, capped, so a stack trace cannot land in the log', async () => {
    const run = await repo.startAgentAction({ job: JOB, actor: 'implementer' })
    const done = await repo.finishAgentAction(run.id, {
      outcome: 'failed',
      error: `${'x'.repeat(2500)}\n    at secretFunction (/app/lib/thing.ts:1:1)`,
    })
    expect(done!.error).toBe('x'.repeat(2000))
  })

  it('the table refuses any rewrite of a finished row, even by raw SQL', async () => {
    const run = await repo.startAgentAction({ job: JOB, actor: 'bugfix', targetUserId: OWNER })
    await repo.finishAgentAction(run.id, { outcome: 'succeeded', affectedRows: 5 })
    await expect(raw(`UPDATE agent_action_log SET affected_rows = 0 WHERE id = $1`, [run.id])).rejects.toThrow(/append-only/)
    await expect(raw(`UPDATE agent_action_log SET outcome = 'running', finished_at = NULL WHERE id = $1`, [run.id])).rejects.toThrow(/append-only/)
    await expect(raw(`UPDATE agent_action_log SET approval_ref = 'forged' WHERE id = $1`, [run.id])).rejects.toThrow(/append-only/)
    await expect(raw(`UPDATE agent_action_log SET target_user_id = $2 WHERE id = $1`, [run.id, OTHER])).rejects.toThrow(/append-only/)
    await expect(raw(`DELETE FROM agent_action_log WHERE id = $1`, [run.id])).rejects.toThrow(/append-only/)
    expect(await repo.getAgentAction(run.id)).toMatchObject({ outcome: 'succeeded', affectedRows: 5, targetUserId: OWNER })
  })

  it('a running row can only be finished: its identity columns are fixed, and it cannot be deleted', async () => {
    const run = await repo.startAgentAction({ job: JOB, actor: 'bugfix', parameters: { date: '2026-09-15' } })
    await expect(raw(`UPDATE agent_action_log SET job = 'vacuum' WHERE id = $1`, [run.id])).rejects.toThrow(/append-only/)
    await expect(raw(`UPDATE agent_action_log SET parameters = '{}' WHERE id = $1`, [run.id])).rejects.toThrow(/append-only/)
    await expect(raw(`UPDATE agent_action_log SET started_at = started_at - interval '1 day' WHERE id = $1`, [run.id])).rejects.toThrow(/append-only/)
    await expect(raw(`DELETE FROM agent_action_log WHERE id = $1`, [run.id])).rejects.toThrow(/append-only/)
    expect(await repo.getAgentAction(run.id)).toEqual(run)
  })

  it('refuses an unknown outcome, and a finish without an end (or an end without a finish)', async () => {
    await expect(raw(`INSERT INTO agent_action_log (job, actor, outcome, finished_at) VALUES ($1, 'x', 'done', now())`, [JOB])).rejects.toThrow(/outcome_check/)
    await expect(raw(`INSERT INTO agent_action_log (job, actor, outcome) VALUES ($1, 'x', 'succeeded')`, [JOB])).rejects.toThrow(/finished_check/)
    await expect(raw(`INSERT INTO agent_action_log (job, actor, finished_at) VALUES ($1, 'x', now())`, [JOB])).rejects.toThrow(/finished_check/)
  })

  it('refuses a blank or oversized approval link, and accepts none at all', async () => {
    await expect(repo.startAgentAction({ job: JOB, actor: 'bugfix', approvalRef: '' })).rejects.toThrow()
    await expect(repo.startAgentAction({ job: JOB, actor: 'bugfix', approvalRef: '   ' })).rejects.toThrow()
    await expect(repo.startAgentAction({ job: JOB, actor: 'bugfix', approvalRef: `https://x/${'a'.repeat(500)}` })).rejects.toThrow()
    expect((await repo.startAgentAction({ job: JOB, actor: 'bugfix', approvalRef: null })).approvalRef).toBeNull()
  })

  it('refuses a job that is not a catalogue-style id, a blank actor, and non-object parameters', async () => {
    await expect(repo.startAgentAction({ job: 'Rederive Body Battery', actor: 'bugfix' })).rejects.toThrow()
    await expect(repo.startAgentAction({ job: JOB, actor: '  ' })).rejects.toThrow()
    await expect(raw(`INSERT INTO agent_action_log (job, actor, parameters) VALUES ($1, 'x', '[1]')`, [JOB])).rejects.toThrow(/parameters_check/)
  })

  it('lists newest first, filtered and limited', async () => {
    const job = `${JOB}-list`
    const a = await repo.startAgentAction({ job, actor: 'bugfix', targetUserId: OWNER })
    const b = await repo.startAgentAction({ job, actor: 'orchestrator' })
    await repo.finishAgentAction(b.id, { outcome: 'refused', error: 'no approval' })
    const c = await repo.startAgentAction({ job, actor: 'bugfix', targetUserId: OTHER })

    const all = await repo.listAgentActions({ job })
    expect(all.map(r => r.id)).toEqual([c.id, b.id, a.id])
    expect((await repo.listAgentActions({ job, actor: 'bugfix' })).map(r => r.id)).toEqual([c.id, a.id])
    expect((await repo.listAgentActions({ job, outcome: 'refused' })).map(r => r.id)).toEqual([b.id])
    expect((await repo.listAgentActions({ job, targetUserId: OWNER })).map(r => r.id)).toEqual([a.id])
    expect((await repo.listAgentActions({ job, limit: 1 })).map(r => r.id)).toEqual([c.id])
    expect(await repo.listAgentActions({ job, since: new Date(Date.now() + 3_600_000) })).toEqual([])
  })

  it('outlives the account it ran on: deletion unlinks the row and leaves the rest as it was', async () => {
    const run = await repo.startAgentAction({ job: `${JOB}-del`, actor: 'bugfix', targetUserId: DOOMED, parameters: { date: '2026-09-15' } })
    const done = await repo.finishAgentAction(run.id, { outcome: 'succeeded', affectedRows: 3 })
    const running = await repo.startAgentAction({ job: `${JOB}-del`, actor: 'bugfix', targetUserId: DOOMED })

    const result = await repo.deleteAccount(DOOMED)
    expect(result.deleted).toBe(true)

    expect(await repo.getAgentAction(run.id)).toEqual({ ...done, targetUserId: null })
    expect(await repo.getAgentAction(running.id)).toEqual({ ...running, targetUserId: null })
  })

  it('claude_ro shows the owner\'s runs and the global ones, never a run on another account', async () => {
    const job = `${JOB}-ro`
    const mine = await repo.startAgentAction({ job, actor: 'bugfix', targetUserId: OWNER })
    const global = await repo.startAgentAction({ job, actor: 'bugfix' })
    await repo.startAgentAction({ job, actor: 'bugfix', targetUserId: OTHER })

    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query(`SELECT set_config('app.claude_ro_owner', $1, true)`, [OWNER])
      const { rows } = await c.query(`SELECT id FROM claude_ro.agent_action_log WHERE job = $1`, [job])
      expect(rows.map(r => r.id).sort()).toEqual([mine.id, global.id].sort())
    } finally {
      await c.query('ROLLBACK')
      c.release()
    }
  })
})
