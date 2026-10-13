import { z } from 'zod';

export const placeSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  name: z.string().trim().min(1).max(250),
});
export type WeatherPlace = z.infer<typeof placeSchema>;
export const settingsSchema = z.object({
  enabled: z.boolean().default(true),
  source: z.enum(['city', 'device']).default('city'),
  city: placeSchema.nullable().default(null),
  unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  backgroundEnabled: z.boolean().default(true),
  backgroundAnimated: z.boolean().default(true),
  backgroundSections: z
    .object({
      home: z.boolean().default(true),
      health: z.boolean().default(true),
      workout: z.boolean().default(true),
      nutrition: z.boolean().default(true),
      more: z.boolean().default(true),
    })
    .default({ home: true, health: true, workout: true, nutrition: true, more: true }),
});
export type WeatherSettings = z.infer<typeof settingsSchema>;
export const snapshotSchema = z.object({
  place: placeSchema,
  temperatureC: z.number().finite(),
  uvIndex: z.number().finite().min(0).nullable(),
  condition: z.enum(['clear', 'cloudy', 'rain', 'fog', 'snow', 'thunderstorm']),
  isDay: z.boolean(),
  daylight: z.array(z.object({ rise: z.number().finite(), set: z.number().finite() })).max(3),
  fetchedAt: z.number().finite(),
});
export type WeatherSnapshot = z.infer<typeof snapshotSchema>;
export const WEATHER_TTL = 30 * 60_000;
export const defaults = settingsSchema.parse({});
export function weatherNeeded(settings: WeatherSettings) {
  return (
    settings.enabled ||
    (settings.backgroundEnabled &&
      (settings.backgroundSections.home || settings.backgroundSections.workout))
  );
}
export function placeKey(place: WeatherPlace) {
  return `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
}
export function weatherCondition(code: number): WeatherSnapshot['condition'] {
  if (code === 0) return 'clear';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'thunderstorm';
  return 'cloudy';
}
export function isWeatherDay(snapshot: WeatherSnapshot, now = Date.now()) {
  return snapshot.daylight.length
    ? snapshot.daylight.some((day) => now >= day.rise && now < day.set)
    : snapshot.isDay;
}
export function temperatureLabel(snapshot: WeatherSnapshot, unit: WeatherSettings['unit']) {
  return `${Math.round(unit === 'fahrenheit' ? (snapshot.temperatureC * 9) / 5 + 32 : snapshot.temperatureC)}°${unit === 'fahrenheit' ? 'F' : 'C'}`;
}
