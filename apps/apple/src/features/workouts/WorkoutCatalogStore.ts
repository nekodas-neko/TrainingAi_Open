import { ApiError } from '../account/api/client.ts';
import type { AccountReader } from '../account/session.ts';
import type { ScopedStorage } from '../../core/storage/LocalStorage.ts';
import { RefreshPolicy } from '../../core/sync/RefreshPolicy.ts';
import {
  applyMuscleLibrary,
  buildCatalog,
  readExerciseMuscles,
  readRecovery,
  readSavedCatalog,
  type WorkoutCatalog,
} from './catalog.ts';

export type CatalogState = {
  cacheReady: boolean;
  status: 'loading' | 'ready' | 'error' | 'unauthorized';
  catalog: WorkoutCatalog | null;
  refreshing: boolean;
  refreshingManually: boolean;
  source: 'saved' | 'server' | null;
  notice: string | null;
};
const key = 'workout-catalog.v1';

export class WorkoutCatalogStore {
  private storage: ScopedStorage;
  private reader: AccountReader;
  private current: CatalogState = {
    cacheReady: false,
    status: 'loading',
    catalog: null,
    refreshing: false,
    refreshingManually: false,
    source: null,
    notice: null,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private hydrated = false;
  private loading: Promise<void> | null = null;
  private refreshing: Promise<void> | null = null;
  private freshness: RefreshPolicy;
  private revision = 0;

  constructor(
    storage: ScopedStorage,
    reader: AccountReader,
    private now = Date.now,
  ) {
    this.storage = storage;
    this.reader = reader;
    this.freshness = new RefreshPolicy(now);
  }
  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  cancel() {
    this.generation++;
    this.loading = null;
    this.refreshing = null;
    this.hydrated = false;
    this.freshness.invalidate();
  }
  private publish(state: CatalogState) {
    this.current = state;
    this.listeners.forEach((listener) => listener());
  }

  initialize = (manual = false): Promise<void> => {
    if (this.loading) {
      return this.loading;
    }
    const generation = this.generation;
    this.loading = this.load(generation, manual).finally(() => {
      if (generation === this.generation) {
        this.loading = null;
      }
    });
    return this.loading;
  };
  private async load(generation: number, manual: boolean) {
    let catalog: WorkoutCatalog | null = null;
    let notice: string | null = null;
    try {
      catalog = readSavedCatalog(await this.storage.get(key), this.reader);
    } catch {
      notice = 'Could not read the saved program. Trying the backend.';
    }
    if (generation !== this.generation) {
      return;
    }
    this.hydrated = true;
    if (catalog && this.revision === 0) {
      this.freshness.succeeded(catalog.savedAt);
    }
    this.publish({
      cacheReady: true,
      status: catalog ? 'ready' : 'loading',
      catalog,
      refreshing: false,
      refreshingManually: false,
      source: catalog ? 'saved' : null,
      notice,
    });
    await (manual ? this.refresh() : this.refreshIfStale());
  }
  refresh = () => this.requestRefresh(true);
  refreshIfStale = (): Promise<void> => {
    if (this.hydrated && !this.refreshing && !this.freshness.shouldRefresh()) {
      return Promise.resolve();
    }
    return this.requestRefresh(false);
  };
  invalidate = (): Promise<void> => {
    this.revision++;
    this.freshness.invalidate();
    return this.requestRefresh(false);
  };
  private requestRefresh(manual: boolean): Promise<void> {
    if (!this.hydrated) {
      return this.initialize(manual);
    }
    if (this.refreshing) {
      if (manual && !this.current.refreshingManually) {
        this.publish({ ...this.current, refreshingManually: true });
      }
      return this.refreshing;
    }
    const generation = this.generation;
    const revision = this.revision;
    this.publish({
      ...this.current,
      refreshing: true,
      refreshingManually: manual,
      notice: manual ? null : this.current.notice,
    });
    this.refreshing = this.fetch(generation, revision).finally(() => {
      if (generation === this.generation) {
        this.refreshing = null;
        if (revision !== this.revision) {
          return this.refreshIfStale();
        }
      }
    });
    return this.refreshing;
  }
  private async fetch(generation: number, revision: number) {
    try {
      const [meta, next] = await Promise.all([
        this.reader.get('/api/workout-data', { tab: 'meta' }),
        this.reader.get('/api/next-session'),
      ]);
      if (generation !== this.generation) {
        return;
      }
      const hasProgram =
        typeof meta === 'object' && meta !== null && 'program' in meta && !!meta.program;
      const all = hasProgram ? await this.reader.get('/api/workout-data', { tab: 'all' }) : null;
      if (generation !== this.generation) {
        return;
      }
      let catalog = buildCatalog(meta, next, all, this.reader, this.now());
      if (!this.current.catalog) {
        this.publish({ ...this.current, status: 'ready', catalog, source: 'server', notice: null });
        catalog = {
          ...catalog,
          program: catalog.program
            ? {
                ...catalog.program,
                sessions: catalog.program.sessions.map((session) => ({ ...session })),
              }
            : null,
        };
      }
      if (hasProgram) {
        const [library, recovery] = await Promise.allSettled([
          this.reader.get('/api/exercise-library').then(readExerciseMuscles),
          this.reader.get('/api/muscle-recovery').then(readRecovery),
        ]);
        if (library.status === 'fulfilled') {
          applyMuscleLibrary(catalog, library.value);
        }
        catalog.recovery = recovery.status === 'fulfilled' ? recovery.value : null;
      }
      if (generation !== this.generation) {
        return;
      }
      let notice: string | null = null;
      try {
        await this.storage.set(key, JSON.stringify(catalog));
      } catch {
        notice = 'Your program loaded, but could not be saved for offline use. Retry to save it.';
      }
      if (generation !== this.generation) {
        return;
      }
      if (revision === this.revision) {
        this.freshness.succeeded(catalog.savedAt);
      }
      this.publish({
        cacheReady: true,
        status: 'ready',
        catalog,
        refreshing: false,
        refreshingManually: false,
        source: 'server',
        notice,
      });
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      const unauthorized =
        error instanceof ApiError && (error.status === 401 || error.status === 403);
      const catalog = unauthorized ? null : this.current.catalog;
      if (revision === this.revision) {
        this.freshness.failed();
      }
      this.publish({
        cacheReady: true,
        status: unauthorized ? 'unauthorized' : catalog ? 'ready' : 'error',
        catalog,
        refreshing: false,
        refreshingManually: false,
        source: catalog ? 'saved' : null,
        notice: unauthorized
          ? 'Your account could not access the program. Check your sign-in in Settings.'
          : catalog
            ? 'Could not update your program. Showing the saved version; retry when connected.'
            : 'Could not load your program. Check your connection and retry.',
      });
    }
  }
}
