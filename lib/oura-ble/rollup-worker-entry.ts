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
import { ensureServerOuraConstants } from '@/lib/oura-models/constants-inject'

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

/**
 * Errors cross the thread boundary as data — an Error instance does not survive structured clone
 * with its prototype, so it has to be flattened to a string here.
 *
 * **Walk the cause chain, and do not stop at `.message`.** Drizzle wraps every driver failure in a
 * `DrizzleQueryError` whose message is only `Failed query: <sql>\nparams: …` — the reason lives in
 * `.cause`, and `pg` puts the discriminating part in `.code`. Taking the message alone therefore
 * reported *which* query failed and never *why*, which is a permanent blind spot on the heaviest
 * operation in the app: on 2026-08-17 a redecode failed three times in a row and the only thing
 * recoverable from the report was the SQL text. A statement timeout, a dead pooled connection, a
 * permissions error and a constraint violation were all indistinguishable.
 */
export function msg(err: unknown): string {
  const parts: string[] = []
  let cur: unknown = err
  const seen = new Set<unknown>()
  while (cur != null && !seen.has(cur)) {
    seen.add(cur)
    if (cur instanceof Error) {
      const code = (cur as { code?: unknown }).code
      parts.push(code != null ? `${cur.message} [${String(code)}]` : cur.message)
      cur = (cur as { cause?: unknown }).cause
    } else {
      parts.push(String(cur))
      break
    }
  }
  return parts.length > 0 ? parts.join('\n  caused by: ') : String(err)
}

async function handle(job: WorkerJob): Promise<WorkerReply> {
  // Its own realm, so it does NOT inherit the main thread's injected constants — only the
  // `OURA_CONSTANTS_DIR` it set in `process.env`, which a worker does copy at spawn. Idempotent, so
  // this is three boolean checks after the first job. Missing this call is how the port change
  // (Q-545) would have taken the rollup down here and nowhere else.
  ensureServerOuraConstants()
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
