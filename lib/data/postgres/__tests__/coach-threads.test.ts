// AI Coach conversation persistence.
//
// The message-count assertion exists because the first implementation used a correlated subquery in
// the SELECT list and returned 0 for every thread while the identical SQL by hand returned the right
// numbers. It was only caught by looking at the rendered history — nothing failed, the UI just said
// "0 messages" everywhere. A silently-wrong count deserves a test more than a loud one does.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const OWNER = '00000000-0000-4000-8000-00000000cd01'
const STRANGER = '00000000-0000-4000-8000-00000000cd02'

const msg = (role: string, text: string) => ({ role, parts: [{ type: 'text', text }] })

describe.skipIf(!canRun)('AI Coach — thread persistence', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let t: typeof import('@/lib/coach/threads')

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    db = client.getDb()
    t = await import('@/lib/coach/threads')
    for (const [id, tag] of [[OWNER, 'owner'], [STRANGER, 'stranger']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `coach-thread-${tag}@example.com`])
    }
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM coach_threads WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, STRANGER]])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM coach_threads WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
  })

  it('saves a thread and reports the real message count', async () => {
    const id = await t.saveThread(db, OWNER, null, [msg('user', 'whats lagging'), msg('assistant', 'Rows.')])
    const list = await t.listThreads(db, OWNER)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(id)
    expect(list[0].messageCount).toBe(2)
    expect(list[0].title).toBe('whats lagging')
  })

  it('counts each thread separately rather than collapsing them', async () => {
    await t.saveThread(db, OWNER, null, [msg('user', 'one')])
    await t.saveThread(db, OWNER, null, [msg('user', 'two'), msg('assistant', 'a'), msg('user', 'three')])
    const counts = (await t.listThreads(db, OWNER)).map(x => x.messageCount).sort()
    expect(counts).toEqual([1, 3])
  })

  it('replaces messages on re-save rather than appending', async () => {
    const id = await t.saveThread(db, OWNER, null, [msg('user', 'a')])
    await t.saveThread(db, OWNER, id, [msg('user', 'a'), msg('assistant', 'b')])
    const list = await t.listThreads(db, OWNER)
    expect(list).toHaveLength(1)
    expect(list[0].messageCount).toBe(2)
  })

  it('round-trips widget parts, not just text', async () => {
    const widget = {
      role: 'assistant',
      parts: [{ type: 'tool-renderChoiceList', toolCallId: 'x1', state: 'output-available', output: { status: 'chose', id: 'a', label: 'Lower' } }],
    }
    const id = await t.saveThread(db, OWNER, null, [msg('user', 'go'), widget])
    const loaded = await t.loadThread(db, OWNER, id)
    expect(loaded).toHaveLength(2)
    expect((loaded![1].parts[0] as { type: string }).type).toBe('tool-renderChoiceList')
    expect((loaded![1].parts[0] as { output: { label: string } }).output.label).toBe('Lower')
  })

  it("will not load another user's thread", async () => {
    const id = await t.saveThread(db, OWNER, null, [msg('user', 'private')])
    expect(await t.loadThread(db, STRANGER, id)).toBeNull()
  })

  it("will not overwrite another user's thread — it creates a new one instead", async () => {
    const ownerThread = await t.saveThread(db, OWNER, null, [msg('user', 'mine')])
    const strangerThread = await t.saveThread(db, STRANGER, ownerThread, [msg('user', 'theirs')])
    expect(strangerThread).not.toBe(ownerThread)

    const stillMine = await t.loadThread(db, OWNER, ownerThread)
    expect((stillMine![0].parts[0] as { text: string }).text).toBe('mine')
  })

  it('prunes threads past the retention window on write', async () => {
    const old = await t.saveThread(db, OWNER, null, [msg('user', 'ancient')])
    await pool.query(
      `UPDATE coach_threads SET updated_at = now() - interval '${t.THREAD_RETENTION_DAYS + 1} days' WHERE id = $1`,
      [old])

    await t.saveThread(db, OWNER, null, [msg('user', 'fresh')])

    const titles = (await t.listThreads(db, OWNER)).map(x => x.title)
    expect(titles).toEqual(['fresh'])
  })

  it('leaves another user’s old threads alone when pruning', async () => {
    const theirs = await t.saveThread(db, STRANGER, null, [msg('user', 'theirs')])
    await pool.query(
      `UPDATE coach_threads SET updated_at = now() - interval '${t.THREAD_RETENTION_DAYS + 1} days' WHERE id = $1`,
      [theirs])

    await t.saveThread(db, OWNER, null, [msg('user', 'mine')])

    const { rows } = await pool.query(`SELECT 1 FROM coach_threads WHERE id = $1`, [theirs])
    expect(rows).toHaveLength(1)
  })
})
