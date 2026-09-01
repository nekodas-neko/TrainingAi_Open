import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
/** Comments in these files quote the route paths while explaining the history, so an assertion that
 *  matched raw source would pass on prose alone — the failure mode already on this repo's record. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const CONSOLES = [
  { route: '/admin/oura-ble',     page: 'app/admin/oura-ble/page.tsx' },
  { route: '/admin/cadence',      page: 'app/admin/cadence/page.tsx' },
  { route: '/admin/data-capture', page: 'app/admin/data-capture/page.tsx' },
]

/**
 * Q-531. The owner's answer when asked where the drain / re-sync / verify flow belongs:
 * *"it should be behind the admin portal — as regular users should not be able to touch it."*
 *
 * That is an access-control requirement, not a layout preference, and nothing asserted it. The
 * routes happened to satisfy it already — Q-234 moved the LINKS to Settings → Developer and left the
 * routes under `/admin` — which is exactly the shape that decays silently, because the page that
 * links a console is not the page that guards it.
 */
describe('the device consoles are gated, not merely unlinked', () => {
  it.each(CONSOLES)('$route redirects a non-admin', ({ page }) => {
    const src = code(read(page))
    // Hiding a page is not gating it: the check must be in the server component, before render.
    expect(src).toMatch(/isAdminUser\(/)
    expect(src).toMatch(/redirect\('\/'\)/)
    expect(src).toMatch(/redirect\('\/sign-in'\)/)
  })

  it('lists every console from the admin console itself', () => {
    // The owner went to /admin and found nothing there. Reachability is the other half of the
    // decision, and a route nobody can find is the defect this entry was filed about.
    const src = code(read('app/admin/admin-content.tsx'))
    for (const { route } of CONSOLES) expect(src, route).toContain(route)
  })

  it('does not also list them from Settings → Developer', () => {
    // Two homes is what "spread out sporadically" meant. Diagnostics stay there; devices do not.
    const src = code(read('app/more/settings/developer/developer-content.tsx'))
    for (const { route } of CONSOLES) expect(src, route).not.toContain(route)
  })
})

/**
 * Q-544, which the Q-531 re-ordering put at risk: these two cards read `/api/oura-ble/*` and touch
 * no plugin, so they answer on a desktop. Inside `OuraBleDebug` they were reachable only from the
 * APK — the one client a `VACUUM FULL` blocks, and unreachable at all while the APK is broken or
 * mid-rebuild, which is exactly when a full volume is most likely.
 */
describe('the two server-only cards stay ahead of the native console', () => {
  it('renders DbFootprintCard and DeviceMetricsPanel before OuraBleDebug', () => {
    const src = code(read('app/admin/oura-ble/page.tsx'))
    const at = (tag: string) => {
      const i = src.indexOf(`<${tag}`)
      expect(i, `${tag} is not rendered`).toBeGreaterThan(-1)
      return i
    }
    expect(at('DbFootprintCard')).toBeLessThan(at('OuraBleDebug'))
    expect(at('DeviceMetricsPanel')).toBeLessThan(at('OuraBleDebug'))
  })

  it('puts the page in runbook order rather than a flat stack', () => {
    const src = code(read('app/admin/oura-ble/page.tsx'))
    const steps = [...src.matchAll(/step=\{(\d+)\}/g)].map(m => Number(m[1]))
    expect(steps.length, 'the sections were removed').toBeGreaterThanOrEqual(4)
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
    expect(new Set(steps).size, 'two sections share a step number').toBe(steps.length)
  })
})
