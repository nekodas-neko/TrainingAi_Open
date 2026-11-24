/**
 * #3766: one phase for the whole program, counted in training weeks (the rule the owner signed on
 * 15 Nov, switch-over included). The model is mocked throughout: no live calls. Fixtures sit at local
 * midday unless the test is about a midnight edge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AiPrescription, PendingTransition, SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import { shiftDateStr, toAestDay } from '@trainingai/shared/date-utils'
import type { WorkoutRepository } from '@/lib/data/repository'
import {
  trainingWeekOf, programPhaseView, applyProgramPhaseCap, programMoveTarget, collectVotes,
  planSwitchOver, syncProgramPhase, isProgramAligned, programMoveMark, switchOverPendingTransition, PROGRAM_PHASE_CAP_WEEKS,
  type PhaseRow, type ProgramCompletion, type PhaseVote, type PhaseAnswer, type ProgramPhaseRepo,
} from '../program-phase'

const mocks = vi.hoisted(() => ({ signals: null as unknown, modelAnswer: null as unknown }))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async () => mocks.signals,
}))
vi.mock('@/lib/ai/instrument', () => ({
  // A copy: generation rewrites the answer in place.
  loggedGenerateObject: async () => ({ object: structuredClone(mocks.modelAnswer) }),
}))
const { generatePrescriptionForSession } = await import('../generate-prescription')

const TZ = 'Australia/Brisbane'
const DAY = 86_400_000
const at = (local: string) => new Date(`${local}+10:00`)
const row = (id: string, phase: PhaseRow['phase'], start: Date, sessionsInPhase = 0, over: Partial<PhaseRow> = {}): PhaseRow => ({
  programSessionId: id, phase, phaseStartedAt: start, sessionsInPhase, baselineComplete: true, pendingTransition: null, ...over,
})
const done = (id: string, local: string): ProgramCompletion => ({ programSessionId: id, completedAt: at(local) })
const stay = { phase: 'accumulation', phaseAction: 'stay', reasoning: 'Keep building.' } as AiPrescription

describe('training weeks', () => {
  it('a week is the local Monday to Sunday', () => {
    expect(trainingWeekOf(at('2026-11-22T23:30:00'), TZ)).toBe('2026-11-16') // Sunday night
    expect(trainingWeekOf(at('2026-11-23T00:10:00'), TZ)).toBe('2026-11-23') // Monday just after midnight
    // 00:10 Monday in Brisbane is still Sunday in UTC, which a UTC week key would file a week early.
    expect(at('2026-11-23T00:10:00').getUTCDay()).toBe(0)
  })

  it('across a daylight-saving change, the week still turns at local midnight', () => {
    // New York left daylight saving at 02:00 on Sun 1 Nov 2026 (UTC-4 → UTC-5).
    const NY = 'America/New_York'
    expect(trainingWeekOf(new Date('2026-11-02T04:59:00Z'), NY)).toBe('2026-10-26') // Sun 23:59 EST
    expect(trainingWeekOf(new Date('2026-11-02T05:01:00Z'), NY)).toBe('2026-11-02') // Mon 00:01 EST
    // A phase begun at Monday midnight EDT, sessions on each side of the change.
    const start = new Date('2026-10-26T04:00:00Z')
    const view = programPhaseView([row('a', 'accumulation', start)], [
      { programSessionId: 'a', completedAt: new Date('2026-10-27T16:00:00Z') }, // Tue 12:00 EDT
      { programSessionId: 'a', completedAt: new Date('2026-11-03T17:00:00Z') }, // Tue 12:00 EST
    ], NY, new Date('2026-11-10T17:00:00Z'))
    expect(view.trainingWeeksDone).toBe(2)
  })

  it('counts weeks with at least one completed session of ANY type, since the phase began, before this week', () => {
    const start = at('2026-11-02T00:00:00')
    const rows = [row('legs', 'accumulation', start), row('push', 'accumulation', start)]
    const completions = [
      done('legs', '2026-10-30T12:00:00'), // before the phase: not counted
      done('legs', '2026-11-03T12:00:00'), done('push', '2026-11-05T12:00:00'), // week of 2 Nov: one week
      // week of 9 Nov: nothing trained, so not a training week
      done('push', '2026-11-17T12:00:00'), // week of 16 Nov
      done('legs', '2026-11-24T12:00:00'), // this week
    ]
    const view = programPhaseView(rows, completions, TZ, at('2026-11-25T12:00:00'))
    expect(view.aligned).toBe(true)
    expect(view.trainingWeeksDone).toBe(2)
    expect(view.weekNumber).toBe(3)
    expect([...view.trainedThisWeek]).toEqual(['legs'])
  })

  it('a session type still in its baseline does not take part', () => {
    const start = at('2026-11-02T00:00:00')
    expect(isProgramAligned([
      row('legs', 'accumulation', start),
      row('new', 'baseline', at('2026-11-10T12:00:00'), 0, { baselineComplete: false }),
    ])).toBe(true)
    expect(isProgramAligned([row('legs', 'accumulation', start), row('pull', 'intensification', start)])).toBe(false)
  })
})

describe('a move\'s own week counts only when all its sessions are in the new phase', () => {
  // "A planned deload week ... All sessions that week are deloads."
  const view = (moveAt: Date, completions: ProgramCompletion[], now: Date) =>
    programPhaseView([row('a', 'deload', moveAt), row('b', 'deload', moveAt)], completions, TZ, now)

  it('a deload moved to on a Thursday, after a Monday session, runs the whole next week', () => {
    const moveAt = at('2026-11-19T12:00:00')
    const sessions = [
      done('a', '2026-11-16T12:00:00'), // Monday, before the move: still the old phase
      done('b', '2026-11-19T13:00:00'), done('a', '2026-11-21T12:00:00'), // Thu and Sat in the deload
      done('a', '2026-11-23T12:00:00'), done('b', '2026-11-26T12:00:00'), // the week of 23 Nov, all deload
    ]
    // Before the fix the Thu-Sun stub was a training week, so the cap fell due on Monday 23 Nov.
    expect(view(moveAt, sessions, at('2026-11-23T12:00:00')).trainingWeeksDone).toBe(0)
    expect(applyProgramPhaseCap({ ...stay, phase: 'deload' }, view(moveAt, sessions, at('2026-11-26T12:00:00'))).phaseAction).toBe('stay')
    const nextWeek = view(moveAt, sessions, at('2026-11-30T12:00:00'))
    expect(nextWeek.trainingWeeksDone).toBe(1)
    expect(applyProgramPhaseCap({ ...stay, phase: 'deload' }, nextWeek).phase).toBe('accumulation')
  })

  it('a move tapped at the week\'s first session counts that week', () => {
    const moveAt = at('2026-11-23T08:00:00')
    const sessions = [done('a', '2026-11-20T12:00:00'), done('a', '2026-11-23T12:00:00'), done('b', '2026-11-25T12:00:00')]
    expect(view(moveAt, sessions, at('2026-11-30T12:00:00')).trainingWeeksDone).toBe(1)
  })
})

describe('the caps, in training weeks', () => {
  // The phase starts at a Monday's local midnight (as the switch-over writes it); one session each
  // week on the Tuesday at midday; read on the Tuesday after the last.
  const viewAt = (phase: PhaseRow['phase'], weeks: number, pending: PhaseRow['pendingTransition'] = null) => {
    const start = at('2026-06-01T00:00:00')
    const tuesdayNoon = (week: number) => new Date(start.getTime() + (week * 7 + 1) * DAY + 12 * 3_600_000)
    const completions = Array.from({ length: weeks }, (_, i) => ({ programSessionId: 'a', completedAt: tuesdayNoon(i) }))
    return programPhaseView([row('a', phase, start, weeks, { pendingTransition: pending })], completions, TZ, tuesdayNoon(weeks))
  }

  it('matches the signed numbers', () => {
    expect(PROGRAM_PHASE_CAP_WEEKS).toEqual({ accumulation: 6, intensification: 5, realisation: 2, deload: 1 })
  })

  it.each([
    ['accumulation', 6, 'intensification'],
    ['intensification', 5, 'realisation'],
    ['realisation', 2, 'deload'],
    ['deload', 1, 'accumulation'],
  ] as const)('%s: a stay at %i weeks becomes the program\'s move to %s, and not a week before', (phase, cap, next) => {
    expect(applyProgramPhaseCap({ ...stay, phase }, viewAt(phase, cap - 1)).phaseAction).toBe('stay')
    const out = applyProgramPhaseCap({ ...stay, phase }, viewAt(phase, cap))
    expect(out.phaseAction).toBe('transition_recommended')
    expect(out.phase).toBe(next)
    expect(out.reasoning).toContain('training week')
  })

  it('leaves a recovery action alone past the cap', () => {
    const p = { ...stay, phaseAction: 'rest_day_recommended' } as AiPrescription
    expect(applyProgramPhaseCap(p, viewAt('accumulation', 9))).toBe(p)
  })

  it('the switch-over\'s scheduled move ends its accumulation block at 3 weeks', () => {
    const pending = { newPhase: 'intensification' as const, reasoning: 'x', urgency: 'normal' as const, afterTrainingWeeks: 3 }
    expect(viewAt('accumulation', 3, pending).capWeeks).toBe(3)
    expect(applyProgramPhaseCap(stay, viewAt('accumulation', 2, pending)).phaseAction).toBe('stay')
    expect(applyProgramPhaseCap(stay, viewAt('accumulation', 3, pending)).phase).toBe('intensification')
  })

  it('a later move\'s mark keeps the standard cap', () => {
    expect(viewAt('accumulation', 3, programMoveMark('accumulation')).capWeeks).toBe(6)
  })
})

describe('the early move: half of this week\'s session types, none asking to stay for recovery', () => {
  const v = (id: string, phaseAction: string, phase = 'intensification'): PhaseVote => ({ programSessionId: id, phase, phaseAction })

  it('one type alone never moves the program', () => {
    expect(programMoveTarget([v('a', 'transition_recommended')], 'accumulation')).toBeNull()
    expect(programMoveTarget([v('a', 'transition_recommended'), v('b', 'stay')], 'accumulation')).toBeNull()
  })

  it('two of three, and two of four, move it; two of five do not', () => {
    expect(programMoveTarget([v('a', 'transition_recommended'), v('b', 'transition_recommended'), v('c', 'stay')], 'accumulation')).toBe('intensification')
    expect(programMoveTarget([v('a', 'transition_recommended'), v('b', 'transition_recommended'), v('c', 'stay'), v('d', 'none')], 'accumulation')).toBe('intensification')
    expect(programMoveTarget([v('a', 'transition_recommended'), v('b', 'transition_recommended'), v('c', 'stay'), v('d', 'stay'), v('e', 'stay')], 'accumulation')).toBeNull()
  })

  it('a deload or rest-day answer holds the program; a session swap counts without agreeing', () => {
    for (const recovery of ['deload_recommended', 'rest_day_recommended']) {
      expect(programMoveTarget([v('a', 'transition_recommended'), v('b', 'transition_recommended'), v('c', recovery)], 'accumulation')).toBeNull()
    }
    const swap = [v('a', 'transition_recommended'), v('b', 'transition_recommended'), v('c', 'session_swap_recommended', 'accumulation')]
    expect(programMoveTarget(swap, 'accumulation')).toBe('intensification')
    expect(programMoveTarget([...swap, v('d', 'session_swap_recommended', 'accumulation'), v('e', 'stay')], 'accumulation')).toBeNull()
  })

  it('agreement is on the SAME move', () => {
    expect(programMoveTarget([v('a', 'transition_recommended'), v('b', 'transition_recommended', 'realisation')], 'accumulation')).toBeNull()
  })

  describe('who votes, and with which answer', () => {
    const start = at('2026-11-16T00:00:00')
    const rows = ['a', 'b', 'c'].map(id => row(id, 'accumulation', start))
    const answer = (id: string, local: string, phaseAction = 'transition_recommended'): PhaseAnswer =>
      ({ programSessionId: id, phase: 'intensification', phaseAction, createdAt: at(local) })
    const view = programPhaseView(rows, [done('b', '2026-11-17T12:00:00'), done('c', '2026-11-18T12:00:00')], TZ, at('2026-11-19T12:00:00'))

    it('only the types trained this week vote: the type being planned waits until it has trained', () => {
      const votes = collectVotes(view, [answer('a', '2026-11-19T11:00:00'), answer('b', '2026-11-17T08:00:00')])
      expect(votes.map(x => x.programSessionId)).toEqual(['b', 'c'])
    })

    it('a trained type votes with its answer for the session it trained, not a later one', () => {
      const votes = collectVotes(view, [
        answer('b', '2026-11-17T08:00:00', 'stay'), // the plan b trained on
        answer('b', '2026-11-17T13:00:00'), // generated after b's session, for next week
        answer('c', '2026-11-15T12:00:00'), // before the phase began: not this phase's answer
      ])
      expect(votes.map(x => x.phaseAction)).toEqual(['stay', 'none'])
    })

    it('a trained type with no recorded answer counts in the vote but never agrees', () => {
      const votes = collectVotes(view, [answer('b', '2026-11-17T08:00:00')])
      expect(votes.map(x => x.phaseAction)).toEqual(['transition_recommended', 'none'])
      expect(programMoveTarget(votes, 'accumulation')).toBeNull()
    })
  })
})

// ── The switch-over ─────────────────────────────────────────────────────────────────────────

/** An in-memory program behaving like the Postgres slice: counts are reconciled from completions,
 *  writes follow `setProgramPhase` / `setProgramPendingTransition` / `realignProgramPhase` /
 *  `advancePhase`. */
