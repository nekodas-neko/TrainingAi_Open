# 2026-08-05 — Guided Walk shows as "Guided Walk" on the timeline, not generic "Outdoor walking"

**Domain:** cardio — v1.266.5, JS-only (no APK rebuild)

## The report

Owner: a walk done via the app's Guided Walk feature appears on the home "Today's Timeline"
labeled "Outdoor walking / 1.96 km / 24 min" instead of being identified as a Guided Walk.

## Root cause (Q-94)

Not a data-pipeline gap — a display-collapse bug. A guided walk is saved with `title: 'Interval
walk'` and a `segments` JSONB column (migration 161) that **only** a guided walk ever populates.
Both already reach `app/api/day-timeline/route.ts` intact via `repo.listActivityLogs`. The label is
discarded there: a keyword-collapse step (`` `${log.title} ${log.activityType}`.toLowerCase() ``)
flattens every walk-type activity to a bare `'Walk'` before `home-day-timeline.tsx`'s `WalkCard`
maps that generic label to "Outdoor walking".

## The fix

Checked `log.segments != null` before the generic keyword collapse in `day-timeline/route.ts`,
emitting `'Guided Walk'` directly for that case. Turned out to need no other changes:
`home-day-timeline.tsx`'s `WalkCard` already falls through to rendering `ev.title` verbatim for
any title that isn't literally `"Run"` or `"Walk"`, and `app/health/timeline/page.tsx` (the second
timeline renderer flagged as a sibling surface) always renders `event.title` directly with no
mapping at all. Fixing the one upstream label-collapse step closes both surfaces.

## Verification

Typecheck and lint clean. Reproduced against `pnpm dev`: seeded a guided walk (with `segments`,
1.96 km / 24 min) and a plain walk (no `segments`, 1.5 km / 20 min) for the same day, then hit the
real `GET /api/day-timeline` route. Before the fix both would read `title: "Walk"`; after, the
guided walk reads `"Guided Walk"` and the plain one still reads `"Walk"` — confirmed the two are
now distinguished correctly.

Full suite: 400 files / 3,171 tests green except one pre-existing, unrelated flake
(`planned-pct-bodyweight-migration.test.ts`, a transient pool-contention "deadlock detected" —
passes cleanly alone, confirmed unrelated to this diff).

**Not exercised:** no on-device/native surface — server-side display logic reached via Railway with
no APK rebuild.
