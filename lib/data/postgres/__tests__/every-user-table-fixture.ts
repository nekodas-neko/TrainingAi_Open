// #2120 — one row in EVERY table a user's data can live in, derived from the live schema rather than
// listed by hand. A hand-written fixture for account deletion would cover the tables its author
// thought of, and the deletion bug this exists for (exercise_library_created_by_fkey) sat in a table
// nobody thought of. Here the table set comes from the foreign keys: everything a `users` delete
// reaches by CASCADE, plus everything whose FK to users is SET NULL.
//
// Every FK column is filled, nullable ones included, and filled with THIS user's own parent row — so
// the cross-links a cascade can trip on (an exercise log naming the user's own progression style, a
// schedule day naming the user's own program session) are all present at once.
import type { Pool } from 'pg'

type Rule = 'a' | 'r' | 'c' | 'n' | 'd'
export interface Fk { table: string; column: string; parent: string; parentColumn: string; rule: Rule; deferrable: boolean }
interface Column { name: string; udt: string; notNull: boolean; hasDefault: boolean }
export interface SchemaGraph {
  tables: string[]
  fks: Fk[]
  pk: Map<string, string[]>
  columns: Map<string, Column[]>
  /** column → the first value its `= ANY (ARRAY[...])` CHECK allows. */
  enumValue: Map<string, string>
}
export type Row = Record<string, unknown>

