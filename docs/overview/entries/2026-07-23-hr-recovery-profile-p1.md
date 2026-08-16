## 2026-07-23 — HR Recovery Profile, Phase 1 (v1.202.0)

**Branch:** `feat/hr-recovery-profile-p1` — implementer session working the top of the backlog
(HRP-1), per the spec written the same day:
[`docs/superpowers/plans/2026-07-22-hr-recovery-profile.md`](../../superpowers/plans/2026-07-22-hr-recovery-profile.md).

### What shipped
A new, standalone **"HR Recovery Profile" card** on Health → Body → Heart & recovery — recovery rate
bucketed by the HR you were recovering **from** (`<110 / 110–129 / 130–149 / 150–169 / 170+`), a
cross-workout, intensity-normalised fitness signal distinct from the per-exercise card (which only
compares sets of the *same* lift).

- **`lib/health/hr-recovery-profile.ts`** — band definitions, `recoveryRateBpmPerMin` (bpm/min from the
  largest available drop point — least sensitive to a single noisy early reading), and
  `aggregateHrRecoveryProfile` (median rate/seconds-to-resting per band, median not mean per the
  existing `hrr-trend.ts` convention, bands with zero episodes omitted rather than shown as 0).
  `episodeFromSetHrStats` normalises a durable `set_hr_stats` row into a source-tagged
  `RecoveryEpisode` — Phase 1's only source (`set_rest`); HRP-2 will add `run_cooldown`/`interval`
  episodes into the same shape without touching this aggregator.
- **`GET /api/health/hr-recovery-profile`** — derive-on-read (no new migration; `set_hr_stats` is
  already durable past the 180d `oura_heartrate` prune, so a fresh table wasn't needed for P1),
  SWR headers + rate limit at creation.
- **`components/health/hr-recovery-profile-card.tsx`** — self-fetching, cache-seeded card wired into
  the Body tab's "Heart & recovery" group (`health-content.tsx` group list + `health-sections.tsx`
  switch, mirroring `HrDayCard`'s pattern). Low-signal band (`<110`) rendered dimmed rather than
  hidden, per the spec's §6 caveat. Carries the cardiovascular-only disclaimer plus an explicit note
  that today's data is between-set rests only (posture confound flagged, not hidden).
- **Refactor:** extracted the `↓/↑` direction-arrow formatter (previously local to
  `exercise-hr-trend-card.tsx`) into `lib/health/hr-change-display.ts` so the new card shares the exact
  same convention instead of drifting a second copy — done at 2 sites per the "extract before a third
  copy" rule.

### Verification
- `tsc` clean; `eslint` clean (no new warnings). Full suite: **291 files / 2011 tests passing**
  (10 new: band bucketing, rate-from-largest-drop-point, median aggregation incl. anomaly resistance
  and censoring, empty-input, row normalisation).
- **Live dev-server pass**, authenticated as the seeded test user: `GET /api/health/hr-recovery-profile`
  returned 200 with real aggregated data (2 bands from 3 seeded episodes) and correct SWR headers.
  **Playwright screenshot** of the actual Health → Body page confirmed the card renders in place with
  correct values, the shared arrow/color convention, and the disclaimer.
- Not device-verified (safe-area/theme on the S25) — same standing gate as every other Health card;
  no new risk class introduced (read-only, no schema change).

### Next
HRP-2 (run/interval episode detection) and HRP-3 (trend + AI tool) remain in the backlog, unblocked —
this phase's `RecoveryEpisode` shape was designed to absorb non-set sources without an aggregator
rewrite.
