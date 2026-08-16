import type { UIMessage } from 'ai'

/**
 * Close off any widget the user walked away from instead of answering.
 *
 * **The bug this fixes, reported from the device 2026-08-10.** A replacement picker was on screen
 * and the owner typed *"Update with Jefferson curls"* rather than tapping a row. Every following
 * turn died with `AI_MissingToolResultsError: Tool result is missing for tool call …`, surfacing as
 * *"Something went wrong. Ask again and I'll pick up where we left off."* — and asking again could
 * not help, because the unanswered call stayed in the thread forever. The conversation was
 * permanently wedged.
 *
 * The provider requires a result for every tool call, and a widget's result only arrives when the
 * user taps something. Typing instead is not an error — it is the most natural thing in the world,
 * and it is how you change your mind. So a widget that a later user message has overtaken is marked
 * `cancelled`, which is already a member of `WidgetResultSchema` and reads to the model as what
 * actually happened: they did not pick, they said something else.
 *
 * Deliberately only widgets that a **later user message** has overtaken. The most recent widget,
 * with nothing after it, is still live and awaiting a tap.
 */
export function resolveDanglingWidgetCalls(messages: UIMessage[]): UIMessage[] {
  const lastUserIndex = messages.map(m => m.role).lastIndexOf('user')
  if (lastUserIndex <= 0) return messages

  return messages.map((message, index) => {
    if (index > lastUserIndex || message.role !== 'assistant' || !Array.isArray(message.parts)) return message

    let changed = false
    const parts = message.parts.map(part => {
      const p = part as { type?: string; state?: string; output?: unknown }
      if (typeof p.type !== 'string' || !p.type.startsWith('tool-')) return part
      if (p.output !== undefined || p.state === 'output-available' || p.state === 'output-error') return part
      changed = true
      return { ...p, state: 'output-available', output: { status: 'cancelled' } }
    })

    return changed ? ({ ...message, parts } as UIMessage) : message
  })
}
