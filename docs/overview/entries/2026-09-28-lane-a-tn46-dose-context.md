# 2026-09-28 — TN-46: a flagged day names the recent dose, and dose-vs-vitals has a read

The owner wanted to "correlate change in vitals with reta" and delegated the design. The engine
half is built; the overlay chart is Lane B's.

**What shipped.**
- `packages/shared/src/health/dose-context.ts` finds doses in a 5-day window and phrases them
  ("Retatrutide 1 mg, 3 days ago").
- `repo.listDoseEvents` reads `supplement_logs.amount`/`unit` for vial-dosed supplements.
- The readiness payload's illness advisory, which the notification reuses, names the latest dose
  and says it may be the medication rather than illness. It also carries `recentDoses`.
- `GET /api/health/dose-vitals` returns doses beside each night's resting HR, HRV and the
  baseline stored for that night.
- **Annotate, never correct:** no score reads any of it.

**Decisions and traps, kept here because the rewritten backlog entry no longer carries them:**
- **The dose is the log's `amount`, never `supplements.dose`.** That field is the vial strength
  (10 mg against administered 0.5–1 mg). The entry's first draft made that 20× mistake.
- **No baseline snapshot was needed.** `oura_daily_summary` stores the baseline per night, so the
  row before the first dose (2026-09-06: RHR 52.875, HRV 56.125) is the pre-intervention
  reference, and nothing prunes that table.
- **Resting HR is the night's LOW, not its mean.** The stored baseline tracks the lows (09-06: low
  51.7, mean 59.9, baseline 52.9). A chart of means would sit ~7 bpm above its own reference
  every night. Found by checking the series against the entry's own table before shipping.
- **Lag:** the response peaked 2–4 days after a dose and had largely washed out by day 5, hence the
  window. A same-day correlation finds nothing on data that plainly shows an effect.
- **Magnitude, corrected on 2026-09-20 and kept at the corrected size.** Over 28 pre-dose nights
  against 14 on the drug, resting HR moved **+3.9 bpm** (52.3 → 56.2; 1.2× the owner's own
  nightly sd) and HRV **−14.2 ms, −24%** (58.8 → 44.6). The 65 bpm / 19 ms readings were a two-day
  excursion, not the sustained shift. This is a record of what the app holds, not medical advice.
- **Vial-dosed only**, so daily oral supplements do not annotate every day. If an oral medication
  ever needs it, add an explicit per-supplement flag rather than widening the filter.
- **Do not re-tune any threshold against the dosing period.**

**Verification:**
- The pure module has 6 tests.
- The route test runs on real Postgres: vial-only, no deleted logs, low-not-mean, stored baseline
  ÷ 8. Removing each filter or switching to the mean fails it.
- 16 readiness-related test files pass. The payload's dose read is wrapped, so even a synchronous
  throw costs only the context.
- The full suite is green apart from the known comment-blindness interaction.
