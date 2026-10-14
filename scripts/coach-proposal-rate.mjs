#!/usr/bin/env node
// #2245 — how often the Coach offers a write and what happened to each one, from stored threads.
//
//   DATABASE_URL=<claude_ro connection> node scripts/coach-proposal-rate.mjs [--since 2026-08-01]
//   DATABASE_URL=<local> node scripts/coach-proposal-rate.mjs --schema public
//
// Read-only. The report itself is `lib/coach/proposal-rate.ts`; the CLI is TypeScript and imports it
// through the `@/` alias, so it is bundled first with esbuild, as `shadow-readiness-replay.mjs` does.
import * as esbuild from 'esbuild'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(path.join(tmpdir(), 'coach-proposal-rate-'))
const outFile = path.join(outDir, 'coach-proposal-rate.cjs')

try {
  await esbuild.build({
    entryPoints: [path.join(repoRoot, 'lib/coach/proposal-rate-cli.ts')],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    absWorkingDir: repoRoot,
    tsconfig: path.join(repoRoot, 'tsconfig.json'),
    external: ['onnxruntime-node', 'onnxruntime-web', 'pg', 'pg-native', 'sharp', '@google/genai'],
    logLevel: 'warning',
  })
  // Run from the repo root so `pg` and the other externals resolve from its node_modules.
  const res = spawnSync(process.execPath, [outFile, ...process.argv.slice(2)], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, NODE_PATH: path.join(repoRoot, 'node_modules') },
  })
  process.exitCode = res.status ?? 1
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
