// The write domains AI Coach gained in phase 3: nutrition targets, user goals, injuries.
//
// Each one is exercised through the same `applyCoachPatch` entry point the route uses, so these
// cover the dispatcher and the domain handler together — including the parts that are identical
// everywhere (domain/field agreement, staleness, the coach_changes record, undo).
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { CoachPatch } from '@/lib/coach/patch'

const canRun = !!process.env.DATABASE_URL
const OWNER = '00000000-0000-4000-8000-00000000ce01'
const STRANGER = '00000000-0000-4000-8000-00000000ce02'

describe.skipIf(!canRun)('AI Coach — phase 3 write domains', () => {
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
         ON CONFLICT (id) DO NOTHING`, [id, `coach-domain-${tag}@example.com`])
    }
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, STRANGER]])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM coach_changes WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
    await pool.query(`DELETE FROM injuries WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
    await pool.query(`DELETE FROM nutrition_targets WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
    await pool.query(
      `UPDATE users SET steps_goal = 8000, calorie_goal = 2540, water_goal_ml = 2000 WHERE id = ANY($1)`,
      [[OWNER, STRANGER]])
  })

  // ── user_goals ────────────────────────────────────────────────────────────────

  const goalPatch = (from: number | null, to: number): CoachPatch => ({
    domain: 'user_goals',
    targetId: null,
    changes: [{ id: 'g1', field: 'calorieGoal', from, to }],
  })

  it('writes a calorie goal and records it', async () => {
    const result = await applyCoachPatch(db, OWNER, goalPatch(2540, 2340), ['g1'])
    expect(result.ok).toBe(true)

    const { rows } = await pool.query(`SELECT calorie_goal FROM users WHERE id = $1`, [OWNER])
    expect(Number(rows[0].calorie_goal)).toBe(2340)

    const { rows: recorded } = await pool.query(`SELECT domain, summary FROM coach_changes WHERE user_id = $1`, [OWNER])
    expect(recorded[0].domain).toBe('user_goals')
    expect(recorded[0].summary).toContain('2,340')
  })

  it('refuses a goal whose stored value has moved', async () => {
    await pool.query(`UPDATE users SET calorie_goal = 2600 WHERE id = $1`, [OWNER])
    const result = await applyCoachPatch(db, OWNER, goalPatch(2540, 2340), ['g1'])
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('stale')
    const { rows } = await pool.query(`SELECT calorie_goal FROM users WHERE id = $1`, [OWNER])
    expect(Number(rows[0].calorie_goal)).toBe(2600)
  })

  it('undo restores the previous goal', async () => {
    const applied = await applyCoachPatch(db, OWNER, goalPatch(2540, 2340), ['g1'])
    if (!applied.ok) throw new Error('setup failed')
    await undoCoachChange(db, OWNER, applied.changeId)
    const { rows } = await pool.query(`SELECT calorie_goal FROM users WHERE id = $1`, [OWNER])
    expect(Number(rows[0].calorie_goal)).toBe(2540)
  })

  it("does not touch another user's goals", async () => {
    await applyCoachPatch(db, OWNER, goalPatch(2540, 2340), ['g1'])
    const { rows } = await pool.query(`SELECT calorie_goal FROM users WHERE id = $1`, [STRANGER])
    expect(Number(rows[0].calorie_goal)).toBe(2540)
  })

  it('flags an unusually large calorie jump instead of applying it quietly', async () => {
    const preview = await previewPatch(db, OWNER, goalPatch(2540, 4000))
    expect(preview.consequences.some(c => c.kind === 'warn')).toBe(true)
  })

  // ── nutrition_targets ─────────────────────────────────────────────────────────

  it('creates macro targets when none exist, then updates them', async () => {
    const create: CoachPatch = {
      domain: 'nutrition_targets',
      targetId: null,
      changes: [{ id: 'n1', field: 'proteinG', from: null, to: 185 }],
    }
    expect((await applyCoachPatch(db, OWNER, create, ['n1'])).ok).toBe(true)
    let { rows } = await pool.query(`SELECT protein_g FROM nutrition_targets WHERE user_id = $1`, [OWNER])
    expect(Number(rows[0].protein_g)).toBe(185)

    const update: CoachPatch = {
      domain: 'nutrition_targets',
      targetId: null,
      changes: [{ id: 'n2', field: 'proteinG', from: 185, to: 200 }],
    }
    expect((await applyCoachPatch(db, OWNER, update, ['n2'])).ok).toBe(true)
    ;({ rows } = await pool.query(`SELECT protein_g FROM nutrition_targets WHERE user_id = $1`, [OWNER]))
    expect(Number(rows[0].protein_g)).toBe(200)

    // One row per user, not one per change.
    const { rows: count } = await pool.query(`SELECT count(*)::int AS n FROM nutrition_targets WHERE user_id = $1`, [OWNER])
    expect(count[0].n).toBe(1)
  })

  // ── injury ────────────────────────────────────────────────────────────────────

  const injuryPatch = (): CoachPatch => ({
    domain: 'injury',
    targetId: null,
    changes: [
      { id: 'i1', field: 'muscleName', from: null, to: 'left shoulder' },
      { id: 'i2', field: 'severity', from: null, to: 'moderate' },
    ],
  })

  it('logs an injury', async () => {
    const result = await applyCoachPatch(db, OWNER, injuryPatch(), ['i1', 'i2'])
    expect(result.ok).toBe(true)
    const { rows } = await pool.query(
      `SELECT muscle_name, severity, resolved_date FROM injuries WHERE user_id = $1`, [OWNER])
    expect(rows).toHaveLength(1)
    expect(rows[0].muscle_name).toBe('left shoulder')
    expect(rows[0].severity).toBe('moderate')
    expect(rows[0].resolved_date).toBeNull()
  })

  it('updates an existing active injury rather than stacking a duplicate', async () => {
    await applyCoachPatch(db, OWNER, injuryPatch(), ['i1', 'i2'])
    const worse: CoachPatch = {
      domain: 'injury',
      targetId: null,
      changes: [
        { id: 'j1', field: 'muscleName', from: null, to: 'Left Shoulder' },  // different case
        { id: 'j2', field: 'severity', from: null, to: 'severe' },
      ],
    }
    await applyCoachPatch(db, OWNER, worse, ['j1', 'j2'])

    const { rows } = await pool.query(`SELECT severity FROM injuries WHERE user_id = $1 AND deleted_at IS NULL`, [OWNER])
    expect(rows).toHaveLength(1)
    expect(rows[0].severity).toBe('severe')
  })

  it('undo removes an injury it created', async () => {
    const applied = await applyCoachPatch(db, OWNER, injuryPatch(), ['i1', 'i2'])
    if (!applied.ok) throw new Error('setup failed')
    await undoCoachChange(db, OWNER, applied.changeId)
    const { rows } = await pool.query(
      `SELECT 1 FROM injuries WHERE user_id = $1 AND deleted_at IS NULL`, [OWNER])
    expect(rows).toHaveLength(0)
  })

  it('marks an injury recovered, and undo un-marks it', async () => {
    const created = await applyCoachPatch(db, OWNER, injuryPatch(), ['i1', 'i2'])
    if (!created.ok) throw new Error('setup failed')
    const { rows: [inj] } = await pool.query(`SELECT id FROM injuries WHERE user_id = $1`, [OWNER])

    const resolve: CoachPatch = {
      domain: 'injury',
      targetId: inj.id,
      changes: [{ id: 'r1', field: 'resolved', from: false, to: true }],
    }
    const applied = await applyCoachPatch(db, OWNER, resolve, ['r1'])
    expect(applied.ok).toBe(true)
    let { rows } = await pool.query(`SELECT resolved_date FROM injuries WHERE id = $1`, [inj.id])
    expect(rows[0].resolved_date).not.toBeNull()

    if (!applied.ok) return
    await undoCoachChange(db, OWNER, applied.changeId)
    ;({ rows } = await pool.query(`SELECT resolved_date FROM injuries WHERE id = $1`, [inj.id]))
    expect(rows[0].resolved_date).toBeNull()
  })

  it("refuses to resolve another user's injury", async () => {
    const created = await applyCoachPatch(db, OWNER, injuryPatch(), ['i1', 'i2'])
    expect(created.ok).toBe(true)
    const { rows: [inj] } = await pool.query(`SELECT id FROM injuries WHERE user_id = $1`, [OWNER])

    const result = await applyCoachPatch(db, STRANGER, {
      domain: 'injury',
      targetId: inj.id,
      changes: [{ id: 'r1', field: 'resolved', from: false, to: true }],
    }, ['r1'])
    expect(result.ok).toBe(false)

    const { rows } = await pool.query(`SELECT resolved_date FROM injuries WHERE id = $1`, [inj.id])
    expect(rows[0].resolved_date).toBeNull()
  })

  it('counts affected exercises for a side-qualified injury', async () => {
    // The program stores "shoulders"; a person says "left shoulder". Without stripping the side and
    // the plural, this count reads zero for almost every real injury — which looks identical to
    // "nothing in your program trains this" and is much worse than saying nothing.
    const [{ id: progId }] = (await pool.query(
      `INSERT INTO programs (user_id, name, is_active) VALUES ($1, 'Domain Test', true) RETURNING id`, [OWNER])).rows
    const [{ id: sessId }] = (await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'Push', 0) RETURNING id`, [progId])).rows
    await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, muscle_groups, position)
       VALUES ($1, 'Overhead Press', ARRAY['shoulders'], 0)`, [sessId])

    const preview = await previewPatch(db, OWNER, injuryPatch())
    const texts = preview.consequences.map(c => c.text).join(' | ')
    expect(texts).toContain('Overhead Press')

    await pool.query(`DELETE FROM programs WHERE id = $1`, [progId])
  })

  // Q-227. The owner asked "what do you think it is?" about lower-back pain and got a card offering
  // to log an injury at Severity: mild — a value they had never said, invented by the model. The
  // prompt now tells it to omit the field rather than guess, which moves the assumption into
  // `apply`'s `severity ?? ASSUMED_SEVERITY` default. That would be a silent fabrication too, just
  // ours instead of the model's — severity feeds real prescription decisions, and the manual injury
  // sheet has always made the user tap it. So the confirmation has to say what it will record.
  it('names the severity it will assume when the proposal omits one (Q-227)', async () => {
    const noSeverity: CoachPatch = {
      domain: 'injury',
      targetId: null,
      changes: [{ id: 'i1', field: 'muscleName', from: null, to: 'lower back' }],
    }
    const preview = await previewPatch(db, OWNER, noSeverity)
    const texts = preview.consequences.map(c => c.text).join(' | ')
    expect(texts).toMatch(/Recorded as moderate/)
    // And the value promised is the one actually written — not a second copy of the literal.
    const applied = await applyCoachPatch(db, OWNER, noSeverity, ['i1'])
    expect(applied.ok).toBe(true)
    const { rows } = await pool.query(
      `SELECT severity FROM injuries WHERE user_id = $1 AND lower(muscle_name) = 'lower back'`, [OWNER])
    expect(rows[0].severity).toBe('moderate')
    await pool.query(`DELETE FROM injuries WHERE user_id = $1 AND lower(muscle_name) = 'lower back'`, [OWNER])
  })

  it('stays quiet about severity when the user actually gave one', async () => {
    // A supplied severity is already a visible change row on the card. Repeating it as a
    // consequence would read as though the app had decided it.
    const preview = await previewPatch(db, OWNER, injuryPatch())
    const texts = preview.consequences.map(c => c.text).join(' | ')
    expect(texts).not.toMatch(/Recorded as/)
  })

  // ── the cross-domain guard ────────────────────────────────────────────────────

  it('refuses a field that does not belong to its domain', async () => {
    const mixed = {
      domain: 'user_goals',
      targetId: null,
      changes: [{ id: 'x1', field: 'exerciseName', from: 'A', to: 'B' }],
    } as unknown as CoachPatch
    const result = await applyCoachPatch(db, OWNER, mixed, ['x1'])
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('invalid')
  })
})

// ── program_phase (tier 3) ──────────────────────────────────────────────────────
// The only domain whose effects can take something away, which is what earns it a pushed
// confirmation screen rather than a card in the thread.
describe.skipIf(!canRun)('AI Coach — program_phase (tier 3)', () => {
  const OWNER3 = '00000000-0000-4000-8000-00000000cf01'
  const PROGRAM3 = '00000000-0000-4000-8000-00000000cf10'
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let applyCoachPatch: typeof import('@/lib/coach/apply').applyCoachPatch
  let undoCoachChange: typeof import('@/lib/coach/apply').undoCoachChange
  let previewPatch: typeof import('@/lib/coach/consequences').previewPatch

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    ;({ applyCoachPatch, undoCoachChange } = await import('@/lib/coach/apply'))
    ;({ previewPatch } = await import('@/lib/coach/consequences'))
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'coach-phase@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [OWNER3])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM coach_changes WHERE user_id = $1`, [OWNER3])
    await pool.query(`DELETE FROM programs WHERE id = $1`, [PROGRAM3])
    await pool.query(`DELETE FROM users WHERE id = $1`, [OWNER3])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM coach_changes WHERE user_id = $1`, [OWNER3])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [OWNER3])
    await pool.query(`DELETE FROM programs WHERE id = $1`, [PROGRAM3])
    await pool.query(
      `INSERT INTO programs (id, user_id, name, is_active, sessions_per_cycle)
       VALUES ($1, $2, 'Phase Test', true, 3)`, [PROGRAM3, OWNER3])
    // Nine logged sessions = three completed cycles at 3 per cycle.
    for (let i = 0; i < 9; i++) {
      await pool.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'S', now() - ($2 || ' days')::interval)`,
        [OWNER3, String(i + 1)])
    }
  })

  const cyclePatch = (from: number, to: number): CoachPatch => ({
    domain: 'program_phase',
    targetId: null,
    changes: [{ id: 'p1', field: 'sessionsPerCycle', from, to }],
  })

  it('warns when a change moves the user backwards through the block', async () => {
    // 9 sessions ÷ 3 = cycle 4; ÷ 5 = cycle 2. That is two cycles of earned progress gone.
    const preview = await previewPatch(db, OWNER3, cyclePatch(3, 5))
    const warn = preview.consequences.find(c => c.kind === 'warn' && c.text.includes('back'))
    expect(warn).toBeTruthy()
    expect(warn!.text).toContain('lose 2 cycles')
  })

  it('does not warn about losing progress when the change moves forward', async () => {
    const preview = await previewPatch(db, OWNER3, cyclePatch(3, 2))
    expect(preview.consequences.some(c => c.text.includes('lose'))).toBe(false)
  })

  it('applies and undoes a cycle-length change', async () => {
    const applied = await applyCoachPatch(db, OWNER3, cyclePatch(3, 5), ['p1'])
    expect(applied.ok).toBe(true)
    let { rows } = await pool.query(`SELECT sessions_per_cycle FROM programs WHERE id = $1`, [PROGRAM3])
    expect(Number(rows[0].sessions_per_cycle)).toBe(5)

    if (!applied.ok) return
    await undoCoachChange(db, OWNER3, applied.changeId)
    ;({ rows } = await pool.query(`SELECT sessions_per_cycle FROM programs WHERE id = $1`, [PROGRAM3]))
    expect(Number(rows[0].sessions_per_cycle)).toBe(3)
  })

  it('refuses a cycle change whose stored value has moved', async () => {
    await pool.query(`UPDATE programs SET sessions_per_cycle = 4 WHERE id = $1`, [PROGRAM3])
    const result = await applyCoachPatch(db, OWNER3, cyclePatch(3, 5), ['p1'])
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('stale')
  })
})

