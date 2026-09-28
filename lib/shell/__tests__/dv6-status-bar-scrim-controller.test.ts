// @vitest-environment jsdom
import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createScrimController } from '../status-bar-scrim-controller'

/**
 * DV-6. On the phone a missing scrim and a mis-scoped one look identical — nothing there — so the
 * device check cannot isolate any of this. Every case that can silently be wrong is driven here.
 */
let shown: boolean
/** Counts the PAINTS, not the events — this runs on every scroll frame, so the difference matters. */
let paints: number

// Detached in afterEach. Without that every case's controller stays on `document` and keeps
// painting — which a per-test `vi.fn` hides, because each assertion then reads only its own spy.
// The shared counter is what surfaced it: six controllers, six paints, one expected.
let attached: Array<(e: Event) => void> = []

function controller() {
  const c = createScrimController(v => { shown = v; paints += 1 })
  document.addEventListener('scroll', c.onScroll, true)
  attached.push(c.onScroll)
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

beforeEach(() => { document.body.innerHTML = ''; shown = false; paints = 0 })
afterEach(() => {
  for (const h of attached) document.removeEventListener('scroll', h, true)
  attached = []
})

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
    expect(paints).toBe(1)
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

  it('a pushed route scrolls the DOCUMENT, whose scroll target is not an Element', () => {
    // Measured at 412 px on `/health/sleep`: no inner scroller, no panel, `documentScrolls: true`
    // and the event target is the Document. The old handler returned early on exactly that, so the
    // scrim could not have worked there even once it was mounted.
    const c = controller()
    // jsdom leaves `document.scrollingElement` null; a browser does not — the 412 px probe read the
    // document's offset through it. Stubbed rather than given a fallback in the controller, which
    // would be error handling for a case the canonical runtime cannot produce.
    const html = document.documentElement
    Object.defineProperty(document, 'scrollingElement', { value: html, configurable: true })
    Object.defineProperty(html, 'scrollTop', { value: 200, configurable: true })
    document.dispatchEvent(new Event('scroll', { bubbles: false }))
    expect(shown, 'a document scroll with no panels on the page must show the scrim').toBe(true)
    c.reevaluate()
    expect(shown, 'and must survive a re-evaluate').toBe(true)
  })

  it('a hidden panel still loses, which is the rule the pushed-route case had to not break', () => {
    // The scoping is stated as "not inside a panel that is off show" rather than "inside the panel
    // on show" — the positive form excluded a pushed route along with the hidden panels.
    controller()
    const { scroller } = panel(false)
    scrollTo(scroller, 400)
    expect(shown).toBe(false)
  })

  it('forgets a scroller whose screen was torn down', () => {
    const c = controller()
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
    // DV-22 removed the `activeKey` prop when the mount moved to the root layout, so the two
    // no-scroll-event cases need two signals. Losing either is silent: the scrim simply stays as
    // whatever the last screen left it.
    expect(src(), 'a route change must re-run the effect').toMatch(/\},\s*\[pathname\]\)/)
    expect(src(), 'a tab flip fires no scroll event and does not move the router')
      .toMatch(/attributeFilter:\s*\['data-tab-active'\]/)
  })

  it('is mounted once, in the only layout every route shares', () => {
    // The DV-22 defect itself: DV-6 mounted it in `tab-shell.tsx`, so a pushed route got nothing.
    // A second mount would be two gradients stacked on the tab routes.
    const root = path.join(__dirname, '../../../app/layout.tsx')
    expect(readFileSync(root, 'utf8')).toContain('<StatusBarScrim />')
    const shell = readFileSync(path.join(__dirname, '../../../components/shell/tab-shell.tsx'), 'utf8')
    expect(shell, 'the shell mount is what DV-22 removed').not.toContain('<StatusBarScrim')
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
