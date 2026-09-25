import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  openSurface, closeSurface, handlePop, releaseAllSurfaceEntries, releaseTopSurfaceEntry,
  resetSheetBackStack, type HistoryLike,
} from '../sheet-back-stack'

/**
 * The three sequences that have each broken back-dismissal once, driven directly.
 *
 * Every one of them was found on a device or in an e2e run, because while this
 * logic lived inside an effect there was nothing smaller to aim at. The SIBLING
 * case (BF-34) in particular cannot be staged through the UI in the web sandbox:
 * it needs a sheet to close and a dialog to open in the same tick with a
 * `history.back()` already in flight, and a coordinate tap on the bin that opens
 * it is not even actionable in Chromium.
 */

/** A fake session history: records pushes, and models `back()` as the async
 *  traversal it is — the caller decides when the pop lands, which is the whole
 *  hazard. `history.back()` resolves its delta when it is CALLED, so the state
 *  the pop carries is the one below wherever the pointer was at that moment. */
function fakeHistory() {
  const entries: unknown[] = [null] // the page itself
  let pointer = 0
  const queued: unknown[] = []
  const history: HistoryLike = {
    pushState(state) {
      entries.length = pointer + 1
      entries.push(state)
      pointer = entries.length - 1
    },
    back() {
      queued.push(entries[Math.max(0, pointer - 1)])
    },
  }
  return {
    history,
    /** The state the next queued pop will carry, in call order. */
    deliverPop: () => queued.shift() ?? null,
    pending: () => queued.length,
    top: () => entries[pointer],
    depthOfTop: () => (entries[pointer] as { sheetDepth?: number } | null)?.sheetDepth ?? 0,
  }
}

beforeEach(() => resetSheetBackStack())

describe('a single sheet', () => {
  it('closes on a real back gesture, and does not undo an entry it no longer has', () => {
    const h = fakeHistory()
    const close = vi.fn()
    const sheet = openSurface('sheet', close, h.history)
    expect(h.depthOfTop()).toBe(1)

    handlePop(null, h.history) // arrived at the page: depth 0
    expect(close).toHaveBeenCalledTimes(1)

    // React then unmounts it. The entry is already gone, so this must NOT fire
    // another back() — that would take the page out from under the user.
    closeSurface(sheet, h.history)
    expect(h.pending()).toBe(0)
  })

  it('undoes its own entry when it is closed by anything else', () => {
    const h = fakeHistory()
    const sheet = openSurface('sheet', vi.fn(), h.history)
    closeSurface(sheet, h.history)
    expect(h.pending()).toBe(1)

    // Our own pop, swallowed rather than treated as a gesture. Nothing is open,
    // and the flag must still be consumed or the next sheet skips its push.
    handlePop(h.deliverPop(), h.history)
    const next = openSurface('next', vi.fn(), h.history)
    expect(next.pushed, 'the next sheet must get its own entry').toBe(true)
  })
})

describe('BF-34 — the sibling case: one surface closes as another opens', () => {
  it('leaves the dialog open, and gives it an entry', () => {
    const h = fakeHistory()
    const sheetClose = vi.fn()
    const dialogClose = vi.fn()

    const sheet = openSurface('sheet', sheetClose, h.history)

    // The bin: `onClose(); onDelete(id)` in one tick. React runs the unmounting
    // cleanup before the mounting effect.
    closeSurface(sheet, h.history)
    const dialog = openSurface('dialog', dialogClose, h.history)

    // Now the sheet's back() lands. Before BF-34 this was indistinguishable
    // from a real gesture and the dialog closed on the frame it opened.
    handlePop(h.deliverPop(), h.history)

    expect(dialogClose, 'the dialog must survive its sibling closing').not.toHaveBeenCalled()
    expect(dialog.pushed, 'and must hold an entry, or its own back does nothing').toBe(true)
  })

  it('the dialog still closes on a real back gesture afterwards', () => {
    const h = fakeHistory()
    const dialogClose = vi.fn()
    const sheet = openSurface('sheet', vi.fn(), h.history)
    closeSurface(sheet, h.history)
    openSurface('dialog', dialogClose, h.history)
    handlePop(h.deliverPop(), h.history)

    handlePop(null, h.history)
    expect(dialogClose).toHaveBeenCalledTimes(1)
  })
})

describe('LB-17 — three layers unwind one press at a time', () => {
  it('a back from the top closes only the top', () => {
    const h = fakeHistory()
    const logger = vi.fn()
    const list = vi.fn()
    const detail = vi.fn()
    openSurface('logger', logger, h.history)
    openSurface('list', list, h.history)
    openSurface('detail', detail, h.history)

    // Back lands on the LIST's entry, depth 2. An id comparison read that as
    // "not mine" for the logger too, and took two layers with one press.
    handlePop({ sheetId: 'list', sheetDepth: 2 }, h.history)

    expect(detail).toHaveBeenCalledTimes(1)
    expect(list).not.toHaveBeenCalled()
    expect(logger).not.toHaveBeenCalled()
  })

  it('and the page entry closes all of them', () => {
    const h = fakeHistory()
    const a = vi.fn(); const b = vi.fn()
    openSurface('a', a, h.history)
    openSurface('b', b, h.history)
    handlePop(null, h.history)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })
})

