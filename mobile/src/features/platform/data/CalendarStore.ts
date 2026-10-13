import { z } from 'zod';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import type { WorkoutRecord } from '../../workouts/logging/workout.ts';
import type { PlatformSettings } from './models.ts';
export type CalendarEvent = { title: string; notes: string; start: number; end: number };
export type CalendarService = {
  find: (calendarId: string, marker: string, event: CalendarEvent) => Promise<string | null>;
  create: (calendarId: string, event: CalendarEvent) => Promise<string>;
  update: (id: string, event: CalendarEvent) => Promise<void>;
  remove: (id: string) => Promise<void>;
};
const schema = z.object({
  events: z.record(z.string(), z.object({ id: z.string(), signature: z.string() })),
  removed: z.array(z.string()),
});
export function workoutCalendarEvent(workout: WorkoutRecord): CalendarEvent {
  if (
    workout.status !== 'completed' ||
    !workout.completedAt ||
    workout.completedAt < workout.startedAt
  )
    throw new Error('Finish the workout before adding it to a calendar.');
  return {
    title: `${workout.sessionName} · TrainingAi`,
    notes: [
      `TrainingAi workout ${workout.id}`,
      ...workout.exercises
        .filter((row) => !row.retired)
        .map(
          (exercise) =>
            `${exercise.name}: ${exercise.sets
              .filter((set) => set.completedAt !== null)
              .map((set) => `${set.weight} kg × ${set.reps}`)
              .join(', ')}`,
        ),
    ].join('\n'),
    start: workout.startedAt,
    end: Math.max(workout.startedAt + 60_000, workout.completedAt),
  };
}
export class CalendarStore {
  private state: {
    ready: boolean;
    events: Record<string, { id: string; signature: string }>;
    removed: string[];
    error: string | null;
    busy: boolean;
  } = { ready: false, events: {}, removed: [], error: null, busy: false };
  private listeners = new Set<() => void>();
  private initialization: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private autoRevision = 0;
  constructor(
    private storage: ScopedStorage,
    private service: CalendarService,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private publish(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  initialize() {
    return (this.initialization ??= (async () => {
      try {
        const raw = await this.storage.get('native-calendar.v1');
        if (raw) this.publish(schema.parse(JSON.parse(raw)));
        this.publish({ ready: true });
      } catch {
        this.publish({
          error: 'Could not open saved calendar links. Retry before adding events.',
        });
      }
    })());
  }
  private async persist() {
    await this.storage.set(
      'native-calendar.v1',
      JSON.stringify({ events: this.state.events, removed: this.state.removed }),
    );
  }
  private run(action: () => Promise<void>) {
    const generation = this.generation;
    const pending = this.queue.then(async () => {
      await this.initialize();
      if (generation !== this.generation) return;
      if (!this.state.ready) throw new Error(this.state.error!);
      this.publish({ busy: true, error: null });
      try {
        await action();
      } catch (cause) {
        this.publish({
          error:
            cause instanceof Error
              ? cause.message
              : 'Could not update the calendar. Your workout is saved.',
        });
        throw cause;
      } finally {
        this.publish({ busy: false });
      }
    });
    this.queue = pending.catch(() => {});
    return pending;
  }
  private async put(workout: WorkoutRecord, calendarId: string, force = false) {
    if (!force && this.state.removed.includes(workout.id)) return;
    const event = workoutCalendarEvent(workout),
      signature = JSON.stringify(event);
    const previous = this.state.events[workout.id];
    if (previous?.signature === signature) {
      await this.persist();
      return;
    }
    let id =
      previous?.id ??
      (await this.service.find(calendarId, `TrainingAi workout ${workout.id}`, event));
    if (id) await this.service.update(id, event);
    else id = await this.service.create(calendarId, event);
    this.publish({
      events: { ...this.state.events, [workout.id]: { id, signature } },
      removed: this.state.removed.filter((row) => row !== workout.id),
    });
    await this.persist();
  }
  add(workout: WorkoutRecord, calendarId: string) {
    return this.run(() => this.put(workout, calendarId, true));
  }
  remove(workoutId: string) {
    return this.run(async () => {
      const previous = this.state.events[workoutId];
      if (previous) await this.service.remove(previous.id);
      const events = { ...this.state.events };
      delete events[workoutId];
      this.publish({ events, removed: [...new Set([...this.state.removed, workoutId])] });
      await this.persist();
    });
  }
  sync(workouts: WorkoutRecord[], settings: PlatformSettings) {
    const revision = ++this.autoRevision;
    if (!settings.calendarAuto || !settings.calendarId) return Promise.resolve();
    return this.run(async () => {
      const generation = this.generation;
      for (const workout of workouts) {
        if (generation !== this.generation || revision !== this.autoRevision) return;
        if (workout.status === 'completed' && workout.completedAt! >= settings.calendarSince)
          await this.put(workout, settings.calendarId!);
      }
    });
  }
  cancel() {
    this.generation++;
  }
  async retry() {
    await this.initialize();
    if (!this.state.ready) {
      this.initialization = null;
      await this.initialize();
    } else {
      await this.run(() => this.persist());
    }
  }
}
