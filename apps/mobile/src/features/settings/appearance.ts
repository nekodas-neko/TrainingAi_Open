import type { ScopedStorage } from '../../core/storage/LocalStorage.ts';
import { palettes, type Brand } from '../../shared/theme/palettes.ts';
import type { ThemeMode } from '../../shared/theme/theme.ts';

type Appearance = { mode: ThemeMode; brand: Brand; customHue: number | null };
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
    customHue:
      typeof saved?.customHue === 'number' &&
      Number.isFinite(saved.customHue) &&
      saved.customHue >= 0 &&
      saved.customHue <= 360
        ? saved.customHue
        : null,
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
    customHue: null,
    saveStatus: 'saved',
  };
  private revision = 0;
  private writes: Promise<void> = Promise.resolve();
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
      this.save({ mode, brand: this.current.brand, customHue: this.current.customHue });
    }
  };

  setBrand = (brand: Brand) => {
    if (brand !== this.current.brand || this.current.customHue !== null) {
      this.save({ mode: this.current.mode, brand, customHue: null });
    }
  };

  setCustomHue = (customHue: number | null) => {
    if (customHue !== null && (!Number.isFinite(customHue) || customHue < 0 || customHue > 360))
      return;
    if (customHue !== this.current.customHue) {
      this.save({ mode: this.current.mode, brand: this.current.brand, customHue });
    }
  };

  retry = () => {
    this.save({
      mode: this.current.mode,
      brand: this.current.brand,
      customHue: this.current.customHue,
    });
  };

  private publish(state: AppearanceState) {
    this.current = state;
    this.listeners.forEach((listener) => listener());
  }

  private save(appearance: Appearance) {
    const revision = ++this.revision;
    this.publish({ ...appearance, saveStatus: 'saving' });
    this.writes = this.writes
      .then(() => this.storage.set(key, JSON.stringify(appearance)))
      .then(
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
