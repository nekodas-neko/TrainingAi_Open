#!/usr/bin/env node
// #2377 — replay the shadow readiness model over stored history, against a LOCAL database.
//
//   DATABASE_URL=postgres://…@localhost:5434/<db> DATABASE_SSL=false \
//     node scripts/shadow-readiness-replay.mjs --user <uuid> --from 2026-07-01 --to 2026-10-07 [--write]
//
// Dry run unless --write. The entry point is TypeScript and imports the repository through the `@/`
// alias, so it is bundled first with esbuild, the same way `build-rollup-worker.mjs` does it. There
// is an admin route for production (`POST /api/admin/backfill-shadow-readiness`, issue 2636); this
// script stays local-only, and the production comparison is read-only SQL.
import * as esbuild from 'esbuild'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(path.join(tmpdir(), 'shadow-replay-'))
const outFile = path.join(outDir, 'shadow-readiness-replay.cjs')

try {
  await esbuild.build({
    entryPoints: [path.join(repoRoot, 'lib/health/shadow-readiness-replay-cli.ts')],
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
