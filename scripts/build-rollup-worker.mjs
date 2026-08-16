#!/usr/bin/env node
// Bundles the BLE rollup worker (Q-213 Stage 2) into a single CJS file a `worker_threads` Worker
// can load. Runs from `pnpm build` and `pnpm dev`, so the bundle always matches the tree it shipped
// with — and so dev exercises the worker path rather than the in-process fallback.
//
// Why a bundle and not the worker entry directly: it is TypeScript, and it imports the repository
// through the `@/` alias. Neither survives `new Worker('lib/oura-ble/rollup-worker-entry.ts')`.
//
// Output goes to `.rollup-worker/`, not `.next/`, because `next dev` and `next build` both own and
// clean `.next`.
import * as esbuild from 'esbuild'
import { mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const OUT_FILE = path.join(repoRoot, '.rollup-worker', 'rollup-worker.cjs')

export async function buildRollupWorker() {
  mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  const result = await esbuild.build({
    entryPoints: [path.join(repoRoot, 'lib/oura-ble/rollup-worker-entry.ts')],
    outfile: OUT_FILE,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // The lowest Node this bundle has to run on: CI's Tests job pins node 20 (`.github/workflows/ci.yml`).
    // Targeting the sandbox's node 22 emits syntax that runtime would reject.
    target: 'node20',
    absWorkingDir: repoRoot,
    tsconfig: path.join(repoRoot, 'tsconfig.json'),
    // Native addons and heavy runtime deps stay external — they are resolved from node_modules at
    // run time, exactly as they are in the Next server. onnxruntime-node in particular CANNOT be
    // bundled (it is the reason this worker exists as a separate build at all).
    external: ['onnxruntime-node', 'onnxruntime-web', 'pg', 'pg-native', 'sharp', '@google/genai'],
    logLevel: 'warning',
  })
  if (result.errors.length) throw new Error(`rollup worker bundle failed: ${result.errors.length} errors`)
  return OUT_FILE
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildRollupWorker()
    .then((out) => console.log(`rollup worker bundled → ${path.relative(repoRoot, out)}`))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
