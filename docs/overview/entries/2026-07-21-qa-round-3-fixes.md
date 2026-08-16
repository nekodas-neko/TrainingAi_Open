## 2026-07-21 — QA round 3: muscle hero, sleep score, workout buttons (v1.195.3)

**Branch:** `fix/qa-round-3` — a third pass of on-device QA from the owner. All bug fixes for
features already on `main`.

- **Muscle Status card moved to the top of the Body tab.** The owner wanted the **"Muscle Status"
  body-figure card** (`InjuryCard` — muscle recovery map + injury tracking), which sat at the bottom
  under the "Injuries" section, pinned at the top of the Body tab. Removed `"injury"` from the bottom
  `BODY_GROUPS` "Injuries" group and rendered it via the pinned hero slot instead
  (`app/health/health-content.tsx`). (An earlier attempt wired the *other* muscle card —
  `BodyMuscleCard` "Muscles Worked This Week", whose `muscleMap` case only existed in the Training
  renderer — to the top; that was the wrong card and was reverted.)
- **Sleep score showed the frozen Oura Cloud value.** `readiness-score/route.ts` returned
  `ouraToday?.sleepScore ?? sleepScore100` — Cloud-first. Since the BLE re-key the Cloud sleep score
  is frozen (it read **31** next to a real 7h45m / 90%-efficiency / good-HRV night), while
  `sleepScore100` comes from our own `computeSleepScore(lastSleep)` off the same fresh BLE session.
  Flipped to `sleepScore100 ?? ouraToday?.sleepScore` (derived-first), matching what
  `/api/health/trends` already does — the two routes previously disagreed, so the hero number could
  contradict its own sparkline. (`app/api/readiness-score/route.ts`)
- **Workout Run / Log Activity buttons were invisible.** `bg-muted` with no border on the dark page.
  Added a border, lighter fill, and press feedback. (`app/workout-select/workout-select-content.tsx`)

### Not changed (explained instead)
- **Workout carousel dots "too big".** The shipped code renders them at 6px (a small pill/dot); the
  owner's screenshot shows large circles because the on-device WebView was serving a **stale cached
  bundle** (their More screen showed "Update available · 2 generations cached"). No code change — a
  reload picks up the small dots. Re-check after the deploy.
- **Hypnogram "gone" on the night-detail sheet.** `components/health-metric-sheet.tsx` still renders
  the `Hypnogram`, but gates it on `sleepPhase5Min`; a BLE night without a synced per-5-minute phase
  string falls back to the flat stage-proportion bar. Not a regression — a data-availability gap.
  Restoring hypnograms on BLE nights needs BLE sleep-stage decoding (separate, unscoped).

### Also fixed here (unblocking): red `main` again
`main` was failing the Tests check a second time: #725 added a **v18** local-SQLite migration
(drop+recreate the Oura calculated-form tables with the corrected bucket PK) but left
`migrations.test.ts` asserting **v17** — the same stale-green parallel-merge pattern as the
v16→v17 case. Bumped the assertion to 18 and added a v18 check. (Noted separately: the
`oura-ble-daily-summary` test is a non-deterministic parallel-DB-race flake — it passed in #726's CI
and on a clean local re-run; not touched here.)

### Verification
- `tsc --noEmit`, `eslint` (0 errors) on changed files, `pnpm test` (**1914 passed**) on a fresh CI-style
  DB, `pnpm build` implied by CI. The readiness-score sleep-precedence unit test still passes.
- Device caveats: the muscle hero's `MuscleHeatmap` on Samsung's WebView compositor and the button
  contrast are **not device-verified** in the sandbox (insets/compositor render as no-ops). The sleep
  score fix is server-side and web-verifiable.
