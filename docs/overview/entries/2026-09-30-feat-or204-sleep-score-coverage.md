# 2026-09-30 — OR-204: the Sleep Score says when its inputs were incomplete

**Lane A · `packages/shared/src/health/sleep-score.ts`, the readiness payload, the Body tab Sleep card.**

- **The owner's rule (Q-72, 2026-08-23):** *"If its missing data it shouldnt [score] differently
  [without saying so]. Depending on how much is missing."*
- **Engine:** `sleepScoreCoverage(components)` gives the present weight over 110 and three bands:
  - `full`;
  - `partial`, a quiet note;
  - `low`, once the missing weight reaches `hr` + `hrv` (28 of 110, a quarter of the model).

  It is attached to every `SleepScoreResult`. The score's computation is unchanged.
- **Payload and card:** `/api/readiness-score` carries `sleepScoreCoverage` (only for the app's own
  score, not an Oura fallback). The Sleep card shows "Partial data", or "Less complete: no HRV, heart
  rate" in amber (`sleep-coverage-note.ts`). No number, as the owner asked.
- **Verified:** band tests (latency only is partial; REM plus deep is partial; hr plus hrv is low),
  note tests, the health and readiness suites, and Custom Rules. `pnpm dev` on the owner's snapshot:
  today's night reads `full`, so no note shows.
- **Not exercised:** a partial night on screen, since none is in the snapshot's current window.
- **Q-72 keeps only the yardstick question** (whether he will rate sleep again).
