> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Deployment Sequence Plan

**Date:** 2026-06-02  
**Branch for planning docs:** `claude/project-review-brainstorm-SoBBa`

---

## Overview

Five sequenced sprints ship the full backlog. Each sprint gets its own feature branch, is independently testable, and merges to `main` triggering a Railway auto-deploy. Railway redeploys on every push to `main` — migrations run automatically via `ensureSchema` on cold start.

**Testing model:** Verify everything locally with `pnpm dev` before merging. Device testing on S25 Ultra happens post-deploy since Railway is the only way to get a build to the phone. Only merge when local verification passes — the deploy to `main` is the device testing opportunity.

**Critical constraint:** Never merge Sprint 2 (Block Periodization) before Sprint 1 (Security) — the `program_phases` migration and the Zod schema on `sync-workout` would otherwise be applied to an unvalidated endpoint.

```
Sprint 0 (Security)
        ↓ merge to main → verify on device
Sprint 1 (Block Periodization + woven uplifts)
        ↓ merge to main → verify on device
Sprint 2 (Program Wizard)
        ↓ merge to main → verify on device
Sprint 3 (Functional Uplifts)    ← independent, can run alongside Sprint 1 or 2
        ↓ merge to main → verify on device
Sprint 4 (UI / Accessibility)    ← lowest priority, own sprint
        ↓ merge to main → verify on device
```

**Sprint 3 independence note:** Sprint 3 touches no files that Sprints 1 or 2 modify. It can be developed in parallel with either, but should merge to `main` only after Sprint 0 (to ensure the clean base).

---

## Sprint 0 — Security

**Branch:** `feat/security-sprint-0`  
**Based on:** `main` (current)  
**Plan reference:** `docs/superpowers/specs/2026-06-02-combined-uplift-periodization-design.md` → Phase 0

### What ships

| Task | Items | Files |
|------|-------|-------|
| P0-T1 | U1, U4 | `app/api/ai-chat/tts/route.ts`, `app/api/auth/exchange-mobile-token/route.ts` |
| P0-T2 | U8, U9, U22, U23 | `app/api/sync-workout/route.ts`, `app/api/nutrition/scan/route.ts`, `app/api/nutrition/barcode/route.ts`, `app/api/exercise-gif/route.ts` |
| P0-T3 | U7 (partial), U20, U21 | `app/api/ai-chat/route.ts`, `app/api/nutrition/scan/route.ts`, `app/api/morning-briefing/route.ts`, `app/api/weekly-digest/route.ts`, `lib/rate-limit.ts`, `lib/mobile-auth-tokens.ts` |
| P0-T4 | U29 | `app/api/ai-chat/route.ts` |

### Local verification (before merging)

- [ ] `pnpm build` passes with no type errors
- [ ] TTS route: `curl -X POST http://localhost:3000/api/ai-chat/tts` with no cookie → 401
- [ ] AI chat: works end-to-end in dev browser with a valid session
- [ ] Sync-workout: POST a valid payload to the route → accepted; invalid payload (negative reps) → 422
- [ ] Rate limit: send 16 rapid AI chat requests in dev → 16th returns 429
- [ ] Nutrition scan: camera capture still functional in dev browser

### Post-deploy checks on device

- AI chat and TTS still work normally on the phone
- Nutrition scan camera works on the phone (camera APIs behave differently on mobile)

### Railway deploy notes

- No migrations — zero-downtime deploy
- Risk level: **low** (guards at API boundaries only — no data model changes)
- Rollback: `git revert -m 1 <sha>` and push to `main`

---

## Sprint 1 — Block Periodization (+ woven uplifts)

**Branch:** `feat/block-periodization`  
**Based on:** `main` after Sprint 0 merges  
**Plan reference:** `docs/superpowers/plans/2026-06-01-block-periodization.md` (Tasks 1–18)  
**Uplift additions:** Tasks 12, 13, 14, 15 absorb U2, U10, U7 (readiness-score), U5, U6 respectively

