# Dynamic Wallpaper Backgrounds — Design Spec
**Date:** 2026-06-11
**Status:** Approved

---

## Goal

Add an optional dynamic background to the app — an abstract/atmospheric scene (sky gradient, sun/moon, weather effects) that continuously reflects the current time of day and local weather conditions, similar in spirit to the Samsung Weather app's illustrated scenes but built from pure CSS to fit this app's flat, AMOLED dark-first design language.

---

## Section 1: Rendering Architecture

A `<DynamicBackground>` component mounts once in `app/layout.tsx`, fixed behind all page content (`position: fixed; inset: 0; z-index: -1; pointer-events: none`). The main content wrapper sits at `z-index: 1` (existing fixed elements like the bottom nav at `z-50` remain unaffected).

Built entirely from **stacked CSS `<div>` layers — no SVG, no canvas**:

1. **Sky layer** — a `linear-gradient` whose colour stops are CSS custom properties, recalculated every ~60s from a continuous day-phase interpolation (Section 2). A CSS `filter` (saturate/brightness/hue-rotate) is applied per weather condition to grey out / darken the sky without recomputing colours.
2. **Celestial layer** — sun or moon: a soft `radial-gradient` disc whose position (`--celestial-x`, `--celestial-y`) is updated by the same day-phase calculation, tracing an arc across the sky.
3. **Weather overlay** — condition-specific elements (clouds, rain, snow, fog, stars, lightning flashes) — see Section 2.
4. **Scrim layer** — a dark gradient overlay on top of everything for content readability.

### Why pure CSS over alternatives

- **Canvas-based rendering**: more flexible particle effects, but requires a continuous `requestAnimationFrame` loop — higher battery cost, and another thing to pause/resume on app backgrounding.
- **Hybrid (CSS sky + canvas particles)**: nicer rain/snow visuals, but more complexity than the "subtle ambient" treatment calls for.
- **Pure CSS (chosen)**: matches this codebase's documented fix for the Samsung WebView compositor bug (`projectOverview.md` — "Fix A": remove SVG, use CSS gradients/masks). Since this background sits behind *every* card in the app, it is the highest-risk place to introduce SVG. Zero SVG = zero risk. All animations use only `transform`/`opacity`/`filter` (GPU-composited), keep particle counts modest (~20-40 elements), and respect `prefers-reduced-motion` (animations are disabled/frozen, leaving a static gradient scene). The background pauses its recompute loop on `document.visibilitychange` to avoid battery drain while backgrounded.

---

## Section 2: Visual System

### Day-phase palette (continuous)

A small ordered set of palette "anchors" relative to today's sunrise/sunset times, each defining `{ skyTop, skyBottom, celestialColor, celestialGlow, starOpacity }`:

| Anchor | Timing | Feel |
|---|---|---|
| Deep night | Solar midnight (midpoint of the night) | Near-black navy, stars at full opacity |
| Dawn | Sunrise − 60min → sunrise | Indigo → purple → warm orange near horizon |
| Day | Sunrise + 90min → sunset − 90min (solar noon centred) | Blue sky, brighter near horizon, stars off |
| Dusk | Sunset → sunset + 60min | Deep purple → magenta → coral near horizon |
| → wraps back to Deep night | | |

Every ~60s, JS finds the current position between the two surrounding anchors and linearly interpolates all values (RGB interpolation is sufficient for this style), writing them to CSS custom properties on the background root. Anchors not listed (sunrise→+90min, etc.) are themselves interpolated transition zones between adjacent anchors — there is no discrete jump anywhere in the cycle.

### Celestial body (sun/moon)

A `radial-gradient` disc (warm `#fff7d6`-style glow for the sun, cool pale `#e8f0ff`-style glow for the moon) positioned via `--celestial-x`/`--celestial-y`. During the day arc, it moves left→right while tracing a parabolic arc (low near sunrise/sunset, peak near solar noon); during the night it does the same for the moon. Hidden or heavily dimmed under cloud-heavy conditions (cloudy/rain/snow/fog/thunderstorm).

### Weather conditions and overlays

Each `WeatherCondition` applies (a) a CSS `filter` to the sky layer and (b) its own effect layer, composited on top of the time-of-day sky — avoiding a full time × weather palette matrix:

| Condition | Sky filter | Effect layer |
|---|---|---|
| Clear | none | Stars (night only) — ~15-20 dots, `twinkle` keyframe, staggered delay/duration |
| Cloudy | `saturate(0.85) brightness(0.95)` | 3-5 soft blurred cloud blobs (`radial-gradient` + `blur`), each drifting horizontally at a different speed (`cloud-drift` keyframe, 120-240s) |
| Rain | `saturate(0.6) brightness(0.75) hue-rotate(-5deg)` | Denser cloud layer + ~30 thin gradient streaks falling diagonally (`rain-fall` keyframe, 0.5-1s, staggered delays) |
| Fog | `saturate(0.4) brightness(0.9)` | 1-2 large translucent horizontal gradient bands in the lower viewport, slow alternating drift (`fog-drift` keyframe) — no blur filter, to avoid GPU cost |
| Snow | `saturate(0.7) brightness(1.05)` | Cloud layer (lighter) + ~25 small circular particles falling with horizontal sway (`snow-fall` keyframe, 8-15s) |
| Thunderstorm | `saturate(0.5) brightness(0.6)` | Heavier rain layer + dark storm clouds + 2-3 full-viewport white flash overlays, each with a long (`10-18s`) `lightning-flash` keyframe with brief opacity spikes, staggered for an irregular pattern |

### Scrim & accent

