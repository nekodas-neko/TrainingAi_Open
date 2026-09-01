// LA-26. A repository method nothing calls is invisible to tsc (an unused export is not an error),
// to lint, and to the tests — it has shipped three times here (Q-301, Q-270, Q-231) and was only
// ever caught by someone asking why a production table was empty.
//
// These cases exist because the check was first verified by hand-injecting a dead method and then
// reverting it. That proved it worked once; it does not keep proving it. The failure mode that
// matters is the silent one — a regex or a path assumption drifts, the check passes forever, and
// nobody notices it stopped looking.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findDead } = require('../check-dead-repo-methods.js') as {
  findDead: (
    interfaceSrc: string,
    texts: [string, string][],
    implFile?: string,
  ) => { names: string[]; dead: string[] }
}

const IMPL = 'impl.ts'

const IFACE = `
export interface WorkoutRepository {
  liveMethod(userId: string): Promise<void>
  deadMethod(userId: string): Promise<void>
}
`

describe('dead repository methods (LA-26)', () => {
  it('finds a method nothing calls, and leaves a called one alone', () => {
    const { dead } = findDead(IFACE, [
      [IMPL, '  async liveMethod(u: string) {}\n  async deadMethod(u: string) {}'],
      ['app/api/x/route.ts', 'await repo.liveMethod(userId)'],
    ], IMPL)
    expect(dead).toEqual(['deadMethod'])
  })

  // The whole reason the check needs an implFile concept. Without it, the adapter's own
  // `async deadMethod(...)` signature reads as a call and every method looks alive — the check
  // would pass forever while looking like it worked.
  it('does not count the implementation signature as a caller', () => {
    const { dead } = findDead(IFACE, [
      [IMPL, '  async liveMethod(u: string) {}\n  async deadMethod(u: string) {}'],
    ], IMPL)
    expect(dead).toContain('deadMethod')
    expect(dead).toContain('liveMethod')
  })

  // A method called from ELSEWHERE in the adapter is alive — this is the distinction that makes the
  // check narrow enough to be useful. `upsertOuraSleep` is real: `saveSleepSession` calls it from
  // inside the data layer, and flagging it would have made the check noise.
  it('counts a call from elsewhere in the implementation file', () => {
    const { dead } = findDead(IFACE, [
      [IMPL, '  async liveMethod(u: string) {}\n  async deadMethod(u: string) {}\n  async other() { await this.deadMethod("u") }'],
    ], IMPL)
    expect(dead).toEqual(['liveMethod'])
  })

  it('reads every interface member, not just the first', () => {
    const { names } = findDead(IFACE, [], IMPL)
    expect(names).toEqual(['liveMethod', 'deadMethod'])
  })

  // Indentation is the only thing separating an interface member from a nested type's field or a
  // top-level function, so it is load-bearing rather than cosmetic.
  it('ignores lines that are not two-space interface members', () => {
    const src = `
export interface WorkoutRepository {
  realMember(a: string): Promise<void>
    nestedField(b: string): void
}
export function topLevelFn(c: string) {}
`
    const { names } = findDead(src, [], IMPL)
    expect(names).toEqual(['realMember'])
  })

  // A substring must not count: `getFoo` is not called by `getFooBar(...)`.
  it('does not treat a longer name as a call to the shorter one', () => {
    const src = `
export interface WorkoutRepository {
  getFoo(a: string): Promise<void>
}
`
    const { dead } = findDead(src, [['app/x.ts', 'await repo.getFooBar("a")']], IMPL)
    expect(dead).toEqual(['getFoo'])
  })
})

// LA-32. The file list was `git ls-files`, which cannot see an untracked file — so adding a
// repository method and its first caller together reported the method as dead until the caller was
// staged. That is the exact workflow this check exists to support, and it fired on Q-291's
// `listAiHealthInsightsForDate` whose only caller was a new file. A guard that fails on correct code
// is one somebody deletes.
describe('the file list covers the working tree, not just the index', () => {
  //
  // **The probe lives in a throwaway git repo, not in this one (LB-44).** It used to be written to
  // `lib/zz-dead-repo-methods-probe.ts` and deleted in a `finally`, which raced every test that walks
  // `app`/`components`/`lib` reading each file it finds: the walker listed the probe, this test
  // deleted it, the walker read it and threw `ENOENT`. The failure named
  // `lib/media/__tests__/no-data-url-fetch.test.ts` on a branch that had touched neither file, which
  // is the worst shape a flake can take — it reads as a missing source file and sends you into the
  // diff. Both files passed alone. A temp repo proves the same property and touches nothing anyone
  // else is reading.
  it('includes an untracked source file', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sourceFileList } = require('../check-dead-repo-methods.js') as { sourceFileList: (cwd?: string) => string[] }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('os') as typeof import('os')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('child_process') as typeof import('child_process')

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-repo-probe-'))
    try {
      execSync('git init -q', { cwd: dir })
      // Tracked and untracked, so the assertion is that BOTH are listed rather than that anything is.
      fs.writeFileSync(path.join(dir, 'tracked.ts'), 'export const tracked = 1\n')
      execSync('git add tracked.ts', { cwd: dir })
      fs.writeFileSync(path.join(dir, 'untracked.ts'), 'export const untracked = 1\n')
      // Gitignored files stay out — that is the `--exclude-standard` half of the flag pair.
      fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.ts\n')
      fs.writeFileSync(path.join(dir, 'ignored.ts'), 'export const ignored = 1\n')

      const listed = sourceFileList(dir)
      expect(listed).toContain('untracked.ts')
      expect(listed).toContain('tracked.ts')
      expect(listed).not.toContain('ignored.ts')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still includes tracked files', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sourceFileList } = require('../check-dead-repo-methods.js') as { sourceFileList: () => string[] }
    expect(sourceFileList()).toContain('lib/data/postgres/adapter.ts')
  })
})
