/**
 * What a full-history redecode job was asked to write, and whether a new request may follow a run
 * that is already going instead of starting its own.
 *
 * Every full-history redecode button shares one job slot (one in-flight row per user in
 * `oura_redecode_jobs`, migration 196). Two full-history passes at once are the load that slot
 * exists to prevent, so a second request never starts a second run. A plain redecode follows a
 * running plain redecode. (The D0 step backfill, `allowStepsDecrease`, was a second kind until it
 * was retired in #2862; a stored job row that still carries the key reads as a plain redecode.)
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

export type RedecodeJobKind = 'redecode' | 'stress-backfill' | 'stress-backfill-dry-run'

/** The kind of run a job's stored `opts` describe. Anything that is not a stress backfill, an old
 *  row that still carries the retired `allowStepsDecrease` key included, is a plain redecode. */
export function redecodeJobKind(opts: Record<string, unknown> | null | undefined): RedecodeJobKind {
  // Only a literal `false` is a write: a missing or odd `dryRun` reads as the dry run, the kind
  // that cannot change anything.
  if (opts?.stressBackfill === true) return opts.dryRun === false ? 'stress-backfill' : 'stress-backfill-dry-run'
  return 'redecode'
}

/** True for the two kinds that only add stress buckets and never redecode. */
export function isStressBackfillKind(kind: RedecodeJobKind): boolean {
  return kind === 'stress-backfill' || kind === 'stress-backfill-dry-run'
}

/** True when a run of `running` kind writes everything a `requested` run would. */
export function canFollowRunningRedecode(requested: RedecodeJobKind, running: RedecodeJobKind): boolean {
  if (isStressBackfillKind(requested) || isStressBackfillKind(running)) return requested === running
  return requested === 'redecode'
}

export const REDECODE_BUSY_MESSAGE =
  'A different full-history job is already running. Wait for it to finish, then run the redecode.'

export const REDECODE_BUSY_FOR_STRESS_MESSAGE =
  'A different full-history job is already running. Wait for it to finish, then run the stress backfill.'
