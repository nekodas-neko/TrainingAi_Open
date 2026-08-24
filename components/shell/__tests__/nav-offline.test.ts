// Q-555: only the PAIR of conditions is the bug, so all four states are pinned.
import { describe, it, expect } from 'vitest'
import { navigationWouldBeSilent } from '../nav-offline'

const nav = (onLine: boolean, controlled: boolean) => ({
  onLine,
  serviceWorker: { controller: controlled ? {} : null },
})

describe('navigationWouldBeSilent', () => {
  // The measured defect: first-ever load, connection lost inside the window where the worker has
  // registered but not yet claimed the page.
  it('is true offline with no controller — the one failing state', () => {
    expect(navigationWouldBeSilent(nav(false, false))).toBe(true)
  })

  // Measured working in the review: a tab tap painted ~101% of the online content from cache. A
  // warning here would be a false alarm on the path that works.
  it('is false offline WITH a controller', () => {
    expect(navigationWouldBeSilent(nav(false, true))).toBe(false)
  })

  it('is false online, controlled or not', () => {
    expect(navigationWouldBeSilent(nav(true, true))).toBe(false)
    expect(navigationWouldBeSilent(nav(true, false))).toBe(false)
  })

  // Safari and older WebViews expose no `serviceWorker` at all. Offline there, the push cannot be
  // served either, so the warning is right — but reading `.controller` off undefined must not throw.
  it('treats a missing serviceWorker as uncontrolled without throwing', () => {
    expect(navigationWouldBeSilent({ onLine: false, serviceWorker: undefined })).toBe(true)
    expect(navigationWouldBeSilent({ onLine: true, serviceWorker: undefined })).toBe(false)
  })
})
