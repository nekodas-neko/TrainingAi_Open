# Guided walk: Android status-bar pill for phase + countdown (v1.241.0)

Phase D of the guided-walk uplift plan — the last item from the owner's original screenshot
report ("not seeing the time for the interval phases being shown on the Samsung pill view").

## What shipped

`walk-active.tsx` now reuses the existing `AndroidRunChip` native bridge (`window.AndroidRunChip`,
exposed by `MainActivity.java`, already wired for the prescribed-duration running chip) instead of
adding a new Kotlin plugin. Its "duration" mode already does exactly what a walk phase needs:
counts down to a target instant, flips to count-up if that instant passes. The screen re-anchors
the chip on every phase transition (`segment.index` changes), with the phase name as the label —
"Fast — set N of M", "Slow — set N of M", "Warm up", "Cool down" — and the phase's `endSec` (offset
from `startedAtMs`) as the countdown target.

Reused the existing `ta_pref_run_chip` preference toggle (relabeled "Run/Walk in Status Bar" in
Profile > Preferences) instead of adding a third chip-specific preference — the underlying
mechanism, notification slot, and toggle are already shared infrastructure for "a live activity
status pill," and a guided walk is exactly that.

## What was investigated and not built

The backlog item flagged "per-phase color" as needing feasibility investigation. `AndroidRunChip`'s
duration mode only tints on overtime (red) — there's no fast/slow color hook, and adding one would
mean new Kotlin (a color parameter threaded through `startClock`/`postRunClockNotification`). The
chip's text label already distinguishes phases by name, which satisfies this project's
no-color-only-state rule on its own, so color differentiation was left out as a nice-to-have beyond
the original ask rather than justifying new native code for it.

## Verification

- `pnpm lint` — 0 new errors (119 pre-existing warnings, unchanged)
- `tsc --noEmit` — clean
- `node scripts/check-reconcile.js` / `check-push-mutations.js` — clean (no schema/sync changes in
  this PR — pure client-side native-bridge wiring)
- Targeted vitest run (`lib/walk`, `components`) — 48 passed
- Dev-server Playwright smoke: signed in, opened `/activity/guided-walk`, started a walk with mocked
  geolocation, confirmed the active-walk screen renders the phase name/countdown UI with **no new
  console/page errors** — `window.AndroidRunChip` is undefined in the web sandbox, so
  `startRunClockChip`/`stopRunChip` no-op silently, exactly as designed for the run screen this
  reuses.
- **Not verified:** the actual native chip — real promoted-notification rendering in the Android 16
  One UI Now Bar, the phase-to-phase re-anchor, the tap-to-reopen intent, and the countdown→overtime
  color flip. No Kotlin was changed in this PR, only its existing JS wrapper (`run-status-chip.ts`)
  was called from a new call site, but on-device is still the only way to confirm the pill actually
  shows and updates correctly for a guided walk specifically (as opposed to a run). Flagged in a new
  Known Issues row in `projectOverview.md`.

## Files touched

- `components/guided-walk/walk-active.tsx` — chip re-anchor effect on phase change
- `components/more/profile-tab.tsx` — relabeled the shared toggle to mention walks
- `docs/implementation-backlog.md` — struck the Phase D backlog item
