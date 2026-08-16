import { describe, it, expect } from 'vitest'
import { getScheduledSessionsPerWeek, sessionsRemainingThisWeek } from '../schedule-utils'
import type { Program, ProgramSession, Schedule } from '@trainingai/shared/types'

function makeSessions(count: number): ProgramSession[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`, programId: 'p1', name: `Session ${i}`, position: i, exercises: [],
  }))
}

function makeProgram(sessionCount: number, schedule?: Schedule): Program {
  return {
    id: 'p1',
    userId: 'u1',
    name: 'Test Program',
    isActive: true,
    sessions: makeSessions(sessionCount),
    schedule,
    createdAt: new Date(),
    updatedAt: new Date(),
    phaseMode: 'manual',
  }
}

describe('getScheduledSessionsPerWeek', () => {
  it('defaults to 3 when there is no schedule', () => {
    const program = makeProgram(3)
    expect(getScheduledSessionsPerWeek(program)).toBe(3)
  })

  it('counts the number of days marked "on" in a weekly schedule', () => {
    const schedule: Schedule = {
      id: 'sch1', programId: 'p1', type: 'weekly',
      days: [
        { dayOfWeek: 0 },
        { dayOfWeek: 2 },
        { dayOfWeek: 4 },
      ],
    }
    const program = makeProgram(2, schedule)
    expect(getScheduledSessionsPerWeek(program)).toBe(3)
  })

  it('defaults to 3 for a weekly schedule with no days array', () => {
    const schedule: Schedule = { id: 'sch1', programId: 'p1', type: 'weekly' }
    const program = makeProgram(2, schedule)
    expect(getScheduledSessionsPerWeek(program)).toBe(3)
  })

  it('matches the home screen cadence for a 2-on-1-off rotation (restAfterN=2)', () => {
    const schedule: Schedule = { id: 'sch1', programId: 'p1', type: 'rotation', restAfterN: 2 }
    const program = makeProgram(4, schedule)
    // 2/3 * 7 = 4.667 -> round -> 5
    expect(getScheduledSessionsPerWeek(program)).toBe(5)
  })

  it('matches the seeded Push/Pull/Legs rotation (restAfterN=3)', () => {
    const schedule: Schedule = { id: 'sch1', programId: 'p1', type: 'rotation', restAfterN: 3 }
    const program = makeProgram(3, schedule)
    // 3/4 * 7 = 5.25 -> round -> 5
    expect(getScheduledSessionsPerWeek(program)).toBe(5)
  })

  it('treats a missing restAfterN as the 3-sessions-per-week default', () => {
    const schedule: Schedule = { id: 'sch1', programId: 'p1', type: 'rotation' }
    const program = makeProgram(3, schedule)
    expect(getScheduledSessionsPerWeek(program)).toBe(3)
  })
})

describe('sessionsRemainingThisWeek', () => {
  const fiveDayProgram = makeProgram(5, {
    id: 'sch1', programId: 'p1', type: 'weekly',
    days: [{ dayOfWeek: 0 }, { dayOfWeek: 1 }, { dayOfWeek: 2 }, { dayOfWeek: 3 }, { dayOfWeek: 4 }],
  })
  const rotationProgram = makeProgram(3, { id: 'sch2', programId: 'p1', type: 'rotation', restAfterN: 3 })
  const noScheduleProgram = makeProgram(3)

  it('prorates the weekly cadence by days left in the week', () => {
    // weekly schedule, 5 training days: full week → 5; 3 days left → ceil(5×3/7)=3; last day → ceil(5/7)=1
    expect(sessionsRemainingThisWeek(fiveDayProgram, 7)).toBe(5)
    expect(sessionsRemainingThisWeek(fiveDayProgram, 3)).toBe(3)
    expect(sessionsRemainingThisWeek(fiveDayProgram, 1)).toBe(1)
  })
  it('handles rotation schedules via the derived weekly cadence', () => {
    // rotation restAfterN=3 → round(3×7/4)=5/wk → 3 days left → ceil(15/7)=3
    expect(sessionsRemainingThisWeek(rotationProgram, 3)).toBe(3)
  })
  it('never returns less than 1', () => {
    expect(sessionsRemainingThisWeek(noScheduleProgram, 0)).toBe(1)
  })
})
