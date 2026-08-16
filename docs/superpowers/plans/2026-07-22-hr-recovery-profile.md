# HR Recovery Profile — recovery-by-intensity across all activity (spec, 2026-07-22)

**Owner-directed (2026-07-22), brainstormed after the per-set HR feature shipped.** The per-exercise
"Heart & Recovery" card answers *"how fast does HR settle between sets of this lift."* The owner wants
the more powerful, **intensity-normalised, cross-modal** version:

> *"From 110 bpm → rest HR takes X seconds; from 150 → Y; from 180 → Z"* — a recovery curve keyed by
> the HR you're recovering **from**, built from **all** elevated-HR episodes (lifting rests, run
> cool-downs, the 1-min work / 1-min rest interval protocol), trended over time.

This is **heart-rate recovery (HRR) as a function of intensity** — a validated cardiovascular-fitness
marker. Tracked longitudinally it's effectively a **cardio-fitness tracker**: "is my recovery from 160
bpm getting faster month over month?" It is a *better* fitness signal than the per-exercise number
because it is intensity-normalised and works across running + lifting + intervals.

**Scope:** this is a NEW, standalone feature (a Health-screen card + its own aggregation), **not** an
extension of the per-exercise card. Planning-only doc — implement later per the backlog protocol.

---

## 1. What already exists (reuse, don't rebuild)

- **`oura_heartrate`** — the continuous HR series for **everything** (workouts, runs, rest, sleep;
  1 Hz during workouts, ~30s ambient), from chest strap / ring. This is the raw substrate — every
  recovery episode is already recorded here. **(180-day prune — see §6 durability.)**
- **`resolveHrProfile(repo, userId, tz)`** (`lib/health/hr-profile.ts`) → `{ maxHr, restingHr }` — the
  baseline the "return to normal" target anchors on. Import; never re-derive.
- **`lib/health/hr-zones.ts`** — zone/reserve helpers (`hrReserve`, `computeHrZones`) for %HRR math.
- **`set_hr_stats`** (migration 139) — already segments **between-set rest windows** and stores the
  drop curve + `sec_to_resting`/`pct_hrr_at_rest_end` per set. These are lifting-only recovery episodes
  we've *already detected* — the profile can seed from them directly (a set's rest = one episode) rather
  than re-detecting from raw HR.
- **`lib/workout/set-hr-stats.ts`** — the per-set formula (peak, drop curve, three recovery models);
  the episode-metric math (time-to-threshold, %HRR) is here — reuse it for run/interval episodes.
- **Running system** (`lib/running/*`, `/api/running-plan`) — runs are activities with HR in
  `oura_heartrate`; the **1-min work / 1-min rest** interval protocol the owner mentioned would be the
  cleanest, most controlled episode source.