// ── early_deload ────────────────────────────────────────────────────────────────
// Starting a deload week ahead of schedule. The interesting part is the side effect: flagged
// sessions are excluded from every cycle count in `slices/programs.ts`, so today's logged work
// stops advancing the block — and undo has to put that back, not just the date column.
describe.skipIf(!canRun)('AI Coach — early_deload', () => {
  const OWNER4 = '00000000-0000-4000-8000-00000000cf02'
  const PROGRAM4 = '00000000-0000-4000-8000-00000000cf20'
  const TODAY = '2026-03-05'
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let applyCoachPatch: typeof import('@/lib/coach/apply').applyCoachPatch
  let undoCoachChange: typeof import('@/lib/coach/apply').undoCoachChange
  let previewPatch: typeof import('@/lib/coach/consequences').previewPatch

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    ;({ applyCoachPatch, undoCoachChange } = await import('@/lib/coach/apply'))
    ;({ previewPatch } = await import('@/lib/coach/consequences'))
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'coach-deload@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [OWNER4])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM coach_changes WHERE user_id = $1`, [OWNER4])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [OWNER4])
    await pool.query(`DELETE FROM programs WHERE id = $1`, [PROGRAM4])
    await pool.query(`DELETE FROM users WHERE id = $1`, [OWNER4])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM coach_changes WHERE user_id = $1`, [OWNER4])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [OWNER4])
    await pool.query(`DELETE FROM programs WHERE id = $1`, [PROGRAM4])
    await pool.query(
      `INSERT INTO programs (id, user_id, name, is_active, sessions_per_cycle, started_at)
       VALUES ($1, $2, 'Deload Test', true, 4, '2026-01-01')`, [PROGRAM4, OWNER4])
    // Two sessions logged on TODAY in Brisbane — 2026-03-05 local is 2026-03-04T14:00Z onward.
    for (const at of ['2026-03-05T01:00:00Z', '2026-03-05T03:00:00Z']) {
      await pool.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'S', $2)`,
        [OWNER4, at])
    }
  })

  const deloadPatch = (from: boolean, to: boolean): CoachPatch => ({
    domain: 'early_deload',
    targetId: null,
    changes: [{ id: 'd1', field: 'deloadNow', from, to }],
  })

  it('measures how early the deload is, and what it costs today', async () => {
    const preview = await previewPatch(db, OWNER4, deloadPatch(false, true), TODAY)
    expect(preview.consequences.some(c => c.text.includes('of 4 sessions into this cycle'))).toBe(true)
    const warn = preview.consequences.find(c => c.kind === 'warn')
    expect(warn?.text).toContain('2 sessions logged today stop counting')
  })

  it('starts the deload and takes today out of the cycle count', async () => {
    const applied = await applyCoachPatch(db, OWNER4, deloadPatch(false, true), ['d1'], TODAY)
    expect(applied.ok).toBe(true)
    const { rows } = await pool.query(
      // As text: the pg driver hands back a `Date` for a `date` column, which re-renders in the
      // runner's timezone and can land on the neighbouring day.
      `SELECT (SELECT to_char(early_deload_week_start, 'YYYY-MM-DD') FROM programs WHERE id = $1) AS start,
              (SELECT count(*)::int FROM workout_sessions WHERE user_id = $2 AND is_early_deload) AS flagged`,
      [PROGRAM4, OWNER4])
    expect(rows[0].start).toBe(TODAY)
    expect(rows[0].flagged).toBe(2)
  })

  it('undo restores the flags as well as the date', async () => {
    const applied = await applyCoachPatch(db, OWNER4, deloadPatch(false, true), ['d1'], TODAY)
    if (!applied.ok) throw new Error('apply failed')
    await undoCoachChange(db, OWNER4, applied.changeId)
    const { rows } = await pool.query(
      `SELECT (SELECT early_deload_week_start FROM programs WHERE id = $1) AS start,
              (SELECT count(*)::int FROM workout_sessions WHERE user_id = $2 AND is_early_deload) AS flagged`,
      [PROGRAM4, OWNER4])
    expect(rows[0].start).toBeNull()
    expect(rows[0].flagged).toBe(0)
  })

  it('cancels a deload that is already running, and counts today again', async () => {
    await applyCoachPatch(db, OWNER4, deloadPatch(false, true), ['d1'], TODAY)
    const cancelled = await applyCoachPatch(db, OWNER4, deloadPatch(true, false), ['d1'], TODAY)
    expect(cancelled.ok).toBe(true)
    const { rows } = await pool.query(
      `SELECT (SELECT early_deload_week_start FROM programs WHERE id = $1) AS start,
              (SELECT count(*)::int FROM workout_sessions WHERE user_id = $2 AND is_early_deload) AS flagged`,
      [PROGRAM4, OWNER4])
    expect(rows[0].start).toBeNull()
    expect(rows[0].flagged).toBe(0)
  })

  it('refuses when a deload was already started elsewhere', async () => {
    await pool.query(`UPDATE programs SET early_deload_week_start = $1 WHERE id = $2`, [TODAY, PROGRAM4])
    const result = await applyCoachPatch(db, OWNER4, deloadPatch(false, true), ['d1'], TODAY)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('stale')
  })

  it('will not write a deload field onto another domain', async () => {
    const mixed = { ...deloadPatch(false, true), domain: 'user_goals' } as CoachPatch
    const result = await applyCoachPatch(db, OWNER4, mixed, ['d1'], TODAY)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('invalid')
  })
})

