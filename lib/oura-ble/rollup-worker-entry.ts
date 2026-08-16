// The BLE rollup, running inside a `worker_threads` realm (Q-213 Stage 2).
//
// This file is NOT imported by the app. It is bundled on its own by
// `scripts/build-rollup-worker.mjs` into `.rollup-worker/rollup-worker.cjs` and loaded from there by
// `lib/oura-ble/rollup-worker.ts`. It has to be a separate bundle because the repository reaches
// `onnxruntime-node`, a native addon webpack cannot bundle (`serverExternalPackages` in
// next.config.ts) — so there is no Next build output to point a Worker at.
//
// Why a worker at all: `aggregateOuraRawSamples` is main-thread JS, and on 2026-08-13 a two-minute
// run starved a concurrent `POST /api/oura-ble/samples` into a 500 after 27.6 s — `pg`'s connect
// timeout is a JS timer, so a blocked loop kills healthy connections. A non-2xx there holds the
// ring's history cursor and triggers a re-drain, which is the storm mechanism. Narrowing the window
// (Stage 1) shortened that window; only moving the work off the loop removes it.
import { parentPort, workerData } from 'node:worker_threads'
import { PostgresWorkoutRepository } from '@/lib/data/postgres/adapter'
import type { OuraRawAggregateResult } from '@/lib/data/repository'

/** Everything `aggregateOuraRawSamples` accepts. The ingest path passes only `sinceDs`; the admin
 *  redecode route passes the rest. */
export type AggregateOpts = {
  sinceDs?: number
  debugDate?: string
  dumpOnly?: boolean
  fullHistory?: boolean
  allowStepsDecrease?: boolean
  disableNeuralStager?: boolean
}

export type RedecodeCounts = { scanned: number; updated: number; restamped: number }

export type WorkerJob =
  /** Ingest path. Rejects on failure so the route can put its claimed span back. */
  | { kind: 'rollup'; id: number; userId: string; timezone: string; opts?: AggregateOpts }
  /**
   * Admin redecode. Runs both phases with **independent** error isolation and never fails the job —
   * the route's contract is that a redecode failure must not prevent the re-aggregate, or vice
   * versa, and that neither ever 500s the request.
   */
  | { kind: 'redecode'; id: number; userId: string; timezone: string; opts?: AggregateOpts; redecodeFirst: boolean }

export type WorkerReply =
  | { id: number; ok: true; result: OuraRawAggregateResult }
  | { id: number; ok: false; message: string; stack?: string }
  | {
      id: number
      ok: true
      phases: {
        redecoded: RedecodeCounts | null
        redecodeError: string | null
        aggregated: OuraRawAggregateResult | null
        aggregateError: string | null
      }
    }

// Deliberately NOT `getRepositoryAsync()`: that calls `ensureSchema()`, which runs the ~180-file
// migration sweep. The main process already ran it at boot (instrumentation-node.ts), and a second
// sweep racing it from a worker is a hazard, not a safety net.
const repo = new PostgresWorkoutRepository()

// Errors cross the thread boundary as data — an Error instance does not survive structured clone
// with its prototype, and the caller only needs the message to report.
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function handle(job: WorkerJob): Promise<WorkerReply> {
  if (job.kind === 'redecode') {
    let redecoded: RedecodeCounts | null = null
    let redecodeError: string | null = null
    if (job.redecodeFirst) {
      try {
        redecoded = await repo.redecodeOuraRawSamples(job.userId)
      } catch (err) {
        redecodeError = msg(err)
      }
    }
    let aggregated: OuraRawAggregateResult | null = null
    let aggregateError: string | null = null
    try {
      aggregated = await repo.aggregateOuraRawSamples(job.userId, job.timezone, job.opts)
    } catch (err) {
      aggregateError = msg(err)
    }
    return { id: job.id, ok: true, phases: { redecoded, redecodeError, aggregated, aggregateError } }
  }

  try {
    const result = await repo.aggregateOuraRawSamples(job.userId, job.timezone, job.opts)
    return { id: job.id, ok: true, result }
  } catch (err) {
    return { id: job.id, ok: false, message: msg(err), stack: err instanceof Error ? err.stack : undefined }
  }
}

if (parentPort) {
  const port = parentPort
  port.on('message', (job: WorkerJob) => {
    void handle(job).then((reply) => port.postMessage(reply))
  })
  port.postMessage({ ready: true, pid: process.pid, poolMax: workerData?.poolMax })
}