### What ships

Complete block periodization feature as specified in the block periodization plan, plus:

- **Task 12 expansion:** U2 (Brzycki division-by-zero guard) + U10 (atomic PR detection via `upsertPersonalRecordIfBetter`)
- **Task 13 expansion:** U7 partial — rate limit on `readiness-score` (20/min)
- **Task 14 expansion:** U5 — rep ± button height `h-8` → `h-12` in `set-card.tsx`
- **Task 15 expansion:** U6 — `text-[8px]`/`text-[9px]` → `text-xs` in `session-select-content.tsx`

### Dependency on Sprint 0

`app/api/sync-workout/route.ts` already has Zod validation from Sprint 0. Task 12 adds phase stamping on top of the validated payload — no re-validation needed.

### Local verification (before merging)

- [ ] `pnpm build` passes
- [ ] `pnpm test` — all phase-engine vitest tests pass
- [ ] Migration `020_block_periodization.sql` applies cleanly against a local DB
- [ ] Config screen (dev browser): can add phases to a program, set types (Normal/Peak/Deload), and save
- [ ] Config screen: per-exercise role picker (primary/secondary/accessory) saves and reloads correctly
- [ ] Workout flow: deload banner shows when phase type is Deload; set counts halved
- [ ] Workout flow: phase indicator visible on pre-workout screen
- [ ] Session select: block progress card visible
- [ ] Stats API: `earlyDeloadRecommended` field present in `/api/readiness-score` response JSON (`curl` or browser network tab)
- [ ] Log exercise: 1RM / PR fields not updated when `is_early_deload = true`
- [ ] No regressions: existing workout flow (without block periodization enabled) unchanged in dev

### Post-deploy checks on device

- Complete a workout with block periodization enabled — phase stamps correctly on the session
- Deload phase: set counts halved, banner visible, weights feel right (not doubled)
- Rep ± buttons: noticeably easier to tap at the new h-12 height
- Session select week strip: day labels readable without squinting

### Railway deploy notes

- Migration `020_block_periodization.sql` runs on first request after deploy
- New nullable columns (`phase_id`, `is_early_deload`, `exercise_role`) — existing rows read as NULL, handled as "no periodization active"
- Risk level: **medium** — new migration + significant logic changes; existing programs unaffected unless user opts in
- Rollback: revert merge and push to `main`; new DB columns remain but are inert without the code

---

## Sprint 2 — Program Wizard

**Branch:** `feat/program-wizard`  
**Based on:** `main` after Sprint 1 merges  
**Plan reference:** `docs/superpowers/plans/2026-06-02-program-wizard.md` (Tasks 1–13)

### What ships

Full wizard feature: DB migration for rep ranges + nullable rest, default progression style seeding, wizard engine (pure functions), 6-step wizard UI at `/program-wizard`, AI review route, save route, and config screen integration.

### Dependency on Sprint 1

The wizard uses `exerciseRole` (primary/secondary/accessory) which is added in Sprint 1's migration. The wizard save route sets `sessionsPerCycle` which the phase engine reads. Sprint 2 must branch from `main` after Sprint 1 has merged.

### Sub-tasks in dependency order

```
Task 1 (migration 022)
  → Task 2 (schema + types + adapter)
    → Task 3 (dynamic rest in active workout)
    → Task 4 (seed default styles from upsertUser)
    → Task 5 (wizard-engine.ts TDD)
      → Task 6 (wizard page skeleton)
        → Task 7 (steps 1–4 UI)
          → Task 8 (step 5 exercise selection)
            → Task 9 (generate API route)
              → Task 10 (step 6 AI review + save)
                → Task 11 (save API route)
                  → Task 12 (config screen integration)
                    → Task 13 (final build + push)
```

Tasks 3 and 4 can be done in parallel after Task 2. Tasks 7 and 9 can be developed in parallel (UI vs API).

