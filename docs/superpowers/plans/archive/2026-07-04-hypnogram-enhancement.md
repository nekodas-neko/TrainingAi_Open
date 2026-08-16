# Sleep hypnogram — readability redesign (Oura-style) + first-class placement

> Source: user request (2026-07-04) with an Oura side-by-side. The stepped
> hypnogram already ships (PR #130) but is **"a little harsh to read"**: it's a
> tiny ~32px strip of **thin floating rectangles** with gaps between stage rows,
> only inside the metric detail **sheet** (`components/health-metric-sheet.tsx:108`
> `SleepHypnogram`, rendered at :203). Oura's, by contrast, is a **tall, filled,
> continuous stepped ribbon** — each stage fills from its lane down to a baseline,
> so transitions read as one smooth shape. This plan closes that gap (readability
> is the primary goal) and promotes the chart to the dedicated **sleep detail
> page** (`app/health/sleep/sleep-content.tsx`, the DetailHero "sleep" screen),
> which doesn't show it today. It does **not** rebuild the parse: the tested pure
> helper `lib/health/hypnogram.ts` (`hypnogramSegments`) and the `sleepPhase5Min`
> data (`/api/sleep-sessions`, synced from Oura) are reused as-is.

## The core readability fix (what "harsh" means, concretely)

Current `SleepHypnogram` draws each segment as a thin `ROW_H=8` rect **only at its
stage's lane** (`health-metric-sheet.tsx:135-144`) — so stages float on separate
rows with empty gaps between them and no visual connection across transitions.
Oura's is legible because it's a **filled stepped area**: at any x the fill is the
current stage's colour, drawn from that stage's lane-top **down to the baseline**,
so adjacent segments share the baseline and connect into one ribbon with clean
vertical steps at transitions. Adopt that model:

- Each segment → a filled rect from `y(stage)` **down to the baseline** (not a
  thin lane-height bar), colour = stage. This alone removes the floating/gappy
  look and is the single highest-impact change.
- Make it **tall** (the `lg` page variant ~160–200px; keep a compact `sm` for the
  sheet). Lane order top→bottom: Awake · REM · Light · Deep (matches Oura).
- Softer, calmer palette on the dark sleep page — Oura uses low-saturation blues
  (Deep darkest → Light → REM → Awake lightest). Keep our four stages but tune the
  hex toward that gentler ramp rather than the current saturated blue/cyan/purple/
  grey on pure black; verify ≥4.5:1 for labels and keep the labelled legend
  (don't rely on colour alone). Rounded segment corners + subtle transition
  smoothing (small vertical connectors / 1px anti-alias) to match Oura's softness.

## Guiding constraints

- **One formula, one place.** Reuse `hypnogramSegments` / `STAGE_LEVEL` from
  `lib/health/hypnogram.ts`; do not fork the parsing. Any new derived math
  (cycle detection, stage totals) goes in that module with its own tests.
- **Extract at ≥2 sites.** The band will now render in both the sheet and the
  sleep page → extract a shared `components/health/hypnogram.tsx` `<Hypnogram>`
  component (props: `phase5Min`, `sleepStart`, `sleepEnd`, `size?: 'sm' | 'lg'`).
  The sheet swaps its inline `SleepHypnogram` for the `sm` variant; the sleep page
  uses `lg`. Keep the existing `STAGE_COLOR`/`PHASE_COLORS` hex values.
- **Graceful degradation.** When `sleepPhase5Min` is absent/empty, render the
  existing proportion-bar fallback (stage durations), never a blank gap — this
  also covers the "I don't see a hypnogram" case when Oura hasn't synced phases.
- Theme tokens for chrome/labels; hex only for the fixed stage colors (existing
  convention). Body text ≥4.5:1; don't convey stage by color alone — keep the
  labelled legend.

## Task 1 — Shared `<Hypnogram>` component with the filled-ribbon redesign

- New `components/health/hypnogram.tsx`: extract the SVG rendering out of
  `SleepHypnogram` (`health-metric-sheet.tsx:108-167`) into a reusable component
  (props `phase5Min`, `sleepStart`, `sleepEnd`, `size: 'sm' | 'lg'`), **and apply
  the readability redesign above** — segments fill from `y(stage)` down to the
  baseline (not lane-height bars), tall `lg` variant, softer palette, rounded
  corners, time labels + labelled legend scaled by size.
- `health-metric-sheet.tsx`: replace the inline component + its call at :203 with
  `<Hypnogram size="sm" … />`. The sheet gets the improved (filled, less harsh)
  look at compact size.
- **Verify:** the sheet hypnogram now reads as a connected ribbon, not floating
  bars; proportions still match the stage-duration breakdown.

## Task 2 — Promote it to the sleep detail page (the main enhancement)

- `app/health/sleep/sleep-content.tsx`: add a "Sleep stages" card rendering
  `<Hypnogram size="lg" … />` for the selected night, sourced from the sleep
  session the page already loads (confirm it has `sleepPhase5Min`; if the page's
  current fetch omits it, thread it through — it's already on
  `/api/sleep-sessions`). Full-width, above/near the existing stage-duration
  breakdown. Fallback card copy when no phase data.
- **Verify:** open Health → Sleep detail on a night with `sleepPhase5Min`; the
  large hypnogram renders with correct proportions + time axis. Toggle `.dark`/
  light (the DetailHero sleep page is dark-themed — ensure labels/legend read on
  it). Seed a `sleepPhase5Min` string into the local dev DB if none exists.

## Task 3 — Cycle awareness + per-stage totals (derived, tested)

- `lib/health/hypnogram.ts`: add pure, tested helpers on top of the existing
  segments — e.g. `sleepCycles(segments)` (count/boundaries: a cycle boundary at
  each REM→(deep/light) descent, the standard heuristic) and
  `stageTotals(segments)` (minutes per stage). TDD in
  `lib/health/__tests__/hypnogram.test.ts`.
- `<Hypnogram size="lg">`: draw faint vertical cycle divider lines and a caption
  ("~4 cycles · Deep 1h12m · REM 1h40m · …"). Keep `sm` uncluttered (no dividers).
- **Note (Oura limitation, already documented):** Oura v2 exposes no official
  cycle boundaries (`archive/2026-06-22-ai-rest-days-framework.md:507`) — these are
  *estimated* from the 5-min phases; label them as approximate.
- **Verify:** unit tests for cycle/total math on known phase strings; visual check
  the dividers land at REM→deep transitions.

## Optional / follow-up (flag, don't necessarily build)

- Tap-to-inspect a stage segment (tooltip with its clock range) — nice on the
  `lg` page variant; skip if it complicates the SVG much.
- Hypnogram as a background band under the Home HR·Today chart — larger scope
  (couples two components), defer to its own item.

## Wrap-up

- `pnpm tsc --noEmit && pnpm lint && pnpm test`; `pnpm dev` both-theme pass of the
  sleep sheet **and** the sleep detail page.
- User-visible → **minor** version bump + `lib/changelog.ts` entry; low-risk
  display feature, exempt from the merge-confirmation gate.
- **Not exercisable in sandbox (declare in PR):** a real Oura night with
  `sleepPhase5Min`, on-device Samsung WebView SVG rendering, the DetailHero sleep
  page's dark-only styling against the enlarged band.
