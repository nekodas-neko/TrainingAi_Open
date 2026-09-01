import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * BF-95 — a declared contract that nothing honoured, and BF-96's sibling asymmetry.
 *
 * `swipe-actions.tsx` sets `data-swipe-actions` on every row with a comment saying exactly what it
 * is for: *"marks the row as owning horizontal gestures that start on it, the way
 * `data-swipe-carousel` already marks a carousel."* The tab navigator's exclusion list did not
 * contain it. **The marker was set and never read** — so a swipe-to-delete begun inside the 24 px
 * edge strip ran both gestures from one touch.
 *
 * **These are source guards because the failure is a touch interaction.** Both vitest projects run
 * `environment: 'node'`; the navigator listens on `document` and the wrap is a CSS reflow, so
 * neither renders here. What can be pinned is the pairing that was broken: one side declares a
 * marker, the other must read it — which is precisely the shape that decayed unnoticed.
 */

const ROOT = join(__dirname, '..', '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
/** Comments stripped: the entries and the fixes are both described in prose in these files. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')

describe('BF-95 — the swipe marker is read by the navigator', () => {
  it('every surface that declares the marker is excluded from the tab swipe', () => {
    const primitive = code('components/ui/swipe-actions.tsx')
    const navigator = code('components/shell/tab-swipe-navigator.tsx')

    // The pairing, asserted from BOTH ends: if the primitive stops setting it this fails too, which
    // is right — the entry says the marker is the correct mechanism and the navigator was the wrong
    // side, so removing the marker instead of honouring it must not read as fixed.
    expect(primitive, 'the primitive must still declare the marker').toMatch(/data-swipe-actions/)
    expect(navigator, 'and the navigator must exclude it').toMatch(/\[data-swipe-actions\]/)
  })

  it('the other horizontal-gesture markers stay excluded', () => {
    const navigator = code('components/shell/tab-swipe-navigator.tsx')
    for (const sel of ['[data-swipe-carousel]', '.overflow-x-auto', '[data-hscroll]']) {
      expect(navigator, `${sel} must remain in the exclusion list`).toContain(sel)
    }
  })
})

describe('BF-96 — the header chip resists compression like its sibling', () => {
  it('the chip root carries the two classes the date already had', () => {
    // The row has exactly two items; the date is `whitespace-nowrap shrink-0`, so before this the
    // chip absorbed every shortfall and `UV 5` wrapped at its own space.
    const chip = code('components/weather-chip.tsx')
    // The CONTENT root, not the loading skeleton five lines above it — that shares
    // `rounded-full bg-muted/60` and is a fixed `h-[26px] w-14` box that cannot wrap. Matching it
    // instead is how the first version of this guard failed, which is the useful kind of failure.
    const root = chip.split('\n').find(l => l.includes('flex items-center gap-1') && l.includes('rounded-full')) ?? ''
    expect(root, 'the chip content root should be findable').not.toBe('')
    expect(root).toContain('whitespace-nowrap')
    expect(root).toContain('shrink-0')
  })

  it('the sibling date still refuses to wrap or shrink, which is why the chip must too', () => {
    const header = code('app/session-select/session-select-content.tsx')
    // If the date ever becomes compressible this guard is the wrong shape — but it would also mean
    // the row's behaviour under pressure changed, which is worth a failing test rather than silence.
    expect(header).toMatch(/whitespace-nowrap shrink-0/)
  })
})
