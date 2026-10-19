import { z } from 'zod';
import type { ScopedStorage } from '../storage/LocalStorage.ts';

// One kind of history, downloaded one key (a date, a month or a view name) at a time. `keys` is
// ordered newest first, so an interrupted download has already saved the most useful days.
// `fetch` saves that key's records to the phone and throws if it could not.
export type HistoryDomain = {
  id: string;
  label: string;
  keys: string[];
  fetch(key: string): Promise<void>;
};
// The anchor day is fixed when a download starts, so a resume after midnight walks the same keys.
export type HistoryPlan = { anchor: string; days: number };
export type HistoryDownloadStatus = 'idle' | 'running' | 'paused' | 'failed' | 'complete';
export type HistoryDownloadState = {
  ready: boolean;
  status: HistoryDownloadStatus;
  plan: HistoryPlan | null;
  domains: { id: string; label: string; done: number; total: number }[];
  done: number;
  total: number;
  error: string | null;
};
const empty: HistoryDownloadState = {
  ready: false,
  status: 'idle',
  plan: null,
  domains: [],
  done: 0,
  total: 0,
  error: null,
};
// `cursors[id]` is the last key of that domain saved to the phone. Every save is keyed, so
// re-reading a key after a kill overwrites it rather than adding a second copy.
const saved = z.object({
  version: z.literal(1),
  origin: z.string(),
  userId: z.string(),
  status: z.enum(['running', 'paused', 'failed', 'complete']),
  plan: z.object({ anchor: z.string(), days: z.number().int().positive() }),
  cursors: z.record(z.string(), z.string().nullable()),
});
const key = 'history-download.v1';

export class HistoryDownload {
  private current = empty;
  private listeners = new Set<() => void>();
  private generation = 0;
  private domains: HistoryDomain[] = [];
  private cursors: Record<string, string | null> = {};
  private running: Promise<void> | null = null;
  private initializing: Promise<void> | null = null;
  constructor(
    private storage: ScopedStorage,
    private account: { origin: string; userId: string },
    private plan: (plan: HistoryPlan) => HistoryDomain[],
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.current;
  private publish(patch: Partial<HistoryDownloadState>) {
    const next = { ...this.current, ...patch };
    const domains = this.domains.map((domain) => ({
      id: domain.id,
      label: domain.label,
      done: this.position(domain),
      total: domain.keys.length,
    }));
    this.current = {
      ...next,
      domains,
      done: domains.reduce((sum, domain) => sum + domain.done, 0),
      total: domains.reduce((sum, domain) => sum + domain.total, 0),
    };
    this.listeners.forEach((listener) => listener());
  }
  private position(domain: HistoryDomain) {
    const cursor = this.cursors[domain.id];
    return cursor == null ? 0 : domain.keys.indexOf(cursor) + 1;
  }
  initialize() {
    if (!this.initializing) {
      const generation = this.generation;
      this.initializing = (async () => {
        try {
          const raw = await this.storage.get(key);
          const data = raw ? saved.parse(JSON.parse(raw)) : null;
          if (
            data &&
            (data.origin !== this.account.origin || data.userId !== this.account.userId)
          ) {
            throw new Error('Wrong account.');
          }
          if (generation !== this.generation) {
            return;
          }
          this.domains = data ? this.plan(data.plan) : [];
          this.cursors = data?.cursors ?? {};
          this.publish({
            ready: true,
            status: data?.status ?? 'idle',
            plan: data?.plan ?? null,
            error: null,
          });
        } catch {
          if (generation === this.generation) {
            this.initializing = null;
            this.publish({
              error: 'Could not open the saved history download.',
            });
          }
        }
      })();
    }
    return this.initializing;
  }
  // A download left running by a closed app, or stopped by a lost connection, carries on from its
  // cursors. One the user cancelled waits for them.
  async resumeIfInterrupted() {
    await this.initialize();
    if (!this.running && (this.current.status === 'running' || this.current.status === 'failed')) {
      await this.resume();
    }
  }
  async start(plan: HistoryPlan) {
    await this.initialize();
    if (!this.current.ready || this.running) {
      return;
    }
    this.domains = this.plan(plan);
    this.cursors = {};
    this.publish({ plan });
    await this.go();
  }
  async resume() {
    await this.initialize();
    if (!this.current.ready || this.running || !this.current.plan) {
      return;
    }
    await this.go();
  }
  async cancel() {
    if (!this.running) {
      return;
    }
    this.generation++;
    this.running = null;
    this.publish({ status: 'paused', error: null });
    await this.save('paused');
  }
  // The account changed or was cleared: stop without touching its saved state.
  stop() {
    this.generation++;
    this.running = null;
  }
  private go() {
    const generation = ++this.generation;
    this.publish({ status: 'running', error: null });
    this.running = this.run(generation).finally(() => {
      if (generation === this.generation) {
        this.running = null;
      }
    });
    return this.running;
  }
  private async run(generation: number) {
    try {
      await this.save('running');
      for (const domain of this.domains) {
        for (let index = this.position(domain); index < domain.keys.length; index++) {
          if (generation !== this.generation) {
            return;
          }
          await domain.fetch(domain.keys[index]);
          if (generation !== this.generation) {
            return;
          }
          this.cursors = { ...this.cursors, [domain.id]: domain.keys[index] };
          await this.save('running');
          this.publish({});
        }
      }
      if (generation === this.generation) {
        await this.save('complete');
        this.publish({ status: 'complete' });
      }
    } catch {
      if (generation !== this.generation) {
        return;
      }
      this.publish({
        status: 'failed',
        error:
          'History download paused: check your connection. It carries on from where it stopped.',
      });
      await this.save('failed').catch(() => undefined);
    }
  }
  private save(status: Exclude<HistoryDownloadStatus, 'idle'>) {
    if (!this.current.plan) {
      return Promise.resolve();
    }
    return this.storage.set(
      key,
      JSON.stringify({
        version: 1,
        origin: this.account.origin,
        userId: this.account.userId,
        status,
        plan: this.current.plan,
        cursors: this.cursors,
      }),
    );
  }
}
