// BF-80 — a dead WebView renderer leaves no JS alive to report itself, which is why production held
// nothing from a blank screen the owner saw repeatedly. The native side records it; this is the
// half that turns that record into an `error_events` row, and these pin that a malformed or absent
// record costs nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseRenderProcessGone,
  renderProcessGoneMessage,
  reportRenderProcessDeaths,
} from '@/lib/renderer-recovery'

const reported: { message: string }[] = []
vi.mock('@/lib/client-error', () => ({
  reportClientError: (info: { message: string }) => { reported.push(info) },
}))

const EVENT = { at: Date.parse('2026-09-01T08:44:00.000Z'), didCrash: false, sdk: 35 }

describe('parseRenderProcessGone', () => {
  it('reads what the native side writes', () => {
    expect(parseRenderProcessGone(JSON.stringify([EVENT]))).toEqual([EVENT])
  })

  // The bridge returns a string across a JNI boundary. Every one of these is a plausible way for
  // that to arrive wrong, and none of them is worth an exception on a cold boot.
  it('is empty for anything that is not a list of events', () => {
    for (const raw of ['', 'null', '{}', '[', 'not json', '[1,2]', '[{"at":"nope","didCrash":false}]']) {
      expect(parseRenderProcessGone(raw), raw).toEqual([])
    }
  })

  it('keeps the well-formed entries and drops the rest', () => {
    expect(parseRenderProcessGone(JSON.stringify([EVENT, { at: 1 }, EVENT]))).toHaveLength(2)
  })
})

describe('renderProcessGoneMessage', () => {
  // The two causes have different fixes — a crash is a bug, a reclaim is memory pressure — so the
  // distinction has to survive into the row rather than being flattened into "renderer died".
  it('separates a crash from a reclaim', () => {
    expect(renderProcessGoneMessage({ ...EVENT, didCrash: true })).toContain('renderer crashed')
    expect(renderProcessGoneMessage(EVENT)).toContain('reclaimed by the system')
  })

  it('carries when it happened and on which SDK', () => {
    const msg = renderProcessGoneMessage(EVENT)
    expect(msg).toContain('2026-09-01T08:44:00.000Z')
    expect(msg).toContain('SDK 35')
  })
})

describe('reportRenderProcessDeaths', () => {
  beforeEach(() => { reported.length = 0 })
  afterEach(() => { delete (globalThis as { AndroidRenderer?: unknown }).AndroidRenderer })

  it('does nothing off-device, where the bridge does not exist', () => {
    reportRenderProcessDeaths()
    expect(reported).toEqual([])
  })

  it('reports one row per recorded death', () => {
    ;(globalThis as { AndroidRenderer?: unknown }).AndroidRenderer = {
      consumeRenderProcessGone: () => JSON.stringify([EVENT, { ...EVENT, didCrash: true }]),
    }
    reportRenderProcessDeaths()
    expect(reported).toHaveLength(2)
    expect(reported[0].message).toContain('reclaimed by the system')
    expect(reported[1].message).toContain('renderer crashed')
  })

  // Recovery must not depend on reporting: the native side has already reloaded by the time this
  // runs, and a throwing bridge must not take the boot down with it.
  it('swallows a throwing bridge', () => {
    ;(globalThis as { AndroidRenderer?: unknown }).AndroidRenderer = {
      consumeRenderProcessGone: () => { throw new Error('bridge gone') },
    }
    expect(() => reportRenderProcessDeaths()).not.toThrow()
    expect(reported).toEqual([])
  })
})
