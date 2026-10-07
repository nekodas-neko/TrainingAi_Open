// #2120 — deleting an account, against a real Postgres.
//
// `DELETE FROM users` used to throw for any account holding one custom exercise
// (`exercise_library_created_by_fkey`), and a saved meal could trip a RESTRICT from inside the
// cascade. Neither was visible from code: both are facts about the live schema. So the fixture here
// is derived from the live schema too (`every-user-table-fixture.ts`) — one row in every table a
// user's data can live in, cross-linked to the user's own rows — and the export map is read back as
// the oracle, as the issue asked: every EXPORTED scope must come back empty for the deleted id.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  readSchemaGraph, cascadeClosure, setNullToUsers, seedEveryUserTable, rowExists,
  type SchemaGraph, type SeededUser,
} from './every-user-table-fixture'

const canRun = !!process.env.DATABASE_URL

const A = '00000000-0000-4000-8000-0000000212a0'   // deleted
const B = '00000000-0000-4000-8000-0000000212b0'   // another account, must be untouched
const C = '00000000-0000-4000-8000-0000000212c0'   // a deletion that must fail closed
const D = '00000000-0000-4000-8000-0000000212d0'   // holds a reference into C
const E = '00000000-0000-4000-8000-0000000212e0'   // the claude_ro audit subject
const email = (id: string) => `acct-del-${id.slice(-4)}@example.com`
const MARK = 'acct-del-2120'

// A multi-column CHECK the generic values cannot satisfy for a LIVE row (a soft-deleted one is
// exempt from it, which is why A's soft-deleted seed needs nothing).
const LIVE_OVERRIDES = {
  apple_health_samples: {
    start_at: new Date('2026-09-15T00:00:00Z'), end_at: new Date('2026-09-15T00:01:00Z'),
    source_bundle_id: 'com.example', quantity_value: 1, quantity_unit: 'count',
  },
}

type Pool = import('pg').Pool
type Repo = import('@/lib/data/repository').WorkoutRepository