function memoryProgram(initial: PhaseRow[], completions: ProgramCompletion[]) {
  let rows = initial.map(r => ({ ...r, prescription: null, prescriptionStatus: 'none' })) as unknown as SessionPeriodization[]
  const writes: string[] = []
  const phased = (r: SessionPeriodization) => r.baselineComplete && r.phase !== 'baseline'
  /** Runs once, between the caller's read and the next lock: a write racing the sync. */
  let race: (() => void) | null = null
  const lock = () => { const r = race; race = null; r?.() }
  const repo: ProgramPhaseRepo = {
    reconcileSessionsInPhase: async () => {
      rows = rows.map(r => ({
        ...r,
        sessionsInPhase: completions.filter(c => c.programSessionId === r.programSessionId && c.completedAt >= r.phaseStartedAt).length,
      }))
    },
    listSessionPeriodizationForProgram: async () => rows.map(r => ({ ...r })),
    listProgramCompletions: async (_u, _p, since) => completions.filter(c => c.completedAt >= since),
    setProgramPhase: async (_u, _p, phase, startedAt, pending, opts) => {
      lock()
      if (opts?.expect === 'switch-over' && rows.some(r => phased(r) && r.pendingTransition?.programPhase)) return false
      writes.push(`switch ${phase} ${startedAt.toISOString()}`)
      const mark = programMoveMark(phase, pending)
      rows = rows.map(r => (phased(r) ? { ...r, phase, phaseStartedAt: startedAt, pendingTransition: mark } : r))
      return true
    },
    setProgramPendingTransition: async (_u, _p, decide) => {
      lock()
      const pending = decide(rows)
      if (pending == null) return
      writes.push(`pending ${pending.programPhase ? 'mark' : `wait ${pending.switchOverOn ?? '-'}`}`)
      rows = rows.map(r => (phased(r) ? { ...r, pendingTransition: pending } : r))
    },
    realignProgramPhase: async (_u, _p, decide) => {
      lock()
      const target = decide(rows)
      if (target == null) return
      writes.push(`realign ${target.phase} ${target.phaseStartedAt.toISOString()}`)
      rows = rows.map(r => (phased(r)
        ? { ...r, phase: target.phase, phaseStartedAt: target.phaseStartedAt, pendingTransition: target.pendingTransition }
        : r))
    },
    voidSessionPrescription: async (_u, id) => { writes.push(`void ${id}`) },
  }
  return {
    repo,
    writes,
    rows: () => rows,
    /** The per-type move (`advancePhase`): keeps the waiting stamp, clears anything else. */
    typeMove(id: string, phase: SessionPeriodization['phase'], when: Date) {
      rows = rows.map(r => (r.programSessionId === id
        ? { ...r, phase, phaseStartedAt: when, pendingTransition: r.pendingTransition?.switchOverPending ? r.pendingTransition : null }
        : r))
    },
    complete(id: string, local: string) { completions.push(done(id, local)) },
    /** A write that lands after the sync's read and before its lock. */
    raceNextLock(fn: () => void) { race = fn },
    /** The program move (`setProgramPhase`), as another session's tap. */
    programMove(phase: SessionPeriodization['phase'], when: Date, pending: PendingTransition | null = null) {
      const mark = programMoveMark(phase, pending)
      rows = rows.map(r => (phased(r) ? { ...r, phase, phaseStartedAt: when, pendingTransition: mark } : r))
    },
  }
}

