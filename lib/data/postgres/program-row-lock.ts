import { sql } from 'drizzle-orm'

type SqlTx = { execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[]; rowCount?: number | null }> }

/**
 * #4096: the program row is locked FIRST by every writer that changes a program's exercise rows and then
 * moves the program's `updated_at`.
 *
 * The program editor's save (`saveProgram`) updates its `programs` row, then deletes and re-inserts that
 * program's sessions and exercises. The exercise rename and the Coach's session-exercise removal and undo
 * updated an exercise row first and the program's `updated_at` second: one held the exercise and wanted the
 * program, the other the reverse, and Postgres ended the pair with `40P01` (reproduced, gated, in
 * `rename-program-lock-order-4096.test.ts`: ~1.1 s, the editor's save answers "busy").
 *
 * `FOR NO KEY UPDATE`, the lock the editor's UPDATE of the same row takes, so it conflicts with exactly the
 * writers the order is about and not with an insert that only references the program (`KEY SHARE`).
 * Transaction-scoped: released at commit or rollback. The table of writers is in
 * `docs/lift-write-lock-order.md`.
 */

/** One program, by id. Nothing is locked (and nothing waits) if there is no such row. */
export async function lockProgramRow(tx: SqlTx, programId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM programs WHERE id = ${programId} FOR NO KEY UPDATE`)
}

/** The program a session belongs to. */
export async function lockProgramOfSession(tx: SqlTx, sessionId: string): Promise<void> {
  await tx.execute(sql`
    SELECT p.id FROM programs p
    WHERE p.id = (SELECT program_id FROM program_sessions WHERE id = ${sessionId})
    FOR NO KEY UPDATE OF p
  `)
}

/**
 * Every program, whoever owns it, that holds an exercise row named `name` (a tombstoned row too: the rename
 * rewrites those and moves the program), in id order, so two renames over programs they share lock them in
 * the same order and cannot meet crosswise. Locked before the first exercise row is changed.
 *
 * A program that gains the name after this read (a save adding the old name in the same instant) is not
 * covered: the rename then reaches it as before, with the inversion against that one save only.
 */
export async function lockProgramsUsingExerciseName(tx: SqlTx, name: string): Promise<void> {
  await tx.execute(sql`
    SELECT p.id FROM programs p
    WHERE p.id IN (
      SELECT ps.program_id FROM program_sessions ps
        JOIN session_exercises se ON se.session_id = ps.id
       WHERE se.exercise_name = ${name})
    ORDER BY p.id
    FOR NO KEY UPDATE OF p
  `)
}
