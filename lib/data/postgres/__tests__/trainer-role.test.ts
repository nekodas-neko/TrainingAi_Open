// #2300 — the trainer role, driven through the real routes against a real Postgres.
//
// A trainer route is "call `saveProgram` with someone else's id", so the guard in front of it is
// the whole boundary between one user and another's training history. A test that mocks that guard
// proves nothing, so nothing here is mocked except the session (`auth`) and the rate limiter, and
// every refusal is asserted twice: the status, and that NO row was written anywhere.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else (CI's "Tests" job has
// no DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const TRAINER = '00000000-0000-4000-8000-0000000fd0a1'
const TRAINEE = '00000000-0000-4000-8000-0000000fd0a2'
const STRANGER = '00000000-0000-4000-8000-0000000fd0a3'
const PENDING = '00000000-0000-4000-8000-0000000fd0a4'
const REVOKED = '00000000-0000-4000-8000-0000000fd0a5'
const DORMANT = '00000000-0000-4000-8000-0000000fd0a6'
const ALL = [TRAINER, TRAINEE, STRANGER, PENDING, REVOKED, DORMANT]
const NOBODY = '00000000-0000-4000-8000-0000000fd0ff'

const { state } = vi.hoisted(() => ({ state: { user: null as string | null, limitOk: true } }))
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (state.user ? { user: { id: state.user, timezone: 'Australia/Brisbane' } } : null)),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => state.limitOk }))

const JSON_HEADERS = { 'Content-Type': 'application/json' }

const program = (over: Record<string, unknown> = {}) => ({
  program: {
    name: 'Coach Block A',
    sessions: [
      { name: 'Upper', exercises: [{ exerciseName: 'Bench Press', muscleGroups: ['chest'], exerciseRole: 'primary' }] },
      { name: 'Lower', exercises: [{ exerciseName: 'Back Squat', muscleGroups: ['quads'] }, { exerciseName: 'RDL' }] },
    ],
    ...over,
  },
})