describe('the switch-over (the owner\'s program, 14 Nov)', () => {
  // Legs deload (2 done), Lower deload (1 done), Pull intensification (5), Push accumulation (3),
  // Upper accumulation since 10 Sep (8).
  const rows = (lowerDone: number): PhaseRow[] => [
    row('legs', 'deload', at('2026-10-29T18:00:00'), 2),
    row('lower', 'deload', at('2026-11-06T18:00:00'), lowerDone),
    row('pull', 'intensification', at('2026-10-08T18:00:00'), 5),
    row('push', 'accumulation', at('2026-10-24T18:00:00'), 3),
    row('upper', 'accumulation', at('2026-09-10T18:00:00'), 8),
  ]
  const history = () => [
    done('legs', '2026-11-02T18:00:00'), done('legs', '2026-11-09T18:00:00'),
    done('lower', '2026-11-11T18:00:00'),
  ]

  it('waits while Lower is still in its deload', () => {
    expect(planSwitchOver(rows(1), history(), TZ, at('2026-11-16T10:00:00')))
      .toMatchObject({ kind: 'waiting', reason: 'deload_in_progress' })
  })

  it('once Lower finishes it (Wed 18 Nov), every type starts accumulation week 1 on Monday 23 Nov', () => {
    const after = [...history(), done('lower', '2026-11-18T18:00:00')]
    expect(planSwitchOver(rows(2), after, TZ, at('2026-11-20T10:00:00')))
      .toMatchObject({ kind: 'waiting', reason: 'before_start', startDay: '2026-11-23', stamp: { switchOverPending: true, switchOverOn: '2026-11-23' } })
    const plan = planSwitchOver(rows(2), after, TZ, at('2026-11-23T06:00:00'))
    expect(plan).toEqual({ kind: 'switch', startDay: '2026-11-23', startsAt: at('2026-11-23T00:00:00') })
  })

  it('never starts before the first Monday after the sign-off', () => {
    const plan = planSwitchOver([row('a', 'accumulation', at('2026-10-01T12:00:00')), row('b', 'intensification', at('2026-10-05T12:00:00'))], [], TZ, at('2026-11-15T10:00:00'))
    expect(plan).toMatchObject({ kind: 'waiting', reason: 'before_start', startDay: '2026-11-16' })
  })

  it('the last deload finishing on Sunday 23:59 switches the next day; at Monday 00:01, a week later', () => {
    const lastAt = (local: string) => planSwitchOver(rows(2), [...history(), done('lower', local)], TZ, at('2026-12-07T12:00:00'))
    expect(lastAt('2026-11-22T23:59:00')).toMatchObject({ kind: 'switch', startDay: '2026-11-23' })
    expect(lastAt('2026-11-23T00:01:00')).toMatchObject({ kind: 'switch', startDay: '2026-11-30' })
  })

  it('in a daylight-saving timezone the switch starts at that Monday\'s own local midnight', () => {
    const NY = 'America/New_York'
    const nyRows = [row('a', 'deload', new Date('2026-10-20T16:00:00Z'), 2), row('b', 'accumulation', new Date('2026-09-01T16:00:00Z'))]
    const finish = (iso: string) => planSwitchOver(nyRows, [
      { programSessionId: 'a', completedAt: new Date('2026-10-22T16:00:00Z') }, { programSessionId: 'a', completedAt: new Date(iso) },
    ], NY, new Date('2026-11-12T17:00:00Z'), '2026-10-26')
    // Sun 1 Nov 23:59 EST, the day daylight saving ended: Monday 2 Nov, midnight EST (05:00 UTC).
    expect(finish('2026-11-02T04:59:00Z')).toEqual({ kind: 'switch', startDay: '2026-11-02', startsAt: new Date('2026-11-02T05:00:00Z') })
    // Mon 2 Nov 00:01 EST: the Monday after, 9 Nov.
    expect(finish('2026-11-02T05:01:00Z')).toEqual({ kind: 'switch', startDay: '2026-11-09', startsAt: new Date('2026-11-09T05:00:00Z') })
  })

  it('while it waits, an old per-type move offer is voided; a deload\'s way out is kept', async () => {
    const offer = (phase: string) => ({ prescriptionStatus: 'pending', prescription: { phase, phaseAction: 'transition_recommended' } })
    const stored = rows(1).map(r => ({
      ...r,
      ...(r.programSessionId === 'upper' && offer('intensification')),
      ...(r.programSessionId === 'pull' && offer('realisation')),
      ...(r.programSessionId === 'legs' && offer('accumulation')),
    })) as unknown as SessionPeriodization[]
    const voided: string[] = []
    const stamps: PendingTransition[] = []
    const repo: ProgramPhaseRepo = {
      reconcileSessionsInPhase: async () => undefined,
      listSessionPeriodizationForProgram: async () => stored,
      listProgramCompletions: async () => history(),
      setProgramPhase: async () => { throw new Error('no switch while Lower is in its deload') },
      setProgramPendingTransition: async (_u, _p, decide) => { const pending = decide(stored); if (pending) stamps.push(pending) },
      realignProgramPhase: async () => { throw new Error('a waiting program is not re-aligned') },
      voidSessionPrescription: async (_u: string, id: string) => { voided.push(id) },
    }
    const view = await syncProgramPhase(repo, 'u', 'p', TZ, at('2026-11-16T10:00:00'))
    expect(view.aligned).toBe(false)
    expect(voided.sort()).toEqual(['pull', 'upper'])
    // Stamped as waiting, with the Monday Legs' finished deload already gives.
    expect(stamps).toEqual([expect.objectContaining({ switchOverPending: true, switchOverOn: '2026-11-16' })])
  })

  it('writes one phase, one start and the 3-week block on every row, once', async () => {
    const p = memoryProgram(rows(2), [...history(), done('lower', '2026-11-18T18:00:00')])
    const view = await syncProgramPhase(p.repo, 'u', 'p', TZ, at('2026-11-23T06:00:00'))
    expect(p.writes.filter(w => w.startsWith('switch'))).toEqual([`switch accumulation ${at('2026-11-23T00:00:00').toISOString()}`])
    expect(p.rows().every(r => r.pendingTransition?.afterTrainingWeeks === 3 && r.pendingTransition.programPhase)).toBe(true)
    expect(view).toMatchObject({ aligned: true, phase: 'accumulation', weekNumber: 1, capWeeks: 3 })
    const before = p.writes.length
    await syncProgramPhase(p.repo, 'u', 'p', TZ, at('2026-11-24T06:00:00'))
    expect(p.writes).toHaveLength(before)
  })

  it('keeps the switch Monday when Lower leaves its deload early, Thu to Sun (finding 1)', async () => {
    // Lower finishes its deload on Wed 18 Nov, the program is read on Thu 19 (which dates the
    // switch-over to Mon 23), then Lower takes the per-type "Move to accumulation" the same day.
    const p = memoryProgram(rows(1), history())
    p.complete('lower', '2026-11-18T18:00:00')
    await syncProgramPhase(p.repo, 'u', 'p', TZ, at('2026-11-19T12:00:00'))
    p.typeMove('lower', 'accumulation', at('2026-11-19T12:30:00'))
    for (const day of ['2026-11-20', '2026-11-21', '2026-11-22']) {
      const view = await syncProgramPhase(p.repo, 'u', 'p', TZ, at(`${day}T12:00:00`))
      // Before the fix, with no type left in a deload, the switch fell back to Mon 16 Nov and ran
      // here, mid-week, backdated.
      expect(view.aligned).toBe(false)
    }
    expect(p.writes.some(w => w.startsWith('switch'))).toBe(false)
    const view = await syncProgramPhase(p.repo, 'u', 'p', TZ, at('2026-11-23T06:00:00'))
    expect(p.writes.filter(w => w.startsWith('switch'))).toEqual([`switch accumulation ${at('2026-11-23T00:00:00').toISOString()}`])
    expect(view).toMatchObject({ aligned: true, phase: 'accumulation', capWeeks: 3 })
  })

  describe('whenever the release ships, the program gets the signed switch-over (review 2, A)', () => {
    // Until this code runs, `main`'s per-type moves keep landing: Upper to intensification on Mon 16,
    // Pull to realisation on Thu 19, Legs out of its deload on Sat 21, Lower out of its deload on Wed
    // 25 (its deload done on Wed 18). Push never moves. After the release, the program waits and
    // only a deload's own way out is still offered.
    const moves: Array<[string, SessionPeriodization['phase'], string]> = [
      ['upper', 'intensification', '2026-11-16T12:00:00'],
      ['pull', 'realisation', '2026-11-19T12:00:00'],
      ['legs', 'accumulation', '2026-11-21T12:00:00'],
      ['lower', 'accumulation', '2026-11-25T19:00:00'],
    ]
    const ship = async (shipDay: string) => {
      const p = memoryProgram(rows(1), [...history(), done('lower', '2026-11-18T18:00:00')])
      const shipAt = at(`${shipDay}T12:00:00`)
      for (const [id, phase, when] of moves) {
        if (at(when) < shipAt) p.typeMove(id, phase, at(when))
      }
      const views = []
      for (let day = shipDay; day <= '2026-11-30'; day = shiftDateStr(day, 1)) {
        for (const [id, phase, when] of moves) {
          const w = at(when)
          const row = p.rows().find(r => r.programSessionId === id)!
          // After the release, only a type still in its deload takes its own move.
          if (w >= shipAt && toAestDay(w, TZ) === day && row.phase === 'deload' && !row.pendingTransition?.programPhase) p.typeMove(id, phase, w)
        }
        views.push(await syncProgramPhase(p.repo, 'u', 'p', TZ, at(`${day}T${day === shipDay ? '12:30' : '06:00'}:00`)))
      }
      return { p, views }
    }

    for (const shipDay of ['2026-11-18', '2026-11-22', '2026-11-26']) {
      it(`shipped on ${shipDay}: every type starts accumulation on Mon 23 Nov, with the 3-week block`, async () => {
        const { p, views } = await ship(shipDay)
        expect(p.writes.filter(w => w.startsWith('realign'))).toEqual([])
        expect(p.writes.filter(w => w.startsWith('switch'))).toEqual([`switch accumulation ${at('2026-11-23T00:00:00').toISOString()}`])
        expect(p.rows().every(r => r.phase === 'accumulation' && r.phaseStartedAt.getTime() === at('2026-11-23T00:00:00').getTime()
          && r.pendingTransition?.afterTrainingWeeks === 3 && r.pendingTransition.programPhase)).toBe(true)
        expect(views.at(-1)).toMatchObject({ aligned: true, phase: 'accumulation', capWeeks: 3 })
      })
    }

    it('shipped on 26 Nov, the program is in week 1 of that block, not backdated to 16 Nov', async () => {
      const { views } = await ship('2026-11-26')
      expect(views[0]).toMatchObject({ aligned: true, phase: 'accumulation', weekNumber: 1, capWeeks: 3 })
    })
  })
})

