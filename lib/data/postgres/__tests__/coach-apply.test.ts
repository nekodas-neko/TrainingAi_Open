// AI Coach's write path. Every refusal here is one the design depends on:
//
//  - ownership by join, because `session_exercises` has no `user_id` and a client supplies the id
//  - staleness, because a proposal can sit in the thread across a program edit
//  - library validation, because a swap names an exercise as free text
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { CoachPatch } from '@/lib/coach/patch'

const canRun = !!process.env.DATABASE_URL

const OWNER = '00000000-0000-4000-8000-00000000cc01'
const STRANGER = '00000000-0000-4000-8000-00000000cc02'
const PROGRAM = '00000000-0000-4000-8000-00000000cc10'
const SESSION = '00000000-0000-4000-8000-00000000cc11'
const EXERCISE_ROW = '00000000-0000-4000-8000-00000000cc12'
const STRANGER_PROGRAM = '00000000-0000-4000-8000-00000000cc20'
const STRANGER_SESSION = '00000000-0000-4000-8000-00000000cc21'
const STRANGER_EXERCISE_ROW = '00000000-0000-4000-8000-00000000cc22'

const HINGE = 'Coach Test Deadlift'
const HAMSTRING = 'Coach Test RDL'
const MERGED = 'Coach Test Merged Lift'
// A third live catalogue entry, so a change can be stacked ON a change (Q-468). MERGED cannot
// play that part — apply refuses a merged-away entry, which is its own test above.
const THIRD = 'Coach Test Good Morning'

const patchFor = (targetId: string, from = HINGE, to = HAMSTRING): CoachPatch => ({
  domain: 'session_exercise',
  targetId,
  changes: [{ id: 'c1', field: 'exerciseName', from, to }],
})

