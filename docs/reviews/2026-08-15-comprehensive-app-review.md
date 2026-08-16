# Comprehensive app review — scoring accuracy, the incumbents, bugs, performance, architecture

**Date:** 2026-08-15 · **Against:** `main` at `61507d3` (v1.317.0) · **Type:** review, docs-only
**Prompt:** [`2026-08-15-comprehensive-app-review-prompt.md`](2026-08-15-comprehensive-app-review-prompt.md)
**Backlog entries filed:** Q-271 … Q-284 (14)

Scale at time of writing: 208 API routes · 47 page routes · 471 components · ~205,000 lines of
TS/TSX · 476 test files · 188 Postgres migrations · local SQLite v26 · 244 `###` sections in
`projectOverview.md`, 64 carrying an open marker · 910 lines of `CLAUDE.md`.

**Two findings did not survive verification and were dropped rather than filed.** `sleep_sessions.sleep_score`
is 0-of-46 non-null post-re-key, which looked like a dead column until `score-audit/sleep.ts` turned
out to label it `'Frozen since the BLE re-key — shown for comparison only, never served as the live
score.'` — working as documented. And `blendActivityScore` looked unreachable until
`oura_daily.activity_score` proved non-null on 1 of 40 post-re-key days; it is nearly inert, not
dead, and is filed as Q-284 on those honest terms.

---

## 0. Where the evidence came from

Every quantitative claim below carries its query. All production reads went through
`POST /api/admin/db-query` over the `claude_ro` view schema.

**The limit that qualifies every number in §1:** `claude_ro` views are **row-scoped to one user**
and `error_events` **prunes at 30 days**. Every count here is *the owner's data only*. Where this
review says "nothing else", read "nothing else of the owner's".

---

## 1. Lens A — the five scoring pillars, measured

### 1.1 Coverage: the pillars are absent on a fifth to half of all days

Restricted to post-re-key days (`day >= '2026-07-07'`, 40 days to 2026-08-15):

| Pillar | Days with a value | Coverage |
|---|---|---|
| Sleep Score | 32 / 40 | 80% |
| Readiness | 31 / 40 | 78% |
| Illness score | 39 / 40 | 98% |
| Daytime stress | 22 / 40 | 55% |
| **Activity Score** | **19 / 40** | **48%** |
| Resilience level | 13 / 40 | 33% |
| `training_load_ots` · `training_load_high` · `recovery_index_hours` · `active_calories_est` · `chronic_stress_score` · `vascular_age` | 0 / 89 | 0% |

The zero columns are the already-tracked Q-7b / Q-270 / Q-184 set. The new observation is the
**middle band**: Activity Score exists on fewer than half of days, and nothing in the UI
distinguishes "your activity score is 76" from "there is no activity score today". Filed as
**Q-278**.

### 1.2 Discrimination: Activity Score occupies a quarter of its range

```sql
SELECT count(*), min(x), max(x), avg(x), stddev(x), count(DISTINCT x) …
```

| Pillar | n | range | mean | sd | distinct values |
|---|---|---|---|---|---|
| Readiness | 31 | 29 – 87 | 68.9 | 13.4 | 19 |
| Sleep | 32 | 31 – 97 | 87.6 | 11.7 | 16 |
| **Activity** | **19** | **66 – 91** | **76.1** | **5.9** | **10** |

Readiness and Sleep discriminate acceptably. Activity does not: 19 observations spread over 25 of
its 100 points, sd 5.9. Activity Score **v2** shipped real strength lanes (movement ≈ 55, strength
≈ 45) and an ACWR taper, so the old Q-137 diagnosis ("effectively a step counter") is no longer the
mechanism — but the outcome it predicted survived the fix. Filed as **Q-277**, cross-referencing
Q-137 rather than duplicating it.

### 1.3 The Recovery Index contributor cannot score above ~50, by construction

`READINESS_WEIGHTS.recoveryIndex = 0.09`. The curve is `hours / 6 × 100`, anchored on Oura's public
"≥ 6 h = good recovery" statement.