// ── session_exercise: swapping to an exercise the catalogue does not have ────────
// The owner's ask: "I want to add in Jefferson curls to swap with bent over row". The exercise does
// not exist, so a plain swap refuses it — the patch carries the muscles to create it with, and both
// halves land in one confirmation.
describe.skipIf(!canRun)('AI Coach — create-on-swap', () => {
  const ADMIN = '00000000-0000-4000-8000-00000000cf03'
  const PLAIN = '00000000-0000-4000-8000-00000000cf04'
  const NEW_NAME = 'Coach Test Jefferson Curl'
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let applyCoachPatch: typeof import('@/lib/coach/apply').applyCoachPatch
  let previewPatch: typeof import('@/lib/coach/consequences').previewPatch
  let adminExId = ''
  let plainExId = ''

  async function seedProgram(userId: string, programId: string): Promise<string> {
    await pool.query(
      `INSERT INTO programs (id, user_id, name, is_active) VALUES ($1, $2, 'Create Test', true)`,
      [programId, userId])
    const { rows: [sess] } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'Pull', 0) RETURNING id`,
      [programId])
    // Linked to its catalogue row, as a real program row is — an unlinked fixture would have made
    // the undo assertion below pass against a null it never restored.
    const { rows: [ex] } = await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, exercise_id, muscle_groups, position)
       VALUES ($1, 'Coach Test Row',
               (SELECT id FROM exercise_library WHERE name = 'Coach Test Row'),
               ARRAY['upper back','lats'], 0)
       RETURNING id`, [sess.id])
    return ex.id
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    ;({ applyCoachPatch } = await import('@/lib/coach/apply'))
    ;({ previewPatch } = await import('@/lib/coach/consequences'))
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin) VALUES
         ($1, 'coach-admin@example.com', 'x', 'Australia/Brisbane', true),
         ($2, 'coach-plain@example.com', 'x', 'Australia/Brisbane', false)
       ON CONFLICT (id) DO NOTHING`, [ADMIN, PLAIN])
    await pool.query(
      `INSERT INTO exercise_library (name, muscles)
       VALUES ('Coach Test Row', '[{"muscle":"upper back","role":"main"},{"muscle":"lats","role":"main"}]'::jsonb)
       ON CONFLICT (name) DO NOTHING`)
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM coach_changes WHERE user_id = ANY($1)`, [[ADMIN, PLAIN]])
    await pool.query(`DELETE FROM programs WHERE user_id = ANY($1)`, [[ADMIN, PLAIN]])
    await pool.query(`DELETE FROM exercise_library WHERE name IN ($1, 'Coach Test Row')`, [NEW_NAME])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[ADMIN, PLAIN]])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM coach_changes WHERE user_id = ANY($1)`, [[ADMIN, PLAIN]])
    await pool.query(`DELETE FROM programs WHERE user_id = ANY($1)`, [[ADMIN, PLAIN]])
    await pool.query(`DELETE FROM exercise_library WHERE name = $1`, [NEW_NAME])
    adminExId = await seedProgram(ADMIN, '00000000-0000-4000-8000-00000000cf30')
    plainExId = await seedProgram(PLAIN, '00000000-0000-4000-8000-00000000cf31')
  })

  const createPatch = (targetId: string): CoachPatch => ({
    domain: 'session_exercise',
    targetId,
    changes: [
      { id: 'c1', field: 'exerciseName', from: 'Coach Test Row', to: NEW_NAME },
      { id: 'c2', field: 'newExerciseMuscles', from: null, to: 'Hamstrings, Lower back' },
      { id: 'c3', field: 'newExerciseEquipment', from: null, to: 'Barbell' },
    ],
  })

  it('says in the preview that it will create the exercise, and what it will train', async () => {
    const preview = await previewPatch(db, ADMIN, createPatch(adminExId))
    const line = preview.consequences.find(c => c.text.includes('exercise library'))
    expect(line?.text).toContain(NEW_NAME)
    expect(line?.text).toContain('Hamstrings and Lower back')
  })

  it('measures the coverage delta from the proposed muscles, not from nothing', async () => {
    const preview = await previewPatch(db, ADMIN, createPatch(adminExId))
    expect(preview.consequences.some(c => c.kind === 'warn' && c.text.includes('Stops training'))).toBe(true)
  })

  it('creates the catalogue entry and swaps to it in one apply', async () => {
    const result = await applyCoachPatch(db, ADMIN, createPatch(adminExId), ['c1', 'c2', 'c3'])
    expect(result.ok).toBe(true)
    const { rows } = await pool.query(
      `SELECT name, muscles, equipment, created_by FROM exercise_library WHERE name = $1`, [NEW_NAME])
    expect(rows).toHaveLength(1)
    expect(rows[0].muscles).toEqual([
      { muscle: 'Hamstrings', role: 'main' },
      { muscle: 'Lower back', role: 'main' },
    ])
    expect(rows[0].equipment).toEqual(['Barbell'])
    expect(rows[0].created_by).toBe(ADMIN)

    // The session row points at the new entry, with its muscle groups — those drive deload and
    // recovery, so a swap that left the old ones would silently corrupt both.
    const { rows: se } = await pool.query(
      `SELECT exercise_name, muscle_groups, exercise_id FROM session_exercises WHERE id = $1`, [adminExId])
    expect(se[0].exercise_name).toBe(NEW_NAME)
    expect(se[0].muscle_groups).toEqual(['Hamstrings', 'Lower back'])
    expect(se[0].exercise_id).toBe(rows[0].id ?? se[0].exercise_id)
  })

  it('refuses a non-admin, and writes nothing at all', async () => {
    const result = await applyCoachPatch(db, PLAIN, createPatch(plainExId), ['c1', 'c2', 'c3'])
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('invalid')
    const { rows } = await pool.query(`SELECT 1 FROM exercise_library WHERE name = $1`, [NEW_NAME])
    expect(rows).toHaveLength(0)
    const { rows: se } = await pool.query(
      `SELECT exercise_name FROM session_exercises WHERE id = $1`, [plainExId])
    expect(se[0].exercise_name).toBe('Coach Test Row')
  })

  it('undo restores the catalogue link, not just the displayed name', async () => {
    const applied = await applyCoachPatch(db, ADMIN, createPatch(adminExId), ['c1', 'c2', 'c3'])
    if (!applied.ok) throw new Error('apply failed')
    const { undoCoachChange } = await import('@/lib/coach/apply')
    await undoCoachChange(db, ADMIN, applied.changeId)

    // Restoring only exercise_name left the row pointing at the replacement through its FK —
    // observed 2026-08-09 and invisible to anything reading the name.
    const { rows } = await pool.query(
      `SELECT se.exercise_name, el.name AS linked
         FROM session_exercises se LEFT JOIN exercise_library el ON el.id = se.exercise_id
        WHERE se.id = $1`, [adminExId])
    expect(rows[0].exercise_name).toBe('Coach Test Row')
    expect(rows[0].linked).toBe('Coach Test Row')

    // The catalogue row itself stays: other sessions and logged history may already name it, and
    // undo is about the change that was made, not about erasing an exercise from the app.
    const { rows: lib } = await pool.query(`SELECT 1 FROM exercise_library WHERE name = $1`, [NEW_NAME])
    expect(lib).toHaveLength(1)
  })

  it('still refuses a plain swap to an unknown name — a typo must not create anything', async () => {
    const typo: CoachPatch = {
      domain: 'session_exercise',
      targetId: adminExId,
      changes: [{ id: 'c1', field: 'exerciseName', from: 'Coach Test Row', to: 'Bent-Ovr Barbel Rw' }],
    }
    const result = await applyCoachPatch(db, ADMIN, typo, ['c1'])
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason === 'invalid' && result.detail).toContain('not in the exercise library')
    const { rows } = await pool.query(`SELECT 1 FROM exercise_library WHERE name = 'Bent-Ovr Barbel Rw'`)
    expect(rows).toHaveLength(0)
  })
})