describe('after the switch-over, rows that come to disagree are re-aligned, never switched again (finding 2)', () => {
  const switchedAt = at('2026-11-23T00:00:00')
  const block = programMoveMark('accumulation', { newPhase: 'intensification', reasoning: 'x', urgency: 'normal', afterTrainingWeeks: 3 })

  it('a type left behind by a racing read joins the program\'s latest move', async () => {
    const movedAt = at('2026-12-14T12:00:00')
    const p = memoryProgram([
      row('legs', 'intensification', movedAt, 0, { pendingTransition: programMoveMark('intensification') }),
      row('pull', 'intensification', movedAt, 0, { pendingTransition: programMoveMark('intensification') }),
      // Joined from a read taken just before the move: the old phase, start and block.
      row('push', 'accumulation', switchedAt, 0, { pendingTransition: block }),
    ], [])
    const view = await syncProgramPhase(p.repo, 'u', 'p', TZ, at('2026-12-15T12:00:00'))
    expect(p.writes).toEqual([`realign intensification ${movedAt.toISOString()}`])
    expect(view).toMatchObject({ aligned: true, phase: 'intensification' })
  })

  it('a per-type move on a program that was not active is undone when it is read again', async () => {
    const p = memoryProgram([
      row('legs', 'accumulation', switchedAt, 0, { pendingTransition: block }),
      row('pull', 'accumulation', switchedAt, 0, { pendingTransition: block }),
    ], [])
    p.typeMove('pull', 'intensification', at('2026-11-25T12:00:00')) // clears its mark
    const view = await syncProgramPhase(p.repo, 'u', 'p', TZ, at('2026-11-26T12:00:00'))
    expect(p.writes).toEqual([`realign accumulation ${switchedAt.toISOString()}`])
    expect(view).toMatchObject({ aligned: true, phase: 'accumulation', capWeeks: 3 })
  })

  it('two baselines finishing together on a new program align to one start, with no backdated block', async () => {
    const first = at('2026-12-01T12:00:00')
    const p = memoryProgram([
      row('a', 'accumulation', first, 0, { pendingTransition: programMoveMark('accumulation') }),
      row('b', 'accumulation', new Date(first.getTime() + 3), 0, { pendingTransition: programMoveMark('accumulation') }),
    ], [])
    await syncProgramPhase(p.repo, 'u', 'p', TZ, at('2026-12-02T12:00:00'))
    expect(p.writes).toEqual([`realign accumulation ${new Date(first.getTime() + 3).toISOString()}`])
  })

  it('an unmarked program whose rows all started after the rule shipped is re-aligned, not switched', async () => {
    const p = memoryProgram([
      row('a', 'accumulation', at('2026-12-01T12:00:00')),
      row('b', 'accumulation', at('2026-12-01T12:00:01')),
    ], [])
    await syncProgramPhase(p.repo, 'u', 'p', TZ, at('2026-12-02T12:00:00'))
    expect(p.writes).toEqual([`realign accumulation ${at('2026-12-01T12:00:01').toISOString()}`])
  })

  it('a program that already shared one phase is marked on its first read, so a later drift is re-aligned', async () => {
    const since = at('2026-10-05T12:00:00')
    const p = memoryProgram([row('a', 'intensification', since), row('b', 'intensification', since)], [])
    await syncProgramPhase(p.repo, 'u', 'p', TZ, at('2026-11-16T12:00:00'))
    expect(p.writes).toEqual(['pending mark'])
    p.typeMove('b', 'realisation', at('2026-11-17T12:00:00'))
    await syncProgramPhase(p.repo, 'u', 'p', TZ, at('2026-11-18T12:00:00'))
    expect(p.writes).toEqual(['pending mark', `realign intensification ${since.toISOString()}`])
  })

  it('a program move landing between the read and the re-align\'s lock is not undone (review 2, C)', async () => {
    const p = memoryProgram([
      row('legs', 'accumulation', switchedAt, 0, { pendingTransition: block }),
      row('pull', 'accumulation', switchedAt, 0, { pendingTransition: block }),
    ], [])
    p.typeMove('pull', 'intensification', at('2026-11-25T12:00:00'))
    const movedAt = at('2026-11-26T11:59:00')
    p.raceNextLock(() => p.programMove('intensification', movedAt))
    await syncProgramPhase(p.repo, 'u', 'p', TZ, at('2026-11-26T12:00:00'))
    // The locked rows are aligned on the move: nothing to re-align, the move stands.
    expect(p.writes).toEqual([])
    expect(p.rows().every(r => r.phase === 'intensification' && r.phaseStartedAt.getTime() === movedAt.getTime())).toBe(true)
  })

  it('a waiting stamp decided after the switch-over landed does not overwrite its 3-week block (review 2, C)', async () => {
    // Legs in a deload (1 of 2 done), Push in accumulation: the read sees a program waiting.
    const p = memoryProgram([
      row('legs', 'deload', at('2026-11-10T18:00:00'), 1),
      row('push', 'accumulation', at('2026-10-24T18:00:00'), 3),
    ], [done('legs', '2026-11-11T18:00:00')])
    p.raceNextLock(() => p.programMove('accumulation', at('2026-11-16T00:00:00'), switchOverPendingTransition()))
    await syncProgramPhase(p.repo, 'u', 'p', TZ, at('2026-11-16T10:00:00'))
    expect(p.writes.filter(w => w.startsWith('pending'))).toEqual([])
    expect(p.rows().every(r => r.pendingTransition?.afterTrainingWeeks === 3 && r.pendingTransition.programPhase)).toBe(true)
  })

  it('a first-read mark decided after a move keeps that move\'s mark', async () => {
    const since = at('2026-10-05T12:00:00')
    const p = memoryProgram([row('a', 'intensification', since), row('b', 'intensification', since)], [])
    p.raceNextLock(() => p.programMove('realisation', at('2026-11-16T11:00:00')))
    await syncProgramPhase(p.repo, 'u', 'p', TZ, at('2026-11-16T12:00:00'))
    expect(p.writes).toEqual([])
    expect(p.rows().every(r => r.phase === 'realisation' && r.pendingTransition?.newPhase === 'deload')).toBe(true)
  })

  it('the switch-over itself refuses to run on a program that has switched', async () => {
    const p = memoryProgram([row('a', 'accumulation', switchedAt, 0, { pendingTransition: block })], [])
    expect(await p.repo.setProgramPhase('u', 'p', 'accumulation', at('2026-11-30T00:00:00'), null, { expect: 'switch-over' })).toBe(false)
  })
})