### Local verification (before merging)

- [ ] `pnpm build` passes
- [ ] `pnpm test` — all wizard-engine tests pass
- [ ] Migration `022_style_rep_ranges.sql` applies cleanly
- [ ] New account flow: `upsertUser` seeds 6 default progression styles (check DB or config screen)
- [ ] Idempotent: calling `upsertUser` again does not duplicate styles
- [ ] Config screen (dev browser): "Create with Wizard" button visible
- [ ] Wizard: complete all 6 steps → AI review screen loads with program name + summary
- [ ] Wizard: save → program created in DB with correct sessions, schedule (`type: 'rotation'`), exercises
- [ ] Wizard: config screen opens with new program pre-loaded (`?programId=` param in URL)
- [ ] Wizard: refresh mid-wizard (step 3) → draft restored, step position correct
- [ ] Wizard: after successful save, draft cleared from localStorage
- [ ] Wizard: POST to `/api/program-wizard/generate` 6 times in 60s → 6th returns 429
- [ ] Dynamic rest: log a set at 80% 1RM in dev → rest timer shows 120s (not 90s default)
- [ ] Rep ranges: style set with `repsMin=8, repsMax=12` displays as "8–12 reps"
- [ ] Manual program builder: still works (no regression from wizard additions)

### Post-deploy checks on device

- Run the full wizard on the phone — touch targets across all 6 steps are comfortable
- Muscle group selection (step 3): multi-select works correctly with touch
- Exercise selection (step 5): swap sheet opens and swaps correctly
- AI review step: Gemini response loads within a reasonable time on mobile network
- Saved program is immediately usable as the active program for a workout

### Railway deploy notes

- Migration `022_style_rep_ranges.sql` adds nullable columns — zero-downtime compatible
- `GOOGLE_GENERATIVE_AI_API_KEY` already in Railway env — wizard reuses it
- Risk level: **medium** — new AI route + new page; existing flows only changed by an additive button in config
- Rollback: revert merge; `022` columns remain but are inert

---

## Sprint 3 — Functional Uplifts

**Branch:** `feat/functional-uplifts`  
**Based on:** `main` after Sprint 0 merges (independent of Sprints 1 and 2)  
**Plan reference:** `docs/superpowers/specs/2026-06-02-combined-uplift-periodization-design.md` → Phase 2

### What ships

| Task | Items | Files |
|------|-------|-------|
| P2-T1 | U3, U11 | `components/workout-screen.tsx`, `components/exercise-stats-sheet.tsx` |
| P2-T2 | U12 | `components/nutrition/food-logger-sheet.tsx` |
| P2-T3 | U13 | `lib/stores/workout-store.ts` |
| P2-T4 | U18, U19 | `components/exercise-stats-sheet.tsx` |
| P2-T5 | U30, U31 | `lib/sqlite/cache.ts`, `components/sync-provider.tsx` |

### Local verification (before merging)

- [ ] `pnpm build` passes
- [ ] Workout screen: in dev, switch between sessions during an active workout → state resets (no carry-over sets)
- [ ] Exercise stats: inspect console for `-Infinity` when logging 0 sets → none present (U11)
- [ ] Food logger: submit button click — rapidly click it twice in succession → one entry created (U12)
- [ ] Workout store: manually set the stored date to yesterday in localStorage, reload → store resets to empty (U13)
- [ ] Exercise stats sheet: open two different exercises in quick succession → second exercise's data shown (U18)
- [ ] Exercise stats sheet: with network throttled to offline, open the sheet → error message shown, no blank chart (U19)
- [ ] `pnpm build` — no type errors introduced by inflight map changes in cache.ts

### Post-deploy checks on device

- Switch sessions in an active workout on the phone → no stale sets persist
- Food logger: double-tap the log button quickly → single entry (hard to reproduce in dev)
- Sync: go offline mid-workout, log sets, reconnect → sync completes without silent failure