- **`daily_zone_minutes`** (migration 129) — precedent for a server-derived, reconcile-on-read HR
  rollup cache keyed by day (the pattern this feature's storage should follow).

**The genuinely new work is only:** (a) a **recovery-episode detector** over the HR series for non-set
sources (runs, intervals, ambient), (b) an **aggregation bucketed by peak-HR band**, (c) a **Health
card** + trend.

---

## 2. Core concept — the "recovery episode"

A **recovery episode** = a local HR **peak** followed by a **sustained decline** into a rest/recovery
window. Per episode, record:

- `peakBpm` — the HR being recovered from (the bucket key).
- `source` — `set_rest` | `run_cooldown` | `interval` | `ambient`.
- `posture/activity` proxy — was the user still (rest between sets) or moving (walk-cooldown)? Affects
  the rate; store it so buckets can hold it constant (see §5 caveat). Derive from source + any motion
  signal available (Oura activity class / accelerometer if present, else infer from source).
- **Recovery metrics** (reuse `set-hr-stats` math): `drop@30/60/90/120s`, `secToRestingHr`,
  `secToHrr50`/`secToHrr100` (time to recover 50/100% of heart-rate reserve back toward resting),
  and a **recovery rate** (bpm/min over the decline) — the rate is the most comparable cross-modal
  metric because it's duration-normalised.

### Detection
- **Set rests:** already segmented — one episode per set (from `set_hr_stats`; peak = `peak_bpm`,
  window = the rest after `set_end_ms`). Zero new detection needed for lifting.
- **Runs / intervals / ambient:** run a peak+decline detector over `oura_heartrate` (prominence-based
  peak detection → require a sustained decline of ≥ N bpm over ≥ M seconds to qualify; discard
  re-accelerations). This is the one real signal-processing piece. The **interval protocol** (fixed
  work/rest) makes detection trivial where it's used — prefer it for the cleanest data and treat
  opportunistic detection as the higher-volume, noisier supplement.

---

## 3. Aggregation — the recovery curve

Bucket episodes by **peak-HR band**: `<110 / 110–129 / 130–149 / 150–169 / 170+` (bands, not exact bpm,
for stable sample sizes). Optionally sub-bucket by `posture` (still vs moving) so we don't average a
standing between-set rest against a walking run-cooldown.

Per (band × window), report: median **recovery rate** (bpm/min), median **time-to-resting** (censored
when the rest ended first — carry the same `recovered` flag as `set_hr_stats`), and **n**. Median (not
mean) per the existing HRR-trend convention (`lib/workout/hrr-trend.ts`) so one anomaly doesn't skew a
band. Trend each band over time (e.g. 8-week windows) → the fitness signal.

Output shape (sketch):
```
{ bands: [ { label: '150–169', n: 42, recoveryRateBpmMin: 33, secToResting: 210, recovered: true } … ],
  trend: [ { period: '2026-05', band: '150–169', recoveryRateBpmMin: 29 } … ] }  // rate rising = fitter
```

---

## 4. Storage

Two options — decide at implementation:
- **(A) Derive-on-read** (preferred, mirrors `daily_zone_minutes`): compute episodes + buckets from
  `oura_heartrate` + `set_hr_stats` on read, cache a per-period rollup (`hr_recovery_profile` keyed by
  `(user, period, band)`), reconcile on read. Simplest; but bounded by the 180-day HR prune.
- **(B) Persist episodes** (`hr_recovery_episodes` table) at detection time — durable past the prune,
  like `set_hr_stats` is for sets. Needed if we want history > 180 days. Recommend starting with (A)
  seeded from the already-durable `set_hr_stats`, and adding (B) for run/interval episodes if the
  long-history trend proves valuable.

Follow the project rules: server-derived (not an offline-sync domain), SWR headers + rate limit at the
read route's creation, one canonical TTL in `lib/cache-ttl.ts`, `todayMidnightUtc(tz)` for all window
boundaries (never ms-offsets).

---

## 5. UI

A **"HR Recovery Profile" card on the Health screen** (Body → Heart & recovery group, or Training):
- The recovery curve: per peak-HR band, a bar/row showing recovery rate (bpm/min) with n, worst→best or
  by band. "From 150 bpm you shed ~33 bpm/min; from 180, ~28."
- A **trend** toggle: is each band's recovery getting faster over months (fitness improving)?
- The same **cardiovascular-only** disclaimer + the `↓/↑` direction convention from the per-exercise
  card (reuse the presentation language for consistency).
- Cache-seeded instant paint, `resolveColor` for any chart colour, sparkline via the shared primitive,
  theme tokens, safe-area if it's a sheet — all per the standing UI rules.

Optionally feed the **AI coach** a `getHrRecoveryProfile` tool (like `getWorkoutHrTrends`) so it can say
"your recovery from hard efforts is ~15% faster than 8 weeks ago."

---

## 6. Caveats / risks (call these out in the card, don't hide them)

- **What you do during recovery matters.** Standing between sets vs. walking a cool-down recover at
  different rates — bucket by posture/source or the cross-modal comparison is apples-to-oranges. This is
  the single biggest confound.
- **Low-intensity episodes are noise.** Recovery from a 99-bpm hip-thrust set is meaningless (barely
  elevated); the `<110` band should be de-emphasised or hidden. (This is exactly the confusion that
  prompted the spec — see the 2026-07-22 card readability note.)
- **Episode detection is the hard part** for non-set sources — intervals go up-down-up-down. Prefer the
  controlled interval protocol; treat opportunistic detection as supplementary and validate it against
  the clean set-rest data we already have.
- **180-day prune** bounds a derive-on-read trend; persist episodes (option B) if long history matters.
- **Modality differences** (anaerobic lift vs aerobic run) are real, but as a *personal longitudinal*
  trend keyed by peak HR it's valid — you're comparing yourself to yourself, same band, over time.

---

## 7. Suggested phasing

- **Phase 1 — seed from what's durable:** build the band aggregation + Health card from `set_hr_stats`
  alone (lifting rests) — zero new detection, proves the UI + the bucketing value. Derive-on-read (A).
- **Phase 2 — add run/interval episodes:** the peak+decline detector over `oura_heartrate`, wired to the
  running interval protocol first (clean), then opportunistic runs. Consider persisting episodes (B).
- **Phase 3 — trend + AI:** month-over-month trend per band + the `getHrRecoveryProfile` chat tool.

Already shipped as the cheap adjacent win (not part of this spec): the per-exercise card now shows the
**full 30s/60s/90s/2m recovery curve** (`avgDrop30/90/120` were already stored in `set_hr_stats`; just
surfaced) — v1.201.2.
