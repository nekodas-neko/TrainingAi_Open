# 2026-07-26 — Admin Day Review: per-day score audit for the four pillars

Branch: `claude/admin-review-data-tool-992j8a` · v1.210.0

## Why

Owner directive: *"I had a really bad sleep last night and felt really bad. I'd like to be able to
pull all the data that would have related to that sleep score to run by you for further tuning of
the scores. I want that for each section."*

Score tuning was previously blind work. The scores are served by `/api/readiness-score`, which is
**today-only** and returns final numbers plus a flat `components` map — no way to ask "why was
Tuesday's sleep an 82?", no view of which contributors were excluded and absorbed by
renormalisation, and no view of the weights/curves that shaped the answer without reading source.

## What shipped

**`lib/health/score-audit/`** — a date-parameterised audit assembler. `buildDayAudit({repo, userId,
date, tz})` returns, for one arbitrary local day and each of the four home pillars (Sleep,
Readiness, Activity, Heart Rate):

- **`contributors[]`** — per contributor: the raw measurement in real units with its source column,
  the 0–100 sub-score, the raw weight, the **effective** weight after renormalisation over the
  contributors that actually ran, and `contribution` = the points it put into the final score.
  Excluded contributors carry an `excludedReason` instead of a silent absence.
- **`model`** — the model's own constants (weights, curve anchors, taper thresholds, the z→score
  slope, the baseline-maturity gate), so a score can be read next to the thing that produced it.
- **`gaps[]`** — what was missing and what the model did about it, in prose
  ("no hypnogram → REM+Deep, 24 of 100 weight, redistribute, which shifts the score toward duration").
- **`stored` + `storedMatchesRecompute`** — the value persisted for that day next to a live
  recompute, so model drift and stale persists surface instead of hiding.
- **`context`** — check-in, workouts, activity logs, nutrition totals, body metrics, and a
  **data-quality block** (baseline nights, HRV/RHR baseline sample days, intraday HR sample count,
  low-wear flag) — the two or three facts that explain most "wrong" scores.

**`GET /api/admin/day-review?date=`** — admin-gated (`requireAdmin` → 403), rate-limited
(20/min), `normalizeDateParamIso` on the param. **`components/admin/day-review-tab.tsx`** — new
Admin → Day Review tab: date stepper, expandable pillar cards, and a Copy-JSON button.

**One Formula, One Place upkeep.** The audit calls the *same* `computeSleepScore` /
`computeActivityScore` / `computeReadinessComposite` the app serves from and reads the same weight
tables — it gathers inputs for a date, it never re-implements a formula. Three constants that were
inline in `app/api/readiness-score/route.ts` moved to live with their model and are now shared by
both: `SLEEP_HRV_BASELINE_MIN_NIGHTS`, `CHECKIN_ENERGY_SCORE`, `checkinScoreFromEnergy`. New
serialisable specs `SLEEP_MODEL` / `ACTIVITY_MODEL` / `READINESS_MODEL` export each model's own
constants rather than duplicating them.

## Bugs found while building

1. **`normalizeDateParam` slash/dash trap (mine, fixed before commit).** The route first used
   `normalizeDateParam`, which returns the **slash** form; the assembler does dash-based arithmetic
   (`shiftDateStr`, dash-keyed DB rows, `` `${date}T00:00:00` ``) → `RangeError: Invalid time value`,
   500 on every request. Exactly the J-8/J-9 class CLAUDE.md warns about. Now `normalizeDateParamIso`.
2. **Date input collapsed to 26px at the S25 width (mine, fixed before commit).** The shadcn `Input`
   carries `w-full min-w-0`, so in a single flex row with four buttons it shrank to nothing at 412px.
   Split into two rows; arrows are now 44×44. Caught by measuring the bounding box, not by eyeballing.
3. **Readiness persist keyed on the wrong day (pre-existing, NOT fixed — see Known Issues).** The
   tool's drift flag fired on its first real run: stored 36 vs recompute 40 for the same date.
   `app/api/readiness-score/route.ts` persists the composite under `latestSummary.date`, which is the
   last night with a summary row — not necessarily today — so today's check-in and activity get
   written into a row labelled with an earlier date. Left as-is deliberately: it is a real behavioural
   question about what that row should mean, not an obvious bug, and it is out of scope for this PR.

