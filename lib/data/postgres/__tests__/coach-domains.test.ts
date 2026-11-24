// The write domains AI Coach gained in phase 3: nutrition targets, user goals, injuries.
//
// Each one is exercised through the same `applyCoachPatch` entry point the route uses, so these
// cover the dispatcher and the domain handler together — including the parts that are identical
// everywhere (domain/field agreement, staleness, the coach_changes record, undo).
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
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
      `UPDATE users SET steps_goal = 8000, calorie_goal = 2540, calorie_goal_type = 'own', water_goal_ml = 2000 WHERE id = ANY($1)`,
      [[OWNER, STRANGER]])
  })

  // ── user_goals ────────────────────────────────────────────────────────────────

  const goalPatch = (from: number | null, to: number | null): CoachPatch => ({
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

  // Issue 2622 — the coach's calorie goal IS the user's own target: it sets or clears the same flag
  // the Goals screen writes, so it cannot silently diverge from the budget on screen.
  it('flags the number as an own target when it writes one', async () => {
    await pool.query(`UPDATE users SET calorie_goal = 2400, calorie_goal_type = 'daily' WHERE id = $1`, [OWNER])
    // The retired typed goal is invisible to a patch: `from` is null because no own target is set.
    expect((await applyCoachPatch(db, OWNER, goalPatch(2400, 1900), ['g1'])).ok).toBe(false)
    expect((await applyCoachPatch(db, OWNER, goalPatch(null, 1900), ['g1'])).ok).toBe(true)
    const { rows } = await pool.query(`SELECT calorie_goal, calorie_goal_type FROM users WHERE id = $1`, [OWNER])
    expect(Number(rows[0].calorie_goal)).toBe(1900)
    expect(rows[0].calorie_goal_type).toBe('own')
  })

  it('clears the own target with a null, back to the worked-out budget', async () => {
    const applied = await applyCoachPatch(db, OWNER, goalPatch(2540, null), ['g1'])
    expect(applied.ok).toBe(true)
    const { rows } = await pool.query(`SELECT calorie_goal, calorie_goal_type FROM users WHERE id = $1`, [OWNER])
    expect(rows[0].calorie_goal).toBeNull()
    expect(rows[0].calorie_goal_type).toBeNull()
    expect(applied.ok && applied.summary).toContain('worked-out budget')
  })

  it('undo puts the flag back, so a restored number is not mistaken for an override', async () => {
    await pool.query(`UPDATE users SET calorie_goal = 2400, calorie_goal_type = 'daily' WHERE id = $1`, [OWNER])
    const applied = await applyCoachPatch(db, OWNER, goalPatch(null, 1900), ['g1'])
    if (!applied.ok) throw new Error('setup failed')
    await undoCoachChange(db, OWNER, applied.changeId)
    const { rows } = await pool.query(`SELECT calorie_goal_type FROM users WHERE id = $1`, [OWNER])
    expect(rows[0].calorie_goal_type).toBe('daily')
  })

  it('refuses an own target outside what a person could eat', async () => {
    const low = await applyCoachPatch(db, OWNER, goalPatch(2540, 500), ['g1'])
    expect(low.ok).toBe(false)
    expect(low.ok === false && low.reason).toBe('invalid')
    const { rows } = await pool.query(`SELECT calorie_goal FROM users WHERE id = $1`, [OWNER])
    expect(Number(rows[0].calorie_goal)).toBe(2540)
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

  // #4023: the injury is dated by the person's day, not the default zone's. Kiritimati is UTC+14 all
  // year (no DST), so at this instant it is already the next calendar day there while Brisbane is not.
  // The test is about the day boundary, so the instant sits near Brisbane's midnight on purpose.
  it("dates a logged and a recovered injury by the person's day, not the default zone's", async () => {
    const TZ = 'Pacific/Kiritimati'
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-03-10T12:00:00Z'))
      const { todayInTz, DEFAULT_TZ } = await import('@trainingai/shared/date-utils')
      const theirDay = todayInTz(TZ)
      expect(theirDay).not.toBe(todayInTz(DEFAULT_TZ)) // the fixture really is a day apart

      const created = await applyCoachPatch(db, OWNER, injuryPatch(), ['i1', 'i2'], theirDay, TZ)
      if (!created.ok) throw new Error('setup failed')
      const { rows: [inj] } = await pool.query(`SELECT id, started_date::text AS d FROM injuries WHERE user_id = $1`, [OWNER])
      expect(inj.d).toBe(theirDay)

      const resolve: CoachPatch = {
        domain: 'injury',
        targetId: inj.id,
        changes: [{ id: 'r1', field: 'resolved', from: false, to: true }],
      }
      expect((await applyCoachPatch(db, OWNER, resolve, ['r1'], theirDay, TZ)).ok).toBe(true)
      const { rows: [done] } = await pool.query(`SELECT resolved_date::text AS d FROM injuries WHERE id = $1`, [inj.id])
      expect(done.d).toBe(theirDay)
    } finally {
      vi.useRealTimers()
    }
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
  // NOT ...cf01: that is `clear-program-prescriptions.test.ts`'s USER_ID, and both files INSERT and
  // DELETE it. Vitest runs files in parallel workers against one shared local database, so either
  // file's cleanup can land inside the other's run — and because the two hardcoded different
  // emails for the same id, they also raced on `users_email_unique`. Email derived from the id so
  // the two can never drift apart again (LA-32).
  const OWNER3 = '00000000-0000-4000-8000-00000000cfa1'
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
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [OWNER3, `coach-phase-${OWNER3}@example.com`])
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
  // NOT ...cf02 — same collision as OWNER3 above, with `clear-program-prescriptions`'s
  // OTHER_USER_ID (LA-32).
  const OWNER4 = '00000000-0000-4000-8000-00000000cfa2'
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
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [OWNER4, `coach-deload-${OWNER4}@example.com`])
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
      // 'automatic': an early deload week applies to automatic and AI-planned programs only (#4114).
      `INSERT INTO programs (id, user_id, name, is_active, sessions_per_cycle, started_at, phase_mode)
       VALUES ($1, $2, 'Deload Test', true, 4, '2026-01-01', 'automatic')`, [PROGRAM4, OWNER4])
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

  const weekAndFlags = async () => (await pool.query(
    `SELECT (SELECT to_char(early_deload_week_start, 'YYYY-MM-DD') FROM programs WHERE id = $1) AS start,
            (SELECT count(*)::int FROM workout_sessions WHERE user_id = $2 AND is_early_deload) AS flagged`,
    [PROGRAM4, OWNER4])).rows[0]

  // #4114: the session screen has never lightened a manual program, so the Coach does not confirm a week there.
  describe('on a program run by hand (#4114)', () => {
    beforeEach(async () => { await pool.query(`UPDATE programs SET phase_mode = 'manual' WHERE id = $1`, [PROGRAM4]) })

    it('declines in plain words and offers no Apply', async () => {
      const preview = await previewPatch(db, OWNER4, deloadPatch(false, true), TODAY)
      expect(preview.refusal).toMatch(/automatic and AI-planned programs/)
      expect(preview.refusal).toMatch(/by hand/)
    })

    it('refuses a direct apply and writes nothing', async () => {
      const result = await applyCoachPatch(db, OWNER4, deloadPatch(false, true), ['d1'], TODAY)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toBe('invalid')
      expect(await weekAndFlags()).toEqual({ start: null, flagged: 0 })
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM coach_changes WHERE user_id = $1`, [OWNER4])
      expect(rows[0].n).toBe(0)
    })

    it('still lets a leftover week from before be cancelled', async () => {
      await pool.query(`UPDATE programs SET early_deload_week_start = $1 WHERE id = $2`, [TODAY, PROGRAM4])
      const result = await applyCoachPatch(db, OWNER4, deloadPatch(true, false), ['d1'], TODAY)
      expect(result.ok).toBe(true)
      expect((await weekAndFlags()).start).toBeNull()
    })
  })

  it('an ai_dynamic program starts a week exactly as an automatic one does', async () => {
    await pool.query(`UPDATE programs SET phase_mode = 'ai_dynamic' WHERE id = $1`, [PROGRAM4])
    const applied = await applyCoachPatch(db, OWNER4, deloadPatch(false, true), ['d1'], TODAY)
    expect(applied.ok).toBe(true)
    expect(await weekAndFlags()).toEqual({ start: TODAY, flagged: 2 })
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

  // #4129: a swap to a name with nothing visible would put a nameless lift in the plan.
  it('refuses a swap to a name with no visible character, in the preview and the apply, and creates nothing', async () => {
    const blank: CoachPatch = {
      domain: 'session_exercise', targetId: adminExId,
      changes: [
        { id: 'c1', field: 'exerciseName', from: 'Coach Test Row', to: '\u200B' },
        { id: 'c2', field: 'newExerciseMuscles', from: null, to: 'Hamstrings' },
      ],
    }
    const preview = await previewPatch(db, ADMIN, blank)
    expect(preview.refusal).toBe('Give the exercise a name')
    const result = await applyCoachPatch(db, ADMIN, blank, ['c1', 'c2'])
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('invalid')
    const { rows } = await pool.query(`SELECT 1 FROM exercise_library WHERE name = $1`, ['\u200B'])
    expect(rows).toHaveLength(0)
    const { rows: se } = await pool.query(`SELECT exercise_name FROM session_exercises WHERE id = $1`, [adminExId])
    expect(se[0].exercise_name).toBe('Coach Test Row')
  })

  it('a lift already stored with a blank name can still be swapped to a real one', async () => {
    await pool.query(`UPDATE session_exercises SET exercise_name = $1 WHERE id = $2`, ['\u200B', adminExId])
    const real: CoachPatch = {
      domain: 'session_exercise', targetId: adminExId,
      changes: [{ id: 'c1', field: 'exerciseName', from: '\u200B', to: 'Coach Test Row' }],
    }
    const result = await applyCoachPatch(db, ADMIN, real, ['c1'])
    expect(result.ok).toBe(true)
    const { rows: se } = await pool.query(`SELECT exercise_name FROM session_exercises WHERE id = $1`, [adminExId])
    expect(se[0].exercise_name).toBe('Coach Test Row')
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

// ── #3796: ids the Coach writes must be the caller's own ─────────────────────────
// `phaseSetId` (program_phase) and `styleId` (session_exercise) are written verbatim, so apply
// refuses one that names another user's phase set or progression style, as the program save route
// does. The phase reads behind the preview and the workout screen are scoped the same way.
describe.skipIf(!canRun)('AI Coach — foreign phase set and style ids', () => {
  const OWNER4 = '00000000-0000-4000-8000-00000000cfb1'
  const OTHER4 = '00000000-0000-4000-8000-00000000cfb2'
  const PROGRAM4 = '00000000-0000-4000-8000-00000000cfb3'
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let applyCoachPatch: typeof import('@/lib/coach/apply').applyCoachPatch
  let previewPatch: typeof import('@/lib/coach/consequences').previewPatch
  let listProgramPhases: typeof import('@/lib/data/postgres/slices/programs').listProgramPhases
  let ownSetId = ''
  let foreignSetId = ''
  let ownStyleId = ''
  let foreignStyleId = ''
  let exerciseId = ''

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    ;({ applyCoachPatch } = await import('@/lib/coach/apply'))
    ;({ previewPatch } = await import('@/lib/coach/consequences'))
    ;({ listProgramPhases } = await import('@/lib/data/postgres/slices/programs'))
    for (const id of [OWNER4, OTHER4]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `coach-foreign-${id}@example.com`])
    }
  })

  afterAll(async () => {
    for (const id of [OWNER4, OTHER4]) {
      await pool.query(`DELETE FROM coach_changes WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM programs WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM phase_sets WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM progression_styles WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  beforeEach(async () => {
    for (const id of [OWNER4, OTHER4]) {
      await pool.query(`DELETE FROM coach_changes WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM programs WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM phase_sets WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM progression_styles WHERE user_id = $1`, [id])
    }
    const set = async (userId: string, name: string) => {
      const { rows: [ps] } = await pool.query(
        `INSERT INTO phase_sets (user_id, name) VALUES ($1, $2) RETURNING id`, [userId, name])
      await pool.query(
        `INSERT INTO program_phases (phase_set_id, name, phase_type, duration_cycles, position)
         VALUES ($1, $2, 'normal', 3, 0)`, [ps.id, `${name} Phase`])
      return ps.id as string
    }
    ownSetId = await set(OWNER4, 'Own Block')
    foreignSetId = await set(OTHER4, 'Other Block')
    ownStyleId = (await pool.query(
      `INSERT INTO progression_styles (user_id, name) VALUES ($1, 'Own Ramp') RETURNING id`, [OWNER4])).rows[0].id
    foreignStyleId = (await pool.query(
      `INSERT INTO progression_styles (user_id, name) VALUES ($1, 'Other Ramp') RETURNING id`, [OTHER4])).rows[0].id
    await pool.query(
      `INSERT INTO programs (id, user_id, name, is_active, sessions_per_cycle, phase_set_id)
       VALUES ($1, $2, 'Foreign Id Test', true, 3, NULL)`, [PROGRAM4, OWNER4])
    const { rows: [sess] } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'Day A', 0) RETURNING id`, [PROGRAM4])
    exerciseId = (await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, position) VALUES ($1, 'Foreign Id Row', 0) RETURNING id`,
      [sess.id])).rows[0].id
  })

  const setPatch = (to: string): CoachPatch => ({
    domain: 'program_phase', targetId: null,
    changes: [{ id: 'f1', field: 'phaseSetId', from: null, to }],
  })
  const stylePatch = (to: string): CoachPatch => ({
    domain: 'session_exercise', targetId: exerciseId,
    changes: [{ id: 'f2', field: 'styleId', from: null, to }],
  })
  const programSet = async () =>
    (await pool.query(`SELECT phase_set_id FROM programs WHERE id = $1`, [PROGRAM4])).rows[0].phase_set_id
  const exerciseStyle = async () =>
    (await pool.query(`SELECT style_id FROM session_exercises WHERE id = $1`, [exerciseId])).rows[0].style_id

  it("refuses another user's phase set, and writes nothing", async () => {
    const result = await applyCoachPatch(db, OWNER4, setPatch(foreignSetId), ['f1'])
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await programSet()).toBeNull()
    expect((await pool.query(`SELECT 1 FROM coach_changes WHERE user_id = $1`, [OWNER4])).rowCount).toBe(0)
  })

  it('applies one of the caller\'s own phase sets', async () => {
    expect((await applyCoachPatch(db, OWNER4, setPatch(ownSetId), ['f1'])).ok).toBe(true)
    expect(await programSet()).toBe(ownSetId)
  })

  it("does not name another user's phase set in the preview", async () => {
    const preview = await previewPatch(db, OWNER4, setPatch(foreignSetId))
    const line = preview.consequences.find(c => c.text.startsWith('Periodisation model'))
    expect(line?.text).toBe('Periodisation model none → unknown')
  })

  it("reads no phases through a phase set that is not the caller's", async () => {
    // A link stored before the write paths checked it.
    await pool.query(`UPDATE programs SET phase_set_id = $1 WHERE id = $2`, [foreignSetId, PROGRAM4])
    expect(await listProgramPhases(db, OWNER4, PROGRAM4)).toEqual([])
    await pool.query(`UPDATE programs SET phase_set_id = $1 WHERE id = $2`, [ownSetId, PROGRAM4])
    expect((await listProgramPhases(db, OWNER4, PROGRAM4)).map(p => p.name)).toEqual(['Own Block Phase'])
  })

  it("refuses another user's progression style, and writes nothing", async () => {
    const result = await applyCoachPatch(db, OWNER4, stylePatch(foreignStyleId), ['f2'])
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await exerciseStyle()).toBeNull()
  })

  it("applies one of the caller's own progression styles", async () => {
    expect((await applyCoachPatch(db, OWNER4, stylePatch(ownStyleId), ['f2'])).ok).toBe(true)
    expect(await exerciseStyle()).toBe(ownStyleId)
  })
})