Production `oura_daily_summary.recovery_index_hours`, n = 39: **min 0.35, max 8.28, mean 2.58,
and exactly 1 of 39 days reaches the 6 h optimum.**

Realised sub-scores across all 31 scored days: **13, 18, 20, 21, 22, 28, 43, 48 …** — never above
50, on any day, ever. Nine percent of the readiness weight is a term that can only subtract. Against
a neutral 50 it costs roughly **2.2 readiness points every single day**, and it is flagged
`provisional` on 31 of 31 days, so the UI's own confidence signal is permanently degraded by it too.

Either the 6 h anchor is mis-specified for the way this app measures the interval (hours from the
overnight HR minimum to wake), or the metric is measuring something other than what the anchor
assumes. Both are calibration work, and the data to do it is already stored. Filed as **Q-271**.

### 1.4 Body Battery: the deferred validation now has an answer, and it is positive

The Known-Issues row from 2026-08-04 said, explicitly: *"Re-check after ~2 weeks of v5 days; if the
correlation is still absent, the question is whether end-of-day battery is the right predictor at
all."* Twelve v5 days have now accrued. Running that exact re-check:

| Predictor → next-day readiness | r | n |
|---|---|---|
| End-of-day battery, **all** model versions | −0.12 | 31 |
| End-of-day battery, **v5 days only** | **+0.67** | **11** |
| `day_min` → next-day readiness | −0.08 | 31 |
| `total_drained` → next-day readiness | +0.11 | 31 |

**v5's end-of-day battery predicts next-day readiness at r = +0.67.** The −0.06 recorded in August
was measured across pooled model versions and is not the v5 number. This answers the deferred
question in v5's favour — underpowered at n = 11, but the right direction, and the correct
conclusion is *tune it*, not *abandon it*.

### 1.5 …and the same v5 turned the battery into a one-way countdown

Same data, different cut — mean charge and drain per day, grouped by `model_version`:

| model_version | n | charge/day | drain/day | ratio | hit 0 | ended at its daily min |
|---|---|---|---|---|---|---|
| `v1:…chg0.4:drn0.6` | 9 | 34.2 | 22.1 | 0.6× | 0 | 1 |
| `v4:…chg0.4:drn0.6:str0.2:oura-rule` | 18 | 34.9 | 30.3 | 0.9× | 0 | 7 |
| **`v5:…chg0.2:drn0.6:str0.2:hrmax-observed`** | **12** | **10.5** | **52.4** | **5.0×** | **3** | **10** |

v5 halved `CHARGE_RATE` (0.40 → 0.20) to fix days pinned at the 100 ceiling. It worked — and it also
produced a battery that **ends at its lowest point of the day on 10 of 12 days** and reaches 0 on 3.
Across all 40 days, `end_value == day_min` on 19 and `day_max == anchor` on 13: on a third of days
the battery never rises above where it woke up.

