/**
 * #3766: what moves for the owner's five session types — a read-only replay of the 14 Nov table.
 *
 * Fixtures, from the proposal: Legs deload (2 done), Lower deload (1 done), Pull intensification (5
 * done), Push accumulation (3 done), Upper accumulation (8 done, its move waiting since 10 Nov).
 * Assumed cadence: each type once a week (Upper Mon, Push Tue, Lower Wed, Pull Thu, Legs Sat), the
 * model always answers a plain stay (so only the caps move anything), and every offered move is
 * tapped at the session it is offered. Day by day from Sun 15 Nov to Sun 3 Jan.
 *
 * BEFORE is `main`'s per-type rule (caps in sessions of one type: 6 / 5 / 2, deload floor 2), copied
 * here because this change removes it. AFTER runs the real `program-phase.ts`.
 */
import { describe, it, expect } from 'vitest'
import { shiftDateStr, dateStrMidnightInTz, weekStartForDay } from '@trainingai/shared/date-utils'
import {
  planSwitchOver, programPhaseView, applyProgramPhaseCap, switchOverPendingTransition, NEXT_PROGRAM_PHASE,
  type PhaseRow, type ProgramCompletion,
} from '../program-phase'
import type { AiPrescription, PeriodizationPhase } from '@trainingai/shared/types/ai-periodization'

const TZ = 'Australia/Brisbane'
const DAY: Record<string, number> = { upper: 0, push: 1, lower: 2, pull: 3, legs: 5 } // offset from Monday
const TYPES = ['legs', 'lower', 'pull', 'push', 'upper'] as const
const OLD_CAP: Partial<Record<PeriodizationPhase, number>> = { accumulation: 6, intensification: 5, realisation: 2, deload: 2 }

const start14Nov = (): Record<string, { phase: PeriodizationPhase; n: number }> => ({
  legs: { phase: 'deload', n: 2 }, lower: { phase: 'deload', n: 1 }, pull: { phase: 'intensification', n: 5 },
  push: { phase: 'accumulation', n: 3 }, upper: { phase: 'accumulation', n: 8 },
})

const days = (from: string, to: string) => {
  const out: string[] = []
  for (let d = from; d <= to; d = shiftDateStr(d, 1)) out.push(d)
  return out
}
const trains = (type: string, day: string) => shiftDateStr(weekStartForDay(day), DAY[type]) === day
const midday = (day: string) => new Date(dateStrMidnightInTz(day, TZ).getTime() + 12 * 3_600_000)

type Event = { day: string; type: string; ran: PeriodizationPhase; moved?: PeriodizationPhase }

function replayBefore(): Event[] {
  const s = start14Nov()
  const events: Event[] = []
  for (const day of days('2026-11-15', '2027-01-03')) {
    for (const type of TYPES) {
      if (!trains(type, day)) continue
      const cur = s[type]
      const cap = OLD_CAP[cur.phase]!
      if (cur.n >= cap) {
        // The cap's offer is shown at this session and tapped: the phase moves, then it trains.
        const next = NEXT_PROGRAM_PHASE[cur.phase]
        events.push({ day, type, ran: next, moved: next })
        s[type] = { phase: next, n: 1 }
      } else {
        events.push({ day, type, ran: cur.phase })
        cur.n += 1
      }
    }
  }
  return events
}

