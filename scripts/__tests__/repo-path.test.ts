// The bug this guards is invisible on the machine that runs this test.
//
// Three rule scripts walked the tree with `path.join`, then used the result as a KEY into a table
// whose entries are hand-written with forward slashes. On Linux `path.sep` is already `/`, so they
// were correct — and always had been. On Windows the walk yields `app\api\x`, the lookup misses,
// the allowance is not found, and a baselined file reports as a new violation. Three of four
// `Ran 75 of 75` failures on the Device Verification agent's Windows machine were this one bug
// wearing three names (DV-1, 2026-09-23).
//
// So these cases feed the Windows path shape in DIRECTLY rather than asking the platform for it.
// A test that only exercised `path.sep` on this runner would pass against the broken code.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { toPosix, relPosix } = require('../lib/repo-path.js') as {
  toPosix: (p: string) => string
  relPosix: (root: string, abs: string) => string
}

describe('repo-path', () => {
  it('leaves a forward-slash path alone — it must be idempotent, since CI calls it on already-posix paths', () => {
    expect(toPosix('app/api/user/goals/route.ts')).toBe('app/api/user/goals/route.ts')
  })

  it('normalises the shape Windows actually produces', () => {
    // Written literally, not built with path.join: on this runner path.join gives forward slashes,
    // so deriving the input from the platform would test nothing.
    const windowsJoined = ['app', 'api', 'user', 'goals', 'route.ts'].join('\\')
    expect(toPosix(windowsJoined)).toBe('app/api/user/goals/route.ts')
  })

  it('a normalised key matches a hand-written baseline key — the lookup that was failing', () => {
    const BASELINE: Record<string, number> = { 'app/api/user/goals/route.ts': 1 }
    const walked = ['app', 'api', 'user', 'goals', 'route.ts'].join('\\')
    expect(BASELINE[walked]).toBeUndefined()      // what the scripts were doing
    expect(BASELINE[toPosix(walked)]).toBe(1)     // what they do now
  })

  it('relPosix strips the root and normalises in one step', () => {
    expect(relPosix(process.cwd(), `${process.cwd()}/lib/sign-out.ts`)).toBe('lib/sign-out.ts')
  })

  it('handles a path with no separator at all', () => {
    expect(toPosix('package.json')).toBe('package.json')
  })
})
