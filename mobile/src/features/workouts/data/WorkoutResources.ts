import type { ZodType } from 'zod';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import { RefreshPolicy } from '../../../core/sync/RefreshPolicy.ts';
import type { AccountConnection } from '../../account/session.ts';
import { ApiError, aiFailureText } from '../../account/api/client.ts';
import { overlayHistory, type HistoryOperation } from './HistoryOutbox.ts';
import { TrainingStore } from './TrainingStore.ts';
import { failureNotice, reportError } from '../../../core/reporting/index.ts';

export type ResourceSpec<T> = {
  path: string;
  query?: Record<string, string>;
  schema: ZodType<T>;
  ttl?: number;
  partition?: string;
  cache?: (data: T) => boolean;
};
export type ResourceState<T = unknown> = {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  saved: boolean;
  error: string | null;
};
const empty: ResourceState = {
  data: null,
  loading: true,
  refreshing: false,
  saved: false,
  error: null,
};
export const emptyResource = <T>(): ResourceState<T> => empty as ResourceState<T>;
type Entry = {
  spec: Omit<ResourceSpec<unknown>, 'cache'>;
  cache?: (data: unknown) => boolean;
  state: ResourceState;
  policy: RefreshPolicy;
  request: Promise<void> | null;
  hydrated: boolean;
  revision: number;
  localOnly: boolean;
  queued: boolean;
  queuedManual: boolean;
  denied: boolean;
};

