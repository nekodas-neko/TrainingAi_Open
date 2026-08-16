import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

/**
 * Pins the dormancy sweep so `lib/oura-models/` cannot silently re-accumulate dead vendored files.
 *
 * The sweep is a script rather than in-test logic because it also runs as a Custom Rules step in CI
 * and from `pnpm ci:local` — one implementation, three entry points. This test exists so a local
 * `pnpm test` catches a newly-orphaned model file at the moment it is orphaned, rather than at the
 * next time somebody thinks to look.
 */
describe('lib/oura-models dormancy', () => {
  it('has no tracked file that is unreachable from the app', () => {
    const root = path.resolve(__dirname, '../../..')
    // Throws with the offending file list on a non-zero exit — that output IS the failure message.
    const out = execFileSync('node', ['scripts/check-oura-models-dormancy.js'], {
      cwd: root, encoding: 'utf8',
    })
    expect(out).toContain('check-oura-models-dormancy: OK')
  })
})
