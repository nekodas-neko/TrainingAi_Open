// @vitest-environment jsdom
/**
 * Issue 2383, item 1: "Run backfill now" could do nothing and say it worked.
 *
 * Every full-history redecode shares one job slot. The backfill (`allowStepsDecrease=1`) used to
 * follow a plain redecode that was already running; that run kept the "steps only go up" guard, so
 * the correction never happened, and this console printed "Done. Backfill applied" anyway.
 *
 * The server now refuses that case with 409, and the status poll reports the kind of job it is
 * describing. These mount the real console against a scripted `fetch` and read what it says:
 *
 *   · refused → says it did not start and changed nothing;
 *   · a finished run that was NOT a step backfill → says the correction did not run;
 *   · a finished step backfill → the only case that says "Backfill applied".
 *
 * Not exercised: the real server, the worker, or any write. Web only; no device.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// The real dialog is a Radix portal; what matters here is only that confirming fires the run.
vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: (p: { open: boolean; onConfirm: () => void; confirmLabel?: string }) =>
    p.open ? createElement('button', { 'data-testid': 'confirm', onClick: p.onConfirm }, p.confirmLabel) : null,
}))

import { StepBackfillConsole, backfillResultText } from '../step-backfill-console'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PREVIEW = {
  affectedDays: 2, totalOldSteps: 30_000, totalNewSteps: 21_000,
  rows: [
    { date: '2026-05-01', oldSteps: 16_000, oldSource: 'oura_ble', newSteps: 11_000 },
    { date: '2026-05-02', oldSteps: 14_000, oldSource: 'oura_ble', newSteps: 10_000 },
  ],
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Script = { start: Response; poll?: Response }

let container: HTMLDivElement
let root: Root
let posts: string[]

function installFetch(script: Script) {
  posts = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/oura-ble/samples/step-backfill-preview')) return json(200, PREVIEW)
    if (init?.method === 'POST') { posts.push(url); return script.start }
    if (url.includes('jobId=')) return script.poll ?? json(200, { job: null })
    throw new Error(`unexpected fetch ${url}`)
  }))
}

const byText = (text: string) =>
  [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement

async function pressBackfill() {
  await act(async () => { root.render(createElement(StepBackfillConsole)) })
  await act(async () => { byText('Preview backfill').click() })
  await act(async () => { byText('Run backfill now').click() })
  await act(async () => { (container.querySelector('[data-testid="confirm"]') as HTMLButtonElement).click() })
  // The poller waits 3 s between polls.
  await act(async () => { await vi.advanceTimersByTimeAsync(3_500) })
}

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

describe('Run backfill now', () => {
  it('says it did not start when the server refuses because a plain redecode holds the slot', async () => {
    installFetch({
      start: json(409, {
        error: 'A redecode is already running. Wait for it to finish, then run the backfill.',
        refused: true, runningJobId: 41, runningKind: 'redecode', requestedKind: 'step-backfill',
      }),
    })
    await pressBackfill()
    expect(posts).toHaveLength(1)
    expect(posts[0]).toContain('allowStepsDecrease=1')
    expect(container.textContent).toContain('Not started: A redecode is already running')
    expect(container.textContent).toContain('Nothing was changed')
    expect(container.textContent).not.toContain('Backfill applied')
    // The preview is still current, so it stays on screen.
    expect(container.textContent).toContain('2026-05-01')
  })

  it('does not claim the correction when the run that finished was a plain redecode', async () => {
    // Defence in depth: the server refuses this case now, but the screen must not depend on that.
    installFetch({
      start: json(200, { jobId: 41, status: 'running', alreadyRunning: true, kind: 'redecode' }),
      poll: json(200, { job: { jobId: 41, status: 'done', kind: 'redecode', redecodeError: null, aggregateError: null } }),
    })
    await pressBackfill()
    expect(container.textContent).toContain('Not applied')
    expect(container.textContent).not.toContain('Backfill applied')
  })

  it('says "Backfill applied" only when the finished job is itself a step backfill', async () => {
    installFetch({
      start: json(200, { jobId: 42, status: 'running', alreadyRunning: false, kind: 'step-backfill' }),
      poll: json(200, { job: { jobId: 42, status: 'done', kind: 'step-backfill', redecodeError: null, aggregateError: null } }),
    })
    await pressBackfill()
    expect(container.textContent).toContain('Done. Backfill applied')
    // A stale preview is dropped once the correction really ran.
    expect(container.textContent).not.toContain('2026-05-01')
  })
})

describe('backfillResultText', () => {
  const phases = { redecodeError: null, aggregateError: null }

  it('reads a missing kind (an older server) as not applied', () => {
    expect(backfillResultText({ kind: 'done', jobId: 1, jobKind: null, phases })).toMatch(/^Not applied/)
  })

  it('reports a phase error ahead of any success', () => {
    expect(backfillResultText({
      kind: 'done', jobId: 1, jobKind: 'step-backfill', phases: { ...phases, aggregateError: 'steps step failed' },
    })).toBe('Error: steps step failed')
  })

  it('keeps a failure distinct from a refusal', () => {
    expect(backfillResultText({ kind: 'failed', message: 'HTTP 500' })).toBe('ERROR: HTTP 500')
    expect(backfillResultText({ kind: 'refused', message: 'busy.' })).toBe('Not started: busy. Nothing was changed.')
  })
})
