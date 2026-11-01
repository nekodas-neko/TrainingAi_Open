// #2417: the look-alike food merge on the agent key. Its params are strict, a write needs an
// approval and a dry run does not, and it calls the merge (mocked here; the merge has its own tests).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const merge = vi.hoisted(() => vi.fn())
vi.mock('@/lib/nutrition/merge-look-alike-foods', () => ({ mergeLookAlikeFoods: merge }))
vi.mock('@/lib/data/postgres/client', () => ({ getDb: () => ({ db: true }), getPool: vi.fn() }))

import { AgentActionRequest, agentJobLosesData, runAgentJob, type AgentJobContext } from '../jobs'

const OWNER = '00000000-0000-4000-8000-000000241703'
const FOOD = '00000000-0000-4000-8000-000000241704'
const ctx = { repo: {} as AgentJobContext['repo'], userId: OWNER, tz: 'Australia/Brisbane' }
const req = (params: unknown) => ({ job: 'merge-look-alike-foods', actor: 'orchestrator', targetUserId: OWNER, params })
const report = (over: Record<string, unknown> = {}) => ({
  dryRun: true, totals: { groups: 2, automatic: 1, needsReview: 1, extras: 3, logsToMove: 10, mealItemsToMove: 1 },
  groups: [], skipped: [], datesTouched: [], failedGroups: 0, ...over,
})

describe('merge-look-alike-foods (#2417)', () => {
  beforeEach(() => { merge.mockReset().mockResolvedValue({ ok: true, report: report() }) })

  it('needs dryRun, takes an optional keepers map of group key to food id, and refuses anything else', () => {
    expect(AgentActionRequest.safeParse(req({ dryRun: true })).success).toBe(true)
    expect(AgentActionRequest.safeParse(req({ dryRun: false, keepers: { 'granola | sunsol': FOOD } })).success).toBe(true)
    expect(AgentActionRequest.safeParse(req({})).success).toBe(false)
    expect(AgentActionRequest.safeParse(req({ dryRun: true, keepers: { x: 'not-a-uuid' } })).success).toBe(false)
    expect(AgentActionRequest.safeParse(req({ dryRun: true, userId: OWNER })).success).toBe(false)
  })

  it("takes only: 'exact', passes it to the merge, and refuses any other value", async () => {
    expect(AgentActionRequest.safeParse(req({ dryRun: true, only: 'exact' })).success).toBe(true)
    expect(AgentActionRequest.safeParse(req({ dryRun: true, only: 'all' })).success).toBe(false)
    expect(AgentActionRequest.safeParse(req({ dryRun: true, only: true })).success).toBe(false)
    await runAgentJob(ctx, AgentActionRequest.parse(req({ dryRun: false, only: 'exact' })))
    expect(merge).toHaveBeenCalledWith({ db: true }, OWNER, { dryRun: false, only: 'exact' })
  })

  it('needs an approval to write, not to dry-run', () => {
    expect(agentJobLosesData(AgentActionRequest.parse(req({ dryRun: true })))).toBe(false)
    expect(agentJobLosesData(AgentActionRequest.parse(req({ dryRun: false })))).toBe(true)
  })

  it('a dry run is passed through to the merge and logs no affected rows', async () => {
    const out = await runAgentJob(ctx, AgentActionRequest.parse(req({ dryRun: true, keepers: { k: FOOD } })))
    expect(merge).toHaveBeenCalledWith({ db: true }, OWNER, { dryRun: true, keepers: { k: FOOD } })
    expect(out.status).toBe(200)
    expect(out.finish).toEqual({ outcome: 'succeeded', affectedRows: 0, daysMoved: 0, error: null })
  })

  it('a write logs what it moved and tombstoned', async () => {
    merge.mockResolvedValue({ ok: true, report: report({
      dryRun: false, datesTouched: ['2026-10-01', '2026-10-02'],
      groups: [{ result: { logsMoved: 4, mealItemsMoved: 1, tombstoned: 2 } }, { result: { logsMoved: 3, mealItemsMoved: 0, tombstoned: 1 } }],
    }) })
    const out = await runAgentJob(ctx, AgentActionRequest.parse(req({ dryRun: false })))
    expect(out.finish).toEqual({ outcome: 'succeeded', affectedRows: 11, daysMoved: 2, error: null })
  })

  it('reports rolled-back groups as failed', async () => {
    merge.mockResolvedValue({ ok: true, report: report({ dryRun: false, failedGroups: 1, groups: [{ result: { failed: 'boom' } }] }) })
    const out = await runAgentJob(ctx, AgentActionRequest.parse(req({ dryRun: false })))
    expect(out.finish).toMatchObject({ outcome: 'failed', error: '1 of 2 group(s) rolled back' })
  })

  it('a refused keepers map is a 400 and logs as refused', async () => {
    merge.mockResolvedValue({ ok: false, error: 'keepers refused: "x" (no group)' })
    const out = await runAgentJob(ctx, AgentActionRequest.parse(req({ dryRun: true, keepers: { x: FOOD } })))
    expect(out.status).toBe(400)
    expect(out.finish).toMatchObject({ outcome: 'refused' })
  })
})
