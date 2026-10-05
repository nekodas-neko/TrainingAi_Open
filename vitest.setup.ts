/**
 * Inject the vendored model constants before any test runs.
 *
 * The ports take their constants by injection rather than reading disk (Q-221, Q-545), which is
 * what keeps `node:fs` out of the Oura rollup's module graph. On the server that injection happens
 * once at boot in `instrumentation-node.ts`; under vitest there is no boot, so it happens here.
 *
 * A setup file is early enough because every port reads its constants **lazily, on first use** —
 * the module-scope reads that once made this impossible were removed for `next build`'s sake
 * (Q-49 A4b). `OURA_CONSTANTS_DIR` still has to be set in `vitest.config.ts` rather than here,
 * because that is read when this file's own imports evaluate.
 */
import { afterAll, expect } from 'vitest'
import { ensureServerOuraConstants } from '@/lib/oura-models/constants-inject'
import { installSourceWriteGuard } from './scripts/vitest-source-write-guard'

ensureServerOuraConstants()

// LB-194: a test that writes into app source fails at the write, instead of racing a `git add -A`.
installSourceWriteGuard()

/**
 * Name a console emission that escapes its own test file, instead of letting it become LB-168.
 *
 * Vitest carries every console call from the worker to the main process over an RPC. A log emitted
 * *after* its file's tests have finished can still be in flight when the worker's channel closes,
 * and that is `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` — exit
 * code 1 beside `0 failed`, attributed to whichever worker happened to be closing. It reproduced on
 * no file and named no cause for a day, because that attribution is meaningless by construction.
 *
 * **Measured 2026-09-27 over two clean full runs: eight escapes, ONE emitter.** Every one was
 * `ensureSchema`'s `[ensureSchema] 0 applied, 0 already present, 0 failed` summary
 * (`lib/data/postgres/client.ts`), reached from an unawaited `scheduleFlush` in `lib/rate-limit.ts`
 * whose `flushKey` awaits `ensureSchema` after its test file has returned. **So the fix is that the
 * summary should not print under test** — one line in Lane A's file, which removes the only escaping
 * emitter. This hook exists because that is the second-best guarantee: it cannot stop an escape, but
 * it names the next one for free rather than letting it cost another session.
 *
 * Non-fatal on purpose. An escape only *sometimes* loses the race, so failing here would trade a
 * rare confusing red for a rare clear one while breaking runs that are otherwise sound. Writes
 * straight to `stderr`, which is the process's own fd and therefore cannot join the race it reports.
 *
 * **Two fixes were built, measured and rejected — do not re-derive them.**
 * · *Draining globally from this file* (`await import('@/lib/rate-limit')` in an `afterAll`): correct
 *   in shape, and it took the suite from **348 s to 482 s (+39%)**, because it pulls `pg` into all
 *   ~1,100 files' isolated module registries. It also fails 70 files outright — they `vi.mock` the
 *   module partially, and vitest's mock proxy THROWS on reading an absent export, so even
 *   `mod.fn?.()` raises. `'fn' in mod` is the only safe probe.
 * · *Draining per-file*, as six test files already do: **incomplete, and not for the obvious reason.**
 *   Which files escape CHANGES BETWEEN RUNS — the flush races the remainder of its own file, so a
 *   fast run swallows it and a slow one does not. Two runs named six different files. Any file
 *   exercising a rate-limited route is a candidate, so there is no finite list to fix.
 */
let fileDone = false
// One floating flush logged fourteen times in one file on 2026-09-27. Fourteen identical blocks
// bury the signal, and every distinct escape is what matters, so each is reported once.
const reported = new Set<string>()

type ConsoleFn = (...args: unknown[]) => void

/**
 * `ensureSchema`'s informational output, which is the one emitter measured to escape (LB-168).
 *
 * It is content-free under test — eleven `0 applied, 0 already present, 0 failed` lines per run —
 * and it is reached from an unawaited `scheduleFlush` in `lib/rate-limit.ts`, so it arrives after
 * its test file has returned and can be mid-RPC as the worker's channel closes. Not forwarding it
 * means vitest never carries it, which removes the race for this path rather than hiding a failure.
 *
 * **Deliberately `info` only.** `ensureSchema`'s `FAILED` and `DID NOT APPLY` lines are `console.error`
 * and still print — a migration that cannot apply is exactly what must not be swallowed here. And
 * this is done in the test setup rather than in `lib/data/postgres/client.ts`, so the log keeps
 * working in production, where it is the only record of what a boot applied, and production code
 * gains no knowledge that tests exist (there is no `process.env.VITEST` anywhere in it today).
 */
const isEnsureSchemaNoise = (args: unknown[]) =>
  typeof args[0] === 'string' && args[0].startsWith('[ensureSchema] ')

/** Wraps one console method so a call after its file has finished reports itself. */
function detectLateCalls(method: 'info' | 'warn' | 'error', original: ConsoleFn): ConsoleFn {
  return (...args: unknown[]) => {
    if (method === 'info' && isEnsureSchemaNoise(args)) return
    original(...args)
    if (!fileDone) return
    const where = (new Error().stack ?? '').split('\n').slice(2, 7).join('\n')
    const seen = `${method}:${String(args[0]).slice(0, 160)}:${where}`
    if (reported.has(seen)) return
    reported.add(seen)
    process.stderr.write(
      `\n[late-console] a console.${method} escaped ${expect.getState().testPath ?? 'a test file'} ` +
        `— see vitest.setup.ts (LB-168).\n  ${String(args[0]).slice(0, 160)}\n${where}\n` +
        `  Something unawaited is still running after this file's tests finished.\n\n`,
    )
  }
}

// Written out rather than looped: `console[method]` is a computed access `no-console` cannot resolve,
// so it errors on both the read and the write. `log`/`debug` are omitted because that same rule
// forbids them repo-wide at error level, tests included — nothing can emit one.
console.info = detectLateCalls('info', console.info.bind(console))
console.warn = detectLateCalls('warn', console.warn.bind(console))
console.error = detectLateCalls('error', console.error.bind(console))

afterAll(() => {
  // Registered before any per-file hook, so vitest's reverse hook order runs it LAST — after the
  // file's own cleanup, including any drain. Everything it then catches is genuinely post-file.
  fileDone = true
})