A dark gradient scrim sits above all background layers for readability (lighter in light mode, heavier in dark mode — exact values tuned during implementation). Sky/weather colours stay independent of the user's chosen brand accent colour. The weather chip (Section 4) may use `var(--color-brand)` for its icon to tie back into the existing theme system.

---

## Section 3: Data Layer (Weather + Location)

### Weather API — Open-Meteo

Free, no API key, CORS-enabled — fetched directly from the client:

```
https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code&daily=sunrise,sunset&timezone=auto
```

Returns current temperature, a WMO weather code, and today's sunrise/sunset. WMO codes map to the 6 conditions above:

| WMO codes | Condition |
|---|---|
| 0 | Clear |
| 1, 2, 3 | Cloudy |
| 45, 48 | Fog |
| 51-67, 80-82 | Rain |
| 71-77, 85-86 | Snow |
| 95-99 | Thunderstorm |

### Location resolution order

1. **Device location** — browser `navigator.geolocation` on web/PWA. On the APK, check whether the in-progress GPS/activity-tracking work has already added a `@capacitor/geolocation` wrapper and `ACCESS_COARSE_LOCATION` manifest entry; reuse it if so, otherwise add it.
2. **Manual fallback** — a location set once in Profile → Appearance (search input, geocoded via Open-Meteo's free geocoding API), stored as `{ lat, lon, name }` in localStorage.
3. **Default** — if neither is available, render the time-of-day sky only, assume "Clear", and hide the weather chip.

### Caching

- Weather snapshot cached in localStorage (`ta_weather_cache`) with a fetch timestamp; refetched if more than 30 minutes stale.
- Device location is requested once per app session (not on every navigation) to limit GPS/battery use and permission prompts.
- On load, the cached snapshot renders immediately; a background refresh runs if stale.

### Privacy

Location is used client-side only for the weather lookup — never sent to or stored on the TrainingAI server. No DB changes needed.

---

## Section 4: Settings UI & Weather Chip

### Settings location

Extend the existing "Theme & Appearance" expandable section in `components/more/profile-tab.tsx` (where `ThemeColorPicker` already lives) with a new "Dynamic Background" sub-section:

- **Master toggle** — `Switch` (Radix, already installed): "Dynamic background"
- **Per-section toggles** — shown when the master toggle is on; one switch per bottom-nav tab: **Home, Health, Workout, Nutrition, More** (matching `components/shell/bottom-nav.tsx`)
- **Location row** — shows current source ("Using device location" / "Manual: Mitchelton, QLD" / "Unavailable"), with an edit action opening a search input that geocodes via Open-Meteo's geocoding API and saves a manual override

### State management

A small Zustand store (matching the existing `workout-store` pattern), persisted to localStorage:

```ts
{
  enabled: boolean,
  sections: { home: boolean, health: boolean, workout: boolean, nutrition: boolean, more: boolean },
  manualLocation: { lat: number, lon: number, name: string } | null
}
```

`<DynamicBackground>` reads this store plus `usePathname()`. If the master toggle is off, or the current route's section is toggled off, it renders nothing (or fades out).

### Weather chip

A small `components/weather-chip.tsx` pill (icon + temperature, e.g. "☁️ 16°") placed in the home screen header near the greeting/location text in `app/session-select/session-select-content.tsx`. The icon (Sun/Moon/Cloud/CloudRain/CloudFog/CloudSnow/CloudLightning from lucide-react) is chosen from the current weather condition plus day/night state from the day-phase calculation. It reuses the `useWeather()` hook — no extra API call. Non-interactive for v1.

---

## Section 5: File / Component Breakdown

### New files

```
components/dynamic-background/
  dynamic-background.tsx   — top-level component, mounted in layout; orchestrates layers + visibility logic
  sky-layer.tsx             — sky gradient div + weather filter class
  celestial-layer.tsx       — sun/moon div
  weather-overlay.tsx       — switches on condition; renders cloud/rain/snow/fog/stars/lightning sub-layers
  particles.tsx             — generates rain/snow/star particle arrays and renders them
  scrim-layer.tsx           — dark gradient overlay

lib/background/
  day-phase.ts              — palette anchors + interpolation logic
  palettes.ts               — anchor palette definitions
  weather-filters.ts        — CSS filter per WeatherCondition

lib/weather/
  types.ts                  — WeatherCondition, WeatherSnapshot
  open-meteo.ts             — fetch + WMO code mapping
  geocode.ts                — manual location search
  use-weather.ts            — hook: location resolution + cache + fetch

lib/stores/background-settings-store.ts  — zustand persisted store (enabled, sections, manualLocation)

components/weather-chip.tsx — home screen weather indicator

lib/location.ts             — geolocation wrapper (web + Capacitor) — reuse from GPS-tracking branch if it lands first
```

### Edited files

- `app/layout.tsx` — mount `<DynamicBackground>`
- `app/globals.css` — new keyframes: `cloud-drift`, `rain-fall`, `snow-fall`, `fog-drift`, `twinkle`, `lightning-flash`
- `components/more/profile-tab.tsx` — add the Dynamic Background settings sub-section
- `app/session-select/session-select-content.tsx` — add `<WeatherChip>`
- `package.json` / `android/app/src/main/AndroidManifest.xml` — add `@capacitor/geolocation` + location permission, only if not already present from the GPS-tracking work

---

## Out of Scope / Future Enhancements

- Hourly/multi-day forecast-driven previews
- User-customizable colour palettes per scene
- Additional weather conditions (windy, hail)
- Tap-to-expand weather chip with forecast detail
- Parallax/scroll-based background movement
