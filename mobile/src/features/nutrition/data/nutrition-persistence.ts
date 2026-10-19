import { reportError } from '../../../core/reporting/index.ts';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';

// Nutrition used to be saved as one record holding every food log, check-in and photo, rewritten
// whole on each change (issues 3094 and 3101). It is now saved in four kinds of entry:
//   - the core record: settings, the outbox and the list of saved days, so it stays small however
//     much history the phone holds;
//   - the food library: foods and saved meals, written only when one of them changes;
//   - one entry per day: that day's food logs, evening check-in, meal statuses, plan answers and
//     when each of them was last read, so saving a day touches only that day;
//   - one entry per photo, keyed by its food item or saved meal, stored once however many logs
//     show it. A log, food or meal saved without its photo carries `PHOTO` in its place.
// The frame handed in and out is the old single record's shape, so the store, its outbox overlay
// and its schema check are unchanged.
const v1Key = 'nutrition-records.v1';
const v2Key = 'nutrition-records.v2';
const v2DayKey = (date: string) => `nutrition-day.v1:${date}`;
const coreKey = 'nutrition-records.v3';
const libraryKey = 'nutrition-library.v1';
const dayKey = (date: string) => `nutrition-day.v2:${date}`;
const photoKey = (ref: string) => `nutrition-photo.v1:${ref}`;
const PHOTO = 'photo:';
// A `loaded` or `savedAt` key that names a day, such as `logs:2026-10-19`, is saved with that day.
const DATED = /^([A-Za-z]+):(\d{4}-\d{2}-\d{2})$/;

type Item = { id?: unknown; imageDataUri?: unknown } & Record<string, unknown>;
type Log = { foodItemId?: unknown; foodItem?: Item } & Record<string, unknown>;
type Meal = Item & { items?: { foodItemId?: unknown; foodItem?: Item }[] };
type ByDay = Record<string, unknown>;
export type NutritionFrame = {
  data: {
    foods: Item[];
    meals: Meal[];
    days: Record<string, Log[]>;
    checkins?: ByDay;
    mealStatuses?: ByDay;
    answers?: ByDay;
  } & Record<string, unknown>;
  loaded?: string[];
  savedAt?: Record<string, number>;
} & Record<string, unknown>;
type Day = {
  logs?: Log[];
  checkin?: unknown;
  statuses?: unknown;
  answers?: unknown;
  loaded?: string[];
  savedAt?: Record<string, number>;
};
type Core = Record<string, unknown> & {
  data: Record<string, unknown>;
  dayKeys: string[];
  loaded?: string[];
  savedAt?: Record<string, number>;
};
type Library = { foods: Item[]; meals: Meal[] };

function photo(item: Item | undefined) {
  return typeof item?.imageDataUri === 'string' && item.imageDataUri && item.imageDataUri !== PHOTO
    ? item.imageDataUri
    : null;
}
const foodRef = (entry: { foodItem?: Item; foodItemId?: unknown }) =>
  `food:${String(entry.foodItem?.id ?? entry.foodItemId)}`;
