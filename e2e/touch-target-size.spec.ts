import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * Q-282 — the accessibility check a linter cannot make: **rendered touch-target size**.
 *
 * `eslint-plugin-jsx-a11y` already fails the Lint job on seven statically-decidable rules. What no
 * static rule can do is measure how big a control comes out, and that is the class this project
 * keeps finding by hand — the 2026-08-08 mobile-UI sweep found **7×7 px** targets by inspection.
 *
 * **Why this is hand-written rather than `axe-core`, measured 2026-08-30 before choosing.**
 * `@axe-core/playwright` was installed, run against all five tabs, and removed again:
 *
 * - **`target-size` cannot fail on this app.** WCAG 2.5.8 exempts an undersized control that has
 *   clear space around it, so a **12×12** button — created deliberately, `.tap-dense` so it escaped
 *   the CSS floor, and confirmed 12×12 by `boundingBox()` — was reported as a **pass**. A gate that
 *   green-lights a 12 px button is the guard-that-cannot-fail shape, and it would have read as
 *   coverage.
 * - **`color-contrast` cannot judge this app at all.** axe 4.13 reports *"Could not parse color
 *   string oklab(0.0499998 -4.88013e-7 0.00000116974 / 0.95)"* — the theme's tokens are `oklch` —
 *   and the dynamic-background layers produce *"background color could not be determined because it
 *   is overlapped by another element"*. On **Home it evaluated no nodes at all**. So
 *   `projectOverview.md`'s "contrast that could NOT be measured" still stands, now with a reason.
 *
 * This check enforces **this repo's own bar (48 dp)** rather than WCAG's 24 px, and covers the roles
 * `app/globals.css`'s floor does not: that floor is `button, [role="button"]`, so `<a>` (excluded on
 * purpose — an inline prose link is not a tap target), `role="tab"`, `role="radio"` and friends are
 * measured by nothing today.
 *
 * **The two documented opt-outs are honoured, not fought.** `.tap-target-44` and `.tap-target-dot`
 * give a small control an invisible hit box, and `globals.css` explains why each is sized as it is —
 * a hit area wider than the clearance steals a neighbour's taps. A control carrying one has made
 * that trade deliberately.
 */

const SCREENS = ['/', '/health', '/workout', '/nutrition', '/more'] as const

/**
 * Known undersized controls, shrink-only: an entry may be REMOVED when it is fixed, never added
 * without the reason it is acceptable. Same shape as `check-hex-literals.js`'s per-file baseline.
 */
/**
 * Undersized controls this spec tolerates, by screen and label.
 *
 * **Empty, and that is the point.** It held one entry — Home's APK-banner link at 258×33 — which
 * LB-26 fixed by giving that `<a>` its own `min-h-[48px]`. An allowlist that never empties is a
 * backlog wearing a test's clothes; removing the row is what makes this spec fail again if the floor
 * is lost, which is the whole reason the entry named the removal as part of its fix.
 */
const ALLOWED: Record<string, { label: string; why: string }[]> = {}

for (const path of SCREENS) {
  test(`${path} controls meet the 48 dp touch-target floor`, async ({ page }) => {
    test.setTimeout(120_000)
    // Radix aria-hidden's <main> behind the Morning Check-in modal, which would take most of the
    // page out of the DOM query and turn this into a scan of one dialog.
    await suppressMorningCheckin(page)
    await page.goto(path)
    await settleRouteBoundary(page)

    const measured = await page.evaluate(() => {
      const SELECTOR = [
        'button', '[role="button"]', 'a[href]', '[role="tab"]', '[role="radio"]', '[role="switch"]',
        '[role="checkbox"]', '[role="menuitem"]', '[role="link"]', 'input', 'select', 'textarea',
      ].join(',')
      const undersized: { label: string; size: string; tag: string }[] = []
      let total = 0
      for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue // not rendered
        total++
        if (r.width >= 48 && r.height >= 48) continue
        // A compensating hit box is a deliberate, documented trade — see globals.css.
        if (el.classList.contains('tap-target-44') || el.classList.contains('tap-target-dot')) continue
        undersized.push({
          label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
          size: `${Math.round(r.width)}×${Math.round(r.height)}`,
          tag: el.tagName.toLowerCase() + (el.getAttribute('role') ? `[${el.getAttribute('role')}]` : ''),
        })
      }
      return { undersized, total }
    })

    // Asserted, not assumed: a screen where the query matched nothing would report no violations and
    // pass. A count of zero means nothing beside a count of what was examined — the shape LB-19's
    // ink poll fell into.
    expect(measured.total, `${path}: no interactive elements found — this is not measuring anything`)
      .toBeGreaterThan(0)

    const allowed = ALLOWED[path] ?? []
    const unexpected = measured.undersized.filter(
      u => !allowed.some(a => u.label.startsWith(a.label)),
    )
    expect(
      unexpected.map(u => `${u.tag} ${u.size} "${u.label}"`),
      `${path}: below the 48 dp floor with no compensating hit box (add .tap-target-44 / `
        + `.tap-target-dot with a reason, or size the control up)`,
    ).toEqual([])
  })
}
