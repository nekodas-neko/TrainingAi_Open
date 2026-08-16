# 2026-08-07 — Removed the redundant "Interval walk" shortcut from Log Activity

**Domain:** activity — v1.269.2, JS-only (no APK rebuild)

## The report

Q-140, direct owner report: "this is the log activity section; doesn't need interval walk like
that cause guided [walk] exists."

## Confirmed redundant, safe to remove

`components/workout/log-activity-sheet.tsx` rendered a featured "Interval walk" button that called
`startGuidedWalk()` and navigated to `/activity/guided-walk` — but Guided Walk already has its own
separate, always-visible entry point on the Cardio Hub screen
(`components/cardio/modality-picker.tsx`), rendered alongside the "Other activity" row that opens
this same `LogActivitySheet`. `LogActivitySheet` is only ever opened from that one call site
(`components/cardio/cardio-content.tsx`), so removing its internal shortcut doesn't strand any
navigation path — Guided Walk stays reachable exactly as it was before.

## The fix

Deleted:
- The featured "Interval walk" button block.
- The `startGuidedWalk()` handler it called.
- The `router.prefetch('/activity/guided-walk')` call, which existed only to warm that route for
  the now-removed button.
- The now-unused `PersonSimpleWalk` import (confirmed nothing else in the file references it).

The sheet now shows only the plain activity-type grid it always had alongside the shortcut.

## Verification

`tsc --noEmit -p .` clean (only the pre-existing unrelated `voice-log-button.tsx` error). `eslint`
clean on the touched file. Full suite: 404 files / 3197 tests green (no test coverage exists for
this component, as expected — it's UI-only with no test file).

Verified via Playwright against `pnpm dev`: opened the Log Activity sheet from the Cardio Hub
screen's "Other activity" row and confirmed it now shows only the plain activity-type grid
(Walk/Run/Cycle/Hike/Swim/Yoga/Stretching/HIIT/Other/Treadmill) with no "Interval walk" button.
Confirmed the separate "Guided walk" card remains visible and untouched on the Cardio Hub screen
behind the sheet — the removal didn't strand the feature, exactly as predicted by the "only one
call site" analysis.

No on-device S25 verification — pure UI simplification, no native/safe-area/gesture involvement.
