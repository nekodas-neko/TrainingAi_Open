'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useBackgroundSettingsStore } from '@/lib/stores/background-settings-store'
import { pathnameToSection, pathnameToPaletteKey } from '@/lib/background/pathname-routing'
import type { ScreenPaletteKey } from '@/lib/background/screen-palettes'

/**
 * The palette a `surface="page"` sheet should paint, or null when it should stay opaque (BF-75).
 *
 * **This mirrors `DynamicBackground`'s own activation test on purpose, and the mirroring is the
 * point.** A sheet that paints the nutrition gradient while the wallpaper behind it is switched off
 * would be a coloured panel floating over a plain page — worse than the opaque sheet it replaced.
 * So the same three conditions decide both: the wallpaper is enabled globally, this screen's section
 * is enabled, and the route has a static palette rather than the time-of-day sky.
 *
 * **The store ships `enabled: false`**, so the honest default is null and every sheet stays exactly
 * as it is until the owner turns wallpapers on. That is also why nothing here can be judged from a
 * screenshot in this sandbox: with the feature off there is no wallpaper to match.
 *
 * **Mounted-gated, and it is not the usual hydration ritual.** `useBackgroundSettingsStore` is
 * persisted, so its first render returns the store's defaults rather than the user's choice.
 * Painting from that would flash the wrong surface on a sheet that opens during rehydration.
 * Returning null until mounted resolves to "no change", which is the safe direction.
 *
 * Returns the sky-scene routes null as well: they have no flat gradient to borrow, and a sheet
 * cannot reproduce a sky that moves with the time of day.
 */
export function useScreenSurfacePalette(): ScreenPaletteKey | null {
  const [mounted, setMounted] = useState(false)
  const enabled = useBackgroundSettingsStore(s => s.enabled)
  const sections = useBackgroundSettingsStore(s => s.sections)
  const pathname = usePathname()

  useEffect(() => { setMounted(true) }, [])

  if (!mounted || !enabled) return null
  const section = pathnameToSection(pathname)
  if (section === null || !sections[section]) return null
  return pathnameToPaletteKey(pathname)
}