function replayAfter(): Event[] {
  const s = start14Nov()
  let rows: PhaseRow[] = TYPES.map(t => ({
    programSessionId: t, phase: s[t].phase, phaseStartedAt: new Date({ upper: '2026-09-10', push: '2026-10-24', pull: '2026-10-08', legs: '2026-11-01', lower: '2026-11-05' }[t] + 'T00:00:00Z'),
    sessionsInPhase: s[t].n, baselineComplete: true, pendingTransition: null,
  }))
  // The deload sessions already done by 14 Nov (on each type's own day), which is what dates the
  // finish of a deload. Other types' history before 15 Nov changes nothing here.
  const completions: ProgramCompletion[] = [
    { programSessionId: 'legs', completedAt: midday('2026-11-07') }, { programSessionId: 'legs', completedAt: midday('2026-11-14') },
    { programSessionId: 'lower', completedAt: midday('2026-11-11') },
  ]
  const events: Event[] = []
  for (const day of days('2026-11-15', '2027-01-03')) {
    const now = midday(day)
    const plan = planSwitchOver(rows, completions, TZ, now)
    if (plan.kind === 'switch') {
      rows = rows.map(r => ({ ...r, phase: 'accumulation', phaseStartedAt: plan.startsAt, sessionsInPhase: 0, pendingTransition: switchOverPendingTransition() }))
      events.push({ day, type: 'program', ran: 'accumulation', moved: 'accumulation' })
    }
    for (const type of TYPES) {
      if (!trains(type, day)) continue
      const r = rows.find(x => x.programSessionId === type)!
      const view = programPhaseView(rows, completions, TZ, now)
      if (view.aligned) {
        const out = applyProgramPhaseCap({ phase: r.phase, phaseAction: 'stay', reasoning: '' } as AiPrescription, view)
        if (out.phaseAction === 'transition_recommended') {
          rows = rows.map(x => ({ ...x, phase: out.phase, phaseStartedAt: now, sessionsInPhase: 0, pendingTransition: null }))
          events.push({ day, type, ran: out.phase, moved: out.phase })
        } else events.push({ day, type, ran: r.phase })
      } else if (r.phase === 'deload' && r.sessionsInPhase >= 2) {
        // While waiting for the switch-over, a type in a finished deload keeps its own way out.
        rows = rows.map(x => x === r ? { ...x, phase: 'accumulation', phaseStartedAt: now, sessionsInPhase: 0 } : x)
        events.push({ day, type, ran: 'accumulation', moved: 'accumulation' })
      } else events.push({ day, type, ran: r.phase })
      completions.push({ programSessionId: type, completedAt: new Date(now.getTime() + 3_600_000) })
      rows = rows.map(x => x.programSessionId === type && x.phaseStartedAt.getTime() <= now.getTime() ? { ...x, sessionsInPhase: x.sessionsInPhase + 1 } : x)
    }
  }
  return events
}

const nextMove = (events: Event[], type: string) => events.find(e => (e.type === type || e.type === 'program') && e.moved)

describe('#3766 replay of the owner\'s program from 15 Nov', () => {
  const before = replayBefore()
  const after = replayAfter()

  it('prints, per session type, the phase it trains in each week, before and after', () => {
    const weeks = [...new Set(after.map(e => weekStartForDay(e.day)))]
    const table = TYPES.map(t => {
      const cell = (ev: Event[], w: string) => ev.filter(e => e.type === t && weekStartForDay(e.day) === w).map(e => e.ran.slice(0, 5)).join('')
      return `${t.padEnd(6)} before: ${weeks.map(w => cell(before, w).padEnd(5)).join(' ')}\n${''.padEnd(6)}  after: ${weeks.map(w => cell(after, w).padEnd(5)).join(' ')}`
    })
    console.info(`weeks:         ${weeks.map(w => w.slice(5)).join(' ')}\n${table.join('\n')}`)
    console.info('next move, before:', TYPES.map(t => `${t} ${nextMove(before, t)?.day} → ${nextMove(before, t)?.moved}`).join('; '))
    const pairs = before.map(b => [b, after.find(a => a.type === b.type && a.day === b.day)!] as const)
    const changed = pairs.filter(([b, a]) => b.ran !== a.ran)
    console.info(`future sessions planned in a different phase: ${changed.length} of ${pairs.length}; by type:`,
      TYPES.map(t => `${t} ${changed.filter(([b]) => b.type === t).length}`).join(', '))
    console.info('moves after:', after.filter(e => e.moved).map(e => `${e.day} ${e.type} → ${e.moved}`).join('; '))
  })

  it('after: every type starts accumulation on Mon 23 Nov and the program is offered intensification on Mon 14 Dec', () => {
    expect(after.find(e => e.type === 'program')?.day).toBe('2026-11-23')
    const firstProgramMove = after.find(e => e.type !== 'program' && e.moved && e.day > '2026-11-23')
    expect(firstProgramMove).toEqual({ day: '2026-12-14', type: 'upper', ran: 'intensification', moved: 'intensification' })
    // From 23 Nov every type trains in the same phase each week.
    for (const w of ['2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21']) {
      expect(new Set(after.filter(e => weekStartForDay(e.day) === w && e.type !== 'program').map(e => e.ran)).size).toBe(1)
    }
  })

  it('before: the five types stay on five clocks', () => {
    const w = '2026-11-30'
    expect(new Set(before.filter(e => weekStartForDay(e.day) === w).map(e => e.ran)).size).toBeGreaterThan(1)
  })
})
