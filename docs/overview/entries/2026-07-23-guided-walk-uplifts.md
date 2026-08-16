## 2026-07-23 — Guided walk uplifts: calibration, preset feedback, confirm-exit (v1.205.1)

**Branch:** `claude/guided-walk-uplifts-1gou5m` — owner used the guided interval walk for the
first time and filed 10 notes. Three small, low-risk fixes shipped in this session; the
remaining 7 (large — GPS/map/speed/cadence, HR chart with phase shading, Android status-bar
pill reuse, reactive walk/jog notifications, steps, per-phase speed/HR stats) were written up as
a phased plan and backlog entry rather than built blind, per the backlog-driven process.

### What shipped

- **HR-zone calibration fix.** The fast/slow bpm targets shown during the walk (e.g. "target
  ≤112 bpm") were computed from fallback defaults — 190 bpm max HR, 60 bpm resting HR —
  instead of the walker's real physiology, making the fast target (~70% HRR) require jogging
  rather than a brisk walk. Traced to `app/activity/guided-walk/page.tsx` always passing
  `hrMaxObserved: null`. Fixed by wiring in the max of the last 90 days'
  `body_battery_daily.hr_max_observed` via `repo.getBodyBatteryHistory()` — a real signal that
  already existed but wasn't reused here. **Confirmed against source research (Nose et al.
  Interval Walking Training, Mayo Clinic Proceedings 2007): the app's existing 70%/40% HRR
  split already matches the protocol's ≥70%/~40% VO2peak targets** — no formula change needed,
  only the input calibration.
- **Preset-button feedback fix.** The owner reported the "Standard"/"Quick" preset buttons
  "did nothing" when tapped. Root-caused via a dev-server Playwright walkthrough (not
  guessed): the owner's actual completed walk ran as 3 sets / 18 min, matching the "Quick"
  preset exactly — the tap **did** work, it just had zero visual feedback (no selected-state
  highlight, no tap animation/haptic), unlike every other button in the app. Fixed in
  `components/guided-walk/walk-config.tsx`: the preset matching the current config is now
  highlighted, and taps get `active:scale-95` + `hapticLight()`.
- **Confirm-exit dialog.** Ending a walk (or navigating away mid-walk) had no confirmation,
  unlike the workout screen. Added `components/guided-walk/leave-walk-dialog.tsx` (mirrors
  `LeaveWorkoutDialog`) and wired it into all three surfaces the workout screen already
  guards, per the sibling-surface sweep rule: the in-screen "End walk" button
  (`walk-active.tsx`), the bottom-nav tab-away guard (`bottom-nav.tsx`), and the hardware
  back-button guard (`mobile-auth-handler.tsx`). Added `isGuidedWalkActive()` to
  `guided-walk-store.ts` mirroring `isWorkoutActive()`.
- **Plan + backlog entry (docs-only)** for the remaining 7 notes:
  [`docs/superpowers/plans/2026-07-23-guided-walk-uplift.md`](../../superpowers/plans/2026-07-23-guided-walk-uplift.md).
  Investigation found most of the GPS/map/speed/elevation ask is **wiring, not new
  infrastructure** — `lib/activity/gps-tracking.ts`, `activity-metrics.ts`,
  `activity-route-map.tsx`, and every needed `activity_logs` column already exist for the
  regular (non-guided) activity flow and just aren't connected to the guided walk yet. Cadence
  is the one genuinely new sub-feature (no formula/data source exists anywhere) and is flagged
  as an open decision in the plan. The Android status-bar pill reuse is native Kotlin work
  requiring an owner APK rebuild.

### Verification

- `tsc --noEmit` clean (2 pre-existing, unrelated `onnxruntime-web` errors only); `eslint`
  clean on every touched file.
- **Live dev-server pass** (Playwright-driven, not just manual click-through): logged in as the
  seeded test user, confirmed the preset buttons now highlight and update the Sets/Total
  fields live, confirmed the "End walk" button opens the confirm dialog with working
  Cancel/Confirm paths (cancel returns to the active walk; confirm reaches the "Walk complete"
  summary), and confirmed the guided-walk page still renders correctly with the new
  `getBodyBatteryHistory` query wired in (no errors in the seeded dev DB, which has no
  `body_battery_daily` rows yet — falls back to the same default as before, as expected).
- Not device-verified: the confirm-exit dialog's hardware-back-button path
  (`mobile-auth-handler.tsx`) can only be exercised on the APK — same standing gate as the
  existing workout-screen back-button guard it mirrors.

### Next

Work the plan phases in `docs/implementation-backlog.md` top-down (A → B → C → D → E) in
future sessions — Phase A (GPS/map/speed/elevation) unblocks B and E and should go first.