## Follow-up in the same PR: token export + range mode

Owner asked whether there was a simpler way to get the data out than copy-paste. The sandbox can't
reach production Postgres (proxy port blocked, only 80/443 outbound), but 443 *is* open — so an
HTTPS endpoint on Railway is reachable; the only missing piece was auth. Added, following the
existing `HEALTH_CONNECT_INGEST_SECRET` precedent rather than inventing a new pattern:

- **`Authorization: Bearer $ADMIN_EXPORT_SECRET`** as an alternative to a session on the same
  read-only GET. **Fail-closed**: unset `ADMIN_EXPORT_SECRET` *or* the user-id var and the bearer
  path is disabled entirely (never "skip the check when unconfigured"). Constant-time compare;
  per-IP attempt limiting *before* the compare so a brute-force can't run at unbounded throughput;
  and the resolved user must still pass `requireAdmin` — **the token widens transport, never
  authority**.
- **`?from=&to=` range mode**, capped at 31 days. Days are walked **sequentially on purpose**: each
  day runs ~12 queries against a `max:10` pool, and fanning a month out concurrently is the exact
  shape that took production down in session 165. Range responses hoist the model constants to the
  top level — identical on every day, and repeating every curve 31× was most of the payload.
- **`lib/security/constant-time.ts`** — `safeCompare` extracted from `health-connect/ingest` so the
  two secret-comparison sites share one implementation instead of drifting.

This is what makes tuning tractable: calibration claims are about distributions ("a normal-good
night must stay under 90"), which needs 30 nights, not one.

**Verified:** 16 new route tests (auth matrix + date/range handling) plus a live dev-server pass —
valid token 200, wrong token 401 at both matching and differing lengths, malformed header 401, no
auth 401, **token resolving to a non-admin 403**, and with the secret unset a previously-valid token
401s while the admin session still 200s. 7-day range: 200, 98 KB, 0.58 s.

**Security posture, stated plainly:** this is a bearer credential that can read the owner's full
health history. It is read-only, GET-only, scoped to this one route, rotatable by changing the
Railway var, and off by default. Documented under Environment Variables in CLAUDE.md.

## Verification

- `tsc` clean · `next lint` clean on all new files · **1992 tests pass** (38 new) · `next build`
  clean · `check-push-mutations: OK`.
- **Dev-server exercised end-to-end** against the local seeded DB: route 200 for both `YYYY-MM-DD`
  and `YYYY/MM/DD`, 400 on `2026-06-31`, 401 unauthenticated. Contributions verified to sum to the
  score the model reports (readiness: Σ 40.07 → composite 40).
- The seed carries no `oura_daily_summary` rows, so the readiness composite path was proven by
  **inserting synthetic summary rows into the local dev DB and deleting them afterwards** (the same
  approach the round-3 core-cards work used for `oura_heartrate`). Verified a fever-shaped night:
  four contributors clamped to 0, a 25-point illness suppression, composite 40 → displayed 15.
- **Playwright at the 412×915 S25 viewport**: tab renders, date stepper navigates, pillars expand,
  no console errors (the one 400 is the pre-existing `/api/oura/sync` with no PAT in the seed).

**Known fidelity limit, surfaced in the payload rather than hidden:** the score modules expose
sub-scores already rounded to integers, while the score itself is the weighted mean of the
*unrounded* values — so contributions rebuilt from them can land up to a point off. Each pillar
reports `contributionSum` with a note saying ≤1 is rounding and anything wider is a real gap.

## Not verified

- **On-device (S25 APK).** Admin-only, read-only, no offline-first domain, no native plugin, no
  new safe-area surface (it renders inside the existing `/admin` shell, which already handles
  `pt-safe`/`pb-nav-safe`). Web-verified at the S25 viewport; not eyeballed on the device.
- **Real ring data.** The local seed has no `oura_daily_summary`/`oura_heartrate`, so the readiness
  and zone-minutes paths were proven on synthetic rows. Whether the numbers are *sane against the
  owner's real history* is the whole point of the tool and is the first thing to check on the device.
