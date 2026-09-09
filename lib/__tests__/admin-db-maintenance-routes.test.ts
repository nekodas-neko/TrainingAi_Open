/**
 * PS-39 — the three admin maintenance routes: `admin/db-snapshot`, `admin/vacuum` and
 * `admin/program-export`.
 *
 * The snapshot route's HELPERS are already covered against real Postgres
 * (`lib/export/__tests__/db-snapshot-integration.test.ts` — drift, primary keys, chunked streaming
 * over a read-only role). Nothing tested the route above them, which is where the decisions with
 * teeth are:
 *
 *   · **Two ways in, and the token widens TRANSPORT, never AUTHORITY.** A bearer caller still has
 *     to pass `requireAdmin` on the resolved export user, so a valid secret naming a non-admin is
 *     refused. The route exists because a sandbox can reach production over 443 and not over 5432.
 *   · **The bearer path is disabled, not skipped, when either half is unset** — a missing secret or
 *     a missing export user id is a rejection. Security checks fail closed.
 *   · **The rate limit runs BEFORE the compare**, so a brute-force attempt is cut off without
 *     `safeCompare` being reached, and a trip and a bad token answer identically.
 *   · **No read-only connection configured is 503, not an open door.**
 *   · **A failure part-way through the stream writes an error LINE**, because the headers are long
 *     gone — the one place an NDJSON export can still say it is incomplete.
 *   · **The audit-log write is best-effort and must never change the response.** That swallow is
 *     legitimate and `check-admin-guard-catch.js` allows it by name; a test asserting the response
 *     survives a logging failure is what keeps it from being "tidied up" later.
 *   · **`vacuum`'s allowlist is the safety boundary**, because `VACUUM` takes no bind parameter and
 *     the table name is interpolated into the statement.
 *
 * Not exercised: no SQL runs — the pools are stand-ins, so this says nothing about the snapshot's
 * fidelity or about a real `VACUUM FULL` reclaiming anything. Web/Node only: no device.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)
const reportServerError = vi.fn((..._a: unknown[]) => undefined)
const safeCompare = vi.fn((a: string, b: string) => a === b)

const auditQuery = vi.fn(async (..._a: unknown[]) => ({ rows: [] as Row[] }))
const roQuery = vi.fn(async (..._a: unknown[]) => ({ rows: [{ n: 2 }] as Row[] }))
const isReadonlyDbConfigured = vi.fn(() => true)

const readTableColumns = vi.fn(async (..._a: unknown[]) => ({ views: new Set(['a', 'b']) }))
const checkDrift = vi.fn((..._a: unknown[]) => undefined)
const getPrimaryKeyColumns = vi.fn(async (..._a: unknown[]) => ['id'])
const bulkWindowFor = vi.fn((..._a: unknown[]) => null as unknown)
const resolveRequestedTables = vi.fn((..._a: unknown[]) => ({ toExport: ['users'], omitted: [] as Row[] }))
let streamedRows: Row[] = [{ id: 1 }, { id: 2 }]
let streamThrows: Error | null = null
const streamTableRows = vi.fn(async function* (..._a: unknown[]) {
  if (streamThrows) throw streamThrows
  for (const r of streamedRows) yield r
})

const vacuumTableFull = vi.fn(async (_t: string) => ({
  table: 'error_events', liveRows: 4, beforeBytes: 49_000_000, afterBytes: 24_000, reclaimedBytes: 48_976_000, ms: 900,
}))

const getActiveProgram = vi.fn(async (_u: string) => null as Row | null)
const listProgressionStyles = vi.fn(async (_u: string) => [] as Row[])
const getExerciseEquipment = vi.fn(async (_n: string[]) => ({}) as Record<string, string>)

let sessionUser: { id: string; isAdmin?: boolean } | null = { id: 'u-1', isAdmin: true }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
vi.mock('@/lib/security/constant-time', () => ({ safeCompare: (a: string, b: string) => safeCompare(a, b) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getUserById,
    vacuumTableFull: (t: string) => vacuumTableFull(t),
    getActiveProgram: (u: string) => getActiveProgram(u),
    listProgressionStyles: (u: string) => listProgressionStyles(u),
    getExerciseEquipment: (n: string[]) => getExerciseEquipment(n),
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@/lib/data/postgres/client', () => ({
  getPool: () => ({ query: (...a: unknown[]) => auditQuery(...a) }),
  getDb: () => ({}),
  ensureSchema: async () => undefined,
}))
vi.mock('@/lib/data/postgres/readonly-client', () => ({
  getReadonlyPool: () => ({ query: (...a: unknown[]) => roQuery(...a) }),
  isReadonlyDbConfigured: () => isReadonlyDbConfigured(),
  describeReadonlyConnection: () => ({ host: 'ro.example', database: 'app' }),
}))
vi.mock('@/lib/export/db-snapshot', () => ({
  readTableColumns: (...a: unknown[]) => readTableColumns(...a),
  checkDrift: (...a: unknown[]) => checkDrift(...a),
  getPrimaryKeyColumns: (...a: unknown[]) => getPrimaryKeyColumns(...a),
  streamTableRows: (...a: unknown[]) => streamTableRows(...a),
  resolveRequestedTables: (...a: unknown[]) => resolveRequestedTables(...a),
  bulkWindowFor: (...a: unknown[]) => bulkWindowFor(...a),
  quoteIdent: (id: string) => `"${id}"`,
}))

import { GET as snapshotGet } from '@/app/api/admin/db-snapshot/route'
import { GET as vacuumGet, POST as vacuumPost } from '@/app/api/admin/vacuum/route'
import { GET as programExportGet } from '@/app/api/admin/program-export/route'

const snapshotReq = async (qs = '', headers: Record<string, string> = {}) => {
  const { NextRequest } = await import('next/server')
  return snapshotGet(new NextRequest(`http://localhost/api/admin/db-snapshot${qs}`, { headers }))
}

const vacuumReq = (body: unknown) =>
  vacuumPost(new Request('http://localhost/api/admin/vacuum', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))

const programReq = async (qs = '') => {
  const { NextRequest } = await import('next/server')
  return programExportGet(new NextRequest(`http://localhost/api/admin/program-export${qs}`))
}

/** Read an NDJSON body back into the objects the route pushed, in order. */
const ndjson = async (res: Response): Promise<Row[]> =>
  (await res.text()).split('\n').filter(Boolean).map(l => JSON.parse(l) as Row)

