import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  readShellSample, isDomIntact, shouldReportResume, resumeReportMessage,
  nudgeRepaint, handleResume, resetResumeReportingForTest,
  resumeRecheckMessage, RESUME_RECHECK_MS,
} from '@/lib/resume-repaint'

vi.mock('@/lib/client-error', () => ({ reportClientError: vi.fn() }))
import { reportClientError } from '@/lib/client-error'

/**
 * BF-110 — the blank resume survives a scroll, which means the renderer never died.
 *
 * A dead WebView renderer has no document left to scroll, so content that reappears when you drag it
 * was there all along and was not painted. This covers the measurement that turns that inference
 * into a recorded fact, and the repaint that replaces the manual scroll.
 */

const ROOT = path.resolve(__dirname, '..', '..')
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const el = (width: number, height: number, childCount: number) => ({
  getBoundingClientRect: () => ({ width, height }),
  childElementCount: childCount,
  style: { transform: '' },
  offsetHeight: height,
})

beforeEach(() => {
  resetResumeReportingForTest()
  vi.mocked(reportClientError).mockClear()
})

describe('reading the shell', () => {
  it('takes the box and the child count together', () => {
    expect(readShellSample(el(412, 830, 7))).toEqual({ width: 412, height: 830, childCount: 7 })
  })

  it('calls a real box with real children intact', () => {
    expect(isDomIntact({ width: 412, height: 830, childCount: 7 })).toBe(true)
  })

  it('treats a zero dimension or an empty container as lost', () => {
    // Any of these would put BF-80's renderer death back in play and make a repaint the wrong fix,
    // so none of them may read as intact.
    expect(isDomIntact({ width: 0, height: 830, childCount: 7 })).toBe(false)
    expect(isDomIntact({ width: 412, height: 0, childCount: 7 })).toBe(false)
    expect(isDomIntact({ width: 412, height: 830, childCount: 0 })).toBe(false)
  })
})

describe('what gets a row', () => {
  it('reports a lost DOM every time, however often it happens', () => {
    // The disproof of this entry's whole thesis. Losing it to a once-per-launch cap would mean the
    // one observation that matters is the one most likely to be dropped.
    expect(shouldReportResume({ width: 0, height: 0, childCount: 0 }, true)).toBe(true)
  })

  it('reports an intact resume once per launch, and then stops', () => {
    // JS cannot tell whether the screen was blank — the DOM is intact either way — so a row per
    // resume records nothing about the failure and floods a table that prunes at 30 days.
    const intact = { width: 412, height: 830, childCount: 7 }
    expect(shouldReportResume(intact, false)).toBe(true)
    expect(shouldReportResume(intact, true)).toBe(false)
  })

  it('says which verdict it is, and stays greppable beside BF-80s row', () => {
    expect(resumeReportMessage({ width: 412, height: 830, childCount: 7 }))
      .toBe('bf110 resume dom-intact w=412 h=830 children=7')
    expect(resumeReportMessage({ width: 0, height: 0, childCount: 0 }))
      .toBe('bf110 resume dom-lost w=0 h=0 children=0')
  })
})

describe('the repaint', () => {
  it('promotes, flushes, and releases on the next frame rather than staying promoted', () => {
    // A permanent will-change buys memory on every screen forever to fix one frame.
    const node = el(412, 830, 7)
    const frames: Array<() => void> = []
    nudgeRepaint(node, cb => frames.push(cb))
    expect(node.style.transform).toBe('translateZ(0)')
    frames.forEach(f => f())
    expect(node.style.transform).toBe('')
  })

  it('runs on every resume, not only the one that filed a row', () => {
    // The row is capped; the fix is not. Tying the repaint to the report would fix the first resume
    // of a launch and leave every later one blank.
    const node = el(412, 830, 7)
    const frames: Array<() => void> = []
    handleResume(node, cb => frames.push(cb))
    frames.forEach(f => f())
    handleResume(node, cb => frames.push(cb))
    expect(node.style.transform).toBe('translateZ(0)')
    expect(vi.mocked(reportClientError)).toHaveBeenCalledTimes(1)
  })

  it('files a lost DOM on a later resume even after the intact cap is spent', () => {
    const frames: Array<() => void> = []
    handleResume(el(412, 830, 7), cb => frames.push(cb))
    handleResume(el(0, 0, 0), cb => frames.push(cb))
    expect(vi.mocked(reportClientError)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(reportClientError).mock.calls[1][0].message).toContain('dom-lost')
  })
})

