import { eq, and, or, ne, inArray, asc, desc, sql, isNull } from 'drizzle-orm'
import { NotFoundError, UserFacingError } from '@trainingai/shared/errors'
import { normalizeEmail } from '@trainingai/shared/validation/email'
import type { getDb } from '../client'
import * as s from '../schema'
import type { Program, StyleSet } from '@trainingai/shared/types'
import type {
  TrainerRelationship, TrainerRelationships, TrainerCounterparty, TrainerRelationshipStatus,
  AssignedProgramSummary, ReceivedProgramAssignment,
} from '@trainingai/shared/types/trainer'
import type { AssignProgramBody } from '@trainingai/shared/validation/trainer'
import { UNCLASSIFIED_EXERCISE_ROLE } from '@trainingai/shared/workout/exercise-role'
import { progressionStyleIdsOwned, saveProgram } from './programs'

type Db = ReturnType<typeof getDb>

// #2300. The trainer role is a RELATIONSHIP (`trainer_relationships`): the trainer requests, the
// trainee accepts, either party revokes. `isAdmin` is never read here.
//
// The write that matters is `assignProgramToTrainee`, which calls the existing `saveProgram` with
// the TRAINEE's id. `saveProgram` is already parameterised by user id, so the only thing between
// one user and another's account is the check at the top of that function and the rules after it
// (see its comment).

/** One refusal, one wording: an unknown trainee, someone else's trainee, a pending or revoked
 *  relationship and an inactive account are indistinguishable to the caller, so the route is not a
 *  membership oracle for other users' ids. */
const forbidden = () => new UserFacingError('Forbidden', 403)

// ── Row mapper ────────────────────────────────────────────────────────────────

function counterparty(u: typeof s.users.$inferSelect | null): TrainerCounterparty {
  return u
    ? { id: u.id, displayName: u.displayName, name: u.name, avatar: u.avatar }
    : { id: null, displayName: null, name: null, avatar: null }
}

/**
 * Until a request is accepted, the person who SENT it learns nothing about the target beyond what
 * they typed — RV-195's rule for friend requests. Returning the target's name and id would let
 * anyone probe an email address or friend code and get a profile back. The ADDRESSEE still sees the
 * requester in full: the requester chose to reveal themselves, and the addressee needs that to
 * decide.
 */
function view(
  r: typeof s.trainerRelationships.$inferSelect,
  other: typeof s.users.$inferSelect,
  viewerId: string,
  typed: string | null = null,
): TrainerRelationship {
  const hidden = r.status === 'pending' && r.trainerId === viewerId
  return {
    id: r.id,
    trainerId: r.trainerId,
    traineeId: r.traineeId,
    status: r.status as TrainerRelationshipStatus,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    otherUser: hidden ? { ...counterparty(null), displayName: typed } : counterparty(other),
  }
}

// ── The handshake ─────────────────────────────────────────────────────────────

export async function requestTrainee(db: Db, trainerId: string, emailOrCode: string): Promise<TrainerRelationship> {
  const [target] = await db.select().from(s.users)
    // Stored emails are normalised (LA-61), so the typed one must be too, or a capital letter misses.
    .where(or(eq(sql`lower(${s.users.email})`, normalizeEmail(emailOrCode)), eq(s.users.friendCode, emailOrCode.toUpperCase())))
    .limit(1)
  if (!target) throw new NotFoundError('User')
  if (target.id === trainerId) throw new UserFacingError('You cannot train yourself', 400)

  const typed = emailOrCode.trim()
  const [created] = await db.insert(s.trainerRelationships)
    .values({ trainerId, traineeId: target.id, status: 'pending' })
    .onConflictDoNothing()
    .returning()
  if (created) return view(created, target, trainerId, typed)

  // The pair exists. A REVOKED one is asked again from the top, with the trainee's consent needed
  // afresh; a pending or accepted one is a duplicate.
  const [revived] = await db.update(s.trainerRelationships)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(and(
      eq(s.trainerRelationships.trainerId, trainerId),
      eq(s.trainerRelationships.traineeId, target.id),
      eq(s.trainerRelationships.status, 'revoked'),
    ))
    .returning()
  if (!revived) throw new UserFacingError('Trainer request already exists', 409)
  return view(revived, target, trainerId, typed)
}

