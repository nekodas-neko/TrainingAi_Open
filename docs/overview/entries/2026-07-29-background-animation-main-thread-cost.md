## 2026-07-29 — The animated wallpaper was ~a third of main-thread time

Owner, after the transition and query fixes shipped: *"still not the swift feel I'm after."* A device
**Performance** profile finally named the cause. Every prior measurement had been the Network panel,
which was exhausted — API calls return in 1–25 ms.

### What the profile showed

26.44 s recording on the S25, Health → Sleep:

| Cost | Time | Share of main thread |
|---|---|---|
| **Recalculate style** (self) | **1,055 ms** | **19.8%** |
| **Event: animationiteration** | **852 ms** | **16.0%** |
| Scripting (total) | 3,522 ms | — |
| Rendering (total) | 1,372 ms | — |

The **Animations track was a solid bar across the entire recording** — animation running continuously,
whether or not the user was doing anything.

`animationiteration` fires at the end of each cycle of an infinitely-repeating CSS animation. 852 ms
of it, with **no `onAnimationIteration` handler anywhere in the codebase**, is the browser dispatching
events nobody listens for.

### Cause

`<DynamicBackground />` is mounted in `app/layout.tsx:114` — the root layout — so its particle
animations run on **every screen for as long as the app is open**. Up to ~60 looping elements at once
(18 stars, 10–30 meteors, up to 36 rain streaks, snow, clouds, fog, lightning).

Most of the keyframes animate `transform`/`opacity` and are compositable. **`twinkle` was not:**

```css
@keyframes twinkle {
  0%, 100% { opacity: var(--bg-star-opacity, 1); }
  50%      { opacity: calc(var(--bg-star-opacity, 1) * 0.3); }
}
```

An opacity animation whose value derives from a **CSS custom property cannot be handed to the
compositor** — the browser must recalculate style on the main thread every frame, per star.
`--bg-star-opacity` is set on the container (`dynamic-background.tsx:142`) and the star element also
carried `opacity: var(--bg-star-opacity)` inline, which is why the keyframes had to re-read it.

### Change

**1. `twinkle` is now compositable.** Keyframes animate a plain `1 → 0.3`. The phase opacity moved to
a static wrapper `<div>` in `particles.tsx`, with the animating star as its child. Wrapper opacity
multiplies the animated child opacity, so **the rendered result is identical** — it just composites.

**2. Decorative loops pause while the app is backgrounded.** `CapacitorNativeInit` sets
`data-app-hidden` on `<html>` from `visibilitychange`; `globals.css` sets
`animation-play-state: paused` on the seven decorative classes. No visible change while the app is
open; the work stops entirely when it isn't.

### Tests

`pnpm tsc --noEmit` clean, `pnpm lint` 0 errors.

Browser-verified in Chromium: the meteor loop reports `running` normally, `paused` once
`data-app-hidden="true"` is set, and `running` again on resume; and a stylesheet walk confirms the
`twinkle` keyframes no longer contain `var(`.

**Star nesting was NOT verified at runtime** — `<Stars />` only renders at night
(`weather-overlay.tsx:13`), and the sandbox run was during the day, so zero stars existed to inspect.
The structure is typechecked and the arithmetic (wrapper × child opacity) is straightforward, but the
visual equivalence is unconfirmed. **Worth a glance at the night background after deploy.**

### Two prior hypotheses this replaces, both wrong

Recorded so they are not re-derived:

- **chart.js was never the problem.** It sits in its own 157 kB chunk that is not in any route's first
  load; webpack had already split it. Four lazy-import conversions produced **0 kB** of savings on
  every route and were discarded rather than shipped as a no-op.
- **Framer Motion is 128 kB in every route's first load** (fingerprinted: `motionValue`, `layoutId`,
  `spring`), imported by `app/layout.tsx` and by `swipe-carousel` / `pull-to-sync` / `readiness-card` /
  `body-battery-card`. Real, but a project — replacing it means hand-rolling gesture handling, which
  `CLAUDE.md` explicitly warns against. Not attempted here, and **not** the thing the profile pointed at.

The pattern across this whole investigation: every device measurement the owner took found the real
cause; every static-analysis inference made in the sandbox was wrong. Measure first.