/**
 * The second reading (BF-110, 2026-09-14).
 *
 * Sixteen samples separate perfectly on viewport height — every blank resume reported **667**, every
 * rendered one **826**, and 826 is the S25's real CSS viewport. But that cannot yet tell a WebView
 * stuck at its 384\u00d7667 default from a measurement taken before it resized, and **the two answers
 * point at different files**: a JS render-timing fix, or the native layer. Hence a second look.
 */
describe('the recheck', () => {
  it('names the verdict rather than leaving two numbers to be diffed', () => {
    const first = { width: 384, height: 667, childCount: 1 }
    expect(resumeRecheckMessage(first, { width: 412, height: 826, childCount: 7 }))
      .toBe('bf110 resume recheck resized h1=667 h2=826 w2=412 children2=7')
    expect(resumeRecheckMessage(first, { width: 384, height: 667, childCount: 1 }))
      .toBe('bf110 resume recheck stuck h1=667 h2=667 w2=384 children2=1')
  })

  it('reads the element AGAIN rather than reporting the first sample twice', () => {
    // The whole value is in the second measurement. Closing over the first sample for both halves
    // would produce a row that always says `stuck` and looks like an answer.
    const node = el(384, 667, 1)
    const deferred: Array<() => void> = []
    handleResume(node, () => {}, cb => deferred.push(cb))

    // The viewport resizes between the two readings, which is the case under test.
    node.getBoundingClientRect = () => ({ width: 412, height: 826 })
    node.childElementCount = 7
    deferred.forEach(f => f())

    expect(vi.mocked(reportClientError).mock.calls[1][0].message)
      .toBe('bf110 resume recheck resized h1=667 h2=826 w2=412 children2=7')
  })

  it('rides the first row budget: no first row, no recheck', () => {
    // `error_events` prunes at 30 days and is the second-largest object in the database. A recheck
    // on every resume would double a cost the once-per-launch cap exists to avoid.
    const node = el(412, 830, 7)
    const deferred: Array<() => void> = []
    handleResume(node, () => {}, cb => deferred.push(cb))   // files, so it schedules
    expect(deferred).toHaveLength(1)
    handleResume(node, () => {}, cb => deferred.push(cb))   // capped, so it does not
    expect(deferred).toHaveLength(1)
  })

  it('waits long enough for a resize to have happened, and stays inside the same resume', () => {
    const deferred: Array<{ ms: number }> = []
    handleResume(el(384, 667, 1), () => {}, (_cb, ms) => deferred.push({ ms }))
    expect(deferred[0].ms).toBe(RESUME_RECHECK_MS)
    expect(RESUME_RECHECK_MS).toBe(500)
  })

  it('is wired with a real timer at the call site, not left unscheduled', () => {
    // The parameter is optional so the first half's tests keep working; that makes it exactly the
    // kind of thing that can be added and never passed.
    expect(src('lib/hooks/use-resume-repaint.ts')).toMatch(/setTimeout\(cb, ms\)/)
  })
})

describe('where it is wired', () => {
  it('sits on the shell container, not in a screen', () => {
    // The report says "pages often"; fixing one component would look like a fix and hold for a day.
    expect(src('components/pull-to-sync.tsx')).toMatch(/useResumeRepaint\(scrollRef\)/)
  })

  it('is not a reload, which BF-80 rules out', () => {
    const hook = src('lib/hooks/use-resume-repaint.ts')
    expect(hook).not.toMatch(/location\.reload|window\.location\s*=/)
    expect(hook).toMatch(/document\.visibilityState !== 'visible'/)
  })

  it('removes its listener, so a remount does not stack handlers', () => {
    expect(src('lib/hooks/use-resume-repaint.ts'))
      .toMatch(/removeEventListener\('visibilitychange', onVisible\)/)
  })
})
