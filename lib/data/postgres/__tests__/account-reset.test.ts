// #3369 — an admin resetting a user's data and deleting an account that has data, against a real
// Postgres. The oracle is the one account deletion uses: the export map. Every EXPORTED scope must
// read zero rows for the reset user, except the two things a reset keeps by design (the users row
// and the sign-in identities), and the account must still be able to sign in.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  readSchemaGraph, cascadeClosure, seedEveryUserTable, rowExists,
  type SchemaGraph, type SeededUser,
} from './every-user-table-fixture'

const canRun = !!process.env.DATABASE_URL

const R = '00000000-0000-4000-8000-0000003369a0'   // reset, non-admin
const O = '00000000-0000-4000-8000-0000003369b0'   // another account, must be untouched
const ADM = '00000000-0000-4000-8000-0000003369c0' // an admin the acting admin may not touch
const S = '00000000-0000-4000-8000-0000003369d0'   // the acting admin, resetting themselves
const X = '00000000-0000-4000-8000-0000003369e0'   // deleted while holding data
const F = '00000000-0000-4000-8000-0000003369f0'   // a reset that must fail closed
const G = '00000000-0000-4000-8000-0000003369f1'   // holds a reference into F
// agent_action_log is append-only, so rows from earlier runs are still there; each run reads only its own.
let runStart = new Date(0)
const email = (id: string) => `acct-reset-${id.slice(-4)}@example.com`
const SUB = (id: string) => `google-sub-${id.slice(-4)}`

type Pool = import('pg').Pool

const liveOverrides = () => ({
  apple_health_samples: {
    start_at: new Date('2026-09-15T00:00:00Z'), end_at: new Date('2026-09-15T00:01:00Z'),
    source_bundle_id: 'com.example', quantity_value: 1, quantity_unit: 'count',
  },
  native_refresh_tokens: refreshTokenRow(),
})
function refreshTokenRow() {
  return { token_hash: randomBytes(32).toString('hex'), expires_at: new Date(Date.now() + 30 * 86_400_000) }
}

