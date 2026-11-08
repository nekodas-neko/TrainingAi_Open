import type { ScopedStorage } from '../../core/storage/LocalStorage.ts';
import { palettes, type Brand } from '../../shared/theme/palettes.ts';
import type { ThemeMode } from '../../shared/theme/theme.ts';

type Appearance = { mode: ThemeMode; brand: Brand; customHue: number | null };
export type AppearanceState = Appearance & {
  saveStatus: 'saved' | 'saving' | 'error';
};
const key = 'appearance';

/** The slice of the account's `/api/user/preferences` this reads and writes. */
export type AppearanceAccount = {
  get(path: string): Promise<unknown>;
  patch?(path: string, body: unknown): Promise<unknown>;
};

/**
 * The accent the account holds, as the current app reads it (#3669 item 4): `brandTheme` and
 * `brandHue` are a mutually exclusive pair and the preset wins when both are set, as
 * `hydrateUserPreferences`' `EXCLUSIVE_GROUPS` resolves it. Light/dark is not here on purpose: the
 * current app keeps it on the device (`DEVICE_LOCAL_PREFERENCES.theme`). `null` when the account has
 * no usable accent, so the device keeps its own.
 */
export function accountAccent(bag: unknown): { brand: Brand | null; customHue: number | null } | null {
  if (!bag || typeof bag !== 'object') return null;
  const { brandTheme, brandHue } = bag as { brandTheme?: unknown; brandHue?: unknown };
  if (typeof brandTheme === 'string' && Object.hasOwn(palettes, brandTheme)) {
    return { brand: brandTheme as Brand, customHue: null };
  }
  if (typeof brandHue === 'number' && Number.isFinite(brandHue) && brandHue >= 0 && brandHue <= 360) {
    return { brand: null, customHue: brandHue };
  }
  return null;
}

/** One PATCH for the pair, as the current app's picker sends it, so two writes cannot land out of order. */
export function accentPatch(appearance: { brand: Brand; customHue: number | null }) {
  return appearance.customHue !== null
    ? { brandHue: Math.round(appearance.customHue), brandTheme: null }
    : { brandTheme: appearance.brand, brandHue: null };
}

function parsePending(raw: string | null): boolean {
  try {
    return raw ? (JSON.parse(raw) as { accountPending?: unknown }).accountPending === true : false;
  } catch {
    return false;
  }
}

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
  /** An accent chosen here that the account has not acknowledged yet; it survives a relaunch. */
  private accountPending = false;
  private account: AppearanceAccount | null = null;
  private syncing: Promise<void> | null = null;
  private again = false;

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
    this.accountPending = parsePending(saved);
    this.publish({ ...parseAppearance(saved), saveStatus: 'saved' });
  }

  /**
   * Follow the signed-in account's accent, as the current app does: the account wins, except over
   * an accent picked here that has not reached it yet, which is sent instead. `null` detaches (sign
   * out). Failures are silent and retried on the next call; the device copy is always kept.
   */
  attachAccount(account: AppearanceAccount | null) {
    this.account = account;
    return this.syncAccount();
  }

  syncAccount = (): Promise<void> => {
    if (this.syncing) {
      // A pick landing mid-read must still be sent once this round ends.
      this.again = true;
      return this.syncing;
    }
    this.again = false;
    this.syncing = (async () => {
      try {
        // A pick made while a send was in flight is pending again; send it before reading.
        for (let round = 0; round < 3; round++) {
          const account = this.account;
          if (!account) return;
          const revision = this.revision;
          if (this.accountPending) {
            if (!account.patch) return;
            await account.patch('/api/user/preferences', accentPatch(this.current));
            if (revision === this.revision && account === this.account) {
              this.accountPending = false;
              await this.persist(this.current);
              return;
            }
            continue;
          }
          const accent = accountAccent(await account.get('/api/user/preferences'));
          if (!accent || revision !== this.revision || this.accountPending || account !== this.account) {
            return;
          }
          const next = {
            mode: this.current.mode,
            brand: accent.brand ?? this.current.brand,
            customHue: accent.customHue,
          };
          if (next.brand !== this.current.brand || next.customHue !== this.current.customHue) {
            this.save(next);
          }
          return;
        }
      } catch {
        // Offline or refused: the device keeps its accent and the pending mark, for the next try.
      } finally {
        this.syncing = null;
        if (this.again && this.accountPending) void this.syncAccount();
      }
    })();
    return this.syncing;
  };

  setMode = (mode: ThemeMode) => {
    if (mode !== this.current.mode) {
      this.save({ mode, brand: this.current.brand, customHue: this.current.customHue });
    }
  };

  setBrand = (brand: Brand) => {
    if (brand !== this.current.brand || this.current.customHue !== null) {
      this.save({ mode: this.current.mode, brand, customHue: null }, true);
      void this.syncAccount();
    }
  };

  setCustomHue = (customHue: number | null) => {
    if (customHue !== null && (!Number.isFinite(customHue) || customHue < 0 || customHue > 360))
      return;
    if (customHue !== this.current.customHue) {
      this.save({ mode: this.current.mode, brand: this.current.brand, customHue }, true);
      void this.syncAccount();
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

  private persist(appearance: Appearance) {
    const value = JSON.stringify({
      mode: appearance.mode,
      brand: appearance.brand,
      customHue: appearance.customHue,
      ...(this.accountPending ? { accountPending: true } : {}),
    });
    const write = this.writes.then(() => this.storage.set(key, value));
    this.writes = write.catch(() => {});
    return write;
  }

  /**
   * `toAccount`: an accent the user picked here while signed in, so the account is sent it (#3669
   * item 4). A pick made signed out stays on the phone; signing in then takes the account's.
   */
  private save(appearance: Appearance, toAccount = false) {
    const revision = ++this.revision;
    if (toAccount && this.account) this.accountPending = true;
    this.publish({ ...appearance, saveStatus: 'saving' });
    void this.persist(appearance)
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