beforeEach(() => {
  for (const m of [getUserById, rateLimit, reportServerError, safeCompare, auditQuery, roQuery,
                   isReadonlyDbConfigured, readTableColumns, checkDrift, getPrimaryKeyColumns,
                   bulkWindowFor, resolveRequestedTables, streamTableRows, vacuumTableFull,
                   getActiveProgram, listProgressionStyles, getExerciseEquipment]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isAdmin: true })
  safeCompare.mockImplementation((a: string, b: string) => a === b)
  auditQuery.mockResolvedValue({ rows: [] })
  roQuery.mockResolvedValue({ rows: [{ n: 2 }] })
  isReadonlyDbConfigured.mockReturnValue(true)
  readTableColumns.mockResolvedValue({ views: new Set(['a', 'b']) })
  checkDrift.mockImplementation(() => undefined)
  resolveRequestedTables.mockReturnValue({ toExport: ['users'], omitted: [] })
  vacuumTableFull.mockResolvedValue({
    table: 'error_events', liveRows: 4, beforeBytes: 49_000_000, afterBytes: 24_000, reclaimedBytes: 48_976_000, ms: 900,
  })
  getActiveProgram.mockResolvedValue(null)
  listProgressionStyles.mockResolvedValue([])
  getExerciseEquipment.mockResolvedValue({})
  streamedRows = [{ id: 1 }, { id: 2 }]
  streamThrows = null
  sessionUser = { id: 'u-1', isAdmin: true }
  process.env.ADMIN_SNAPSHOT_SECRET = 'snapshot-secret'
  process.env.ADMIN_EXPORT_USER_ID = 'owner-1'
})

