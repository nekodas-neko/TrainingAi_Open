#!/usr/bin/env node
/**
 * Archive the private paths to object storage, so they can leave the repository (Q-49 Phase A4).
 *
 *   node scripts/archive-private-paths.js          # archive anything missing or changed, then verify
 *   node scripts/archive-private-paths.js --check  # verify only, upload nothing
 *
 * These are the paths in `scripts/private-paths.json` with `archive: "bucket"` — the extracted
 * weights, the vendor's decompiled source, and the docs describing how they were obtained.
 *
 * **This is redundancy, not the only copy — an earlier version of this header said otherwise and was
 * wrong.** Three copies already exist or will:
 *
 *   1. **The old repository is archived, not deleted** (roadmap B5), so every one of these paths
 *      stays retrievable from its git history indefinitely. That alone makes the public cut
 *      reversible.
 *   2. **The decrypted `.pt` originals are already in the bucket** under `oura-model-pt-originals/`
 *      — recorded as uploaded and verified on 2026-07-21. `weights/`, `constants/` and the
 *      decompiled source were all derived mechanically from those, so they are reproducible from
 *      what is already stored.
 *   3. **The `.onnx` files are already in the bucket** under `oura-model-onnx/`, which is why this
 *      script skips them.
 *
 * So run it for the cheap insurance, not because a deletion is blocked on it. What it genuinely
 * adds: reproducing (2) needs a torch environment and the extraction tooling, which no longer exist
 * anywhere in this project — a tarball needs neither. And the hand-written material (the model
 * skills, the three extraction docs) was never derived from a `.pt` at all, so only git history
 * holds it.
 *
 * Each path becomes one gzipped tarball rather than N objects. `docs/oura-models/` alone is 305
 * files, and a per-file upload turns one verifiable operation into hundreds of individually
 * fallible ones.
 *
 * `lib/oura-models/onnx/` is deliberately skipped: it is marked `runtime-fetch`, already lives in
 * the bucket, and is uploaded by `scripts/upload-model-assets.js`, which is also what the running
 * server reads from. Two scripts writing the same key would be a race with no upside.
 *
 * Credentials come from the environment, same as `lib/exercise-storage.ts`. A session sandbox has
 * placeholder values that fail to authenticate, so this is an owner-run script.
 *
 * Never deletes, never overwrites a byte-identical object. Re-running is safe.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3')

const ROOT = path.join(__dirname, '..')
const PREFIX = 'private-archive'
const checkOnly = process.argv.includes('--check')

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

/** One object key per manifest path — the path with separators flattened, so it reads back plainly. */
const keyFor = p => `${PREFIX}/${p.replace(/\/$/, '').replace(/[/.]/g, '_')}.tar.gz`

function tarball(relPath, outFile) {
  // -C the repo root and name the path relative, so the archive unpacks straight back into place.
  execFileSync('tar', ['-czf', outFile, '-C', ROOT, relPath.replace(/\/$/, '')], { stdio: 'pipe' })
  return fs.readFileSync(outFile)
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'private-paths.json'), 'utf8'))
  const targets = manifest.paths.filter(p => p.archive === 'bucket')

  const s3 = client()
  if (!s3) {
    console.error('No bucket credentials in the environment.')
    console.error('Set AWS_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and')
    console.error('AWS_S3_BUCKET_NAME — the same values the app uses for exercise media.')
    process.exit(1)
  }

  // Prove the bucket is reachable before reading anything else, because every per-object lookup
  // below treats an error as "not there yet". Without this probe, credentials that do not
  // authenticate — which is exactly what a session sandbox has — report every path as absent, and
  // `--check` then reads as "nothing archived" when the truth is "nothing known".
  try {
    await s3.send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: `${PREFIX}/`, MaxKeys: 1 }))
  } catch (err) {
    console.error(`Cannot reach bucket "${bucket()}": ${String(err).slice(0, 200)}`)
    console.error('The credentials are wrong, or this machine cannot see the bucket. Nothing was read;')
    console.error('the archive contents are UNKNOWN, which is not the same as empty. Do not delete anything.')
    process.exit(1)
  }

  console.log(`bucket ${bucket()} · prefix ${PREFIX}/ · ${targets.length} paths`)
  console.log(checkOnly ? 'mode: check only, nothing will be written\n' : 'mode: archive then verify\n')

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'private-archive-'))
  let uploaded = 0, skipped = 0, missing = 0, failed = 0

  for (const entry of targets) {
    const abs = path.join(ROOT, entry.path)
    const key = keyFor(entry.path)

    if (!fs.existsSync(abs)) {
      // Already removed from the tree. That is fine IF the archive holds it — which is exactly
      // what --check is for, so verify rather than assume.
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }))
        console.log(`  ${entry.path.padEnd(56)} not in tree, present in archive`)
      } catch {
        console.error(`  ${entry.path.padEnd(56)} NOT IN TREE AND NOT IN ARCHIVE`)
        missing++
      }
      continue
    }

    const buf = tarball(entry.path, path.join(work, 'a.tar.gz'))
    const digest = sha256(buf)
    const mb = (buf.length / 1048576).toFixed(1)

    let remote = null
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }))
      remote = head.Metadata?.sha256 ?? null
    } catch { /* absent */ }

    if (remote === digest) {
      console.log(`  ${entry.path.padEnd(56)} ${mb.padStart(6)} MB  already archived`)
      skipped++
      continue
    }

    if (checkOnly) {
      console.log(`  ${entry.path.padEnd(56)} ${mb.padStart(6)} MB  WOULD UPLOAD (${remote ? 'changed' : 'absent'})`)
      missing++
      continue
    }

    await s3.send(new PutObjectCommand({
      Bucket: bucket(), Key: key, Body: buf,
      ContentType: 'application/gzip',
      // The checksum rides with the object so a re-run can tell "already there" from "changed"
      // without downloading tens of megabytes.
      Metadata: { sha256: digest, source: entry.path, kind: entry.kind },
    }))

    // Read it back. An upload that reports success and stored something else is the failure this
    // whole script exists to prevent — the tree copy is about to be deleted on the strength of it.
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
    const chunks = []
    for await (const c of res.Body) chunks.push(c)
    if (sha256(Buffer.concat(chunks)) !== digest) {
      console.error(`  ${entry.path.padEnd(56)} VERIFY FAILED — stored bytes differ`)
      failed++
      continue
    }
    console.log(`  ${entry.path.padEnd(56)} ${mb.padStart(6)} MB  uploaded + verified`)
    uploaded++
  }

  fs.rmSync(work, { recursive: true, force: true })

  console.log(`\n${uploaded} uploaded, ${skipped} already present, ${missing} outstanding, ${failed} failed`)
  if (failed) {
    console.error('\nAn upload did not verify — the stored bytes differ from what was sent. Re-run.')
    process.exit(1)
  }
  if (missing) {
    console.error(`\n${missing} path(s) not archived. Re-run without --check to upload them.`)
    console.error('Note this does not block the public cut: the old repository is archived rather')
    console.error('than deleted, so its git history still holds every one of these paths.')
    process.exit(1)
  }
  console.log('\nEvery private path is archived and verified.')
}

main().catch(err => {
  console.error('archive-private-paths failed:', err)
  process.exit(1)
})