describe('LB-10 — StrictMode mounts, unmounts and remounts on one frame', () => {
  it('does not close the sheet on the frame it opened, and it keeps an entry', () => {
    const h = fakeHistory()
    const close = vi.fn()

    const first = openSurface('sheet', close, h.history)
    closeSurface(first, h.history)                       // StrictMode cleanup
    const second = openSurface('sheet', close, h.history) // and its re-run

    handlePop(h.deliverPop(), h.history)

    expect(close, 'a sheet that closes as it opens reads as unopenable').not.toHaveBeenCalled()
    expect(second.pushed).toBe(true)
  })
})

describe('BF-165 / DV-2 — a navigation takes over the closing surface\'s entry', () => {
  it('the close pops NOTHING once the entry is released, which is the whole fix', () => {
    const h = fakeHistory()
    const sheet = openSurface('log-activity', vi.fn(), h.history)
    expect(sheet.pushed).toBe(true)

    // `selectType`: release, then close, then navigate. On the S25 the close landed 7 ms after the
    // push and ate it; the sibling test above ("undoes its own entry") is the control showing the
    // pop that would otherwise happen here.
    expect(releaseTopSurfaceEntry()).toBe(true)
    closeSurface(sheet, h.history)

    expect(h.pending(), 'a queued back() here is the navigation being undone').toBe(0)
  })

  it('does not leak a pending self-pop, so the next surface still gets an entry', () => {
    // The failure this rules out is subtle and would only show up one surface later: if the release
    // incremented `pendingSelfPops` (as `closeSurface` does), the NEXT surface to open would skip its
    // push, waiting for a pop that is never coming — and its back gesture would navigate the page.
    const h = fakeHistory()
    const sheet = openSurface('log-activity', vi.fn(), h.history)
    releaseTopSurfaceEntry()
    closeSurface(sheet, h.history)

    const next = openSurface('next', vi.fn(), h.history)
    expect(next.pushed).toBe(true)
  })

  it('returns false when the top surface never pushed, which is the -1 / push branch', () => {
    // Not defensive padding: `openSurface` deliberately skips the push while one of our own pops is
    // in flight, so a surface genuinely can have no entry. DV-2 must then go back ONE, and BF-165
    // must `push` rather than `replace` — overwriting an entry that is not the surface's would eat
    // the page underneath.
    const h = fakeHistory()
    const first = openSurface('first', vi.fn(), h.history)
    closeSurface(first, h.history)                      // a self-pop is now in flight
    const second = openSurface('second', vi.fn(), h.history)
    expect(second.pushed, 'precondition: this surface skipped its push').toBe(false)

    expect(releaseTopSurfaceEntry()).toBe(false)
  })

  it('returns false with nothing open', () => {
    expect(releaseTopSurfaceEntry()).toBe(false)
  })

  it('releaseTopSurfaceEntry takes exactly one entry — what `replace` can overwrite', () => {
    // The forward case travels one entry: `router.replace` overwrites the CURRENT one, which is the
    // top surface's. It cannot reach a second, so this must not claim one — the surface underneath
    // still owns its entry and still has to undo it.
    const h = fakeHistory()
    const sheet = openSurface('sheet', vi.fn(), h.history)
    const dialog = openSurface('dialog', vi.fn(), h.history)

    expect(releaseTopSurfaceEntry()).toBe(true)
    expect(dialog.pushed).toBe(false)
    expect(sheet.pushed, 'the sheet underneath still owns its entry').toBe(true)

    closeSurface(dialog, h.history)
    expect(h.pending(), 'the dialog pops nothing').toBe(0)
    closeSurface(sheet, h.history)
    expect(h.pending(), 'the sheet still undoes its own').toBe(1)
  })

  it('releaseAllSurfaceEntries counts every stacked entry, which is how far DV-2 has to travel', () => {
    // **The reachable case, and `go(-2)` is wrong for it.** The Capacitor back handler checks the
    // three session guards BEFORE `hasOpenSurface()`, deliberately, so a mid-workout back press with
    // a sheet already open raises "Leave workout?" ON TOP of it. History is
    // `[…, /workout, sheet, dialog]` and a go(-2) from the dialog lands on `/workout` — the screen
    // Leave exists to leave. Releasing does not REMOVE the entries, it only stops the surfaces
    // popping them, so the caller has to cross all of them in one call.
    const h = fakeHistory()
    const sheet = openSurface('sheet', vi.fn(), h.history)
    const dialog = openSurface('dialog', vi.fn(), h.history)

    expect(releaseAllSurfaceEntries()).toBe(2)
    expect(sheet.pushed).toBe(false)
    expect(dialog.pushed).toBe(false)

    closeSurface(dialog, h.history)
    closeSurface(sheet, h.history)
    expect(h.pending(), 'neither may pop — the navigation crossed both entries').toBe(0)
  })

  it('and does not count a surface that skipped its push', () => {
    // Travelling one entry too far would leave a screen the user never asked to leave.
    const h = fakeHistory()
    const first = openSurface('first', vi.fn(), h.history)
    closeSurface(first, h.history)                      // a self-pop is now in flight
    const second = openSurface('second', vi.fn(), h.history)
    expect(second.pushed, 'precondition: this surface skipped its push').toBe(false)

    expect(releaseAllSurfaceEntries()).toBe(0)
  })

  it('counts 0 with nothing open, so the caller still goes back one', () => {
    expect(releaseAllSurfaceEntries()).toBe(0)
  })

  it('a real back gesture arriving after the release still closes the surface', () => {
    // The release removes the ENTRY, not the surface: until React unmounts it, a genuine gesture
    // must still be able to dismiss it rather than falling through to the page.
    const h = fakeHistory()
    const close = vi.fn()
    openSurface('sheet', close, h.history)
    releaseTopSurfaceEntry()

    handlePop(null, h.history)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
