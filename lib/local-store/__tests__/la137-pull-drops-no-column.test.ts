// LA-137 — a sync pull must not drop a column that `applyDelta` writes.
//
// `applyDelta` writes `col = excluded.col` unconditionally, so a column the server's delta select or
// the client's pull mapper leaves out is not left alone: it is NULLED on every pull (RV-172 found
// three). A source parser was tried first and defeated by false positives, so this runs the path
// itself instead:
//
//   1. give the caller ONE row in every server table the delta reads, with EVERY column populated
//      (generated from information_schema, parents created for each foreign key);
//   2. run the client's real `pullDelta`, whose `fetch` is answered by the real `/api/sync/pull`
//      handler, so the JSON is exactly what the phone receives;
//   3. capture every upsert `applyDelta` executes against a real local schema (`MIGRATIONS` on
//      `node:sqlite`), and read the value bound to each column.
//
// A column bound to NULL when its server row held a value was dropped between the select and the
// store. No parsing of TypeScript; the SQL inspected is the statement that actually ran.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { NextRequest } from 'next/server'

const USER = '00000000-0000-4000-8000-0000000a1370'
const canRun = !!process.env.DATABASE_URL

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane' } })) }))

const local = { db: null as DatabaseSync | null }
const captured: { sql: string; params: unknown[] }[] = []
const bindable = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)
vi.mock('@/lib/sqlite/sqlite-service', () => ({
  runSQL: vi.fn(async (sql: string, p: unknown[] = []) => {
    // Every INSERT, not only the `excluded` upserts: an `INSERT OR REPLACE` rewrites the whole row,
    // so a column it binds to NULL is lost exactly as an upsert's is.
    if (/^\s*INSERT\b/i.test(sql)) captured.push({ sql, params: [...p] })
    local.db!.prepare(sql).run(...(p.map(bindable) as never[]))
  }),
  querySQL: vi.fn(async (sql: string, p: unknown[] = []) => local.db!.prepare(sql).all(...(p.map(bindable) as never[]))),
  beginTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(),
  isSQLiteAvailable: () => true, isLocalStoreDead: () => false,
}))

// The server tables `getSyncDelta` reads, plus the vials the push path mirrors.
const DELTA_TABLES = [
  'activity_logs', 'body_metrics', 'day_checkins', 'exercise_logs', 'fitness_tests', 'food_items',
  'food_logs', 'injuries', 'meal_plan_meals', 'meal_plan_variants', 'meal_plans', 'mood_logs',
  'oura_daily', 'oura_daily_derived', 'oura_daily_summary', 'personal_records', 'plan_meal_answers',
  'prescribed_runs', 'program_sessions', 'programs', 'progression_styles', 'schedule_days',
  'schedules', 'session_exercises', 'set_logs', 'sleep_sessions', 'style_sets', 'supplement_logs',
  'supplements', 'workout_sessions',
]

