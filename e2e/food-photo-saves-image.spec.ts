import { test, expect, type Locator, type Page } from '@playwright/test'
import { deflateSync } from 'node:zlib'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary, suppressMorningCheckin, tapCentre } from './fixtures'

/**
 * Photographing a food leaves a picture on the food (OR-108).
 *
 * Owner: *"scanning barcodes still doesn't auto save an image for the food; or does taking a photo
 * of the food save the image either."* Every layer beneath the capture screens already carried
 * `imageDataUri` — the route accepts it, `createFoodItem` stores it, the pull delta and the local
 * mirror keep it — and **both capture paths dropped it on the way in**. This covers the camera
 * half; the barcode half is `ingredient-picker.tsx`'s payload, which needs a camera to reach and
 * is guarded in `components/nutrition/__tests__/food-image-write-paths.test.ts` instead.
 *
 * **The web `<input>` is the same code path the phone takes.** `handlePhoto` is what both the
 * hidden input and the Capacitor picker feed, and the thumbnail is produced from the preview data
 * URL that both of them set — so the canvas re-encode under test here is the one that runs on the
 * S25. What the harness cannot exercise is the plugin's own capture, which is a permissions and
 * `CameraResultType` question rather than an image one.
 *
 * The scan itself is stubbed: it reaches an AI model, so a live run would be non-deterministic and
 * would cost a call per run. What is under test is everything the response passes through.
 */

// `public/sw-template.js` re-issues every `/api/` request from the worker, where `page.route`
// cannot see it. Any spec that stubs an `/api/` route in this app needs this line.
test.use({ serviceWorkers: 'block' })

const FOOD_NAME = 'Spec Photographed Bowl'

const SCAN = {
  name: FOOD_NAME,
  servingSizeG: 250,
  calories: 420,
  proteinG: 30,
  carbsG: 40,
  fatG: 12,
  confidence: 'high',
  // The route answers with macros and no picture — which is exactly why the photo has to be
  // attached client-side. A stub that supplied one would test nothing.
  origin: 'photo',
}

/**
 * A real 600 × 400 PNG, built rather than pasted.
 *
 * **The size is the point.** A 1 × 1 pixel would pass `downscaleToThumbDataUrl` without ever
 * scaling anything, so the assertion below would hold against a helper that does nothing at all.
 * This is larger than the 128 px box in both dimensions and carries enough variation that the WebP
 * encoder cannot collapse it to a handful of bytes.
 */
function gradientPng(width: number, height: number): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3)
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 3
      raw[p] = (x * 7 + y * 3) % 256
      raw[p + 1] = (x * 3 + y * 11) % 256
      raw[p + 2] = (x * 13 + y * 5) % 256
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

/**
 * The spec mints a real `food_item` and a real `food_log`, so it cleans up after itself — without
 * this it passes on a fresh database and then matches its own leftovers from the second local run
 * onward. CI provisions a fresh database every run and would never show it.
 */
async function cleanup() {
  await withDb(async db => {
    await db.query('DELETE FROM food_logs WHERE food_item_id IN (SELECT id FROM food_items WHERE name = $1)', [FOOD_NAME])
    await db.query('DELETE FROM food_items WHERE name = $1', [FOOD_NAME])
  })
}

test.beforeAll(cleanup)
test.afterAll(cleanup)

/** `.click()` never lands on this screen — see water-log-write-path.spec.ts (Q-354). */
async function tap(page: Page, target: Locator) {
  await expect(target).toBeVisible({ timeout: 30_000 })
  await target.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await tapCentre(page, target)
}

const button = (page: Page, name: RegExp | string) => page.getByRole('button', { name }).first()

/**
 * The confirm at the end of the flow is ALSO called "Log Food" — the same words as the tile that
 * opened the sheet, which is still in the DOM behind it. Unscoped, the tap lands on the opener and
 * the assign step simply sits there until the test times out.
 */
