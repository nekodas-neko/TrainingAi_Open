## 2026-07-29 — Animations kept running in the four tabs nobody was looking at

Follow-up to #909. The owner re-profiled the S25 **with the dynamic wallpaper disabled** — the exact
thing #909 fixed — and the profile still showed:

| Cost | Share of main thread |
|---|---|
| **Recalculate style** (self) | **21.9%** |
| **Event: animationiteration** | **21.3%** |

and the Animations track still a solid bar across the whole recording. So the wallpaper was real, but
it was not the only source.

### Cause

`TabShell` (`components/shell/tab-shell.tsx`) mounts all five tabs and hides the inactive four with
`invisible` + `content-visibility: hidden` — deliberately, so scroll position and component state
survive a tab switch. Neither of those stops CSS animations. `content-visibility: hidden` skips
*rendering* the subtree; the animation timeline keeps advancing and `animationiteration` keeps firing
on every cycle.

What is looping in there: **49 components use `animate-pulse` and 46 use `animate-spin`** — both
`infinite` in Tailwind — and Home renders `<Meteors number={10} />`, which is not part of
`DynamicBackground` and so was untouched by #909. Every skeleton on every tab you are not looking at
keeps shimmering forever.

### Change

Two lines of intent:

- `tab-shell.tsx` adds a `tab-panel-idle` class to inactive panels.
- `globals.css` pauses every animation inside one:

```css
.tab-panel-idle,
.tab-panel-idle * {
  animation-play-state: paused !important;
}
```

`animation-play-state` freezes the timeline rather than resetting it, so a tab resumes mid-cycle
instead of restarting — nothing to see, since the panel was invisible throughout.

### Verification

`pnpm tsc --noEmit` clean, `pnpm lint` 0 errors (119 pre-existing warnings).

Browser-verified in Chromium against the running dev server. The probe counted **11 infinitely-
animating elements on Home alone** (meteor particles), then read `animation-play-state` on one across
a tab switch:

```
animation-name   : meteor
play-state active: running   (expect running)
play-state idle  : paused    (expect paused)
play-state back  : running   (expect running)
```

**Not verified on device.** The 21.9% / 21.3% numbers came from the owner's S25 profile; whether this
change moves them is the owner's re-profile to make. The count of looping elements also grows with
how many tabs have been visited — 11 is Home only, at rest.

### Two findings from the same profile, not acted on here

Recorded so they are not lost (per the no-orphaned-findings rule):

- **`win.androidBridge.onmessage` ~16–18% of main-thread time.** That is the Capacitor JS↔native
  bridge — every local-SQLite call crosses it. #906 already cut `getWorkoutHistory` from ~121 queries
  to 3; this suggests other call sites are still chatty. Needs a device profile that attributes
  bridge time to specific callers before guessing.
- **CLS 0.14.** Above the 0.1 "good" threshold. Not investigated; likely cache-seeded cards resizing
  when the network response replaces the seed.
