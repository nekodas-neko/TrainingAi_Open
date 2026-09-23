// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createScrimController } from '../status-bar-scrim-controller'

/**
 * DV-6. On the phone a missing scrim and a mis-scoped one look identical — nothing there — so the
 * device check cannot isolate any of this. Every case that can silently be wrong is driven here.
 */
let paint: ReturnType<typeof vi.fn>
let shown: boolean

function controller() {
  paint = vi.fn((v: boolean) => { shown = v })
  const c = createScrimController(paint)
  document.addEventListener('scroll', c.onScroll, true)
  return c
}

/** The shell's shape: a marked panel wrapping its own scroller. */
function panel(active: boolean) {
  const p = document.createElement('div')
  p.setAttribute('data-tab-active', String(active))
  const scroller = document.createElement('div')
  p.appendChild(scroller)
  document.body.appendChild(p)
  return { p, scroller }
}

const scrollTo = (el: Element, top: number) => {
  Object.defineProperty(el, 'scrollTop', { value: top, configurable: true })
  // bubbles:false, exactly as a real scroll behaves — so it can ONLY reach a capture listener.
  el.dispatchEvent(new Event('scroll', { bubbles: false }))
}

beforeEach(() => { document.body.innerHTML = ''; shown = false })

describe('DV-6 — when the status-bar scrim shows', () => {
  it('shows nothing until something scrolls', () => {
    controller().reevaluate()
    expect(shown).toBe(false)
  })

  it('shows when the panel on show scrolls', () => {
    const { scroller } = controller() && panel(true)
    scrollTo(scroller, 120)
    expect(shown).toBe(true)
  })

  it('ignores a scroll in a panel that is not on show', () => {
    controller()
    const { scroller } = panel(false)
    scrollTo(scroller, 400)
    expect(shown, 'a hidden panel must not paint over the visible screen').toBe(false)
  })

  it('ignores a rubber-band bounce below the threshold', () => {
    controller()
    const { scroller } = panel(true)
    scrollTo(scroller, 3)
    expect(shown).toBe(false)
  })

  it('hides again at the top', () => {
    controller()
    const { scroller } = panel(true)
    scrollTo(scroller, 300)
    expect(shown).toBe(true)
    scrollTo(scroller, 0)
    expect(shown).toBe(false)
  })

  it('paints only on a change, because this runs on every scroll frame', () => {
    controller()
    const { scroller } = panel(true)
    scrollTo(scroller, 100)
    scrollTo(scroller, 200)
    scrollTo(scroller, 300)
    expect(paint).toHaveBeenCalledTimes(1)
  })

  it('reappears on a flip back to a tab left scrolled down, with no scroll event', () => {
    // The open question DV-6 recorded. A panel keeps its offset while hidden, so nothing fires on
    // activation — the scrim has to re-read what it has already seen scroll.
    const c = controller()
    const home = panel(true)
    scrollTo(home.scroller, 300)
    expect(shown).toBe(true)

    home.p.setAttribute('data-tab-active', 'false')
    const health = panel(true)
    c.reevaluate()
    expect(shown, 'a tab never scrolled shows nothing').toBe(false)

    health.p.setAttribute('data-tab-active', 'false')
    home.p.setAttribute('data-tab-active', 'true')
    c.reevaluate()
    expect(shown, 'the offset survived the flip, so the scrim must too').toBe(true)
  })

  it('forgets a scroller whose screen was torn down', () => {
    const c = createScrimController(v => { shown = v })
    document.addEventListener('scroll', c.onScroll, true)
    const { p, scroller } = panel(true)
    scrollTo(scroller, 300)
    expect(shown).toBe(true)
    p.remove()
    c.reevaluate()
    expect(shown, 'a detached node must not pin the scrim on').toBe(false)
  })
})

/**
 * The tests above register the listener themselves, so they prove the controller's logic GIVEN
 * capture delivery — not that the component asks for it. The component is `.tsx` and these vitest
 * projects cannot import one, so its four wiring constraints are pinned by reading the source.
 * Each one fails silently on device if it regresses.
 */
describe('DV-6 — the component wires the controller correctly', () => {
  const src = () =>
    readFileSync(path.join(__dirname, '../../../components/shell/status-bar-scrim.tsx'), 'utf8')

  it('registers the scroll listener in the CAPTURE phase', () => {
    // Without `true` a non-bubbling scroll from an inner container never arrives and the scrim is
    // simply dead — which looks exactly like the bug it fixes.
    expect(src()).toMatch(/addEventListener\('scroll',\s*controller\.onScroll,\s*true\)/)
    expect(src()).toMatch(/removeEventListener\('scroll',\s*controller\.onScroll,\s*true\)/)
  })

  it('re-evaluates on activation, which is the tab-flip case', () => {
    expect(src()).toMatch(/controller\.reevaluate\(\)/)
    expect(src(), 'the effect must re-run per tab').toMatch(/\},\s*\[activeKey\]\)/)
  })

  it('fades from --background, never --page-bg', () => {
    // DynamicBackground sets `--page-bg: transparent`, so a gradient built from it vanishes in
    // exactly the case the scrim exists for.
    expect(src()).toContain('var(--background)')
    expect(src()).not.toContain('var(--page-bg)')
  })

  it('uses the floored safe-area height and stays under the warning banners', () => {
    // An empty `pt-safe` div is exactly inset-height, and the gradient paints over the padding
    // box. The utility floors at 1rem, which matters because three-button navigation reports the
    // inset as 0 — and referencing `--pt-safe-value` by hand trips the Custom Rules check that
    // every safe-area utility must be a defined class.
    expect(src()).toMatch(/className="pt-safe /)
    expect(src()).not.toMatch(/env\(safe-area-inset-top/)
    expect(src()).not.toContain('--pt-safe-value')
    expect(src(), 'z-[60] belongs to local-store-dead-banner and the offline pill').toContain('z-40')
  })
})