/** Only the TRAINEE can accept: the update is scoped `trainee_id = userId`, so the trainer
 *  accepting their own request matches 0 rows and is a 404. */
export async function acceptTrainer(db: Db, relationshipId: string, userId: string): Promise<TrainerRelationship> {
  const [r] = await db.update(s.trainerRelationships)
    .set({ status: 'accepted', updatedAt: new Date() })
    .where(and(
      eq(s.trainerRelationships.id, relationshipId),
      eq(s.trainerRelationships.traineeId, userId),
      eq(s.trainerRelationships.status, 'pending'),
    ))
    .returning()
  if (!r) throw new NotFoundError('Request')
  const [other] = await db.select().from(s.users).where(eq(s.users.id, r.trainerId)).limit(1)
  return view(r, other, userId)
}

/** Either party, from pending or accepted. Programs already assigned stay with the trainee. */
export async function revokeTrainerRelationship(db: Db, relationshipId: string, userId: string): Promise<TrainerRelationship> {
  const [r] = await db.update(s.trainerRelationships)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(and(
      eq(s.trainerRelationships.id, relationshipId),
      or(eq(s.trainerRelationships.trainerId, userId), eq(s.trainerRelationships.traineeId, userId)),
      ne(s.trainerRelationships.status, 'revoked'),
    ))
    .returning()
  if (!r) throw new NotFoundError('Relationship')
  const otherId = r.trainerId === userId ? r.traineeId : r.trainerId
  const [other] = await db.select().from(s.users).where(eq(s.users.id, otherId)).limit(1)
  return view(r, other, userId)
}

export async function listTrainerRelationships(db: Db, userId: string): Promise<TrainerRelationships> {
  const [asTrainerRows, asTraineeRows] = await Promise.all([
    db.select({ r: s.trainerRelationships, u: s.users }).from(s.trainerRelationships)
      .innerJoin(s.users, eq(s.users.id, s.trainerRelationships.traineeId))
      .where(and(eq(s.trainerRelationships.trainerId, userId), ne(s.trainerRelationships.status, 'revoked')))
      .orderBy(desc(s.trainerRelationships.createdAt)),
    db.select({ r: s.trainerRelationships, u: s.users }).from(s.trainerRelationships)
      .innerJoin(s.users, eq(s.users.id, s.trainerRelationships.trainerId))
      .where(and(eq(s.trainerRelationships.traineeId, userId), ne(s.trainerRelationships.status, 'revoked')))
      .orderBy(desc(s.trainerRelationships.createdAt)),
  ])
  return {
    asTrainer: asTrainerRows.map(({ r, u }) => view(r, u, userId)),
    asTrainee: asTraineeRows.map(({ r, u }) => view(r, u, userId)),
  }
}

// ── The guard ─────────────────────────────────────────────────────────────────

/**
 * The id of the ACCEPTED relationship in which `trainerId` trains `traineeId`, or null.
 *
 * Read from the table on EVERY call and never from the session or the JWT — the same rule
 * `requireAdmin` follows, because a claim can be 30 days stale and a revocation must bite on the
 * next request. Both accounts must be active, and a user is never their own trainer.
 */
