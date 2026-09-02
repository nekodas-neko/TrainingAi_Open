import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * Q-111 — the device battery chips in the Home header, and the swap that put them there.
 *
 * **The weather assertion is the point of the first test.** The header used to render `WeatherChip`
 * directly; it now renders `HeaderChips`, which renders the weather chip plus whichever devices have
 * a reading. That swap was made to keep `session-select-content.tsx` at exactly the line count its
 * shrink-only baseline allows — and a swap that quietly dropped the weather chip would look like
 * nothing at all in a diff that adds two features.
 *
 * The strap's value is seeded through `localStorage`, which is where the store lives: it is a fact
 * about one strap paired to one phone, so it must not sync. That also makes this the one part of
 * the feature a browser can exercise — the native `polarStatus` listener needs the APK and a Polar
 * H10, and the ring's half needs a BLE reading the seeded account does not have.
 */

const STRAP_KEY = 'ta_strap_battery_v1'

async function seedStrap(page: import('@playwright/test').Page, percent: number, ageMs: number) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [STRAP_KEY, JSON.stringify({ percent, at: Date.now() - ageMs })] as const,
  )
}

test.setTimeout(180_000)

test('the header still shows the weather after the chip row was extracted', async ({ page }) => {
  // Both halves are stubbed because neither exists in the sandbox: `open-meteo` is an external host
  // the egress proxy drops, and without granted coordinates `useWeather` never asks for it. Written
  // first without them, this assertion failed on a header that was working — a spec failing for its
  // own reasons, which is indistinguishable from a broken feature until you look.
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: -27.4698, longitude: 153.0251 })
  await page.route('**://api.open-meteo.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      current: { temperature_2m: 24, weather_code: 0, uv_index: 2 },
      daily: { sunrise: ['2026-09-02T06:00'], sunset: ['2026-09-02T17:30'] },
    }),
  }))

  await page.goto('/')
  await settleRouteBoundary(page)
  // The chip renders a temperature with a degree sign; its skeleton carries no text at all.
  await expect(page.locator('text=/^\\d+°$/').first()).toBeVisible({ timeout: 60_000 })
})

test('a stored strap reading renders as a chip, and a stale one says when it was seen', async ({ page }) => {
  await seedStrap(page, 72, 5 * 60_000)
  await page.goto('/')
  await settleRouteBoundary(page)

  const fresh = page.getByLabel('Strap battery 72%')
  await expect(fresh).toBeVisible({ timeout: 60_000 })
  await expect(fresh).toHaveText('72%')

  // Older than the 3h staleness rule: the same chip, still on screen, now saying it is a last-seen
  // value. A chip that vanished would read as "no strap" rather than "not connected right now",
  // which is the state a chest strap is in for most of the day.
  await page.context().clearCookies({ name: 'nothing' }).catch(() => {})
  await seedStrap(page, 41, 26 * 60 * 60_000)
  await page.goto('/')
  await settleRouteBoundary(page)
  await expect(page.getByLabel(/Strap battery 41%, last seen 26h ago/)).toBeVisible({ timeout: 60_000 })
})

test('no chip is drawn for a device with no reading', async ({ page }) => {
  // The seeded account has no BLE ring battery, so the ring chip must be absent rather than showing
  // a zero — and the scale has no battery capability anywhere, so it never has a chip at all.
  await seedStrap(page, 63, 60_000)
  await page.goto('/')
  await settleRouteBoundary(page)

  // **Anchor on something present first.** `toHaveCount(0)` is satisfied by a page that failed to
  // render at all, so on its own this test passed against a header crashing on a null ring — which
  // is exactly the defect it is here to catch. Mutation-checked: without this line, forcing the ring
  // chip to render `ring.percent` unconditionally leaves all three tests green.
  await expect(page.getByLabel('Strap battery 63%')).toBeVisible({ timeout: 60_000 })

  await expect(page.getByLabel(/Ring battery/)).toHaveCount(0)
  await expect(page.getByLabel(/Scale battery/)).toHaveCount(0)
})
