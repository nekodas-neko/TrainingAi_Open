# Handoff — 2026-07-30 · Guided walk uplift (GPS/pace, HR chart, segment analytics, Android chip)

_Domain: `cardio` (also touches `devices` for the native chip bridge) · Branch: `feat/guided-walk-android-chip` · PR: #906, open, CI green as of the last pushed commit_

> **Read first:** `projectOverview.md` (status + Known Issues — several rows this session added),
> then `docs/domains/cardio/README.md` (guided walk code map + open issues), then
> `docs/superpowers/plans/2026-07-23-guided-walk-uplift.md` (the original plan this session
> completed). This file covers only what *this* session did and what it leaves behind.

## Goal

The owner reported (with a screenshot) that the guided walk's mid-exercise screen was missing
HR zones/live map/speed/cadence, the walk-complete screen didn't record enough to compare walks
over time, and the Samsung status-bar pill never showed the interval phase countdown. This session
picked up the dormant `2026-07-23-guided-walk-uplift.md` plan and delivered all of it, ending with
an owner-escalated request for much richer walk-complete data ("flood the page with information...
like workouts which record a single row for bench press set 1").

## Current status

- Build/test: full local gate (typecheck, lint, `check-reconcile.js`, `check-push-mutations.js`,
  targeted vitest, changelog version-duplicate check) run clean on every PR before push. CI green on
  #882, #884, #886 (all merged). PR #906 has CI green as of its latest pushed commit
  (`fae85c7`) after fixing one `check-doc-links` failure (a relative-link bug, see Gotchas).
- Device-verified: **no.** Every screen in this arc was verified via dev-server Playwright smoke
  tests only (mocked `navigator.geolocation`, signed-in session, console/network assertions). None
  of the native paths — real GPS/`BackgroundGeolocation`, the Android status-bar chip rendering,
  tap-to-reopen, the countdown→overtime flip, real HR-zone-colored map segments — have been
  confirmed on the S25. Each is flagged in its own `projectOverview.md` Known Issues row.

## What shipped

| PR | Version | What |
|---|---|---|
| #882 | v1.233.0 | GPS point stream + live route map, route polyline/splits/pace-series/elevation/best-efforts actually saved on finish (previously hardcoded `null`), shared `lib/walk/segment-window.ts` windowing helper, pace-primary live UI (pace at bpm's old visual weight, HR demoted secondary) once a GPS fix exists |
| #884 | v1.234.0 | `ActivityHrChart` extended with an optional `phaseBands` prop; new `components/activity/phase-bands-plugin.ts` (pure non-JSX chart.js plugin, unit-testable — this repo's vitest has no JSX transform) paints translucent fast/slow bands behind the HR line in `walk-summary.tsx` |
| #886 | v1.240.0 | New `activity_logs.segments` JSONB column (migration 161, mirrors the `paceSeries`/`elevationProfile` pattern) — every walk now stores one row per plan segment: `{index, setNumber, kind, startSec, endSec, avgHr, maxHr, hrAtStart, avgPaceSecPerKm, distanceKm, avgCadenceSpm}`. `lib/walk/segment-stats.ts` (`computeWalkSegmentStats` + `aggregateSegmentsByKind`, both pure, unit tested). Threaded through schema/Zod/adapter/local-SQLite/`RECONCILE_COLUMNS`. Walk-complete screen gained an HR-zone-colored route map (`buildRouteZoneSegments`, reused unchanged from #878) and "Fast avg"/"Slow avg" cards (pace, HR, distance) |
| #906 | v1.243.1 | Android status-bar pill for the current interval phase + countdown. **No new Kotlin** — reused the existing `window.AndroidRunChip` bridge (built for the running screen's duration chip; its "duration" mode already counts down to a target instant and flips to count-up past it). `walk-active.tsx` re-anchors the chip on every phase change (`segment.index`), label = "Fast — set N of M" / "Slow — set N of M" / "Warm up" / "Cool down". Relabeled the existing `ta_pref_run_chip` toggle to "Run/Walk in Status Bar" instead of adding a third chip preference |

Files worth knowing about:
- `lib/walk/segment-stats.ts` — the core pure-function module (segment windowing + kind aggregation)
- `lib/walk/interval-plan.ts` — `buildIntervalPlan`/`segmentAt`, the walk's phase/timing model
- `components/guided-walk/walk-active.tsx` — mid-walk screen, now owns the chip re-anchor effect
- `components/guided-walk/walk-summary.tsx` — walk-complete screen, most heavily touched file across all 4 PRs (map, HR chart, fast/slow cards, save-path wiring)
- `lib/native/run-status-chip.ts` — the JS wrapper reused for the walk's status-bar chip (no walk-specific wrapper was written)
- `android/app/src/main/java/com/trainingai/app/MainActivity.java` — `RunChipBridge` (lines ~253-301), the native side. **Not touched this session** — confirmed it already covers everything Phase D needed.

## Deliberately NOT done

- **Per-phase chip color** — the backlog flagged this as needing feasibility investigation.
  `AndroidRunChip`'s duration mode only tints on overtime (red); adding a fast/slow color hook means
  new Kotlin. The phase name in the chip text already satisfies this project's
  no-color-only-state rule, so this was left as a nice-to-have beyond the original ask rather than
  justifying new native code.
- **Phase E (reactive walk/jog nudge notifications from live speed + HR)** — not started. Depends on
  live pace-tracking (shipped, this session) + existing live-HR verified on-device first (owner's own
  framing, not yet done). See `docs/implementation-backlog.md` under `[cardio] Guided walk —
  remaining`.
- **Phase G steps (real per-activity step counts)** — blocked on a windowed raw-BLE-frame reader that
  doesn't exist yet; same underlying blocker as the Oura on-device program's steps gap. Not attempted.
- **Real step counts, records-to-beat for walks** — explicitly out of scope per the owner's spec
  decision D-1 (walks don't progress; that mechanic belongs to the running program only).

## Key decisions (with rationale)

- **#906 needed no new Kotlin.** The plan (and the backlog row it came from) assumed a new
  `WalkChipPlugin.kt` modelled on a rest-timer plugin. Reading `MainActivity.java` first found
  `RunChipBridge`/`window.AndroidRunChip` already shipped for the running screen with exactly the
  countdown/overtime behavior a walk phase needs — reused it instead of duplicating native code.
  Always read the actual native bridge before assuming a plan's native-work estimate is current.
- **Segments live in a new JSONB column on `activity_logs`, not a new table/sync domain.** Mirrors
  the existing `paceSeries`/`elevationProfile` pattern (migration 151) — one more field through
  write paths that already exist, rather than a new relational shape.
- **`walk-summary.tsx`'s per-segment display calc became the single source for what's saved.** It
  previously computed `perSegment` for display only and threw it away; `computeWalkSegmentStats` now
  powers both the UI and the persisted `segments` array — no drift between "what you see" and "what's
  recorded."
- **Reused `ta_pref_run_chip` for the walk chip** rather than adding `ta_pref_walk_chip`. Same
  underlying native mechanism/notification slot; a walk and a run can never be active
  simultaneously, so there's no collision risk from sharing the preference.

## Gotchas / what did NOT work

- **`docs/implementation-backlog.md` was rewritten wholesale by an unrelated parallel session's
  audit** (trimmed ~3,050 → ~380 lines) partway through this session's rebases. A textual conflict
  resolution against the old (~3,000-line) content would have been wrong — the fix was to take the
  fresh `origin/main` version of the file entirely and reapply this session's small edit (strike the
  shipped Phase D row) on top of the current structure, not to merge conflict markers line-by-line.
- **A relative-link bug reintroduced a class of bug a brand-new CI check (`check-doc-links.js`,
  landed on `main` mid-session via PR #931) exists specifically to catch.** Copy-pasting an existing
  `[text](../overview/entries/X.md)` pattern from an older backlog entry produced a broken link —
  `docs/implementation-backlog.md` and `docs/overview/entries/` share the same parent (`docs/`), so
  the correct relative path has **no** leading `../`. This exact "extra `../`" bug is called out in
  that script's own header comment as the reason it was written (16 dead links found the same way).
  Caught by CI on #906, fixed in a follow-up commit (`fae85c7`). **`pnpm ci:local` does not run
  `check-doc-links.js`** — it's only wired into the GitHub Actions Custom Rules job, so this class of
  break is invisible until CI, not local gate runs. Worth adding to `ci:local` in a future session.
- **PR #906 needed 3 rebases**, each hitting a `package.json`/`lib/changelog.ts` version collision
  with a PR that merged in the meantime (main was extremely active this session — a full-app-docs
  audit, a nightly-temperature fix, an auth-gate fix, and several others landed while #906 sat in
  review). Resolved each time by renumbering to the next free patch/minor version and keeping both
  sides' changelog/Known-Issues content, newest first. Final version: **v1.243.1**.
- **Dev-server Playwright sign-in**: the sign-in form has no `name` attribute on its inputs — use
  `input[type="email"]` / `input[type="password"]`, not `input[name="email"]`. Playwright's global
  install lives at `/opt/node22/lib/node_modules/playwright/index.mjs` (not a project dependency),
  import it by absolute path.

## Files to look at

- `lib/walk/segment-stats.ts` — the segment-stats math, if extending what's recorded per phase
- `lib/native/run-status-chip.ts` + `MainActivity.java`'s `RunChipBridge` — the chip mechanism, if
  Phase E's reactive nudges also want a native surface
- `docs/domains/cardio/README.md` — the pillar index, kept current with this session's shipped items
- `docs/implementation-backlog.md` under `[cardio] Guided walk — remaining` — Phase E and Phase G,
  the only guided-walk items left in the queue

## Open questions / blockers

- **Everything in this arc is owner-verification-gated.** The original report was screenshot-driven;
  the owner needs to actually walk with the app on the S25 to confirm the map/HR-zones/pace UI, the
  recorded segment data, and — the one most likely to have a real native bug — the status-bar pill
  itself (promoted-notification rendering, phase-to-phase re-anchor, tap-to-reopen).
- No plan exists yet for Phase E or Phase G — both are backlog rows, not implementation plans. A
  planning session should write those before an implementer session picks them up, per the
  plan-now/build-later convention.

## Pickup prompt

```
Check whether PR #906 (nekodas-neko/TrainingAI, branch feat/guided-walk-android-chip) has merged:
mcp__github__pull_request_read method=get on nekodas-neko/TrainingAI#906. If it's still open,
check CI (method=get_check_runs) and mergeable_state — if all checks are green and
mergeable_state is "clean", merge it (squash) without asking (already tested via dev-server
Playwright, non-destructive, no unresolved review comments). If main has drifted again, rebase
onto origin/main first: expect conflicts in package.json/lib/changelog.ts (renumber to the next
free version) and possibly projectOverview.md/docs/implementation-backlog.md (keep both sides'
content). Re-run the full local gate after any rebase: tsc --noEmit, eslint, node
scripts/check-reconcile.js, node scripts/check-push-mutations.js, node
scripts/check-doc-links.js (NOT in pnpm ci:local — a new CI-only check, run it explicitly), a
targeted vitest run, and a changelog version-duplicate check before pushing.

Once #906 is merged, the guided-walk uplift this session was tasked with is functionally
complete — HR zones/live map/speed/cadence (#882/#884), recorded per-segment stats for
comparing fast/slow walks over time (#886), and the status-bar phase countdown (#906) are all
shipped. Read docs/handoff-2026-07-30-cardio-guided-walk-uplift.md (this file) for what shipped
and why, then projectOverview.md's Known Issues section for the "NOT verified on device" rows
this arc left behind — none of it has been confirmed on a real Android device yet. Unless the
owner reports a bug from actually testing on their S25, there is no more implementation work
here — the next guided-walk items (Phase E reactive nudges, Phase G real step counts) are
backlog rows under `[cardio] Guided walk — remaining` in docs/implementation-backlog.md with no
plan written yet; a planning session should write one before implementing.
```