That is a departure from the thing it is modelled on. Garmin's Body Battery recovers during waking
rest — "take a break and watch it go up" is the feature's whole pitch, and Firstbeat drives it from
beat-to-beat HRV rather than heart rate alone
([Garmin](https://www.garmin.com/en-US/blog/fitness/body-battery-thrive/),
[the5krunner](https://the5krunner.com/garmin-features/sleep/body-battery/)). Our overnight recharge
is handled by the morning anchor reset rather than by accumulated charge, which is a legitimate
design choice; daytime recovery being near-absent is not. Filed as **Q-272**.

### 1.6 Body Battery's own history is not comparable to itself

Four model versions across 40 days — v1 (9 days), v2 (1), v4 (18), v5 (12) — with no recompute or
backfill when the model changed. Any trend chart, any week-over-week comparison, and any correlation
computed over the full series is mixing four different models. §1.4 above is a live example: the
pooled r = −0.12 is an artefact of that mixing, and it had already been written into a Known-Issues
row as the model's verdict. Filed as **Q-273**.

### 1.7 Cross-pillar agreement: readiness and Body Battery are strangers

Pairwise correlation over post-re-key days:

| pair | r | n |
|---|---|---|
| Readiness ↔ Sleep | +0.64 | 30 |
| Readiness ↔ Body Battery **anchor** | **+0.93** | 31 |
| Readiness ↔ Body Battery **end value** | **+0.12** | 31 |
| Sleep ↔ Body Battery end value | −0.00 | 32 |
| Readiness ↔ Activity | −0.04 | 19 |
| Sleep ↔ Activity | −0.30 | 19 |

The anchor correlates at +0.93 because it *is* readiness (`anchor_source = 'readiness'` on 31 of 40
days). By end of day that has decayed to +0.12 — the intraday model discards essentially all of the
recovery information it was seeded with.

Two headline numbers both labelled "how recovered are you", shown in the same app, sharing no
variance. One of them is wrong, or they are answering different questions and the UI does not say
which. Filed as **Q-276**.

### 1.8 Readiness cannot see that you trained hard yesterday

This is the most consequential finding in the review, and it is a design decision rather than a bug.

`lib/health/readiness-payload.ts:329`:

```ts
const ownActivityScore = activityResult?.preTaperScore ?? null // pre-taper → readiness composite (no double-count)
```

The Activity Score's **over-exertion taper is the only place ACWR reaches a score**, and readiness
deliberately reads the value from *before* that taper is applied. The stated reason — avoiding
double-counting — would be sound if load entered the composite somewhere else. It does not. Walking
all nine contributors:

| contributor | weight | what it actually measures |
|---|---|---|
| previousNight | 0.16 | last night's sleep score |
| restingHeartRate | 0.15 | RHR vs personal baseline |
| hrvBalance | 0.15 | HRV vs personal baseline |
| temperature | 0.10 | temp deviation vs baseline |
| sleepBalance | 0.10 | sleep duration vs baseline |
| checkin | 0.10 | subjective morning energy |
| prevDayActivity | 0.09 | yesterday's **goal-completion** score |
| recoveryIndex | 0.09 | hours from overnight HR min to wake |
| activityBalance | 0.06 | today's **goal-completion** score, pre-taper |

The two activity terms are goal-completion scores. A 12,000-step rest day and a heavy squat session
that hits the same goals produce the same contribution. There is no acute-load term, no
recovery-time term, and no session-intensity term anywhere in the composite.

Every incumbent treats this as primary. Garmin's Training Readiness is built from **sleep score,
recovery time, HRV status, acute load, sleep history (3 nights) and stress history (3 days)** —
two of its six inputs are load
([Garmin manual](https://www8.garmin.com/manuals/webhelp/GUID-C001C335-A8EC-4A41-AB0E-BAC434259F92/EN-US/GUID-C21BE0C8-A08E-4DA1-B6C6-2E0E2DDDB372.html),
[the5krunner](https://the5krunner.com/garmin-features/training/training-readiness/)).

For an app whose primary purpose is resistance training, a readiness score blind to training load is
the single largest modelling gap. Filed as **Q-275**.

### 1.9 Sleep: fragment nights, and two dates where the fragment is the only record

Post-re-key, `sleep_sessions` holds 46 rows over 40 dates. **Ten are under 1.5 hours; three are
exactly 0.00 h with efficiency 0.**

```
2026-08-09  n=2  durations: 8.58 | 0.00
2026-08-10  n=2  durations: 7.17 | 0.08
2026-08-11  n=1  durations: 0.00      ← the only record for this date
2026-08-13  n=1  durations: 1.42      ← the only record for this date
```

On 08-09 and 08-10 the fragment sits beside a real night. On **08-11 and 08-13 the fragment is the
entire record** — the real night is absent. Overall `duration_hours` reads mean 6.53 h with sd
3.08 h, an implausible spread that these rows create.

These flow into the sleep score, into readiness's `previousNight` (16%) and into `sleepBalance`
(10%). 2026-08-13 is the night Q-225 was opened on, and its entry asks for exactly this sweep —
*"a reusable local-repro harness for checking whether other recent nights hit the same bug"*. This
is that sweep, done at the data layer: **at minimum 08-11 shares 08-13's signature.** Filed as
**Q-274**, cross-referenced to Q-225 rather than replacing it.

---

## 2. Lens B — how the incumbents do it

### 2.1 Model comparison

| Input | TrainingAI | Garmin | Whoop | Oura | Strava |
|---|---|---|---|---|---|
| Overnight HRV vs baseline | 15% | ✅ core | ✅ dominant | ✅ | — |
| Resting HR vs baseline | 15% | inside HRV status | ✅ | ✅ | — |
| Last night's sleep | 16% | ✅ weighted highest | ✅ | ✅ | — |
| Sleep vs baseline | 10% | ✅ 3-night history | ✅ | ✅ | — |
| Skin temperature | 10% | — | ✅ | ✅ | — |
| **Acute training load / recovery time** | **✗ absent** | **✅ 2 of 6 inputs** | ✅ strain | partial | ✅ the whole model |
| **Daytime stress history** | **✗ collected, unused** | **✅ 3-day history** | ✅ | ✅ | — |
| Subjective check-in | 10% | — | ✅ journal | — | — |
| Goal-completion activity | 15% | — | — | ✅ | — |

Two asymmetries stand out. The app **weights goal-completion activity at 15%**, which no incumbent
scores into readiness at all. And it **collects daytime stress** (`daytime_stress_scaled`, present
on 22 of 40 days) **and feeds it into nothing** — Garmin uses a 3-day stress history as a named
input.

The subjective check-in at 10% is a genuine differentiator worth keeping. Whoop's journal is the
closest analogue and it is well regarded; Garmin and Oura have nothing like it.

### 2.2 ACWR rests on evidence that has substantially collapsed

`computeVolumeAcwr` implements the naive 7:28 acute:chronic ratio, and it drives two user-facing
behaviours: the early-deload card (`EARLY_DELOAD_ACWR_MIN = 1.2`) and the Activity Score taper
(`ACWR_TAPER_START = 1.5`).

The sports-science literature has moved hard against it since 2020. The acute window is contained
inside the chronic window, so the two are mathematically coupled and the ratio produces spurious
correlations; when outliers are removed and load is treated as continuous, the ACWR–injury
relationship disappears; the foundational studies were underpowered. It is now cited as a standard
example of a high-profile finding that distorted a field
([systematic review, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12487117/),
[Impellizzeri et al., conceptual pitfalls](https://www.researchgate.net/publication/341936245_AcuteChronic_Workload_Ratio_Conceptual_Issues_and_Fundamental_Pitfalls),
[Sports Injury Bulletin](https://www.sportsinjurybulletin.com/improve/the-acutechronic-workload-ratio--science-or-religion)).

This does not mean ripping it out. The uncoupled EWMA formulation is a modest change to the same
function, and the honest interim step is to stop making a causal injury-risk claim in the copy the
card renders. Filed as **Q-279**.

### 2.3 Presentation conventions

The incumbents never show a recovery number alone. Garmin pairs Training Readiness with its six
contributing factors and a one-line instruction; Whoop leads with the action; Oura shows
contributors by default. This app already has the machinery — `readinessCompositeContributors`,
`score-audit/`, `scoreBand()` — so where a bare number ships, it is an omission rather than a
missing capability. Worth a deliberate audit of every surface that renders a score. Filed as
**Q-281**.

### 2.4 What not to copy

- **Social / segments / leaderboards (Strava).** The app is single-user by design and the owner has
  not asked for it. Friendship tables exist; that is not a mandate.
- **A single "Strain" number (Whoop).** This app's value is that it separates gym volume from
  cardiovascular load. Collapsing them would discard its main differentiator.
- **Garmin's Race Predictor / VO2max-driven training plans.** They need a running-dominant history
  the owner does not have.
- **Samsung Health's Energy Score.** It is a near-duplicate of Body Battery. Building a sixth score
  before the existing five agree with each other would make §1.7 worse.

---

## 3. Lens C — correctness

### 3.1 The 5,771-hit production fault is fixed, and its fix reached one of three sites

`error_events` holds **5,771 hits** of `[pg 21000]` on `POST /api/hr-ingest` — a cardinality
violation, i.e. an `ON CONFLICT DO UPDATE` whose VALUES list hits the same conflict row twice, which
Postgres rejects *for the whole statement*. Each occurrence discarded a chunk of up to 5,000 HR
points. Last occurrence **2026-08-13T00:17**, and Q-214's fix landed the same day: `upsertOuraHeartrate`
now collapses duplicates into a `Map` keyed on the conflict target before inserting. **Confirmed
stopped.**

Its own comment states the intent: *"this makes the guarantee the function's own, so every caller
gets it rather than each one remembering."* Two siblings in the same file have the identical shape
and did not get it:

| function | conflict target | collapses duplicates first? |
|---|---|---|
| `upsertOuraHeartrate` | `(user_id, timestamp)` | ✅ fixed by Q-214 |
| **`upsertOuraBucket`** | `(user_id, tier, bucket_start_ms)` | ❌ no — 2,000-row chunks |
| **`upsertSetHrStats`** | `set_log_id` | ❌ no |
| `insertRrIntervals` | — | n/a, `onConflictDoNothing` is exempt |
| `upsertOuraDailySummary` | `(user_id, date)` | n/a, one row per statement |

`upsertOuraBucket` is fed by the same BLE rollup that produced the duplicates on `oura_heartrate`.
Filed as **Q-280**.

### 3.2 The standing gates hold

`pnpm check:rules` — **Ran 35 of 35 Custom Rules steps. All passed.**

Sweeping the classes the gates cover, across the whole tree:

| class | count | verdict |
|---|---|---|
| Hand-rolled `invalidateCache([…])` at a call site | **0** | clean |
| `toISOString().slice(0,10)` / `.split('T')[0]` in live code | **0** (1 match, inside a doc comment warning against it) | clean |
| `useState` lazy-initializer cache reads | **0** | clean |
| Hex literals under `app/` + `components/` | 471 across 95 files, none above baseline | ratcheted, not shrinking |
| Files over 800 lines | 5 (`workout-screen` 1,831 · `session-select-content` 1,453 · `config-screen` 997 · `program-editor-sheet` 963 · `health-content` 929) | tracked as Q-138 |
| Bare `pb-safe"` occurrences | 6 | need per-site check, not automatically wrong |

The rulebook's own worry — that prose-only rules drift while checked ones hold — is borne out. Every
class with a CI check behind it reads zero. The hex-literal count is the one that grew while
unchecked, and it stopped growing the day `check-hex-literals.js` shipped.

### 3.3 AI layer

12 files use `generateObject`, 7 use `generateText`, and there are **no `JSON.parse` calls against
model output**. One model in use (`gemini-3.1-flash-lite`), rate limits present on the AI routes
checked. Compliant with the *AI & Security Defaults* rules; nothing filed.

---

## 4. Lens D — performance and data volume

Production table sizes:

| table | rows | total size |
|---|---|---|
| `oura_raw_samples` | 1,041,276 | **341 MB** |
| **`error_events`** | **13,203** | **49 MB** |
| `oura_heartrate` | 49,272 | 29 MB |
| `rr_intervals` | 49,901 | 10 MB |

`oura_raw_samples` at 341 MB is the deliberate archival policy in `CLAUDE.md` (the server copy of
`body_hex` is the source of truth and must never be pruned), tracked separately in
`docs/db-volume-cleanup-handover.md`. Not re-raised.

`error_events` at **49 MB for 13,203 rows** — 3.8 KB per row — is worth a look: it prunes at 30
days, so this is steady-state, and 5,771 of those rows were the single now-fixed fault.

Unused indexes (`idx_scan = 0`), largest first: `oura_heartrate_user_updated` (5.7 MB),
`oura_heartrate_pkey` (4.3 MB), `error_events_pkey` (576 kB), `set_logs_exercise_log_id_set_number_key`,
`set_hr_stats_user_exercise_idx`, `ai_call_log_fingerprint_idx`. Roughly 11 MB of index that has
never served a scan, on a database where index bloat has already caused an incident (Q-219). Filed
as **Q-283**.

---

## 5. Lens E — UI and the testing capability behind it

Measured against current Android QA practice — the test pyramid, instrumentation, accessibility
scanning, network-condition simulation and device coverage
([Momentic](https://momentic.ai/blog/mobile-app-testing-best-practices),
[BrowserStack accessibility guide](https://www.browserstack.com/guide/accessibility-testing-for-mobile-apps),
[DeviQA](https://www.deviqa.com/blog/making-mobile-app-testing-work-for-you-practical-tips-and-techniques/)) —
this project's shape is: **a very wide base and no apex.** 476 test files, zero of which run the
app.

Five Q numbers already cover most of the gap and were filed 2026-08-14 at the owner's direction:
Q-249 (E2E harness — Playwright is installed and unused), Q-250 (emulator in CI), Q-251 (staging),
Q-252 (error tracking with session replay), Q-253 (device farm), Q-254 (sweep the 81 unverified
rows). Those are correctly scoped and correctly prioritised; this review does not re-raise them.

**What standard practice covers that none of the six touch: automated accessibility scanning.**
Android ships Accessibility Scanner and Espresso accessibility checks, which catch precisely the
class this project keeps rediscovering by hand — missing labels, undersized touch targets,
insufficient contrast. The 2026-08-08 sweep found 7×7 px tap targets by manual inspection and its
contrast finding could not be measured at all. That is a check, not an audit, and nothing in CI
performs it today. Filed as **Q-282**.

---

## 6. Lens F — architecture

Reviewed at a lighter depth than Lenses A–C; see §7 for what that means.

**Holding up well.** The one-formula-one-place rule is visibly working — the score models are single
implementations exported as serialisable `READINESS_MODEL` / `ACTIVITY_MODEL` objects, so the admin
audit renders the model without copying it, which is why §1 could be measured at all. The
`score-audit/` layer is a genuine asset and the natural home for anything Q-271 … Q-277 produces.
The write-path discipline (one shared function per domain, CI-enforced by
`check-push-mutations.js`) held across every path checked.

**The strain is in the score layer, not the plumbing.** Five pillars, each with its own constants,
its own coverage profile, its own model version, and no shared notion of "is this number
trustworthy today". `scoreAvailability` exists for readiness alone. Body Battery carries a
`model_version` string; the others do not. That asymmetry is what makes §1.6 possible.

**Recommendation, ordered.** Q-275 (load into readiness) and Q-274 (fragment nights) are the two
that change what the user sees, and both are tractable. Q-271 and Q-272 are calibration against data
that already exists. Q-273 (model versioning + backfill) is the one that makes all future scoring
work measurable, and is worth doing before the calibration items rather than after — otherwise each
of them creates another incomparable segment in the history.

---

## 7. Surfaces NOT exercised

Stated per *Communication* in `CLAUDE.md`.

- **No device, no emulator, no browser.** Nothing here was rendered. Every UI finding is from source
  or from a prior review's measurement, and the Lens E tap-target class was **not** re-measured.
- **`pnpm dev` was not run.** This was a docs-only review; no runtime path was exercised.
- **One user's data only.** Every §1 number is the owner's, via row-scoped `claude_ro` views. None
  of it generalises to the other production accounts.
- **`error_events` prunes at 30 days**, so any fault that started and stopped before 2026-07-16 is
  invisible here.
- **No real wearable.** Ring, strap and scale paths were read, never exercised.
- **Lens F is shallower than Lenses A–C.** Module coupling and the sync engine's behaviour under
  multi-user growth were reasoned about from source, not measured. F2 in the prompt (what breaks
  first at 10 users, at 100) is **not answered** and remains open.
- **Correlations at n = 11 to n = 31** are directional, not conclusive. §1.4's r = +0.67 in
  particular should be re-run once v5 has ~30 days.
