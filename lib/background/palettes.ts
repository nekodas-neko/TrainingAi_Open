export interface PaletteAnchor {
  skyTop: readonly [number, number, number]
  skyBottom: readonly [number, number, number]
  celestialColor: readonly [number, number, number]
  celestialGlow: readonly [number, number, number]
  starOpacity: number
}

export const PALETTES = {
  deepNight: {
    skyTop: [5, 8, 24],
    skyBottom: [16, 22, 48],
    celestialColor: [232, 240, 255],
    celestialGlow: [170, 195, 255],
    starOpacity: 1,
  },
  dawn: {
    skyTop: [50, 40, 90],
    skyBottom: [255, 145, 90],
    celestialColor: [255, 214, 170],
    celestialGlow: [255, 180, 120],
    starOpacity: 0,
  },
  day: {
    skyTop: [70, 140, 230],
    skyBottom: [180, 220, 255],
    celestialColor: [255, 247, 214],
    celestialGlow: [255, 240, 200],
    starOpacity: 0,
  },
  dusk: {
    skyTop: [55, 25, 75],
    skyBottom: [255, 110, 120],
    celestialColor: [255, 200, 150],
    celestialGlow: [255, 150, 130],
    starOpacity: 0,
  },
} as const satisfies Record<'deepNight' | 'dawn' | 'day' | 'dusk', PaletteAnchor>
