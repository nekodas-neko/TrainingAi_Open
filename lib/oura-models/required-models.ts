// Which ONNX model files the app actually loads, and a check that they are really there.
//
// Every loader in `inference/` is infallible by contract: `getSession` returns `null` when the file
// is missing and each caller falls back rather than throwing. That is the right behaviour per
// request — a hypnogram is not worth a 500 — but it means a *deployment* with no model files at all
// looks completely healthy while silently serving degraded sleep staging and daily steps. Q-49 turns
// that from a theoretical risk into a live one: Phase A1 moves these files out of git and fetches
// them at build time, so a broken fetch would produce exactly that invisible failure.
//
// This module is the counterweight. It is deliberately dependency-light — `node:fs` and `node:path`
// only, no `onnxruntime-node`, no repository — because it is imported from the server-boot hook,
// which must not drag the native addon into a bundle (see `instrumentation-node.ts`).

import fs from 'node:fs/promises'
import path from 'node:path'

import modelFiles from './model-files.json'

/**
 * The ONNX files production actually loads, matching the `MODEL_FILE` constants in `inference/`
 * plus the two `energy` picks its feature length chooses between.
 *
 * The list lives in `model-files.json` rather than here because
 * `scripts/upload-model-assets.js` needs the same list from CommonJS — one source, no drift between
 * what the boot check expects and what the upload script sends.
 *
 * It is hand-maintained rather than discovered at runtime: a check that reads the directory to learn
 * its own expectations can never notice an absent file. `__tests__/required-models.test.ts`
 * cross-checks it against the `.onnx` literals in `inference/*.ts`, so adding a model without
 * listing it fails there.
 *
 * NOT listed, deliberately: `sleepnet_bdi_0_3_0_core.onnx` and `sleepnet_bdi_0_4_0_core.onnx`. No
 * loader names them — BDI comes from the moonstone model's own apnea head — and their fate is
 * backlog Q-50.
 */
export const REQUIRED_MODEL_FILES: readonly string[] = modelFiles.required

export interface ModelAssetReport {
  ok: boolean
  /** Files that are absent entirely. */
  missing: string[]
  /** Files that exist but are zero-length — the signature of a truncated or half-written fetch. */
  empty: string[]
}

/**
 * Check every required model file is present and non-empty in `dir`.
 *
 * Zero-length counts as a failure on purpose: a partial download leaves a file that exists, so
 * presence alone would pass while every `InferenceSession.create` fails at request time — the exact
 * silent degradation this exists to catch.
 *
 * Pure I/O, no throwing: an unreadable directory reports every file missing rather than exploding,
 * so the caller decides whether that is fatal.
 */
export async function verifyModelAssets(dir: string): Promise<ModelAssetReport> {
  const missing: string[] = []
  const empty: string[] = []
  for (const file of REQUIRED_MODEL_FILES) {
    try {
      const st = await fs.stat(path.join(dir, file))
      if (!st.isFile()) missing.push(file)
      else if (st.size === 0) empty.push(file)
    } catch {
      missing.push(file)
    }
  }
  return { ok: missing.length === 0 && empty.length === 0, missing, empty }
}

/** One line naming what is wrong, or null when everything is present. */
export function describeModelAssetReport(report: ModelAssetReport): string | null {
  if (report.ok) return null
  const parts: string[] = []
  if (report.missing.length) parts.push(`missing: ${report.missing.join(', ')}`)
  if (report.empty.length) parts.push(`zero-length: ${report.empty.join(', ')}`)
  return `${report.missing.length + report.empty.length} of ${REQUIRED_MODEL_FILES.length} model files unusable — ${parts.join(' · ')}`
}