describe.skipIf(!canRun)('a sync pull drops no column applyDelta writes (LA-137)', () => {
  let pool: import('pg').Pool
  const created: { table: string; key: string; value: unknown }[] = []
  let fks: { t: string; c: string; rt: string; rc: string }[] = []

  /** Remove the user and every row that points at it, cascading or not (exercise_library.created_by does not). */
  async function clearUser() {
    for (let pass = 0; pass < 2; pass++) {
      for (const f of fks.filter(f => f.rt === 'users')) await pool.query(`DELETE FROM ${f.t} WHERE ${f.c} = $1`, [USER]).catch(() => {})
      for (const c of [...created].reverse()) await pool.query(`DELETE FROM ${c.table} WHERE ${c.key} = $1`, [c.value]).catch(() => {})
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    fks = (await pool.query(`
      SELECT tc.table_name t, kcu.column_name c, ccu.table_name rt, ccu.column_name rc
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`)).rows
    await clearUser()
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`, [USER, `la137-${USER}@example.com`])
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE $1`, [`%${USER}%`])

    const checks = (await pool.query(`
      SELECT conrelid::regclass::text t, pg_get_constraintdef(oid) d FROM pg_constraint WHERE contype = 'c'`)).rows as { t: string; d: string }[]

    const made = new Map<string, Record<string, unknown>>()
    const building = new Set<string>()
    async function rowFor(table: string): Promise<Record<string, unknown>> {
      if (table === 'users') return { id: USER }
      const have = made.get(table)
      if (have) return have
      if (building.has(table)) throw new Error(`LA-137 fixture: foreign-key cycle through ${table}`)
      building.add(table)
      const cols = (await pool.query(
        `SELECT column_name c, udt_name u, is_generated g, column_default d, is_nullable n FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table])).rows as { c: string; u: string; g: string; d: string | null; n: string }[]
      const row: Record<string, unknown> = {}
      for (const { c, u, g, n } of cols) {
        if (g === 'ALWAYS') continue
        const fk = fks.find(f => f.t === table && f.c === c)
        // A cycle (programs → phase_sets → programs) is broken at its nullable edge.
        if (fk && building.has(fk.rt) && n === 'YES') { row[c] = null; continue }
        if (fk) { row[c] = (await rowFor(fk.rt))[fk.rc]; continue }
        if (c === 'deleted_at') { row[c] = null; continue }
        const allowed = checks.find(k => k.t === table && k.d.includes(`(${c} = `))?.d.match(/'([^']+)'::text/)
        if (allowed) { row[c] = allowed[1]; continue }
        row[c] = valueFor(u, c)
      }
      const names = Object.keys(row)
      const res = await pool.query(
        `INSERT INTO ${table} (${names.map(n => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
        names.map(n => row[n]),
      )
      const inserted = res.rows[0] as Record<string, unknown>
      made.set(table, inserted)
      building.delete(table)
      if (!('user_id' in inserted)) created.push({ table, key: 'id', value: inserted.id })
      return inserted
    }
    for (const t of DELTA_TABLES) await rowFor(t)
  }, 60_000)

  afterAll(async () => {
    if (!canRun) return
    await clearUser()
  })

  it('binds a value to every column of every pull upsert', async () => {
    const { MIGRATIONS, RECONCILE_COLUMNS } = await import('@/lib/sqlite/migrations')
    local.db = new DatabaseSync(':memory:')
    for (const m of MIGRATIONS) for (const s of m.statements) { try { local.db.exec(s) } catch { /* the service tolerates a column that is already there */ } }
    for (const c of RECONCILE_COLUMNS) { try { local.db.exec(c.ddl) } catch { /* already present */ } }

    const { GET } = await import('@/app/api/sync/pull/route')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).startsWith('/api/sync/pull')
      ? GET(new NextRequest(`http://localhost${url}`))
      : new Response('{}', { status: 404 })))

    const { SQLiteLocalStore } = await import('../sqlite-backend')
    const store = new SQLiteLocalStore()
    vi.doMock('@/lib/local-store/index', async orig => ({ ...(await orig<object>()), getLocalStore: () => store }))
    const { pullDelta } = await import('../sync-engine')
    await pullDelta(USER, true, true, true)

    const dropped: string[] = []
    const tablesSeen = new Set<string>()
    for (const { sql, params } of captured) {
      const head = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*/i)
      if (!head) continue
      const [whole, table, colList] = head
      const valueList = firstGroup(sql.slice(sql.indexOf(whole) + whole.length))
      if (valueList == null) continue
      tablesSeen.add(table)
      const columns = colList.split(',').map(s => s.trim())
      const tokens = splitTopLevel(valueList)
      const perRow = tokens.reduce((n, t) => n + (t.match(/\?/g)?.length ?? 0), 0)
      for (let offset = 0; offset + perRow <= params.length; offset += perRow) {
        let i = offset
        tokens.forEach((tok, k) => {
          const q = tok.match(/\?/g)?.length ?? 0
          // `deleted_at` is the one column the fixture leaves NULL on the server (a live row), so NULL is right.
          if (q > 0 && columns[k] !== 'deleted_at' && looksDropped(params[i])) dropped.push(`${table}.${columns[k]}`)
          i += q
        })
      }
    }
    const report = [...new Set(dropped)].sort()
    if (process.env.LA137_OUT) writeFileSync(process.env.LA137_OUT, JSON.stringify({ tablesSeen: [...tablesSeen].sort(), dropped: report }, null, 2))
    // Coverage: a table that stops arriving would pass the check above by having nothing to check.
    expect([...tablesSeen].sort()).toEqual(expect.arrayContaining([
      'activity_logs', 'body_metrics', 'day_checkins', 'exercise_logs', 'fitness_tests', 'food_items', 'food_logs',
      'injuries', 'local_programs', 'local_progression_styles', 'meal_plan_meals', 'meal_plan_variants', 'meal_plans',
      'mood_logs', 'oura_daily', 'oura_daily_derived', 'oura_daily_summary', 'personal_records', 'plan_meal_answers',
      'prescribed_runs', 'program_sessions', 'schedule_days', 'schedules', 'session_exercises', 'set_logs',
      'sleep_sessions', 'style_sets', 'supplement_logs', 'supplements', 'workout_sessions',
    ]))
    expect(report).toEqual([])
  }, 60_000)
})

/**
 * What a missing field turns into on its way to the store. NULL is the plain case. The others are the
 * coerced ones, which never bind NULL: `Boolean(undefined)` is how `exercise_deloaded` wrote 0 over
 * every synced row (RV-172), and `Number(undefined)` / `String(undefined)` do the same for numbers
 * and text. The fixture never uses 0, false or those strings (every number is 3 or 1.5, every
 * boolean true, every text a tagged value), so any of them here came from a field that was absent.
 */
function looksDropped(v: unknown): boolean {
  return v === null || v === undefined || v === false || v === 0 || (typeof v === 'number' && Number.isNaN(v))
    || v === 'undefined' || v === 'null' || v === 'NaN'
}

/** The contents of the first balanced `( … )` group at the start of `s`. */
function firstGroup(s: string): string | null {
  if (s[0] !== '(') return null
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    if (s[i] === ')' && --depth === 0) return s.slice(1, i)
  }
  return null
}

function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function valueFor(udt: string, column: string): unknown {
  const tag = `la137-${column}-${randomUUID().slice(0, 8)}`
  switch (udt) {
    case 'uuid': return randomUUID()
    case 'text': case 'varchar': return column === 'date' ? '2026-09-27' : column.endsWith('_time') ? '07:30' : tag
    case 'int2': case 'int4': case 'int8': return 3
    case 'float4': case 'float8': case 'numeric': return 1.5
    case 'bool': return true
    case 'date': return '2026-09-27'
    case 'timestamptz': case 'timestamp': return new Date(Date.now() - 3_600_000)
    case 'time': return '07:30:00'
    case 'jsonb': case 'json': return JSON.stringify([{ la137: 1 }])
    case '_text': return [tag]
    case '_int4': return [3]
    case '_float8': return [1.5]
    default: throw new Error(`LA-137 fixture: no value for type ${udt} (${column})`)
  }
}
