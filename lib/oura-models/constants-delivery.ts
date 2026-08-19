/**
 * Bring the model constants down from object storage at boot, so they can leave the repository.
 *
 * The constants are read synchronously (`constants/index.ts`), because two ports evaluate them at
 * module scope and making the getters async would turn a pair of plain constants into lifecycle
 * problems across every consumer. A synchronous getter cannot fetch, so something has to put the
 * files on disk first — that is this module, called from `instrumentation-node.ts` before any route
 * module loads.
 *
 * **Why boot rather than build.** The same reasoning the owner applied to the ONNX models (Q-49):
 * a build-time fetch needs credentials in the build environment and a new secret, and it breaks
 * silently if that environment ever loses them. Runtime uses the credentials the app already has
 * for exercise media, and a failure is visible at boot rather than baked into an image.
 *
 * **Why it may do nothing.** While the constants are still committed, the repo copy is already in
 * place and this returns early. That is the state today: this module exists so the files *can* be
 * deleted, and the deletion is a separate step that happens once the bucket is verified. Ordering
 * matters — a delivery mechanism added after the deletion is a delivery mechanism nobody tested.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

import modelFiles from './model-files.json'

/** Where the bucket keeps them. Flat, matching `oura-model-onnx/` for the models. Read from the
 *  shared manifest so the downloader, the uploader and the admin report cannot disagree about it. */
export const CONSTANTS_BUCKET_PREFIX = modelFiles.constantsPrefix

/** Written under the deploy's own working directory — writable on Railway, wiped per deploy, which
 *  is what we want: a stale constant is worse than a re-download. */
const CACHE_DIR = path.join(process.cwd(), '.oura-constants')

/** The repo copy, while it still exists. */
const TREE_DIR = path.join(process.cwd(), 'lib', 'oura-models', 'constants')

/**
 * The synthetic set the test suite already runs against (`scripts/generate-test-constants.js`).
 *
 * Committed, keys-real/numbers-fake, and the last resort **outside production only** — see
 * `ensureConstantsAvailable`.
 */
const FIXTURES_DIR = path.join(process.cwd(), 'lib', 'oura-models', '__fixtures__', 'constants')

export interface ConstantsDeliveryResult {
  /** Directory the loader should read from, or null when nothing could be provided. */
  dir: string | null
  source: 'tree' | 'bucket' | 'fixtures' | 'unavailable'
  /** Files written this boot. Zero for the tree, or on a cache hit within one process. */
  fetched: number
  detail: string
}

async function hasConstants(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir)
    // MANIFEST.json is the index every other file is checked against, so its absence means the set
    // is unusable however many other files happen to be there.
    return entries.includes('MANIFEST.json') && entries.some(f => f.endsWith('.constants.json'))
  } catch {
    return false
  }
}

/**
 * Ensure the constants are readable, and return where from.
 *
 * Prefers the repo copy when present — that keeps local development and CI working with no bucket
 * credentials at all, which is the same split that lets the model tests run from recordings.
 *
 * **Outside production, an otherwise-unavailable set falls back to the committed test fixtures**
 * (Q-361). The wrapper below owns that decision; this function reports the real outcome, so the
 * two stay separable.
 */
export async function ensureConstantsAvailable(): Promise<ConstantsDeliveryResult> {
  const real = await deliverRealConstants()
  if (real.dir || process.env.NODE_ENV === 'production') return real

  // Gated on NODE_ENV rather than on "did the bucket answer", for the same reason
  // `instrumentation-node.ts`'s `fatalOrLoud` is: gating on credentials would substitute fake
  // numbers in exactly the case that must fail — a production deploy that lost its storage
  // variables. NODE_ENV cannot be wrong in the direction that matters; Railway sets it.
  //
  // What this buys is narrow and worth naming: `lib/oura-models/constants/*` is gitignored, so a
  // sandbox never has it and no bucket credential resolves there either. `GET /api/nutrition/
  // energy-balance` and `GET /api/body-metadata` therefore returned 500 in every session — not a
  // degraded screen, an empty one — so "tested on `pnpm dev`" was silently untrue for the Energy
  // card, the Nutrition energy bar and anything else reading them.
  //
  // The fixtures are the right substitute rather than a new stub: they are generated from the
  // loader's own file list, every key is real and every *number* is synthetic, and the test suite
  // already runs against them (`vitest.config.ts` makes the same choice). A second hand-written
  // stub would be a set nothing keeps in step, sitting in a gitignored path indistinguishable from
  // the vendor's own files.
  if (await hasConstants(FIXTURES_DIR)) {
    return {
      dir: FIXTURES_DIR,
      source: 'fixtures',
      fetched: 0,
      detail: `SYNTHETIC test fixtures — every number is fake. ${real.detail}`,
    }
  }
  return real
}

async function deliverRealConstants(): Promise<ConstantsDeliveryResult> {
  if (await hasConstants(TREE_DIR)) {
    return { dir: TREE_DIR, source: 'tree', fetched: 0, detail: 'reading the repository copy' }
  }

  if (await hasConstants(CACHE_DIR)) {
    return { dir: CACHE_DIR, source: 'bucket', fetched: 0, detail: 'already downloaded this deploy' }
  }

  let listMediaKeys: (prefix: string) => Promise<{ keys: string[]; error: string | null }>
  let downloadMedia: (key: string) => Promise<Buffer | null>
  try {
    const storage = await import('@/lib/exercise-storage')
    listMediaKeys = storage.listMediaKeys
    downloadMedia = storage.downloadMedia
  } catch (err) {
    return { dir: null, source: 'unavailable', fetched: 0, detail: `storage client unavailable: ${String(err).slice(0, 120)}` }
  }

  // The listing reports "empty" and "could not reach" separately, and keeping them apart is the
  // point: one is an upload nobody has run, the other is an outage. Collapsing them would make the
  // first look like the second and send someone debugging credentials.
  const listing = await listMediaKeys(`${CONSTANTS_BUCKET_PREFIX}/`)
  if (listing.error) {
    return { dir: null, source: 'unavailable', fetched: 0, detail: `could not list the bucket: ${listing.error.slice(0, 120)}` }
  }

  const wanted = listing.keys.filter(k => k.endsWith('.json'))
  if (wanted.length === 0) {
    // An empty listing is not the same as a failed one, and the difference decides what to do about
    // it: this one means the upload has not happened, which is an action, not an outage.
    return {
      dir: null,
      source: 'unavailable',
      fetched: 0,
      detail: `no objects under ${CONSTANTS_BUCKET_PREFIX}/ — run scripts/upload-model-assets.js --constants`,
    }
  }

  await fs.mkdir(CACHE_DIR, { recursive: true })
  let fetched = 0
  for (const key of wanted) {
    const body = await downloadMedia(key)
    // A partial set is worse than none: the loader would serve the files it got and throw on the
    // rest, so half the app would work and half would 500 with no common cause.
    if (!body || body.length === 0) {
      return { dir: null, source: 'unavailable', fetched, detail: `empty or missing object: ${key}` }
    }
    await fs.writeFile(path.join(CACHE_DIR, path.basename(key)), body)
    fetched += 1
  }

  if (!(await hasConstants(CACHE_DIR))) {
    return { dir: null, source: 'unavailable', fetched, detail: 'downloaded set has no MANIFEST.json' }
  }

  return { dir: CACHE_DIR, source: 'bucket', fetched, detail: `downloaded ${fetched} file(s)` }
}
