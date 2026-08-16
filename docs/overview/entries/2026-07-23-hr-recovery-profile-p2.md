## 2026-07-23 — HR Recovery Profile, Phase 2 (v1.203.0)

**Branch:** `feat/hr-recovery-episodes` — continuing the backlog HRP items in the same session as P1.

### What shipped
The HR Recovery Profile card (shipped v1.202.0) now also includes recovery from **completed
workouts** (any Oura-classified workout, e.g. a run), not just between-set lifting rests.

- **`lib/health/hr-episode-detection.ts`** — `detectWorkoutCooldownEpisode(readings, workout,
  restingHr)`: one recovery episode per completed workout, its peak HR during the effort window →
  decline into the rest after (mirrors `set-hr-stats.ts`'s peak/drop-curve shape, applied at
  whole-workout instead of per-set granularity; re-implemented rather than refactoring the shipped,
  tested per-set closures — flagged as a documented future-unification opportunity, not silently
  duplicated). Coverage-gated (never fabricates an episode from too few samples), pure, no throw.
- **Route wiring**: `GET /api/health/hr-recovery-profile` now also fetches `getOuraWorkouts` for the
  window, bounds to the **60 most recent** workouts (avoids unbounded query fan-out on a heavy
  history), fetches each workout's bounded HR window in parallel, and merges the resulting episodes
  with the existing `set_hr_stats` ones before aggregating.
- **Source-mix transparency**: `BandSummary` gained a `bySource` breakdown (episode count per
  source). The card now shows "Mixed: 2 lifting, 1 workout" under any band combining sources, and the
  disclaimer was updated to explain what that means — surfacing the posture/modality confound the
  spec (§6) calls the single biggest risk, rather than silently averaging different kinds of effort
  together.

### Explicitly out of scope (documented, not dropped)
True **within-run interval-rep detection** (multiple peak/decline cycles inside one continuous run,
e.g. a fartlek) is NOT implemented. The running system has no execution-time segment tracking to
anchor on (confirmed via research: no interval-rep start/end data exists in the schema), and a
general-purpose multi-peak detector over unconstrained, noisy HR is exactly the highest-risk,
lowest-value piece the spec warns against building first. Queued as **HRP-2b** in
`docs/implementation-backlog.md` rather than bolted onto this phase's single-episode detector.

### Verification
- `tsc` + `eslint` clean (two real lint errors — unescaped quotes in new card copy — caught and
  fixed). Full suite: **292 files / 2023 tests passing** (11 new detector tests + 2 new aggregator
  tests for `bySource`).
- **Live dev-server pass** with real inserted data: a synthetic 30-min run workout + HR readings
  ramping to a 175 bpm peak and declining through the cooldown. `GET
  /api/health/hr-recovery-profile` correctly returned a `170+` band with `bySource: {set_rest: 2,
  run_cooldown: 1}` merged with existing lifting episodes. **Playwright screenshot** confirms the
  card renders the "Mixed: 2 lifting, 1 workout" label and the updated disclaimer. Test data cleaned
  from the local dev DB after verification.
- Not device-verified (standing gate, no new risk class — read-only, no schema change).

### Next
HRP-3 (month-over-month trend + `getHrRecoveryProfile` AI-chat tool) remains queued.
