import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { plan, isReady, needsOpus, pickBatch, batchPriority } = require('../queue.js')

const issue = (number: number, labels: string[], body = '') => ({ number, title: `t${number}`, body, labelSet: new Set(labels) })

describe('queue plan', () => {
  it('orders hotfix, then next, then bugs, then the rest oldest first', () => {
    const out = plan([
      issue(5, ['type: feature']),
      issue(4, ['type: bug']),
      issue(9, ['next', 'type: feature']),
      issue(7, ['hotfix', 'type: bug']),
      issue(3, ['type: feature']),
    ])
    expect(out.map((b: { members: { number: number }[] }) => b.members[0].number)).toEqual([7, 9, 4, 3, 5])
  })

  it('batches issues that name a common file, whatever their area', () => {
    const out = plan([
      issue(1, ['area: sleep'], 'see `lib/a.ts` and `lib/b.ts`'),
      issue(2, ['area: body'], 'touches lib/b.ts'),
      issue(3, ['area: body'], 'touches `lib/c.ts`'),
    ])
    expect(out[0].members.map((m: { number: number }) => m.number)).toEqual([1, 2])
    expect(out[0].sharedFiles).toEqual(['lib/b.ts'])
    expect(out[1].members.map((m: { number: number }) => m.number)).toEqual([3])
  })

  it('does not batch on a hub file, and caps a batch at five', () => {
    const hub = plan([issue(1, [], '`lib/cache-groups.ts`'), issue(2, [], '`lib/cache-groups.ts`')])
    expect(hub).toHaveLength(2)
    const many = plan([1, 2, 3, 4, 5, 6, 7].map((n) => issue(n, [], '`lib/x.ts`')))
    expect(many[0].members).toHaveLength(5)
    expect(many.map((b: { members: unknown[] }) => b.members.length)).toEqual([5, 2])
  })

  it('places a batch where its highest-priority member sits', () => {
    const out = plan([
      issue(10, ['area: sleep', 'lane: engine'], '`lib/x.ts`'),
      issue(2, ['type: bug', 'area: body', 'lane: engine']),
      issue(11, ['type: bug', 'area: sleep', 'lane: engine'], '`lib/x.ts`'),
    ])
    expect(out.map((b: { members: { number: number }[] }) => b.members.map((m) => m.number))).toEqual([[2], [11, 10]])
  })
})

describe('queue readiness', () => {
  it('serves an issue only when nothing parks it: blocked, later, in progress or any needs:', () => {
    const ready = (labels: string[]) => isReady(issue(1, ['agent: implementer', ...labels]), 'implementer')
    expect(ready([])).toBe(true)
    expect(ready(['blocked'])).toBe(false)
    expect(ready(['later'])).toBe(false)
    expect(ready(['in progress'])).toBe(false)
    expect(ready(['needs: owner'])).toBe(false)
    expect(isReady(issue(1, ['agent: bugfix']), 'implementer')).toBe(false)
  })
})

describe('batch model', () => {
  it('reads Opus from the milestone description, so the Slow tier can skip it', () => {
    expect(needsOpus({ description: 'Opus. Scoring change; re-derive after a snapshot.' })).toBe(true)
    expect(needsOpus({ description: 'Sonnet. Small surface fix.' })).toBe(false)
    expect(needsOpus({ description: '' })).toBe(false)
    expect(needsOpus({})).toBe(false)
  })
})

describe('next batch by the Orchestrator\'s priority', () => {
  const ms = (number: number, description = '') => ({ number, title: `Batch: ${number}`, description })
  const iss = (number: number, labels: string[]) => ({ number, title: `t${number}`, labels: labels.map((name) => ({ name })) })

  it('reads P0–P3 from the start of the description, and treats none as P3', () => {
    expect(batchPriority(ms(1, 'P1 Opus. A data-correctness bug.'))).toBe(1)
    expect(batchPriority(ms(1, 'P2 Sonnet. A feature.'))).toBe(2)
    expect(batchPriority(ms(1, 'Opus. No priority yet.'))).toBe(3)
    expect(batchPriority({ number: 1 })).toBe(3)
  })

  it('serves the highest-priority batch first, then the oldest', () => {
    const milestones = [ms(10, 'P3 Sonnet.'), ms(20, 'P2 Opus.'), ms(30, 'P1 Opus.'), ms(40, 'P1 Sonnet.')]
    const by = new Map([10, 20, 30, 40].map((n) => [n, [iss(n, ['type: feature'])]]))
    expect(pickBatch(milestones, by).milestone.number).toBe(30)
    by.set(30, [iss(30, ['type: feature', 'blocked'])])
    expect(pickBatch(milestones, by).milestone.number).toBe(40)
  })

  it('lets a ready hotfix make a batch P0 and the owner\'s next make it at least P1', () => {
    const milestones = [ms(10, 'P1 Opus.'), ms(20, 'P3 Sonnet.'), ms(30, 'P2 Sonnet.')]
    const by = new Map([[10, [iss(1, ['type: bug'])]], [20, [iss(2, ['type: feature', 'hotfix'])]], [30, [iss(3, ['next'])]]])
    expect(pickBatch(milestones, by).milestone.number).toBe(20)
    by.delete(20)
    expect(pickBatch(milestones, by).milestone.number).toBe(10)
  })

  it('skips claimed, fully parked and (under sonnetOnly) Opus batches; urgentOnly keeps only P0 and P1', () => {
    const milestones = [ms(10, 'P1 Opus.'), ms(20, 'P1 Sonnet.'), ms(30, 'P2 Sonnet.')]
    const by = new Map([
      [10, [iss(1, ['type: bug'])]],
      [20, [iss(2, ['type: bug', 'in progress'])]],
      [30, [iss(3, ['type: feature']), iss(4, ['type: bug', 'later'])]],
    ])
    expect(pickBatch(milestones, by).milestone.number).toBe(10)
    const slowSonnet = pickBatch(milestones, by, { sonnetOnly: true })
    expect(slowSonnet.milestone.number).toBe(30)
    expect(slowSonnet.blocked.map((i: { number: number }) => i.number)).toEqual([4])
    expect(pickBatch(milestones, by, { urgentOnly: true }).milestone.number).toBe(10)
    expect(pickBatch([ms(30, 'P2 Sonnet.')], by, { urgentOnly: true })).toBeNull()
    expect(pickBatch([ms(50, 'P1')], new Map([[50, [iss(5, ['blocked'])]]]))).toBeNull()
  })
})
