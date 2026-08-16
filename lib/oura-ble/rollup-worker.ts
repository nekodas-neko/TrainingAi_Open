// Main-thread client for the BLE rollup worker (Q-213 Stage 2).
//
// `runRollupOffLoop` has the same contract as `repo.aggregateOuraRawSamples` — same arguments, same
// resolved value — so the ingest route's coalescing, in-flight guard and pending-span bookkeeping
// are unchanged. `runRedecodeOffLoop` does the same for the admin redecode route, which runs BOTH
// `redecodeOuraRawSamples` and a `fullHistory` aggregate; it keeps that route's per-phase error
// isolation, so a redecode failure still cannot prevent the re-aggregate. The only difference in
// either case is where the work runs.
//
// **The fallback is the safety property.** If the bundle is missing or the worker cannot start, this
// runs the rollup in-process, which is exactly today's behaviour. A broken worker degrades to the
// status quo; it never drops a rollup.
import path from 'path'
import { existsSync } from 'fs'
import { Worker } from 'node:worker_threads'
import type { OuraRawAggregateResult } from '@/lib/data/repository'

type RollupOpts = {
  sinceDs?: number
  debugDate?: string
  dumpOnly?: boolean
  fullHistory?: boolean
  allowStepsDecrease?: boolean
  disableNeuralStager?: boolean
}

type RedecodeCounts = { scanned: number; updated: number; restamped: number }

export type RedecodePhases = {
  redecoded: RedecodeCounts | null
  redecodeError: string | null
  aggregated: OuraRawAggregateResult | null
  aggregateError: string | null
}

const WORKER_BUNDLE = path.join(process.cwd(), '.rollup-worker', 'rollup-worker.cjs')

// 2, not the default 10: the worker runs the pg client in its own realm, so it opens its own pool on
// top of the request pool. See `poolMax()` in lib/data/postgres/client.ts.
const WORKER_POOL_MAX = '2'

type Pending = {
  // Resolved with whichever payload the job kind returns; each public wrapper below owns its own
  // typed Promise, so the untyped hop through here is confined to this module.
  resolve: (r: unknown) => void
  reject: (e: Error) => void
}

let worker: Worker | null = null
let spawnFailed = false
let nextJobId = 1
const pending = new Map<number, Pending>()

function failAllPending(err: Error): void {
  for (const p of pending.values()) p.reject(err)
  pending.clear()
}

function getWorker(): Worker | null {
  if (worker) return worker
  if (spawnFailed) return null
  if (!existsSync(WORKER_BUNDLE)) {
    // Not an error worth reporting on every run: `next build`/`pnpm dev` produce this bundle, so its
    // absence means someone is running the server another way. Say it once, then fall back quietly.
    console.warn(`[oura-ble] rollup worker bundle not found at ${WORKER_BUNDLE} — running the rollup in-process`)
    spawnFailed = true
    return null
  }
  try {
    const w = new Worker(WORKER_BUNDLE, {
      env: { ...process.env, PG_POOL_MAX: WORKER_POOL_MAX },
      workerData: { poolMax: WORKER_POOL_MAX },
    })
    w.on('message', (msg: {
      id?: number
      ok?: boolean
      result?: OuraRawAggregateResult
      phases?: RedecodePhases
      message?: string
    }) => {
      if (typeof msg?.id !== 'number') {
        // The `ready` handshake, logged once per process. Whether the rollup is actually off the
        // request loop is an operational fact worth being able to read off a deploy's logs — the
        // fallback is silent-by-design in every other respect.
        console.info('[oura-ble] rollup worker ready — rollups run off the request loop')
        return
      }
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.phases ?? msg.result)
      else p.reject(new Error(msg.message ?? 'rollup worker failed'))
    })
    w.on('error', (err) => {
      worker = null
      failAllPending(err instanceof Error ? err : new Error(String(err)))
    })
    w.on('exit', (code) => {
      worker = null
      // An exit with jobs outstanding must reject them, or the route's per-user in-flight guard
      // never clears and that user gets no further rollups for the life of the process.
      failAllPending(new Error(`rollup worker exited with code ${code}`))
    })
    // Never hold the process open — the worker is a place to do work, not a reason to stay alive.
    w.unref()
    worker = w
    return w
  } catch (err) {
    console.error('[oura-ble] rollup worker failed to start — running the rollup in-process:', String(err).slice(0, 300))
    spawnFailed = true
    return null
  }
}

async function runInProcess(userId: string, timezone: string, opts?: RollupOpts): Promise<OuraRawAggregateResult> {
  const { getRepositoryAsync } = await import('@/lib/data')
  const repo = await getRepositoryAsync()
  return repo.aggregateOuraRawSamples(userId, timezone, opts)
}

export async function runRollupOffLoop(
  userId: string,
  timezone: string,
  opts?: RollupOpts,
): Promise<OuraRawAggregateResult> {
  const w = getWorker()
  if (!w) return runInProcess(userId, timezone, opts)

  const id = nextJobId++
  return new Promise<OuraRawAggregateResult>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (r: unknown) => void, reject })
    w.postMessage({ kind: 'rollup', id, userId, timezone, opts })
  })
}

/**
 * The admin redecode route's two phases, off the request loop.
 *
 * `redecodeFirst: false` is the route's `dumpOnly` path — a bounded aggregate for one night's
 * diagnostic, no redecode. Either way this resolves with per-phase results and errors rather than
 * rejecting: the route's contract is that neither phase can fail the request, and that a redecode
 * failure must not prevent the re-aggregate.
 */
export async function runRedecodeOffLoop(
  userId: string,
  timezone: string,
  opts: RollupOpts,
  redecodeFirst: boolean,
): Promise<RedecodePhases> {
  const w = getWorker()
  if (!w) return runRedecodeInProcess(userId, timezone, opts, redecodeFirst)

  const id = nextJobId++
  return new Promise<RedecodePhases>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (r: unknown) => void, reject })
    w.postMessage({ kind: 'redecode', id, userId, timezone, opts, redecodeFirst })
  })
}

async function runRedecodeInProcess(
  userId: string,
  timezone: string,
  opts: RollupOpts,
  redecodeFirst: boolean,
): Promise<RedecodePhases> {
  const { getRepositoryAsync } = await import('@/lib/data')
  const repo = await getRepositoryAsync()
  const msg = (err: unknown) => (err instanceof Error ? err.message : String(err))

  let redecoded: RedecodeCounts | null = null
  let redecodeError: string | null = null
  if (redecodeFirst) {
    try {
      redecoded = await repo.redecodeOuraRawSamples(userId)
    } catch (err) {
      redecodeError = msg(err)
    }
  }
  let aggregated: OuraRawAggregateResult | null = null
  let aggregateError: string | null = null
  try {
    aggregated = await repo.aggregateOuraRawSamples(userId, timezone, opts)
  } catch (err) {
    aggregateError = msg(err)
  }
  return { redecoded, redecodeError, aggregated, aggregateError }
}

// Tests only: the worker is a process-lifetime singleton, and a test that spawned one would
// otherwise leave it behind for the next file in the same vitest worker.
export async function __stopRollupWorker(): Promise<void> {
  const w = worker
  worker = null
  spawnFailed = false
  failAllPending(new Error('rollup worker stopped'))
  if (w) await w.terminate()
}
