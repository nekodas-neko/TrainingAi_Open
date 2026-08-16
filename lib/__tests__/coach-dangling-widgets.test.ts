import { describe, it, expect } from 'vitest'
import type { UIMessage } from 'ai'
import { resolveDanglingWidgetCalls } from '@/lib/coach/dangling-widgets'

/** A thread where a widget was shown and then the user typed instead of tapping. */
function threadWithPendingWidget(): UIMessage[] {
  return [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Change my workout' }] },
    {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'tool-renderChoiceList', toolCallId: 'call-1', state: 'input-available', input: { kind: 'choice_list' } }],
    },
    { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Update with Jefferson curls' }] },
  ] as unknown as UIMessage[]
}

const partsOf = (m: UIMessage) => m.parts as unknown as { state?: string; output?: { status?: string } }[]

describe('resolveDanglingWidgetCalls', () => {
  it('closes a widget the user typed past, so the provider is not handed an unanswered call', () => {
    // The device report: every turn after this died with AI_MissingToolResultsError, which the
    // user saw as "Something went wrong" — and asking again could not help, because the unanswered
    // call stayed in the thread forever.
    const out = resolveDanglingWidgetCalls(threadWithPendingWidget())
    const part = partsOf(out[1])[0]
    expect(part.state).toBe('output-available')
    expect(part.output).toEqual({ status: 'cancelled' })
  })

  it('leaves the newest widget alone — nothing has overtaken it, so it is still awaiting a tap', () => {
    const live = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Change my workout' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'tool-renderChoiceList', toolCallId: 'call-1', state: 'input-available', input: {} }],
      },
    ] as unknown as UIMessage[]
    expect(partsOf(resolveDanglingWidgetCalls(live)[1])[0].state).toBe('input-available')
  })

  it('does not touch a widget the user actually answered', () => {
    const answered = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Change my workout' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{
          type: 'tool-renderChoiceList', toolCallId: 'call-1', state: 'output-available',
          input: {}, output: { status: 'chose', id: 'x', label: 'Pull' },
        }],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'and now?' }] },
    ] as unknown as UIMessage[]
    expect(partsOf(resolveDanglingWidgetCalls(answered)[1])[0].output).toEqual({ status: 'chose', id: 'x', label: 'Pull' })
  })

  it('leaves plain text messages untouched', () => {
    const textOnly = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'again' }] },
    ] as unknown as UIMessage[]
    expect(resolveDanglingWidgetCalls(textOnly)).toEqual(textOnly)
  })

  it('closes several stranded widgets, not just the first', () => {
    const many = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'a' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'tool-renderChoiceList', toolCallId: 'c1', state: 'input-available', input: {} }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'tool-proposeChange', toolCallId: 'c2', state: 'input-available', input: {} }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'never mind' }] },
    ] as unknown as UIMessage[]
    const out = resolveDanglingWidgetCalls(many)
    expect(partsOf(out[1])[0].output).toEqual({ status: 'cancelled' })
    expect(partsOf(out[2])[0].output).toEqual({ status: 'cancelled' })
  })
})
