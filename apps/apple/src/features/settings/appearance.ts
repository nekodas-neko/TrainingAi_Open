import type { ScopedStorage } from '../../core/storage/LocalStorage.ts';
import { palettes, type Brand } from '../../shared/theme/palettes.ts';
import type { ThemeMode } from '../../shared/theme/theme.ts';

type Appearance = { mode: ThemeMode; brand: Brand };
export type AppearanceState = Appearance & {
  saveStatus: 'saved' | 'saving' | 'error';
};
const key = 'appearance';

function parseAppearance(raw: string | null): Appearance {
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    value = null;
  }
  const saved = value as Partial<Appearance> | null;
  return {
    mode: saved?.mode === 'light' || saved?.mode === 'dark' ? saved.mode : 'system',
    brand:
      typeof saved?.brand === 'string' && Object.hasOwn(palettes, saved.brand)
        ? saved.brand
        : 'green',
  };
}

export class AppearancePreferences {
  private storage: ScopedStorage;
  private current: AppearanceState = {
    mode: 'system',
    brand: 'green',
    saveStatus: 'saved',
  };
  private revision = 0;
  private listeners = new Set<() => void>();

  constructor(storage: ScopedStorage) {
    this.storage = storage;
  }

  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async load() {
    const saved = await this.storage.get(key);
    this.publish({ ...parseAppearance(saved), saveStatus: 'saved' });
  }

  setMode = (mode: ThemeMode) => {
    if (mode !== this.current.mode) {
      this.save({ mode, brand: this.current.brand });
    }
  };

  setBrand = (brand: Brand) => {
    if (brand !== this.current.brand) {
      this.save({ mode: this.current.mode, brand });
    }
  };

  retry = () => {
    this.save({ mode: this.current.mode, brand: this.current.brand });
  };

  private publish(state: AppearanceState) {
    this.current = state;
    this.listeners.forEach((listener) => listener());
  }

  private save(appearance: Appearance) {
    const revision = ++this.revision;
    this.publish({ ...appearance, saveStatus: 'saving' });
    void this.storage.set(key, JSON.stringify(appearance)).then(
      () => {
        if (revision === this.revision) {
          this.publish({ ...appearance, saveStatus: 'saved' });
        }
      },
      () => {
        if (revision === this.revision) {
          this.publish({ ...appearance, saveStatus: 'error' });
        }
      },
    );
  }
}
