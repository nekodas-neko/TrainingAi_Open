import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  openSurface, closeSurface, handlePop, resetSheetBackStack, type HistoryLike,
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