describe.skipIf(!canRun)('AI Coach — apply path', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let applyCoachPatch: typeof import('@/lib/coach/apply').applyCoachPatch
  let undoCoachChange: typeof import('@/lib/coach/apply').undoCoachChange
  let previewPatch: typeof import('@/lib/coach/consequences').previewPatch

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    db = client.getDb()
    ;({ applyCoachPatch, undoCoachChange } = await import('@/lib/coach/apply'))
    ;({ previewPatch } = await import('@/lib/coach/consequences'))

    for (const [id, tag] of [[OWNER, 'owner'], [STRANGER, 'stranger']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `coach-${tag}@example.com`])
    }

    // A hinge that trains lower back + hamstrings, and a replacement that drops the lower back.
    // The coverage delta is the consequence this phase can measure exactly.
    await pool.query(
      `INSERT INTO exercise_library (name, muscles) VALUES
         ($1, '[{"muscle":"lower back","role":"main"},{"muscle":"hamstrings","role":"main"}]'::jsonb),
         ($2, '[{"muscle":"hamstrings","role":"main"},{"muscle":"glutes","role":"secondary"}]'::jsonb),
         ($3, '[{"muscle":"hamstrings","role":"main"}]'::jsonb),
         ($4, '[{"muscle":"hamstrings","role":"main"},{"muscle":"lower back","role":"secondary"}]'::jsonb)
       ON CONFLICT (name) DO NOTHING`, [HINGE, HAMSTRING, MERGED, THIRD])
    // MERGED is a catalogue row kept only for FK validity — a picker must never offer it.
    await pool.query(
      `UPDATE exercise_library SET merged_into = (SELECT id FROM exercise_library WHERE name = $1)
       WHERE name = $2`, [HAMSTRING, MERGED])

    for (const [userId, progId, sessId, exId] of [
      [OWNER, PROGRAM, SESSION, EXERCISE_ROW],
      [STRANGER, STRANGER_PROGRAM, STRANGER_SESSION, STRANGER_EXERCISE_ROW],
    ] as const) {
      await pool.query(
        `INSERT INTO programs (id, user_id, name, is_active) VALUES ($1, $2, 'Coach Test', true)
         ON CONFLICT (id) DO NOTHING`, [progId, userId])
      await pool.query(
        `INSERT INTO program_sessions (id, program_id, name, position) VALUES ($1, $2, 'Lower', 0)
         ON CONFLICT (id) DO NOTHING`, [sessId, progId])
    }
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM coach_changes WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
    await pool.query(`DELETE FROM programs WHERE id = ANY($1)`, [[PROGRAM, STRANGER_PROGRAM]])
    await pool.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [[HINGE, HAMSTRING, MERGED, THIRD]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, STRANGER]])
  })

  // The fixture is built ONCE and reset by primary key, rather than dropped and recreated per test.
  //
  // The first version did `DELETE FROM programs` in beforeEach, which cascades to program_sessions
  // and session_exercises. Migration 164 (replayed by cable-exercise-merge-migration.test.ts) also
  // writes session_exercises, and under the full parallel suite the two collided: that test failed
  // on a *different* assertion each run, and passed as soon as this file was removed. Measured, not
  // guessed — the suite was run with this file present, absent, and alone.
  //
  // Nothing in migration 164 can see this test's data (it is name-scoped to cable exercises), so
  // the interference was lock/visibility contention rather than corruption. Resetting a known row
  // by id keeps the lock footprint to that row.
  beforeEach(async () => {
    await pool.query(`DELETE FROM coach_changes WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
    for (const [sessId, exId] of [[SESSION, EXERCISE_ROW], [STRANGER_SESSION, STRANGER_EXERCISE_ROW]] as const) {
      // Clear strays FIRST. The removal test's undo re-inserts a fresh row rather than restoring
      // the original id, and `session_exercises` is UNIQUE on (session_id, position) — so an
      // upsert-then-clean order collides with the leftover row still holding position 0.
      await pool.query(`DELETE FROM session_exercises WHERE session_id = $1 AND id <> $2`, [sessId, exId])
      // The removal test deletes its row, so re-create it if it is gone; otherwise just reset it.
      await pool.query(
        `INSERT INTO session_exercises (id, session_id, exercise_name, muscle_groups, position)
         VALUES ($1, $2, $3, ARRAY['lower back','hamstrings'], 0)
         ON CONFLICT (id) DO UPDATE SET
           exercise_name = EXCLUDED.exercise_name,
           muscle_groups = EXCLUDED.muscle_groups,
           position      = EXCLUDED.position,
           exercise_id   = NULL,
           style_id      = NULL`,
        [exId, sessId, HINGE])
    }
  })

  const nameOf = async (id: string) => {
    const { rows } = await pool.query(`SELECT exercise_name, muscle_groups FROM session_exercises WHERE id = $1`, [id])
    return rows[0] as { exercise_name: string; muscle_groups: string[] } | undefined
  }

  it('applies a swap and records the change', async () => {
    const result = await applyCoachPatch(db, OWNER, patchFor(EXERCISE_ROW), ['c1'])
    expect(result.ok).toBe(true)

    const row = await nameOf(EXERCISE_ROW)
    expect(row?.exercise_name).toBe(HAMSTRING)
    // muscle_groups is re-derived from the library, not carried over from the old exercise —
    // otherwise the swapped row would keep claiming it trains the lower back.
    expect(row?.muscle_groups).toEqual(expect.arrayContaining(['hamstrings', 'glutes']))
    expect(row?.muscle_groups).not.toContain('lower back')

    const { rows } = await pool.query(`SELECT * FROM coach_changes WHERE user_id = $1`, [OWNER])
    expect(rows).toHaveLength(1)
    expect(rows[0].before_state.exerciseName).toBe(HINGE)
  })

  it('writes only the accepted subset', async () => {
    const patch: CoachPatch = {
      domain: 'session_exercise',
      targetId: EXERCISE_ROW,
      changes: [
        { id: 'c1', field: 'exerciseName', from: HINGE, to: HAMSTRING },
        { id: 'c2', field: 'position', from: 0, to: 3 },
      ],
    }
    const result = await applyCoachPatch(db, OWNER, patch, ['c1'])
    expect(result.ok).toBe(true)

    const { rows } = await pool.query(`SELECT exercise_name, position FROM session_exercises WHERE id = $1`, [EXERCISE_ROW])
    expect(rows[0].exercise_name).toBe(HAMSTRING)
    expect(rows[0].position).toBe(0)  // declined row untouched

    const { rows: recorded } = await pool.query(`SELECT accepted_ids, patch FROM coach_changes WHERE user_id = $1`, [OWNER])
    expect(recorded[0].accepted_ids).toEqual(['c1'])
    // The declined change is still in the record: what was suggested is part of the history.
    expect(recorded[0].patch.changes).toHaveLength(2)
  })

  it('refuses a patch whose base has moved, and writes nothing', async () => {
    await pool.query(`UPDATE session_exercises SET exercise_name = $1 WHERE id = $2`, ['Something Else', EXERCISE_ROW])

    const result = await applyCoachPatch(db, OWNER, patchFor(EXERCISE_ROW), ['c1'])
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('stale')
    expect((await nameOf(EXERCISE_ROW))?.exercise_name).toBe('Something Else')
    const { rows } = await pool.query(`SELECT 1 FROM coach_changes WHERE user_id = $1`, [OWNER])
    expect(rows).toHaveLength(0)
  })

  it("refuses another user's row even though the id is valid", async () => {
    const result = await applyCoachPatch(db, OWNER, patchFor(STRANGER_EXERCISE_ROW), ['c1'])
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('not_found')
    expect((await nameOf(STRANGER_EXERCISE_ROW))?.exercise_name).toBe(HINGE)
  })

  it('refuses an exercise that is not in the library', async () => {
    const result = await applyCoachPatch(db, OWNER, patchFor(EXERCISE_ROW, HINGE, 'Invented Lift'), ['c1'])
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('invalid')
    expect((await nameOf(EXERCISE_ROW))?.exercise_name).toBe(HINGE)
  })

  it('refuses a merged-away catalogue entry', async () => {
    const result = await applyCoachPatch(db, OWNER, patchFor(EXERCISE_ROW, HINGE, MERGED), ['c1'])
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('invalid')
  })

  it('undo restores the previous exercise', async () => {
    const applied = await applyCoachPatch(db, OWNER, patchFor(EXERCISE_ROW), ['c1'])
    expect(applied.ok).toBe(true)
    if (!applied.ok) return

    const undone = await undoCoachChange(db, OWNER, applied.changeId)
    expect(undone.ok).toBe(true)

    const row = await nameOf(EXERCISE_ROW)
    expect(row?.exercise_name).toBe(HINGE)
    expect(row?.muscle_groups).toContain('lower back')

    const { rows } = await pool.query(`SELECT undone_at FROM coach_changes WHERE id = $1`, [applied.changeId])
    expect(rows[0].undone_at).not.toBeNull()
  })

  // Q-468, measured entirely inside the Coach's own flow — no external edit needed. Two stacked
  // changes on one exercise: undoing the FIRST used to return 200 and set the row back to its
  // original value, while `coach_changes` still showed the second as in effect. Undoing both then
  // left the row on the middle value, which the user never chose.
  describe('stacked changes on one target', () => {
    const swap = (id: string, from: string, to: string): CoachPatch => ({
      domain: 'session_exercise',
      targetId: EXERCISE_ROW,
      changes: [{ id, field: 'exerciseName', from, to }],
    })

    it('refuses to undo a change a later one has written over', async () => {
      const a = await applyCoachPatch(db, OWNER, swap('c1', HINGE, HAMSTRING), ['c1'])
      const b = await applyCoachPatch(db, OWNER, swap('c2', HAMSTRING, THIRD), ['c2'])
      if (!a.ok || !b.ok) throw new Error('setup failed')

      const undoA = await undoCoachChange(db, OWNER, a.changeId)

      expect(undoA.ok).toBe(false)
      if (undoA.ok) return
      expect(undoA.reason).toBe('stale')
      if (undoA.reason !== 'stale') return
      expect(undoA.drift[0]).toMatchObject({ field: 'exerciseName', expected: HAMSTRING, actual: THIRD })
      // Refused means nothing moved, and the history still agrees with the row.
      expect((await nameOf(EXERCISE_ROW))?.exercise_name).toBe(THIRD)
      const { rows } = await pool.query(`SELECT undone_at FROM coach_changes WHERE id = $1`, [a.changeId])
      expect(rows[0].undone_at).toBeNull()
    })

    it('undoing both in reverse returns the target to where it started', async () => {
      const a = await applyCoachPatch(db, OWNER, swap('c1', HINGE, HAMSTRING), ['c1'])
      const b = await applyCoachPatch(db, OWNER, swap('c2', HAMSTRING, THIRD), ['c2'])
      if (!a.ok || !b.ok) throw new Error('setup failed')

      expect((await undoCoachChange(db, OWNER, b.changeId)).ok).toBe(true)
      expect((await nameOf(EXERCISE_ROW))?.exercise_name).toBe(HAMSTRING)

      expect((await undoCoachChange(db, OWNER, a.changeId)).ok).toBe(true)
      expect((await nameOf(EXERCISE_ROW))?.exercise_name).toBe(HINGE)
    })

    // The check is against the target, not against the change's position in a list: a single
    // change still undoes even though it is the oldest, because nothing has written over it.
    it('still undoes a change nothing has written over', async () => {
      const a = await applyCoachPatch(db, OWNER, swap('c1', HINGE, HAMSTRING), ['c1'])
      if (!a.ok) throw new Error('setup failed')
      expect((await undoCoachChange(db, OWNER, a.changeId)).ok).toBe(true)
      expect((await nameOf(EXERCISE_ROW))?.exercise_name).toBe(HINGE)
    })

    // Drift from outside the Coach is the same refusal — this is what the check buys beyond
    // ordering, and what a wired undo button (Q-467) would otherwise expose.
    it('refuses when the target moved outside the Coach entirely', async () => {
      const a = await applyCoachPatch(db, OWNER, swap('c1', HINGE, HAMSTRING), ['c1'])
      if (!a.ok) throw new Error('setup failed')
      await pool.query(`UPDATE session_exercises SET exercise_name = $1 WHERE id = $2`, [THIRD, EXERCISE_ROW])

      const undone = await undoCoachChange(db, OWNER, a.changeId)

      expect(undone.ok).toBe(false)
      expect((await nameOf(EXERCISE_ROW))?.exercise_name).toBe(THIRD)
    })
  })

  it('refuses a second undo rather than re-applying the before-state', async () => {
    const applied = await applyCoachPatch(db, OWNER, patchFor(EXERCISE_ROW), ['c1'])
    if (!applied.ok) throw new Error('setup failed')
    await undoCoachChange(db, OWNER, applied.changeId)
    const second = await undoCoachChange(db, OWNER, applied.changeId)
    expect(second.ok).toBe(false)
  })

  it("refuses to undo another user's change", async () => {
    const applied = await applyCoachPatch(db, OWNER, patchFor(EXERCISE_ROW), ['c1'])
    if (!applied.ok) throw new Error('setup failed')
    const result = await undoCoachChange(db, STRANGER, applied.changeId)
    expect(result.ok).toBe(false)
    expect((await nameOf(EXERCISE_ROW))?.exercise_name).toBe(HAMSTRING)
  })

  it('restores a removed exercise on undo', async () => {
    const patch: CoachPatch = {
      domain: 'session_exercise',
      targetId: EXERCISE_ROW,
      changes: [{ id: 'c1', field: 'removed', from: false, to: true }],
    }
    const applied = await applyCoachPatch(db, OWNER, patch, ['c1'])
    expect(applied.ok).toBe(true)
    expect(await nameOf(EXERCISE_ROW)).toBeUndefined()

    if (!applied.ok) return
    await undoCoachChange(db, OWNER, applied.changeId)

    const { rows } = await pool.query(
      `SELECT exercise_name FROM session_exercises WHERE session_id = $1`, [SESSION])
    expect(rows.map(r => r.exercise_name)).toContain(HINGE)
  })

  describe('preview', () => {
    it('measures the muscle coverage the swap drops and adds', async () => {
      const result = await previewPatch(db, OWNER, patchFor(EXERCISE_ROW))
      const texts = result.consequences.map(c => c.text).join(' | ')
      expect(texts).toContain('lower back')
      expect(texts).toContain('glutes')
      expect(result.drift).toHaveLength(0)
    })

    it('reports drift without applying anything', async () => {
      await pool.query(`UPDATE session_exercises SET exercise_name = $1 WHERE id = $2`, ['Moved On', EXERCISE_ROW])
      const result = await previewPatch(db, OWNER, patchFor(EXERCISE_ROW))
      expect(result.drift).toHaveLength(1)
      expect(result.drift[0].actual).toBe('Moved On')
      expect((await nameOf(EXERCISE_ROW))?.exercise_name).toBe('Moved On')
    })

    it("returns no target for another user's row", async () => {
      const result = await previewPatch(db, OWNER, patchFor(STRANGER_EXERCISE_ROW))
      expect(result.target).toBeNull()
    })

    it('says nothing about coverage when the replacement is unknown, rather than guessing', async () => {
      const result = await previewPatch(db, OWNER, patchFor(EXERCISE_ROW, HINGE, 'Invented Lift'))
      const texts = result.consequences.map(c => c.text).join(' | ')
      expect(texts).not.toContain('Stops training')
    })
  })
})