const inSheet = (page: Page, name: RegExp | string) =>
  page.getByRole('dialog').getByRole('button', { name }).first()

test('a photographed food is saved with its picture', async ({ page }) => {
  // The whole capture flow — sheet, pick, scan, review, assign, save — plus the read-back. The
  // suite's 45 s default is sized for a single screen.
  test.setTimeout(150_000)

  await page.route('**/api/nutrition/scan', route => route.fulfill({ json: SCAN }))

  let posted: { name?: string; imageDataUri?: string } | null = null
  await page.route('**/api/nutrition/food-items', async route => {
    if (route.request().method() === 'POST') posted = JSON.parse(route.request().postData() ?? '{}')
    await route.continue()
  })

  await suppressMorningCheckin(page)
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect(async () => {
    await tap(page, button(page, /^Log Food$/))
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })

  // By name: the capture row's input is not the only file input this sheet renders, and a bare
  // `input[type="file"]` reaches whichever comes first in the DOM (the trap BF-46 ①a fell into).
  // Setting the file is what fires `change` — the visible Photo tile only forwards a click to it.
  await page.setInputFiles('input[name="food-photo"]', {
    name: 'bowl.png', mimeType: 'image/png', buffer: gradientPng(600, 400),
  })

  await expect(page.getByAltText('Food photo'), 'the pick never reached the preview').toBeVisible({ timeout: 30_000 })
  await tap(page, inSheet(page, /^Analyse$/))

  await expect(page.getByRole('textbox').filter({ hasNot: page.locator('textarea') }).first())
    .toHaveValue(FOOD_NAME, { timeout: 30_000 })
  await tap(page, inSheet(page, /^Next$/))
  await tap(page, inSheet(page, /^Log Food$/))

  // **Asserted from the database, not from the request.** The POST body is checked too, but only
  // the stored row proves the picture survived the route's own validation — an over-cap or
  // wrong-typed image is rejected there, and the visible symptom of that is the whole save failing
  // rather than an imageless row.
  let stored: string | null = null
  await expect.poll(
    async () => {
      stored = await withDb(async db => {
        const { rows } = await db.query<{ image_data_uri: string | null }>(
          `SELECT fi.image_data_uri FROM food_items fi
             JOIN users u ON u.id = fi.user_id
            WHERE fi.name = $1 AND u.email = $2`,
          [FOOD_NAME, SEED_EMAIL],
        )
        return rows[0]?.image_data_uri ?? null
      })
      return stored
    },
    { message: 'the food saved without the photo the user just took', timeout: 30_000 },
  ).not.toBeNull()
  const image = stored as unknown as string

  // WebP, because a JPEG at the same box is roughly twice the bytes and `toDataURL` answers an
  // unsupported type with a PNG rather than an error — an unnoticed fallback is how a thumbnail
  // sails past a cap that nothing checks loudly.
  expect(image.startsWith('data:image/webp;base64,'), `stored as ${image.slice(0, 24)}`).toBe(true)

  // **Measured on the wire, because that is what refused it.** The route caps its whole body at
  // 8 KB while permitting a 16 KB image, and base64 costs a third more than the bytes it carries —
  // so this fixture's thumbnail 413'd the entire save at q0.8 until the quality ladder fitted it.
  // That mismatch is the route's to fix (LB-101); the assertion here is that the client never sends
  // a body the route will refuse.
  const encoded = image.length - image.indexOf(',') - 1
  expect(encoded, 'over the route body cap — this save would 413').toBeLessThanOrEqual(7 * 1024)
  expect(Math.ceil(encoded * 0.75), 'over FOOD_ITEM_IMAGE_MAX_BYTES').toBeLessThan(16 * 1024)
  expect(encoded, 'suspiciously small — did anything actually encode?').toBeGreaterThan(300)

  expect(posted).toMatchObject({ name: FOOD_NAME, imageDataUri: image })
})
