/**
 * Lazy, cached onnxruntime-node inference sessions for the vendored Oura neural models.
 *
 * Server-only: onnxruntime-node is a native addon and must never reach the client bundle. Each
 * session is created once and cached for the process lifetime.
 *
 * Model bytes come from **object storage first, the repo tree second** (Q-49 Phase A1). The
 * migration's goal is for these files to leave git entirely; reading the bucket first is what makes
 * the bucket path exercised in production *before* the local copies are deleted, so a
 * misconfiguration shows up in the logs while the fallback is still there to catch it. Once the
 * bucket has been observed serving every model, the local copies can go and this becomes the only
 * source.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { InferenceSession } from 'onnxruntime-node'

import modelFiles from '../model-files.json'

const ONNX_DIR = path.join(process.cwd(), 'lib', 'oura-models', 'onnx')

/** Logged once per file so a deploy shows which source actually served each model, without
 *  repeating on every cache miss. */
const sourceLogged = new Set<string>()

/**
 * Model bytes for `fileName`: object storage first, then the repo tree.
 *
 * The bucket read goes through `downloadMedia`, which despite its name is a plain "GET this key"
 * against the same private bucket the exercise gifs use — one storage client, one set of
 * credentials, already configured in production. It is dynamically imported so the AWS SDK is not
 * pulled into any bundle that merely touches this module.
 *
 * Returns null only when BOTH sources fail; the caller turns that into a null session.
 */
async function readModelBytes(fileName: string): Promise<Buffer | null> {
  try {
    const { downloadMedia } = await import('@/lib/exercise-storage')
    const fromBucket = await downloadMedia(`${modelFiles.bucketPrefix}/${fileName}`)
    if (fromBucket && fromBucket.length > 0) {
      if (!sourceLogged.has(fileName)) {
        sourceLogged.add(fileName)
        console.info(`[oura-models] "${fileName}" loaded from object storage`)
      }
      return fromBucket
    }
  } catch (err) {
    console.warn(`[oura-models] object storage read failed for "${fileName}", falling back to disk:`, String(err).slice(0, 200))
  }

  try {
    const fromDisk = await fs.readFile(path.join(ONNX_DIR, fileName))
    if (!sourceLogged.has(fileName)) {
      sourceLogged.add(fileName)
      console.info(`[oura-models] "${fileName}" loaded from the repo tree (not object storage)`)
    }
    return fromDisk
  } catch {
    return null
  }
}

const sessionCache = new Map<string, Promise<InferenceSession | null>>()

/**
 * Get (or lazily create) a cached inference session for an ONNX file in `lib/oura-models/onnx`.
 * Returns `null` if the runtime or model file is unavailable — callers must fall back, never throw.
 */
export function getSession(fileName: string): Promise<InferenceSession | null> {
  const existing = sessionCache.get(fileName)
  if (existing) return existing

  const created = createSession(fileName)
  sessionCache.set(fileName, created)
  return created
}

async function createSession(fileName: string): Promise<InferenceSession | null> {
  try {
    // Dynamic import keeps the native addon out of any accidental client/edge bundle.
    const ort = await import('onnxruntime-node')
    const buf = await readModelBytes(fileName)
    if (!buf) {
      console.warn(`[oura-models] "${fileName}" not found in object storage or on disk`)
      return null
    }
    return await ort.InferenceSession.create(buf)
  } catch (err) {
    console.warn(`[oura-models] failed to load ONNX session "${fileName}":`, err)
    return null
  }
}

/** Test-only: clear the session cache so a fresh session is created next call. */
export function __clearSessionCache() {
  sessionCache.clear()
}
