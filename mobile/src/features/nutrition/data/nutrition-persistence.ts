import { reportError } from '../../../core/reporting/index.ts';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';

// Nutrition used to be saved as one record holding every food log and every photo, rewritten
// whole on each change (issue 3094). It is now saved in three kinds of entry:
//   - one core record: settings, foods, meals, the outbox and the index of the entries below;
//   - one entry per day of food logs, so saving a day touches only that day;
//   - one entry per photo, keyed by its food item or saved meal, stored once however many logs
//     show it. A log, food or meal saved without its photo carries `PHOTO` in its place.
// The frame handed in and out is the old single record's shape, so the store, its outbox overlay
// and its schema check are unchanged.
const legacyKey = 'nutrition-records.v1';
const coreKey = 'nutrition-records.v2';
const dayKey = (date: string) => `nutrition-day.v1:${date}`;
const photoKey = (ref: string) => `nutrition-photo.v1:${ref}`;
const PHOTO = 'photo:';

type Item = { id?: unknown; imageDataUri?: unknown } & Record<string, unknown>;
type Log = { foodItemId?: unknown; foodItem?: Item } & Record<string, unknown>;
type Meal = Item & { items?: { foodItemId?: unknown; foodItem?: Item }[] };
export type NutritionFrame = {
  data: { foods: Item[]; meals: Meal[]; days: Record<string, Log[]> } & Record<string, unknown>;
} & Record<string, unknown>;

function photo(item: Item | undefined) {
  return typeof item?.imageDataUri === 'string' && item.imageDataUri && item.imageDataUri !== PHOTO
    ? item.imageDataUri
    : null;
}
// Every photo in the frame, keyed by what it belongs to. Saved meals and the food list come last,
// so when one item shows two photos the current one wins, and older logs show it too.
function photos(frame: NutritionFrame) {
  const found = new Map<string, string>();
  const add = (ref: string, item: Item | undefined) => {
    const value = photo(item);
    if (value) {
      found.set(ref, value);
    }
  };
  for (const date of Object.keys(frame.data.days).sort()) {
    for (const log of frame.data.days[date]) {
      add(`food:${String(log.foodItem?.id ?? log.foodItemId)}`, log.foodItem);
    }
  }
  for (const meal of frame.data.meals) {
    for (const entry of meal.items ?? []) {
      add(`food:${String(entry.foodItem?.id ?? entry.foodItemId)}`, entry.foodItem);
    }
    add(`meal:${String(meal.id)}`, meal);
  }
  for (const food of frame.data.foods) {
    add(`food:${String(food.id)}`, food);
  }
  return found;
}
function placeholders(frame: NutritionFrame) {
  const refs = new Set<string>();
  const add = (ref: string, item: Item | undefined) => {
    if (item?.imageDataUri === PHOTO) {
      refs.add(ref);
    }
  };
  for (const logs of Object.values(frame.data.days)) {
    for (const log of logs) {
      add(`food:${String(log.foodItem?.id ?? log.foodItemId)}`, log.foodItem);
    }
  }
  for (const meal of frame.data.meals) {
    for (const entry of meal.items ?? []) {
      add(`food:${String(entry.foodItem?.id ?? entry.foodItemId)}`, entry.foodItem);
    }
    add(`meal:${String(meal.id)}`, meal);
  }
  for (const food of frame.data.foods) {
    add(`food:${String(food.id)}`, food);
  }
  return refs;
}
function strip<T extends Item | undefined>(item: T): T {
  return item && photo(item) ? { ...item, imageDataUri: PHOTO } : item;
}
function stripLogs(logs: Log[]) {
  return logs.map((log) => (photo(log.foodItem) ? { ...log, foodItem: strip(log.foodItem) } : log));
}
function restore<T extends Item | undefined>(item: T, ref: string, saved: Map<string, string>): T {
  if (!item || item.imageDataUri !== PHOTO) {
    return item;
  }
  const value = saved.get(ref);
  const { imageDataUri: _, ...rest } = item;
  return (value ? { ...rest, imageDataUri: value } : rest) as T;
}
function restoreLogs(logs: Log[], saved: Map<string, string>) {
  return logs.map((log) => ({
    ...log,
    foodItem: restore(log.foodItem, `food:${String(log.foodItem?.id ?? log.foodItemId)}`, saved),
  }));
}