export async function readSchemaGraph(pool: Pool): Promise<SchemaGraph> {
  const { rows: tables } = await pool.query<{ relname: string }>(
    `SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1`)
  const { rows: fks } = await pool.query<Fk>(`
    SELECT cl.relname AS table, a.attname AS column, pc.relname AS parent, pa.attname AS "parentColumn",
           con.confdeltype::text AS rule, con.condeferrable AS deferrable
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_class pc ON pc.oid = con.confrelid
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND cl.relnamespace = 'public'::regnamespace`)
  const { rows: pks } = await pool.query<{ table: string; cols: string[] }>(`
    SELECT cl.relname AS table, array_agg(a.attname::text ORDER BY k.ord) AS cols
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
    WHERE con.contype = 'p' AND cl.relnamespace = 'public'::regnamespace
    GROUP BY cl.relname`)
  const { rows: cols } = await pool.query<{ table: string; name: string; udt: string; notNull: boolean; hasDefault: boolean }>(`
    SELECT cl.relname AS table, a.attname AS name, t.typname AS udt, a.attnotnull AS "notNull",
           (a.atthasdef OR a.attidentity <> '' OR a.attgenerated <> '') AS "hasDefault"
    FROM pg_attribute a
    JOIN pg_class cl ON cl.oid = a.attrelid
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE cl.relnamespace = 'public'::regnamespace AND cl.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attgenerated = ''
    ORDER BY cl.relname, a.attnum`)
  const { rows: checks } = await pool.query<{ table: string; def: string }>(`
    SELECT conrelid::regclass::text AS table, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace`)

  const columns = new Map<string, Column[]>()
  for (const c of cols) {
    if (!columns.has(c.table)) columns.set(c.table, [])
    columns.get(c.table)!.push(c)
  }
  const enumValue = new Map<string, string>()
  for (const { table, def } of checks) {
    // `(col = ANY (ARRAY['x'::text, 'y'::text]))` — the only CHECK shape that rejects a generic value.
    const m = def.match(/^CHECK \(\((\w+) = ANY \(ARRAY\['([^']*)'/)
    if (m) enumValue.set(`${table}.${m[1]}`, m[2])
  }
  return {
    tables: tables.map(t => t.relname),
    fks,
    pk: new Map(pks.map(p => [p.table, p.cols])),
    columns,
    enumValue,
  }
}

/** Every table a `DELETE FROM users` reaches through ON DELETE CASCADE, transitively. */
export function cascadeClosure(g: SchemaGraph): Set<string> {
  const reached = new Set<string>(['users'])
  for (let grew = true; grew;) {
    grew = false
    for (const fk of g.fks) {
      if (fk.rule === 'c' && reached.has(fk.parent) && !reached.has(fk.table)) {
        reached.add(fk.table)
        grew = true
      }
    }
  }
  reached.delete('users')
  return reached
}

/** Tables whose FK to users is SET NULL: the rows outlive the user, unlinked. */
export function setNullToUsers(g: SchemaGraph): Set<string> {
  return new Set(g.fks.filter(f => f.parent === 'users' && f.rule === 'n').map(f => f.table))
}

let seq = 0
const unique = (tag: string) => `${tag}-${process.pid}-${++seq}-${Math.random().toString(36).slice(2, 8)}`

function genericValue(table: string, col: Column, g: SchemaGraph, at?: Date): unknown {
  const e = g.enumValue.get(`${table}.${col.name}`)
  if (e !== undefined) return e
  switch (col.udt) {
    case 'uuid': return crypto.randomUUID()
    case 'text': case 'varchar': case 'bpchar':
      // Several date-keyed tables store the date as text, and some indexes cast it.
      return /date|_on$/.test(col.name) ? '2026-09-15' : unique(`${table}.${col.name}`)
    case 'int2': case 'int4': case 'int8': case 'float4': case 'float8': case 'numeric': return 1
    case 'bool': return false
    case 'date': return '2026-09-15'
    case 'timestamptz': case 'timestamp': return at ?? new Date()
    case 'time': case 'timetz': return '08:00'
    case 'interval': return '1 minute'
    case 'jsonb': case 'json': return '{}'
    case 'bytea': return Buffer.from([0])
    default:
      if (col.udt.startsWith('_')) return []
      throw new Error(`every-user-table fixture: no generic value for ${table}.${col.name} (${col.udt})`)
  }
}

async function insertRow(pool: Pool, table: string, values: Row): Promise<Row> {
  const names = Object.keys(values)
  const sql = names.length
    ? `INSERT INTO public."${table}" (${names.map(n => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`
    : `INSERT INTO public."${table}" DEFAULT VALUES RETURNING *`
  try {
    const { rows: [row] } = await pool.query(sql, names.map(n => values[n]))
    return row
  } catch (err) {
    throw new Error(`every-user-table fixture: insert into ${table} failed — ${(err as Error).message}`)
  }
}

/** A row in a table the fixture does not own (a catalogue), created only when none exists yet. */
async function catalogueRow(pool: Pool, g: SchemaGraph, table: string, created: Row[]): Promise<Row> {
  const { rows: [existing] } = await pool.query(`SELECT * FROM public."${table}" LIMIT 1`)
  if (existing) return existing
  const values: Row = {}
  for (const col of g.columns.get(table) ?? []) {
    if (col.notNull && !col.hasDefault) values[col.name] = genericValue(table, col, g)
  }
  const row = await insertRow(pool, table, values)
  created.push({ __table: table, ...pick(row, g.pk.get(table)!) })
  return row
}

const pick = (row: Row, cols: string[]) => Object.fromEntries(cols.map(c => [c, row[c]]))

export interface SeededUser {
  userId: string
  /** The inserted row per table. */
  rows: Map<string, Row>
  /** Catalogue rows the fixture had to create; the caller removes them. */
  createdCatalogue: Row[]
}

export async function seedEveryUserTable(
  pool: Pool,
  g: SchemaGraph,
  userId: string,
  opts: {
    /** Soft-delete every row that has a `deleted_at` column. */
    softDelete?: boolean
    /** Point FK columns at THIS row of a parent table instead of the user's own one. */
    parentOverride?: Record<string, Row>
    /** Column values for one table, where a generic value breaks a multi-column CHECK. */
    overrides?: Record<string, Row>
    /** The instant every generated timestamp takes, instead of "now" — lets a caller line the
     *  timestamps up with the fixture's fixed date so one query window sees both. */
    at?: Date
  } = {},
): Promise<SeededUser> {
  const owned = new Set([...cascadeClosure(g), ...setNullToUsers(g)])
  const rows = new Map<string, Row>()
  const createdCatalogue: Row[] = []
  const notNull = (t: string, c: string) => g.columns.get(t)?.find(x => x.name === c)?.notNull ?? false

  // Topological on the NOT NULL foreign keys between owned tables; nullable ones are filled
  // afterwards, which is how the programs ↔ phase_sets cycle gets both of its links.
  const order: string[] = []
  const pending = new Set(owned)
  while (pending.size) {
    const ready = [...pending].filter(t => g.fks.every(fk =>
      fk.table !== t || !owned.has(fk.parent) || fk.parent === t || !notNull(t, fk.column) || !pending.has(fk.parent)))
    if (!ready.length) throw new Error(`every-user-table fixture: NOT NULL FK cycle among ${[...pending].join(', ')}`)
    for (const t of ready.sort()) { order.push(t); pending.delete(t) }
  }

  const later: { table: string; column: string; parent: string; parentColumn: string }[] = []
  for (const table of order) {
    const values: Row = { ...(opts.overrides?.[table] ?? {}) }
    for (const fk of g.fks.filter(f => f.table === table && !(f.column in values))) {
      if (fk.parent === 'users') { values[fk.column] = userId; continue }
      if (fk.parent === table) continue
      const parentRow = opts.parentOverride?.[fk.parent]
        ?? rows.get(fk.parent)
        ?? (owned.has(fk.parent) ? undefined : await catalogueRow(pool, g, fk.parent, createdCatalogue))
      if (parentRow) values[fk.column] = parentRow[fk.parentColumn]
      else later.push({ table, column: fk.column, parent: fk.parent, parentColumn: fk.parentColumn })
    }
    for (const col of g.columns.get(table) ?? []) {
      if (col.name in values) continue
      if (col.name === 'deleted_at' && opts.softDelete) values[col.name] = new Date()
      else if (col.notNull && !col.hasDefault) values[col.name] = genericValue(table, col, g, opts.at)
    }
    rows.set(table, await insertRow(pool, table, values))
  }

  for (const l of later) {
    const parentRow = opts.parentOverride?.[l.parent] ?? rows.get(l.parent)
    if (!parentRow) continue
    const row = rows.get(l.table)!
    const key = g.pk.get(l.table)!
    const { rows: [updated] } = await pool.query(
      `UPDATE public."${l.table}" SET "${l.column}" = $1 WHERE ${key.map((k, i) => `"${k}" = $${i + 2}`).join(' AND ')} RETURNING *`,
      [parentRow[l.parentColumn], ...key.map(k => row[k])])
    rows.set(l.table, updated)
  }

  return { userId, rows, createdCatalogue }
}

/** Whether the row a seed inserted is still there, found by its primary key. */
export async function rowExists(pool: Pool, g: SchemaGraph, table: string, row: Row): Promise<Row | null> {
  const key = g.pk.get(table)!
  const { rows: [found] } = await pool.query(
    `SELECT * FROM public."${table}" WHERE ${key.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ')}`,
    key.map(k => row[k]))
  return found ?? null
}
