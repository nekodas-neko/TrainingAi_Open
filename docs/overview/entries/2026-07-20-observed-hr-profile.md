# 2026-07-20 — Robust observed heart-rate profile (min/max/avg + %-of-max)

**Branch:** `claude/handoff-documentation-w1ud2j` · **Version:** 1.182.0

Owner request: show current min/max/avg HR from recorded data (not a one-off reading — a lone 200 bpm
can't be the max), the observed max recorded vs the age-estimated max, and effort as % of the current
max.

## What landed

- **`lib/health/observed-hr.ts`** — `computeObservedHr(bpms)`: drops physiologically implausible readings
  (30–220 bpm band), then reports a **corroboration-gated** max/min — the max is the *k*-th highest
  reading (k=5), so up to 4 stray spikes are ignored ("your max is a level you've genuinely reached").
  Returns `{ min, max, avg, sampleCount, isReliable, spikesRejected }`. `resolveMaxHr` picks the observed
  max only when it's reliable AND ≥ the age estimate (a low observed max just means you haven't gone hard
  on a monitored session — it never drags the ceiling down). `pctOfMax` for effort %.
- **`/api/hr-profile`** — now also returns the observed profile over a trailing 90-day window (from
  `getHrForWindow`), the age `estimatedMax`, and the resolved `workingMax` + `workingMaxSource`.
- **`components/health/observed-hr-card.tsx`** — cache-seeded card on the Heart Rate page showing
  max/avg/min + which max anchors effort, with a "not enough data yet → using estimate" state and a
  "N stray highs ignored" note. Explicit fetch-failure state.

## Verification

- 12 new unit tests (spike rejection, sensor-error filtering, reliability floor, observed-vs-estimated
  resolution, %-of-max). tsc + lint clean; full suite green (1875).
- End-to-end on real Postgres: inserted 121 HR rows incl. a 205 spike → `getHrForWindow` +
  `computeObservedHr` returned max 150 (spike rejected).
- **NOT device-verified:** the card render on the Samsung WebView, and the live "%-of-current-max" during
  a workout (needs live HR) — Known-Issues-gated, per Canonical Runtime.
