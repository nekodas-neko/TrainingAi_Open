// #2859: the two Oura jobs on the agent key. Their params are strict, a backfill write needs an
// approval and a dry run does not, and each calls the code the server runs (mocked here).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const backfill = vi.hoisted(() => vi.fn())
const renewal = vi.hoisted(() => vi.fn())
vi.mock('@/lib/oura/cloud/backfill', () => ({ backfillOuraCloud: backfill, CONNECT_BACKFILL_DAYS: 90 }))
vi.mock('@/lib/oura/cloud/renewal', () => ({ runOuraWebhookRenewal: renewal }))

import { AgentActionRequest, agentJobLosesData, runAgentJob, type AgentJobContext } from '../jobs'

const OWNER = '00000000-0000-4000-8000-000000002859'
const ctx = { repo: {} as AgentJobContext['repo'], userId: OWNER, tz: 'Australia/Brisbane' }
const req = (job: string, params: unknown) => ({ job, actor: 'orchestrator', targetUserId: OWNER, params })
const report = { dryRun: true, from: '2026-10-01', to: '2026-10-12', documents: {}, dropped: 0, forbidden: [], stoppedEarly: null,
  counts: { dailyRows: 12, bodyRows: 12, sleepWritten: 12, sleepSkippedOverlap: 0, sleepTombstoned: 0, workouts: 2, heartRatePoints: 3000 } }

describe('oura-cloud-backfill (#2859)', () => {
  beforeEach(() => {
    backfill.mockReset().mockResolvedValue({ ok: true, report })
    process.env.OURA_CLIENT_ID = 'cid'
    process.env.OURA_CLIENT_SECRET = 'cs'
    process.env.OURA_REDIRECT_URI = 'http://localhost:3000/api/oura/callback'
  })

  it('accepts a range and a dry run, and refuses unknown fields', () => {
    expect(AgentActionRequest.safeParse(req('oura-cloud-backfill', { from: '2026-10-01', to: '2026/10/12', dryRun: true })).success).toBe(true)
    expect(AgentActionRequest.safeParse(req('oura-cloud-backfill', { dryRun: true, userId: 'x' })).success).toBe(false)
    expect(AgentActionRequest.safeParse(req('oura-cloud-backfill', {})).success).toBe(false)
  })

  it('needs an approval to write, not to dry-run', () => {
    expect(agentJobLosesData(AgentActionRequest.parse(req('oura-cloud-backfill', { dryRun: true })))).toBe(false)
    expect(agentJobLosesData(AgentActionRequest.parse(req('oura-cloud-backfill', { dryRun: false })))).toBe(true)
  })

  it('defaults to the last 90 days in the owner\'s timezone, heart rate included', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-14T02:00:00Z') })
    try {
      const out = await runAgentJob(ctx, AgentActionRequest.parse(req('oura-cloud-backfill', { dryRun: true })))
      expect(out.status).toBe(200)
      expect(backfill).toHaveBeenCalledWith(expect.objectContaining({ config: expect.any(Object) }), OWNER,
        { from: '2026-07-17', to: '2026-10-14', dryRun: true, heartRate: true, tz: 'Australia/Brisbane' })
      expect(out.finish).toEqual({ outcome: 'succeeded', affectedRows: 0, daysMoved: 0, error: null })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a not-connected owner as refused', async () => {
    backfill.mockResolvedValue({ ok: false, error: 'not_connected' })
    const out = await runAgentJob(ctx, AgentActionRequest.parse(req('oura-cloud-backfill', { dryRun: true, from: '2026-10-01', to: '2026-10-02' })))
    expect(out.status).toBe(409)
    expect(out.finish).toEqual({ outcome: 'refused', error: 'not_connected' })
  })

  it('answers 503 when Oura is not configured', async () => {
    delete process.env.OURA_CLIENT_SECRET
    const out = await runAgentJob(ctx, AgentActionRequest.parse(req('oura-cloud-backfill', { dryRun: true })))
    expect(out.status).toBe(503)
    expect(backfill).not.toHaveBeenCalled()
  })
})

describe('oura-webhook-subscriptions (#2859)', () => {
  beforeEach(() => renewal.mockReset())

  it('never needs an approval and passes the dry run through', async () => {
    const parsed = AgentActionRequest.parse(req('oura-webhook-subscriptions', { dryRun: true }))
    expect(agentJobLosesData(parsed)).toBe(false)
    renewal.mockResolvedValue({ dryRun: true, current: [], renewed: [], created: ['sleep:create'], failed: [] })
    const out = await runAgentJob(ctx, parsed)
    expect(renewal).toHaveBeenCalledWith(true)
    expect(out.status).toBe(200)
    expect(out.finish).toEqual({ outcome: 'succeeded', affectedRows: 0, daysMoved: 0, error: null })
  })

  it('is refused when the settings are missing or another pass holds the lock', async () => {
    renewal.mockResolvedValue(null)
    const out = await runAgentJob(ctx, AgentActionRequest.parse(req('oura-webhook-subscriptions', { dryRun: false })))
    expect(out.status).toBe(409)
  })
})
