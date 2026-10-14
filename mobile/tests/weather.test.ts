import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { WeatherStore } from '../src/features/weather/data/WeatherStore.ts';
import { fetchWeather, searchCities } from '../src/features/weather/data/open-meteo.ts';
import {
  isWeatherDay,
  temperatureLabel,
  WEATHER_TTL,
  type WeatherPlace,
  type WeatherSnapshot,
} from '../src/features/weather/data/models.ts';

const brisbane = { lat: -27.47, lon: 153.03, name: 'Brisbane' };
const london = { lat: 51.5, lon: -0.12, name: 'London' };
function snapshot(place: WeatherPlace, at: number): WeatherSnapshot {
  return {
    place,
    temperatureC: 25,
    uvIndex: 6,
    condition: 'clear',
    isDay: true,
    daylight: [{ rise: 100_000, set: 10_000_000 }],
    fetchedAt: at,
  };
}
function memory() {
  const values = new Map<string, string>();
  let fail = false;
  return {
    values,
    fail: (value: boolean) => {
      fail = value;
    },
    storage: {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string) => {
        if (fail) throw new Error('disk full');
        values.set(key, value);
      },
      remove: async (key: string) => {
        values.delete(key);
      },
    },
  };
}
test('weather settings and snapshots survive SQLite reopen without another fresh request', async () => {
  const db = sqliteFixture();
  const storage = (await createLocalStorage(db.database)).device();
  let calls = 0;
  const services = {
    locate: async () => null,
    forecast: async (place: WeatherPlace) => {
      calls++;
      return snapshot(place, 1000);
    },
  };
  const first = new WeatherStore(storage, services, () => 1000);
  await first.configure({ city: brisbane, unit: 'fahrenheit' });
  const restored = new WeatherStore(storage, services, () => 2000);
  await restored.initialize();
  assert.equal(restored.getSnapshot().snapshot?.place.name, 'Brisbane');
  assert.equal(restored.getSnapshot().settings.unit, 'fahrenheit');
  await restored.refresh();
  assert.equal(calls, 1);
  db.connection.close();
});
test('requests share reads, automatic refresh respects freshness and manual refresh bypasses it', async () => {
  const f = memory();
  let calls = 0,
    now = 1000;
  const store = new WeatherStore(
    f.storage,
    {
      locate: async () => null,
      forecast: async (place) => {
        calls++;
        return snapshot(place, now);
      },
    },
    () => now,
  );
  await store.configure({ city: brisbane });
  const a = store.refresh();
  assert.equal(a, store.refresh());
  await a;
  assert.equal(calls, 1);
  await store.refresh(true);
  assert.equal(calls, 2);
  now += WEATHER_TTL;
  await store.refresh();
  assert.equal(calls, 3);
});
test('travel checks the new coordinate cache even while the previous place is fresh', async () => {
  let device = brisbane;
  const requests: string[] = [];
  const store = new WeatherStore(
    memory().storage,
    {
      locate: async () => device,
      forecast: async (place) => {
        requests.push(place.name);
        return snapshot(place, 1000);
      },
    },
    () => 1000,
  );
  await store.useCurrentLocation();
  device = london;
  await store.refresh();
  assert.deepEqual(requests, ['Brisbane', 'London']);
  assert.equal(store.getSnapshot().snapshot?.place.name, 'London');
});
test('denied automatic location uses a saved city and never requests permission on startup', async () => {
  const permissions: boolean[] = [];
  const store = new WeatherStore(
    memory().storage,
    {
      locate: async (request) => {
        permissions.push(!!request);
        return null;
      },
      forecast: async (place) => snapshot(place, 1000),
    },
    () => 1000,
  );
  await store.configure({ city: brisbane, source: 'device' });
  assert.deepEqual(permissions, [false]);
  assert.equal(store.getSnapshot().snapshot?.place.name, 'Brisbane');
  await assert.rejects(store.useCurrentLocation(), /Could not find/);
  assert.deepEqual(permissions, [false, true]);
});
test('failed refresh retains same-place weather, backs off and permits immediate manual retry', async () => {
  let calls = 0,
    offline = false,
    now = 1000;
  const store = new WeatherStore(
    memory().storage,
    {
      locate: async () => null,
      forecast: async (place) => {
        calls++;
        if (offline) throw new Error('offline');
        return snapshot(place, now);
      },
    },
    () => now,
  );
  await store.configure({ city: brisbane });
  now += WEATHER_TTL;
  offline = true;
  await store.refresh();
  assert.match(store.getSnapshot().error!, /saved weather/);
  assert.equal(store.getSnapshot().snapshot?.temperatureC, 25);
  await store.refresh();
  assert.equal(calls, 2);
  assert.match(store.getSnapshot().error!, /saved weather/);
  offline = false;
  await store.refresh(true);
  assert.equal(calls, 3);
  assert.equal(store.getSnapshot().error, null);
});
test('switching cities discards an old in-flight result and waits for the selected city', async () => {
  let resolve!: (value: WeatherSnapshot) => void;
  let started!: () => void;
  const ready = new Promise<void>((done) => {
    started = done;
  });
  const store = new WeatherStore(
    memory().storage,
    {
      locate: async () => null,
      forecast: (place) =>
        place.name === 'Brisbane'
          ? new Promise((done) => {
              resolve = done;
              started();
            })
          : Promise.resolve(snapshot(place, 1000)),
    },
    () => 1000,
  );
  const first = store.configure({ city: brisbane });
  await ready;
  const second = store.configure({ city: london });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(store.getSnapshot().snapshot, null);
  resolve(snapshot(brisbane, 1000));
  await Promise.all([first, second]);
  assert.equal(store.getSnapshot().snapshot?.place.name, 'London');
});
test('disable and cancellation stop old responses from restoring weather or restarting requests', async () => {
  for (const cancel of [false, true]) {
    let resolve!: (value: WeatherSnapshot) => void;
    let started!: () => void;
    let calls = 0;
    const ready = new Promise<void>((done) => {
      started = done;
    });
    const store = new WeatherStore(
      memory().storage,
      {
        locate: async () => null,
        forecast: () => {
          calls++;
          return new Promise((done) => {
            resolve = done;
            started();
          });
        },
      },
      () => 1000,
    );
    const first = store.configure({ city: brisbane });
    await ready;
    if (cancel) store.cancel();
    else void store.configure({ enabled: false, backgroundEnabled: false });
    await new Promise((done) => setTimeout(done, 0));
    resolve(snapshot(brisbane, 1000));
    await first;
    assert.equal(calls, 1);
    assert.equal(store.getSnapshot().snapshot, null);
  }
});
test('disk failures keep working weather in memory and a retry saves the settings', async () => {
  const f = memory();
  f.fail(true);
  const store = new WeatherStore(
    f.storage,
    {
      locate: async () => null,
      forecast: async (place) => snapshot(place, 1000),
    },
    () => 1000,
  );
  await store.configure({ city: brisbane });
  assert.equal(store.getSnapshot().snapshot?.temperatureC, 25);
  assert.ok(store.getSnapshot().saveError);
  f.fail(false);
  await store.retry();
  assert.equal(store.getSnapshot().saveError, null);
  assert.equal(JSON.parse(f.values.get('weather.v1')!).settings.city.name, 'Brisbane');
});
test('Open-Meteo matches UV to the current hour and interprets daylight as absolute timestamps', async () => {
  let requested = '';
  const forecast = await fetchWeather(
    brisbane,
    (async (url) => {
      requested = String(url);
      return Response.json({
        current: { time: 4600, temperature_2m: 0, weather_code: 95, is_day: 1 },
        hourly: { time: [3600, 7200], uv_index: [6, 9] },
        daily: { sunrise: [4000], sunset: [8000] },
      });
    }) as typeof fetch,
    () => 1000,
  );
  assert.equal(forecast.uvIndex, 6);
  assert.equal(forecast.temperatureC, 0);
  assert.equal(forecast.condition, 'thunderstorm');
  assert.match(requested, /hourly=uv_index/);
  assert.match(requested, /timeformat=unixtime/);
  assert.equal(isWeatherDay(forecast, 5_000_000), true);
  assert.equal(isWeatherDay(forecast, 3_000_000), false);
  assert.equal(temperatureLabel(forecast, 'fahrenheit'), '32°F');
});
test('missing UV is unavailable, malformed readings fail validation and city searches are encoded', async () => {
  const forecast = await fetchWeather(brisbane, (async () =>
    Response.json({
      current: { time: 99999, temperature_2m: 20, weather_code: 0, is_day: 0 },
      hourly: { time: [0], uv_index: [null] },
      daily: { sunrise: [null], sunset: [null] },
    })) as typeof fetch);
  assert.equal(forecast.uvIndex, null);
  await assert.rejects(
    fetchWeather(brisbane, (async () =>
      Response.json({
        current: { temperature_2m: 'hot' },
      })) as typeof fetch),
  );
  const results = await searchCities('Port & City', (async (url) => {
    assert.equal(new URL(String(url)).searchParams.get('name'), 'Port & City');
    return Response.json({
      results: [
        { name: 'Port', admin1: 'State', country: 'Country', latitude: 1, longitude: 2 },
      ],
    });
  }) as typeof fetch);
  assert.deepEqual(results, [{ name: 'Port, State, Country', lat: 1, lon: 2 }]);
});
test('manual refresh arriving during location lookup still bypasses the fresh forecast cache', async () => {
  let delayed = false,
    calls = 0;
  let resolve!: (place: WeatherPlace) => void;
  let started!: () => void;
  const ready = new Promise<void>((done) => {
    started = done;
  });
  const store = new WeatherStore(
    memory().storage,
    {
      locate: async () =>
        delayed
          ? new Promise<WeatherPlace>((done) => {
              resolve = done;
              started();
            })
          : brisbane,
      forecast: async (place) => {
        calls++;
        return snapshot(place, 1000);
      },
    },
    () => 1000,
  );
  await store.configure({ source: 'device' });
  delayed = true;
  const automatic = store.refresh();
  await ready;
  const manual = store.refresh(true);
  resolve(brisbane);
  await Promise.all([automatic, manual]);
  assert.equal(calls, 2);
});
