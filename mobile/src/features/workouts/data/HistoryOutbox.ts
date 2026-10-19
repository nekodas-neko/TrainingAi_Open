import { z } from 'zod';
import { MutationSchema } from '@trainingai/shared/sync/mutation-schema';
import { EditedAtSchema, withEditedAt } from '@trainingai/shared/sync/edited-at';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import type { AccountConnection } from '../../account/session.ts';
import { failureNotice } from '../../../core/reporting/index.ts';

const operation = MutationSchema.extend({
  id: z.uuid(),
  domain: z.enum([
    'exercise_log_edit',
    'exercise_log_delete',
    'workout_session_delete',
    'activity_logs',
  ]),
}).superRefine((change, context) => {
  const schema =
    change.domain === 'activity_logs'
      ? z.object({ id: z.uuid(), deleted: z.literal(true) }).strict()
      : change.domain === 'exercise_log_edit'
        ? z
            .object({
              exerciseLogId: z.uuid(),
              weights: z.array(z.number().min(-100).max(500)).min(1).max(20),
              reps: z.array(z.number().int().min(0).max(100)).min(1).max(20),
              editedAt: EditedAtSchema.optional(),
            })
            .strict()
        : change.domain === 'exercise_log_delete'
          ? z.object({ exerciseLogId: z.uuid(), editedAt: EditedAtSchema.optional() }).strict()
          : z.object({ workoutSessionId: z.uuid() }).strict();
  if (!schema.safeParse(change.payload).success) {
    context.addIssue({ code: 'custom', message: 'Invalid history change.', path: ['payload'] });
  }
});
const saved = z.object({
  version: z.literal(1),
  origin: z.string(),
  userId: z.string(),
  operations: z.array(operation),
});
export type HistoryOperation = z.infer<typeof operation>;
export type HistoryQueueState = {
  ready: boolean;
  operations: HistoryOperation[];
  syncing: boolean;
  error: string | null;
};
const key = 'workout-history-outbox.v1';
export class HistoryOutbox {
  private current: HistoryQueueState = {
    ready: false,
    operations: [],
    syncing: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private flushing: Promise<void> | null = null;
  constructor(
    private storage: ScopedStorage,
    private connection: AccountConnection,
    private uuid: () => string,
    private invalidate: (change?: HistoryOperation) => void,
    private now: () => number = Date.now,
    // Runs once the server confirms a change and before it leaves the queue, while the change
    // still overlays every view of its day.
    private confirmed: (change: HistoryOperation) => Promise<void> = async () => {},
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.current;
  private publish(patch: Partial<HistoryQueueState>) {
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  async initialize() {
    const generation = this.generation;
    try {
      const raw = await this.storage.get(key);
      const data = raw ? saved.parse(JSON.parse(raw)) : null;
      if (
        data &&
        (data.origin !== this.connection.origin || data.userId !== this.connection.userId)
      ) {
        throw new Error('Wrong account.');
      }
      if (generation !== this.generation) {
        return;
      }
      this.publish({ ready: true, operations: data?.operations ?? [], error: null });
      void this.sync();
    } catch (failure) {
      if (generation === this.generation) {
        this.publish({
          ready: false,
          error: failureNotice(
            'Could not open saved history changes. Existing changes have been preserved.',
            failure,
          ),
        });
      }
    }
  }
  private write(change: (operations: HistoryOperation[]) => HistoryOperation[]) {
    const generation = this.generation;
    const result = this.writes.then(async () => {
      if (generation !== this.generation) {
        throw new Error('Account changed.');
      }
      const operations = change(this.current.operations);
      await this.storage.set(
        key,
        JSON.stringify({
          version: 1,
          origin: this.connection.origin,
          userId: this.connection.userId,
          operations,
        }),
      );
      if (generation === this.generation) {
        this.publish({ operations, error: null });
      }
    });
    this.writes = result.catch(() => undefined);
    return result;
  }
  async enqueue(
    domain: HistoryOperation['domain'],
    date: string,
    payload: Record<string, unknown>,
  ) {
    if (!this.current.ready) {
      throw new Error('Open saved history changes before editing.');
    }
    // Edit time lets the server keep a newer copy over this one (issue 2721). A phone clock outside
    // the stamp's range sends no stamp: the edit still goes up, applied as an unstamped push.
    const now = this.now();
    const change = operation.parse({
      id: this.uuid(),
      domain,
      date,
      payload: EditedAtSchema.safeParse(now).success ? withEditedAt(domain, payload, now) : payload,
    });
    await this.write((operations) => [...operations, change]);
    this.invalidate(change);
    void this.sync();
  }
  sync() {
    if (this.flushing) {
      return this.flushing;
    }
    if (!this.current.ready) {
      return Promise.resolve();
    }
    const generation = this.generation;
    this.publish({ syncing: true });
    this.flushing = this.flush(generation).finally(() => {
      if (generation === this.generation) {
        this.flushing = null;
        this.publish({ syncing: false });
      }
    });
    return this.flushing;
  }
  private async flush(generation: number) {
    try {
      await this.writes;
      while (generation === this.generation && this.current.operations.length) {
        const change = this.current.operations[0];
        const result = (await this.connection.post('/api/sync/push', {
          mutations: [change],
        })) as {
          processed?: number;
          errors?: unknown[];
        };
        if (result.processed !== 1 || !Array.isArray(result.errors) || result.errors.length) {
          throw new Error('Not confirmed.');
        }
        if (generation !== this.generation) {
          return;
        }
        if (change.domain === 'activity_logs') {
          const day = z
            .object({ date: z.string(), activityLogs: z.array(z.object({ id: z.string() })) })
            .parse(await this.connection.get('/api/day-log', { date: change.date }));
          if (generation !== this.generation) {
            return;
          }
          if (
            day.date.replace(/\//g, '-') !== change.date.replace(/\//g, '-') ||
            day.activityLogs.some((log) => log.id === change.payload.id)
          ) {
            throw new Error('Activity deletion readback not confirmed.');
          }
          this.invalidate(change);
        }
        await this.confirmed(change);
        if (generation !== this.generation) {
          return;
        }
        await this.write((operations) =>
          operations.filter((operation) => operation.id !== change.id),
        );
        this.invalidate();
      }
    } catch (failure) {
      if (generation === this.generation) {
        this.publish({
          error: failureNotice(
            'Saved on this phone. History changes will upload when connected; retry if needed.',
            failure,
          ),
        });
      }
    }
  }
  cancel() {
    this.generation++;
  }
}
export function overlayHistory<
  T extends {
    exerciseLogId: string;
    workoutSessionId: string;
    setWeights: number[];
    reps: number[];
  },
>(entries: T[], operations: HistoryOperation[]): T[] {
  return entries.flatMap((entry) => {
    let value = entry;
    for (const operation of operations) {
      if (
        operation.domain === 'workout_session_delete' &&
        operation.payload.workoutSessionId === entry.workoutSessionId
      ) {
        return [];
      }
      if (operation.payload.exerciseLogId !== entry.exerciseLogId) {
        continue;
      }
      if (operation.domain === 'exercise_log_delete') {
        return [];
      }
      if (operation.domain === 'exercise_log_edit') {
        value = {
          ...value,
          setWeights: operation.payload.weights as number[],
          reps: operation.payload.reps as number[],
        };
      }
    }
    return [value];
  });
}
