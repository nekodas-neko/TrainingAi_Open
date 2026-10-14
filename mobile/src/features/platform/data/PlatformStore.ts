import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import { platformSchema, type PlatformSettings, type Reminder } from './models.ts';
export class PlatformStore {
  private state: { ready: boolean; settings: PlatformSettings; error: string | null };
  private listeners = new Set<() => void>();
  private initialization: Promise<void> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private storage: ScopedStorage,
    uuid: () => string,
  ) {
    this.state = {
      ready: false,
      settings: platformSchema.parse({ scope: uuid() }),
      error: null,
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private publish(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  initialize() {
    return (this.initialization ??= (async () => {
      try {
        const raw = await this.storage.get('platform-settings.v1');
        if (raw) this.publish({ settings: platformSchema.parse(JSON.parse(raw)) });
        else
          await this.storage.set('platform-settings.v1', JSON.stringify(this.state.settings));
        this.publish({ ready: true });
      } catch {
        this.publish({
          error:
            'Could not open integration settings. Retry to keep alerts and calendar changes safe.',
        });
      }
    })());
  }
  async configure(
    patch:
      | Partial<PlatformSettings>
      | ((settings: PlatformSettings) => Partial<PlatformSettings>),
  ) {
    await this.initialize();
    if (!this.state.ready) throw new Error(this.state.error!);
    const operation = this.writes.then(async () => {
      const settings = platformSchema.parse({
        ...this.state.settings,
        ...(typeof patch === 'function' ? patch(this.state.settings) : patch),
        scope: this.state.settings.scope,
      });
      await this.storage.set('platform-settings.v1', JSON.stringify(settings));
      this.publish({ settings, error: null });
    });
    this.writes = operation.catch(() => {});
    try {
      await operation;
    } catch {
      this.publish({
        error: 'Could not save integration settings. Your previous settings are kept.',
      });
      throw new Error(this.state.error!);
    }
  }
  async retry() {
    await this.initialize();
    if (!this.state.ready) {
      this.initialization = null;
      await this.initialize();
    } else {
      await this.configure({});
    }
  }
  async saveReminder(reminder: Reminder) {
    await this.configure((settings) => ({
      reminders: [...settings.reminders.filter((row) => row.id !== reminder.id), reminder],
    }));
  }
  async removeReminder(id: string) {
    await this.configure((settings) => ({
      reminders: settings.reminders.filter((row) => row.id !== id),
    }));
  }
}
