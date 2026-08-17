## 2026-08-17 — an ai_dynamic deload that fell into the catch-all branch was a deload in name only (Q-310, v1.317.4)

**Owner report (2026-08-17), two screenshots:** an active Sumo Deadlift set headed
"Pull · Deload · S2 · Ex 1/5", and the exercise summary right after it showing a
"New Personal Record!" badge with the estimated 1RM up 15.5 kg. *"it still reccomended deload
again - and the weights are increasing the PR."*

### Root cause

`/api/workout-data` resolves an ai_dynamic session's phase status through four branches in order:
AMRAP baseline, an early-deload week confirmed from Home, the `?aiDeload=1` toggle, then a catch-all
for everything else. The catch-all existed in **two verbatim copies** (the per-session-summary loop
and the single-session path) and both hardcoded `isDeloadActive: false` / `phaseType: 'normal'`, on
the belief — stated in the comment above them, "not baseline, not deload" — that a deload could only
reach the branches above.

It can't be. When the AI periodization engine picks `phase: 'deload'` off accumulated fatigue,
nobody confirms anything, so the catch-all is the *only* branch left to catch it. The label read
"Deload" because it is title-cased from `aiPeriodizationState.phase` — the same field the flag
beside it ignored.

### What the flag actually controlled — measured, not assumed

Production (`claude_ro`, owner-scoped) held two sessions stamped `phase_type = 'deload'` in the last
60 days: 2026-08-09 Pull and 2026-08-16 Pull, the day before the report. Both carry
`max(estimated_1rm) = 0` across their five exercise logs, and `personal_records` has **no row dated
either day** (latest are 08-15, 08-13, 08-12). So of the three symptoms the entry predicted:

1. **Weights stayed at full intensity — real.** `buildWorkoutExercises` receives
   `isDeloadActive: sessionPhaseStatus?.isDeloadActive ?? false`, so no reduction ran, and neither
   the prescribed nor the un-prescribed deload branch in `session-data.ts` was reachable.
2. **A `personal_records` row was written — refuted.** `logExerciseFromPayload` reads
   `session_periodization` itself and sets `currentPhaseType = 'deload'` independently of the route,
   so the server zeroed the estimate and wrote no PR. What the owner saw was the **client's**
   optimistic display: `workout-screen.tsx` derives its `isAnyDeload` from this route's flag, so it
   computed a full-intensity estimate, flashed the badge, and wrote that estimate into the local
   SQLite store while the server stored 0. **No corrective migration is needed** — that was item 3
   of the entry's fix direction, and this is its answer.
3. **The deload never resolved — follows from (1).** No intensity reduction ever happened, so the
   fatigue signal that triggered the phase was never addressed.

The entry's second half — that `exercise-summary-screen.tsx`'s `isNewPR` needs its own deload gate —
is **also refuted, and deliberately not built**. `estimateOneRm` returns exactly `0` when
`deloaded`, and the badge already gates on `newEst1rm > 0`. There is no "submaximal-adjusted
estimate that still happens to exceed the bar"; on a correctly-flagged deload the number is zero.
The badge needs no change, and `components/` is another lane's surface.

### What shipped

- `aiDynamicFallbackPhaseStatus()` in `packages/shared/src/workout/session-data.ts` — one helper
  replacing both copies, deriving `isDeloadActive` and `phaseType` from `phase === 'deload'`. Two
  identical copies of the same 17 lines is what let one bug be written twice; One Formula, One Place.
- `app/api/workout-data/route.ts` calls it from both sites.
- `packages/shared/src/workout/__tests__/ai-dynamic-fallback-deload.test.ts` — 7 tests across the
  helper and the three downstream consequences (prescribed load, the `exerciseDeloaded` flag, the
  `shouldCountTowardPr` gate, the zeroed estimate the badge reads). **Mutation-checked:** reverting
  `isDeload` to a hardcoded `false` fails 5 of the 7.

It incidentally closes the missing-stamp half of Q-298 **for this path**: with the flag right,
`buildWorkoutExercises` marks the exercise `deloaded`, the client sends `exerciseDeloaded: true`,
and the row stamps. Q-298's own entry covers the historical rows and stays open.

### Verification

Full local gate on `pnpm dev` against the local Postgres, with the seeded program switched to
`ai_dynamic` and a `session_periodization` row at `phase: 'deload'` (both reverted afterwards):

- `GET /api/workout-data?session=<pull>` → `name: "Deload"`, `phaseType: deload`,
  `isDeloadActive: true`, all three exercises at 50% × 2 sets with `deloaded: true`.
- `GET /api/workout-data?session=all` → the same for Pull; Push and Legs (no periodization row)
  unchanged at 75% × 3 sets. Both fixed copies exercised.
- A non-deload phase through the same branch (`phase: 'accumulation'`) → `"Accumulation"`,
  `phaseType: normal`, `isDeloadActive: false`, full load. No regression.
- `POST /api/log-exercise` on the deload session → `estimated1rm: 0`, `isPR: false`; the stored row
  has `estimated_1rm = 0`, `exercise_deloaded = t`, `phase_type = deload`, and the pre-existing
  Barbell Deadlift PR (160 kg) is untouched.
- `npx tsc --noEmit` clean · `pnpm lint` 0 errors (122 pre-existing warnings, none in the touched
  files) · `pnpm build` green · `pnpm check:rules` **Ran 36 of 36** · full suite 477 files /
  3,893 tests passed, 2 files / 54 tests skipped.

### Not exercised

- **On device.** Server/JS only — no `android/**` or `capacitor.config.ts` change, so this reaches
  the APK through the Railway deploy with no rebuild. The client half (`workout-screen.tsx` reading
  `phaseStatus.isDeloadActive`) was verified by reading the response the route now returns, not by
  running the WebView; Samsung rendering and safe-area were not touched and not checked.
- **The local SQLite divergence during the bug window.** Rows the device wrote with an inflated
  `estimated1rm` are corrected on the next pull (`applyDelta` overwrites once `sync_status` is
  `synced`), but that self-heal was not observed on hardware.
- **Real prod data.** The production check was read-only over `claude_ro`, which is scoped to the
  owner's rows — it says nothing about other accounts.
