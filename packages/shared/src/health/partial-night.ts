/**
 * #2265 — a night the owner marked partial: the ring came off, or went on late.
 *
 * The ring measured the hours it was worn correctly. What it cannot know is that those hours were
 * not the whole night, so every number that depends on how long it recorded (time asleep, time in
 * bed, efficiency, latency, restless periods, the stage hours and the bed and wake clock times) reads
 * a short observation as a short night. HRV, heart rate and breathing are real measurements of real
 * sleep and stay.
 *
 * **This file is the one place that says which is which.** A marked night keeps its physiology and
 * loses {@link PARTIAL_NIGHT_DROPPED_FIELDS}; the sleep score, the baselines and every duration-style
 * reader go through {@link withoutPartialDuration} or {@link nightsWithDuration}, so a new reader has
 * one function to call and the answer to "does a marked night count here" cannot differ by screen.
 *
 * Manual, never detected: an automatic "looks partial" rule would eventually hide a genuinely bad
 * short night, which is exactly what the Sleep Score exists to show. Marking is not deleting: the
 * row, its window and its physiology stay, and unmarking (`partialNightAt` back to null) returns the
 * night exactly, because nothing here writes a value anywhere. Every function below is a pure read.
 */
import { z } from 'zod'

/** The wire shape of the mark, shared by the route body and the `partial_night` outbox payload. */
export const PartialNightPayloadSchema = z.object({
  /** A `sleep_sessions.id` of a night a device measured. */
  id: z.string().uuid(),
  /** true marks the night partial, false unmarks it. */
  partial: z.boolean(),
}).strict()

export type PartialNightPayload = z.infer<typeof PartialNightPayloadSchema>

/** The duration-derived fields a marked night loses. HRV, heart rate and breathing are not here. */
export const PARTIAL_NIGHT_DROPPED_FIELDS = [
  'durationHours', 'timeInBedHours', 'efficiency', 'onsetLatencySec', 'restlessPeriods',
  'deepSleepHours', 'remSleepHours', 'lightSleepHours', 'awakHours',
] as const

interface MaybePartial { partialNightAt?: Date | string | null }

/** True when the owner marked this night (or, for a reassembled night, any window of it) partial. */
export function isPartialNight(night: MaybePartial | null | undefined): boolean {
  return night?.partialNightAt != null
}

/**
 * The night as a scorer or a normal should see it: a marked night with its duration-derived fields
 * removed (its window and its physiology kept), an unmarked night returned as the same object.
 * Without a duration {@link computeSleepScore} has nothing to score, so the night has no Sleep Score
 * of its own, and every `durationHours >= x` gate leaves it out of a duration, schedule or
 * awake-fraction normal.
 */
export function withoutPartialDuration<T extends MaybePartial>(night: T): T {
  if (!isPartialNight(night)) return night
  const out: Record<string, unknown> = { ...(night as object) }
  for (const f of PARTIAL_NIGHT_DROPPED_FIELDS) out[f] = undefined
  return out as T
}

/** {@link withoutPartialDuration} over a series. An unmarked series comes back element for element. */
export function scoredNights<T extends MaybePartial>(nights: readonly T[]): T[] {
  return nights.map(withoutPartialDuration)
}

/**
 * The nights that still have a duration to count: for a reader whose whole question is about hours
 * (an average, a trend, a goal), where a marked night has nothing to contribute. A reader that also
 * uses the physiology keeps the full series and calls {@link withoutPartialDuration} per night.
 */
export function nightsWithDuration<T extends MaybePartial>(nights: readonly T[]): T[] {
  return nights.filter(n => !isPartialNight(n))
}