async function makeUser(pool: Pool, id: string, opts: { admin?: boolean } = {}) {
  await pool.query(
    `INSERT INTO users (id, email, name, oauth_sub, password_hash, is_active, is_admin, timezone, display_name, height_cm, friend_code, preferences)
     VALUES ($1, $2, 'Reset Person', $3, 'hash-1', true, $4, 'Europe/London', 'Shown Name', 180, $5, '{"theme":"x"}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [id, email(id), SUB(id), opts.admin === true, `FC${id.slice(-4)}`])
  // The every-user-table fixture seeds a google identity of its own, so the second one is apple's.
  await pool.query(
    `INSERT INTO auth_identities (user_id, provider, subject, email) VALUES ($1, 'apple', $2, $3) ON CONFLICT DO NOTHING`,
    [id, `apple-sub-${id.slice(-4)}`, email(id)])
}

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

describe.skipIf(!canRun)('admin reset of a user\'s data (#3369)', () => {
  let pool: Pool
  let g: SchemaGraph
  let slice: typeof import('../slices/account-deletion')
  let EXPORTED: typeof import('@/lib/export/export-map').EXPORTED
  let r: SeededUser
  let o: SeededUser
  let result: Awaited<ReturnType<typeof slice.resetAccountData>>
  let before: Record<string, unknown>
  let identitiesBefore: Record<string, unknown>[]
  const exportedBefore = new Map<string, number>()
  const createdCatalogue: Record<string, unknown>[] = []
  const guard = (target: string, over: Partial<{ actingAdminId: string; ownerId: string | null; confirmEmail: string }> = {}) =>
    ({ actingAdminId: S, ownerId: S, confirmEmail: email(target), ...over })
  const audit = { job: 'admin-reset-user-data' as const, actor: `admin:${S}` }

  const exportedCount = async (table: string, userId: string) => {
    const scope = EXPORTED[table]
    const where = scope.kind === 'own_row' ? 't.id = $1' : scope.kind === 'user_id' ? 't.user_id = $1' : scope.predicate
    const { rows: [row] } = await pool.query(`SELECT count(*)::int AS n FROM public."${table}" t WHERE ${where}`, [userId])
    return row.n as number
  }
  const auditRows = async (target: string) => (await pool.query(
    `SELECT * FROM agent_action_log WHERE actor = $1 AND (target_user_id = $2::uuid OR parameters->>'targetUserId' = $2::text) AND started_at >= $3 ORDER BY started_at`,
    [`admin:${S}`, target, runStart])).rows

  const sweep = async () => {
    const steps: Array<() => Promise<unknown>> = [
      () => dropEverything(pool, [R, O, ADM, S, X, F, G]),
      () => pool.query(`DELETE FROM rate_limits WHERE key LIKE '%acct-reset-%'`),
      () => pool.query(`DELETE FROM invited_emails WHERE email LIKE 'acct-reset-%'`),
      () => pool.query(`DELETE FROM email_normalisation_preimage WHERE lower(new_email) LIKE 'acct-reset-%'`),
      // The anonymised rows (ai_call_log, error_events, exercise_library) are left for
      // account-deletion.test.ts's sweep, which matches the same fixture text. Two files sweeping the
      // same generic rows at once delete each other's mid-run, so this one does not.
    ]
    for (const step of steps) await step().catch(() => {})
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    slice = await import('../slices/account-deletion')
    ;({ EXPORTED } = await import('@/lib/export/export-map'))
    g = await readSchemaGraph(pool)
    runStart = (await pool.query<{ t: Date }>(`SELECT clock_timestamp() AS t`)).rows[0].t
    await sweep()
    for (const id of [R, O, S, X, F, G]) await makeUser(pool, id)
    await makeUser(pool, ADM, { admin: true })
    await pool.query(`UPDATE users SET is_admin = true WHERE id = $1`, [S])

    r = await seedEveryUserTable(pool, g, R, { overrides: liveOverrides() })
    o = await seedEveryUserTable(pool, g, O, { overrides: liveOverrides() })
    createdCatalogue.push(...r.createdCatalogue, ...o.createdCatalogue)

    await pool.query(
      `INSERT INTO rate_limits (key, count, window_start) VALUES ($1, 1, now()), ($2, 1, now()) ON CONFLICT (key) DO NOTHING`,
      [`sync-push:${R}`, `sync-push:${O}`])
    await pool.query(`INSERT INTO invited_emails (email) VALUES ($1), ($2) ON CONFLICT DO NOTHING`, [email(R), email(O)])

    for (const t of Object.keys(EXPORTED)) exportedBefore.set(t, await exportedCount(t, R))
    ;({ rows: [before] } = await pool.query(`SELECT * FROM users WHERE id = $1`, [R]))
    ;({ rows: identitiesBefore } = await pool.query(`SELECT * FROM auth_identities WHERE user_id = $1 ORDER BY provider`, [R]))

    result = await slice.resetAccountData(client.getDb(), R, { guard: guard(R), audit, auditSubjectIds: [] } as never)
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

  it('the fixture reaches every exported table, so the oracle below is not vacuous', () => {
    const empty = [...exportedBefore].filter(([t, n]) => n === 0 && t !== 'users').map(([t]) => t)
    expect(empty).toEqual([])
    expect(result.deleted).toBe(true)
  })

  it('every EXPORTED scope reads zero rows for the user, apart from the row a reset keeps', async () => {
    const left: string[] = []
    for (const t of Object.keys(EXPORTED)) if (t !== 'users' && (await exportedCount(t, R)) > 0) left.push(t)
    expect(left).toEqual([])
    expect(await exportedCount('users', R)).toBe(1)
  })

  it('every row the cascade reaches is gone, except the sign-in identities a reset puts back', async () => {
    const survivors: string[] = []
    for (const t of cascadeClosure(g)) {
      if (t === 'auth_identities') continue
      if (await rowExists(pool, g, t, r.rows.get(t)!)) survivors.push(t)
    }
    expect(survivors).toEqual([])
  })

  it('keeps the sign-in: id, email, subject, password hash, admin and active flags, creation time', async () => {
    const { rows: [after] } = await pool.query(`SELECT * FROM users WHERE id = $1`, [R])
    for (const c of ['id', 'email', 'name', 'oauth_sub', 'password_hash', 'is_active', 'is_admin', 'created_at', 'timezone']) {
      expect(after[c], c).toEqual(before[c])
    }
    const { rows: identities } = await pool.query(`SELECT * FROM auth_identities WHERE user_id = $1 ORDER BY provider`, [R])
    expect(identities).toEqual(identitiesBefore)
  })

  it('everything else on the users row starts over', async () => {
    const { rows: [after] } = await pool.query(`SELECT * FROM users WHERE id = $1`, [R])
    expect(after.display_name).toBeNull()
    expect(after.height_cm).toBeNull()
    expect(after.friend_code).toBeNull()
    expect(after.preferences).toEqual({})
  })

  it('can still sign in: the Google subject, the email and the password hash all resolve to the account', async () => {
    const repo = await (await import('@/lib/data')).getRepository()
    expect((await repo.getUserByOAuthSub(SUB(R)))?.id).toBe(R)
    // The identity row, not only the column: the fixture's google subject and the apple one both resolve.
    expect((await repo.getUserByProvider('google', String(r.rows.get('auth_identities')!.subject)))?.id).toBe(R)
    expect((await repo.getUserByProvider('apple', `apple-sub-${R.slice(-4)}`))?.id).toBe(R)
    const byEmail = await repo.getUserByEmail(email(R))
    expect(byEmail?.id).toBe(R)
    expect(byEmail?.passwordHash).toBe('hash-1')
    expect(byEmail?.isActive).toBe(true)
  })

  it('cuts off every earlier session and device: the cut-off is set and the native tokens are gone', async () => {
    const { rows: [u] } = await pool.query(`SELECT sessions_valid_from FROM users WHERE id = $1`, [R])
    expect(u.sessions_valid_from).toBeInstanceOf(Date)
    expect(Date.now() - u.sessions_valid_from.getTime()).toBeLessThan(60_000)
    const { rows: [t] } = await pool.query(`SELECT count(*)::int AS n FROM native_refresh_tokens WHERE user_id = $1`, [R])
    expect(t.n).toBe(0)
    const repo = await (await import('@/lib/data')).getRepository()
    expect((await repo.getUserById(R))?.sessionsValidFrom).toBeInstanceOf(Date)
  })

  it('leaves the other account untouched, including its identities and sessions', async () => {
    const missing: string[] = []
    for (const [t, row] of o.rows) if (!(await rowExists(pool, g, t, row))) missing.push(t)
    expect(missing).toEqual([])
    const { rows: [u] } = await pool.query(`SELECT sessions_valid_from FROM users WHERE id = $1`, [O])
    expect(u.sessions_valid_from).toBeNull()
  })

  it('treats the rows outside the cascade as account deletion does', async () => {
    const { rows: keys } = await pool.query(`SELECT key FROM rate_limits WHERE key = ANY($1)`, [[`sync-push:${R}`, `sync-push:${O}`]])
    expect(keys.map(k => k.key)).toEqual([`sync-push:${O}`])
    const { rows: inv } = await pool.query(`SELECT email FROM invited_emails WHERE email = ANY($1)`, [[email(R), email(O)]])
    expect(inv.map(i => i.email)).toEqual([email(O)])
    // Counted in the transaction, so a sweep in another test file cannot change it; and no row names the user.
    const { rows: [named] } = await pool.query(`SELECT count(*)::int AS n FROM ai_call_log WHERE user_id = $1`, [R])
    expect(named.n).toBe(0)
    expect(result.anonymised).toEqual({ aiCallLog: 1, errorEvents: 1, authoredExercises: 1 })
  })

  it('writes one audit row naming the admin, the target and the counts, in the same transaction', async () => {
    const rows = await auditRows(R)
    expect(rows).toHaveLength(1)
    const [a] = rows
    expect(a.job).toBe('admin-reset-user-data')
    expect(a.actor).toBe(`admin:${S}`)
    expect(a.target_user_id).toBe(R)
    expect(a.outcome).toBe('succeeded')
    const removed = a.parameters.removed as Record<string, number>
    expect(Object.keys(removed).length).toBeGreaterThan(10)
    expect(removed.native_refresh_tokens).toBe(1)
    expect(Number(a.affected_rows)).toBe(Object.values(removed).reduce((x, y) => x + y, 0))
    expect(JSON.stringify(a.parameters)).not.toContain(email(R))
  })
})

describe.skipIf(!canRun)('who an admin wipe may target, and what it needs (#3369)', () => {
  let pool: Pool
  let slice: typeof import('../slices/account-deletion')
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  const audit = { job: 'admin-reset-user-data' as const, actor: `admin:${S}` }
  const jobAudit = { job: 'admin-delete-account' as const, actor: `admin:${S}` }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    db = client.getDb()
    slice = await import('../slices/account-deletion')
    runStart = (await pool.query<{ t: Date }>(`SELECT clock_timestamp() AS t`)).rows[0].t
    await dropEverything(pool, [R, ADM, S, X])
    for (const id of [R, X]) await makeUser(pool, id)
    await makeUser(pool, ADM, { admin: true })
    await makeUser(pool, S, { admin: true })
    for (const id of [R, X, ADM, S]) {
      await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, '2026-09-20', 80)`, [id])
    }
  })
  afterAll(async () => { if (canRun) await dropEverything(pool, [R, ADM, S, X]) })

  const untouched = async (id: string) => {
    const { rows: [m] } = await pool.query(`SELECT count(*)::int AS n FROM body_metrics WHERE user_id = $1`, [id])
    const { rows: [u] } = await pool.query(`SELECT sessions_valid_from FROM users WHERE id = $1`, [id])
    return m.n === 1 && u.sessions_valid_from === null
  }

  it('refuses another admin\'s account for a reset, changing nothing and writing no audit row', async () => {
    const res = await slice.resetAccountData(db, ADM, { guard: { actingAdminId: S, ownerId: S, confirmEmail: email(ADM) }, audit })
    expect(res).toMatchObject({ deleted: false, refused: 'admin-target' })
    expect(await untouched(ADM)).toBe(true)
    const { rows } = await pool.query(`SELECT 1 FROM agent_action_log WHERE target_user_id = $1 AND started_at >= $2`, [ADM, runStart])
    expect(rows).toHaveLength(0)
  })

  it('refuses another admin\'s account for a deletion too, even with the right email', async () => {
    const res = await slice.deleteAccount(db, ADM, { guard: { actingAdminId: S, ownerId: S, confirmEmail: email(ADM) }, audit: jobAudit })
    expect(res).toMatchObject({ deleted: false, refused: 'admin-target' })
    expect(await untouched(ADM)).toBe(true)
  })

  it('refuses a wrong email, in any case or spacing but the right address, and changes nothing', async () => {
    for (const typed of ['', 'someone@else.com', `x${email(R)}`, `${email(R)}x`]) {
      const res = await slice.resetAccountData(db, R, { guard: { actingAdminId: S, ownerId: S, confirmEmail: typed }, audit })
      expect(res, typed).toMatchObject({ deleted: false, refused: 'email-mismatch' })
    }
    expect(await untouched(R)).toBe(true)
  })

  it('refuses an admin deleting their own account', async () => {
    const res = await slice.deleteAccount(db, S, { guard: { actingAdminId: S, ownerId: S, confirmEmail: email(S) }, audit: jobAudit })
    expect(res).toMatchObject({ deleted: false, refused: 'self' })
    expect(await untouched(S)).toBe(true)
  })

  it('lets an admin reset their own account through the repository, keeping the admin flag and seeding the defaults', async () => {
    // Through the repository, not the slice: seeding what a new signup has is its step, because the
    // next sign-in finds the existing row and seeds nothing.
    const repo = await (await import('@/lib/data')).getRepository()
    const res = await repo.resetAccountData(S, { guard: { actingAdminId: S, ownerId: S, confirmEmail: ` ${email(S).toUpperCase()} ` }, audit })
    expect(res.deleted).toBe(true)
    expect(res.defaultsSeeded).toBe(true)
    const { rows: [styles] } = await pool.query(`SELECT count(*)::int AS n FROM progression_styles WHERE user_id = $1`, [S])
    expect(styles.n).toBeGreaterThan(0)
    const { rows: [u] } = await pool.query(`SELECT is_admin, is_active, sessions_valid_from FROM users WHERE id = $1`, [S])
    expect(u).toMatchObject({ is_admin: true, is_active: true })
    expect(u.sessions_valid_from).toBeInstanceOf(Date)
    const { rows: [m] } = await pool.query(`SELECT count(*)::int AS n FROM body_metrics WHERE user_id = $1`, [S])
    expect(m.n).toBe(0)
    const { rows: [fc] } = await pool.query(`SELECT friend_code FROM users WHERE id = $1`, [S])
    expect(fc.friend_code).not.toBeNull()
  })

  it('deletes a non-admin account that holds data when the email is typed, and the audit row survives it', async () => {
    const res = await slice.deleteAccount(db, X, { guard: { actingAdminId: S, ownerId: S, confirmEmail: email(X) }, audit: jobAudit })
    expect(res.deleted).toBe(true)
    expect(res.removed?.body_metrics).toBe(1)
    const { rows: [u] } = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [X])
    expect(u).toBeUndefined()
    // The log's target link is SET NULL with the account; the id is kept in the parameters.
    const { rows } = await pool.query(`SELECT * FROM agent_action_log WHERE parameters->>'targetUserId' = $1 AND started_at >= $2`, [X, runStart])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ job: 'admin-delete-account', actor: `admin:${S}`, target_user_id: null, outcome: 'succeeded' })
    expect(JSON.stringify(rows[0].parameters)).not.toContain(email(X))
  })

  it('the no-data rule still holds for a deletion without the typed email', async () => {
    await makeUser(pool, X)
    await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, '2026-09-20', 80)`, [X])
    const res = await slice.deleteAccount(db, X, { onlyIfNoData: true, guard: { actingAdminId: S, ownerId: S }, audit: jobAudit })
    expect(res).toMatchObject({ deleted: false, refusedHasData: true })
  })

  it('reports not-found for an id with no account', async () => {
    const res = await slice.resetAccountData(db, '00000000-0000-4000-8000-000000000999', { guard: { actingAdminId: S, ownerId: S, confirmEmail: 'a@b.co' }, audit })
    expect(res.deleted).toBe(false)
    expect(res.refused).toBeUndefined()
  })
})

describe.skipIf(!canRun)('a reset that cannot complete (#3369)', () => {
  let pool: Pool
  afterAll(async () => { if (canRun) await dropEverything(pool, [F, G, S]) })

  it('rolls back entirely, the audit row included, when another account\'s row points into this one', async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    const slice = await import('../slices/account-deletion')
    runStart = (await pool.query<{ t: Date }>(`SELECT clock_timestamp() AS t`)).rows[0].t
    await dropEverything(pool, [F, G, S])
    await makeUser(pool, S, { admin: true })   // the acting admin must exist: it is locked and judged in the transaction
    await makeUser(pool, F)
    await makeUser(pool, G)
    const { rows: [item] } = await pool.query(
      `INSERT INTO food_items (user_id, name, calories, source) VALUES ($1, 'f-item', 100, 'manual') RETURNING id`, [F])
    const { rows: [mt] } = await pool.query(`INSERT INTO meal_types (user_id, name) VALUES ($1, 'g-meal') RETURNING id`, [G])
    await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id) VALUES ($1, '2026-09-20', $2, $3)`, [G, mt.id, item.id])

    const err = await slice.resetAccountData(client.getDb(), F, {
      guard: { actingAdminId: S, ownerId: S, confirmEmail: email(F) }, audit: { job: 'admin-reset-user-data', actor: `admin:${S}` }, auditSubjectIds: [],
    } as never).then(() => null, (e: unknown) => e)
    expect(err).not.toBeNull()

    const { rows: [u] } = await pool.query(`SELECT sessions_valid_from, display_name FROM users WHERE id = $1`, [F])
    expect(u).toMatchObject({ sessions_valid_from: null, display_name: 'Shown Name' })
    const { rows: [i] } = await pool.query('SELECT 1 FROM food_items WHERE id = $1', [item.id])
    expect(i, 'its rows are exactly as they were').toBeDefined()
    const { rows: idn } = await pool.query(`SELECT 1 FROM auth_identities WHERE user_id = $1`, [F])
    expect(idn).toHaveLength(1)
    const { rows: act } = await pool.query(`SELECT 1 FROM agent_action_log WHERE parameters->>'targetUserId' = $1 AND started_at >= $2`, [F, runStart])
    expect(act, 'no audit row for a reset that did not happen').toHaveLength(0)
  })
})

