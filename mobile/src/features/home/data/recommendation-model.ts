import { formatDateDisplay } from '@trainingai/shared/date-utils';
import type { SessionPreview, WorkoutCatalog } from '../../workouts/catalog.ts';

// Which state Home's recommendation card is in and what it says. The card and the home-screen
// widget snapshot both read this, so they never pick a different session or word it differently.

export type RecommendationInput = {
  catalog: Pick<WorkoutCatalog, 'program' | 'recommendation'> | null | undefined;
  catalogLoading: boolean;
  /** Session names trained today (trainingDays()[today]). */
  trained: readonly string[];
  /** The journal's active workout, if one is open. */
  active: { id: string; sessionName: string } | undefined;
  /** The user's own rest-day choice for today, which wins over the recommendation. */
  restChoice: boolean | undefined;
  /** Undefined while today's mood is still loading, null when none is logged. */
  mood: object | null | undefined;
  moodFailed: boolean;
  today: string;
};

export type RecommendationModel =
  | { kind: 'loading' }
  | { kind: 'checkin'; session: SessionPreview | undefined }
  | { kind: 'rest'; reason: string }
  | { kind: 'none' }
  | {
      kind: 'session';
      session: SessionPreview;
      state: 'active' | 'done' | 'recommended';
      eyebrow: string;
      name: string;
      /** "~55 min", "6 exercises" and "Last: 18 Oct", in the card's order; length only when known. */
      meta: string[];
      action: 'resume' | 'completed' | 'deload' | 'start';
      activeId: string | null;
    };

export function homeRecommendationModel(input: RecommendationInput): RecommendationModel {
  const { catalog, trained, active, today } = input;
  const sessions = catalog?.program?.sessions ?? [];
  const done = sessions.find((session) => trained.includes(session.name));
  const rec = catalog?.recommendation;
  const session = done ?? sessions.find((value) => value.id === rec?.sessionId);
  const resting = input.restChoice ?? rec?.isRestDay ?? false;
  if ((input.mood === undefined && !input.moodFailed) || (!catalog && input.catalogLoading)) {
    return { kind: 'loading' };
  }
  if (!input.mood) return { kind: 'checkin', session };
  if (resting && !done && !active) return { kind: 'rest', reason: rec?.reason ?? 'A day to recover.' };
  if (!session) return { kind: 'none' };
  const last = session.lastTrained
    ? session.lastTrained === today
      ? 'Today'
      : formatDateDisplay(session.lastTrained, 'short')
    : '—';
  return {
    kind: 'session',
    session,
    state: active ? 'active' : done ? 'done' : 'recommended',
    eyebrow: active ? 'Workout in progress' : done ? 'Trained Today' : 'Recommended Today',
    name: active?.sessionName ?? session.name,
    meta: [
      ...(session.durationMinutes !== null ? [`~${Math.round(session.durationMinutes)} min`] : []),
      `${session.exercises.length} exercises`,
      `Last: ${last}`,
    ],
    action: active ? 'resume' : done ? 'completed' : rec?.deloadOrRestRecommended ? 'deload' : 'start',
    activeId: active?.id ?? null,
  };
}
