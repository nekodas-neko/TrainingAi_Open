import { describe, it, expect } from 'vitest'
import { pathnameToSection, pathnameToPaletteKey } from '../pathname-routing'

/**
 * BF-75 pulled these two out of `dynamic-background.tsx`, where they were private and therefore
 * untestable — a `usePathname` hook and a weather fetch stood between them and any assertion.
 *
 * **The reason they had to move is the reason they need testing:** a sheet that paints its screen's
 * palette and the wallpaper behind it now ask the same function which palette that is. If they ever
 * disagreed the failure would be a sheet in one colour over a page in another, which no type catches
 * and no test elsewhere looks at.
 */
describe('background pathname routing', () => {
  it('routes the nutrition tab to the nutrition palette and section', () => {
    expect(pathnameToSection('/nutrition')).toBe('nutrition')
    expect(pathnameToPaletteKey('/nutrition')).toBe('nutrition')
    // Sub-routes too — a sheet opened from a nested nutrition screen must match the same wallpaper.
    expect(pathnameToPaletteKey('/nutrition/plan')).toBe('nutrition')
  })

  it('gives the four health detail pages no wallpaper at all', () => {
    // They paint their own opaque DetailHero gradient, so a layer underneath is invisible work — and
    // a sheet borrowing a palette here would clash with art the page already carries.
    for (const p of ['/health/sleep', '/health/readiness', '/health/activity', '/health/heart-rate']) {
      expect(pathnameToSection(p), p).toBeNull()
      expect(pathnameToPaletteKey(p), p).toBeNull()
    }
    // But the health tab itself does have one.
    expect(pathnameToSection('/health')).toBe('health')
    expect(pathnameToPaletteKey('/health')).toBe('health')
  })

  it('keeps the toggle bucket coarser than the palette', () => {
    // `stats` is its own scene gated off the HOME switch, and `workout-select` its own scene gated
    // off the WORKOUT switch. Collapsing the two functions into one would take that away, and the
    // owner would lose the ability to turn off a tab's wallpaper without losing the others.
    expect(pathnameToSection('/stats')).toBe('home')
    expect(pathnameToPaletteKey('/stats')).toBe('stats')
    expect(pathnameToSection('/workout-select')).toBe('workout')
    expect(pathnameToPaletteKey('/workout-select')).toBe('workoutSelect')
  })

  it('leaves the sky-scene routes without a flat palette', () => {
    // Home and the in-progress workout screen use the time-of-day/weather sky, which a sheet cannot
    // reproduce — so a `surface="page"` sheet on either stays opaque rather than guessing a colour.
    expect(pathnameToSection('/')).toBe('home')
    expect(pathnameToPaletteKey('/')).toBeNull()
    expect(pathnameToSection('/workout')).toBe('workout')
    expect(pathnameToPaletteKey('/workout')).toBeNull()
  })

  it('treats /profile as part of More, on both axes', () => {
    expect(pathnameToSection('/profile')).toBe('more')
    expect(pathnameToPaletteKey('/profile')).toBe('more')
  })
})
