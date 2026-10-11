import { WIDGET_TOOL_NAMES, isWidgetToolName, type WidgetToolName } from '@/lib/coach/widgets'

/**
 * #2245: how often the Coach offers a write, and what happened to it — read from the threads the
 * app already stores (`coach_messages.parts`), so measuring it needs no new column and no new log.
 *
 * The question it exists to answer: `coach_changes` held 0 applied changes against 8 assistant
 * messages carrying a widget, 1 of them a `change_preview`. That zero fits "the user declines AI
 * writes" and "the model almost never offers one" equally well. This separates them by counting
 * every widget the model showed, how each was answered, and whether an answered choice list was
 * followed by a proposal (the prompt's swap flow is two choice lists and then the proposal, so a
 * flow abandoned between them looks like a low proposal rate and is not one).
 *
 * Counts widgets, not replies: the client appends a turn that follows a widget answer to the same
 * stored assistant message, so a message is not a reply and counting messages undercounts both.
 */
export interface StoredCoachMessage {
  role: string
  parts: unknown
  position: number
}

export interface ProposalRateReport {
  assistantMessages: number
  widgets: Record<WidgetToolName, number>
  proposals: { shown: number; applied: number; cancelled: number; stale: number; unanswered: number }
  choiceLists: { shown: number; answered: number; followedByProposal: number }
}

type ToolPart = { type: string; state?: string; output?: { status?: string } | null }

const statusOf = (p: ToolPart): string | null =>
  p.state === 'output-available' && p.output && typeof p.output.status === 'string' ? p.output.status : null

export function coachProposalRate(threads: StoredCoachMessage[][]): ProposalRateReport {
  const widgets = Object.fromEntries(Object.keys(WIDGET_TOOL_NAMES).map(k => [k, 0])) as Record<WidgetToolName, number>
  const proposals = { shown: 0, applied: 0, cancelled: 0, stale: 0, unanswered: 0 }
  const choiceLists = { shown: 0, answered: 0, followedByProposal: 0 }
  let assistantMessages = 0

  for (const thread of threads) {
    // One stream of widget parts per thread, in order, across messages.
    const sequence: { name: WidgetToolName; status: string | null }[] = []
    for (const m of [...thread].sort((a, b) => a.position - b.position)) {
      if (m.role !== 'assistant' || !Array.isArray(m.parts)) continue
      assistantMessages++
      for (const raw of m.parts as ToolPart[]) {
        if (typeof raw?.type !== 'string' || !raw.type.startsWith('tool-')) continue
        const name = raw.type.slice('tool-'.length)
        if (!isWidgetToolName(name)) continue
        sequence.push({ name, status: statusOf(raw) })
      }
    }
    sequence.forEach((w, i) => {
      widgets[w.name]++
      if (w.name === 'proposeChange') {
        proposals.shown++
        if (w.status === 'applied') proposals.applied++
        else if (w.status === 'cancelled') proposals.cancelled++
        else if (w.status === 'stale') proposals.stale++
        else proposals.unanswered++
      }
      if (w.name === 'renderChoiceList') {
        choiceLists.shown++
        if (w.status === 'chose') {
          choiceLists.answered++
          // Directly followed by a proposal: the last pick of a flow. A swap's first pick is followed
          // by its second choice list, so a completed swap counts once here, an abandoned one never.
          if (sequence[i + 1]?.name === 'proposeChange') choiceLists.followedByProposal++
        }
      }
    })
  }
  return { assistantMessages, widgets, proposals, choiceLists }
}
