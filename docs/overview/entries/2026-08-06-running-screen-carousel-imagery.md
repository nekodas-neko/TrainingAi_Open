# 2026-08-06 — Running screen carousel gets per-type imagery, Skip button removed

**Domain:** cardio — v1.267.10, JS-only (no APK rebuild)

## The report

Q-98-followup (split from Q-98 after its bug-fix half shipped): the owner's suggested redesign
direction for the Running pre-run screen — carousel-native, per-run-type imagery, dropping "Skip"
as a separate concept, similar to the Workout tab.

## What shipped — a scoped subset of the full plan, by design

The plan's literal ask was two things: (1) restyle `RunTypeCarousel`'s slides with per-run-type
imagery, and (2) "fold an inline Start action into each slide, eliminating the separate
`PrescribedRunCard` panel and the Skip button concept entirely."

Shipped (1) and half of (2):

- **Per-type imagery**: each carousel slide now shows a themed icon (Recovery → `Feather`, Easy →
  `Footprints`, Long → `Route`, Tempo → `Flame`, Interval → `Zap`) in a colour-mixed badge, using
  the *existing* HR-zone palette (`HR_ZONE_META`) rather than commissioning new illustration
  assets — the plan flagged sourcing new SVG art as a separate, larger step not to bundle in
  silently, so this reuses tokens instead ("One Formula, One Place"). The badge colour is the top
  zone the type actually targets (`hr-targets.ts`'s `ZONES_BY_TYPE`), so it always agrees with the
  "Zone N–M" text already on the slide.
- **Skip button removed entirely**, along with the `markRun`/local-store-write machinery that
  existed only to support it. Swiping the carousel to a different run type already calls
  `applyOverride` (which resets status to pending) — there is no longer a separate "I don't want
  today's prescription" action distinct from "pick a different one." Confirmed via a full grep
  that nothing else in the app reads `status === 'skipped'` as a meaningful signal (stats/streaks/
  weekly-digest only ever filter for `'completed'`), so this was safe to remove outright rather
  than needing a data-migration story.

**Deliberately NOT done: folding Start into every individual slide, or removing
`PrescribedRunCard`.** `PrescribedRunCard` carries content that doesn't map cleanly onto a small
carousel slide — an AI-generated rationale fetched per-selection, gate-softening warnings
(readiness-based "eased off today" / "dialed back to recovery" banners), and a Push-session badge.
Duplicating a "Start" button on every slide *and* keeping this panel below would be redundant and
confusing (two Start buttons on screen for the same action). Kept one external Start button, tied
to whatever the carousel is currently showing — the carousel already drives the live prescription
via `applyOverride` on every swipe, so this reads as one coherent flow, not two disconnected
controls. This is a real, considered scoping decision, not an oversight — if the owner wants the
fuller per-slide-action structure, that's a distinct, larger follow-up, not filed as a new backlog
entry since it wasn't asked for as a fix to anything broken.

## Verification

Typecheck and lint clean. Full suite: 401 files / 3,175 tests green.

Ran `pnpm dev` with Playwright against a seeded running plan, both light and dark themes: confirmed
all five run types render distinct, theme-correct icon/colour badges (Recovery blue, Easy/Long
green, Tempo orange, Interval red), confirmed the Skip button is gone (single "Start run" button
only), and confirmed swiping between types correctly re-triggers the override and updates the AI
rationale text, zone range, and badge colour together. One dev-only false alarm along the way: a
stale Next.js HMR module-factory error from live-editing `running-plan-content.tsx` mid-session
(referencing the just-removed `SkipForward` import) — resolved by a clean dev-server restart, not
a real bug (confirmed by the restart producing zero console errors).

**Not exercised:** on-device (S25) — JS-only change, no safe-area/gesture/native surface; the
actual swipe gesture (as opposed to tapping the carousel dots) wasn't separately device-verified,
consistent with this screen's pre-existing not-yet-device-verified status.