async function makeUser(pool: Pool, id: string) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
     ON CONFLICT (id) DO NOTHING`, [id, email(id)])
}

// Cleanup that does not go through the code under test, so a broken deletion cannot also break the
// teardown that would let the next run start clean.
async function dropEverything(pool: Pool, ids: string[]) {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query('SET CONSTRAINTS ALL DEFERRED')
    await c.query(`DELETE FROM food_logs WHERE user_id = ANY($1::uuid[])`, [ids])
    await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids])
    await c.query('COMMIT')
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    c.release()
  }
}

// Independent of any deletion actually running, so these still report when one shape happens to
// pass on today's trigger order — which is exactly when they matter.
describe.skipIf(!canRun)('the schema account deletion relies on (#2120)', () => {
  let g: SchemaGraph
  let OUTSIDE_THE_CASCADE: typeof import('../slices/account-deletion').OUTSIDE_THE_CASCADE
  beforeAll(async () => {
    g = await readSchemaGraph((await import('@/lib/data/postgres/client')).getPool())
    ;({ OUTSIDE_THE_CASCADE } = await import('../slices/account-deletion'))
  })

  it('classifies every table outside the cascade, matching the live schema exactly', () => {
    // A new table that neither cascades from users nor appears here fails this, so it has to be
    // decided — deleted, anonymised, purged, or not user data — rather than left behind by default.
    const outside = g.tables.filter(t => t !== 'users' && !cascadeClosure(g).has(t)).sort()
    expect(Object.keys(OUTSIDE_THE_CASCADE).sort()).toEqual(outside)
    const anonymised = Object.entries(OUTSIDE_THE_CASCADE).filter(([, v]) => v.disposition === 'anonymised').map(([t]) => t)
    expect(anonymised.sort()).toEqual([...setNullToUsers(g)].sort())
  })

  it('every FK the cascade can trip over mid-statement is deferrable, so the deletion can defer it', () => {
    // Two shapes, both measured. The deletion runs `SET CONSTRAINTS ALL DEFERRED`, which only reaches
    // a DEFERRABLE constraint; a plain one fails or passes on trigger order.
    const closure = cascadeClosure(g)
    const inCascade = (t: string) => t === 'users' || closure.has(t)
    const unsafe: string[] = []
    // 1. A refusing rule between two tables the cascade empties: the parent's check can fire before
    //    the child's own cascade has removed the referencing row (saved_meal_items).
    for (const fk of g.fks) {
      if ((fk.rule === 'a' || fk.rule === 'r') && closure.has(fk.table) && inCascade(fk.parent) && !fk.deferrable) {
        unsafe.push(`${fk.table}.${fk.column} refuses (${fk.rule}) a parent the cascade deletes`)
      }
    }
    // 2. A table with two or more SET NULL keys into the cascade: the second update re-checks every
    //    FK on the row, because the first one wrote the row version it reads (meal_plan_meals).
    for (const t of closure) {
      const setNulls = g.fks.filter(f => f.table === t && f.rule === 'n' && inCascade(f.parent))
      if (setNulls.length < 2) continue
      for (const fk of g.fks.filter(f => f.table === t && !f.deferrable)) {
        unsafe.push(`${t}.${fk.column} is re-checked mid-cascade (${setNulls.length} SET NULL keys on ${t})`)
      }
    }
    expect(unsafe).toEqual([])
  })
})

describe.skipIf(!canRun)('account deletion (#2120)', () => {
  let pool: Pool
  let repo: Repo
  let g: SchemaGraph
  let deleteAccount: typeof import('../slices/account-deletion').deleteAccount
  let EXPORTED: typeof import('@/lib/export/export-map').EXPORTED
  let a: SeededUser
  let b: SeededUser
  let result: Awaited<ReturnType<typeof deleteAccount>>
  const exportedBefore = new Map<string, number>()
  const createdCatalogue: Record<string, unknown>[] = []

  const exportedCount = async (table: string, userId: string) => {
    const scope = EXPORTED[table]
    const where = scope.kind === 'own_row' ? 't.id = $1' : scope.kind === 'user_id' ? 't.user_id = $1' : scope.predicate
    // Deliberately NOT filtered by `SOFT_DELETED`: an export hides soft-deleted rows, and a
    // deletion that did the same would leave them sitting in the table.
    const { rows: [r] } = await pool.query(`SELECT count(*)::int AS n FROM public."${table}" t WHERE ${where}`, [userId])
    return r.n as number
  }

  // Run before as well as after, and every step on its own: a run that failed half-way (a mutation
  // pass, a broken migration) must not leave a row that makes the next run fail for another reason.
  const sweep = async () => {
    const steps: Array<() => Promise<unknown>> = [
      () => dropEverything(pool, [A, B]),
      () => pool.query(`DELETE FROM db_query_log WHERE sql_text LIKE $1 OR error LIKE $1`, [`%${MARK}%`]),
      () => pool.query(`DELETE FROM rate_limits WHERE key LIKE '%acct-del-%' OR key = ANY($1)`, [[`sync-push:${A}`, `sync-push:${B}`]]),
      () => pool.query(`DELETE FROM invited_emails WHERE email LIKE 'acct-del-%'`),
      () => pool.query(`DELETE FROM email_normalisation_preimage WHERE lower(new_email) LIKE 'acct-del-%'`),
      // The anonymised rows outlive their user by design; the fixture's generic text marks them.
      () => pool.query(`DELETE FROM ai_call_log WHERE user_id IS NULL AND section LIKE 'ai_call_log.%'`),
      () => pool.query(`DELETE FROM error_events WHERE user_id IS NULL AND message LIKE 'error_events.%'`),
      () => pool.query(`DELETE FROM exercise_library WHERE created_by IS NULL AND name LIKE 'exercise_library.%'`),
    ]
    for (const step of steps) await step().catch(() => {})
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    repo = await (await import('@/lib/data')).getRepository()
    ;({ deleteAccount } = await import('../slices/account-deletion'))
    ;({ EXPORTED } = await import('@/lib/export/export-map'))
    g = await readSchemaGraph(pool)

    await sweep()
    await makeUser(pool, A)
    await makeUser(pool, B)
    // A's rows are soft-deleted wherever a table has `deleted_at`, so every one of them is a row
    // an export would skip.
    a = await seedEveryUserTable(pool, g, A, { softDelete: true })
    // B's rows name A's custom exercise: the shared catalogue entry must outlive its author for them.
    b = await seedEveryUserTable(pool, g, B, {
      overrides: LIVE_OVERRIDES,
      parentOverride: { exercise_library: a.rows.get('exercise_library')! },
    })
    createdCatalogue.push(...a.createdCatalogue, ...b.createdCatalogue)

    await pool.query(
      `INSERT INTO db_query_log (sql_text, truncated, ok, error) VALUES
         ($1, false, true, NULL), ('SELECT 1 /* ${MARK} */', false, false, $2),
         ($3, false, true, NULL), ($4, false, true, NULL)`,
      [`SELECT * FROM claude_ro.body_metrics WHERE user_id = '${A.toUpperCase()}' /* ${MARK} a-id */`,
       `no row for ${email(A).toUpperCase()} /* ${MARK} a-email */`,
       `SELECT * FROM claude_ro.users WHERE id = '${B}' /* ${MARK} b-id */`,
       `SELECT * FROM claude_ro.users WHERE email = 'j${email(A)}' /* ${MARK} longer-address */`])
    await pool.query(
      `INSERT INTO rate_limits (key, count, window_start) VALUES
         ($1, 1, now()), ($2, 1, now()), ($3, 1, now()), ($4, 1, now()), ($5, 1, now())
       ON CONFLICT (key) DO NOTHING`,
      [`sync-push:${A}`, `login:${email(A)}`, `login:j${email(A)}`, `sync-push:${B}`, `login:${email(B)}`])
    await pool.query(`INSERT INTO invited_emails (email) VALUES ($1), ($2) ON CONFLICT DO NOTHING`, [email(A), email(B)])
    await pool.query(
      `INSERT INTO email_normalisation_preimage (table_name, old_email, new_email) VALUES ('users', $1, $2), ('users', $3, $4)
       ON CONFLICT DO NOTHING`,
      [email(A).toUpperCase(), email(A), email(B).toUpperCase(), email(B)])

    for (const t of Object.keys(EXPORTED)) exportedBefore.set(t, await exportedCount(t, A))

    const db = client.getDb()
    result = await deleteAccount(db, A)
  }, 120_000)

  afterAll(async () => {
    if (!canRun) return
    await sweep()
    for (const row of createdCatalogue.reverse()) {
      const { __table, ...key } = row as { __table: string } & Record<string, unknown>
      const cols = Object.keys(key)
      await pool.query(`DELETE FROM public."${__table}" WHERE ${cols.map((c, i) => `"${c}" = $${i + 1}`).join(' AND ')}`,
        cols.map(c => key[c])).catch(() => {})
    }
  })

  it('the fixture reaches every table the export map says holds user data, with a row for A', () => {
    // Without this the oracle below is vacuous: an EXPORTED table the fixture never wrote to reads
    // zero after the deletion for the wrong reason.
    const empty = [...exportedBefore].filter(([, n]) => n === 0).map(([t]) => t)
    expect(empty).toEqual([])
    // And A's rows really were soft-deleted, so "soft-deleted rows go too" is being tested.
    expect(a.rows.get('food_logs')!.deleted_at).not.toBeNull()
    expect(a.rows.get('workout_sessions')!.deleted_at).not.toBeNull()
  })

  it('succeeds for a user with a custom exercise and a saved meal', () => {
    expect(a.rows.get('exercise_library')!.created_by).toBe(A)
    expect(a.rows.get('saved_meal_items')).toBeDefined()
    expect(result.deleted).toBe(true)
  })

  it('every EXPORTED scope reads back empty for the deleted id, soft-deleted rows included', async () => {
    const left: string[] = []
    for (const t of Object.keys(EXPORTED)) if (await exportedCount(t, A) > 0) left.push(t)
    expect(left).toEqual([])
  })

  it('every row the cascade reaches is gone — the ones the export map excludes too', async () => {
    const survivors: string[] = []
    for (const t of cascadeClosure(g)) if (await rowExists(pool, g, t, a.rows.get(t)!)) survivors.push(t)
    expect(survivors).toEqual([])
    // Spot-check the excluded-but-theirs tables by name, so a change to the closure cannot quietly
    // drop them from the loop above.
    for (const t of ['oura_raw_samples', 'oura_raw_packed', 'applied_mutations', 'feedback_submissions', 'oura_tokens', 'friendships']) {
      expect(cascadeClosure(g).has(t), t).toBe(true)
    }
  })

  it('only the two anonymised logs and the catalogue exercise remain, none naming the user', async () => {
    const naming: string[] = []
    for (const fk of g.fks.filter(f => f.parent === 'users')) {
      const { rows: [r] } = await pool.query(`SELECT count(*)::int AS n FROM public."${fk.table}" WHERE "${fk.column}" = $1`, [A])
      if (r.n > 0) naming.push(`${fk.table}.${fk.column}`)
    }
    expect(naming).toEqual([])

    expect([...setNullToUsers(g)].sort()).toEqual(['agent_action_log', 'ai_call_log', 'error_events', 'exercise_library'])
    // #2381: the audit row survives, unlinked — and the append-only trigger let the FK do it.
    const act = await rowExists(pool, g, 'agent_action_log', a.rows.get('agent_action_log')!)
    expect(act?.target_user_id).toBeNull()
    const ai = await rowExists(pool, g, 'ai_call_log', a.rows.get('ai_call_log')!)
    const ee = await rowExists(pool, g, 'error_events', a.rows.get('error_events')!)
    const ex = await rowExists(pool, g, 'exercise_library', a.rows.get('exercise_library')!)
    expect(ai?.user_id).toBeNull()
    expect(ee?.user_id).toBeNull()
    expect(ex?.created_by).toBeNull()
    expect(result.anonymised).toEqual({ aiCallLog: 1, errorEvents: 1, authoredExercises: 1 })
  })

  it('leaves the other account untouched, including its rows that name A\'s custom exercise', async () => {
    const missing: string[] = []
    for (const [t, row] of b.rows) if (!(await rowExists(pool, g, t, row))) missing.push(t)
    expect(missing).toEqual([])
    const log = await rowExists(pool, g, 'exercise_logs', b.rows.get('exercise_logs')!)
    expect(log?.exercise_id).toBe(a.rows.get('exercise_library')!.id)
    const { rows: [u] } = await pool.query('SELECT 1 FROM users WHERE id = $1', [B])
    expect(u).toBeDefined()
  })

  it('purges the db_query_log rows that name the user by id or address, and no others', async () => {
    const { rows } = await pool.query<{ tag: string }>(
      `SELECT substring(coalesce(sql_text, '') || coalesce(error, '') from '${MARK} ([a-z-]+)') AS tag
       FROM db_query_log WHERE sql_text LIKE $1 OR error LIKE $1`, [`%${MARK}%`])
    expect(rows.map(r => r.tag).sort()).toEqual(['b-id', 'longer-address'])
    expect(result.purged.dbQueryLog).toBe(2)
  })

  it('purges the user\'s rate-limit keys, invitation and email preimage, and nobody else\'s', async () => {
    const { rows: keys } = await pool.query<{ key: string }>(
      `SELECT key FROM rate_limits WHERE key = ANY($1) ORDER BY key`,
      [[`sync-push:${A}`, `login:${email(A)}`, `login:j${email(A)}`, `sync-push:${B}`, `login:${email(B)}`]])
    expect(keys.map(k => k.key).sort()).toEqual([`login:${email(B)}`, `login:j${email(A)}`, `sync-push:${B}`].sort())
    const { rows: inv } = await pool.query(`SELECT email FROM invited_emails WHERE email = ANY($1)`, [[email(A), email(B)]])
    expect(inv.map(r => r.email)).toEqual([email(B)])
    const { rows: pre } = await pool.query(`SELECT new_email FROM email_normalisation_preimage WHERE new_email = ANY($1)`, [[email(A), email(B)]])
    expect(pre.map(r => r.new_email)).toEqual([email(B)])
    expect(result.purged).toMatchObject({ rateLimits: 2, invitedEmails: 1, emailPreimage: 1 })
  })

  it('refuses a late outbox push for the deleted account as a poison pill, writing nothing', async () => {
    const batch = (tag: string) => [
      { id: crypto.randomUUID(), domain: 'body_metrics', date: '2026-09-20', payload: { weightKg: 80.5 } },
      { id: crypto.randomUUID(), domain: 'mood_logs', date: '2026-09-20', payload: { energyLevel: 'good' } },
      { id: crypto.randomUUID(), domain: 'supplements', date: '2026-09-20', payload: { id: crypto.randomUUID(), name: `Creatine ${tag}` } },
    ] as Parameters<Repo['pushMutations']>[1]

    // The same mutations are valid for a live account. Without this control, a payload the schema
    // rejected would also come back non-retryable and the assertion below would pass for nothing.
    const live = await repo.pushMutations(B, batch('live'))
    expect(live.errors).toEqual([])
    expect(live.processed).toBe(3)

    const late = await repo.pushMutations(A, batch('late'))
    expect(late.processed).toBe(0)
    expect(late.errors).toHaveLength(3)
    // Not retryable: the client counts it against MAX_MUTATION_ATTEMPTS and dead-letters it, rather
    // than backing the whole queue off as if the server were down.
    for (const e of late.errors) expect(e.retryable, e.error).not.toBe(true)
    for (const t of ['body_metrics', 'mood_logs', 'supplements']) {
      const { rows: [r] } = await pool.query(`SELECT count(*)::int AS n FROM public."${t}" WHERE user_id = $1`, [A])
      expect(r.n, t).toBe(0)
    }
  })

  it('answers not-found, changing nothing, for an id with no account', async () => {
    const again = await deleteAccount((await import('@/lib/data/postgres/client')).getDb(), A)
    expect(again.deleted).toBe(false)
  })
})

describe.skipIf(!canRun)('account deletion that cannot complete (#2120)', () => {
  let pool: Pool
  afterAll(async () => { if (canRun) await dropEverything(pool, [C, D]) })

  it('rolls back entirely when another account\'s row still points into this one', async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    const { deleteAccount } = await import('../slices/account-deletion')
    await dropEverything(pool, [C, D])
    await makeUser(pool, C)
    await makeUser(pool, D)
    const { rows: [item] } = await pool.query(
      `INSERT INTO food_items (user_id, name, calories, source) VALUES ($1, 'c-item', 100, 'manual') RETURNING id`, [C])
    const { rows: [mt] } = await pool.query(`INSERT INTO meal_types (user_id, name) VALUES ($1, 'd-meal') RETURNING id`, [D])
    // App write paths verify ownership and refuse this; a legacy row is the case worth proving.
    const { rows: [log] } = await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id) VALUES ($1, '2026-09-20', $2, $3) RETURNING id`,
      [D, mt.id, item.id])

    // Drizzle wraps the driver error ("Failed query: commit"); the constraint is one level down.
    const err = await deleteAccount(client.getDb(), C, { auditSubjectIds: [] }).then(() => null, (e: unknown) => e)
    expect((err as { cause?: { constraint?: string } } | null)?.cause?.constraint).toBe('food_logs_food_item_id_fkey')

    const { rows: [u] } = await pool.query('SELECT 1 FROM users WHERE id = $1', [C])
    const { rows: [i] } = await pool.query('SELECT 1 FROM food_items WHERE id = $1', [item.id])
    const { rows: [l] } = await pool.query('SELECT 1 FROM food_logs WHERE id = $1', [log.id])
    expect(u, 'the account is exactly as it was').toBeDefined()
    expect(i, 'its rows are exactly as they were').toBeDefined()
    expect(l, 'the other account\'s row was never touched').toBeDefined()
  })
})

describe.skipIf(!canRun)('account deletion of the claude_ro audit subject (#2120)', () => {
  let pool: Pool
  afterAll(async () => {
    if (!canRun) return
    await dropEverything(pool, [E])
    await pool.query(`DELETE FROM db_query_log WHERE sql_text LIKE $1`, [`%${MARK}%`])
  })

  it('purges every db_query_log row, because every audited query read their data', async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    const { deleteAccount } = await import('../slices/account-deletion')
    await dropEverything(pool, [E])
    await makeUser(pool, E)
    await pool.query(
      `INSERT INTO db_query_log (sql_text, truncated, ok) VALUES ($1, false, true), ($2, false, true)`,
      [`SELECT count(*) FROM claude_ro.sleep_sessions /* ${MARK} subject-1 */`, `SELECT 1 /* ${MARK} subject-2 */`])

    const r = await deleteAccount(client.getDb(), E, { auditSubjectIds: [E.toUpperCase()] })
    expect(r.deleted).toBe(true)
    const { rows } = await pool.query(`SELECT 1 FROM db_query_log WHERE sql_text LIKE $1`, [`%${MARK} subject%`])
    expect(rows).toHaveLength(0)
  })
})
