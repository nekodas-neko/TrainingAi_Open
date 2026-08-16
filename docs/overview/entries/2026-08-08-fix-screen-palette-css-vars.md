## 2026-08-08 — the per-screen wallpaper stops flashing dark for light-theme users (Q-132 part 1, v1.270.16)

**Branch:** `fix/screen-palette-css-vars` · **Domain:** `app-shell`

Q-132 is a batch of independent theme/contrast fixes; the backlog entry suggests splitting it. This
is the first and highest-value piece. **The rest of Q-132 remains open** — the entry is annotated,
not removed.

### What was wrong

`ScreenPaletteLayer` painted an `absolute inset-0` full-screen wallpaper across **7 screens**
(health, nutrition, more, stats, overview, workout-select, session-explain) and chose between
`palette.light` and `palette.dark` with `useHeroColorScheme()` — a hook that returns `'dark'` until
its own `useEffect` has run. So the layer's first rendered frame was always the dark scene, even for
a light-theme user, on every launch and every hard navigation into those screens.

The codebase had already fixed and documented this exact class once. `detail-hero.tsx:46-47`
explains that `usePageGradient` was converted to a plain CSS variable *"so the page root paints
correctly on first paint with no mounted-gated read, unlike `useHeroColorScheme()`"*. The fix was
never carried to the larger surface.

### What shipped

The seven palettes moved from a JS table to `--screen-palette-*` custom properties in
`app/globals.css`, defined once under `:root` (light) and once under `.dark`. `ScreenPaletteLayer`
now sets `background: var(--screen-palette-<key>)` and has no theme branch at all. `next-themes`
stamps `.dark` on `<html>` synchronously before React hydrates, so the cascade resolves the right
scene on the first paint by construction.

`lib/background/screen-palettes.ts` keeps the `ScreenPaletteKey` union and gains a small
`screenPaletteVar()` helper that maps a camelCase key to its kebab-case variable; the gradient
strings themselves are gone from TS, so there is one copy of each, not two. The CSS values were
extracted mechanically from the old table rather than retyped.

### Worth knowing: this only ever affected users who turned the wallpaper on

`lib/stores/background-settings-store.ts` ships `enabled: false`. `DynamicBackground` returns null
unless the user has switched the dynamic background on in settings, so `ScreenPaletteLayer` never
mounts by default — the whole finding is scoped to opt-in users. The backlog entry does not mention
this, and it matters for judging the severity.

### Verification

- `tsc --noEmit` clean · `pnpm lint` 0 errors.
- Driven on `pnpm dev` at the S25 viewport with `theme=light` **and the background feature switched
  on**, on `/health`, `/nutrition`, `/more` and `/workout-select`. Every screen's computed
  `background-image` resolves to its **light** variant (alphas 0.30 / 0.25 / 0.22 — the dark
  variants are 0.35 / 0.30 / 0.30). Screenshots show the light wallpaper behind legible dark text.

### Not exercised

No device run — CSS variables and one component, no native, safe-area, gesture or notification path.

**The single dark frame itself was not caught.** The layer only mounts after `DynamicBackground`'s
own `mounted` gate, and the old wrong-palette render lasted one commit — too short for a Playwright
sample to land on reliably. What is verified is that the theme branch is gone from the component and
that the resolved palette is the light one on four screens. The three screens not visited (`stats`,
`overview`, `session-explain`) share the same component and variable lookup, but were not opened.
Dark mode was not re-checked after the change; the `.dark` block is a mechanical copy of the values
that were already shipping.