afterEach(() => {
  delete process.env.ADMIN_SNAPSHOT_SECRET
  delete process.env.ADMIN_EXPORT_USER_ID
  delete process.env.WEBHOOK_USER_ID
})

describe('the admin gate on all three', () => {
  const ALL: [string, () => Promise<Response>][] = [
    ['snapshot GET', () => snapshotReq()],
    ['vacuum GET', () => vacuumGet()],
    ['vacuum POST', () => vacuumReq({ table: 'error_events' })],
    ['program-export GET', () => programReq()],
  ]

  it('refuses a non-admin, whatever the token claims', async () => {
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isAdmin: false })
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(403)
    expect(vacuumTableFull).not.toHaveBeenCalled()
    expect(readTableColumns).not.toHaveBeenCalled()
  })

  it('answers 503 when the CHECK could not run, not 403 (Q-548)', async () => {
    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    for (const [name, call] of ALL) {
      const res = await call()
      expect(res.status, name).toBe(503)
      expect(await res.json(), name).toEqual({ error: 'Service unavailable' })
    }
  })

  it('answers 401 with no session, before touching the repository', async () => {
    sessionUser = null
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(401)
    expect(getUserById).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/db-snapshot — the two ways in', () => {
  const bearer = (token: string) => snapshotReq('', { authorization: `Bearer ${token}` })

  it('accepts a valid bearer token with no session at all', async () => {
    sessionUser = null
    const res = await bearer('snapshot-secret')
    expect(res.status).toBe(200)
    expect(getUserById).toHaveBeenCalledWith('owner-1')
  })

  it('the token widens TRANSPORT, not AUTHORITY — a valid secret naming a non-admin is refused', async () => {
    // The property worth having a test for. Without it, the secret alone would be a second,
    // weaker admin credential rather than another way to reach the same one.
    sessionUser = null
    getUserById.mockResolvedValue({ isAdmin: false })
    const res = await bearer('snapshot-secret')
    expect(res.status).toBe(403)
    expect(readTableColumns).not.toHaveBeenCalled()
  })

  it('answers 503 when the bearer path’s OWN admin check could not run', async () => {
    sessionUser = null
    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    expect((await bearer('snapshot-secret')).status).toBe(503)
  })

  it('disables the bearer path when EITHER half is unset, rather than skipping the check', async () => {
    // Two separate env vars, and a fixture missing only one of them cannot tell which the route
    // requires — so each is removed on its own.
    sessionUser = null
    delete process.env.ADMIN_SNAPSHOT_SECRET
    expect((await bearer('snapshot-secret')).status, 'no secret').toBe(401)

    process.env.ADMIN_SNAPSHOT_SECRET = 'snapshot-secret'
    delete process.env.ADMIN_EXPORT_USER_ID
    expect((await bearer('snapshot-secret')).status, 'no export user').toBe(401)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it('falls back to WEBHOOK_USER_ID for the export user', async () => {
    sessionUser = null
    delete process.env.ADMIN_EXPORT_USER_ID
    process.env.WEBHOOK_USER_ID = 'owner-2'
    expect((await bearer('snapshot-secret')).status).toBe(200)
    expect(getUserById).toHaveBeenCalledWith('owner-2')
  })

  it('rate-limits BEFORE the compare, and answers a trip identically to a bad token', async () => {
    // Same status, same body: a caller must not be able to tell "you are being throttled" from
    // "that token is wrong", or the throttle itself becomes an oracle.
    sessionUser = null
    rateLimit.mockReturnValue(false)
    const tripped = await bearer('snapshot-secret')
    expect(tripped.status).toBe(401)
    expect(await tripped.json()).toEqual({ error: 'Unauthorized' })
    expect(safeCompare).not.toHaveBeenCalled()

    rateLimit.mockReturnValue(true)
    const wrong = await bearer('not-the-secret')
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toEqual({ error: 'Unauthorized' })
  })

  it('compares the token in constant time rather than with ===', async () => {
    sessionUser = null
    await bearer('snapshot-secret')
    expect(safeCompare).toHaveBeenCalledWith('snapshot-secret', 'snapshot-secret')
  })

  it('ignores a malformed authorization header and falls through to the session', async () => {
    // `Basic ...` is not a bearer, so the route must not treat it as a failed token attempt and
    // 401 a legitimately signed-in admin.
    sessionUser = { id: 'u-1', isAdmin: true }
    const res = await snapshotReq('', { authorization: 'Basic abc' })
    expect(res.status).toBe(200)
  })
})

describe('GET /api/admin/db-snapshot — the export itself', () => {
  it('is 503 when no read-only connection is configured', async () => {
    // Fail closed: the feature being unconfigured means off, not "read through the main pool".
    isReadonlyDbConfigured.mockReturnValue(false)
    const res = await snapshotReq()
    expect(res.status).toBe(503)
    expect(roQuery).not.toHaveBeenCalled()
  })

  it('sends NDJSON as an attachment, uncached', async () => {
    const res = await snapshotReq()
    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="db-snapshot.ndjson"')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('writes the manifest first, then rows, then a per-table completion line', async () => {
    const lines = await ndjson(await snapshotReq())
    expect(lines[0]).toMatchObject({ manifest: true, tables: ['users'], viewCount: 2, bulk: '0' })
    expect(lines.slice(1, 3)).toEqual([{ table: 'users', row: { id: 1 } }, { table: 'users', row: { id: 2 } }])
    expect(lines[3]).toEqual({ tableComplete: 'users', rowCount: 2 })
  })

  it('counts rows from this request’s own read, and reports a failed count as null', async () => {
    // A consumer must never infer completeness from what happens to be in the file. A count that
    // could not be taken is `null`, which is a different claim from `0`.
    roQuery.mockRejectedValue(new Error('permission denied'))
    const lines = await ndjson(await snapshotReq())
    expect(lines[0]).toMatchObject({ rowCounts: { users: null } })
  })

  it('fails the export on schema drift rather than exporting a partial shape', async () => {
    checkDrift.mockImplementation(() => { throw new Error('claude_ro.users is missing column `nickname`') })
    const res = await snapshotReq()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({
      error: 'Failed to prepare the snapshot',
      connection: { host: 'ro.example' },
    })
    expect(reportServerError).toHaveBeenCalled()
  })

  it('writes an error LINE when it fails part-way, because the headers are already sent', async () => {
    // A 200 whose body simply stops is the failure mode this line exists to prevent — the consumer
    // has a file that looks complete. The status cannot be changed by then; the stream can say so.
    streamThrows = new Error('connection terminated unexpectedly')
    const res = await snapshotReq()
    expect(res.status).toBe(200)
    const lines = await ndjson(res)
    expect(lines[0]).toMatchObject({ manifest: true })
    expect(lines[lines.length - 1]).toEqual({ error: 'Snapshot failed part-way through — see server logs' })
    expect(reportServerError).toHaveBeenCalled()
  })

  it('audits both the success and the part-way failure', async () => {
    await ndjson(await snapshotReq())
    const okParams = auditQuery.mock.calls[0][1] as unknown[]
    expect(okParams[1]).toBe(true)
    expect(okParams[2]).toBeNull()

    auditQuery.mockClear()
    streamThrows = new Error('boom')
    await ndjson(await snapshotReq())
    expect((auditQuery.mock.calls[0][1] as unknown[])[1]).toBe(false)
    expect((auditQuery.mock.calls[0][1] as unknown[])[2]).toBe('boom')
  })

  it('still serves the export when the AUDIT WRITE fails — deliberately, and pinned', async () => {
    // The one legitimate swallow in this file, allowed by name in `check-admin-guard-catch.js`.
    // Losing an audit row is bad; refusing the snapshot because the log is down is worse, and the
    // pattern matches /api/admin/db-query. This test is what stops it being "tidied up" later.
    auditQuery.mockRejectedValue(new Error('db_query_log is missing'))
    const res = await snapshotReq()
    expect(res.status).toBe(200)
    const lines = await ndjson(res)
    expect(lines[lines.length - 1]).toEqual({ tableComplete: 'users', rowCount: 2 })
  })

  it('passes the requested tables and bulk window through to the resolver', async () => {
    // Two different params: a fixture setting only one could not tell which the resolver received.
    await snapshotReq('?tables=users,sleep_sessions&bulk=30')
    expect(resolveRequestedTables.mock.calls[0].slice(1)).toEqual(['users,sleep_sessions', '30'])
    expect(bulkWindowFor).toHaveBeenCalledWith('users', '30')
  })

  it('reports omitted tables in the manifest with their reason', async () => {
    // "Not in the file" and "deliberately left out, because" are different, and only the second
    // lets a consumer trust what IS there.
    resolveRequestedTables.mockReturnValue({
      toExport: ['users'],
      omitted: [{ table: 'oura_raw_samples', reason: 'bulk table, no window requested' }],
    })
    const lines = await ndjson(await snapshotReq())
    expect(lines[0]).toMatchObject({
      omitted: [{ table: 'oura_raw_samples', reason: 'bulk table, no window requested' }],
    })
  })
})

describe('/api/admin/vacuum', () => {
  it('lists what may be vacuumed, with what each holds', async () => {
    const body = await (await vacuumGet()).json()
    expect(body.tables).toEqual(expect.arrayContaining([
      { table: 'oura_raw_samples', what: 'raw BLE frames' },
      { table: 'error_events', what: 'server error log' },
    ]))
  })

  it('vacuums an allowlisted table and returns the reclaim', async () => {
    const body = await (await vacuumReq({ table: 'error_events' })).json()
    expect(vacuumTableFull).toHaveBeenCalledWith('error_events')
    expect(body).toMatchObject({ reclaimedBytes: 48_976_000, liveRows: 4 })
  })

  it('refuses a table outside the allowlist, and names what is allowed', async () => {
    // The allowlist is the safety boundary: `VACUUM` takes no bind parameter, so the name is
    // interpolated into the statement.
    const res = await vacuumReq({ table: 'users' })
    expect(res.status).toBe(400)
    expect((await res.json()).allowed).toEqual(expect.arrayContaining(['error_events']))
    expect(vacuumTableFull).not.toHaveBeenCalled()
  })

  it('refuses an inherited property name, not just an unlisted one', async () => {
    // `hasOwnProperty`, not a bare lookup: the allowlist is a plain object literal, so
    // `constructor` and `toString` would otherwise read as members and be interpolated into SQL.
    for (const table of ['constructor', 'toString', '__proto__', 'valueOf']) {
      expect((await vacuumReq({ table })).status, table).toBe(400)
    }
    expect(vacuumTableFull).not.toHaveBeenCalled()
  })

  it('refuses a missing, non-string or unreadable body through the same allowlist check', async () => {
    for (const body of [{}, { table: 42 }, { table: null }]) {
      expect((await vacuumReq(body)).status, JSON.stringify(body)).toBe(400)
    }
    const unreadable = await vacuumPost(new Request('http://localhost/api/admin/vacuum', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ not json',
    }))
    expect(unreadable.status).toBe(400)
    expect(vacuumTableFull).not.toHaveBeenCalled()
  })

  it('answers 500 when the vacuum itself fails, rather than a 200 with nothing reclaimed', async () => {
    // A VACUUM FULL needs free disk equal to the table's size, so "it failed" and "there was
    // nothing to reclaim" are very different answers and must not both read as success.
    vacuumTableFull.mockRejectedValue(new Error('could not extend file: No space left on device'))
    const res = await vacuumReq({ table: 'error_events' })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('No space left on device')
  })

  it('rate-limits the write at a deliberately low allowance, and not the read', async () => {
    // Whole-table maintenance holds an ACCESS EXCLUSIVE lock. The GET is a list and is not limited.
    rateLimit.mockReturnValue(false)
    expect((await vacuumReq({ table: 'error_events' })).status).toBe(429)
    expect(rateLimit.mock.calls[0].slice(1)).toEqual([4, 60_000])
    expect((await vacuumGet()).status).toBe(200)
    expect(vacuumTableFull).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/program-export', () => {
  const PROGRAM = {
    name: 'Hypertrophy Block', trainingGoal: 'hypertrophy', phaseMode: 'linear',
    sessions: [{
      id: 's-1', name: 'Session One', timeBudgetMinutes: 60,
      exercises: [
        { exerciseName: 'Row', position: 2, styleId: 'st-1', exerciseRole: 'accessory', muscleGroups: ['back'], supersetGroup: null },
        { exerciseName: 'Bench Press', position: 1, styleId: 'st-1', muscleGroups: ['chest'], supersetGroup: 'A' },
      ],
    }],
  }
  const STYLE = {
    id: 'st-1',
    sets: [
      { setNumber: 2, reps: 8, pct: 75, restSec: 120 },
      { setNumber: 1, reps: 10, pct: 70, restSec: 90 },
    ],
  }

  it('is 404 with no active program, rather than an empty export', async () => {
    const res = await programReq()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No active program' })
  })

  it('orders exercises by position and sets by set number, not by arrival', async () => {
    // Both fixtures are deliberately out of order — a list already sorted proves nothing about a
    // sort — and the two orderings are separate code paths on different keys.
    getActiveProgram.mockResolvedValue(PROGRAM)
    listProgressionStyles.mockResolvedValue([STYLE])
    const body = await (await programReq()).json()
    const ex = body.program.sessions[0].exercises
    expect(ex.map((e: Row) => e.name)).toEqual(['Bench Press', 'Row'])
    expect(ex[0].sets).toEqual([
      { reps: 10, pct: 70, restSec: 90 },
      { reps: 8, pct: 75, restSec: 120 },
    ])
  })

  it('defaults a missing role to primary and keeps an explicit one', async () => {
    // A fixture where every exercise carried a role could not tell the default from the field.
    getActiveProgram.mockResolvedValue(PROGRAM)
    listProgressionStyles.mockResolvedValue([STYLE])
    const ex = (await (await programReq()).json()).program.sessions[0].exercises
    expect(ex[0].role).toBe('primary')
    expect(ex[1].role).toBe('accessory')
  })

  it('estimates a duration beside the budget, and leaves an unstyled exercise out of it', async () => {
    // An exercise with no style contributes no sets and so no estimate — otherwise a program half
    // way through being configured reads as if it were shorter than it is, rather than incomplete.
    getActiveProgram.mockResolvedValue({
      ...PROGRAM,
      sessions: [{ ...PROGRAM.sessions[0], exercises: [{ exerciseName: 'Curl', position: 1, styleId: null, muscleGroups: [] }] }],
    })
    listProgressionStyles.mockResolvedValue([STYLE])
    const s = (await (await programReq()).json()).program.sessions[0]
    expect(s.budgetMin).toBe(60)
    expect(s.estMin).toBe(0)
  })

  it('asks for equipment once per distinct exercise name across the whole program', async () => {
    getActiveProgram.mockResolvedValue({
      ...PROGRAM,
      sessions: [PROGRAM.sessions[0], { ...PROGRAM.sessions[0], id: 's-2', name: 'Session Two' }],
    })
    listProgressionStyles.mockResolvedValue([STYLE])
    await programReq()
    expect(getExerciseEquipment).toHaveBeenCalledWith(['Row', 'Bench Press'])
  })

  it('returns plain text on ?format=text and JSON otherwise, from the same render', async () => {
    getActiveProgram.mockResolvedValue(PROGRAM)
    listProgressionStyles.mockResolvedValue([STYLE])
    const asText = await programReq('?format=text')
    expect(asText.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    const text = await asText.text()
    expect(text).toContain('Hypertrophy Block')

    const asJson = await (await programReq()).json()
    expect(asJson.text).toBe(text)
    expect(asJson.program.programName).toBe('Hypertrophy Block')
  })

  it('treats any other format value as the JSON default', async () => {
    getActiveProgram.mockResolvedValue(PROGRAM)
    listProgressionStyles.mockResolvedValue([STYLE])
    const res = await programReq('?format=csv')
    expect(res.headers.get('Content-Type')).toContain('application/json')
  })
})
