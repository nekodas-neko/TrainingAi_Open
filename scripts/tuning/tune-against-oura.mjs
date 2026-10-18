#!/usr/bin/env node
// #2986 — tune against Oura. Our Sleep, readiness and Activity next to Oura's scores, and a fit of
// each Oura score against Oura's own contributors and against our inputs. READ-ONLY; stdout only.
//
//   DATABASE_URL=postgres://…/<db> node scripts/tuning/tune-against-oura.mjs --local --user <uuid> \
//     [--from 2026-10-18] [--to 2026-11-01] [--model-version 3] [--per-day]
//   CLAUDE_DB_QUERY_SECRET=… node scripts/tuning/tune-against-oura.mjs --prod [--from …] [--to …] [--per-day]
//
// --prod reads the owner-scoped `claude_ro` views through `/api/admin/db-query`; --local reads one
// user's rows in a session set read-only. The range is Oura dates and defaults to the 60 days ending
// yesterday. The output is the owner's health numbers: print it, read it, never commit it or paste it
// into an issue or PR (#2986). Any weight change it suggests is a `type: tuning` proposal.
//
// The entry point is TypeScript and imports the shipped weights through the path aliases, so it is
// bundled first with esbuild, the same way `scripts/shadow-readiness-replay.mjs` does it.
import * as esbuild from 'esbuild'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = mkdtempSync(path.join(tmpdir(), 'tune-against-oura-'))
const outFile = path.join(outDir, 'tune-against-oura.cjs')

try {
  await esbuild.build({
    entryPoints: [path.join(repoRoot, 'scripts/tuning/tune-against-oura-cli.ts')],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    absWorkingDir: repoRoot,
    tsconfig: path.join(repoRoot, 'tsconfig.json'),
    external: ['pg', 'pg-native'],
    logLevel: 'warning',
  })
  // Run from the repo root so `pg` resolves from its node_modules.
  const res = spawnSync(process.execPath, [outFile, ...process.argv.slice(2)], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, NODE_PATH: path.join(repoRoot, 'node_modules') },
  })
  process.exitCode = res.status ?? 1
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
