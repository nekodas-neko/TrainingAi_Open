// LB-194. The setup file refuses a test's write into app source, whichever way `node:fs` was imported.
import { describe, it, expect } from 'vitest'
import fs, { writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { isGuardedSourcePath } from '../vitest-source-write-guard'

const root = process.cwd()
const probeDir = path.join(root, 'components', '__lb194_probe__')
const probe = path.join(probeDir, 'probe.tsx')

describe('the source-write guard (LB-194)', () => {
  it('classifies paths', () => {
    expect(isGuardedSourcePath('components/workout/set-card.tsx')).toBe(true)
    expect(isGuardedSourcePath(path.join(root, 'lib', 'x.ts'))).toBe(true)
    expect(isGuardedSourcePath('components/workout/__check_fixture__/set-card.tsx')).toBe(false)
    expect(isGuardedSourcePath('packages/shared/node_modules/x/index.js')).toBe(false)
    expect(isGuardedSourcePath('scripts/x.js')).toBe(false)
    expect(isGuardedSourcePath(path.join(root, '.oura-constants', 'a.json'))).toBe(false)
    expect(isGuardedSourcePath(3)).toBe(false)
  })

  // The probe's folder does not exist, so an UNGUARDED write fails with ENOENT, which does not match
  // /LB-194/. The case therefore fails without the guard and never leaves a file behind.
  it('refuses the write through a named import and through the default import', () => {
    expect(existsSync(probeDir)).toBe(false)
    expect(() => writeFileSync(probe, 'x')).toThrow(/LB-194/)
    expect(() => fs.appendFileSync(probe, 'x')).toThrow(/LB-194/)
    expect(existsSync(probe)).toBe(false)
  })

  it('allows a fixture copy in a __check_fixture__ folder', () => {
    const dir = path.join(root, 'components', '__check_fixture__')
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(path.join(dir, 'probe.tsx'), 'x')
      expect(existsSync(path.join(dir, 'probe.tsx'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
