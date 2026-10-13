import { computeDayPhase } from '@trainingai/shared/background/day-phase';
import type { SkyAnchors } from '@trainingai/shared/background/palettes';
import type { WeatherSettings, WeatherSnapshot } from './models.ts';
export type BackgroundSection = 'home' | 'health' | 'workout' | 'nutrition' | 'more';
export function backgroundScene(
  settings: WeatherSettings,
  section: BackgroundSection,
  detail: string | null,
  healthDetail: string | null,
) {
  if (!settings.backgroundEnabled || healthDetail) return null;
  const bucket =
    detail?.startsWith('health-') || detail === 'clinical'
      ? 'health'
      : detail?.startsWith('more-') ||
          [
            'settings',
            'profile-details',
            'profile-goals',
            'year-review',
            'friend-profile',
          ].includes(detail ?? '')
        ? 'more'
        : section;
  if (!settings.backgroundSections[bucket]) return null;
  if (detail === 'session-explain') return 'sessionExplain';
  return bucket === 'home' || bucket === 'workout' ? 'sky' : bucket;
}
export function backgroundPhase(
  snapshot: WeatherSnapshot | null,
  now: number,
  anchors: SkyAnchors,
) {
  const day = 86400000;
  const windows = snapshot?.daylight
    .filter((row) => row.set > row.rise)
    .map((row) => {
      const shift = Math.round((now - (row.rise + row.set) / 2) / day) * day;
      return { rise: row.rise + shift, set: row.set + shift, age: Math.abs(shift) };
    })
    .sort(
      (a, b) =>
        a.age - b.age ||
        Math.abs(now - (a.rise + a.set) / 2) - Math.abs(now - (b.rise + b.set) / 2),
    );
  const fallback = new Date(now);
  fallback.setHours(6, 0, 0, 0);
  const rise = windows?.[0]?.rise ?? fallback.getTime();
  const set = windows?.[0]?.set ?? rise + 12 * 3600000;
  return computeDayPhase(new Date(now), new Date(rise), new Date(set), anchors);
}
export function tintWeather(rgb: readonly number[], condition: WeatherSnapshot['condition']) {
  const adjustments = {
    clear: [1, 1],
    cloudy: [0.85, 0.95],
    rain: [0.6, 0.75],
    fog: [0.4, 0.9],
    snow: [0.7, 1.05],
    thunderstorm: [0.5, 0.6],
  };
  const [saturation, brightness] = adjustments[condition];
  const grey = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return `rgb(${rgb.map((channel) => Math.round(Math.max(0, Math.min(255, (grey + (channel - grey) * saturation) * brightness)))).join(',')})`;
}
export function backgroundParticles(count: number, width: number, height: number) {
  return Array.from({ length: count }, (_, index) => {
    const value = (seed: number) => {
      const n = Math.sin((index + 1) * seed) * 43758.5453;
      return n - Math.floor(n);
    };
    return {
      x: value(12.9898) * width,
      y: value(78.233) * height,
      size: 1 + value(34.123) * 3,
      opacity: 0.3 + value(15.77) * 0.7,
    };
  });
}
