// #3801: the `reconcile-personal-records` and `rescore-heart-health` jobs on the agent key. Strict
// params, which runs need an approval, and that each passes the dry run through and logs what it
// wrote. The reconcile itself has a DB test (lib/data/postgres/__tests__/reconcile-personal-records-job-3801.test.ts);
// the heart-health rule has its own (lib/health/__tests__/heart-health-service.test.ts).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const reconcile = vi.hoisted(() => vi.fn())
const rescore = vi.hoisted(() => vi.fn())
vi.mock('@/lib/workout/reconcile-personal-records', () => ({ reconcilePersonalRecords: reconcile }))
vi.mock('@/lib/health/heart-health-service', () => ({ rescoreHeartHealth: rescore }))
vi.mock('@/lib/data/postgres/client', () => ({ getDb: vi.fn(), getPool: vi.fn() }))

import { AgentActionRequest, agentJobLosesData, runAgentJob, type AgentJobContext } from '../jobs'

const OWNER = '00000000-0000-4000-8000-000000038014'
const TZ = 'Australia/Brisbane'
const ctx = { repo: { repo: true } as unknown as AgentJobContext['repo'], userId: OWNER, tz: TZ }
const req = (job: string, params: unknown) => ({ job, actor: 'orchestrator', targetUserId: OWNER, params })
const d = (n: number) => shiftDateStr(todayInTz(TZ), n)

describe('reconcile-personal-records (#3801)', () => {
  const report = (written = 0) => ({
    dryRun: written === 0, examined: 5, changes: [], achievedOn: written ? ['2026-05-09'] : [],
    summary: { add: 1, raise: 0, unchanged: 4, wouldLower: 0, wouldRemove: 0, none: 0, written },
  })
  beforeEach(() => { reconcile.mockReset().mockResolvedValue(report()) })

  it('needs dryRun, takes an optional list of names, and refuses anything else', () => {
    const ok = (p: unknown) => AgentActionRequest.safeParse(req('reconcile-personal-records', p)).success
    expect(ok({ dryRun: true })).toBe(true)
    expect(ok({ dryRun: false, exercises: ['Bench Press'] })).toBe(true)
    expect(ok({})).toBe(false)
    expect(ok({ dryRun: true, exercises: [] })).toBe(false)
    expect(ok({ dryRun: true, exercises: [''] })).toBe(false)
    expect(ok({ dryRun: true, userId: OWNER })).toBe(false)
  })

  it('never needs an approval: it only adds or raises a record', () => {
    for (const dryRun of [true, false]) {
      expect(agentJobLosesData(AgentActionRequest.parse(req('reconcile-personal-records', { dryRun })))).toBe(false)
    }
  })

  it('passes the dry run and names through, and logs what a write wrote', async () => {
    let out = await runAgentJob(ctx, AgentActionRequest.parse(req('reconcile-personal-records', { dryRun: true, exercises: ['A'] })))
    expect(reconcile).toHaveBeenCalledWith(ctx.repo, OWNER, TZ, { dryRun: true, exercises: ['A'] })
    expect(out.status).toBe(200)
    expect(out.finish).toEqual({ outcome: 'succeeded', affectedRows: 0, daysMoved: 0 })
    reconcile.mockResolvedValue(report(1))
    out = await runAgentJob(ctx, AgentActionRequest.parse(req('reconcile-personal-records', { dryRun: false })))
    expect(out.finish).toEqual({ outcome: 'succeeded', affectedRows: 1, daysMoved: 1 })
  })
})

describe('rescore-heart-health (#3801)', () => {
  const met = { date: d(-4), runId: 'r1', status: 'pending', targetMin: 25, countedMin: 31, met: true, outcome: 'met', creditedId: 'a1',
    activities: [{ id: 'a1', title: 'Walk', activityType: 'walking', durationMin: 40, effortMin: 31 }] }
  const notMet = { ...met, date: d(-3), runId: 'r2', countedMin: 3, met: false, creditedId: null }
  const change = { date: d(-4), runId: 'r1', activityLogId: 'a1', completedAs: 'walk', countedMin: 31, targetMin: 25 }
  beforeEach(() => {
    rescore.mockReset().mockImplementation(async (_r, _u, _tz, _f, _t, o: { write: boolean }) => ({
      days: [met, notMet], changes: [change], written: o.write ? 1 : 0,
    }))
  })

  it('needs from, to and dryRun, and refuses anything else', () => {
    const ok = (p: unknown) => AgentActionRequest.safeParse(req('rescore-heart-health', p)).success
    expect(ok({ from: d(-10), to: d(-1), dryRun: true })).toBe(true)
    expect(ok({ from: '2026/07/24', to: '2026/08/23', dryRun: true })).toBe(true)
    expect(ok({ from: d(-10), dryRun: true })).toBe(false)
    expect(ok({ from: 'yesterday', to: d(-1), dryRun: true })).toBe(false)
    expect(ok({ from: d(-10), to: d(-1), dryRun: true, write: true })).toBe(false)
  })

  it('needs an approval to write, not to dry-run', () => {
    const p = { from: d(-10), to: d(-1) }
    expect(agentJobLosesData(AgentActionRequest.parse(req('rescore-heart-health', { ...p, dryRun: true })))).toBe(false)
    expect(agentJobLosesData(AgentActionRequest.parse(req('rescore-heart-health', { ...p, dryRun: false })))).toBe(true)
  })

  it('a dry run reports each day with its target, counted minutes, verdict and what would complete', async () => {
    const out = await runAgentJob(ctx, AgentActionRequest.parse(req('rescore-heart-health', { from: d(-10), to: d(0), dryRun: true })))
    // Today is left to the device: the range ends yesterday.
    expect(rescore).toHaveBeenCalledWith(ctx.repo, OWNER, TZ, d(-10), d(-1), { write: false })
    expect(out.status).toBe(200)
    const report = (out.body as { report: { summary: Record<string, number>; days: Record<string, unknown>[] } }).report
    expect(report.summary).toMatchObject({ daysExamined: 2, wouldComplete: 1, written: 0, pendingNotMet: 1 })
    expect(report.days.map(x => [x.date, x.targetMin, x.countedMin, x.met, x.wouldComplete])).toEqual([
      [d(-4), 25, 31, true, true], [d(-3), 25, 3, false, false],
    ])
    expect(out.finish).toEqual({ outcome: 'succeeded', affectedRows: 0, daysMoved: 0 })
  })

  it('a write completes what the rule says and logs it', async () => {
    const out = await runAgentJob(ctx, AgentActionRequest.parse(req('rescore-heart-health', { from: d(-10), to: d(-1), dryRun: false })))
    expect(rescore).toHaveBeenCalledWith(ctx.repo, OWNER, TZ, d(-10), d(-1), { write: true })
    expect(out.finish).toEqual({ outcome: 'succeeded', affectedRows: 1, daysMoved: 1 })
  })

  it('refuses a range over 31 days or backwards, and runs nothing', async () => {
    for (const [from, to] of [[d(-40), d(-1)], [d(-1), d(-5)]]) {
      const out = await runAgentJob(ctx, AgentActionRequest.parse(req('rescore-heart-health', { from, to, dryRun: true })))
      expect(out.status).toBe(400)
      expect(out.finish).toMatchObject({ outcome: 'refused' })
    }
    expect(rescore).not.toHaveBeenCalled()
  })
})
