# 2026-08-06 — Guided Walk presets become Long / Short / Custom

**Domain:** cardio — v1.267.6, JS-only (no APK rebuild)

## The report

Q-99 (owner UI-bug batch): wants the Guided Walk setup screen carousel-themed like the rest of the
app, with Long/Short/Custom presets — Custom being user-configured, falling back to a default
otherwise.

## What shipped

Content/state change only — the carousel mechanics (`SwipeCarousel`) were already shared with the
Running screen and needed no rebuild. The bigger Workout-tab-style visual richness (palette,
per-card imagery) stays out of scope, per the plan's own flag not to bundle it in silently.

- Relabeled the two existing presets: Standard → **Long**, Quick → **Short** (values unchanged —
  still 5×3/3 and 3×3/3 min).
- Added a persisted `customConfig: WalkConfig | null` field to `guided-walk-store.ts` — the store
  previously had no notion of a saved custom setup at all.
- Added a third **Custom** carousel slide, reading `customConfig` if set, else
  `DEFAULT_WALK_CONFIG`.
- Fixed the pre-existing bug the plan called out: `presetIndex` used to silently fall back to
  "Standard/Long selected" whenever the live config didn't match any preset (e.g. after editing a
  stepper), misrepresenting the actual state. It now correctly shows Custom selected instead.

## Design decisions made during implementation

- **Autosave, no separate "Save as Custom" step.** The plan flagged this as the one real decision
  to make before building. Chosen: selecting Custom applies `customConfig ?? DEFAULT_WALK_CONFIG`
  to the live config, and any stepper edit while Custom is selected (or that causes a flip *into*
  Custom) immediately persists back to `customConfig`. Matches the screen's existing pattern —
  steppers already write straight to the live config with no save button anywhere else on this
  screen.
- **Selected-slide index is real component state, not purely derived from config content.** The
  original plan assumed presetIndex could stay a pure `useMemo` derivation (as it was before, just
  fixing the fallback target). That doesn't work: `DEFAULT_WALK_CONFIG`'s sets/fast/slow are
  numerically identical to the Long preset's, so applying it for a fresh, never-configured Custom
  selection immediately re-derived back to "Long" — the carousel would snap right back the instant
  you swiped to Custom. Fixed by tracking `presetIndex` as `useState`, seeded once from content on
  mount, and only moved by an explicit tap/swipe or by an effect that flips to Custom when a
  stepper edit no longer matches the *currently selected* Long/Short preset (a narrower, collision-
  free comparison than matching against all three slides' content every render).
- **Warm-up/cool-down/treadmill stay untouched by Long/Short, exactly as before** — the plan
  flagged this as needing confirmation it's intentional rather than an oversight; kept as-is.
  Custom, being a full saved snapshot, restores all of it including warm-up/cool-down/treadmill,
  which is the more useful behaviour for a genuinely personalised setup.

## A second bug found and fixed during Playwright verification

The first implementation pass had the autosave effect fire only on *future* config changes after a
flip to Custom, not the edit that triggered the flip itself — so editing a stepper while on Long
correctly flipped the dot to Custom, but the Custom slide's own preview text stayed stuck showing
the old (pre-edit) values until a second edit. Fixed by saving `customConfig` in the same effect
pass that detects the flip, not deferring it.

## Verification

Typecheck and lint clean. Full suite: 401 files / 3,175 tests green (no existing tests for this
store/component; none added — a pure UI state-binding change with no server surface, consistent
with this app's existing test-coverage boundaries).

Ran `pnpm dev` with Playwright against `/activity/guided-walk` in both light and dark themes:
confirmed the relabeled Long/Short dots, confirmed tapping the Custom dot lands on it and stays
there (not the Long-values-collision snap-back caught in the first pass), and confirmed editing a
stepper while on Long correctly flips to Custom with the slide's preview text matching the edited
values (not the stale-preview bug caught in the second pass).

**Not exercised:** on-device (S25) — JS-only, no safe-area/gesture/native surface; `SwipeCarousel`
itself (the actual swipe gesture, as opposed to tapping the dots) wasn't device-verified either,
consistent with the rest of this screen's existing not-yet-device-verified status noted in
`docs/domains/cardio/README.md`.
