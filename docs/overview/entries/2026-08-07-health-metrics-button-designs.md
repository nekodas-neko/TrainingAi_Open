# 2026-08-07 — Home score-card styles: four design rounds, fourteen shipped

**Branch:** `claude/health-metrics-button-designs-hy6cyv` · **Version:** 1.268.0

## What this was

The owner asked for mock designs for the four home score buttons (Readiness / Heart Rate / Sleep /
Activity) under two fixed constraints: **the Lucide glyph stays, and its identity colour stays.**
Everything else was open. It ran as four rounds of gallery → selection → implementation.

## Rounds and what each one settled

| Round | Mockups | Picked | What the selection revealed |
|---|---|---|---|
| 1 — the field | 28 | Bare, Watermark, Halo, Squircle, Frosted, Pill row, Rail | **Every value-encoding design was rejected** — all ten filled dials, the gauge, the bezel, the segmented ring. |
| 2 — soft/surface | 20 | Overlap, Duotone rail (F2×H4) | Read the round-1 picks as "atmosphere" and produced glow, glass, blobs, rim light. Wrong read — adding light is still adding. |
| 3 — minimal | 18 | Footnote, No label, Accent rule, Divider | Type, alignment, hierarchy, spacing and deletion only. Landed. |
| 4 — hierarchy | 13 | Band, Underline | Broke the four-equal-cells assumption (Oura's home is one hero score). Rejected — but the single-rule structures survived. |

Galleries are committed at `docs/design/2026-08-07-score-row-mockups*.html` — self-contained HTML,
no build step, not linked from the app.

## What shipped

Fourteen new `ScoreRingStyle` values on top of the original five, all selectable under
**More → Home widgets → Score Card Style**: `bare` `watermark` `overlap` `squircle` `frosted`
`pill` `rail` `duorail` `footnote` `nolabel` `accentrule` `divider` `band` `underline`.

## Decisions worth not re-litigating

- **The style value now maps to a layout family, not a frame.** Six of the fourteen restructure the
  row rather than reframing each circle, so `STYLE_LAYOUT` routes to one of six renderers
  (`circle` / `tile` / `pill` / `rail` / `minimal` / `band`). The original code assumed every value
  drew a circle; that assumption is gone and should not come back.
- **The SVG frames moved to `components/home/score-ring-frames.tsx`.** They were the bulk of the
  component and eight of the fourteen new styles don't use them.
- **No new style encodes its value.** This is a consequence of the owner's selections, reinforced
  explicitly in round 3: a fill makes no sense for heart rate, since 52 bpm is not 52% of anything
  and inventing a denominator would be the one dishonest thing in the set. Do not "improve" these
  styles by adding a progress arc later.
- **Colour never encodes state in any of them.** The icon's colour identifies the metric; the band
  word rides the aria-label, as it already did for the five original styles. No colour-only-state
  violation, because nothing is conveyed by colour at all.
- **Pill's `minHeight` is an inline style, not a Tailwind arbitrary class.** It is the 48dp tap
  floor (measured 44dp before the fix) and must not depend on a JIT-generated class surviving a
  class-order change.
- **Divider's row drops its gap; Band's wrapper is full-bleed.** Divider's hairlines sit on lane
  boundaries — with a gap they float in empty space. Band's rules run edge to edge past the page
  gutters, so its cells carry their own horizontal padding.

## Verification

Every style rendered in Chromium at 412dp through the real component (temporary route, removed
before commit): **no render errors, and every tap target at or above the 48dp floor** — the
tightest is Pill at 89×52dp, the largest Overlap at 89×106dp.

**Not verified on device.** In particular: `frosted`'s `backdrop-filter` and `duorail`'s stacked
opacity layers are exactly the shape of CSS behind the known Samsung WebView compositor bug that
wipes sibling gradients. See the Known Issues row added in `projectOverview.md`.

## Deliberately not done

- No mockup from round 4's hierarchy family (N) was built. Their secondary cells land at ~90×46dp,
  under the tap floor, and a fixed hierarchy claims Readiness is the most useful metric *every*
  day — which is false after a bad night.
- The picker is a flat list of nineteen radio options. At that length it wants grouping or visual
  previews; not in scope for this branch.