export async function acceptedTrainerRelationshipId(
  db: Db, trainerId: string, traineeId: string, opts: { lock?: boolean } = {},
): Promise<string | null> {
  if (!trainerId || !traineeId || trainerId === traineeId) return null
  const query = db.select({ id: s.trainerRelationships.id }).from(s.trainerRelationships)
    .where(and(
      eq(s.trainerRelationships.trainerId, trainerId),
      eq(s.trainerRelationships.traineeId, traineeId),
      eq(s.trainerRelationships.status, 'accepted'),
    ))
    .limit(1)
  // A share lock keeps a concurrent revoke from committing between this check and the write that
  // relies on it: the revoke's UPDATE waits for the assigning transaction to finish.
  const [rel] = opts.lock ? await query.for('share') : await query
  if (!rel) return null
  const active = await db.select({ id: s.users.id }).from(s.users)
    .where(and(inArray(s.users.id, [trainerId, traineeId]), eq(s.users.isActive, true)))
  return active.length === 2 ? rel.id : null
}

// ── Assigning a program ───────────────────────────────────────────────────────

function sameSets(a: StyleSet[], b: StyleSet[]): boolean {
  if (a.length !== b.length) return false
  const bySet = new Map(b.map(x => [x.setNumber, x]))
  return a.every(x => {
    const y = bySet.get(x.setNumber)
    return !!y && y.pct === x.pct && y.reps === x.reps && y.restSec === x.restSec && y.useFor1rm === x.useFor1rm
  })
}

/**
 * Copy the trainer's styles into the trainee's account (plan §2) and return trainerStyleId → the
 * trainee's copy. The trainee ends up owning every row their program depends on, so nothing
 * crosses accounts: no cross-account foreign key exists to guard, audit or break when the trainer
 * deletes a style or the relationship ends. (`session_exercises.style_id` is `ON DELETE SET NULL`,
 * so a reference into the trainer's library would be silent corruption of the trainee's program.)
 *
 * **A copy never overwrites the trainee's own style.** `saveProgressionStyle` upserts on
 * (user, name) and then deletes and re-inserts the sets, which would replace a trainee's "Heavy
 * Triples" with the trainer's. So the name is chosen first: the trainer's own name if it is free;
 * the trainee's existing style of that name if it is the identical prescription (so assigning twice
 * does not pile up duplicates); otherwise "<name> (from <trainer>)", then a counter.
 */
async function copyStylesToTrainee(
  db: Db, trainerId: string, traineeId: string, styleIds: string[],
): Promise<Map<string, string>> {
  const copies = new Map<string, string>()
  if (!styleIds.length) return copies

  const [trainerStyles, trainer, traineeStyles] = await Promise.all([
    db.select().from(s.progressionStyles)
      .where(and(eq(s.progressionStyles.userId, trainerId), inArray(s.progressionStyles.id, styleIds)))
      .orderBy(asc(s.progressionStyles.name)),
    db.select().from(s.users).where(eq(s.users.id, trainerId)).limit(1),
    db.select().from(s.progressionStyles).where(eq(s.progressionStyles.userId, traineeId)),
  ])
  // Ownership was verified by the caller; this is the same fact checked against the rows read.
  if (trainerStyles.length !== styleIds.length) throw new UserFacingError('Invalid styleId', 400)

  const allSets = await db.select().from(s.styleSets)
    .where(inArray(s.styleSets.styleId, [...trainerStyles.map(r => r.id), ...traineeStyles.map(r => r.id)]))
    .orderBy(asc(s.styleSets.setNumber))
  const setsOf = (id: string): StyleSet[] => allSets.filter(x => x.styleId === id).map(x => ({
    id: x.id, styleId: x.styleId, setNumber: x.setNumber, pct: x.pct, reps: x.reps, restSec: x.restSec, useFor1rm: x.useFor1rm,
  }))

  const taken = new Map(traineeStyles.map(r => [r.name, r.id]))
  const label = trainer[0]?.displayName ?? trainer[0]?.name ?? 'trainer'

  for (const src of trainerStyles) {
    const srcSets = setsOf(src.id)
    let chosen: string | null = null
    for (let n = 0; n < 50 && !chosen; n++) {
      const candidate = n === 0 ? src.name : n === 1 ? `${src.name} (from ${label})` : `${src.name} (from ${label} ${n})`
      const existingId = taken.get(candidate)
      if (!existingId) {
        const [row] = await db.insert(s.progressionStyles).values({ userId: traineeId, name: candidate }).returning({ id: s.progressionStyles.id })
        if (!row) throw new Error('trainer assign: style copy inserted no row')
        if (srcSets.length) {
          const inserted = await db.insert(s.styleSets).values(srcSets.map(x => ({
            styleId: row.id, setNumber: x.setNumber, pct: x.pct, reps: x.reps, restSec: x.restSec, useFor1rm: x.useFor1rm,
          }))).returning({ id: s.styleSets.id })
          if (inserted.length !== srcSets.length) throw new Error('trainer assign: style copy inserted the wrong number of sets')
        }
        taken.set(candidate, row.id)
        copies.set(src.id, row.id)
        chosen = candidate
      } else if (sameSets(setsOf(existingId), srcSets)) {
        copies.set(src.id, existingId)
        chosen = candidate
      }
    }
    if (!chosen) throw new UserFacingError('Could not copy that progression style', 409)
  }
  return copies
}

