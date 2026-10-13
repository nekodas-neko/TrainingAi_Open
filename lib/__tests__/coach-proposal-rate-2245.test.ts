// #2245 — the proposal-rate report over stored Coach threads.
import { describe, it, expect } from 'vitest'
import { coachProposalRate, type StoredCoachMessage } from '@/lib/coach/proposal-rate'

const w = (name: string, output?: Record<string, unknown>) =>
  output ? { type: `tool-${name}`, state: 'output-available', input: {}, output } : { type: `tool-${name}`, state: 'input-available', input: {} }
const msg = (position: number, role: string, parts: unknown[]): StoredCoachMessage => ({ position, role, parts })

describe('coachProposalRate', () => {
  it('counts a completed swap flow once, and its applied proposal', () => {
    // The prompt's swap: two choice lists, then the proposal. The client appends each continuation
    // to the same assistant message, so one message holds all three widgets.
    const thread = [
      msg(0, 'user', [{ type: 'text', text: 'swap bench' }]),
      msg(1, 'assistant', [
        { type: 'step-start' }, { type: 'tool-getProgramStructure', state: 'output-available', output: {} },
        w('renderChoiceList', { status: 'chose', id: 'a', label: 'Bench Press' }),
        w('renderChoiceList', { status: 'chose', id: 'b', label: 'Dumbbell Bench Press' }),
        w('proposeChange', { status: 'applied', summary: 'Swapped.' }),
        { type: 'text', text: 'Done.' },
      ]),
    ]
    const r = coachProposalRate([thread])
    expect(r.assistantMessages).toBe(1)
    expect(r.widgets.renderChoiceList).toBe(2)
    expect(r.proposals).toEqual({ shown: 1, applied: 1, cancelled: 0, stale: 0, unanswered: 0 })
    expect(r.choiceLists).toEqual({ shown: 2, answered: 2, followedByProposal: 1 })
  })

  it('separates a flow abandoned before the proposal from a declined proposal', () => {
    const abandoned = [msg(1, 'assistant', [w('renderChoiceList', { status: 'chose', id: 'a', label: 'x' }), w('renderChoiceList')])]
    const declined = [msg(1, 'assistant', [w('renderChoiceList', { status: 'chose', id: 'a', label: 'x' }), w('proposeChange', { status: 'cancelled' })])]
    const r = coachProposalRate([abandoned, declined])
    expect(r.proposals).toEqual({ shown: 1, applied: 0, cancelled: 1, stale: 0, unanswered: 0 })
    expect(r.choiceLists).toEqual({ shown: 3, answered: 2, followedByProposal: 1 })
  })

  it('reads threads in stored position order, and ignores read tools and malformed parts', () => {
    const thread = [
      msg(3, 'assistant', [w('proposeChange')]),
      msg(1, 'assistant', [w('renderChoiceList', { status: 'chose', id: 'a', label: 'x' }), { type: 'tool-findSwapCandidates' }, null, 'junk']),
      msg(2, 'user', [{ type: 'text', text: 'ok' }]),
    ]
    const r = coachProposalRate([thread])
    expect(r.proposals.unanswered).toBe(1)
    expect(r.choiceLists.followedByProposal).toBe(1)
    expect(r.widgets.renderChart).toBe(0)
  })
})
