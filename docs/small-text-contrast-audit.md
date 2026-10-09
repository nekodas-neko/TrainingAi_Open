# Small text at reduced opacity: contrast audit and floor (issue 2429)

Audit only. No class or colour on any screen changed. Fixing the visible sites needs a mockup and the
owner's yes first (CLAUDE.md), so they are listed here and in one follow-up issue.

## Premise, re-verified against `main`

`scripts/check-contrast.js` already fails any `text-(muted-/card-)foreground/NN` below 70 at every
size, so no `muted-foreground/30..60` text remains. The sub-12 px sites still dimmed are the shapes it
does not read: `opacity-NN` beside the colour, `text-brand/NN`, `text-background/NN`, `text-white/NN`,
and `text-muted-foreground/70` measured on `--muted` instead of `--card`. The issue's "26" is now
**48 dimmed sub-12 px sites, 35 of them under 4.5:1** (38 sit at 30-70% alpha).

## Method

`node scripts/check-small-text-contrast.js --report` regenerates the table below. It finds every
`className` value (or, outside one, string literal) with `text-[Npx]`, N under 12, and an effective
alpha under 100% (colour alpha times `opacity-NN`). Dark values come from the `.dark` block of
`app/globals.css`, the only theme the app ships. The text colour is alpha-blended over the surface in
gamma-encoded sRGB, as CSS does, then scored with WCAG relative luminance (shared maths in
`scripts/lib/contrast-math.js`, the same code `check-contrast.js` self-tests). Surfaces `--card`,
`--background` and `--muted` take the user's brand hue, so each is scored at its worst hue; `text-brand`
is scored at the worst of the eight dark brand presets. The verdict is the worst of the three surfaces,
because the script cannot tell which one sits behind a given site. 4.5:1 is the AA minimum for text
under 18 px.

Resolved dark tokens: `--background` oklch(0.145 0.020 hue), `--card` oklch(0.185 0.028 hue), `--muted`
oklch(0.225 0.034 hue), `--muted-foreground` oklch(0.75 0 0), `--foreground` oklch(0.985 0 0).

Not covered: a size in one constant and an opacity in another, the real surface behind each site
(sheets, chips, photo), and real rendering on the device. Rows marked `(inherited colour)` assume the
parent text is `--foreground`; if the parent is muted they are worse.

## What the numbers say

- `text-muted-foreground` is 8.3:1 on `--card` opaque. Its alpha floor for 4.5:1 is **/69 on card, /68
  on background, /72 on muted**. The existing `/70` floor passes on card (4.63) and background (4.78)
  and misses on muted (4.38). 26 of the 35 failures are this one case, a 0.12 miss.
- `opacity-60` on muted-foreground is 3.57-3.78:1 (3 sites). Real misses.
- `text-brand/70` and `/80` are 2.0-2.8:1 at the worst preset (red, `oklch(0.55 0.25 25)`). Even opaque,
  the red preset is only 3.65:1 on card, so alpha cannot fix `text-brand` at this size.
- `text-white/30` on the black "Tap Next" interstitial is 2.46:1.
- The future-day marker in the week strip (1.76:1) is an inactive control, exempt under WCAG 1.4.3 and
  already in `check-contrast.js` `OPACITY_EXEMPT`. It is counted so the list is complete.

## Proposal

**Minimum muted token: `--muted-foreground-subtle: oklch(0.62 0 0)`** (dark). Opaque, no alpha.
Ratio: 5.09:1 on card, 5.42:1 on background, 4.65:1 on muted (worst brand hue). Lightness 0.613 is the
exact 4.5:1 point on muted; 0.62 leaves margin. It would replace `text-muted-foreground/70` and
`opacity-60` on sub-12 px text. The alternative is a floor of `/75` on `muted-foreground` (about 4.8:1 on
muted) with no new token, but it keeps the alpha-over-an-unknown-surface problem that caused the 0.12
miss.

For `text-brand`, `text-white` and `text-background` at this size: full opacity, or a foreground token.
`text-brand` under 12 px should not be the only carrier of text on the red preset.

**Ratchet (in this PR):** `scripts/check-small-text-contrast.js`, CI step "No new sub-12px text dimmed
below WCAG AA (ratchet)" in the Custom Rules job. Any element under 12 px with effective alpha under
100% and a worst-surface ratio under 4.5:1 (or a colour it cannot resolve) must be in `BASELINE`, a
per-file count of today's 35. A file may not exceed its count, an unlisted file may have none, and a
count that fell must be lowered, so the baseline only shrinks. It changes no rendered output. The size
floor (11 px or 12 px) is a separate decision; this check reads whatever is under 12 px and works
unchanged if that floor moves.

## Fixing the visible sites (not done)

Needs a mockup at the 384 px dark viewport and the owner's yes. Filed as one `chore:` follow-up with
this list. Shrinking `BASELINE` as each is fixed is the done signal.

## Table

Columns card, background and muted are the blended ratio on that surface. Sorted worst first.