/**
 * Build a program in the TRAINEE's account and record who assigned it. One transaction: a failure
 * anywhere leaves no stray style copies and no half-built program.
 *
 * - The relationship is re-checked INSIDE the transaction under a share lock, whatever the route
 *   already did.
 * - Every id (program, sessions, exercises, schedule) is minted here. A trainer-supplied id could
 *   only ever point at someone else's row.
 * - The program arrives INACTIVE and `saveProgram` is given no `id`, so it can only insert: it
 *   cannot update, and so cannot overwrite, any existing program of the trainee's, and it does not
 *   touch their active one.
 */
export async function assignProgramToTrainee(
  db: Db, trainerId: string, traineeId: string, input: AssignProgramBody['program'],
): Promise<{ assignmentId: string; program: Program }> {
  return db.transaction(async tx => {
    const t = tx as unknown as Db
    const relationshipId = await acceptedTrainerRelationshipId(t, trainerId, traineeId, { lock: true })
    if (!relationshipId) throw forbidden()

    const styleIds = [...new Set(input.sessions.flatMap(sess => sess.exercises.map(ex => ex.styleId)).filter((v): v is string => !!v))]
    if (!(await progressionStyleIdsOwned(t, trainerId, styleIds))) throw new UserFacingError('Invalid styleId', 400)
    const copies = await copyStylesToTrainee(t, trainerId, traineeId, styleIds)

    const sessionIds = input.sessions.map(() => crypto.randomUUID())
    const now = new Date()
    const program: Program = {
      id: '', userId: traineeId, name: input.name, isActive: false,
      sessions: input.sessions.map((sess, i) => ({
        id: sessionIds[i], programId: '', name: sess.name, position: sess.position ?? i,
        icon: sess.icon ?? undefined,
        timeBudgetMinutes: sess.timeBudgetMinutes ?? 60,
        exercises: sess.exercises.map((ex, j) => ({
          id: crypto.randomUUID(), sessionId: sessionIds[i], exerciseName: ex.exerciseName,
          styleId: ex.styleId ? copies.get(ex.styleId) : undefined,
          muscleGroups: ex.muscleGroups ?? [],
          position: ex.position ?? j,
          exerciseRole: ex.exerciseRole ?? UNCLASSIFIED_EXERCISE_ROLE,
          supersetGroup: ex.supersetGroup ?? null,
        })),
      })),
      schedule: input.schedule ? {
        id: '', programId: '', type: input.schedule.type, restAfterN: input.schedule.restAfterN ?? undefined,
        days: (input.schedule.days ?? []).map(d => ({
          dayOfWeek: d.dayOfWeek,
          sessionId: d.sessionIndex === null ? undefined : sessionIds[d.sessionIndex],
        })),
        reminderEnabled: false, reminderTime: null,
      } : undefined,
      createdAt: now, updatedAt: now,
      phaseMode: 'manual',
      sessionsPerCycle: input.sessionsPerCycle ?? undefined,
      totalWeeks: input.totalWeeks ?? undefined,
      trainingGoal: input.trainingGoal ?? 'strength',
      autoApplyPrescriptions: false,
    }

    const saved = await saveProgram(t, traineeId, program)

    const [assignment] = await t.insert(s.trainerProgramAssignments)
      .values({ relationshipId, programId: saved.id })
      .returning({ id: s.trainerProgramAssignments.id })
    if (!assignment) throw new Error('trainer assign: assignment inserted no row')
    return { assignmentId: assignment.id, program: saved }
  })
}

