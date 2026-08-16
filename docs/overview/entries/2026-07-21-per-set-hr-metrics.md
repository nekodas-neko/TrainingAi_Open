## 2026-07-21 — Per-set / per-exercise HR metrics (v1.197.0)

**Branch:** `claude/hr-workout-data-recording-ij3kwh` — owner-directed. Plan:
[`docs/superpowers/plans/2026-07-21-per-set-hr-metrics.md`](../../superpowers/plans/2026-07-21-per-set-hr-metrics.md).
Planning + implementation landed together (single owner request to scope **and** build). Backlog
entry HR-A/HR-B removed as shipped.

### What shipped
Full-granularity workout HR analytics. All raw ingredients already existed (`oura_heartrate` 1 Hz
during workouts, `set_logs` timing + actual/planned %1RM, `exercise_logs` identity); the gap was that
per-set HR was recomputed transiently on the recap and discarded, with no durable store or trend
surface. Now:

- **`set_hr_stats` (migration 139)** — durable per-SET snapshot, sibling of `workout_hr_stats`. Keyed
  by `set_log_id`, denormalised trend dims (exercise/phase/%1RM), server-derived (NOT an offline-sync
  domain), **not pruned** — so per-set/per-exercise HR detail survives the 180 d `oura_heartrate` prune.
- **`lib/workout/set-hr-stats.ts`** — the single per-set HR formula: peak/avg over the true working-set
  window (proxy fallback for pre-timing sessions), the **rest-bounded** drop curve (30/60/90/120 s), the
  trough, **three time-to-recover models** (return-to-pre-set-HR, return-to-resting-HR, %HRR-recovered —
  owner chose "capture all three"), and a coverage gate. Censoring is explicit (`recovered_*` bools) so
  "didn't recover within the rest taken" ≠ missing data. Reuses `analyseHrRecovery` for the
  nearest-reading helper / proxy-peak / rest-adequacy — hrr1 is not re-implemented (One Formula, One
  Place). Note: persisted `drop60s` is rest-bounded, so it differs from the session summary's classic
  unbounded HRR1 only when a rest was < 60 s.
- **`computeWorkoutHr`** now also resolves the HR baseline (`resolveHrProfile`), joins rich set details,
  runs the formula, and returns `setHrRows`; the recap route (`/api/oura/hr-data`) persists them
  fire-and-forget (same fuller-wins COALESCE contract as the workout snapshot). Admin backfill
  `/api/workout/backfill-set-hr-stats` materialises them for existing in-window sessions, exposed as a
  one-tap card (`components/admin/set-hr-backfill-card.tsx`) under Admin → Tools → Additional tools
  (loops the bounded oldest-first passes until the window is drained).
- **`lib/workout/exercise-hr-trend.ts` + `GET /api/workout/exercise-hr-trend`** — derive-on-read rollup
  to per-session points + per-%1RM buckets (SWR headers + rate limit at creation).
- **`components/workout/exercise-hr-trend-card.tsx`** — a cache-seeded, memoised "Heart & Recovery" card
  on the exercise-history sheet: avg peak HR, rest recovery (60 s drop), %HRR tiles, peak/recovery
  sparklines over time, and the per-%1RM breakdown. Carries a load-bearing **cardiovascular-only**
  disclaimer (not CNS/neuromuscular readiness — the owner's explicit caveat). Scope was **record +
  display + insight only** (owner choice) — no in-session rest-timer change.
- **AI chat access (HR-C, owner-requested during the session — "the AI is our core feature, give it as
  much context as possible")** — `getWorkoutHrTrends` tool in `lib/ai-chat/tools.ts` (+ a nudge in the
  ai-chat system prompt so the model knows the stream exists). Two modes off one `getSetHrStatsSince`
  read: a **cross-exercise overview** (`summarizeHrByExercise` — one row per lift so the AI can answer
  "which recovers slowest" in a single call) and the **detailed single-exercise** view (fuzzy name match
  → `aggregateExerciseHrTrend`). The tool description spells out the cardiovascular-only framing and the
  metric directions (bigger 60 s drop = faster recovery; falling peak HR at the same weight = possible
  fitness gain) so the model reasons correctly and doesn't drift into CNS/readiness advice.

### Verification
- `pnpm exec tsc --noEmit` clean; `pnpm lint` (0 errors on changed files); `pnpm build` green (after
  restoring the sandbox-missing `onnxruntime-web` dep — pre-existing env gap, unrelated).
- `pnpm test`: full suite 1941 passing (the one failing suite, `wasm-parity`, is the pre-existing
  `onnxruntime-web` import gap, green on CI). New tests: **19** — the formula (fully-worked single set +
  censoring/sparse/missing-timing/horizon-bounding edges), the trend aggregator, a DB round-trip
  (rich-set query, fuller-wins upsert, per-session/per-exercise reads, missing-list), and a
  `computeWorkoutHr` integration seam against local Postgres.

### NOT verified on device (Known-Issues row added)
The "Heart & Recovery" card's on-device look / safe-area within the bottom sheet and Samsung WebView
SVG sparkline rendering were web-verified only (the web sandbox can't run native SQLite/BLE and renders
insets as 0). The capture→persist→trend **data path** is fully sandbox-tested. Run
`docs/device-smoke-checklist.md` on the S25 for the card surface. Live capture is already exercised by
the existing HR-ingest pipeline; this change only reads the series it already stores.
