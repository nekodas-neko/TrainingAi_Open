import { z } from 'zod'
import { INGEST_FUTURE_TOLERANCE_MS } from '../validation/ingest-clock'

/**
 * Issue 2721 — a stale phone cannot overwrite a newer workout log.
 *
 * A phone that edits a workout log offline pushes it later, and the server used to upsert it
 * unconditionally, so a correction made on the server in between (the lbs-to-kg fix, a re-derived
 * 1RM) was reverted by the older copy. Each push for these domains now says when the phone made the
 * change (`editedAt`, epoch ms on the phone's clock), and the server keeps whichever copy was
 * decided later (`exercise_logs.client_edited_at`).
 *
 * `updated_at` cannot carry this: it is server write time (trigger, migration 069), so a log made
 * offline and then edited offline would read as older than its own first push.
 */

/** The outbox domains whose payloads carry `editedAt`. All three write one `exercise_logs` row. */
export const EDIT_STAMPED_DOMAINS = ['workout_log', 'exercise_log_edit', 'exercise_log_delete'] as const
export type EditStampedDomain = (typeof EDIT_STAMPED_DOMAINS)[number]

export function isEditStampedDomain(domain: string): domain is EditStampedDomain {
  return (EDIT_STAMPED_DOMAINS as readonly string[]).includes(domain)
}

/** Epoch ms, same bounds the workout payload already uses for set timestamps (2020 to 2099). */
export const EditedAtSchema = z.number().int().min(1_600_000_000_000).max(4_100_000_000_000)

/**
 * `editedAt` as the server reads it from a push. A stamp that is missing, out of range or not a
 * number reads as absent, so the push is applied as `unstamped` rather than rejected: a phone with a
 * broken clock still has a real edit to deliver, and an `errors` entry would retry it until it
 * dead-lettered.
 */
export const PushedEditedAtSchema = z
  .unknown()
  .transform((value): number | undefined => (EditedAtSchema.safeParse(value).success ? (value as number) : undefined))
  .optional()

/**
 * Add `editedAt: now` to a payload for one of the stamped domains. A payload that already carries
 * one keeps it: a mutation re-queued later (a stranded workout, a retry) was still made at its first
 * stamp, and restamping it would let it beat a server fix made in between.
 */
export function withEditedAt<P extends Record<string, unknown>>(domain: string, payload: P, now: number): P {
  if (!isEditStampedDomain(domain)) return payload
  if (typeof payload.editedAt === 'number') return payload
  return { ...payload, editedAt: now }
}

/**
 * How a write to an `exercise_logs` row records when its content was decided.
 *
 * - `client`: a push that carries `editedAt`. The rule applies, and on success the row takes the
 *   phone's time.
 * - `server`: a web route or a server-side fix, a live write made now. The row takes `now()`.
 * - `unstamped`: a push from a client that does not send `editedAt` yet. Accepted as before, and the
 *   stamp is cleared: the row's content now comes from a write whose time is unknown, so the next
 *   stamped push should not be refused against a time that no longer describes it.
 */
export type EditStamp =
  | { kind: 'client'; at: Date }
  | { kind: 'server' }
  | { kind: 'unstamped' }

/**
 * A stamp further ahead of the server than ordinary clock skew is capped at server now plus that
 * tolerance. Stored as it came, a far-future stamp (a phone set to 2090) would supersede every later
 * honest edit to the row, and the row would never recover.
 */
export function editStampFromPayload(payload: { editedAt?: number | null }, now: number = Date.now()): EditStamp {
  if (!EditedAtSchema.safeParse(payload.editedAt).success) return { kind: 'unstamped' }
  return { kind: 'client', at: new Date(Math.min(payload.editedAt!, now + INGEST_FUTURE_TOLERANCE_MS)) }
}

/**
 * The rule. A stamped push is superseded only by a row decided strictly later; an equal time is the
 * same edit replayed and applies. A row with no stamp (every row before the migration, and any row an
 * unstamped push wrote) accepts any push, as before.
 */
export function isSupersededEdit(rowClientEditedAt: Date | null | undefined, stamp: EditStamp): boolean {
  if (stamp.kind !== 'client' || rowClientEditedAt == null) return false
  return rowClientEditedAt.getTime() > stamp.at.getTime()
}

/** The `warnings` entry a push gets when its write was skipped for a newer copy on the server. */
export const SUPERSEDED_WARNING = 'superseded: the server holds a newer copy of this exercise log'
/** The `warnings` entry for a stamped-domain push with no `editedAt`, counted until old clients are gone. */
export const UNSTAMPED_WARNING = 'unstamped: pushed without editedAt, applied as last-writer-wins'
