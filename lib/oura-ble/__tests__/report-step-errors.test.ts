import { describe, it, expect, vi, beforeEach } from 'vitest'

const reportServerError = vi.fn()
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))

const { reportRollupStepErrors } = await import('@/lib/oura-ble/report-step-errors')

// A rollup step failure used to reach Railway stdout and nothing else, because `step()` guarantees
// the rollup never throws and the callers only reported from a `.catch`. These pin the two halves
// that matter: silence when there is nothing wrong, and exactly one event when there is.
describe('reportRollupStepErrors', () => {
  beforeEach(() => reportServerError.mockClear())

  it('reports nothing when no step failed', () => {
    reportRollupStepErrors([], { userId: 'u', url: '/x' })
    reportRollupStepErrors(undefined, { userId: 'u', url: '/x' })
    expect(reportServerError).not.toHaveBeenCalled()
  })

  it('reports ONE event naming every failed step', () => {
    reportRollupStepErrors(
      ['daily_summary: Connection terminated unexpectedly', 'illness_radar: boom'],
      { userId: 'u1', url: '/api/oura-ble/samples#aggregate' },
    )
    expect(reportServerError).toHaveBeenCalledTimes(1)
    const [err, ctx] = reportServerError.mock.calls[0] as [Error, { userId: string; url: string }]
    expect(err.message).toContain('daily_summary: Connection terminated unexpectedly')
    expect(err.message).toContain('illness_radar: boom')
    expect(ctx).toEqual({ userId: 'u1', url: '/api/oura-ble/samples#aggregate' })
  })

  // error_events truncates at 2000 and prunes at 30 days; a pathological pass must not evict the
  // rest of the table's week with one row.
  it('caps the message so one bad pass cannot flood the row', () => {
    reportRollupStepErrors([`x`.repeat(5000)], { userId: 'u', url: '/x' })
    const [err] = reportServerError.mock.calls[0] as [Error]
    expect(err.message.length).toBeLessThanOrEqual(1800)
  })
})
