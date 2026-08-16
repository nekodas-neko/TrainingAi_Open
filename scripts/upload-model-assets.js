#!/usr/bin/env node
/**
 * Upload the ONNX model files to the app's object storage, so they can leave git (Q-49 Phase A1).
 *
 *   node scripts/upload-model-assets.js           # upload anything missing or changed, then verify
 *   node scripts/upload-model-assets.js --check    # verify only, upload nothing
 *
 * Run this from a machine that has the real bucket credentials — the same ones the app already uses
 * for exercise media (`lib/exercise-storage.ts`). It reads them from the environment and uploads
 * nothing if they are absent.
 *
 * WHY ONLY THE .onnx FILES, and not `lib/oura-models/constants/` — which is the larger half of the
 * vendored payload by file count: those constants are **statically imported** by
 * `constants/index.ts` (`import x from './foo.constants.json'`), so webpack bundles them at build
 * time. A runtime fetch cannot replace a static import. Moving them out needs `constants/index.ts`
 * restructured into a runtime loader, which changes every port that reads a constant — a separate,
 * larger change. The `.onnx` files have no such problem: `getSession` reads them with `fs.readFile`
 * at call time, so swapping the source is local to one module.
 *
 * Never deletes. Re-running is safe: a file already present with a matching checksum is skipped.
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3')
/** Where things live in the bucket — from model-files.json, so the loader, the boot-time downloader,
 *  the admin report and this script can never disagree about where they were put. Flat kebab-case,
 *  matching the convention already in the bucket (`exercise-media/`, `oura-model-pt-originals/`):
 *  these are the ONNX exports of those same `.pt` originals, so they sit beside them rather than
 *  under a new tree. */
const {
  REQUIRED_MODEL_FILES,
  BUCKET_PREFIX: PREFIX,
  REQUIRED_CONSTANTS_FILES,
  CONSTANTS_BUCKET_PREFIX: CONSTANTS_PREFIX,
} = require('./model-files.cjs')

const ONNX_DIR = path.join(__dirname, '..', 'lib', 'oura-models', 'onnx')
const CONSTANTS_DIR = path.join(__dirname, '..', 'lib', 'oura-models', 'constants')
const checkOnly = process.argv.includes('--check')
// The constants moved from "statically imported, therefore stuck in git" to "read at runtime" in
// Q-49 A3, so they can now be delivered the same way the models are. `lib/oura-models/constants-delivery.ts`
// downloads this prefix at boot; without the upload the app logs MODEL CONSTANTS UNAVAILABLE and
// every port that reads one throws.
const withConstants = process.argv.includes('--constants') || process.argv.includes('--all')

function client() {
  const endpoint = process.env.AWS_ENDPOINT_URL ?? process.env.STORAGE_ENDPOINT
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? process.env.STORAGE_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? process.env.STORAGE_SECRET_ACCESS_KEY
  if (!endpoint || !accessKeyId || !secretAccessKey) return null
  return new S3Client({
    endpoint,
    region: process.env.AWS_DEFAULT_REGION ?? process.env.STORAGE_REGION ?? 'auto',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  })
}

const bucket = () => process.env.AWS_S3_BUCKET_NAME ?? process.env.STORAGE_BUCKET_NAME ?? 'trainingai'
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex')

