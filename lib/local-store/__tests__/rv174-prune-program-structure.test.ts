// RV-174 — a deleted program or progression style never left the device's mirror. Both are hard
// deletes with no tombstone, and the delta carries only what CHANGED, so nothing ever said a row was
// gone. `assembleLocalActiveProgram` takes `find(isActive) ?? programs[0]`, so after deleting active
// program A and activating B the mirror could hold two active programs.
//
// Runs the real SQL against an in-memory SQLite: a prune is exactly where "the statement was issued"
// and "the right rows survived" come apart.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

const db = { current: null as DatabaseSync | null }
vi.mock('@/lib/sqlite/sqlite-service', () => ({
  runSQL: vi.fn(async (sql: string, params: unknown[] = []) => { db.current!.prepare(sql).run(...(params as never[])) }),
  querySQL: vi.fn(async (sql: string, params: unknown[] = []) => db.current!.prepare(sql).all(...(params as never[]))),
  beginTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(),
}))

import { SQLiteLocalStore } from '../sqlite-backend'

const rows = (sql: string) => db.current!.prepare(sql).all() as Record<string, unknown>[]
const ids = (table: string) => rows(`SELECT id FROM ${table} ORDER BY id`).map(r => r.id)

beforeEach(() => {
  db.current = new DatabaseSync(':memory:')
  db.current.exec(`
    CREATE TABLE local_programs (id TEXT PRIMARY KEY, is_active INTEGER);
    CREATE TABLE program_sessions (id TEXT PRIMARY KEY, program_id TEXT);
    CREATE TABLE session_exercises (id TEXT PRIMARY KEY, session_id TEXT, style_id TEXT);
    CREATE TABLE schedules (id TEXT PRIMARY KEY, program_id TEXT);
    CREATE TABLE schedule_days (schedule_id TEXT, day_of_week INTEGER, session_id TEXT);
    CREATE TABLE local_progression_styles (id TEXT PRIMARY KEY);
    CREATE TABLE style_sets (id TEXT PRIMARY KEY, style_id TEXT);

    INSERT INTO local_programs VALUES ('prog-A', 1), ('prog-B', 1);
    INSERT INTO program_sessions VALUES ('sess-A', 'prog-A'), ('sess-B', 'prog-B');
    INSERT INTO session_exercises VALUES ('ex-A', 'sess-A', 'style-1'), ('ex-B', 'sess-B', 'style-2');
    INSERT INTO schedules VALUES ('sch-A', 'prog-A'), ('sch-B', 'prog-B');
    INSERT INTO schedule_days VALUES ('sch-A', 1, 'sess-A'), ('sch-B', 1, 'sess-B');
    INSERT INTO local_progression_styles VALUES ('style-1'), ('style-2');
    INSERT INTO style_sets VALUES ('set-1', 'style-1'), ('set-2', 'style-2');
  `)
})

const store = () => new SQLiteLocalStore()

describe('pruneProgramStructure (RV-174)', () => {
  it('removes a deleted program and every child, leaving one active program', async () => {
    const removed = await store().pruneProgramStructure(['prog-B'], undefined)
    expect(removed).toBe(1)
    expect(ids('local_programs')).toEqual(['prog-B'])
    expect(ids('program_sessions')).toEqual(['sess-B'])
    expect(ids('session_exercises')).toEqual(['ex-B'])
    expect(ids('schedules')).toEqual(['sch-B'])
    expect(rows('SELECT schedule_id FROM schedule_days').map(r => r.schedule_id)).toEqual(['sch-B'])
    expect(rows('SELECT id FROM local_programs WHERE is_active = 1')).toHaveLength(1)
  })

  it('removes a deleted style and its sets, and clears it from the exercise that used it', async () => {
    const removed = await store().pruneProgramStructure(undefined, ['style-2'])
    expect(removed).toBe(1)
    expect(ids('local_progression_styles')).toEqual(['style-2'])
    expect(ids('style_sets')).toEqual(['set-2'])
    // The server's FK is ON DELETE SET NULL and does not touch the program, so no delta says this.
    const ex = rows(`SELECT id, style_id FROM session_exercises ORDER BY id`)
    expect(ex).toEqual([{ id: 'ex-A', style_id: null }, { id: 'ex-B', style_id: 'style-2' }])
  })

  it('treats an ABSENT roster as "no information" and prunes nothing', async () => {
    expect(await store().pruneProgramStructure(undefined, undefined)).toBe(0)
    expect(ids('local_programs')).toEqual(['prog-A', 'prog-B'])
    expect(ids('local_progression_styles')).toEqual(['style-1', 'style-2'])
  })

  it('treats an EMPTY roster as "the user has none left"', async () => {
    expect(await store().pruneProgramStructure([], [])).toBe(4)
    expect(ids('local_programs')).toEqual([])
    expect(ids('session_exercises')).toEqual([])
    expect(ids('local_progression_styles')).toEqual([])
  })

  it('removes nothing when the mirror already matches', async () => {
    expect(await store().pruneProgramStructure(['prog-A', 'prog-B'], ['style-1', 'style-2'])).toBe(0)
    expect(ids('session_exercises')).toEqual(['ex-A', 'ex-B'])
  })
})