// ── Generation ──────────────────────────────────────────────────────────────────────────────

const exercise = (id: string) => ({
  sessionExerciseId: id, name: `Lift ${id}`, role: 'primary', muscleGroups: ['chest'],
  muscleAssignments: [{ muscle: 'chest', role: 'main' }], baseline1rm: 100, current1rm: 100,
  exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0, avgSetDurationSec: 45, timeProfile: null,
  equipment: [], transitionSec: 240, plateau: false, rpeDelta: null, repCompletionRate: null,
  baseSets: [{ pct: 80, reps: 5, restSec: 120 }, { pct: 80, reps: 5, restSec: 120 }],
})
const signals = (over: Partial<PrescriptionSignals> = {}): PrescriptionSignals => ({
  trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 90,
  exercises: [exercise('a')], phase: 'accumulation', sessionsInPhase: 2, hoursSinceLastSession: 48,
  consecutiveSessionDaysOfThisType: 0, soreMusclesInSession: [], soreMusclesOutOfSession: [],
  sorenessLogDate: 'none', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
  repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {}, acwr: null,
  sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null, externalReadiness: null,
  confidenceTier: 1, confidence: 0.5, confidenceReasons: [], selfReportedSick: false, sleepScoreTrend: null,
  tempZ: null, trainingLoadOts: null, trainingLoadHigh: null, resilienceLevel: null,
  ...over,
}) as unknown as PrescriptionSignals

