import { test, expect, type Page } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

// #2390 — inside TrainingAi Dev (`com.trainingai.app.dev`) the update card and "Download Android
// App" read the rolling `apk-latest` release, which carries the REAL app's APK. The Dev app offered
// the real app as its own update. The real app's ring key is safe (same signing key), but the offer
// bypasses the release train's "update the APK only when the release says so".
//
// Both flavours are driven through the same page with the Capacitor bridge faked, the way
// `walk-exit.spec.ts` does it: `androidBridge` makes the platform native, and `App.getInfo` answers
// with the app ID under test. The real-app case is half of the point: the fix must hide the entries
// in Dev and nowhere else.
test.use({ storageState: STORAGE_STATE, serviceWorkers: 'block' })

async function asApp(page: Page, appId: string) {
  await page.addInitScript((id: string) => {
    Object.defineProperty(window, 'androidBridge', { configurable: true, get: () => ({ postMessage() {} }) })
    ;(window as unknown as Record<string, unknown>).Capacitor = {
      PluginHeaders: [{
        name: 'App',
        methods: [
          { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' },
          { name: 'getLaunchUrl', rtype: 'promise' }, { name: 'getInfo', rtype: 'promise' },
        ],
      }],
      nativeCallback: () => Promise.resolve('stub'),
      nativePromise: (plugin: string, method: string) =>
        Promise.resolve(plugin === 'App' && method === 'getInfo'
          ? { id, name: 'TrainingAI', build: '1', version: '1.0.0' }
          : {}),
    }
  }, appId)
}

const downloadRow = (page: Page) => page.getByText('Download Android App', { exact: true })
const updateCard = (page: Page) => page.getByText(/Android build|New Android build/)

test('the Dev app offers neither the update card nor the APK download', async ({ page }) => {
  await asApp(page, 'com.trainingai.app.dev')
  // Not 'networkidle': a native-mode app keeps syncing, so the network never goes quiet.
  await page.goto('/more/about', { waitUntil: 'domcontentloaded' })

  // A line that is NOT conditional, so this cannot pass by the page simply not having loaded.
  await expect(page.getByText('Updates automatically — no reinstall needed')).toBeVisible({ timeout: 30_000 })
  await expect(downloadRow(page), 'the Dev app still offers the real app\'s APK').toHaveCount(0)
  await expect(updateCard(page), 'the Dev app still shows the real app\'s update card').toHaveCount(0)
  await expect(page.locator('a[href="/api/download-apk"]')).toHaveCount(0)
})

test('the real app keeps both', async ({ page }) => {
  await asApp(page, 'com.trainingai.app')
  await page.goto('/more/about', { waitUntil: 'domcontentloaded' })

  await expect(page.getByText('Updates automatically — no reinstall needed')).toBeVisible({ timeout: 30_000 })
  await expect(downloadRow(page)).toBeVisible()
  // The card shows its "Android build" header whatever the release lookup answers.
  await expect(updateCard(page).first()).toBeVisible({ timeout: 30_000 })
})

test('the web build keeps the download link (no native platform, nothing to hide)', async ({ page }) => {
  await page.goto('/more/about', { waitUntil: 'networkidle' })
  await expect(page.getByText('Updates automatically — no reinstall needed')).toBeVisible({ timeout: 30_000 })
  await expect(downloadRow(page)).toBeVisible()
})
