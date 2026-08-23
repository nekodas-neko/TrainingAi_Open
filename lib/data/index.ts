import type { WorkoutRepository } from './repository'
import { PostgresWorkoutRepository } from './postgres/adapter'
import { ensureSchema } from './postgres/client'
import { tryEnsureServerOuraConstants } from '@/lib/oura-models/constants-inject'

let repo: WorkoutRepository | null = null

// Schema-readiness is memoised, but a FAILED attempt must never poison the process.
// `ensureSchema()` runs once (migrations + a couple of startup queries). If a transient
// DB hiccup makes it reject — e.g. a connection spike during a deploy rollout, when the
// old and new instances briefly overlap and momentarily exceed the Postgres connection
// limit — a *cached rejected* promise would make every getRepository() call throw for the
// entire life of the process: every DB route and SSR page 500ing until a manual restart,
// even though the DB recovered seconds later. (This took prod down once.) So we clear the
// cache on failure and let the next call retry, making startup self-healing.
let readyPromise: Promise<void> | null = null

function ensureReady(): Promise<void> {
  // During `next build` the Railway internal DB hostname is unreachable, so skip.
  if (!process.env.DATABASE_URL) return Promise.resolve()
  if (!readyPromise) {
    readyPromise = ensureSchema().catch((err) => {
      readyPromise = null // allow the next getRepository() to retry instead of caching the rejection
      throw err
    })
  }
  return readyPromise
}

export async function getRepository(): Promise<WorkoutRepository> {
  await ensureReady()
  if (!repo) {
    // Inject the Oura model constants into the ports that read them, here rather than only at boot.
    //
    // Boot injection (`instrumentation-node.ts`) sets module-level state and an env var in the
    // process that ran boot — which is not necessarily the process that serves a request. Measured
    // 2026-08-23: a route handler read `hasDaytimeStressConstants()` as false and
    // `OURA_CONSTANTS_DIR` as undefined while boot had logged a successful delivery, and
    // `/api/body-battery` 500'd in production for two hours on exactly that.
    //
    // This is the right hook because it is the one thing every path that can reach a constants
    // read already goes through, it is server-only by construction (it pulls in `pg`), and it runs
    // once per process. Deliberately the non-throwing variant: an unreadable constants directory
    // must not take down every DB route, and the accessor still throws at the read site.
    tryEnsureServerOuraConstants()
    repo = new PostgresWorkoutRepository()
  }
  return repo
}

// Alias kept for any callers that used the old name
export const getRepositoryAsync = getRepository

export type { WorkoutRepository }