const moveAnswer = {
  phase: 'intensification', phase_action: 'transition_recommended', deload: false, confidence: 0.9, reasoning: 'Ready.',
  exercises: [{ session_exercise_id: 'a', name: 'Lift a', sets: 4, reps: 4, pct: 85, rest_sec: 180 }],
}

// The clock is fixed at Wednesday 25 Nov, midday: the program's phase began Monday 16 Nov, and
// "this week" is the week of Monday 23 Nov. Legs trained Monday, Pull Tuesday.
const NOW = at('2026-11-25T12:00:00')
const PHASE_START = at('2026-11-16T00:00:00')
const TRAINED: Record<string, string> = { legs: '2026-11-23T12:00:00', pull: '2026-11-24T12:00:00' }
/** The answer a trained type's session was planned with, given the morning it trained. */
const planned = (id: string, phase: string, phaseAction: string): PhaseAnswer =>
  ({ programSessionId: id, phase, phaseAction, createdAt: new Date(at(TRAINED[id]).getTime() - 4 * 3_600_000) })

let n = 0
function harness(opts: { answers?: PhaseAnswer[]; trainedThisWeek?: string[]; waiting?: boolean; storeResult?: boolean } = {}) {
  const start = opts.waiting ? at('2026-10-05T12:00:00') : PHASE_START
  const mark = opts.waiting ? null : programMoveMark('accumulation')
  const state = {
    programSessionId: 'push', phase: 'accumulation', phaseStartedAt: start, baselineComplete: true, sessionsInPhase: 2,
    prescription: null as AiPrescription | null, prescriptionStatus: 'consumed', prescriptionExpiresAt: null, prescriptionGeneratedAt: null,
    pendingTransition: mark,
  }
  // Waiting: Pull is still on its own phase and Legs is in a deload it has not finished.
  const others = ['legs', 'pull'].map(id => ({
    ...state, programSessionId: id,
    ...(opts.waiting && id === 'pull' && { phase: 'intensification', phaseStartedAt: at('2026-10-01T12:00:00') }),
    ...(opts.waiting && id === 'legs' && { phase: 'deload', phaseStartedAt: at('2026-11-12T12:00:00'), sessionsInPhase: 1 }),
  }))
  const stored: Array<{ prescription: AiPrescription; generatedFor: unknown }> = []
  const programMoves: unknown[][] = []
  const typeMoves: string[] = []
  const known: Record<string, unknown> = {
    // #3927: the program and the stamp from one snapshot, as the adapter reads them.
    getActiveProgramWithStructureStamp: async (u: string, id: string) => ({
      program: await (known.getActiveProgram as (u: string) => unknown)(u),
      structure: await (known.getSessionStructureStamp as ((u: string, id: string) => unknown) | undefined)?.(u, id),
    }),
    getActiveProgram: async () => ({ id: 'prog', sessions: ['push', 'legs', 'pull'].map(id => ({ id, timeBudgetMinutes: 90 })) }),
    ensureSessionPeriodization: async () => state,
    getSessionPeriodization: async () => state,
    reconcileSessionsInPhase: async () => undefined,
    listSessionPeriodizationForProgram: async () => [state, ...others],
    listProgramCompletions: async () => (opts.trainedThisWeek ?? []).map(id => done(id, TRAINED[id])),
    listModelPhaseAnswers: async () => opts.answers ?? [],
    setProgramPhase: async () => true,
    setProgramPendingTransition: async () => undefined,
    realignProgramPhase: async () => undefined,
    voidSessionPrescription: async () => undefined,
    storePrescription: async (_u: string, _s: string, prescription: AiPrescription, _e: Date, _st: string, generatedFor: unknown) => {
      stored.push({ prescription, generatedFor })
      return opts.storeResult ?? true
    },
    advanceProgramPhase: async (...args: unknown[]) => {
      programMoves.push(args.slice(2))
      return { ...state, phase: args[2], phaseStartedAt: NOW }
    },
    advancePhase: async (_u: string, _s: string, phase: string) => { typeMoves.push(phase) },
  }
  const repo = new Proxy({}, { get: (_t, prop: string) => known[prop] ?? (async () => undefined) }) as WorkoutRepository
  return { stored, programMoves, typeMoves, start, run: () => generatePrescriptionForSession(`u-3766-${++n}`, 'push', repo, TZ) }
}

