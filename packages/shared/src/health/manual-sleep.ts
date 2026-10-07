/**
 * #2338 — a night the user enters by hand: a bed time and a wake time.
 *
 * One definition for the three writers — the web route (`POST /api/sleep-sessions/manual`), the
 * outbox push branch (`manual_sleep` in `pushMutations`) and the device's local write — so the row
 * each produces is the same row. They used to drift whenever a domain had two write paths; here the
 * parse, the bounds and the derived fields all live once.
 *
 * What a manual night is NOT: it has no stages, no efficiency, no heart rate and no awake time,
 * because nobody measured them. Those stay null rather than being estimated, and the sleep score
 * scores what is there (total sleep and timing) and reports the rest as missing coverage.
 */
import { z } from 'zod'
import { toAestDay } from '@trainingai/shared/date-utils'
import { manualSleepImplausibleReason } from '@trainingai/shared/validation/plausibility'

/**
 * The wire shape, shared by the route body and the outbox payload. Instants carry their offset so a
 * device in any timezone sends an unambiguous moment; the wake DATE is derived from them on the
 * server, never taken from the client (see {@link manualNightFromWindow}).
 *
 * `id` is the client's row id, so the device's local row and the server's row are one row and a pull
 * updates the local copy in place rather than adding a second. Optional for a caller with no local
 * store (the web build).
 */
export const ManualSleepNightSchema = z.object({
  id: z.string().uuid().optional(),
  sleepStart: z.string().datetime({ offset: true }),
  sleepEnd: z.string().datetime({ offset: true }),
}).strict()

export type ManualSleepNightInput = z.infer<typeof ManualSleepNightSchema>

/**
 * Issue 2606 — removing a night the user entered. The route body is `{ id }`; the outbox payload is
 * `{ id, deleted: true }`, the delete shape every outbox domain uses (`pendingDeletedIds`), on the
 * same `manual_sleep` domain as the save. Strict, so a stray field is refused rather than ignored.
 */
export const ManualSleepRemoveSchema = z.object({
  id: z.string().uuid(),
}).strict()

export const ManualSleepRemovePayloadSchema = z.object({
  id: z.string().uuid(),
  deleted: z.literal(true),
}).strict()

/** True when an outbox `manual_sleep` payload is a removal rather than a save. */
export function isManualSleepRemoval(payload: Record<string, unknown>): boolean {
  return payload.deleted === true
}

/** A validated manual night, with everything the row stores derived from its two ends. */
export interface ManualSleepNight {
  id?: string
  /** Wake date (YYYY-MM-DD) in the user's timezone — the `sleep_sessions.date` convention. */
  date: string
  sleepStart: Date
  sleepEnd: Date
  /** The whole window. Nobody measured the time it took to fall asleep or the wakings. */
  durationHours: number
  timeInBedHours: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The stored fields of a night from its window. The date is the local date the user WOKE on, in
 * their timezone — the date every `sleep_sessions` row carries and every reader looks a night up by.
 */
export function manualNightFromWindow(
  sleepStart: Date,
  sleepEnd: Date,
  tz: string,
  id?: string,
): ManualSleepNight {
  const hours = round2((sleepEnd.getTime() - sleepStart.getTime()) / 3_600_000)
  return { id, date: toAestDay(sleepEnd, tz), sleepStart, sleepEnd, durationHours: hours, timeInBedHours: hours }
}

export type ParsedManualNight =
  | { ok: true; night: ManualSleepNight }
  | { ok: false; reason: string; issues?: z.ZodError }

/**
 * Parse, bound and derive one manual night. `issues` is set when the shape was wrong (the route
 * answers that with its usual invalid-body response); `reason` alone means the shape was fine and
 * the night itself is implausible.
 */
export function parseManualNight(input: unknown, tz: string, now: Date): ParsedManualNight {
  const parsed = ManualSleepNightSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'invalid manual night', issues: parsed.error }
  const sleepStart = new Date(parsed.data.sleepStart)
  const sleepEnd = new Date(parsed.data.sleepEnd)
  const reason = manualSleepImplausibleReason({ sleepStart, sleepEnd }, now)
  if (reason) return { ok: false, reason }
  return { ok: true, night: manualNightFromWindow(sleepStart, sleepEnd, tz, parsed.data.id) }
}
