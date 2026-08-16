// Is object storage serving every ONNX model? Since Q-49 A4b there is nothing else that could be.
//
// Phase A1 made `getSession` read the bucket first and the repo tree second, keeping the local
// copies as a safety net while the deletion was still being prepared. A4b deleted them, so the
// second branch is gone and a non-`complete` verdict here is not a warning about a fallback — it
// is the app being unable to run its models at all. `instrumentation-node.ts` treats it that way:
// in production it fails the boot rather than serving degraded sleep staging and steps silently.
//
// **This report was necessary but not sufficient for that deletion, and the gap was CI**, not
// production: fourteen test files read `lib/oura-models/onnx` directly, and `.github/workflows/
// ci.yml` has no bucket credentials at all — deliberately, because a public repo's suite must not
// require secrets. That was closed separately, by golden recordings for the models and synthetic
// fixtures for the constants, which is why the files could finally go. Kept here because it is the
// question anyone re-reading this file will ask.
//
// The evidence originally specified was "eight `loaded from object storage` lines in the Railway
// deploy log". That is a poor gate: the loaders are lazy, so those lines only appear once a sleep
// rollup happens to run, and *absence* of a line means nothing. This module asks the bucket
// directly instead, so the answer is a yes/no anyone can re-check at any time.

import modelFiles from './model-files.json'
import { REQUIRED_MODEL_FILES } from './required-models'

export interface BucketFileStat {
  file: string
  key: string
  found: boolean
  sizeBytes: number | null
  /** Non-null only for errors that are NOT "absent" — auth, network, endpoint. */
  error: string | null
}

export type BucketVerdict =
  /** Every required file present and non-empty — the local copies can go. */
  | 'complete'
  /** The bucket answered, but at least one file is missing or zero-length. */
  | 'incomplete'
  /** Could not talk to the bucket at all, so nothing can be concluded about its contents. */
  | 'unreachable'

export interface ModelBucketReport {
  verdict: BucketVerdict
  prefix: string
  files: BucketFileStat[]
  missing: string[]
  /** Present but zero-length — a truncated upload, which reads as "there" but fails to parse. */
  empty: string[]
  /** Keys under the prefix the required list does not name — strays, or a future model. */
  unexpected: string[]
  error: string | null
  summary: string
}

/**
 * Decide the verdict from already-gathered facts. Pure, so the three outcomes are testable without
 * a bucket — which matters because no session sandbox can authenticate to one.
 *
 * `preflightError` wins over everything: if the bucket could not be listed, per-file "not found"
 * results carry no information and must not be reported as missing files.
 */
export function buildBucketReport(
  prefix: string,
  stats: BucketFileStat[],
  listedKeys: string[],
  preflightError: string | null,
  /** What the prefix is supposed to hold, and what to call it in the summary. Defaults to the ONNX
   *  models, which is what this report was written for; the constants set passes its own. */
  expected: { files: readonly string[]; noun: string; remedy: string } = {
    files: REQUIRED_MODEL_FILES,
    noun: 'model files',
    remedy: 'scripts/upload-model-assets.js',
  },
): ModelBucketReport {
  if (preflightError) {
    return {
      verdict: 'unreachable',
      prefix,
      files: stats,
      missing: [],
      empty: [],
      unexpected: [],
      error: preflightError,
      summary: `Object storage unreachable — ${preflightError}. Nothing can be concluded about the bucket's contents, and there is no longer a repo-tree copy behind it: check the storage credentials and endpoint.`,
    }
  }

  const missing = stats.filter(s => !s.found).map(s => s.file)
  const empty = stats.filter(s => s.found && s.sizeBytes === 0).map(s => s.file)
  const required = new Set(expected.files.map(f => `${prefix}/${f}`))
  const unexpected = listedKeys.filter(k => !required.has(k))

  if (missing.length === 0 && empty.length === 0) {
    return {
      verdict: 'complete',
      prefix,
      files: stats,
      missing,
      empty,
      unexpected,
      error: null,
      summary: `All ${expected.files.length} ${expected.noun} present and non-empty in object storage, which is now the only source — the repo-tree copies were deleted in Q-49 A4b. Presence and non-emptiness only: this cannot tell whether the bytes are right.`,
    }
  }

  const parts: string[] = []
  if (missing.length) parts.push(`missing: ${missing.join(', ')}`)
  if (empty.length) parts.push(`zero-length: ${empty.join(', ')}`)
  return {
    verdict: 'incomplete',
    prefix,
    files: stats,
    missing,
    empty,
    unexpected,
    error: null,
    summary: `${missing.length + empty.length} of ${expected.files.length} ${expected.noun} unusable in object storage — ${parts.join(' · ')}. There is no repo-tree copy behind this any more, so the app cannot run these until it is fixed: re-run ${expected.remedy}.`,
  }
}

/**
 * Ask object storage about every required model file.
 *
 * The list preflight is not redundant with the per-file stats: it is what tells a rejected
 * credential apart from an empty bucket, and it also surfaces strays under the prefix.
 */
export async function reportModelBucketAssets(): Promise<ModelBucketReport> {
  return reportPrefix(modelFiles.bucketPrefix, {
    files: REQUIRED_MODEL_FILES,
    noun: 'model files',
    remedy: 'scripts/upload-model-assets.js',
  })
}

/**
 * The same question for the model constants, which `constants-delivery.ts` downloads at boot.
 *
 * Worth having separately from the models rather than folded into them: the two sets move
 * independently — the models left git in Q-49 A1, the constants only became movable in A3 — and a
 * report that merged them would go `incomplete` for the whole payload when one half is fine.
 *
 * This is also the only way to verify a constants upload that was done **by hand** through a bucket
 * console rather than by the script, since the script's own read-back verification never ran. It
 * checks presence and non-emptiness, not checksums, so it cannot detect a file whose *contents* are
 * wrong — for that, delete a tree copy and let the boot download serve the real thing.
 */
export async function reportConstantsBucketAssets(): Promise<ModelBucketReport> {
  return reportPrefix(modelFiles.constantsPrefix, {
    files: modelFiles.constantsRequired,
    noun: 'constants files',
    remedy: 'scripts/upload-model-assets.js --constants',
  })
}

async function reportPrefix(
  prefix: string,
  expected: { files: readonly string[]; noun: string; remedy: string },
): Promise<ModelBucketReport> {
  const { statMedia, listMediaKeys } = await import('@/lib/exercise-storage')

  const listed = await listMediaKeys(`${prefix}/`)
  if (listed.error) return buildBucketReport(prefix, [], [], listed.error, expected)

  const stats = await Promise.all(
    expected.files.map(async (file): Promise<BucketFileStat> => {
      const key = `${prefix}/${file}`
      const s = await statMedia(key)
      return { file, key, found: s.found, sizeBytes: s.size, error: s.error }
    }),
  )

  // A per-file transport error is the same situation as a failed preflight — report it as such
  // rather than letting it masquerade as an absent file.
  const transportError = stats.find(s => s.error)?.error ?? null
  if (transportError) return buildBucketReport(prefix, stats, listed.keys, transportError, expected)

  return buildBucketReport(prefix, stats, listed.keys, null, expected)
}