async function download(s3, key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
  const chunks = []
  for await (const chunk of res.Body) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function main() {
  const s3 = client()
  if (!s3) {
    console.error('No bucket credentials in the environment.')
    console.error('Set AWS_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and')
    console.error('AWS_S3_BUCKET_NAME — the same values the app uses for exercise media.')
    process.exit(1)
  }

  const groups = [{ label: 'models', dir: ONNX_DIR, prefix: PREFIX, files: [...REQUIRED_MODEL_FILES] }]
  if (withConstants) {
    // What to upload comes from the tree, not from the pinned list: the constants set is defined by
    // what the extraction produced, and uploading only what a hand-maintained list names would
    // silently omit a file the loader later asks for. The pinned list is cross-checked against it
    // below instead — that way the list can be trusted after the tree is deleted (which is the only
    // time anything can still verify the upload) without it ever deciding what gets sent.
    // MANIFEST.json rides along and is what the delivery check looks for.
    //
    // TOP LEVEL ONLY, deliberately. `constants/specs/` holds 17 more JSON files that nothing reads
    // at runtime — `readJson()` is only ever given a bare filename. They are still vendor material
    // and still must not be published, but that is the archive's job
    // (`scripts/archive-private-paths.js` tars the whole directory). Uploading them here would put
    // files into the delivery prefix that the boot fetch then downloads on every cold start for no
    // reason.
    const files = fs.existsSync(CONSTANTS_DIR)
      ? fs.readdirSync(CONSTANTS_DIR).filter(f => f.endsWith('.json'))
      : []
    const pinned = new Set(REQUIRED_CONSTANTS_FILES)
    const found = new Set(files)
    const unlisted = files.filter(f => !pinned.has(f))
    const absent = REQUIRED_CONSTANTS_FILES.filter(f => !found.has(f))
    if (unlisted.length || absent.length) {
      console.warn('  WARNING: the tree and model-files.json disagree about the constants set.')
      if (unlisted.length) console.warn(`    in the tree, not in constantsRequired: ${unlisted.join(', ')}`)
      if (absent.length) console.warn(`    in constantsRequired, not in the tree: ${absent.join(', ')}`)
      console.warn('    Uploading the tree regardless; update constantsRequired so the post-deletion check stays honest.\n')
    }
    groups.push({ label: 'constants', dir: CONSTANTS_DIR, prefix: CONSTANTS_PREFIX, files })
  }

  console.log(`bucket ${bucket()}`)
  for (const g of groups) console.log(`  ${g.label.padEnd(10)} ${g.prefix}/  ${g.files.length} files`)
  console.log(checkOnly ? '\nmode: check only, nothing will be written\n' : '\nmode: upload then verify\n')
  if (!withConstants) {
    console.log('(models only — pass --constants to include lib/oura-models/constants)\n')
  }

  let uploaded = 0, skipped = 0
  const failed = []

  for (const group of groups) {
    console.log(`── ${group.label} ──`)
    if (group.files.length === 0) {
      failed.push(`${group.label} — nothing found locally to upload`)
      console.log('  NOTHING FOUND LOCALLY')
      continue
    }

    // Preflight per prefix. Without this an auth failure reads as "the bucket is empty" — every HEAD
    // below throws, gets treated as absent, and the run reports N files needing upload when the real
    // problem is the credentials. One list call up front turns that into one honest error.
    await s3.send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: `${group.prefix}/`, MaxKeys: 1 }))

    for (const file of group.files) {
      const localPath = path.join(group.dir, file)
      if (!fs.existsSync(localPath)) {
        failed.push(`${file} — not present locally`)
        console.log(`  MISSING LOCALLY  ${file}`)
        continue
      }
      const local = fs.readFileSync(localPath)
      const key = `${group.prefix}/${file}`
      const kb = (local.length / 1024).toFixed(0)

      let remoteSize = null
      try {
        remoteSize = (await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }))).ContentLength
      } catch (err) {
        // Only "it is not there" is an expected miss. Anything else — auth, network, a wrong bucket
        // name — must not be quietly reported as an absent file.
        const notFound = err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404
        if (!notFound) throw err
      }

      if (remoteSize === local.length) {
        const remote = await download(s3, key)
        if (sha256(remote) === sha256(local)) {
          skipped++
          console.log(`  ok (already uploaded)  ${file}  ${kb} KB`)
          continue
        }
      }

      if (checkOnly) {
        failed.push(`${file} — ${remoteSize == null ? 'absent from the bucket' : 'differs from the local copy'}`)
        console.log(`  NEEDS UPLOAD     ${file}  ${kb} KB`)
        continue
      }

      await s3.send(new PutObjectCommand({
        Bucket: bucket(), Key: key, Body: local, ContentType: 'application/octet-stream',
      }))

      // Read it back. A truncated upload leaves a file that exists, which is exactly the failure the
      // boot-time check was built for — catching it here is cheaper than catching it in production.
      const remote = await download(s3, key)
      if (sha256(remote) !== sha256(local)) {
        failed.push(`${file} — uploaded but the readback checksum did not match`)
        console.log(`  VERIFY FAILED    ${file}`)
        continue
      }
      uploaded++
      console.log(`  uploaded + verified  ${file}  ${kb} KB`)
    }
  }

  console.log(`\n${uploaded} uploaded · ${skipped} already correct · ${failed.length} problem(s)`)
  if (failed.length) {
    console.error('\nProblems:')
    for (const f of failed) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log(`\nEvery ${withConstants ? 'model and constants ' : 'model '}file is in the bucket and matches the local copy.`)
}

main().catch(err => {
  console.error('\nFailed:', err.name === 'SignatureDoesNotMatch'
    ? 'SignatureDoesNotMatch — the credentials were rejected. Check you are running this where the real bucket keys live.'
    : `${err.name}: ${err.message}`)
  process.exit(1)
})
