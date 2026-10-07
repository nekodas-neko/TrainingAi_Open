// The `@/lib/sqlite/sqlite-service` surface, backed by `node:sqlite`, for the parity runner (#2490).
//
// The store and the engine reach SQLite only through this module, so replacing it is the whole of
// what it takes to run the shipped `SQLiteLocalStore` and `sync-engine` under node. Transactions are
// real (`BEGIN` / `COMMIT` / `ROLLBACK` on the same connection), because a rollback that silently
// keeps half a pull is exactly the kind of behaviour a vector must be able to see.
//
// Loaded by `vi.mock('@/lib/sqlite/sqlite-service', () => import('./parity/node-sqlite-service'))`.
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, RECONCILE_COLUMNS, RECONCILE_TABLES } from '@/lib/sqlite/migrations'

const state = { db: null as DatabaseSync | null }

/** A fresh device database at the current schema: every migration in order, then reconcile. */
export function openVectorDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  // Tolerated per statement, as the device does: a later version re-adding a column a reconcile
  // already added is the normal case, not a fault.
  for (const m of MIGRATIONS) for (const s of m.statements) { try { db.exec(s) } catch { /* tolerated */ } }
  for (const s of RECONCILE_TABLES) { try { db.exec(s) } catch { /* tolerated */ } }
  for (const c of RECONCILE_COLUMNS) { try { db.exec(c.ddl) } catch { /* already present */ } }
  state.db?.close()
  state.db = db
  inTransaction = false
  return db
}

export function vectorDb(): DatabaseSync {
  if (!state.db) throw new Error('parity runner: no vector database is open')
  return state.db
}

/** What the Capacitor plugin binds: `undefined` as NULL, booleans as 0/1. */
const bindable = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)

export const isSQLiteAvailable = () => true
export const isLocalStoreDead = () => false
export async function initSQLite(): Promise<void> { /* opened by openVectorDb */ }

export async function runSQL(sql: string, values: unknown[] = []): Promise<void> {
  vectorDb().prepare(sql).run(...(values.map(bindable) as never[]))
}

export async function querySQL<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
  return vectorDb().prepare(sql).all(...(values.map(bindable) as never[])) as T[]
}

let inTransaction = false
export async function beginTransaction(): Promise<void> { vectorDb().exec('BEGIN'); inTransaction = true }
export async function commitTransaction(): Promise<void> { inTransaction = false; vectorDb().exec('COMMIT') }
export async function rollbackTransaction(): Promise<void> {
  if (inTransaction) { inTransaction = false; vectorDb().exec('ROLLBACK') }
}
