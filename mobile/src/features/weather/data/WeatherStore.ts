import { z } from 'zod';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import { RefreshPolicy } from '../../../core/sync/RefreshPolicy.ts';
import {
  defaults,
  placeKey,
  settingsSchema,
  snapshotSchema,
  WEATHER_TTL,
  weatherNeeded,
  type WeatherPlace,
  type WeatherSettings,
  type WeatherSnapshot,
} from './models.ts';

const savedSchema = z.object({
  settings: settingsSchema,
  cache: z.array(snapshotSchema).max(8),
  lastDevice: z
    .object({ place: snapshotSchema.shape.place, checkedAt: z.number().finite() })
    .nullable()
    .default(null),
});
export type WeatherState = {
  ready: boolean;
  settings: WeatherSettings;
  snapshot: WeatherSnapshot | null;
  busy: boolean;
  error: string | null;
  saveError: string | null;
};
export type WeatherServices = {
  locate: (requestPermission?: boolean) => Promise<WeatherPlace | null>;
  forecast: (place: WeatherPlace) => Promise<WeatherSnapshot>;
};
export class WeatherStore {
  private state: WeatherState = {
    ready: false,
    settings: defaults,
    snapshot: null,
    busy: false,
    error: null,
    saveError: null,
  };
  private cache: WeatherSnapshot[] = [];
  private lastDevice: { place: WeatherPlace; checkedAt: number } | null = null;
  private policies = new Map<string, RefreshPolicy>();
  private listeners = new Set<() => void>();
  private initialization: Promise<void> | null = null;
  private request: Promise<void> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private cancelled = false;
  private queuedManual = false;
  private fetching = false;
  constructor(
    private storage: ScopedStorage,
    private services: WeatherServices,
    private now = Date.now,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private publish(patch: Partial<WeatherState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private selectedPlace() {
    return this.state.settings.source === 'device'
      ? (this.lastDevice?.place ?? this.state.settings.city)
      : this.state.settings.city;
  }
  private seed(place: WeatherPlace | null) {
    return place
      ? (this.cache.find((row) => placeKey(row.place) === placeKey(place)) ?? null)
      : null;
  }
  initialize() {
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      try {
        const raw = await this.storage.get('weather.v1');
        if (raw) {
          const saved = savedSchema.parse(JSON.parse(raw));
          this.cache = saved.cache;
          this.lastDevice = saved.lastDevice;
          this.publish({ settings: saved.settings });
        }
      } catch {
        this.publish({
          saveError:
            'Could not read saved weather settings. Your other records are unaffected.',
        });
      }
      this.publish({
        ready: true,
        snapshot: weatherNeeded(this.state.settings) ? this.seed(this.selectedPlace()) : null,
      });
    })();
    return this.initialization;
  }
  private persist() {
    const value = JSON.stringify({
      settings: this.state.settings,
      cache: this.cache,
      lastDevice: this.lastDevice,
    });
    const write = this.writes.then(() => this.storage.set('weather.v1', value));
    this.writes = write.catch(() => {});
    return write.then(
      () => this.publish({ saveError: null }),
      () =>
        this.publish({
          saveError: 'Weather settings could not be saved. Retry to keep them after reopening.',
        }),
    );
  }
  async configure(
    patch: Partial<WeatherSettings> | ((settings: WeatherSettings) => Partial<WeatherSettings>),
  ) {
    await this.initialize();
    const settings = settingsSchema.parse({
      ...this.state.settings,
      ...(typeof patch === 'function' ? patch(this.state.settings) : patch),
    });
    this.revision++;
    this.publish({
      settings,
      error: null,
      snapshot: weatherNeeded(settings)
        ? this.seed(
            settings.source === 'device'
              ? (this.lastDevice?.place ?? settings.city)
              : settings.city,
          )
        : null,
    });
    await this.persist();
    await this.refresh();
  }
  refresh(manual = false): Promise<void> {
    this.cancelled = false;
    if (this.request) {
      if (manual && !this.fetching) this.queuedManual = true;
      return this.request;
    }
    const revision = this.revision;
    this.request = this.load(manual).finally(() => {
      this.request = null;
      const queuedManual = this.queuedManual;
      this.queuedManual = false;
      if ((revision !== this.revision || queuedManual) && !this.cancelled)
        return this.refresh(queuedManual);
    });
    return this.request;
  }
  private async load(manual: boolean) {
    await this.initialize();
    const settings = this.state.settings;
    if (!weatherNeeded(settings)) return;
    const revision = this.revision;
    this.publish({ busy: true });
    try {
      let place = settings.city;
      if (settings.source === 'device') {
        const device = await this.services.locate(false).catch(() => null);
        if (revision !== this.revision) return;
        if (device) {
          place = device;
          this.lastDevice = { place: device, checkedAt: this.now() };
        } else if (!place) {
          this.publish({ snapshot: null, error: 'Choose a city or allow current location.' });
          return;
        }
      }
      if (!place || revision !== this.revision) return;
      const saved = this.seed(place);
      const samePlace =
        this.state.snapshot && placeKey(this.state.snapshot.place) === placeKey(place);
      this.publish({
        snapshot: saved ? { ...saved, place } : null,
        error: samePlace ? this.state.error : null,
      });
      const key = placeKey(place);
      let policy = this.policies.get(key);
      if (!policy) {
        policy = new RefreshPolicy(this.now, WEATHER_TTL);
        if (saved) policy.succeeded(saved.fetchedAt);
        this.policies.set(key, policy);
      }
      const force = manual || this.queuedManual;
      this.queuedManual = false;
      if (!force && !policy.shouldRefresh()) return;
      try {
        this.fetching = true;
        this.publish({ error: null });
        const snapshot = snapshotSchema.parse(await this.services.forecast(place));
        if (revision !== this.revision) return;
        if (placeKey(snapshot.place) !== key)
          throw new Error('Weather returned for a different location.');
        policy.succeeded(snapshot.fetchedAt);
        this.cache = [
          snapshot,
          ...this.cache.filter((row) => placeKey(row.place) !== key),
        ].slice(0, 8);
        this.publish({ snapshot });
        await this.persist();
      } catch {
        if (revision !== this.revision) return;
        policy.failed();
        this.publish({
          error: saved
            ? 'Could not refresh. Showing saved weather.'
            : 'Weather is unavailable. Try again shortly.',
        });
      }
    } finally {
      this.fetching = false;
      this.publish({ busy: false });
    }
  }
  async useCurrentLocation() {
    await this.initialize();
    const revision = this.revision;
    const place = await this.services.locate(true);
    if (revision !== this.revision) return;
    if (!place) throw new Error('Could not find your location. Choose a city or retry.');
    this.lastDevice = { place, checkedAt: this.now() };
    await this.configure({ source: 'device', enabled: true });
  }
  async retry() {
    await this.persist();
    await this.refresh(true);
  }
  cancel() {
    this.cancelled = true;
    this.revision++;
  }
}