export class NutritionPersistence {
  // What is on disk, so a write sends only the entries that changed. Days are compared by
  // reference first, since only a refresh of that day replaces its array.
  private core: string | null = null;
  private days = new Map<string, { logs: Log[]; json: string }>();
  private photos = new Map<string, string>();
  private legacy = false;
  constructor(private storage: ScopedStorage) {}
  // The saved frame, or null when nothing is saved. Reads the old single record when the new
  // entries are not there yet; the first `write` then moves it across and removes it.
  async read(): Promise<unknown> {
    const raw = await this.storage.get(coreKey);
    if (!raw) {
      const legacy = await this.storage.get(legacyKey);
      this.legacy = legacy !== null;
      return legacy ? JSON.parse(legacy) : null;
    }
    const core = JSON.parse(raw) as NutritionFrame & { dayKeys: string[] };
    const stored: Record<string, Log[]> = {};
    for (const date of core.dayKeys) {
      const value = await this.storage.get(dayKey(date));
      // A day the index lists but storage lacks means the saved records are damaged: refuse to
      // open them rather than show that day empty and later save over what remains.
      if (value === null) {
        throw new Error(`Saved food day ${date} is missing.`);
      }
      stored[date] = JSON.parse(value) as Log[];
    }
    // The photos to read are the ones something saved without its photo points at.
    const saved = new Map<string, string>();
    for (const ref of placeholders({ ...core, data: { ...core.data, days: stored } })) {
      const value = await this.storage.get(photoKey(ref));
      if (value) {
        saved.set(ref, value);
      }
    }
    const days = Object.fromEntries(
      Object.entries(stored).map(([date, logs]) => [date, restoreLogs(logs, saved)]),
    );
    const { dayKeys: _days, ...frame } = core;
    return {
      ...frame,
      version: 1,
      data: {
        ...frame.data,
        days,
        foods: frame.data.foods.map((food) => restore(food, `food:${String(food.id)}`, saved)),
        meals: frame.data.meals.map((meal) => ({
          ...restore(meal, `meal:${String(meal.id)}`, saved),
          items: (meal.items ?? []).map((entry) => ({
            ...entry,
            foodItem: restore(
              entry.foodItem,
              `food:${String(entry.foodItem?.id ?? entry.foodItemId)}`,
              saved,
            ),
          })),
        })),
      },
    };
  }
  // Called with the frame the store opened. An old single record moves across now, in one
  // transaction that also removes it; if that fails it stays readable and the next write retries.
  // Otherwise the frame is what is on disk, so the first change rewrites only what it touched.
  async opened(frame: NutritionFrame) {
    if (this.legacy) {
      await this.write(frame).catch(reportError);
      return;
    }
    const entries = this.entries(frame);
    this.core = entries.core;
    this.photos = entries.photos;
    this.days = new Map(
      Object.entries(frame.data.days).map(([date, logs]) => [
        date,
        { logs, json: JSON.stringify(stripLogs(logs)) },
      ]),
    );
  }
  async write(frame: NutritionFrame) {
    const { core, photos: current } = this.entries(frame);
    const changes: [string, string | null][] = [];
    const days = new Map<string, { logs: Log[]; json: string }>();
    for (const [ref, value] of current) {
      if (this.photos.get(ref) !== value) {
        changes.push([photoKey(ref), value]);
      }
    }
    for (const [date, logs] of Object.entries(frame.data.days)) {
      const saved = this.days.get(date);
      const json = saved?.logs === logs ? saved.json : JSON.stringify(stripLogs(logs));
      if (saved?.json !== json) {
        changes.push([dayKey(date), json]);
      }
      days.set(date, { logs, json });
    }
    // New entries first, then the core record that points at them, then removals: a write that
    // stops part-way (without a transaction) leaves whichever index is saved pointing at entries
    // that are all still there.
    if (core !== this.core) {
      changes.push([coreKey, core]);
    }
    for (const date of this.days.keys()) {
      if (!days.has(date)) {
        changes.push([dayKey(date), null]);
      }
    }
    for (const ref of this.photos.keys()) {
      if (!current.has(ref)) {
        changes.push([photoKey(ref), null]);
      }
    }
    if (this.legacy) {
      changes.push([legacyKey, null]);
    }
    if (changes.length) {
      await this.save(changes);
    }
    this.core = core;
    this.days = days;
    this.photos = current;
    this.legacy = false;
  }
  private entries(frame: NutritionFrame) {
    const current = photos(frame);
    const { data, ...rest } = frame;
    const { days, ...kept } = data;
    const core = JSON.stringify({
      ...rest,
      version: 2,
      dayKeys: Object.keys(days).sort(),
      data: {
        ...kept,
        foods: kept.foods.map((food) => strip(food)),
        meals: kept.meals.map((meal) => ({
          ...strip(meal),
          items: (meal.items ?? []).map((entry) => ({ ...entry, foodItem: strip(entry.foodItem) })),
        })),
      },
    });
    return { core, photos: current };
  }
  private async save(changes: [string, string | null][]) {
    if (this.storage.setMany) {
      await this.storage.setMany(changes);
      return;
    }
    for (const [key, value] of changes) {
      await (value === null ? this.storage.remove(key) : this.storage.set(key, value));
    }
  }
}
