import { z } from 'zod';
import {
  formatTimeOfDay,
  localClockTimeToDate,
  msToHHMMInTz,
  toAestDay,
} from '@trainingai/shared/date-utils';
import { activityPayload, type ActivityPayload } from '../../activities/data/models.ts';

/**
 * Walks the server found in the day's movement that nobody recorded, offered on Home as "Looks like
 * you walked 9:10–9:32. Save it?". The current app's rules, mirrored from
 * `components/activity/exercise-detected-card.tsx`, `lib/activity/ring-walks.ts` and the `answeredRingWalks`
 * memory in `lib/stores/auto-detection-store.ts`:
 *   - the server decides what a walk is (`/api/activity-detection/walks`, source-agnostic) and leaves
 *     out anything already logged;
 *   - an answered walk (saved or dismissed) is remembered by its start time for three days;
 *   - a walk overlapping one already on offer, or one recorded here, is the same walk.
 */
export const walkCandidatesSpec = (today: string) => ({
  path: '/api/activity-detection/walks',
  partition: today,
  ttl: 300_000,
  schema: z.object({
    date: z.string(),
    walks: z.array(
      z.object({
        startMs: z.number().finite(),
        endMs: z.number().finite(),
        durationMin: z.number().finite(),
      }),
    ),
  }),
});
export type DetectedWalk = z.infer<ReturnType<typeof walkCandidatesSpec>['schema']>['walks'][number];

/** How long an answered walk is remembered (`RING_WALK_MEMORY_MS`): the server offers today's only. */
export const ANSWERED_WALK_MEMORY_MS = 3 * 24 * 60 * 60 * 1000;

export type Span = { startMs: number; endMs: number };
/** The activity rows this phone holds, as clock spans: what a detection must not duplicate. */
export function recordedSpans(
  rows: readonly { payload: { date: string; startTime?: string; endTime?: string; durationMin?: number } }[],
  timezone: string,
): Span[] {
  return rows.flatMap(({ payload }) => {
    const date = payload.date.replace(/\//g, '-');
    const start = localClockTimeToDate(date, payload.startTime, timezone);
    if (!start) return [];
    const end =
      localClockTimeToDate(date, payload.endTime, timezone) ??
      (payload.durationMin != null ? new Date(start.getTime() + payload.durationMin * 60_000) : null);
    return end && end > start ? [{ startMs: start.getTime(), endMs: end.getTime() }] : [];
  });
}
const overlaps = (a: Span, b: Span) => a.startMs < b.endMs && a.endMs > b.startMs;

/**
 * The walks to put on the card, newest first. Answered walks, walks overlapping an activity this phone
 * holds (saved here and not yet confirmed by the server, or recording right now) and a repeat of the
 * same span are left out, so a cached answer from before a save can never re-offer it.
 */
export function visibleWalks(
  walks: readonly DetectedWalk[] | undefined,
  answered: readonly number[],
  recorded: readonly Span[],
): DetectedWalk[] {
  const kept: DetectedWalk[] = [];
  for (const walk of [...(walks ?? [])].sort((a, b) => b.startMs - a.startMs)) {
    if (
      walk.endMs > walk.startMs &&
      !answered.includes(walk.startMs) &&
      !recorded.some((span) => overlaps(span, walk)) &&
      !kept.some((other) => overlaps(other, walk))
    ) {
      kept.push(walk);
    }
  }
  return kept;
}

/** The answered list with `startMs` added and anything past the memory dropped. */
export function rememberAnswered(answered: readonly number[], startMs: number, now: number) {
  return [...answered.filter((t) => t > now - ANSWERED_WALK_MEMORY_MS && t !== startMs), startMs];
}

export type WalkChoice = { type: 'walk' | 'run'; start: string; end: string };
const hhmm = /^\d{1,2}:\d{2}$/;
/** An unedited detection as the sheet starts: its type and clock times in the person's timezone. */
export function initialChoice(walk: Span, timezone: string): WalkChoice {
  return {
    type: 'walk',
    start: msToHHMMInTz(walk.startMs, timezone),
    end: msToHHMMInTz(walk.endMs, timezone),
  };
}
/** The span an edited choice means, on the day the walk started; null while a time is not valid. */
export function choiceSpan(walk: Span, choice: WalkChoice, timezone: string): Span | null {
  if (!hhmm.test(choice.start.trim()) || !hhmm.test(choice.end.trim())) return null;
  const date = toAestDay(new Date(walk.startMs), timezone);
  const start = localClockTimeToDate(date, choice.start.trim(), timezone);
  const end = localClockTimeToDate(date, choice.end.trim(), timezone);
  return start && end && end > start ? { startMs: start.getTime(), endMs: end.getTime() } : null;
}
/**
 * The activity a confirmed detection saves, as `ExerciseReviewSheet.handleSave` writes it: filed under
 * the day it started in the person's timezone, titled "Walk at 9:10 am", with no distance (the server
 * measured none and a 0 would read as a measured one) and no heart rate or calories (the server
 * derives them on save).
 */
export function detectedActivityPayload(
  id: string,
  walk: Span,
  choice: WalkChoice,
  timezone: string,
): ActivityPayload | null {
  const span = choiceSpan(walk, choice, timezone);
  if (!span) return null;
  return activityPayload.parse({
    id,
    date: toAestDay(new Date(span.startMs), timezone),
    activityType: choice.type,
    title: `${choice.type === 'run' ? 'Run' : 'Walk'} at ${formatTimeOfDay(span.startMs, timezone)}`,
    durationMin: Math.round((span.endMs - span.startMs) / 6000) / 10,
    startTime: msToHHMMInTz(span.startMs, timezone),
    endTime: msToHHMMInTz(span.endMs, timezone),
  });
}

/** Confirm taps in flight, by detection: a second tap before the first lands saves nothing more. */
const confirming = new Set<number>();
export async function confirmDetectedWalk(
  deps: {
    saveRecord: (payload: unknown) => Promise<void>;
    answer: (startMs: number) => Promise<void>;
    uuid: () => string;
    timezone: string;
  },
  walk: DetectedWalk,
  choice: WalkChoice,
): Promise<boolean> {
  if (confirming.has(walk.startMs)) return false;
  const payload = detectedActivityPayload(deps.uuid(), walk, choice, deps.timezone);
  if (!payload) return false;
  confirming.add(walk.startMs);
  try {
    await deps.saveRecord(payload);
    // The saved row already hides the detection; remembering it as well covers the gap before the
    // server confirms the activity, as the current app does for a saved ring walk.
    await deps.answer(walk.startMs);
    return true;
  } finally {
    confirming.delete(walk.startMs);
  }
}
