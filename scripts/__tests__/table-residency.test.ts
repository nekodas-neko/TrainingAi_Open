import { describe, expect, it } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const L = require('../lib/table-residency')

/**
 * #2489. The residency check is only worth its place in Custom Rules if it still fails on the two
 * drifts it exists for — a table the code creates with no entry, and an entry for a table that is
 * gone — and does not fail on the idioms the real migrations use.
 */

const list = () => ({
  postgres: {
    food_logs: { class: 'DEVICE-FIRST', note: 'n' },
    programs: { class: 'SERVER-FIRST MIRROR', note: 'n' },
    users: { class: 'SERVER-ONLY', note: 'n' },
  },
  local: {
    food_logs: { class: 'MIRROR', mirrors: 'food_logs' },
    local_programs: { class: 'MIRROR', mirrors: 'programs' },
    mutations_outbox: { class: 'DEVICE INFRA', note: 'n' },
  },
  native: {
    raw: { class: 'NATIVE RAW STORE', note: 'n' },
  },
})
const code = () => ({
  postgres: ['food_logs', 'programs', 'users'],
  local: ['food_logs', 'local_programs', 'mutations_outbox'],
  native: ['raw'],
})

describe('findProblems', () => {
  it('passes when every table has exactly one well-formed entry', () => {
    expect(L.findProblems(code(), list())).toEqual([])
  })

  it('fails on a new pgTable with no entry', () => {
    const c = code()
    c.postgres.push('walk_events')
    expect(L.findProblems(c, list())).toEqual([{ kind: 'missing', section: 'postgres', table: 'walk_events' }])
  })

  it('fails on a new local CREATE TABLE with no entry', () => {
    const c = code()
    c.local.push('walk_cache')
    expect(L.findProblems(c, list())).toEqual([{ kind: 'missing', section: 'local', table: 'walk_cache' }])
  })

  it('fails on a new native table with no entry', () => {
    const c = code()
    c.native.push('link_stats')
    expect(L.findProblems(c, list())).toEqual([{ kind: 'missing', section: 'native', table: 'link_stats' }])
  })

  it('fails on an entry for a table the code no longer creates', () => {
    const l = list()
    l.postgres = { ...l.postgres, oura_tokens: { class: 'SERVER-ONLY', note: 'gone' } }
    expect(L.findProblems(code(), l)).toEqual([{ kind: 'stale', section: 'postgres', table: 'oura_tokens' }])
  })

  it('fails on a class the doc does not define', () => {
    const l = list()
    l.postgres.users = { class: 'SERVER ONLY', note: 'typo' }
    expect(L.findProblems(code(), l)).toEqual([{ kind: 'bad-class', section: 'postgres', table: 'users', detail: 'SERVER ONLY' }])
  })

  it('fails on a local mirror of a table classed as having no device copy', () => {
    const l = list()
    l.local = { ...l.local, users: { class: 'MIRROR', mirrors: 'users' } }
    const c = code()
    c.local.push('users')
    expect(L.findProblems(c, l)).toEqual([
      { kind: 'bad-mirror', section: 'local', table: 'users', detail: "mirrors 'users', classed SERVER-ONLY (no device copy)" },
    ])
  })

  it('fails on a mirrored Postgres class that no local table mirrors', () => {
    const l = list()
    delete (l.local as Record<string, unknown>).local_programs
    const c = code()
    c.local = c.local.filter(t => t !== 'local_programs')
    expect(L.findProblems(c, l)).toEqual([
      { kind: 'bad-mirror', section: 'postgres', table: 'programs', detail: 'classed SERVER-FIRST MIRROR but no local entry mirrors it' },
    ])
  })
})

describe('extractors', () => {
  it('reads pgTable names and each table\'s own tombstone column', () => {
    const schema = [
      "export const a = pgTable('a', {\n  id: uuid('id'),\n  deletedAt: timestamp('deleted_at'),\n})",
      "export const b = pgTable('b', {\n  userId: uuid('user_id'),\n})",
    ].join('\n')
    const t = L.extractPgTables(schema)
    expect([...t.keys()]).toEqual(['a', 'b'])
    expect(t.get('a')).toEqual({ tombstone: true, userId: false })
    expect(t.get('b')).toEqual({ tombstone: false, userId: true })
  })

  it('treats the x_new → x rebuild as one table and ignores CREATE TABLE in prose', () => {
    const src = [
      '// Idempotent CREATE TABLE IF NOT EXISTS statements safe to re-run any time.',
      '`CREATE TABLE IF NOT EXISTS supplement_logs (\n  id TEXT\n)`',
      '`CREATE TABLE IF NOT EXISTS supplement_logs_new (\n  id TEXT\n)`',
      '`DROP TABLE supplement_logs`',
      '`ALTER TABLE supplement_logs_new RENAME TO supplement_logs`',
    ].join('\n')
    expect(L.extractLocalTables(src)).toEqual(['supplement_logs'])
  })

  it('replays .sql migrations in filename order: a dropped table is gone, a commented one never existed', () => {
    const files = [
      { name: '202601010000_drop.sql', text: 'DROP TABLE IF EXISTS cardio_sessions;' },
      { name: '001_initial.sql', text: '-- All CREATE TABLE statements use IF NOT EXISTS.\nCREATE TABLE cardio_sessions (id int);\nCREATE TABLE users (id uuid);\nCREATE TABLE IF NOT EXISTS rate_limits (key text);' },
    ]
    const pg = new Map([['users', { tombstone: false, userId: false }]])
    expect(L.extractMigrationOnlyTables(files, pg, ['CREATE TABLE IF NOT EXISTS schema_migrations (filename text)'])).toEqual(['rate_limits', 'schema_migrations'])
  })

  it('finds native tables and the file each comes from', () => {
    const n = L.extractNativeTables([{ name: 'OuraRawDb.kt', text: 'db.execSQL("CREATE TABLE IF NOT EXISTS sync_state (k TEXT)")' }])
    expect([...n.entries()]).toEqual([['sync_state', 'OuraRawDb.kt']])
  })

  it('reads export and account-deletion status from their records', () => {
    const map = "export const EXPORTED: R = {\n  food_logs: { kind: 'user_id' },\n}\nexport const EXCLUDED: R = {\n  rate_limits: { category: 'ops', reason: 'x' },\n}\n"
    const exp = L.exportStatus(map)
    expect([exp('food_logs'), exp('rate_limits'), exp('new_table')]).toEqual(['exported', 'excluded (ops)', 'unclassified'])
    const del = L.deletionStatus("export const OUTSIDE_THE_CASCADE: R = {\n  ai_call_log: { disposition: 'anonymised', how: 'x' },\n}\n")
    expect([del('ai_call_log'), del('food_logs')]).toEqual(['anonymised', 'cascade'])
  })
})
