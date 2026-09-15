// BF-164, the AI half. Two of the app's understated bodyweight rep maxes went to the MODEL rather
// than to a card, and the system prompt tells it to quote these verbatim — so a wrong number here
// is reasoned from and repeated back as fact, which is worse than a wrong label on a screen.
//
// The `context.ts` line needed more than swapping the inverse, and that is what these pin.
import { describe, it, expect } from 'vitest'
import { build1RmTargets } from '@/lib/ai-chat/context'
import { calcAmrap1RM, BW_REF } from '@trainingai/shared/1rm'

// The owner's Hanging Leg Raise: eleven reps, stored as 128.
const STORED = calcAmrap1RM(BW_REF, 11)

const sessions = (estimated1rm: number, exerciseName = 'Hanging Leg Raise') => ([{
  startedAt: new Date('2026-09-12T08:00:00Z'),
  exercises: [{ exerciseName, estimated1rm }],
}]) as unknown as Parameters<typeof build1RmTargets>[0]

const bodyweight = new Map([['Hanging Leg Raise', 'bodyweight']])

describe('build1RmTargets — bodyweight', () => {
  it('quotes the rep max the estimate actually came from', () => {
    expect(STORED).toBe(128)
    expect(build1RmTargets(sessions(STORED), bodyweight)).toContain('11 RM')
  })

  // The defect this test exists for: the line read `repMaxFromOneRm(orm * 0.8)`. Taking 80% of the
  // estimate is a weighted-lift idea — a bodyweight `estimated1rm` is a BW_REF-relative index that
  // starts at 101.75 for ONE rep, so scaling it by 0.8 lands below the bottom of the scale and the
  // inverse returns 1 for every bodyweight exercise there is. Both inverses do; swapping them fixes
  // nothing. The percentage belongs on the REPS.
  it('targets a working set in reps, not the inverse of a scaled index', () => {
    const out = build1RmTargets(sessions(STORED), bodyweight)
    expect(out).toContain('target working set 8 reps')
    expect(out).not.toContain('target working set 1 reps')
  })

  it('never lands on 1 rep across the whole plausible range', () => {
    // The old arithmetic returned 1 at every one of these.
    for (let reps = 3; reps <= 25; reps++) {
      const out = build1RmTargets(sessions(calcAmrap1RM(BW_REF, reps)), bodyweight)
      const match = out.match(/target working set (\d+) reps/)
      expect(match, `no target emitted for a ${reps}-rep estimate`).not.toBeNull()
      expect(Number(match![1]), `a ${reps}-rep estimate targeted ${match![1]}`).toBeGreaterThan(1)
    }
  })

  it('still reports a weighted lift in kilograms', () => {
    const out = build1RmTargets(sessions(100, 'Barbell Bench Press'), new Map([['Barbell Bench Press', 'weighted']]))
    const line = out.split('\n').find(l => l.startsWith('Barbell Bench Press'))!
    expect(line).toContain('80kg')
    // The heading itself says "1RMs", so the check has to be on the exercise's own line.
    expect(line).not.toMatch(/\bRM\b/)
    expect(line).not.toContain('reps')
  })
})

// `oneRmFields` in `tools.ts` is a closure inside `chatTools(repo, …)` and is not reachable without
// standing up a repository and driving a tool call, so this asserts it at the source — the same
// fallback `back-action-on-tab.test.ts` uses for a handler it cannot invoke. It is a weaker test
// than the four above and is here because the alternative is no test at all: this is the second of
// the two sites that hand a rep max to the model.
describe('ai-chat tools report the stored bodyweight estimate through the right inverse', () => {
  it('uses bodyweightRepMax, never repMaxFromOneRm', async () => {
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(new URL('../tools.ts', import.meta.url), 'utf8')
    // Comments stripped first: the fix's own note NAMES the helper it replaced, and a substring
    // check that reads prose fails on the explanation rather than on the code. Exactly the shape
    // that made `check-e2e-stub-dates.js` flag a date inside its own header.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).toContain('bodyweightRepMax')
    expect(code).not.toContain('repMaxFromOneRm')
  })
})
