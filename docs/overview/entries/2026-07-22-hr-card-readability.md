## 2026-07-22 — Heart & Recovery card readability fix (v1.200.2)

**Branch:** `claude/hr-workout-data-recording-ij3kwh` (fresh from `main`). Owner reported the HR section
was hard to read — a screenshot showed **`--21 bpm/60s`** for "Rest recovery".

### Cause
`components/workout/exercise-hr-trend-card.tsx` prepended a hardcoded `−` to `avgDrop60`, assuming the
drop is always positive. When HR *rose* during rest (common for a low-cardio lift — the screenshot was
Barbell Hip Thrust, peak only 99 bpm), `avgDrop60` is negative, so the display became `−` + `-21` =
`--21`. Same in the per-%1RM table.

### Fix (UI only, no data/logic change)
- New `hrChange(n)` helper renders the drop as a **direction arrow + magnitude**: `↓N` (HR fell =
  recovering, cyan) / `↑N` (still climbing, amber) / `0` / `—`. Never emits a double sign.
- Added a **legend** ("↓ HR fell during rest (recovering) · ↑ still climbing") and a plain-English
  footer ("A bigger drop = your heart settles faster between sets").
- De-jargoned labels: "Rest recovery" → "HR settled in 60s rest"; "HRR by rest end" → "Recovered by
  next set"; table "Drop/60s" → "Settled/60s", `n=7` → `×7`, peak column shows `bpm`.

### Verification
- `tsc` + `eslint` clean.
- **Playwright (Chromium) in dev**: opened the card via the Health → Training calendar; confirmed **no
  `--` double-dash**, and both `↓`/`↑` arrows render (seeded a negative-drop row to exercise the amber
  `↑` path). Screenshot reviewed — reads clearly in light theme. On-device paint/theme remains the
  standing device-gated check.