describe('generation follows the program', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    mocks.signals = signals()
    mocks.modelAnswer = moveAnswer
  })
  afterEach(() => vi.useRealTimers())

  it('one type\'s move is a stay, planned at the program\'s phase', async () => {
    const h = harness({ trainedThisWeek: ['legs'], answers: [planned('legs', 'accumulation', 'stay')] })
    const r = await h.run()
    expect(r.ok && r.prescription.phaseAction).toBe('stay')
    expect(r.ok && r.prescription.phase).toBe('accumulation')
    // Clamped to the accumulation zone, not the 85% the model asked for at intensification.
    expect(r.ok && r.prescription.exercises[0].pct).toBeLessThan(85)
    expect(r.ok && r.prescription.reasoning).toContain('whole program')
  })

  it('the type being planned does not vote for itself before it has trained this week', async () => {
    // Legs agrees, but it is the only type trained this week: one type never moves the program.
    const h = harness({ trainedThisWeek: ['legs'], answers: [planned('legs', 'intensification', 'transition_recommended')] })
    const r = await h.run()
    expect(r.ok && r.prescription.phaseAction).toBe('stay')
  })

  it('with the two types trained this week agreeing, the move is offered for the program', async () => {
    const agree = ['legs', 'pull'].map(id => planned(id, 'intensification', 'transition_recommended'))
    const h = harness({ trainedThisWeek: ['legs', 'pull'], answers: agree })
    const r = await h.run()
    expect(r.ok && r.prescription.phaseAction).toBe('transition_recommended')
    expect(r.ok && r.prescription.phase).toBe('intensification')
    expect(r.ok && r.prescription.typeOnlyMove).toBeUndefined()
    expect(h.programMoves).toEqual([]) // auto-apply is off: it waits for the tap
  })

  it('an auto-applied move moves the program from the phase it planned in, never one type', async () => {
    mocks.signals = signals({ autoApplyPrescriptions: true, confidence: 0.9 })
    const agree = ['legs', 'pull'].map(id => planned(id, 'intensification', 'transition_recommended'))
    const h = harness({ trainedThisWeek: ['legs', 'pull'], answers: agree })
    await h.run()
    expect(h.programMoves).toEqual([['intensification', { phase: 'accumulation', phaseStartedAt: PHASE_START }]])
    expect(h.typeMoves).toEqual([])
    // Stored against the phase it moved to.
    expect(h.stored.at(-1)?.generatedFor).toEqual({ phase: 'intensification', phaseStartedAt: NOW })
  })

  it('the others\' agreement carries the move to a session whose own answer was a stay', async () => {
    mocks.modelAnswer = { ...moveAnswer, phase: 'accumulation', phase_action: 'stay', exercises: [{ ...moveAnswer.exercises[0], pct: 75 }] }
    const agree = ['legs', 'pull'].map(id => planned(id, 'intensification', 'transition_recommended'))
    const h = harness({ trainedThisWeek: ['legs', 'pull'], answers: agree })
    const r = await h.run()
    expect(r.ok && r.prescription.phaseAction).toBe('transition_recommended')
    expect(r.ok && r.prescription.phase).toBe('intensification')
  })

  it('while the program waits for its switch-over, no type moves', async () => {
    const h = harness({ waiting: true, trainedThisWeek: ['legs'], answers: [planned('legs', 'intensification', 'transition_recommended')] })
    const r = await h.run()
    expect(r.ok && r.prescription.phaseAction).toBe('stay')
  })

  it('a plan made in a phase the program has since left is not stored (finding 5)', async () => {
    mocks.modelAnswer = { ...moveAnswer, phase: 'accumulation', phase_action: 'stay', exercises: [{ ...moveAnswer.exercises[0], pct: 75 }] }
    const h = harness({ storeResult: false })
    const r = await h.run()
    expect(h.stored.map(s => s.generatedFor)).toEqual([{ phase: 'accumulation', phaseStartedAt: PHASE_START }])
    expect(r).toMatchObject({ ok: false, status: 409 })
  })
})

