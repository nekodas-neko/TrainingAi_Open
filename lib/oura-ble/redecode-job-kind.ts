/**
 * What a full-history redecode job was asked to write, and whether a new request may follow a run
 * that is already going instead of starting its own.
 *
 * Every full-history redecode button shares one job slot (one in-flight row per user in
 * `oura_redecode_jobs`, migration 196). Two full-history passes at once are the load that slot
 * exists to prevent, so a second request never starts a second run. Before issue 2383 a second
 * request simply followed whatever was running. That was wrong for the D0 step backfill: it asks
 * for `allowStepsDecrease`, and a plain redecode running without it rewrites the steps under the
 * normal "only ever raise" guard. The backfill followed that run, the correction never happened,
 * and the console said "Done. Backfill applied".
 *
 * The rule: a request may follow a running job only if that job writes everything the request
 * asked for. A plain redecode may follow a step backfill (the backfill does the full redecode too,
 * and its step correction was confirmed by the owner when it was started). A step backfill may
 * follow only another step backfill. Anything else is refused, never queued.
 *
 * The daytime-stress bucket backfill (issue 2236) adds a third and a fourth kind. It does NOT
 * redecode or re-aggregate: it only adds missing `oura_daytime_stress_buckets` rows. It shares the
 * slot (one full-history pass at a time) but writes nothing the other kinds write and they write
 * none of what it writes. Each of its two kinds follows only itself: a dry run writes nothing, so a
 * write request that followed one would report "applied" for rows never added, the same lie issue
 * 2383 fixed for the steps.
 *
 * `debugDate` is deliberately not compared: it only adds a diagnostic to the response and changes
 * nothing that is written.
 *
 * Pure and dependency-free so the route, the job store and the admin screen read the same rule.
 */

export type RedecodeJobKind = 'step-backfill' | 'redecode' | 'stress-backfill' | 'stress-backfill-dry-run'

/** The kind of run a job's stored `opts` describe. Only a literal `true` counts as the backfill:
 *  an old row, a missing key or a stringly value is a plain redecode, which is the safe reading
 *  for a screen deciding whether to claim the step correction was applied. */
export function redecodeJobKind(opts: Record<string, unknown> | null | undefined): RedecodeJobKind {
  // Only a literal `false` is a write: a missing or odd `dryRun` reads as the dry run, the kind
  // that cannot change anything.
  if (opts?.stressBackfill === true) return opts.dryRun === false ? 'stress-backfill' : 'stress-backfill-dry-run'
  return opts?.allowStepsDecrease === true ? 'step-backfill' : 'redecode'
}

/** True for the two kinds that only add stress buckets and never redecode. */
export function isStressBackfillKind(kind: RedecodeJobKind): boolean {
  return kind === 'stress-backfill' || kind === 'stress-backfill-dry-run'
}

/** True when a run of `running` kind writes everything a `requested` run would. */
export function canFollowRunningRedecode(requested: RedecodeJobKind, running: RedecodeJobKind): boolean {
  if (isStressBackfillKind(requested) || isStressBackfillKind(running)) return requested === running
  return requested === 'redecode' || running === 'step-backfill'
}

export const REDECODE_BUSY_FOR_BACKFILL_MESSAGE =
  'A redecode is already running. Wait for it to finish, then run the backfill.'

export const REDECODE_BUSY_FOR_STRESS_MESSAGE =
  'A different full-history job is already running. Wait for it to finish, then run the stress backfill.'
