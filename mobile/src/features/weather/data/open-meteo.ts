import { z } from 'zod';
import {
  placeSchema,
  weatherCondition,
  type WeatherPlace,
  type WeatherSnapshot,
} from './models.ts';

const forecastSchema = z.object({
  current: z.object({
    time: z.number().finite(),
    temperature_2m: z.number().finite(),
    weather_code: z.number().int(),
    is_day: z.number().int().min(0).max(1),
  }),
  hourly: z.object({
    time: z.array(z.number().finite()),
    uv_index: z.array(z.number().finite().min(0).nullable()),
  }),
  daily: z.object({
    sunrise: z.array(z.number().finite().nullable()),
    sunset: z.array(z.number().finite().nullable()),
  }),
});
const searchSchema = z.object({
  results: z
    .array(
      z.object({
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
        name: z.string(),
        admin1: z.string().optional(),
        country: z.string().optional(),
      }),
    )
    .max(10)
    .optional(),
});
async function json(url: URL, fetcher: typeof fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) throw new Error('Weather is unavailable. Try again shortly.');
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
export async function fetchWeather(
  place: WeatherPlace,
  fetcher = fetch,
  now = Date.now,
): Promise<WeatherSnapshot> {
  placeSchema.parse(place);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: place.lat.toFixed(4),
    longitude: place.lon.toFixed(4),
    current: 'temperature_2m,weather_code,is_day',
    hourly: 'uv_index',
    daily: 'sunrise,sunset',
    forecast_days: '2',
    timeformat: 'unixtime',
    timezone: 'auto',
  }).toString();
  const data = forecastSchema.parse(await json(url, fetcher));
  const hour = data.hourly.time.findIndex(
    (time) => time <= data.current.time && data.current.time - time < 3600,
  );
  return {
    place,
    temperatureC: data.current.temperature_2m,
    condition: weatherCondition(data.current.weather_code),
    isDay: data.current.is_day === 1,
    uvIndex: hour < 0 ? null : (data.hourly.uv_index[hour] ?? null),
    daylight: data.daily.sunrise.flatMap((rise, index) => {
      const set = data.daily.sunset[index];
      return rise != null && set != null && set > rise
        ? [{ rise: rise * 1000, set: set * 1000 }]
        : [];
    }),
    fetchedAt: now(),
  };
}
export async function searchCities(query: string, fetcher = fetch): Promise<WeatherPlace[]> {
  const text = query.trim();
  if (text.length < 2) return [];
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({
    name: text.slice(0, 100),
    count: '5',
    language: 'en',
    format: 'json',
  }).toString();
  const data = searchSchema.parse(await json(url, fetcher));
  return (data.results ?? []).map((result) =>
    placeSchema.parse({
      lat: result.latitude,
      lon: result.longitude,
      name: [result.name, result.admin1, result.country].filter(Boolean).join(', '),
    }),
  );
}
