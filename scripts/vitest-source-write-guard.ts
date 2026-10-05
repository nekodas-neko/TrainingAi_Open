/**
 * LB-194. No test may write into the app's own source tree.
 *
 * `check-comment-blindness.test.ts` appended a fixture to the real `components/workout/set-card.tsx`
 * and restored it in `finally`. For the length of that case a tracked file differed from HEAD, in a
 * suite that runs ~9 minutes, and `git add -A` in that window committed the fixture twice in one
 * session. The restore then made the file read as an unrelated edit. A `finally` makes that mistake
 * invisible, not impossible, so the guard refuses the write itself.
 *
 * Installed from `vitest.setup.ts`. It patches the `node:fs` write calls and then runs
 * `syncBuiltinESMExports`, so `import { writeFileSync } from 'node:fs'` is covered as well as
 * `fs.writeFileSync`. Writes under `app/`, `components/`, `lib/` and `packages/` throw, except inside a
 * gitignored `__check_fixture__/` folder (the sanctioned place for a scanner's fixture copy) or
 * `node_modules`. Temp dirs, the repo root and `scripts/` are untouched.
 */
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'

const ROOT = process.cwd()
const GUARDED = ['app', 'components', 'lib', 'packages'].map(d => path.join(ROOT, d) + path.sep)
const EXEMPT_SEGMENTS = new Set(['__check_fixture__', 'node_modules'])

export function isGuardedSourcePath(target: unknown): boolean {
  if (typeof target !== 'string' && !(target instanceof URL) && !Buffer.isBuffer(target)) return false
  const raw = target instanceof URL ? target.pathname : String(target)
  const abs = path.resolve(ROOT, raw)
  if (!GUARDED.some(g => abs.startsWith(g))) return false
  return !abs.split(path.sep).some(seg => EXEMPT_SEGMENTS.has(seg))
}

function refuse(op: string, target: unknown): never {
  throw new Error(
    `LB-194: a test called fs.${op} on ${String(target)}, which is tracked app source. ` +
    `Write a copy under a __check_fixture__/ folder beside it (gitignored), or to a temp dir.`)
}

let installed = false
export function installSourceWriteGuard(): void {
  if (installed) return
  installed = true
  const f = fs as unknown as Record<string, (...a: unknown[]) => unknown>
  const p = fs.promises as unknown as Record<string, (...a: unknown[]) => unknown>
  const wrap = (obj: Record<string, (...a: unknown[]) => unknown>, name: string, argIdx: number[]) => {
    const orig = obj[name]
    if (typeof orig !== 'function') return
    obj[name] = function guarded(this: unknown, ...args: unknown[]) {
      for (const i of argIdx) if (isGuardedSourcePath(args[i])) refuse(name, args[i])
      return orig.apply(this, args)
    }
  }
  for (const n of ['writeFileSync', 'appendFileSync', 'rmSync', 'unlinkSync', 'truncateSync']) wrap(f, n, [0])
  wrap(f, 'copyFileSync', [1])
  wrap(f, 'renameSync', [0, 1])
  for (const n of ['writeFile', 'appendFile', 'rm', 'unlink', 'truncate']) wrap(p, n, [0])
  wrap(p, 'copyFile', [1])
  wrap(p, 'rename', [0, 1])
  syncBuiltinESMExports()
}
