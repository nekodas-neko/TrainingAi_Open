import { describe, it, expect } from 'vitest'
import { CoachWidgetSchema, WidgetResultSchema, WIDGET_TOOL_NAMES, isWidgetToolName } from '@/lib/coach/widgets'
import { resolveDanglingWidgetCalls } from '@/lib/coach/dangling-widgets'
import type { UIMessage } from 'ai'

const chart = {
  kind: 'chart',
  chartType: 'line',
  title: 'Body Weight Progression',
  labels: ['Jul 21', 'Jul 24', 'Jul 27'],
  datasets: [{ label: 'Body Weight (kg)', data: [81.85, 82, 82.15], colorKey: 'cyan' }],
}

describe('the chart widget', () => {
  it('is a member of the widget union, so the registry can dispatch on it', () => {
    const parsed = CoachWidgetSchema.safeParse(chart)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.kind).toBe('chart')
  })

  it('is reachable by tool name', () => {
    expect(isWidgetToolName('renderChart')).toBe(true)
    expect(WIDGET_TOOL_NAMES.renderChart).toBe('chart')
  })

  // A chart asks nothing, so the client answers it on render. Without this member the result the
  // client sends would fail validation and the tool call would stay open — which is the wedge.
  it('accepts the self-resolving result the client sends on render', () => {
    expect(WidgetResultSchema.safeParse({ status: 'shown' }).success).toBe(true)
  })

  it('rejects a hex colour, so a model cannot break one of the two themes', () => {
    const hex = { ...chart, datasets: [{ ...chart.datasets[0], colorKey: '#22c55e' }] }
    expect(CoachWidgetSchema.safeParse(hex).success).toBe(false)
  })

  it('rejects a single-point series — a two-point minimum is what makes it a trend', () => {
    const one = { ...chart, labels: ['Jul 21'], datasets: [{ label: 'W', data: [81.85] }] }
    expect(CoachWidgetSchema.safeParse(one).success).toBe(false)
  })

  it('caps the series count at what is readable on a phone', () => {
    const many = {
      ...chart,
      datasets: Array.from({ length: 5 }, (_, i) => ({ label: `s${i}`, data: [1, 2, 3] })),
    }
    expect(CoachWidgetSchema.safeParse(many).success).toBe(false)
  })

  // The chart normally answers itself on mount. If the app closed before it rendered, the call is
  // still open, and the dangling resolver has to close it like any other — otherwise the next turn
  // dies with AI_MissingToolResultsError, the exact bug that resolver exists for.
  it('is closed off by the dangling resolver when it never rendered', () => {
    const messages = [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'chart my weight' }] },
      { id: '2', role: 'assistant', parts: [{ type: 'tool-renderChart', toolCallId: 'c1', state: 'input-available', input: chart }] },
      { id: '3', role: 'user', parts: [{ type: 'text', text: 'never mind' }] },
    ] as unknown as UIMessage[]

    const out = resolveDanglingWidgetCalls(messages)
    const part = (out[1].parts as { output?: unknown }[])[0]
    expect(part.output).toEqual({ status: 'cancelled' })
  })
})