describe.skipIf(!canRun)('trainer role (#2300)', () => {
  let pool: import('pg').Pool
  const rel: Record<string, string> = {}

  const as = (id: string | null) => { state.user = id }
  const post = (url: string, body: unknown) =>
    new Request(url, { method: 'POST', headers: JSON_HEADERS, body: typeof body === 'string' ? body : JSON.stringify(body) })

  async function routes() {
    return {
      rels: await import('@/app/api/trainer/relationships/route'),
      relId: await import('@/app/api/trainer/relationships/[id]/route'),
      progs: await import('@/app/api/trainer/trainees/[traineeId]/programs/route'),
      mine: await import('@/app/api/trainer/assigned-to-me/route'),
    }
  }
  async function assign(traineeId: string, body: unknown) {
    const { progs } = await routes()
    return progs.POST(post('http://localhost/x', body), { params: Promise.resolve({ traineeId }) })
  }
  async function listAssigned(traineeId: string) {
    const { progs } = await routes()
    return progs.GET(new Request('http://localhost/x'), { params: Promise.resolve({ traineeId }) })
  }
  async function act(id: string, action: unknown) {
    const { relId } = await routes()
    return relId.PATCH(post('http://localhost/x', { action }), { params: Promise.resolve({ id }) })
  }
  const count = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0].n as number

  /** Seed one relationship row directly: the handshake itself is tested through the routes. */
  async function seedRel(trainerId: string, traineeId: string, status: string) {
    const { rows } = await pool.query(
      `INSERT INTO trainer_relationships (trainer_id, trainee_id, status) VALUES ($1, $2, $3)
       ON CONFLICT (trainer_id, trainee_id) DO UPDATE SET status = EXCLUDED.status RETURNING id`,
      [trainerId, traineeId, status])
    return rows[0].id as string
  }

  async function wipe() {
    // Users cascade to relationships, assignments, programs, styles.
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ALL])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await wipe()
    const codes: Record<string, string> = {
      [TRAINER]: 'TST-TRNR', [TRAINEE]: 'TST-TRNE', [STRANGER]: 'TST-STRG', [PENDING]: 'TST-PEND', [REVOKED]: 'TST-REVK', [DORMANT]: 'TST-DORM',
    }
    for (const id of ALL) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone, is_active, display_name, friend_code)
         VALUES ($1, $2, 'x', 'Australia/Brisbane', $3, $4, $5)`,
        [id, `trainer-role-${id.slice(-2)}@example.com`, id !== DORMANT, `User ${id.slice(-2)}`, codes[id]])
    }
  })

  afterAll(async () => {
    if (canRun) await wipe()
  })

  beforeEach(() => { state.limitOk = true; as(null) })

  // ── The handshake ──────────────────────────────────────────────────────────

  describe('the handshake: the trainer asks, the trainee accepts', () => {
    it('a request by friend code is 201 pending, and tells the trainer nothing about the target', async () => {
      as(TRAINER)
      const { rels } = await routes()
      const res = await rels.POST(post('http://localhost/x', { emailOrCode: 'tst-trne' }))
      expect(res.status).toBe(201)
      const { relationship } = await res.json()
      rel.main = relationship.id
      expect(relationship.status).toBe('pending')
      expect(relationship.otherUser).toEqual({ id: null, displayName: 'tst-trne', name: null, avatar: null })
      const { rows } = await pool.query(`SELECT trainer_id, trainee_id, status FROM trainer_relationships WHERE id = $1`, [rel.main])
      expect(rows[0]).toEqual({ trainer_id: TRAINER, trainee_id: TRAINEE, status: 'pending' })
    })

    it('refuses yourself, an unknown code, a duplicate, and a body with a stray key', async () => {
      as(TRAINER)
      const { rels } = await routes()
      expect((await rels.POST(post('http://localhost/x', { emailOrCode: 'TST-TRNR' }))).status).toBe(400)
      expect((await rels.POST(post('http://localhost/x', { emailOrCode: 'TST-NOPE' }))).status).toBe(404)
      expect((await rels.POST(post('http://localhost/x', { emailOrCode: 'TST-TRNE' }))).status).toBe(409)
      expect((await rels.POST(post('http://localhost/x', { emailOrCode: 'TST-TRNE', trainerId: STRANGER }))).status).toBe(400)
      expect((await rels.POST(post('http://localhost/x', {}))).status).toBe(400)
      expect((await rels.POST(post('http://localhost/x', '{not json'))).status).toBe(400)
      expect(await count(`SELECT count(*)::int AS n FROM trainer_relationships WHERE trainer_id = $1`, [TRAINER])).toBe(1)
    })

    it('the trainer cannot accept their own request — it matches 0 rows', async () => {
      as(TRAINER)
      expect((await act(rel.main, 'accept')).status).toBe(404)
      const { rows } = await pool.query(`SELECT status FROM trainer_relationships WHERE id = $1`, [rel.main])
      expect(rows[0].status).toBe('pending')
    })

    it('a stranger can neither accept nor revoke it', async () => {
      as(STRANGER)
      expect((await act(rel.main, 'accept')).status).toBe(404)
      expect((await act(rel.main, 'revoke')).status).toBe(404)
      const { rows } = await pool.query(`SELECT status FROM trainer_relationships WHERE id = $1`, [rel.main])
      expect(rows[0].status).toBe('pending')
    })

    it('a pending relationship gives the trainer no write access yet', async () => {
      as(TRAINER)
      const before = await count(`SELECT count(*)::int AS n FROM programs WHERE user_id = $1`, [TRAINEE])
      expect((await assign(TRAINEE, program())).status).toBe(403)
      expect(await count(`SELECT count(*)::int AS n FROM programs WHERE user_id = $1`, [TRAINEE])).toBe(before)
    })

    it('the trainee sees the trainer on a pending request, and only the trainee can accept', async () => {
      as(TRAINEE)
      const { rels } = await routes()
      const listed = await (await rels.GET()).json()
      expect(listed.asTrainee).toHaveLength(1)
      expect(listed.asTrainee[0].otherUser.id).toBe(TRAINER)
      expect(listed.asTrainee[0].otherUser.displayName).toMatch(/^User /)

      const res = await act(rel.main, 'accept')
      expect(res.status).toBe(200)
      expect((await res.json()).relationship.status).toBe('accepted')
      // Accepting twice is a 404, not a second success.
      expect((await act(rel.main, 'accept')).status).toBe(404)
    })

    it('once accepted, the trainer sees who they train', async () => {
      as(TRAINER)
      const { rels } = await routes()
      const listed = await (await rels.GET()).json()
      expect(listed.asTrainer[0].status).toBe('accepted')
      expect(listed.asTrainer[0].otherUser.id).toBe(TRAINEE)
    })

    it('rejects an unknown action and a malformed id', async () => {
      as(TRAINEE)
      expect((await act(rel.main, 'promote')).status).toBe(400)
      expect((await act('not-a-uuid', 'accept')).status).toBe(400)
    })
  })

  // ── Who may assign ─────────────────────────────────────────────────────────

  describe('the guard: every way of not being the trainee\'s accepted trainer is the same 403', () => {
    const refused = async (who: string, target: string) => {
      as(who)
      const before = await count(`SELECT count(*)::int AS n FROM programs WHERE name = 'Coach Block A'`)
      const beforeStyles = await count(`SELECT count(*)::int AS n FROM progression_styles WHERE user_id = ANY($1::uuid[])`, [ALL])
      const res = await assign(target, program())
      expect(await count(`SELECT count(*)::int AS n FROM programs WHERE name = 'Coach Block A'`)).toBe(before)
      expect(await count(`SELECT count(*)::int AS n FROM progression_styles WHERE user_id = ANY($1::uuid[])`, [ALL])).toBe(beforeStyles)
      return res
    }

    it('a stranger with no relationship', async () => {
      const res = await refused(STRANGER, TRAINEE)
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Forbidden' })
    })

    it('an id that is nobody at all answers identically — the route is no oracle for other users\' ids', async () => {
      const res = await refused(STRANGER, NOBODY)
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Forbidden' })
    })

    it('an ADMIN with no relationship — isAdmin is not the trainer flag', async () => {
      await pool.query(`UPDATE users SET is_admin = true WHERE id = $1`, [STRANGER])
      try {
        expect((await refused(STRANGER, TRAINEE)).status).toBe(403)
      } finally {
        await pool.query(`UPDATE users SET is_admin = false WHERE id = $1`, [STRANGER])
      }
    })

    it('the TRAINEE, in the other direction — (A trains B) is not (B trains A)', async () => {
      expect((await refused(TRAINEE, TRAINER)).status).toBe(403)
    })

    it('yourself', async () => {
      expect((await refused(TRAINER, TRAINER)).status).toBe(403)
    })

    it('a pending relationship', async () => {
      await seedRel(TRAINER, PENDING, 'pending')
      expect((await refused(TRAINER, PENDING)).status).toBe(403)
    })

    it('a revoked relationship', async () => {
      await seedRel(TRAINER, REVOKED, 'revoked')
      expect((await refused(TRAINER, REVOKED)).status).toBe(403)
    })

    it('an accepted relationship whose trainee account is inactive', async () => {
      await seedRel(TRAINER, DORMANT, 'accepted')
      expect((await refused(TRAINER, DORMANT)).status).toBe(403)
    })

    it('reading what a trainer assigned is behind the same guard', async () => {
      as(STRANGER)
      expect((await listAssigned(TRAINEE)).status).toBe(403)
      as(TRAINER)
      expect((await listAssigned(PENDING)).status).toBe(403)
    })

    it('a malformed trainee id is a 400, not a driver error', async () => {
      as(TRAINER)
      expect((await assign('not-a-uuid', program())).status).toBe(400)
    })

    it('the guard runs before the body is read: a non-trainer learns nothing from validation', async () => {
      as(STRANGER)
      expect((await assign(TRAINEE, '{not json')).status).toBe(403)
      expect((await assign(TRAINEE, { program: { nonsense: true } })).status).toBe(403)
    })
  })

  // ── Assigning ──────────────────────────────────────────────────────────────

  describe('assigning a program to an accepted trainee', () => {
    let traineeActiveId: string

    beforeAll(async () => {
      // The trainee already has an ACTIVE program; assigning must not touch it.
      const { rows } = await pool.query(
        `INSERT INTO programs (user_id, name, is_active) VALUES ($1, 'My Own Block', true) RETURNING id`, [TRAINEE])
      traineeActiveId = rows[0].id
    })

    it('writes the program under the TRAINEE, inactive, and leaves their active program active', async () => {
      as(TRAINER)
      const res = await assign(TRAINEE, program())
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.program.userId).toBe(TRAINEE)

      const { rows } = await pool.query(`SELECT user_id, is_active, phase_mode FROM programs WHERE id = $1`, [body.program.id])
      expect(rows[0]).toEqual({ user_id: TRAINEE, is_active: false, phase_mode: 'manual' })
      expect(await count(`SELECT count(*)::int AS n FROM programs WHERE user_id = $1 AND id = $2 AND is_active`, [TRAINEE, traineeActiveId])).toBe(1)
      expect(await count(`SELECT count(*)::int AS n FROM programs WHERE user_id = $1`, [TRAINER])).toBe(0)
      expect(await count(`SELECT count(*)::int AS n FROM program_sessions WHERE program_id = $1`, [body.program.id])).toBe(2)
      expect(await count(
        `SELECT count(*)::int AS n FROM session_exercises se JOIN program_sessions ps ON ps.id = se.session_id WHERE ps.program_id = $1`,
        [body.program.id])).toBe(3)
      expect(await count(`SELECT count(*)::int AS n FROM trainer_program_assignments WHERE program_id = $1 AND relationship_id = $2`, [body.program.id, rel.main])).toBe(1)
    })

    it('refuses any key that could name an id, an owner or a switch the trainer does not hold', async () => {
      as(TRAINER)
      for (const extra of [
        { id: crypto.randomUUID() }, { userId: TRAINER }, { isActive: true }, { phaseSetId: crypto.randomUUID() },
        { phaseMode: 'ai_dynamic' }, { createdAt: '2020-01-01' }, { autoApplyPrescriptions: true },
        { schedule: { type: 'weekly', reminderEnabled: true } },
      ]) {
        const res = await assign(TRAINEE, program({ name: 'Should Not Exist', ...extra }))
        expect(res.status, JSON.stringify(extra)).toBe(400)
      }
      expect((await assign(TRAINEE, { ...program(), traineeId: STRANGER })).status).toBe(400)
      const withSessionId = program({ name: 'Should Not Exist', sessions: [{ id: crypto.randomUUID(), name: 'S', exercises: [] }] })
      expect((await assign(TRAINEE, withSessionId)).status).toBe(400)
      expect(await count(`SELECT count(*)::int AS n FROM programs WHERE name = 'Should Not Exist'`)).toBe(0)
    })

    it('a body that tries to set userId to the trainer does not change whose program it is', async () => {
      as(TRAINER)
      expect((await assign(TRAINEE, program({ name: 'Owned By Trainer?', userId: TRAINER }))).status).toBe(400)
      expect(await count(`SELECT count(*)::int AS n FROM programs WHERE name = 'Owned By Trainer?'`)).toBe(0)
    })

    it('mints every id itself, so a program cannot collide with or point into another account', async () => {
      as(TRAINER)
      const res = await assign(TRAINEE, program({ name: 'Fresh Ids' }))
      const { program: saved } = await res.json()
      const ids = [saved.id, ...saved.sessions.map((s: { id: string }) => s.id), ...saved.sessions.flatMap((s: { exercises: { id: string }[] }) => s.exercises.map(e => e.id))]
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('shows up in the trainee\'s own program list, and in their assigned-to-me with the trainer named', async () => {
      as(TRAINEE)
      const mine = await import('@/app/api/trainer/assigned-to-me/route')
      const { GET: listPrograms } = await import('@/app/api/workout-templates/route')
      const programs = (await (await listPrograms()).json()).programs as { name: string; isActive: boolean; userId: string }[]
      const got = programs.find(p => p.name === 'Coach Block A')
      expect(got).toMatchObject({ isActive: false, userId: TRAINEE })

      const { assignments } = await (await mine.GET()).json()
      const a = assignments.find((x: { name: string }) => x.name === 'Coach Block A')
      expect(a.trainer.id).toBe(TRAINER)
      expect(a.isActive).toBe(false)
    })

    it('the trainer lists only what they assigned — never the trainee\'s own programs', async () => {
      as(TRAINER)
      const res = await listAssigned(TRAINEE)
      expect(res.status).toBe(200)
      const names = (await res.json()).programs.map((p: { name: string }) => p.name)
      expect(names).toContain('Coach Block A')
      expect(names).not.toContain('My Own Block')
    })

    it('a name that clashes with one the trainee already has is a 409 and leaves nothing behind', async () => {
      as(TRAINER)
      const { rows: [style] } = await pool.query(
        `INSERT INTO progression_styles (user_id, name) VALUES ($1, 'Clash Probe') RETURNING id`, [TRAINER])
      const res = await assign(TRAINEE, program({
        name: 'My Own Block',
        sessions: [{ name: 'S', exercises: [{ exerciseName: 'Bench Press', styleId: style.id }] }],
      }))
      expect(res.status).toBe(409)
      expect(await count(`SELECT count(*)::int AS n FROM progression_styles WHERE user_id = $1 AND name = 'Clash Probe'`, [TRAINEE])).toBe(0)
      await pool.query(`DELETE FROM progression_styles WHERE id = $1`, [style.id])
    })

    it('remaps a schedule onto the new sessions and refuses an index that names none', async () => {
      as(TRAINER)
      const ok = await assign(TRAINEE, program({
        name: 'Scheduled',
        schedule: { type: 'weekly', days: [{ dayOfWeek: 1, sessionIndex: 0 }, { dayOfWeek: 3, sessionIndex: 1 }, { dayOfWeek: 5, sessionIndex: null }] },
      }))
      expect(ok.status).toBe(201)
      const { program: saved } = await ok.json()
      const { rows } = await pool.query(
        `SELECT sd.day_of_week, sd.session_id, ps.program_id
         FROM schedule_days sd JOIN schedules sc ON sc.id = sd.schedule_id
         LEFT JOIN program_sessions ps ON ps.id = sd.session_id
         WHERE sc.program_id = $1 ORDER BY sd.day_of_week`, [saved.id])
      expect(rows.map(r => r.day_of_week)).toEqual([1, 3, 5])
      expect(rows[0].program_id).toBe(saved.id)
      expect(rows[1].program_id).toBe(saved.id)
      expect(rows[2].session_id).toBeNull()
      const rem = await pool.query(`SELECT reminder_enabled FROM schedules WHERE program_id = $1`, [saved.id])
      expect(rem.rows[0].reminder_enabled).toBe(false)

      const bad = await assign(TRAINEE, program({ name: 'Bad Index', schedule: { type: 'weekly', days: [{ dayOfWeek: 1, sessionIndex: 7 }] } }))
      expect(bad.status).toBe(400)
    })
  })

  // ── Styles: copy-on-assign ─────────────────────────────────────────────────

  describe('progression styles are copied into the trainee\'s account (RV-42 twin avoided)', () => {
    let trainerStyle: string
    let strangerStyle: string
    let traineeStyle: string

    const styleOf = async (programId: string) => (await pool.query(
      `SELECT se.style_id FROM session_exercises se JOIN program_sessions ps ON ps.id = se.session_id WHERE ps.program_id = $1 AND se.style_id IS NOT NULL`,
      [programId])).rows[0]?.style_id as string | undefined

    beforeAll(async () => {
      const mk = async (user: string, name: string, sets: [number, number][]) => {
        const { rows: [st] } = await pool.query(`INSERT INTO progression_styles (user_id, name) VALUES ($1, $2) RETURNING id`, [user, name])
        for (const [i, [pct, reps]] of sets.entries()) {
          await pool.query(`INSERT INTO style_sets (style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES ($1, $2, $3, $4, 120, $5)`, [st.id, i + 1, pct, reps, i === 0])
        }
        return st.id as string
      }
      trainerStyle = await mk(TRAINER, 'Coach Ramp', [[70, 5], [80, 3], [90, 1]])
      strangerStyle = await mk(STRANGER, 'Stranger Ramp', [[60, 8]])
      traineeStyle = await mk(TRAINEE, 'Heavy Triples', [[85, 3], [85, 3]])
    })

    const withStyle = (name: string, styleId: string) => program({
      name, sessions: [{ name: 'S', exercises: [{ exerciseName: 'Bench Press', styleId }] }],
    })

    it('the program references a COPY the trainee owns, with the same sets', async () => {
      as(TRAINER)
      const res = await assign(TRAINEE, withStyle('Styled One', trainerStyle))
      expect(res.status).toBe(201)
      const copy = await styleOf((await res.json()).program.id)
      expect(copy).toBeTruthy()
      expect(copy).not.toBe(trainerStyle)
      const { rows: [row] } = await pool.query(`SELECT user_id, name FROM progression_styles WHERE id = $1`, [copy])
      expect(row).toEqual({ user_id: TRAINEE, name: 'Coach Ramp' })
      const sets = (await pool.query(`SELECT set_number, pct, reps, rest_sec, use_for_1rm FROM style_sets WHERE style_id = $1 ORDER BY set_number`, [copy])).rows
      expect(sets).toEqual([
        { set_number: 1, pct: 70, reps: 5, rest_sec: 120, use_for_1rm: true },
        { set_number: 2, pct: 80, reps: 3, rest_sec: 120, use_for_1rm: false },
        { set_number: 3, pct: 90, reps: 1, rest_sec: 120, use_for_1rm: false },
      ])
    })

    it('deleting the trainer\'s original leaves the trainee\'s program intact', async () => {
      as(TRAINER)
      const res = await assign(TRAINEE, withStyle('Styled Survives', trainerStyle))
      const programId = (await res.json()).program.id
      const copy = await styleOf(programId)
      await pool.query(`DELETE FROM progression_styles WHERE id = $1`, [trainerStyle])
      expect(await styleOf(programId)).toBe(copy)
      expect(await count(`SELECT count(*)::int AS n FROM style_sets WHERE style_id = $1`, [copy])).toBe(3)
      // put it back for the tests below
      const { rows: [st] } = await pool.query(`INSERT INTO progression_styles (user_id, name) VALUES ($1, 'Coach Ramp') RETURNING id`, [TRAINER])
      for (const [i, [pct, reps]] of [[70, 5], [80, 3], [90, 1]].entries()) {
        await pool.query(`INSERT INTO style_sets (style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES ($1, $2, $3, $4, 120, $5)`, [st.id, i + 1, pct, reps, i === 0])
      }
      trainerStyle = st.id
    })

    it('assigning the same style again reuses the identical copy instead of piling up duplicates', async () => {
      as(TRAINER)
      const a = await styleOf((await (await assign(TRAINEE, withStyle('Reuse A', trainerStyle))).json()).program.id)
      const b = await styleOf((await (await assign(TRAINEE, withStyle('Reuse B', trainerStyle))).json()).program.id)
      expect(a).toBe(b)
    })

    it('never overwrites the trainee\'s own style of the same name', async () => {
      // Earlier cases left copies in the trainee's account; clear them so the name is theirs alone.
      await pool.query(`DELETE FROM progression_styles WHERE user_id = $1 AND id <> $2`, [TRAINEE, traineeStyle])
      await pool.query(`UPDATE progression_styles SET name = 'Coach Ramp' WHERE id = $1`, [traineeStyle])
      const before = (await pool.query(`SELECT set_number, pct, reps FROM style_sets WHERE style_id = $1 ORDER BY set_number`, [traineeStyle])).rows
      try {
        as(TRAINER)
        const res = await assign(TRAINEE, withStyle('Clash Copy', trainerStyle))
        expect(res.status).toBe(201)
        const copy = await styleOf((await res.json()).program.id)
        expect(copy).not.toBe(traineeStyle)
        const { rows: [row] } = await pool.query(`SELECT name FROM progression_styles WHERE id = $1`, [copy])
        expect(row.name).toMatch(/^Coach Ramp \(from /)
        const after = (await pool.query(`SELECT set_number, pct, reps FROM style_sets WHERE style_id = $1 ORDER BY set_number`, [traineeStyle])).rows
        expect(after).toEqual(before)
      } finally {
        await pool.query(`UPDATE progression_styles SET name = 'Heavy Triples' WHERE id = $1`, [traineeStyle])
      }
    })

    it('refuses a style the trainer does not own — the stranger\'s, the trainee\'s, or one that does not exist — and writes nothing', async () => {
      as(TRAINER)
      const beforePrograms = await count(`SELECT count(*)::int AS n FROM programs WHERE user_id = $1`, [TRAINEE])
      const beforeStyles = await count(`SELECT count(*)::int AS n FROM progression_styles WHERE user_id = $1`, [TRAINEE])
      for (const id of [strangerStyle, traineeStyle, crypto.randomUUID()]) {
        const res = await assign(TRAINEE, withStyle('Borrowed Style', id))
        expect(res.status).toBe(400)
        expect((await res.json()).error).toBe('Invalid styleId')
      }
      expect(await count(`SELECT count(*)::int AS n FROM programs WHERE user_id = $1`, [TRAINEE])).toBe(beforePrograms)
      expect(await count(`SELECT count(*)::int AS n FROM progression_styles WHERE user_id = $1`, [TRAINEE])).toBe(beforeStyles)
      expect(await count(`SELECT count(*)::int AS n FROM session_exercises WHERE style_id = $1`, [strangerStyle])).toBe(0)
    })

    it('a malformed styleId is a 400 from the schema, not a driver error', async () => {
      as(TRAINER)
      expect((await assign(TRAINEE, withStyle('Malformed', 'not-a-uuid'))).status).toBe(400)
    })
  })

  // ── Revocation ─────────────────────────────────────────────────────────────

  describe('revocation', () => {
    it('either party can revoke; the trainer loses all access at once and the trainee keeps every program', async () => {
      as(TRAINER)
      const made = await assign(TRAINEE, program({ name: 'Survives Revocation' }))
      const programId = (await made.json()).program.id

      as(TRAINEE)
      const res = await act(rel.main, 'revoke')
      expect(res.status).toBe(200)
      expect((await res.json()).relationship.status).toBe('revoked')
      expect((await act(rel.main, 'revoke')).status).toBe(404)

      as(TRAINER)
      expect((await assign(TRAINEE, program({ name: 'After Revoke' }))).status).toBe(403)
      expect((await listAssigned(TRAINEE)).status).toBe(403)
      expect(await count(`SELECT count(*)::int AS n FROM programs WHERE name = 'After Revoke'`)).toBe(0)

      expect(await count(`SELECT count(*)::int AS n FROM programs WHERE id = $1 AND user_id = $2`, [programId, TRAINEE])).toBe(1)
      as(TRAINEE)
      const { mine } = await routes()
      const { assignments } = await (await mine.GET()).json()
      expect(assignments.map((a: { programId: string }) => a.programId)).toContain(programId)
    })

    it('asking again after a revocation starts over: pending, and no access until the trainee accepts', async () => {
      as(TRAINER)
      const { rels } = await routes()
      const res = await rels.POST(post('http://localhost/x', { emailOrCode: 'TST-TRNE' }))
      expect(res.status).toBe(201)
      expect((await res.json()).relationship.status).toBe('pending')
      expect((await assign(TRAINEE, program({ name: 'Too Early' }))).status).toBe(403)
      as(TRAINEE)
      expect((await act(rel.main, 'accept')).status).toBe(200)
      as(TRAINER)
      expect((await assign(TRAINEE, program({ name: 'Back In Business' }))).status).toBe(201)
    })

    it('the trainer can revoke too', async () => {
      as(TRAINER)
      expect((await act(rel.main, 'revoke')).status).toBe(200)
      expect((await assign(TRAINEE, program({ name: 'Revoked By Trainer' }))).status).toBe(403)
    })

    it('a trainer revoking their own pending request learns nothing about the target (RV-195)', async () => {
      await pool.query(`DELETE FROM trainer_relationships WHERE trainer_id = $1 AND trainee_id = $2`, [TRAINER, STRANGER])
      as(TRAINER)
      const { rels } = await routes()
      const made = await rels.POST(post('http://localhost/x', { emailOrCode: 'TST-STRG' }))
      expect(made.status).toBe(201)
      const created = (await made.json()).relationship
      expect(created.traineeId).toBeNull()
      expect(created.otherUser).toEqual({ id: null, displayName: 'TST-STRG', name: null, avatar: null })

      const res = await act(created.id, 'revoke')
      expect(res.status).toBe(200)
      const { relationship } = await res.json()
      expect(relationship.status).toBe('revoked')
      expect(relationship.traineeId).toBeNull()
      expect(relationship.otherUser).toEqual({ id: null, displayName: null, name: null, avatar: null })
      expect(JSON.stringify(relationship)).not.toContain(STRANGER)
      await pool.query(`DELETE FROM trainer_relationships WHERE id = $1`, [created.id])
    })

    it('a trainer revoking an accepted relationship still sees who it was with', async () => {
      await pool.query(`UPDATE trainer_relationships SET status = 'accepted' WHERE id = $1`, [rel.main])
      as(TRAINER)
      const { relationship } = await (await act(rel.main, 'revoke')).json()
      expect(relationship.traineeId).toBe(TRAINEE)
      expect(relationship.otherUser.id).toBe(TRAINEE)
    })

    it('a trainee deleting an assigned program removes its provenance row and nothing else', async () => {
      await pool.query(`UPDATE trainer_relationships SET status = 'accepted' WHERE id = $1`, [rel.main])
      as(TRAINER)
      const programId = (await (await assign(TRAINEE, program({ name: 'Deleted By Trainee' }))).json()).program.id
      await pool.query(`DELETE FROM programs WHERE id = $1`, [programId])
      expect(await count(`SELECT count(*)::int AS n FROM trainer_program_assignments WHERE program_id = $1`, [programId])).toBe(0)
      expect(await count(`SELECT count(*)::int AS n FROM trainer_relationships WHERE id = $1`, [rel.main])).toBe(1)
    })
  })

  // ── The edges every route shares ───────────────────────────────────────────

  describe('every route: unauthenticated is 401, rate-limited is 429', () => {
    const call = async (which: string) => {
      const { rels, relId, progs, mine } = await routes()
      const p = { params: Promise.resolve({ traineeId: TRAINEE }) }
      switch (which) {
        case 'rels.GET': return rels.GET()
        case 'rels.POST': return rels.POST(post('http://localhost/x', { emailOrCode: 'TST-STRG' }))
        case 'relId.PATCH': return relId.PATCH(post('http://localhost/x', { action: 'revoke' }), { params: Promise.resolve({ id: rel.main }) })
        case 'progs.GET': return progs.GET(new Request('http://localhost/x'), p)
        case 'progs.POST': return progs.POST(post('http://localhost/x', program()), p)
        default: return mine.GET()
      }
    }
    const all = ['rels.GET', 'rels.POST', 'relId.PATCH', 'progs.GET', 'progs.POST', 'mine.GET']

    it.each(all)('%s → 401 with no session', async which => {
      as(null)
      expect((await call(which)).status).toBe(401)
    })

    it.each(all)('%s → 429 once the limiter says no, before any work is done', async which => {
      as(TRAINER)
      state.limitOk = false
      expect((await call(which)).status).toBe(429)
    })
  })

  it('an oversized body is refused with 413 once the guard has passed', async () => {
    await pool.query(`UPDATE trainer_relationships SET status = 'accepted' WHERE id = $1`, [rel.main])
    as(TRAINER)
    const huge = JSON.stringify(program({ name: 'x'.repeat(300 * 1024) }))
    expect((await assign(TRAINEE, huge)).status).toBe(413)
  })
})