// Calls `visit` for every item that can carry a photo: logs by day, then saved meals and their
// items, then the food list, so when one item shows two photos the current one wins.
function eachItem(
  days: Record<string, Log[] | undefined>,
  library: Library,
  visit: (ref: string, item: Item | undefined) => void,
) {
  for (const date of Object.keys(days).sort()) {
    for (const log of days[date] ?? []) {
      visit(foodRef(log), log.foodItem);
    }
  }
  for (const meal of library.meals) {
    for (const entry of meal.items ?? []) {
      visit(foodRef(entry), entry.foodItem);
    }
    visit(`meal:${String(meal.id)}`, meal);
  }
  for (const food of library.foods) {
    visit(`food:${String(food.id)}`, food);
  }
}
function strip<T extends Item | undefined>(item: T): T {
  return item && photo(item) ? { ...item, imageDataUri: PHOTO } : item;
}
function stripLogs(logs: Log[]) {
  return logs.map((log) => (photo(log.foodItem) ? { ...log, foodItem: strip(log.foodItem) } : log));
}
function stripLibrary(library: Library): Library {
  return {
    foods: library.foods.map((food) => strip(food)),
    meals: library.meals.map((meal) => ({
      ...strip(meal),
      items: (meal.items ?? []).map((entry) => ({ ...entry, foodItem: strip(entry.foodItem) })),
    })),
  };
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
  return logs.map((log) => ({ ...log, foodItem: restore(log.foodItem, foodRef(log), saved) }));
}
function restoreLibrary(library: Library, saved: Map<string, string>): Library {
  return {
    foods: library.foods.map((food) => restore(food, `food:${String(food.id)}`, saved)),
    meals: library.meals.map((meal) => ({
      ...restore(meal, `meal:${String(meal.id)}`, saved),
      items: (meal.items ?? []).map((entry) => ({
        ...entry,
        foodItem: restore(entry.foodItem, foodRef(entry), saved),
      })),
    })),
  };
}

// The frame cut into what each entry holds.
function split(frame: NutritionFrame) {
  const { data, loaded = [], savedAt = {}, ...rest } = frame;
  const {
    days: logs,
    checkins = {},
    mealStatuses = {},
    answers = {},
    foods,
    meals,
    ...kept
  } = data;
  const days = new Map<string, Day>();
  const day = (date: string) => {
    let entry = days.get(date);
    if (!entry) {
      entry = {};
      days.set(date, entry);
    }
    return entry;
  };
  for (const [date, value] of Object.entries(logs)) day(date).logs = value;
  for (const [date, value] of Object.entries(checkins)) day(date).checkin = value;
  for (const [date, value] of Object.entries(mealStatuses)) day(date).statuses = value;
  for (const [date, value] of Object.entries(answers)) day(date).answers = value;
  const coreLoaded: string[] = [];
  for (const key of loaded) {
    const dated = DATED.exec(key);
    if (dated) {
      (day(dated[2]).loaded ??= []).push(dated[1]);
    } else {
      coreLoaded.push(key);
    }
  }
  const coreSavedAt: Record<string, number> = {};
  for (const [key, at] of Object.entries(savedAt)) {
    const dated = DATED.exec(key);
    if (dated) {
      (day(dated[2]).savedAt ??= {})[dated[1]] = at;
    } else {
      coreSavedAt[key] = at;
    }
  }
  const core: Core = {
    ...rest,
    version: 3,
    dayKeys: [...days.keys()].sort(),
    loaded: coreLoaded,
    savedAt: coreSavedAt,
    data: kept,
  };
  return { core, library: { foods, meals }, days };
}
// The reverse of `split`, back to the old single record's shape.
function join(core: Core, library: Library, days: Map<string, Day>) {
  const { dayKeys: _keys, loaded = [], savedAt = {}, data, ...rest } = core;
  const joined = {
    days: {} as Record<string, Log[]>,
    checkins: {} as ByDay,
    mealStatuses: {} as ByDay,
    answers: {} as ByDay,
    loaded: [...loaded],
    savedAt: { ...savedAt },
  };
  for (const [date, entry] of days) {
    if ('logs' in entry) joined.days[date] = entry.logs!;
    if ('checkin' in entry) joined.checkins[date] = entry.checkin;
    if ('statuses' in entry) joined.mealStatuses[date] = entry.statuses;
    if ('answers' in entry) joined.answers[date] = entry.answers;
    for (const kind of entry.loaded ?? []) joined.loaded.push(`${kind}:${date}`);
    for (const [kind, at] of Object.entries(entry.savedAt ?? {})) {
      joined.savedAt[`${kind}:${date}`] = at;
    }
  }
  return {
    ...rest,
    version: 1,
    loaded: joined.loaded,
    savedAt: joined.savedAt,
    data: {
      ...data,
      ...library,
      days: joined.days,
      checkins: joined.checkins,
      mealStatuses: joined.mealStatuses,
      answers: joined.answers,
    },
  };
}
// A day saved by an earlier version is a bare list of logs; later ones are a `Day`.
const dayJson = (entry: Day) =>
  JSON.stringify(entry.logs ? { ...entry, logs: stripLogs(entry.logs) } : entry);
