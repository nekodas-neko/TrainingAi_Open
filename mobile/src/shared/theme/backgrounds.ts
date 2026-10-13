import { PALETTES, type SkyAnchors } from '@trainingai/shared/background/palettes';
export type StaticScene = 'health' | 'nutrition' | 'more' | 'sessionExplain';
export type ScenePalette = {
  stops: [string, string, string];
  glow: [string, string];
  glowAlpha: [number, number];
  origin: [number, number];
};
export type BackgroundTheme = {
  sky: SkyAnchors;
  scenes: Record<StaticScene, ScenePalette>;
  scrim: { color: string; top: number; bottom: number };
  particles: {
    color: string;
    cloud: number;
    rain: number;
    snow: number;
    fog: number;
    flash: number;
  };
};
export function createBackgroundTheme(mode: 'light' | 'dark'): BackgroundTheme {
  const dark = mode === 'dark';
  return {
    sky: PALETTES,
    scenes: {
      health: {
        stops: dark ? ['#071119', '#0a1a1f', '#05090c'] : ['#eaf6fb', '#f2fbf5', '#ffffff'],
        glow: ['#38bdf8', '#22c55e'],
        glowAlpha: dark ? [0.35, 0.22] : [0.3, 0.18],
        origin: [0.2, -0.1],
      },
      nutrition: {
        stops: dark ? ['#170f08', '#1a130a', '#0b0705'] : ['#fff6ec', '#fffaf0', '#ffffff'],
        glow: ['#f97316', '#eab308'],
        glowAlpha: dark ? [0.3, 0.2] : [0.25, 0.18],
        origin: [0.15, 0],
      },
      more: {
        stops: dark ? ['#0d0a17', '#100c1c', '#06040a'] : ['#f5f2ff', '#f8f6ff', '#ffffff'],
        glow: ['#8b5cf6', '#6366f1'],
        glowAlpha: dark ? [0.3, 0.2] : [0.22, 0.15],
        origin: [0.85, -0.1],
      },
      sessionExplain: {
        stops: dark ? ['#171008', '#1a130d', '#0a0705'] : ['#fef7ea', '#faf7ff', '#ffffff'],
        glow: ['#f59e0b', '#8b5cf6'],
        glowAlpha: dark ? [0.3, 0.2] : [0.22, 0.16],
        origin: [0.2, -0.1],
      },
    },
    scrim: dark
      ? { color: '#000000', top: 0.5, bottom: 0.7 }
      : { color: '#ffffff', top: 0.62, bottom: 0.76 },
    particles: { color: '#ffffff', cloud: 0.4, rain: 0.4, snow: 0.75, fog: 0.3, flash: 0.08 },
  };
}
