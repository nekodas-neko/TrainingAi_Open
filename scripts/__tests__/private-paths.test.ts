import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Pins the private-path gate, so a new dependency on Oura's extracted material fails at the moment
 * it is written rather than at the public cut, when the cost of finding it is highest.
 *
 * The gate is a script rather than in-test logic because it also runs as a Custom Rules step in CI
 * and from `pnpm ci:local` — one implementation, three entry points, matching the dormancy sweep.
 */
const ROOT = path.resolve(__dirname, '../..')

describe('private paths', () => {
  it('has no importer for any path declared unimported', () => {
    // Throws with the offending import list on a non-zero exit — that output IS the failure message.
    const out = execFileSync('node', ['scripts/check-private-paths.js'], {
      cwd: ROOT, encoding: 'utf8',
    })
    expect(out).toContain('every path declared unimported has no importer')
  })

  it('declares a kind, a reason and an archive destination for every path', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'scripts', 'private-paths.json'), 'utf8'),
    )
    expect(manifest.paths.length).toBeGreaterThan(0)
    for (const entry of manifest.paths) {
      expect(entry.kind, `${entry.path} kind`).toBeTruthy()
      expect(manifest._kinds[entry.kind], `${entry.path} kind is documented`).toBeTruthy()
      // An unexplained entry is how an inventory quietly stops being read.
      expect(entry.reason?.length ?? 0, `${entry.path} reason`).toBeGreaterThan(40)
      // Deleting extracted weights is not reversible from this repo — every path names where it goes.
      expect(manifest._archive[entry.archive], `${entry.path} archive destination`).toBeTruthy()
      expect(typeof entry.importedByCode, `${entry.path} importedByCode`).toBe('boolean')
    }
  })
})
