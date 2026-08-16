## 2026-08-08 — `feat/completed-stamp-muscle-heatmap` — Q-97-followup, and a hue bug it exposed across 26 sites

Closes **Q-97-followup**. Q-97 shipped a full-width "Completed Today" banner (#1103); the owner saw
it live and asked to go further. Confirmed with the owner before building: the stamp replaces the
banner, and Front/Back comes out everywhere.

### The stamp

`components/workout/completed-stamp.tsx` — rotated −12°, double rule, letterspaced bold caps, drawn
in CSS from `--accent-green` rather than a licensed raster so it follows the theme *and* the
brand-colour picker. Absolutely positioned over the `MuscleHeatmap` on the workout-select card, with
the old banner replaced by an `sr-only` line (a decorative graphic gives a screen reader nothing).
Not colour-only state: the stamp's own word is the label.

### Front/Back labels, with the sibling check the entry asked for

`MuscleHeatmap` has **10 call sites**. Four rendered the labels (`workout-select-content`,
`exercise-history-sheet`, `injury-card`, `active-workout-screen`); six already passed `compact`,
which hid them. All four are the same case — and `exercise-history-sheet` renders the pair at
`w-16`, i.e. 64 px wide, where "FRONT" was unreadable regardless. Removed for all, kept as `sr-only`.
`compact` still drives grid spacing and the injured legend, so the prop stays.

### The bug the stamp exposed: `color-mix(in oklch, …)` against an achromatic colour

The first build of the plate rendered **salmon pink** in light mode. Measured in Chromium rather than
reasoned about:

```
color-mix(in oklch, oklch(0.72 0.19 149) 18%, oklch(1 0 0))  ->  oklch(0.9496 0.0342 26.82)
                               ^ green, hue 149°                                    ^ hue 27° — PINK
color-mix(in oklab, oklch(0.72 0.19 149) 18%, oklch(1 0 0))  ->  oklab(0.9496 -0.029 0.018)  ✅ green
```

oklch is polar, so mixing interpolates the **hue angle**. White's chroma is 0 and its stored hue is
0; CSS Color 4 says such a hue is "powerless" and should be carried from the other colour, but
Chromium does not do that for `color-mix`. At 18% you land 18% of the way from 149° to 0°.

**26 shipped sites do exactly this** — `color-mix(in oklch, var(--color-brand) 15%, var(--color-muted))`
and friends across More, Profile, the trophy case, title picker, Oura section, goal spectrum, the
set cards and session-select. Every brand-green tint on those surfaces has been rendering the wrong
hue. It hid because the app was dark-only: against `--color-muted`'s near-black the same wrong hue
lands at very low lightness, where it reads as "dark grey" rather than "wrong colour".

All 26 switched to `in oklab` — same perceptual space, rectangular coordinates, no hue to
interpolate. **The 129 mixes against `transparent` are untouched and correct**: alpha compositing
preserves the hue, so they were never affected.

`scripts/check-color-mix-hue.js` is the ratchet, wired into the Custom Rules job. It parses each
`color-mix(` to its matching paren (so nested `var(…)` don't end it early) and flags only an
achromatic second colour. Verified it fails on a planted regression and passes clean.

### Verification

- `tsc --noEmit` clean · `eslint` 0 errors · full suite **411/411 files, 3249/3249 tests** · all nine
  custom-rule scripts pass (the new one included).
- **Rendered in both themes** at the S25 viewport via a temporary probe route (deleted before
  commit), because the stamp only appears when a session was trained today and the seeded local DB's
  last workout is 2026-08-02. Screenshots sent to the owner before merge, as agreed.

### Not exercised

No device run — CSS and markup only, no native, safe-area, gesture or notification path.

**The hue fix is verified by measurement plus the two rendered themes on the stamp, not by opening
all 26 surfaces.** The change is mechanical and identical at every site, and the check script proves
none was missed, but the other 25 were not visually re-checked. Anything that looked deliberately
salmon on those screens was this bug, and will now be green.
