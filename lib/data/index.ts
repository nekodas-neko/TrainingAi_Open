import type { WorkoutRepository } from './repository'
import { PostgresWorkoutRepository } from './postgres/adapter'
import { ensureSchema } from './postgres/client'

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
  if (!repo) repo = new PostgresWorkoutRepository()
  return repo
}

// Alias kept for any callers that used the old name
export const getRepositoryAsync = getRepository

export type { WorkoutRepository }