export function resourceKey(spec: Pick<ResourceSpec<unknown>, 'path' | 'query' | 'partition'>) {
  return JSON.stringify([
    spec.path,
    Object.entries(spec.query ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ...(spec.partition === undefined ? [] : [spec.partition]),
  ]);
}

export class WorkoutResources {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private invalidationListeners = new Set<(paths: string[]) => void>();
  private generation = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private invalidationWrites: Promise<unknown> = Promise.resolve();
  private mediaRequests = new Map<string, Promise<string>>();
  readonly changes: TrainingStore;
  constructor(
    private storage: ScopedStorage,
    readonly connection: AccountConnection,
    private now = Date.now,
    uuid: () => string = () => globalThis.crypto.randomUUID(),
    onTrainingSynced = () => {},
  ) {
    this.changes = new TrainingStore(
      storage,
      connection,
      uuid,
      (confirmed, mutated) => {
        for (const entry of this.entries.values()) {
          const data = this.changes.data(entry.spec.path);
          if (data !== undefined && !entry.denied) {
            this.publish(entry, {
              ...entry.state,
              data: entry.spec.schema.parse(data),
              loading: false,
              saved: true,
              error:
                entry.state.error && entry.state.data === null
                  ? 'Could not refresh this view. Showing changes saved on this phone.'
                  : entry.state.error,
            });
          }
        }
        if (mutated) {
          this.invalidate([
            '/api/workout-templates',
            '/api/injuries',
            '/api/workout-data',
            '/api/ai-periodization',
            '/api/next-session',
            '/api/phase-sets',
          ]);
        }
        if (confirmed) {
          onTrainingSynced();
          void this.refreshVisible();
        }
      },
      now,
    );
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(entry: Entry, state: ResourceState) {
    entry.state = state;
    this.listeners.forEach((listener) => listener());
  }
  subscribeInvalidation = (listener: (paths: string[]) => void) => {
    this.invalidationListeners.add(listener);
    return () => {
      this.invalidationListeners.delete(listener);
    };
  };
  state<T>(spec: ResourceSpec<T>): ResourceState<T> {
    return (this.entries.get(resourceKey(spec))?.state ?? empty) as ResourceState<T>;
  }
  private entry<T>(spec: ResourceSpec<T>) {
    const key = resourceKey(spec);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        spec: {
          path: spec.path,
          query: spec.query,
          schema: spec.schema,
          ttl: spec.ttl,
          partition: spec.partition,
        },
        cache: spec.cache ? (data) => spec.cache!(spec.schema.parse(data)) : undefined,
        state: empty,
        policy: new RefreshPolicy(this.now, spec.ttl ?? 300_000),
        request: null,
        hydrated: false,
        revision: 0,
        localOnly: false,
        queued: false,
        queuedManual: false,
        denied: false,
      };
      this.entries.set(key, entry);
    }
    return entry;
  }
  load<T>(spec: ResourceSpec<T>, manual = false, localOnly = false): Promise<void> {
    const entry = this.entry(spec);
    if (entry.request) {
      if (!localOnly && entry.localOnly) {
        entry.queued = true;
        entry.queuedManual ||= manual;
      }
      return entry.request;
    }
    entry.localOnly = localOnly;
    if (!manual && entry.hydrated && !entry.policy.shouldRefresh()) {
      return Promise.resolve();
    }
    const generation = this.generation;
    const revision = entry.revision;
    entry.request = this.fetch(entry, generation, manual, localOnly).finally(() => {
      if (generation === this.generation) {
        entry.request = null;
        if (revision !== entry.revision || entry.queued) {
          const manual = entry.queuedManual;
          entry.queued = false;
          entry.queuedManual = false;
          return this.load(entry.spec, manual);
        }
      }
    });
    return entry.request;
  }
  private async fetch(entry: Entry, generation: number, manual: boolean, localOnly: boolean) {
    const key = `workout-resource.v1:${resourceKey(entry.spec)}`;
    const revision = entry.revision;
    try {
      await this.changes.initialize();
    } catch (failure) {
      if (generation === this.generation) {
        this.publish(entry, {
          ...entry.state,
          loading: false,
          refreshing: false,
          error: failureNotice(
            'Could not open saved training changes. Existing changes have been preserved.',
            failure,
          ),
        });
      }
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    const local = this.changes.data(entry.spec.path);
    if (local !== undefined && !entry.denied) {
      this.publish(entry, {
        ...entry.state,
        data: entry.spec.schema.parse(local),
        loading: false,
        saved: true,
      });
    }
    let cacheEpoch = -1;
    try {
      await this.invalidationWrites;
      cacheEpoch = Number(await this.storage.get('workout-resource-epoch.v1')) || 0;
    } catch (failure) {
      reportError(failure);
    }
    if (generation !== this.generation) {
      return;
    }
    if (!entry.hydrated) {
      try {
        const raw = await this.storage.get(key);
        if (generation !== this.generation) {
          return;
        }
        if (raw) {
          const saved = JSON.parse(raw);
          if (
            saved.origin === this.connection.origin &&
            saved.userId === this.connection.userId &&
            Number.isFinite(saved.savedAt)
          ) {
            const data = entry.spec.schema.parse(saved.data);
            await this.changes.seed(entry.spec.path, data);
            if (
              entry.revision === 0 &&
              cacheEpoch >= 0 &&
              (saved.cacheEpoch ?? 0) === cacheEpoch
            ) {
              entry.policy.succeeded(saved.savedAt);
            }
            this.publish(entry, {
              data: entry.spec.schema.parse(this.changes.data(entry.spec.path) ?? data),
              loading: false,
              refreshing: false,
              saved: true,
              error: null,
            });
          }
        }
      } catch (failure) {
        reportError(failure, { apiPath: entry.spec.path });
      }
      if (generation !== this.generation) {
        return;
      }
      entry.hydrated = true;
      if (!manual && !entry.policy.shouldRefresh()) {
        return;
      }
    }
    if (localOnly) {
      this.publish(entry, { ...entry.state, loading: false });
      return;
    }
    this.publish(entry, {
      ...entry.state,
      loading: entry.state.data === null,
      refreshing: manual,
      error: manual ? null : entry.state.error,
    });
    try {
      const trainingRevision = this.changes.revision(entry.spec.path);
      const data = entry.spec.schema.parse(
        await this.connection.get(entry.spec.path, entry.spec.query),
      );
      if (generation !== this.generation) {
        return;
      }
      if (revision !== entry.revision) {
        return;
      }
      let error: string | null = null;
      try {
        if (!entry.cache || entry.cache(data)) {
          await this.storage.set(
            key,
            JSON.stringify({
              origin: this.connection.origin,
              userId: this.connection.userId,
              savedAt: this.now(),
              cacheEpoch,
              data,
            }),
          );
        }
      } catch (failure) {
        error = failureNotice('Loaded, but could not save this view for offline use.', failure);
      }
      if (generation !== this.generation) {
        return;
      }
      if (revision === entry.revision) {
        entry.policy.succeeded();
      }
      await this.changes.mergeRemote(entry.spec.path, data, trainingRevision);
      if (generation !== this.generation || revision !== entry.revision) {
        return;
      }
      entry.denied = false;
      this.publish(entry, {
        data: entry.spec.schema.parse(this.changes.data(entry.spec.path) ?? data),
        loading: false,
        refreshing: false,
        saved: this.changes.pendingFor(entry.spec.path).length > 0,
        error,
      });
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      const denied =
        error instanceof ApiError && (error.status === 401 || error.status === 403);
      if (denied) {
        entry.denied = true;
      }
      entry.policy.failed();
      this.publish(entry, {
        ...entry.state,
        data: denied ? null : entry.state.data,
        loading: false,
        refreshing: false,
        saved: entry.state.data !== null,
        error: denied
          ? 'Check your account to access this view.'
          : aiFailureText(
              error,
              failureNotice(
                entry.state.data
                  ? 'Could not update this view. Showing saved data.'
                  : 'Could not load this view. Check your connection and retry.',
                error,
                { apiPath: entry.spec.path },
              ),
            ),
      });
    }
  }
  async replace<T>(spec: ResourceSpec<T>, value: T) {
    const generation = this.generation,
      entry = this.entry(spec),
      data = spec.schema.parse(value);
    entry.revision++;
    entry.hydrated = true;
    entry.policy.invalidate();
    this.publish(entry, { data, loading: false, refreshing: false, saved: true, error: null });
    if (entry.cache && !entry.cache(data)) {
      return;
    }
    await this.invalidationWrites;
    if (generation !== this.generation) {
      return;
    }
    const cacheEpoch = Number(await this.storage.get('workout-resource-epoch.v1')) || 0;
    if (generation !== this.generation) {
      return;
    }
    await this.storage.set(
      `workout-resource.v1:${resourceKey(spec)}`,
      JSON.stringify({
        origin: this.connection.origin,
        userId: this.connection.userId,
        savedAt: 0,
        cacheEpoch,
        data,
      }),
    );
  }
  async forget<T>(spec: ResourceSpec<T>) {
    const entry = this.entry(spec);
    entry.revision++;
    entry.hydrated = true;
    entry.policy.invalidate();
    this.publish(entry, {
      data: null,
      loading: false,
      refreshing: false,
      saved: false,
      error: null,
    });
    await this.storage.remove(`workout-resource.v1:${resourceKey(spec)}`);
  }
  invalidate(paths: string[]) {
    if (!paths.length) {
      return;
    }
    this.invalidationListeners.forEach((listener) => listener(paths));
    this.invalidationWrites = this.invalidationWrites
      .then(async () => {
        const epoch = Number(await this.storage.get('workout-resource-epoch.v1')) || 0;
        await this.storage.set('workout-resource-epoch.v1', String(epoch + 1));
      })
      .catch(() => undefined);
    for (const entry of this.entries.values()) {
      if (paths.some((path) => entry.spec.path.startsWith(path))) {
        entry.revision++;
        entry.policy.invalidate();
      }
    }
  }
  applyHistory(change: HistoryOperation) {
    const names = new Map<string, string[]>();
    for (const entry of this.entries.values()) {
      if (
        !entry.state.data ||
        (entry.spec.path !== '/api/day-log' &&
          !(change.domain === 'activity_logs' && entry.spec.path === '/api/activity-logs'))
      ) {
        continue;
      }
      if (change.domain === 'activity_logs') {
        const data = entry.state.data as { activityLogs?: { id: string }[] };
        this.publish(entry, {
          ...entry.state,
          data: entry.spec.schema.parse({
            ...data,
            activityLogs: (data.activityLogs ?? []).filter(
              (log) => log.id !== change.payload.id,
            ),
          }),
          saved: true,
        });
        continue;
      }
      const data = entry.state.data as {
        date: string;
        exercises: {
          exerciseLogId: string;
          workoutSessionId: string;
          setWeights: number[];
          reps: number[];
          sessionName: string;
        }[];
      };
      const exercises = overlayHistory(data.exercises, [change]);
      const updated = entry.spec.schema.parse({ ...data, exercises });
      this.publish(entry, { ...entry.state, data: updated, saved: true });
      names.set(data.date.replace(/\//g, '-'), [
        ...new Set(exercises.map((exercise) => exercise.sessionName)),
      ]);
    }
    for (const entry of this.entries.values()) {
      if (
        (entry.spec.path !== '/api/calendar-data' && entry.spec.path !== '/api/streak-data') ||
        !entry.state.data
      ) {
        continue;
      }
      const data = entry.state.data as { trainedDays: Record<string, string[]> };
      const trainedDays = { ...data.trainedDays };
      for (const [date, sessions] of names) {
        delete trainedDays[date];
        delete trainedDays[date.replace(/-/g, '/')];
        if (sessions.length) {
          trainedDays[date.replace(/-/g, '/')] = sessions;
        }
      }
      this.publish(entry, {
        ...entry.state,
        data: entry.spec.schema.parse({ ...data, trainedDays }),
        saved: true,
      });
    }
  }
  refreshVisible(manual = false) {
    return Promise.all(
      [...this.entries.values()]
        .filter((entry) => !entry.localOnly)
        .map((entry) => this.load(entry.spec, manual)),
    );
  }
  async draft<T>(key: string, schema: ZodType<T>): Promise<T | null> {
    const raw = await this.storage.get(`workout-draft.v1:${key}`);
    if (!raw) {
      return null;
    }
    return schema.parse(JSON.parse(raw));
  }
  saveDraft(key: string, value: unknown) {
    return this.storage.set(`workout-draft.v1:${key}`, JSON.stringify(value));
  }
  clearDraft(key: string) {
    return this.storage.remove(`workout-draft.v1:${key}`);
  }
  write(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    invalidate: string[] = [],
  ) {
    const generation = this.generation;
    const result = this.writes.then(async () => {
      if (generation !== this.generation) {
        throw new Error('The account changed.');
      }
      const operation =
        method === 'POST'
          ? this.connection.post
          : method === 'PUT'
            ? this.connection.put
            : method === 'PATCH'
              ? this.connection.patch
              : this.connection.delete;
      if (!operation) {
        throw new Error('This account connection does not support this action.');
      }
      const response = await operation(path, body);
      if (generation !== this.generation) {
        throw new Error('The account changed.');
      }
      this.invalidate(invalidate);
      await this.invalidationWrites;
      if (generation !== this.generation) {
        throw new Error('The account changed.');
      }
      return response;
    });
    this.writes = result.catch(() => undefined);
    return result;
  }
  media(source: string): Promise<string> {
    const existing = this.mediaRequests.get(source);
    if (existing) {
      return existing;
    }
    const request = this.readMedia(source).finally(() => this.mediaRequests.delete(source));
    this.mediaRequests.set(source, request);
    return request;
  }
  private async readMedia(source: string): Promise<string> {
    const generation = this.generation;
    const key = `exercise-media.v1:${source}`;
    let cached: string | null = null;
    try {
      cached = await this.storage.get(key);
    } catch (failure) {
      reportError(failure);
    }
    if (generation !== this.generation) {
      throw new Error('The account changed.');
    }
    if (cached && /^data:image\/(gif|png|jpeg|webp);base64,/.test(cached)) {
      return cached;
    }
    if (!this.connection.media) {
      throw new Error('Exercise media is unavailable.');
    }
    const data = await this.connection.media(source);
    if (generation !== this.generation) {
      throw new Error('The account changed.');
    }
    try {
      await this.storage.set(key, data);
    } catch (failure) {
      reportError(failure);
    }
    return data;
  }
  cancel() {
    this.invalidationListeners.clear();
    this.generation++;
    this.entries.clear();
    this.mediaRequests.clear();
    this.changes.cancel();
    this.listeners.forEach((listener) => listener());
  }
}