| file:line | classes | alpha | card | background | muted | verdict (worst surface) |
|---|---|---|---|---|---|---|
| app/session-select/components/week-strip-card.tsx:58 | `text-[10px] text-muted-foreground/30` | 30% | 1.81 | 1.76 | 1.83 | FAIL 1.76 on background
| components/config-screen.tsx:644 | `text-[10px] text-brand/70` | 70% | 2.17 | 2.30 | 2.01 | FAIL 2.01 on muted |
| components/workout-builder/builder-review.tsx:570 | `text-[10px] text-brand/70` | 70% | 2.17 | 2.30 | 2.01 | FAIL 2.01 on muted |
| components/workout/ai-prescription-card.tsx:379 | `text-[10px] text-brand/80` | 80% | 2.59 | 2.75 | 2.38 | FAIL 2.38 on muted |
| components/workout/pre-workout-screen.tsx:391 | `text-[10px] text-brand/80` | 80% | 2.59 | 2.75 | 2.38 | FAIL 2.38 on muted |
| components/workout-screen.tsx:1722 | `text-[10px] text-white/30` | 30% | - | - | - | FAIL 2.46 on black (on black) - on a full-screen `bg-black` interstitial, measured against black |
| app/health/health-sections.tsx:445 | `text-[9px] text-muted-foreground opacity-60` | 60% | 3.72 | 3.78 | 3.57 | FAIL 3.57 on muted |
| components/health/body-cards/sleep-card.tsx:84 | `text-[9px] text-muted-foreground opacity-60` | 60% | 3.72 | 3.78 | 3.57 | FAIL 3.57 on muted |
| components/health/body-cards/sleep-card.tsx:112 | `text-[9px] text-muted-foreground opacity-60` | 60% | 3.72 | 3.78 | 3.57 | FAIL 3.57 on muted |
| app/health/health-sections.tsx:323 | `text-[9px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| app/health/health-sections.tsx:389 | `text-[9px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| app/health/health-sections.tsx:524 | `text-[9px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/activity/background-location-card.tsx:73 | `text-[10px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/admin/calibration-card.tsx:209 | `text-[9px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/config/phase-editor.tsx:236 | `text-[9px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/health-metric-sheet.tsx:391 | `text-[9px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/health/body-cards/rhr-hrv-spo2-card.tsx:111 | `text-[9px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/health/body-cards/sleep-card.tsx:116 | `text-[9px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/health/oura-section.tsx:168 | `text-[10px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/health/oura-section.tsx:176 | `text-[10px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/health/readiness-breakdown.tsx:178 | `text-[10px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/health/readiness-breakdown.tsx:205 | `text-[10px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/health/readiness-breakdown.tsx:252 | `text-[9px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/more/friend-feed.tsx:51 | `text-[10px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/more/trophy-case.tsx:34 | `text-[9px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/nutrition/meal-macro-bars.tsx:46 | `text-[10px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/profile/goal-targets-section.tsx:61 | `text-[10px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/profile/required-info-section.tsx:62 | `text-[10px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/rest-day-card.tsx:52 | `text-[10px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/workout-builder/builder-review.tsx:576 | `text-[10px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/workout-builder/goal-spectrum.tsx:131 | `text-[9px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/workout/active-workout-screen.tsx:272 | `text-[10px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/workout/one-rm-calculator-dialog.tsx:85 | `text-[10px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/workout/time-summary-card.tsx:102 | `text-[9px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| components/workout/time-summary-card.tsx:105 | `text-[9px] text-muted-foreground/70` | 70% | 4.63 | 4.78 | 4.38 | FAIL 4.38 on muted |
| app/session-select/components/deload-explanation.tsx:104 | `text-[11px] text-muted-foreground/80` | 80% | 5.70 | 5.95 | 5.33 | pass 5.33 on muted |
| components/admin/console-section.tsx:24 | `text-[11px] text-muted-foreground/80` | 80% | 5.70 | 5.95 | 5.33 | pass 5.33 on muted |
| components/health/day-detail/day-read-through.tsx:152 | `text-[10px] text-muted-foreground/80` | 80% | 5.70 | 5.95 | 5.33 | pass 5.33 on muted |
| components/health/week/week-metric-card.tsx:93 | `text-[10px] text-muted-foreground/80` | 80% | 5.70 | 5.95 | 5.33 | pass 5.33 on muted |
| components/nutrition/manage-supplements-sheet.tsx:396 | `text-[10px] text-muted-foreground/80` | 80% | 5.70 | 5.95 | 5.33 | pass 5.33 on muted |
| components/nutrition/plan-meal-row.tsx:89 | `text-[11px] text-muted-foreground/80` | 80% | 5.70 | 5.95 | 5.33 | pass 5.33 on muted |
| components/nutrition/plan-meal-row.tsx:94 | `text-[11px] text-muted-foreground/80` | 80% | 5.70 | 5.95 | 5.33 | pass 5.33 on muted |
| components/config/program-editor-sheet.tsx:847 | `text-[10px] (inherited colour) opacity-60` | 60% | 6.86 | 7.02 | 6.53 | pass 6.53 on muted |
| components/profile/goal-targets-section.tsx:88 | `text-[10px] text-background/70` | 70% | - | - | - | pass 7.45 on foreground (on foreground fill) |
| components/profile/required-info-section.tsx:162 | `text-[10px] text-background/70` | 70% | - | - | - | pass 7.45 on foreground (on foreground fill) |
| components/workout/deload-toggle.tsx:74 | `text-[10px] (inherited colour) opacity-70` | 70% | 8.98 | 9.32 | 8.44 | pass 8.44 on muted |
| components/workout/session-duration-picker.tsx:71 | `text-[10px] (inherited colour) opacity-70` | 70% | 8.98 | 9.32 | 8.44 | pass 8.44 on muted |
| components/home/collection-pen.tsx:148 | `text-[10px] text-white/75` | 75% | 10.60 | 11.06 | 9.90 | pass 9.90 on muted