### Railway deploy notes

- No migrations — zero-downtime deploy
- Risk level: **low** — targeted bug fixes, no data model changes

---

## Sprint 4 — UI / Accessibility

**Branch:** `feat/ui-accessibility`  
**Based on:** `main` (no dependencies on prior sprints except Sprint 0)  
**Plan reference:** `docs/superpowers/specs/2026-06-02-combined-uplift-periodization-design.md` → Phase 3

### What ships

| Item | File | Change |
|------|------|--------|
| U14 | `set-card.tsx`, back buttons, week-day tiles, metric tiles | `aria-label` on icon-only buttons |
| U15 | `food-logger-sheet.tsx` | Back-navigation `prevStep` stack |
| U16 | `assign-step.tsx` | Meal-type chips + quantity buttons `min-h-[44px]` |
| U17 | `capture-step.tsx` | Recent-items `min-h-[48px]` |
| U24 | `components/workout/timer-ring.tsx` | SVG `min(60vw, 220px)` |
| U25 | `components/ui/weight-dial.tsx` | Height `35vh` capped at 320px |
| U26 | All screen headers/footers | `pt-safe`/`pb-safe` safe-area padding |
| U27 | `stats-content.tsx` + content screens | `<h2>`/`<h3>` semantic headings |
| U28 | `nutrition/meal-type-manager.tsx` | `@dnd-kit` drag-to-reorder meal types |

### Local verification (before merging)

- [ ] `pnpm build` passes
- [ ] Dev browser (responsive mode, S25 Ultra viewport): no layout clipping from safe-area padding changes
- [ ] Dev browser: timer ring scales correctly at narrow and wide viewports
- [ ] Dev browser: weight dial height adapts when viewport height changes (drag browser window taller/shorter)
- [ ] Dev browser: meal type drag-to-reorder works with mouse drag
- [ ] Dev browser: food logger back button traces correct step history through multiple steps
- [ ] Dev browser: inspect rendered HTML — section headers use `<h2>`/`<h3>`, not `<div>`

### Post-deploy checks on device (device-required for this sprint)

- Rep ± buttons and other icon-only buttons: verify tap targets feel comfortable with a thumb
- Meal-type chips and recent-item rows: no accidental taps during normal scrolling
- Timer ring: doesn't clip or overflow on the S25 Ultra screen
- Weight dial: height feels right in proportion to the phone screen
- Safe-area padding: no content hidden behind notch/nav bar gestures

### Railway deploy notes

- No migrations — zero-downtime deploy
- Risk level: **low** — visual/accessibility changes only
- Note: safe-area padding changes (U26) are the highest regression risk in this sprint — check all screens for overflow or misalignment on device

---

## Recommended Execution Timeline

```
Week 1:  Sprint 0 (Security) — ~1-2 hours implementation, no migrations
         Sprint 3 (Functional Uplifts) — develop in parallel on separate branch
Week 2:  Sprint 1 (Block Periodization) — largest sprint, ~1 day
Week 3:  Sprint 2 (Program Wizard) — largest UI sprint, ~1 day
Week 4:  Sprint 4 (UI/Accessibility) — polish sprint when above are stable on device
```

Merge one sprint at a time. Never merge multiple simultaneously — a Railway deploy that touches two unrelated sprints makes post-deploy issues hard to isolate.

---

## General Rollback Procedure

If a post-deploy regression is found on device:

1. `git revert -m 1 <merge-sha>` on `main` locally
2. `git push origin main` — Railway redeploys within ~2 minutes
3. If a migration was included and the DB state is suspect, apply a compensating migration manually via Railway's psql shell — never reverse a migration automatically

---

## Open Items (Not Scheduled)

These require their own design passes before implementation:

- **Cache invalidation after config save** (KI #1) — invalidation strategy undecided
- **Workout state lost on page refresh** (KI #2) — resilient persistence design needed