// ── Reading assignments ───────────────────────────────────────────────────────

/** What this trainer assigned to this trainee: a summary, never the trainee's other data. */
export async function listProgramsAssignedBy(db: Db, trainerId: string, traineeId: string): Promise<AssignedProgramSummary[]> {
  const relationshipId = await acceptedTrainerRelationshipId(db, trainerId, traineeId)
  if (!relationshipId) throw forbidden()
  const rows = await db.select({
    assignmentId: s.trainerProgramAssignments.id,
    assignedAt: s.trainerProgramAssignments.createdAt,
    programId: s.programs.id, name: s.programs.name, isActive: s.programs.isActive,
  }).from(s.trainerProgramAssignments)
    .innerJoin(s.programs, eq(s.programs.id, s.trainerProgramAssignments.programId))
    // Belt and braces: the program must still be the trainee's.
    .where(and(eq(s.trainerProgramAssignments.relationshipId, relationshipId), eq(s.programs.userId, traineeId)))
    .orderBy(desc(s.trainerProgramAssignments.createdAt))
  if (!rows.length) return []
  const counts = await db.select({ programId: s.programSessions.programId, n: sql<number>`count(*)::int` })
    .from(s.programSessions)
    .where(and(inArray(s.programSessions.programId, rows.map(r => r.programId)), isNull(s.programSessions.deletedAt)))
    .groupBy(s.programSessions.programId)
  const countOf = new Map(counts.map(c => [c.programId, c.n]))
  return rows.map(r => ({
    assignmentId: r.assignmentId, programId: r.programId, name: r.name, isActive: r.isActive,
    sessionCount: countOf.get(r.programId) ?? 0, assignedAt: r.assignedAt.toISOString(),
  }))
}

/** The trainee's side: programs they were given, and by whom. Kept after a revocation: the
 *  program is theirs either way, and where it came from is still true. */
export async function listProgramsAssignedTo(db: Db, traineeId: string): Promise<ReceivedProgramAssignment[]> {
  const rows = await db.select({
    assignmentId: s.trainerProgramAssignments.id,
    assignedAt: s.trainerProgramAssignments.createdAt,
    programId: s.programs.id, name: s.programs.name, isActive: s.programs.isActive,
    trainer: s.users,
  }).from(s.trainerProgramAssignments)
    .innerJoin(s.trainerRelationships, eq(s.trainerRelationships.id, s.trainerProgramAssignments.relationshipId))
    .innerJoin(s.programs, eq(s.programs.id, s.trainerProgramAssignments.programId))
    .innerJoin(s.users, eq(s.users.id, s.trainerRelationships.trainerId))
    .where(and(eq(s.trainerRelationships.traineeId, traineeId), eq(s.programs.userId, traineeId)))
    .orderBy(desc(s.trainerProgramAssignments.createdAt))
  return rows.map(r => ({
    assignmentId: r.assignmentId, programId: r.programId, name: r.name, isActive: r.isActive,
    assignedAt: r.assignedAt.toISOString(), trainer: counterparty(r.trainer),
  }))
}
