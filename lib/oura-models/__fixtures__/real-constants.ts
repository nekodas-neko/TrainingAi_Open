/**
 * Does this machine have the vendor's own model constants, or only the synthetic fixtures?
 *
 * `vitest.config.ts` points `OURA_CONSTANTS_DIR` at whichever set exists, so every test loads
 * *something*. That is enough for the tests that only need well-formed tables, and not enough for
 * the ones pinned to the vendor's forward pass — a parity assertion against synthetic numbers is
 * arbitrary, not merely different. Those blocks guard on this and skip where the real values are
 * gone, which is the state of the public repo and of CI.
 *
 * Deliberately per-`describe` at the call sites rather than per-file: several of these files mix
 * parity blocks with pure-function blocks that have nothing to do with vendor values, and guarding
 * the whole file gives up that coverage for nothing.
 */
import fs from 'node:fs'
import path from 'node:path'

import modelFiles from '../model-files.json'

export const REAL_CONSTANTS_DIR = path.resolve(__dirname, '..', 'constants')
export const REAL_ONNX_DIR = path.resolve(__dirname, '..', 'onnx')

export function hasRealConstants(): boolean {
  return fs.existsSync(path.join(REAL_CONSTANTS_DIR, 'MANIFEST.json'))
}

/**
 * The other half of the payload: the ONNX models, which left the tree in the same change.
 *
 * Almost every model-touching test runs from a recording (`inference/__tests__/helpers/
 * replay-session.ts`) and needs no file at all. The exception is a test that measures how much
 * *work* a real forward pass is — without the models `getSession` returns null, every caller falls
 * back, and the run finishes in a fraction of the time. That is not a faster implementation, it is
 * a smaller workload, and an assertion about timing cannot tell the two apart.
 */
export function hasRealModels(): boolean {
  return fs.existsSync(path.join(REAL_ONNX_DIR, modelFiles.required[0]))
}
