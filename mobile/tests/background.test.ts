import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDayPhase } from '@trainingai/shared/background/day-phase';
import { PALETTES } from '@trainingai/shared/background/palettes';
import {
  backgroundPhase,
  backgroundFadeKey,
  skyStep,
  backgroundScene,
  backgroundParticles,
  tintWeather,
} from '../src/features/weather/data/background.ts';
import {
  defaults,
  settingsSchema,
  weatherNeeded,
  type WeatherSnapshot,
} from '../src/features/weather/data/models.ts';
import { WeatherStore } from '../src/features/weather/data/WeatherStore.ts';
const rise = Date.UTC(2026, 9, 13, 6),
  set = Date.UTC(2026, 9, 13, 18);
const snapshot: WeatherSnapshot = {
  place: { name: 'City', lat: 1, lon: 2 },
  condition: 'clear',
  isDay: true,
  temperatureC: 20,
  uvIndex: 3,
  fetchedAt: rise,
  daylight: [{ rise, set }],
};
test('daylight colours and celestial arcs follow the original web calculations', () => {
  const noon = computeDayPhase(new Date(rise + 6 * 3600000), new Date(rise), new Date(set));
  assert.equal(noon.isDay, true);
  assert.deepEqual(noon.skyTop, PALETTES.day.skyTop);
  assert.equal(noon.celestialX, 50);
  assert.equal(noon.celestialY, 20);
  const night = computeDayPhase(new Date(set + 6 * 3600000), new Date(rise), new Date(set));
  assert.equal(night.isDay, false);
  assert.deepEqual(night.skyTop, PALETTES.deepNight.skyTop);
  const dawn = computeDayPhase(new Date(rise - 1800000), new Date(rise), new Date(set));
  assert.deepEqual(dawn.skyTop, PALETTES.dawn.skyTop);
});
test('cached sunrise/sunset data advances to the current day instead of becoming permanently night', () => {
  const now = rise + 3 * 86400000 + 6 * 3600000;
  assert.equal(backgroundPhase(snapshot, now, PALETTES).isDay, true);
  assert.deepEqual(backgroundPhase(snapshot, now, PALETTES).skyTop, PALETTES.day.skyTop);
});
test('solar epochs follow the selected place rather than the phone timezone', () => {
  const abroad = {
    ...snapshot,
    daylight: [{ rise: rise + 10 * 3600000, set: set + 10 * 3600000 }],
  };
  assert.equal(backgroundPhase(abroad, rise + 6 * 3600000, PALETTES).isDay, false);
  assert.equal(backgroundPhase(abroad, rise + 16 * 3600000, PALETTES).isDay, true);
});
test('scene routing obeys each toggle and preserves bespoke health-detail artwork', () => {
  const settings = settingsSchema.parse({ backgroundEnabled: true });
  assert.equal(backgroundScene(settings, 'home', null, null), 'sky');
  assert.equal(backgroundScene(settings, 'workout', null, null), 'sky');
  assert.equal(backgroundScene(settings, 'home', 'health-day', null), 'health');
  assert.equal(backgroundScene(settings, 'home', 'settings', null), 'more');
  assert.equal(backgroundScene(settings, 'workout', 'session-explain', null), 'sessionExplain');
  assert.equal(backgroundScene(settings, 'health', null, 'sleep'), null);
  assert.equal(
    backgroundScene({ ...settings, backgroundEnabled: false }, 'home', null, null),
    null,
  );
  assert.equal(
    backgroundScene(
      { ...settings, backgroundSections: { ...settings.backgroundSections, workout: false } },
      'workout',
      null,
      null,
    ),
    null,
  );
});
test('weather tints remain valid RGB values and generated particles stay deterministic and bounded', () => {
  assert.equal(tintWeather([70, 140, 230], 'clear'), 'rgb(70,140,230)');
  for (const condition of ['rain', 'cloudy', 'snow', 'fog', 'thunderstorm'] as const) {
    const values = tintWeather([240, 180, 100], condition).match(/\d+/g)!.map(Number);
    assert.ok(values.every((value) => value >= 0 && value <= 255));
  }
  const particles = backgroundParticles(36, 390, 844);
  assert.deepEqual(particles, backgroundParticles(36, 390, 844));
  assert.ok(particles.every((row) => row.x >= 0 && row.x <= 390 && row.y >= 0 && row.y <= 844));
});
test('background preferences migrate old weather settings, persist and allow weather with the chip hidden', async () => {
  const values = new Map<string, string>();
  values.set(
    'weather.v1',
    JSON.stringify({
      settings: { enabled: true, source: 'city', city: snapshot.place, unit: 'celsius' },
      cache: [snapshot],
    }),
  );
  const storage = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
    remove: async () => {},
  };
  let reads = 0;
  const services = {
    locate: async () => null,
    forecast: async () => {
      reads++;
      return snapshot;
    },
  };
  const store = new WeatherStore(storage, services, () => rise);
  await store.initialize();
  assert.equal(
    store.getSnapshot().settings.backgroundEnabled,
    false,
    'settings saved before the switch existed come up with backgrounds off (#3692)',
  );
  await store.configure({ enabled: false, backgroundAnimated: false, backgroundEnabled: true });
  assert.equal(weatherNeeded(store.getSnapshot().settings), true);
  assert.ok(store.getSnapshot().snapshot);
  await store.configure({
    backgroundSections: {
      home: false,
      workout: false,
      health: true,
      nutrition: true,
      more: true,
    },
  });
  assert.equal(weatherNeeded(store.getSnapshot().settings), false);
  const reopened = new WeatherStore(storage, services, () => rise);
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().settings.backgroundAnimated, false);
  assert.equal(reopened.getSnapshot().settings.backgroundSections.home, false);
  assert.equal(reads, 0);
});

