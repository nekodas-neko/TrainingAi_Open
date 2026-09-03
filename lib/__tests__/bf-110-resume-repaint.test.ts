import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  readShellSample, isDomIntact, shouldReportResume, resumeReportMessage,
  nudgeRepaint, handleResume, resetResumeReportingForTest,
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
