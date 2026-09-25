import { test, expect } from '@playwright/test'

/**
 * OR-162's unmeasured question: **how many canvases are actually mounted across the five tabs at
 * once.** It decides between that entry's three directions, and it had never been counted — only
 * estimated from 20 files importing `react-chartjs-2`.
 *
 * This is a CENSUS, not a pass/fail gate on timing. It asserts only the shape the fix depends on
 * (charts are mounted in panels that are not being looked at, so a reveal re-measures them). The
 * real timing gate is DV-12's `perf.js longtasks` on the S25, which the web build cannot stand in
 * for — a desktop Chromium at 384 px is not a Samsung WebView.
 */
// Workout last: it is the one tab whose content can take over the screen, and a census only needs
// each panel to have been mounted once — TabShell keeps them alive afterwards.
const TABS = ['Health', 'Nutrition', 'More', 'Workout', 'Home'] as const

/** The dev overlay's `<nextjs-portal>` covers the bottom corner and eats taps on the bottom nav. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const paint = () => {
      const style = document.createElement('style')
      style.textContent = 'nextjs-portal{display:none!important}'
      document.head.appendChild(style)
    }
    if (document.head) paint()
    else document.addEventListener('DOMContentLoaded', paint)
  })
})

test('OR-162 — census: canvases mounted per tab, and how many are hidden at any moment', async ({ page }) => {
  await page.setViewportSize({ width: 384, height: 854 })
  await page.goto('/')
  await page.waitForSelector('[data-tab-active]', { timeout: 30_000 })

  // Visit every tab so each panel has mounted and fetched; TabShell keeps them alive afterwards.
  for (const label of TABS) {
    const link = page.locator('nav').getByRole('link', { name: label, exact: true })
    if (!(await link.count())) { console.info(`OR-162 census: no nav link for ${label}, skipped`); continue }
    await link.click()
    // Charts fetch before they draw; a short settle is what makes this a census of the steady
    // state rather than of whatever had loaded by the time the click returned.
    await page.waitForTimeout(2500)
  }

  const census = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('[data-tab-active]'))
    const perPanel = panels.map((p) => {
      const canvases = Array.from(p.querySelectorAll('canvas'))
      return {
        active: p.getAttribute('data-tab-active') === 'true',
        canvases: canvases.length,
        // A canvas with a zero box is one whose reveal will change its observed size — the
        // resize-observer trigger OR-162 names.
        zeroBox: canvases.filter((c) => c.getBoundingClientRect().width === 0).length,
      }
    })
    return {
      panels: perPanel.length,
      total: perPanel.reduce((n, p) => n + p.canvases, 0),
      hidden: perPanel.filter((p) => !p.active).reduce((n, p) => n + p.canvases, 0),
      zeroBoxHidden: perPanel.filter((p) => !p.active).reduce((n, p) => n + p.zeroBox, 0),
      perPanel,
    }
  })

  console.info('OR-162 canvas census:', JSON.stringify(census, null, 2))

  expect(census.panels).toBeGreaterThan(0)

  // The invariant RV-113 and OR-162 both rest on: a hidden panel is hidden by
  // `content-visibility`, so its subtree is NOT laid out and everything inside it has no box
  // until the reveal. Take that away and OR-162's mechanism disappears — and so does the
  // 21.3%-of-main-thread reason it was added. This is the part worth guarding in CI.
  const hiddenAreContained = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-tab-active="false"]'))
      .every((p) => getComputedStyle(p).contentVisibility === 'hidden'))
  expect(hiddenAreContained).toBe(true)

  // NOT asserted: a canvas count. It is account-dependent — charts reach a tab panel only through
  // the owner's Home widget configuration and the Health sections that have data — and on the
  // seeded account it measured 0 across 4 mounted panels. Asserting a number here would either
  // pin the seed's poverty or break when the seed gains data. The count OR-162 wants can only be
  // taken on the device.
})