test('moving backgrounds start switched off, and a saved choice is kept either way (#3692)', async () => {
  assert.equal(defaults.backgroundEnabled, false);
  assert.equal(settingsSchema.parse({}).backgroundEnabled, false);
  assert.equal(settingsSchema.parse({ backgroundEnabled: true }).backgroundEnabled, true);
  const open = (saved: object | null) => {
    const values = new Map<string, string>();
    if (saved) values.set('weather.v1', JSON.stringify({ settings: saved, cache: [] }));
    return new WeatherStore(
      {
        get: async (key: string) => values.get(key) ?? null,
        set: async (key: string, value: string) => void values.set(key, value),
        remove: async () => {},
      },
      { locate: async () => null, forecast: async () => snapshot },
      () => rise,
    );
  };
  const fresh = open(null);
  await fresh.initialize();
  assert.equal(fresh.getSnapshot().settings.backgroundEnabled, false, 'a fresh install');
  const turnedOn = open({ enabled: true, backgroundEnabled: true });
  await turnedOn.initialize();
  assert.equal(turnedOn.getSnapshot().settings.backgroundEnabled, true, 'a user who turned them on');
  const turnedOff = open({ enabled: true, backgroundEnabled: false });
  await turnedOff.initialize();
  assert.equal(turnedOff.getSnapshot().settings.backgroundEnabled, false);
});
test('the fade key holds for 10 minutes of one scene and step, and changes on a step', () => {
  const noon = rise + 6 * 3600000;
  const keyAt = (at: number, condition: WeatherSnapshot['condition'] = 'clear') =>
    backgroundFadeKey('sky', 'dark', condition, skyStep(snapshot, at));
  const first = keyAt(noon);
  for (let minute = 1; minute <= 10; minute++) assert.equal(keyAt(noon + minute * 60000), first);
  assert.equal(skyStep(snapshot, rise - 2 * 3600000), 'night');
  assert.equal(skyStep(snapshot, rise), 'dawn');
  assert.equal(skyStep(snapshot, noon), 'day');
  assert.equal(skyStep(snapshot, set), 'dusk');
  assert.equal(skyStep(snapshot, set + 3 * 3600000), 'night');
  assert.notEqual(keyAt(rise + 89 * 60000), keyAt(rise + 91 * 60000));
  assert.notEqual(keyAt(noon), keyAt(noon, 'rain'));
  assert.notEqual(first, backgroundFadeKey('sky', 'light', 'clear', 'day'));
  assert.notEqual(first, backgroundFadeKey('more', 'dark', 'clear', null));
});
