import { z } from 'zod'
import { SYNCED_MUTATION_DOMAINS } from '../mutation-schema'

/**
 * Sync parity vectors (#2490, the F5 plan from the #2288 review, steps 1-3).
 *
 * A vector is a language-neutral description of one sync behaviour: the device's local tables
 * before, a sequence of actions, and the local tables (plus what went over the wire) after. It names
 * no TypeScript function and imports nothing from the client, so a second implementation — a Kotlin
 * client on Room, if Stage 5 ever starts — can execute the same JSON and be held to the same result.
 *
 * Everything here is data. The one TypeScript runner is
 * `lib/local-store/__tests__/parity/runner.ts`; it executes each vector against the real
 * `lib/sqlite/migrations.ts` schema on `node:sqlite` and the real `SQLiteLocalStore` + `sync-engine`.
 *
 * Conventions every runner must honour:
 * - Table and column names are the device's SQLite names (snake_case). Values are what SQLite stores:
 *   booleans are 0/1, JSON columns are JSON text. In `seed`, a boolean is written as 0/1 and an
 *   object or array is written as its JSON text, so a vector may use either form.
 * - `mutations_outbox` seed rows default `user_id` to {@link VECTOR_USER_ID}, `status` to 'pending'
 *   and `attempts` to 0; `payload` may be an object. Every other column is given explicitly.
 * - The wall clock is frozen at `now` for the whole vector. SQLite's own `strftime('now')` defaults
 *   are not frozen, so no expectation may depend on one.
 * - Network answers are scripted: a push or pull request with no scripted answer left fails the vector.
 */

export const VECTOR_FORMAT_VERSION = 1

/** The only user a vector acts as. The outbox is user-scoped, so this has to be fixed. */
export const VECTOR_USER_ID = 'vector-user'

/**
 * The pull flags the engine reports per page (`SyncedDomains` in `lib/local-store/sync-engine.ts`).
 * Listed here so a vector can name them without importing the client; the runner asserts this list
 * equals the keys a real pull returns, so a flag added on one side and not the other fails loudly.
 */
export const PULL_FLAGS = [
  'biometrics', 'programs', 'workouts', 'nutrition', 'supplements', 'activity', 'fitnessTests',
  'running', 'injuries', 'ouraDaily', 'dayCheckins', 'mealPlans',
] as const
export type PullFlag = (typeof PULL_FLAGS)[number]

/**
 * The device-side writes a vector may perform, named after the local store's write surface. This is
 * the vocabulary a second runner must map onto its own store; arguments are JSON, in the order the
 * TypeScript method takes them. Kept closed on purpose: a vector that needs a new action adds it here
 * first, which is where the second runner would learn it exists.
 */
export const LOCAL_ACTIONS = [
  'deleteSupplement', 'upsertSupplementLog', 'upsertPlanMealAnswer', 'updateExerciseLogLocally',
  'deleteFoodLog', 'deleteInjury', 'deleteSupplementLog', 'softDeleteActivityLogPending',
  'queueMutation', 'upsertManualSleepLocally', 'removeManualSleepLocally',
] as const
export type LocalAction = (typeof LOCAL_ACTIONS)[number]

const Row = z.record(z.string(), z.unknown())

// An instant, not a date param, but the both-separators rule scans every date regex, and nothing is
// lost by accepting the slash form here.
const IsoInstant = z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/)

/** One `/api/sync/pull` page. `body` omits every delta array it does not need; the runner fills `[]`. */
const PullPage = z.union([
  z.object({ status: z.literal(200).default(200), body: z.object({ syncedAt: IsoInstant, hasMore: z.boolean().optional() }).passthrough() }),
  z.object({ status: z.number().int().min(400).max(599) }),
])

/** One `/api/sync/push` answer. `errors` name outbox ids; every other id in the request succeeded. */
const PushResponse = z.object({
  status: z.number().int().min(200).max(599).default(200),
  errors: z.array(z.object({
    id: z.string(),
    error: z.string().default('rejected'),
    retryable: z.boolean().optional(),
  })).default([]),
})

const Step = z.discriminatedUnion('op', [
  /** A device-side write, as the app makes it. */
  z.object({ op: z.literal('local'), action: z.enum(LOCAL_ACTIONS), args: z.array(z.unknown()) }),
  /** One sync pull: the engine reads the cursor, fetches `pages` in order, applies each. */
  z.object({
    op: z.literal('pull'),
    pages: z.array(PullPage).min(1),
    fullResync: z.boolean().optional(),
    restore: z.boolean().optional(),
  }),
  /** One outbox drain, answered by `responses` in order (one per request; requests carry ≤5 mutations). */
  z.object({ op: z.literal('push'), responses: z.array(PushResponse) }),
])

/** Exact rows of one table, on the named columns only, ordered by `orderBy` (default: the first column). */
const TableExpectation = z.object({
  table: z.string(),
  columns: z.array(z.string()).min(1),
  where: Row.optional(),
  orderBy: z.string().optional(),
  rows: z.array(Row),
})

/** A mutation, matched on `domain` and `date` exactly and on `payload` as a subset. */
const MutationExpectation = z.object({
  domain: z.enum(SYNCED_MUTATION_DOMAINS),
  date: z.string().optional(),
  status: z.enum(['pending', 'failed']).optional(),
  attempts: z.number().int().optional(),
  payload: Row.optional(),
})

export const SyncVectorSchema = z.object({
  /** Unique across all vectors; the test name. */
  name: z.string().min(1),
  kind: z.enum(['incident', 'domain', 'pull-flag']),
  /** The incident or entry this pins (e.g. "DV-15"), or the outbox domain / pull flag it covers. */
  covers: z.string().min(1),
  /** Where the guarantee came from — the original test file, kept beside it. */
  source: z.string().optional(),
  /** One sentence: what must hold. */
  guarantee: z.string().min(1),
  /** Frozen wall clock for the whole vector. */
  now: IsoInstant,
  seed: z.record(z.string(), z.array(Row)).default({}),
  steps: z.array(Step).min(1),
  expect: z.object({
    tables: z.array(TableExpectation).default([]),
    /** The whole outbox after the last step, oldest first. Omit to leave it unchecked. */
    outbox: z.array(MutationExpectation).optional(),
    /** Every mutation sent across every push step, in send order. Omit to leave it unchecked. */
    pushed: z.array(MutationExpectation).optional(),
    /** The last pull step's result: flags are matched as a subset, the rest exactly. */
    pull: z.object({
      result: z.enum(['ok', 'failed']).default('ok'),
      flags: z.partialRecord(z.enum(PULL_FLAGS), z.boolean()).optional(),
      synced: z.number().int().optional(),
      hasMore: z.boolean().optional(),
    }).optional(),
    /** The persisted pull cursor after the last step. */
    cursor: IsoInstant.optional(),
  }),
  /**
   * A vector that exposes a real defect is committed failing, with the issue that tracks it, rather
   * than being bent to pass. The runner asserts it still fails, so a fix announces itself.
   */
  knownFailing: z.object({ issue: z.string(), reason: z.string() }).optional(),
})

export type SyncVector = z.infer<typeof SyncVectorSchema>
export type SyncVectorInput = z.input<typeof SyncVectorSchema>

export const SyncVectorFileSchema = z.object({
  formatVersion: z.literal(VECTOR_FORMAT_VERSION),
  vectors: z.array(SyncVectorSchema).min(1),
})
