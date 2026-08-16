// Static per-screen wallpaper scenes (Batch L chunk 2) — distinct from the
// shared time-of-day/weather sky system `PALETTES` uses for Home/Workout.
//
// The gradients themselves live in `app/globals.css` as `--screen-palette-*`, defined once under
// `:root` (light) and once under `.dark`. They are NOT a JS table any more: reading them in JS
// meant branching on a mounted-gated `resolvedTheme`, which returns 'dark' until the effect runs
// and flashed a full-screen dark wallpaper at every light-theme launch. Letting the CSS cascade
// pick the variant removes the branch entirely — next-themes stamps `.dark` on <html> before
// hydration, so the right scene is correct on the very first paint.

export type ScreenPaletteKey =
  | 'health'
  | 'nutrition'
  | 'more'
  | 'stats'
  | 'workoutSelect'
  | 'sessionExplain'

/** camelCase key → the kebab-case CSS custom property defined in globals.css. */
export function screenPaletteVar(key: ScreenPaletteKey): string {
  return `var(--screen-palette-${key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()})`
}
