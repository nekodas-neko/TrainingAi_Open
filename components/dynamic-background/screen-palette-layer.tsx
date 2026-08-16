'use client'

import { screenPaletteVar, type ScreenPaletteKey } from '@/lib/background/screen-palettes'
import { ScrimLayer } from './scrim-layer'

// Static, low-motion themed scene for screens with their own per-screen
// palette (chunk 2) rather than the shared time-of-day/weather sky system.
//
// Reads a CSS variable rather than branching on useHeroColorScheme(): that hook returns 'dark'
// until its effect runs, so this full-screen wallpaper flashed dark on every launch and every
// hard navigation for light-theme users, across all 7 screens. The cascade resolves the variable
// on the first paint because next-themes stamps `.dark` on <html> before React hydrates — the
// same fix already applied to usePageGradient (see detail-hero.tsx), carried to the larger surface.
export function ScreenPaletteLayer({ section }: { section: ScreenPaletteKey }) {
  return (
    <div className="absolute inset-0" style={{ background: screenPaletteVar(section) }}>
      <ScrimLayer />
    </div>
  )
}
