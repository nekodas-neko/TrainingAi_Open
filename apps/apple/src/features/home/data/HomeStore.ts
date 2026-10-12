import { z } from 'zod';
import { MoodFieldsSchema, type MoodFields } from '@trainingai/shared/validation/mood-log';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import { RefreshPolicy } from '../../../core/sync/RefreshPolicy.ts';
import type { AccountConnection } from '../../account/session.ts';
import { ApiError } from '../../account/api/client.ts';
import { isCalendarDate } from '@trainingai/shared/date-utils';
import { moodSchema, preferencesSchema, type HomePreferences, type Mood } from './models.ts';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate);
const operationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mood'),
    id: z.uuid(),
    date: dateSchema,
    payload: MoodFieldsSchema,
  }),
  z.object({ kind: z.literal('preferences'), id: z.uuid(), payload: preferencesSchema }),
  z.object({ kind: z.literal('rest'), id: z.uuid(), date: dateSchema, resting: z.boolean() }),
  z.object({ kind: z.literal('goal-review'), id: z.uuid() }),
]);
const diskSchema = z.object({
  version: z.literal(1),
  origin: z.string(),
  userId: z.string(),
  moods: z.record(z.string(), moodSchema.nullable()),
  preferences: preferencesSchema,
  operations: z.array(operationSchema),
  savedAt: z.record(z.string(), z.number()),
  restDays: z.record(z.string(), z.boolean()).default({}),
  markers: z.record(z.string(), z.boolean()).default({}),
});
type Operation = z.infer<typeof operationSchema>;
export type HomeState = {
  ready: boolean;
  denied: boolean;
  moods: Record<string, Mood | null>;
  preferences: HomePreferences;
  operations: Operation[];
  savedAt: Record<string, number>;
  loading: string[];
  errors: Record<string, string>;
  syncing: boolean;
  error: string | null;
  restDays: Record<string, boolean>;
  markers: Record<string, boolean>;
};
export const emptyHome: HomeState = {
  ready: false,
  denied: false,
  moods: {},
  preferences: {},
  operations: [],
  savedAt: {},
  loading: [],
  errors: {},
  syncing: false,
  error: null,
  restDays: {},
  markers: {},
};
function sameFields(actual: Record<string, unknown>, expected: Record<string, unknown>) {
  return Object.entries(expected).every(
    ([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value),
  );
}
export class HomeStore {
  private current = emptyHome;
  private listeners = new Set<() => void>();
  private initializing: Promise<void> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private flushing: Promise<void> | null = null;
  private requests = new Map<string, Promise<void>>();
  private policies = new Map<string, RefreshPolicy>();
  private generation = 0;
  private revision = 0;
  private denialRevision = 0;
  constructor(
    private storage: ScopedStorage,
    readonly connection: AccountConnection,
    private uuid: () => string,
    private changed = () => {},
    private now = Date.now,
  ) {}
  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  cancel() {
    this.generation++;
  }
  private publish(patch: Partial<HomeState>) {
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  initialize() {
    if (!this.initializing) {
      const generation = this.generation;
      this.initializing = (async () => {
        try {
          const raw = await this.storage.get('home.v1');
          const saved = raw ? diskSchema.parse(JSON.parse(raw)) : null;
          if (
            saved &&
            (saved.origin !== this.connection.origin || saved.userId !== this.connection.userId)
          ) {
            throw new Error('Wrong account cache.');
          }
          if (generation === this.generation) {
            this.publish({ ...(saved ?? {}), ready: true });
          }
        } catch {
          if (generation === this.generation) {
            this.publish({
              error: 'Could not open your saved Home data. Close and reopen the app to retry.',
            });
          }
        }
      })();
    }
    return this.initializing;
  }
  private write(update: (state: HomeState) => Partial<HomeState>) {
    const generation = this.generation;
    const work = this.writes.then(async () => {
      if (generation !== this.generation || !this.current.ready) {
        return;
      }
      const patch = update(this.current);
      const next = { ...this.current, ...patch };
      await this.storage.set(
        'home.v1',
        JSON.stringify(
          diskSchema.parse({
            ...next,
            version: 1,
            origin: this.connection.origin,
            userId: this.connection.userId,
          }),
        ),
      );
      if (generation === this.generation) {
        this.publish(patch);
      }
    });
    this.writes = work.catch(() => {});
    return work;
  }
  private guard() {
    if (!this.current.ready || this.current.denied) {
      throw new Error('Check your account before saving.');
    }
  }
  async saveMood(date: string, fields: MoodFields) {
    this.guard();
    const payload = MoodFieldsSchema.parse(fields);
    const op = operationSchema.parse({ kind: 'mood', date, id: this.uuid(), payload });
    const mood = moodSchema.parse({
      ...payload,
      id: op.id,
      userId: this.connection.userId,
      logDate: date,
    });
    await this.write((state) => ({
      moods: { ...state.moods, [date]: mood },
      operations: [...state.operations, op],
      error: null,
    }));
    this.revision++;
    this.changed();
    void this.sync();
  }
  async savePreferences(patch: HomePreferences) {
    this.guard();
    const payload = preferencesSchema.parse(patch);
    const op = operationSchema.parse({ kind: 'preferences', id: this.uuid(), payload });
    await this.write((state) => ({
      preferences: { ...state.preferences, ...payload },
      operations: [...state.operations, op],
      error: null,
    }));
    this.revision++;
    void this.sync();
  }
  async chooseRestDay(date: string, resting: boolean) {
    this.guard();
    const op = operationSchema.parse({ kind: 'rest', id: this.uuid(), date, resting });
    await this.write((state) => ({
      restDays: { ...state.restDays, [date]: resting },
      operations: [...state.operations, op],
      error: null,
    }));
    this.revision++;
    this.changed();
    void this.sync();
  }
  async mark(key: string) {
    this.guard();
    await this.write((state) => ({ markers: { ...state.markers, [key]: true } }));
  }
  async postponeGoals(date: string) {
    this.guard();
    const op = operationSchema.parse({ kind: 'goal-review', id: this.uuid() });
    await this.write((state) => ({
      markers: { ...state.markers, [`goals:${date}`]: true },
      operations: [...state.operations, op],
    }));
    void this.sync();
  }
  refresh(kind: 'preferences' | 'mood', date: string, manual = false): Promise<void> {
    const key = kind === 'preferences' ? kind : `${kind}:${date}`;
    const active = this.requests.get(key);
    if (active) {
      return manual ? active.then(() => this.refresh(kind, date, true)) : active;
    }
    const generation = this.generation;
    const work = (async () => {
      await this.initialize();
      if (!this.current.ready || generation !== this.generation) {
        return;
      }
      let policy = this.policies.get(key);
      if (!policy) {
        policy = new RefreshPolicy(this.now, 300_000);
        if (this.current.savedAt[key]) {
          policy.succeeded(this.current.savedAt[key]);
        }
        this.policies.set(key, policy);
      }
      if (!manual && !policy.shouldRefresh()) {
        return;
      }
      const revision = this.revision;
      const denialRevision = this.denialRevision;
      this.publish({ loading: [...this.current.loading, key] });
      try {
        const response =
          kind === 'mood'
            ? moodSchema.nullable().parse(await this.connection.get('/api/mood', { date }))
            : preferencesSchema.parse(await this.connection.get('/api/user/preferences'));
        if (
          kind === 'mood' &&
          response &&
          ((response as Mood).userId !== this.connection.userId ||
            (response as Mood).logDate.replace(/\//g, '-') !== date)
        ) {
          throw new Error('Wrong account or day response.');
        }
        if (generation !== this.generation || revision !== this.revision) {
          return;
        }
        await this.write((state) => ({
          ...(kind === 'mood'
            ? {
                moods: {
                  ...state.moods,
                  [date]: state.operations.some((op) => op.kind === 'mood' && op.date === date)
                    ? state.moods[date]
                    : (response as Mood | null),
                },
              }
            : {
                preferences: Object.assign(
                  {},
                  response,
                  ...state.operations
                    .filter((op) => op.kind === 'preferences')
                    .map((op) => op.payload),
                ),
              }),
          savedAt: { ...state.savedAt, [key]: this.now() },
          errors: Object.fromEntries(Object.entries(state.errors).filter(([k]) => k !== key)),
          denied: denialRevision !== this.denialRevision || (this.current.denied && !manual),
        }));
        policy.succeeded();
      } catch (cause) {
        if (generation === this.generation) {
          policy.failed();
          const denied = cause instanceof ApiError && [401, 403].includes(cause.status);
          if (denied) {
            this.denialRevision++;
          }
          this.publish({
            denied: this.current.denied || denied,
            errors: {
              ...this.current.errors,
              [key]: `Could not refresh ${kind === 'mood' ? 'exercise readiness' : 'Home preferences'}. Saved data has been kept.`,
            },
          });
        }
      } finally {
        if (generation === this.generation) {
          this.publish({ loading: this.current.loading.filter((k) => k !== key) });
        }
      }
    })();
    this.requests.set(key, work);
    void work.finally(() => this.requests.delete(key));
    return work;
  }
  sync(): Promise<void> {
    if (this.flushing) {
      return this.flushing;
    }
    const generation = this.generation;
    this.flushing = (async () => {
      await this.initialize();
      if (!this.current.ready || this.current.denied || generation !== this.generation) {
        return;
      }
      this.publish({ syncing: true });
      try {
        while (this.current.operations.length && generation === this.generation) {
          const op = this.current.operations[0];
          if (op.kind === 'mood') {
            const result = z
              .object({ processed: z.number(), errors: z.array(z.unknown()).optional() })
              .parse(
                await this.connection.post('/api/sync/push', {
                  mutations: [
                    {
                      id: op.id,
                      domain: 'mood_logs',
                      date: op.date,
                      payload: op.payload,
                    },
                  ],
                }),
              );
            if (result.processed !== 1 || result.errors?.length) {
              throw new Error('Upload not accepted.');
            }
            const row = moodSchema
              .nullable()
              .parse(await this.connection.get('/api/mood', { date: op.date }));
            if (
              !row ||
              row.userId !== this.connection.userId ||
              row.logDate !== op.date ||
              !sameFields(
                row,
                Object.fromEntries(
                  Object.entries(op.payload).filter(([key]) => key !== 'suggestedSoreMuscles'),
                ),
              )
            ) {
              throw new Error('Readback not confirmed.');
            }
          } else if (op.kind === 'rest') {
            await this.connection.post('/api/log-rest-day', {
              date: op.date,
              resting: op.resting,
            });
            const result = z
              .object({ dates: z.array(z.string()) })
              .parse(
                await this.connection.get('/api/log-rest-day', { from: op.date, to: op.date }),
              );
            if (result.dates.includes(op.date) !== op.resting) {
              throw new Error('Readback not confirmed.');
            }
          } else if (op.kind === 'goal-review') {
            await this.connection.post('/api/nutrition-goals/touch-review', {});
          } else {
            if (!this.connection.patch) {
              throw new Error('Preference writes unavailable.');
            }
            const response = preferencesSchema.parse(
              await this.connection.patch('/api/user/preferences', op.payload),
            );
            if (!sameFields(response, op.payload)) {
              throw new Error('Readback not confirmed.');
            }
            await this.write((state) => ({
              preferences: Object.assign(
                {},
                response,
                ...state.operations.flatMap((x) =>
                  x.kind === 'preferences' && x.id !== op.id ? [x.payload] : [],
                ),
              ),
            }));
          }
          if (generation !== this.generation) {
            return;
          }
          await this.write((state) => ({
            operations: state.operations.filter((x) => x.id !== op.id),
            error: null,
          }));
          this.changed();
        }
        this.publish({ error: null });
      } catch (cause) {
        if (generation === this.generation) {
          const denied = cause instanceof ApiError && [401, 403].includes(cause.status);
          if (denied) {
            this.denialRevision++;
          }
          this.publish({
            denied: this.current.denied || denied,
            error: 'Saved on this phone. Could not sync your changes yet.',
          });
        }
      }
    })().finally(() => {
      if (generation === this.generation) {
        this.flushing = null;
        this.publish({ syncing: false });
      }
    });
    return this.flushing;
  }
}