// #4097: a workout belongs to the phase it STARTED in. The aligned program's window count reads the start.
describe('a workout that started before the phase began belongs to the phase before (#4097)', () => {
  const started = (id: string, startLocal: string, doneLocal: string): ProgramCompletion =>
    ({ programSessionId: id, startedAt: at(startLocal), completedAt: at(doneLocal) })
  const moveAt = at('2026-11-12T12:00:00') // a Thursday: the deload begins
  const rows = [row('a', 'deload', moveAt), row('b', 'deload', moveAt)]

  it('started on Wednesday, finished on Thursday after the move: not a deload session, and not a deload week', () => {
    // Everything else is real deload sessions, in the weeks of 16 Nov and 23 Nov (the current week, not yet done).
    const sessions = [
      started('a', '2026-11-12T11:00:00', '2026-11-12T13:00:00'),
      started('a', '2026-11-17T11:00:00', '2026-11-17T12:00:00'),
      started('b', '2026-11-24T11:00:00', '2026-11-24T12:00:00'),
    ]
    const view = programPhaseView(rows, sessions, TZ, at('2026-11-26T12:00:00'))
    // The week of 9 Nov holds only the straddling session, which was the phase before's: no stub week.
    expect(view.trainingWeeksDone).toBe(1)
    // The same workout counted by its finish (an earlier reading) would have made the week of the move count:
    const byFinish = programPhaseView(rows, sessions.map(c => ({ ...c, startedAt: undefined })), TZ, at('2026-11-26T12:00:00'))
    expect(byFinish.trainingWeeksDone).toBe(2)
  })

  it('this week: a straddling workout does not mark its type trained in the new phase', () => {
    const view = programPhaseView(rows, [started('a', '2026-11-12T11:00:00', '2026-11-12T13:00:00')], TZ, at('2026-11-12T14:00:00'))
    expect(view.trainedThisWeek.has('a')).toBe(false)
    const real = programPhaseView(rows, [started('a', '2026-11-12T12:30:00', '2026-11-12T13:30:00')], TZ, at('2026-11-12T14:00:00'))
    expect(real.trainedThisWeek.has('a')).toBe(true)
  })

  it('a completion that names no start reads as its finish, as before', () => {
    const view = programPhaseView(rows, [{ programSessionId: 'a', completedAt: at('2026-11-12T13:00:00') }], TZ, at('2026-11-12T14:00:00'))
    expect(view.trainedThisWeek.has('a')).toBe(true)
  })
})
