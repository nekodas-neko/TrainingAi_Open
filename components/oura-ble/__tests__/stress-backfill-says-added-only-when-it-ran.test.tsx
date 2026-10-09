// @vitest-environment jsdom
/**
 * Issue 2236: the stress-bucket backfill console says "added" only when the job that finished is
 * itself the WRITE kind, and a dry run never claims a write. Same lesson as the step backfill
 * (issue 2383): every full-history job shares one slot, so the run that finished may not be the one
 * pressed. Mounts the real console against a scripted `fetch`.
 *
 * Not exercised: the real server, the worker, or any write. Web only; no device.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: (p: { open: boolean; onConfirm: () => void; confirmLabel?: string }) =>
    p.open ? createElement('button', { 'data-testid': 'confirm', onClick: p.onConfirm }, p.confirmLabel) : null,
}))

import { StressBackfillConsole, stressBackfillResultText } from '../stress-backfill-console'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const REPORT = {
  dryRun: true, timezone: 'Australia/Brisbane', range: { from: '2026-06-22', to: '2026-10-07' },
  daysConsidered: 100, daysSkippedPopulated: 40, daysSkippedNotComplete: 0, daysToGain: 55,
  bucketsToAdd: 1430, bucketsAlreadyPresent: 0, daysCannotCompute: 5,
  cannotComputeByReason: { 'no-raw-data': 5 }, cannotCompute: [], gaining: [],
  depth: { from: '2026-06-22', to: '2026-08-23' }, bucketsWritten: 0,
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let container: HTMLDivElement
let root: Root
let posts: string[]
let script: { start: Response; poll: Response }[]

function installFetch(steps: { start: Response; poll?: Response }[]) {
  posts = []
  script = steps.map(s => ({ start: s.start, poll: s.poll ?? json(200, { job: null }) }))
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { posts.push(url); return script[Math.min(i, script.length - 1)].start }
    if (url.includes('jobId=')) { const r = script[Math.min(i, script.length - 1)].poll; i++; return r.clone() }
    throw new Error(`unexpected fetch ${url}`)
  }))
}

const byText = (text: string) =>
  [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement

const doneJob = (kind: string, report: Record<string, unknown> | null, extra: Record<string, unknown> = {}) =>
  json(200, { job: { jobId: 5, status: 'done', kind, redecodeError: null, aggregateError: null, stressBackfill: report, ...extra } })

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function press(label: string) {
  await act(async () => { byText(label).click() })
  await act(async () => { await vi.advanceTimersByTimeAsync(3_500) })
}

describe('stress backfill console', () => {
  it('a dry run shows the report, says nothing was written, and offers the write', async () => {
    installFetch([{
      start: json(200, { jobId: 5, status: 'running', alreadyRunning: false, kind: 'stress-backfill-dry-run' }),
      poll: doneJob('stress-backfill-dry-run', REPORT),
    }])
    await act(async () => { root.render(createElement(StressBackfillConsole)) })
    await press('Dry run')
    expect(posts).toEqual(['/api/oura-ble/samples/redecode?async=1&stressBackfill=1'])
    expect(container.textContent).toContain('Dry run only — nothing was written')
    expect(container.textContent).toContain('buckets that would be added: 1430')
    expect(container.textContent).toContain('no-raw-data: 5')
    expect(container.textContent).not.toContain('Done.')
    expect(byText('Add 1430 buckets')).toBeTruthy()
  })

  it('does not offer the write when there is nothing to add', async () => {
    installFetch([{
      start: json(200, { jobId: 5, status: 'running', alreadyRunning: false, kind: 'stress-backfill-dry-run' }),
      poll: doneJob('stress-backfill-dry-run', { ...REPORT, bucketsToAdd: 0, daysToGain: 0 }),
    }])
    await act(async () => { root.render(createElement(StressBackfillConsole)) })
    await press('Dry run')
    expect(byText('Add 0 buckets')).toBeUndefined()
  })

  it('writes with dryRun=false and says "added" only for a finished write job', async () => {
    installFetch([
      {
        start: json(200, { jobId: 5, status: 'running', alreadyRunning: false, kind: 'stress-backfill-dry-run' }),
        poll: doneJob('stress-backfill-dry-run', REPORT),
      },
      {
        start: json(200, { jobId: 6, status: 'running', alreadyRunning: false, kind: 'stress-backfill' }),
        poll: doneJob('stress-backfill', { ...REPORT, dryRun: false, bucketsWritten: 1430 }, { jobId: 6 }),
      },
    ])
    await act(async () => { root.render(createElement(StressBackfillConsole)) })
    await press('Dry run')
    await act(async () => { byText('Add 1430 buckets').click() })
    await act(async () => { (container.querySelector('[data-testid="confirm"]') as HTMLButtonElement).click() })
    await act(async () => { await vi.advanceTimersByTimeAsync(3_500) })
    expect(posts[1]).toBe('/api/oura-ble/samples/redecode?async=1&stressBackfill=1&dryRun=false')
    expect(container.textContent).toContain('Done. 1430 bucket(s) added')
  })

  it('does not claim a write when the job that finished was a dry run', () => {
    const text = stressBackfillResultText(
      { kind: 'done', jobId: 9, jobKind: 'stress-backfill-dry-run', phases: { stressBackfill: REPORT } }, 'write')
    expect(text).toContain('Not applied')
    expect(text).not.toContain('Done.')
  })

  it('does not claim a write when the job that finished was a plain redecode', () => {
    const text = stressBackfillResultText({ kind: 'done', jobId: 9, jobKind: 'redecode', phases: {} }, 'write')
    expect(text).toContain('Not applied')
    expect(text).not.toContain('added')
  })

  it('does not claim a write when the report itself says dry run', () => {
    const text = stressBackfillResultText(
      { kind: 'done', jobId: 9, jobKind: 'stress-backfill', phases: { stressBackfill: REPORT } }, 'write')
    expect(text).toContain('dry run')
    expect(text).not.toContain('Done.')
  })

  it('reports a refusal as not started with nothing changed', () => {
    const text = stressBackfillResultText({ kind: 'refused', message: 'A different full-history job is already running.' }, 'write')
    expect(text).toContain('Not started')
    expect(text).toContain('Nothing was changed')
  })

  it('reports a phase error (such as a rollback) as an error, never as added', () => {
    const text = stressBackfillResultText({
      kind: 'done', jobId: 9, jobKind: 'stress-backfill',
      phases: { aggregateError: 'stress backfill rolled back: planned 4, the database accepted 3' },
    }, 'write')
    expect(text).toMatch(/^Error: stress backfill rolled back/)
  })
})
