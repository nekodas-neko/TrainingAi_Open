## 2026-07-28 — AI workout prescription: review, and six fixes

Owner-requested scrutiny of the whole prescription pipeline ("the AI workouts are the whole base of
our app"): how prescriptions are generated, how they're cached, whether the numbers are right, and
whether a per-day session length could be chosen. Production was audited read-only via
`POST /api/admin/db-query` throughout; every figure below is real history, not a fixture. Plan:
[`docs/superpowers/plans/2026-07-28-ai-prescription-review.md`](../../superpowers/plans/2026-07-28-ai-prescription-review.md).

### What the audit found

**The AI was driving load on 1 of 5 sessions.** Push/Pull/Upper/Lower all sat at
`pending` + `transition_recommended`, which `prescriptionDrivesLoad` excluded, so those sessions were
silently running the base progression style. Confirmed end-to-end from the owner's device: the
done-screen "Next workout" card rendered Bench 4 × 72.5 kg × 7 while the stored prescription said
4 × 5 @ 82.5 %.

**Three of those four were self-contradictory** — `phase_action: transition_recommended` with a
`phase` equal to the phase already in progress. `resolvePhase` only distrusted the model's phase on
`'stay'`, and nothing checked that a "transition" changed anything. Accepting one called
`advancePhase(<current>)`, resetting `sessions_in_phase` and regenerating — the block could never
complete. Not the phase-guard ceilings firing (accumulation cap is 6; counts were 3–5): the model
chose it, because the prompt stated eligibility floors as if they were triggers.

**The duration estimate was short on every session.** `estimateExerciseDurationSec` charged rest for
`sets − 1`, assuming the inter-exercise transition absorbed the last set's rest. Production says they
are separate clocks — on 2026-07-28 Push, 11.1 min set work + 26.0 min per-set rest + 13.2 min
inter-exercise gaps sum to the measured 52-min working window. That dropped rest cost ~7–8 min per
five-exercise session: stored estimates read 35–49 min while real working windows ran 41–65, and
**10 of the last 20 sessions ran past their 60-minute budget**.

**Four single-set exercises were live** (Legs Hip Thrust 1×9, Legs RDL 1×9, Pull Preacher Curl 1×10,
Lower Cable Crunch 1×10). The schema allowed `sets: min(1)` and the time-budget floor of 2 only
governs trimming.

**A soreness check-in could not reach the prescription.** The mood sheet invalidated the readiness
caches but not `workout-data` / `workout-card:` / `ai-periodization-session:`, which hold the plan at
a 6-hour TTL. And the server-side re-derivation was gated twice: only for a prescription generated on
an earlier day (never one from the completion-time regeneration), and only once per calendar date —
stamped by the *first read of the day*, so a check-in logged afterwards (the normal order) was
ignored too.

### Shipped (three commits)

1. **Prescriptions reach the bar, and are sized honestly.** `resolvePhaseAction` downgrades a no-op
   transition to `'stay'`; `normalizeStoredPrescription` applies the same correction on every read so
   the up-to-7-day-old stored rows are fixed rather than aged out. A pending transition now drives
   load (the phase change still needs consent; deload / swap / rest-day still don't). Rest is charged
   per set, and `prompt.ts` states the formula it is graded against. Model-authored sets floor at 2.
2. **Check-in wiring + the duration picker.** New `invalidateCheckinAffectsPrescription()` group,
   called from both check-in sheets. Both date guards replaced by `reevaluationKey` — a fingerprint
   of the inputs the re-derivation depends on, so repeat fetches still skip but a changed check-in
   can't be missed; the emergency-deload gap check now ignores a session completed after the
   prescription was generated (the `excludeSessionId` rule, previously unreachable here). Short /
   Standard / Long picker on the pre-workout screen: a generation parameter tagged onto the plan it
   produced, never written to the program, so it adds nothing to the sync surface. `dropToBudget`
   (short only) drops whole exercises when trimming to the floors still overruns — five exercises at
   two sets each still cost ~43 min, and two token sets of everything is worse training than doing
   fewer properly. `expandToBudget` (long only) adds sets to the muscle furthest below its weekly
   target, bounded by role ceilings and MRV headroom; it never runs on a standard session, because
   the duration model's conservatism *is* the finish-early margin.
3. **Done screen + HR recovery.** Six bare `fetch` calls → `cachedFetch` with seeds and registered
   invalidation. HR recovery is now one median figure per exercise with a `sampleCount/totalSets`
   ratio, shared between the done screen and the day-overlay sheet.

### Two pre-existing bugs surfaced while testing

- **The periodization GET is HTTP-cached for 60 s**, so *every* post-write refetch — accept, dismiss,
  transition, the regeneration poll — was answered from that window with the pre-write state. The
  card repainted stale; the duration switch looked like a no-op though the write had landed. Same
  class as the `?poll=1` → `no-store` fix on `workout-data` (v1.173.4). Refetches after a write now
  bypass it.
- **`/prescribe` was rate-limited at 10/hour**, sized when generation was automatic-only. Comparing
  all three presets spends three calls on its own → raised to 20, with a distinct message on 429.

### Verification

All 2 299 tests pass (24 new), `tsc` clean, lint clean (pre-existing warnings only), both Custom
Rules checks pass. Exercised against `pnpm dev` on the local Postgres with the program flipped to
`ai_dynamic` and the production bad state seeded verbatim:

- a stored no-op transition normalises to `stay` on read, and its numbers now drive the bar
  (82.5 %×5 rather than the base style); a genuine accumulation→intensification transition survives
  and drives load; `deload_recommended` still falls back to the base style;
- real Gemini generation end-to-end at all three presets — short 24 min (one accessory dropped),
  standard 40 min, long 58 min (capped by role ceilings, not budget) — with no single-set output;
- a soreness check-in logged **after** the first read of the day deloads the matching exercise
  (bench → 2×8 @52 %) and reverts when cleared;
- the picker in a real browser at 412 px, light and dark: switching Standard → Short repaints live
  (40 → 24 min) and the dropped exercise disappears from the card.

### NOT exercised — device-gated

Native SQLite / the mutation outbox, safe-area insets, Samsung WebView rendering, gestures,
notifications, live BLE. **The per-exercise HR recovery list is unit-tested only** — the local dev DB
has no heart-rate readings, so its rendering has never been seen with real data. The duration picker
and the done-screen cache-seeding are APK surfaces and need the on-device smoke run.
`docs/device-smoke-checklist.md` remains the authority.

### Version

1.230.0 (minor — new user-facing feature: the session-length picker).
