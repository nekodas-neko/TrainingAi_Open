import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { plan, isReady } = require('../queue.js')

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
