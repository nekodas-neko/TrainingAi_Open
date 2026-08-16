## 2026-07-20 — Workout screen loading jank: kill the numbers→"Preparing"→numbers flash

**Branch:** `claude/workout-screen-loading-jank-l5efu6` · **Version:** 1.185.1 (patch)

### Problem (user report, with screenshot)
Opening the workout screen was not smooth: it painted the exercise list, then the whole list
was replaced by the full-screen **"Preparing your AI workout…"** takeover, then it swapped
back to the list once the AI prescription landed. The user had flagged the same "loads for a
second and shifts slightly" jank before.

### Root cause
The pre-workout screen paints the exercise list **instantly** from the `workout-data:<tab>`
sessionStorage seed (with `aiPrescriptionPending` defaulting to `false`). When the authoritative
`/api/workout-data` network response then reports `aiPrescriptionPending: true` (the session's
prescription slot was consumed by a completed workout and a regeneration is in flight), the
pre-workout screen swapped the already-painted list for a **full-screen "Preparing" takeover**,
then swapped back when the fresh prescription landed. That numbers → takeover → numbers
round-trip — a transition that *hides content already on screen* — was the jank.

Note `invalidateWorkoutSummaries()` (run on workout completion) clears `workout-data:all`/`:meta`
but **not** the per-tab `workout-data:<tab>` key, so the instant seed is stale-`false` right in the
window where the network says pending — which is exactly when the flash fires.

### Fix
`components/workout/pre-workout-screen.tsx`: removed the full-screen "Preparing" takeover branch.
The (base-program) exercise list now stays on screen the whole time; while a prescription is
regenerating, only the section heading swaps in place — "Recommended workout" → "Preparing your
AI workout…" (same one-line slot, so nothing reflows) — and the Start button is held as
"Preparing…" (already-existing behaviour), preventing a premature start on base numbers. When the
prescription lands the numbers refine in place. No content-hiding transition remains, so there is
no flash in the cold, warm-accurate, or warm-stale-cache cases.

### Verification
- `tsc --noEmit` clean; `eslint` clean on the changed file.
- Local `pnpm dev` (seeded `manual`-mode program): logged in as `test@local.dev`, `/api/workout-data`
  returns exercises with `aiPrescriptionPending: false`, `/workout?session=<id>` renders **200** with
  no server/console/runtime errors. The list-rendering JSX is byte-identical to before the change.

### Not exercised
- **The `aiPrescriptionPending: true` branch itself was not driven at runtime** — it requires an
  `ai_dynamic` program sitting in the transient `consumed` prescription state, which the local
  `manual`-mode seed cannot produce. The change to that branch is a pure in-place conditional
  (heading text + held Start button), verified by tsc/eslint and by the unchanged surrounding
  render. **Not device-verified on the S25 APK** (no device this session); it is a WebView
  rendering-only change (no offline-first/native/safe-area/gesture/notification surface touched).
