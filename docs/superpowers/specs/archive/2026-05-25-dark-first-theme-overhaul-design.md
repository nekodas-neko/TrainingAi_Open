# Dark-First Theme Overhaul — Design Spec
**Date:** 2026-05-25
**Status:** Approved

---

## Goal

Transform the app's visual system from a muted light/dark toggle into a dark-first, AMOLED-optimised design with electric accent colours, gradient-tinted cards, and glow effects. Both dark and light modes are retained. The existing colour picker (6 themes, localStorage-persisted) stays in place — its swatches and derived variables are upgraded.

---

## Approach

**CSS variable cascade** — extend the existing `--color-brand` / `data-brand` attribute pattern with three new derived variables per theme. No new React state, no new providers, no Tailwind config changes. All theme data lives in `lib/brand-themes.ts`; all surface colours live in `app/globals.css`.

---

## Section 1: Surface Colour System

### Dark mode (`:root.dark`)

| Token | Current | Proposed |
|---|---|---|
| `--background` | `oklch(0.145 0 0)` | `oklch(0.05 0 0)` — near-black (`#0d0d0d`) |
| `--card` | `oklch(0.205 0 0)` | `oklch(0.09 0 0)` — deep dark gray |
| `--muted` | `oklch(0.269 0 0)` | `oklch(0.13 0 0)` |
| `--border` | `oklch(1 0 0 / 10%)` | `oklch(1 0 0 / 7%)` — slightly subtler |

### Light mode (`:root`) — minimal change
Light mode keeps white/light-gray backgrounds. Brand tints apply at low opacity so cards feel connected to the chosen theme without looking garish.

### Three new CSS variables (added to every theme block)

```css
--brand-card-bg      /* dark: ~7% brand opacity; light: ~4% */
--brand-card-border  /* dark: ~18% brand opacity; light: ~10% */
--brand-glow         /* dark: ~25% brand opacity — for rings/shadows */
```

These are set in `app/globals.css` inside `:root` (green default) and each `[data-brand="x"]` block, with separate dark-mode overrides inside `.dark [data-brand="x"]`.

---

## Section 2: Brand Theme Colour Values

Six themes. Hex values pushed toward electric/neon for AMOLED impact.

| Key | Current hex | Proposed hex | Character |
|---|---|---|---|
| `green` | `#22c55e` | `#00ff87` | Neon performance green |
| `blue` | `#3b82f6` | `#00d4ff` | Electric cyan-blue |
| `purple` | `#a855f7` | `#bf5fff` | Vivid purple |
| `orange` | `#f97316` | `#ff6a1a` | Hot orange |
| `pink` | `#ec4899` | `#ff3d9a` | Vivid pink |
| `cyan` | `#06b6d4` | `#00e5ff` | True electric cyan |

`lib/brand-themes.ts` gains six new fields per theme object:
```ts
cardBgDark:     string  // e.g. "rgba(0,255,135,0.07)"
cardBorderDark: string  // e.g. "rgba(0,255,135,0.18)"
glowDark:       string  // e.g. "rgba(0,255,135,0.25)"
cardBgLight:    string  // e.g. "rgba(0,255,135,0.04)"
cardBorderLight:string  // e.g. "rgba(0,255,135,0.10)"
glowLight:      string  // e.g. "rgba(0,255,135,0.12)"
```

`applyBrandTheme()` in `theme-color-picker.tsx` already writes `data-brand` to `document.documentElement` — no change needed there. The CSS variables are picked up automatically.

---

## Section 3: Component Changes

### `app/globals.css`
- Push dark mode background/surface tokens to near-black values above.
- Add `--brand-card-bg`, `--brand-card-border`, `--brand-glow` to `:root` (green defaults) and every `[data-brand]` / `.dark [data-brand]` block.

### `lib/brand-themes.ts`
- Update `hex` and `color` fields to electric values.
- Add `cardBgDark`, `cardBorderDark`, `glowDark`, `cardBgLight`, `cardBorderLight` per theme.

### `app/layout.tsx`
- Add an inline `<script>` in `<head>` that reads `ta_brand_theme` from localStorage and sets `data-brand` before first paint. Prevents flash of wrong colour on hard reload.
- Pattern: `document.documentElement.dataset.brand = localStorage.getItem('ta_brand_theme') || ''`

### `app/session-select/session-select-content.tsx`
- Active carousel card: replace hardcoded gradient classes with `style={{ background: 'var(--brand-card-bg)', borderColor: 'var(--brand-card-border)' }}`.
- Stat chips (weight, steps, streak): same `--brand-card-bg` / `--brand-card-border` treatment.

### `components/workout/active-workout-screen.tsx`
- 1RM badge: background `var(--brand-card-bg)`, border `var(--brand-card-border)`, text `var(--color-brand)`.

### `components/workout/timer-ring.tsx`
- Timer ring SVG track: stroke colour `var(--brand-card-bg)` (replaces hardcoded dark green/blue).
- Timer ring glow layer: stroke `var(--color-brand)` with blur filter — make it variable-driven.

### `components/workout/done-screen.tsx`
- Checkmark circle: background `var(--brand-card-bg)`, border `1px solid var(--brand-card-border)`.
- Outer halo ring: `box-shadow: 0 0 24px var(--brand-glow)`.

---

## Section 4: What Does NOT Change

- Component shapes, border-radius, spacing — untouched.
- Typography scale — untouched.
- Pre-workout exercise list — inherits darker background automatically; no component edits needed.
- Exercise summary screen — same.
- Config screen — same.
- Chat screen — same.
- The colour picker UI itself — same 6 swatches, same location in settings sheet, same localStorage key.

---

## Files Touched

| File | Change |
|---|---|
| `app/globals.css` | Dark surface tokens + 3 new CSS vars per theme block |
| `lib/brand-themes.ts` | Updated hex values + 5 new fields per theme |
| `app/layout.tsx` | Inline script to restore brand theme before paint |
| `app/session-select/session-select-content.tsx` | Active card + stat chips use brand vars |
| `components/workout/active-workout-screen.tsx` | 1RM badge uses brand vars |
| `components/workout/timer-ring.tsx` | Timer ring track + glow use brand vars |
| `components/workout/done-screen.tsx` | Checkmark circle + glow use brand vars |

**Total: 7 files.**

---

## Success Criteria

- Dark mode background is visibly near-black (not gray) on S25 Ultra AMOLED.
- Switching themes in settings instantly recolours the active carousel card, timer ring, and done-screen glow — no page reload.
- Light mode still looks clean and usable — tints are subtle, not overpowering.
- No flash of wrong brand colour on hard reload.
- Build passes with no TypeScript errors.
