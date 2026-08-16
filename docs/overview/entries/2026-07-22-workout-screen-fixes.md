## 2026-07-22 — Workout & health UX batch (v1.196.0)

Owner-directed batch of workout-screen and health-screen fixes, filed on-device with screenshots.
All shipped in one PR (`claude/workout-screen-fixes-6213lj`).

### What shipped
1. **AI prescription refresh in place (no app reopen).** The `periodization` state that drives the
   AI Prescription card was fetched only on mount/session-change, so when generation finished the
   exercise weights refreshed via the poll but the card stayed frozen until a full remount — the
   reported "have to close and reopen the app". Extracted the fetch into a callable
   `loadPeriodization` (request-id guarded against out-of-order responses) and re-run it when the
   direct `/prescribe` POST succeeds, when the pending flag clears, and on manual refresh.
2. **Workout pills show category + intensity band.** AI-prescription rows and base pre-workout rows
   show a Main/Secondary/Accessory badge (from the engine role) and, on the prescription card, the
   %1RM training zone the working weight sits in (`lib/workout/intensity-zone.ts`).
3. **Home deload recommendation explains itself.** New expandable "Why this recommendation?" panel
   (`deload-explanation.tsx`) listing the real contributing signals and what Deload/Rest/Full mean.
4. **Per-factor deep-dives across the 4 health pillars.** New shared contributor guide
   (`lib/health/contributor-guide.ts`) + always-visible details section
   (`contributor-details.tsx`): each score factor shows what it measures / is measured against /
   your score means / how to improve, laid out below the bars (tap a bar to jump to it). Readiness
   returns the app's own per-factor composite sub-scores (`readinessCompositeContributors`); Sleep
   un-hid its now-app-computed contributors; Heart Rate gained a resting-HR + HRV explainer.
5. **End-of-workout Time Summary.** New `/api/workout-sessions/[id]/timing` + `TimeSummaryCard`:
   per-exercise setup (bar-load) / work / rest, actual vs planned, with a rest-budget headline.
   - **Bar-load capture:** new `prep_time_sec` column (migration 138) — seconds on the get-ready
     screen before the first set — captured from the ready-screen elapsed baseline, expected from
     the equipment transition estimate.
   - **Last set's rest:** the rest after the final set was never recorded (`restTimes` only got an
     entry when the next set started); now captured and attributed to the last set.
   - Fixed a latent gap: `getWorkoutSessionDetail`'s set-log reader dropped `plannedRestSec` and
     `rpe`; now mapped.

### Verification (sandbox)
- `tsc`, lint clean; workout + health + data + ai-periodization unit tests pass; `check-push-mutations` OK.
- Dev-server: `/api/readiness-score` carries the new composite field; `/api/workout-sessions/[id]/timing`
  returns correct actual-vs-expected for setup/work/rest against real DB rows (verified 285/240 setup,
  138/122 work, 450/360 rest); `/workout` + all four health detail pages render 200.

### NOT exercised in the sandbox (device-gated)
- The **timing capture paths** (prep timer, last-set rest) only run during a real device workout —
  the seed DB has no logged set-timing, so the card logic is verified but the on-device capture is not.
- **Readiness per-factor scores** are null until BLE daily-summary history exists; deep-dives render
  with guide text but no live score in-sandbox.
- Workout **category badges** and the **prescription-card refresh** only exercise their real paths on
  an `ai_dynamic` program on-device.
- Migration 138 is additive/nullable (safe).

### Follow-up (owner decision)
- Planned **work** time uses the standard set pace; could switch to the user's own measured
  `secPerRep` (time-profile) when history exists, labelled "your average pace". Rest and setup
  already use prescribed/equipment numbers.
