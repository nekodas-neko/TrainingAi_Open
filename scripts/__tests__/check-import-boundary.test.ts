/**
 * #3729 — server code, packages/shared and mobile/ never import client code.
 *
 * Each case builds a small tree in a temp directory (`--root`) and plants one import, so no file in
 * the repo is written. The last case runs the check over the real tree, which is how CI runs it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const script = path.join(__dirname, '..', 'check-import-boundary.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ALLOWLIST, CLIENT_DIRS } = require(script) as { ALLOWLIST: Set<string>; CLIENT_DIRS: string[] }
let root: string

const put = (rel: string, src: string) => {
  const full = path.join(root, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, src)
}
const run = (args: string[] = ['--no-allowlist'], cwdRoot: string | null = root): { code: number; out: string } => {
  try {
    const out = execFileSync('node', [script, ...(cwdRoot ? ['--root', cwdRoot] : []), ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'import-boundary-'))
  put('components/profile/grid.tsx', `export interface Thing { id: string }\n`)
  put('lib/local-store/types.ts', `export interface Row { id: string }\n`)
  put('packages/shared/src/ok.ts', `export const ok = 1\n`)
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('check-import-boundary', () => {
  it('passes a tree whose server, shared and native files import only shared code', () => {
    put('app/api/a/route.ts', `import { ok } from '@trainingai/shared/ok'\nexport const x = ok\n`)
    put('mobile/src/screen.tsx', `import { ok } from '@trainingai/shared/ok'\nexport const y = ok\n`)
    const r = run()
    expect(r.out).toMatch(/Import boundary OK/)
    expect(r.code).toBe(0)
  })

  it('fails a planted component import in an API route', () => {
    put('app/api/a/route.ts', `import type { Thing } from '@/components/profile/grid'\nexport type T = Thing\n`)
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/app\/api\/a\/route\.ts:1 imports client code '@\/components\/profile\/grid'/)
  })

  it('fails a lib/ helper an API route reaches, but not one only a screen uses', () => {
    put('app/api/a/route.ts', `import { h } from '@/lib/helper'\nexport const x = h\n`)
    put('lib/helper.ts', `import type { Row } from './local-store/types'\nexport const h = 1 as unknown as Row\n`)
    put('lib/screen-only.ts', `import { Capacitor } from '@capacitor/core'\nexport const c = Capacitor\n`)
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/lib\/helper\.ts:1 .*\(reached from app\/api\/a\/route\.ts\)/)
    expect(r.out).not.toMatch(/screen-only/)
  })

  it('fails a @capacitor import, a require and a dynamic import in the shared package and mobile/', () => {
    put('packages/shared/src/a.ts', `import { Capacitor } from '@capacitor/core'\nexport const a = Capacitor\n`)
    put('packages/shared/src/b.ts', `const s = require('@/lib/sqlite/cache')\nexport const b = s\n`)
    put('mobile/src/c.ts', `export const c = () => import('../../lib/hooks/use-thing')\n`)
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/packages\/shared\/src\/a\.ts:1 imports client code '@capacitor\/core'/)
    expect(r.out).toMatch(/packages\/shared\/src\/b\.ts:1 imports client code '@\/lib\/sqlite\/cache'/)
    expect(r.out).toMatch(/mobile\/src\/c\.ts:1 imports client code '\.\.\/\.\.\/lib\/hooks\/use-thing'/)
  })

  it('ignores an import that only appears in a comment, and test files', () => {
    put('app/api/a/route.ts', `// was: import { Thing } from '@/components/profile/grid'\nexport const x = 1\n`)
    put('app/api/__tests__/a.test.ts', `import type { Thing } from '@/components/profile/grid'\n`)
    expect(run().code).toBe(0)
  })

  it('keeps one list of client folders', () => {
    expect(CLIENT_DIRS).toEqual(['components/', 'lib/local-store/', 'lib/sqlite/', 'lib/hooks/'])
  })

  it('fails an allowlist entry that no longer imports client code, so the list only shrinks', () => {
    for (const f of ALLOWLIST) put(f, `import { x } from '@/lib/local-store'\nexport const y = x\n`)
    expect(run([]).code).toBe(0)
    const [first] = [...ALLOWLIST]
    put(first, `export const y = 1\n`)
    const r = run([])
    expect(r.code).toBe(1)
    expect(r.out).toContain(`${first} is on the allowlist`)
  })

  it('passes on the real tree', () => {
    const r = run([], null)
    expect(r.out).toMatch(/Import boundary OK/)
    expect(r.code).toBe(0)
  })
})