// The hole found in review of #3379: `revoke-admin` let any admin demote the owner, and then the
// "never another admin" guard no longer saw an admin. Now the owner's account is protected by id,
// and the acting admin is judged on the row locked inside the transaction.
const OWN = '00000000-0000-4000-8000-0000003369d1'
const OTH = '00000000-0000-4000-8000-0000003369d2'
describe.skipIf(!canRun)('the owner\'s account is protected from other admins (#3369)', () => {
  let pool: Pool
  let slice: typeof import('../slices/account-deletion')
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  const audit = { job: 'admin-reset-user-data' as const, actor: `admin:${OTH}` }
  const jobAudit = { job: 'admin-delete-account' as const, actor: `admin:${OTH}` }
  const guard = (over: Record<string, unknown> = {}) =>
    ({ actingAdminId: OTH, ownerId: OWN, confirmEmail: email(OWN), ...over }) as never
  const intact = async () => {
    const { rows: [m] } = await pool.query(`SELECT count(*)::int AS n FROM body_metrics WHERE user_id = $1`, [OWN])
    const { rows: [u] } = await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [OWN])
    return m.n === 1 && !!u
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    slice = await import('../slices/account-deletion')
    await dropEverything(pool, [OWN, OTH])
    await makeUser(pool, OWN, { admin: true })
    await makeUser(pool, OTH, { admin: true })
    await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, '2026-09-20', 80)`, [OWN])
  })
  afterAll(async () => { if (canRun) await dropEverything(pool, [OWN, OTH]) })

  it('another admin cannot reset or delete the owner', async () => {
    expect(await slice.resetAccountData(db, OWN, { guard: guard(), audit })).toMatchObject({ deleted: false, refused: 'owner-protected' })
    expect(await slice.deleteAccount(db, OWN, { guard: guard(), audit: jobAudit })).toMatchObject({ deleted: false, refused: 'owner-protected' })
    expect(await intact()).toBe(true)
  })

  it('demote-then-wipe is refused: even with the owner stripped of is_admin, the owner id still protects him', async () => {
    // The API can no longer demote the owner; this is the database state the old hole produced.
    await pool.query(`UPDATE users SET is_admin = false WHERE id = $1`, [OWN])
    try {
      expect(await slice.resetAccountData(db, OWN, { guard: guard(), audit })).toMatchObject({ deleted: false, refused: 'owner-protected' })
      expect(await slice.deleteAccount(db, OWN, { guard: guard(), audit: jobAudit })).toMatchObject({ deleted: false, refused: 'owner-protected' })
      expect(await intact()).toBe(true)
    } finally {
      await pool.query(`UPDATE users SET is_admin = true WHERE id = $1`, [OWN])
    }
  })

  it('an acting admin who was demoted or deactivated before the lock is refused', async () => {
    await makeUser(pool, X0)
    await pool.query(`UPDATE users SET is_admin = false WHERE id = $1`, [OTH])
    try {
      expect(await slice.resetAccountData(db, X0, { guard: guard({ confirmEmail: email(X0) }), audit })).toMatchObject({ deleted: false, refused: 'actor-not-admin' })
    } finally {
      await pool.query(`UPDATE users SET is_admin = true WHERE id = $1`, [OTH])
    }
    await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [OTH])
    try {
      expect(await slice.resetAccountData(db, X0, { guard: guard({ confirmEmail: email(X0) }), audit })).toMatchObject({ deleted: false, refused: 'actor-not-admin' })
    } finally {
      await pool.query(`UPDATE users SET is_active = true WHERE id = $1`, [OTH])
      await dropEverything(pool, [X0])
    }
  })

  it('with no resolvable owner, an admin account is refused even when it is your own', async () => {
    expect(await slice.resetAccountData(db, OTH, { guard: guard({ ownerId: null, confirmEmail: email(OTH) }), audit }))
      .toMatchObject({ deleted: false, refused: 'owner-unresolved' })
    expect(await slice.resetAccountData(db, OWN, { guard: guard({ ownerId: null }), audit })).toMatchObject({ refused: 'owner-unresolved' })
    expect(await intact()).toBe(true)
  })

  it('the owner can still reset himself', async () => {
    const res = await slice.resetAccountData(db, OWN, {
      guard: guard({ actingAdminId: OWN }), audit: { job: 'admin-reset-user-data', actor: `admin:${OWN}` },
    })
    expect(res.deleted).toBe(true)
  })
})
const X0 = '00000000-0000-4000-8000-0000003369d3'