// What a day holds besides its data, compared as text since `savedAt` is rebuilt on each refresh.
const dayMeta = (entry: Day) => JSON.stringify([entry.loaded ?? [], entry.savedAt ?? {}]);

type SavedDay = { refs: unknown[]; meta: string; json: string };
const dayRefs = (entry: Day) => [entry.logs, entry.checkin, entry.statuses, entry.answers];

export class NutritionPersistence {
  // What is on disk, so a write sends only the entries that changed.
  private core: string | null = null;
  private library: { refs: unknown[]; json: string } | null = null;
  private days = new Map<string, SavedDay>();
  private photos = new Map<string, string>();
  // Entries of an earlier saved shape still on disk. The next write moves their content across
  // and removes them last, in the same transaction; an old index goes after the entries it lists,
  // so a move cut short without a transaction can still find and remove what is left.
  private stale: string[] = [];
  constructor(private storage: ScopedStorage) {}
  private async need(key: string) {
    const value = await this.storage.get(key);
    // An entry the index lists but storage lacks means the saved records are damaged: refuse to
    // open them rather than show that part empty and later save over what remains.
    if (value === null) {
      throw new Error(`Saved nutrition entry ${key} is missing.`);
    }
    return value;
  }
  private async readPhotos(days: Record<string, Log[] | undefined>, library: Library) {
    const refs = new Set<string>();
    eachItem(days, library, (ref, item) => {
      if (item?.imageDataUri === PHOTO) {
        refs.add(ref);
      }
    });
    const saved = new Map<string, string>();
    for (const ref of refs) {
      const value = await this.storage.get(photoKey(ref));
      if (value) {
        saved.set(ref, value);
      }
    }
    return saved;
  }
  // Keys of the saved shapes older than `newest` that are still on disk.
  private async older(newest: 'v3' | 'v2') {
    const stale: string[] = [];
    if (newest === 'v3') {
      const v2 = await this.storage.get(v2Key);
      if (v2 !== null) {
        try {
          stale.push(...(JSON.parse(v2) as Core).dayKeys.map(v2DayKey));
        } catch {}
        stale.push(v2Key);
      }
    }
    if ((await this.storage.get(v1Key)) !== null) {
      stale.push(v1Key);
    }
    return stale;
  }
  // The saved frame, or null when nothing is saved. Reads the newest saved shape present; an
  // earlier one is moved across by `opened`.
  async read(): Promise<unknown> {
    const raw = await this.storage.get(coreKey);
    if (raw) {
      const core = JSON.parse(raw) as Core;
      const stored = JSON.parse(await this.need(libraryKey)) as Library;
      const days = new Map<string, Day>();
      for (const date of core.dayKeys) {
        days.set(date, JSON.parse(await this.need(dayKey(date))) as Day);
      }
      const saved = await this.readPhotos(
        Object.fromEntries([...days].map(([date, entry]) => [date, entry.logs])),
        stored,
      );
      for (const entry of days.values()) {
        if (entry.logs) entry.logs = restoreLogs(entry.logs, saved);
      }
      this.stale = await this.older('v3');
      return join(core, restoreLibrary(stored, saved), days);
    }
    const v2 = await this.storage.get(v2Key);
    if (v2) {
      const core = JSON.parse(v2) as NutritionFrame & { dayKeys: string[] };
      const logs: Record<string, Log[]> = {};
      for (const date of core.dayKeys) {
        logs[date] = JSON.parse(await this.need(v2DayKey(date))) as Log[];
      }
      const library = { foods: core.data.foods, meals: core.data.meals };
      const saved = await this.readPhotos(logs, library);
      // The photo entries are already in their final place: the move leaves them as they are.
      this.photos = saved;
      this.stale = [...core.dayKeys.map(v2DayKey), v2Key, ...(await this.older('v2'))];
      const { dayKeys: _keys, ...frame } = core;
      return {
        ...frame,
        version: 1,
        data: {
          ...frame.data,
          ...restoreLibrary(library, saved),
          days: Object.fromEntries(
            Object.entries(logs).map(([date, day]) => [date, restoreLogs(day, saved)]),
          ),
        },
      };
    }
    const v1 = await this.storage.get(v1Key);
    this.stale = v1 === null ? [] : [v1Key];
    return v1 === null ? null : JSON.parse(v1);
  }
  // Called with the frame the store opened. An earlier saved shape moves across now, in one
  // transaction that writes the new entries and removes the old ones last; if that fails the old
  // shape stays readable, the failure is reported, and the next write retries. Otherwise the
  // frame is what is on disk, so the first change rewrites only what it touched.
  async opened(frame: NutritionFrame) {
    if (this.stale.length) {
      await this.write(frame).catch(reportError);
      return;
    }
    const { core, library, days } = split(frame);
    this.core = JSON.stringify(core);
    this.library = {
      refs: [library.foods, library.meals],
      json: JSON.stringify(stripLibrary(library)),
    };
    this.photos = this.collect(frame);
    this.days = new Map(
      [...days].map(([date, entry]) => [
        date,
        { refs: dayRefs(entry), meta: dayMeta(entry), json: dayJson(entry) },
      ]),
    );
  }
  async write(frame: NutritionFrame) {
    const { core: coreValue, library, days } = split(frame);
    const current = this.collect(frame);
    const core = JSON.stringify(coreValue);
    const changes: [string, string | null][] = [];
    for (const [ref, value] of current) {
      if (this.photos.get(ref) !== value) {
        changes.push([photoKey(ref), value]);
      }
    }
    const libraryRefs = [library.foods, library.meals];
    let savedLibrary = this.library;
    if (!savedLibrary || savedLibrary.refs.some((ref, index) => ref !== libraryRefs[index])) {
      const json = JSON.stringify(stripLibrary(library));
      if (savedLibrary?.json !== json) {
        changes.push([libraryKey, json]);
      }
      savedLibrary = { refs: libraryRefs, json };
    }
    const savedDays = new Map<string, SavedDay>();
    for (const [date, entry] of days) {
      const saved = this.days.get(date);
      const refs = dayRefs(entry);
      const meta = dayMeta(entry);
      let json = saved?.json;
      if (!saved || saved.meta !== meta || saved.refs.some((ref, index) => ref !== refs[index])) {
        json = dayJson(entry);
        if (saved?.json !== json) {
          changes.push([dayKey(date), json]);
        }
      }
      savedDays.set(date, { refs, meta, json: json! });
    }
    // New entries first, then the core record that lists them, then removals and the older
    // shape: a write that stops part-way (without a transaction) leaves whichever index is saved
    // pointing at entries that are all still there.
    if (core !== this.core) {
      changes.push([coreKey, core]);
    }
    for (const date of this.days.keys()) {
      if (!savedDays.has(date)) {
        changes.push([dayKey(date), null]);
      }
    }
    for (const ref of this.photos.keys()) {
      if (!current.has(ref)) {
        changes.push([photoKey(ref), null]);
      }
    }
    for (const key of this.stale) {
      changes.push([key, null]);
    }
    if (changes.length) {
      await this.save(changes);
    }
    this.core = core;
    this.library = savedLibrary;
    this.days = savedDays;
    this.photos = current;
    this.stale = [];
  }
  private collect(frame: NutritionFrame) {
    const found = new Map<string, string>();
    eachItem(frame.data.days, frame.data, (ref, item) => {
      const value = photo(item);
      if (value) {
        found.set(ref, value);
      }
    });
    return found;
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
