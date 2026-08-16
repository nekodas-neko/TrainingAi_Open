# The six lenses twelve reviews never used — findings

**Date:** 2026-08-15 · **Against:** `main` at `1c861fc` (v1.317.0) · **Type:** review, docs-only
**Prompt:** [`2026-08-15-uncovered-lenses-prompt.md`](2026-08-15-uncovered-lenses-prompt.md)
**Companion:** [`2026-08-15-comprehensive-app-review.md`](2026-08-15-comprehensive-app-review.md) (Q-271…Q-284)
**Backlog entries filed:** Q-285 … Q-296 (12)

The headline finding is **Lens I**, and it is the sharpest measurement in either review:
`expectedRpe` — the function behind RPE autoregulation and the emergency-deload safety net —
predicts real logged RPE at **r = 0.348** over 569 production sets, and its systematic error at
both ends of its range **exceeds the trigger threshold that consumes it**.

---

## 0. Corrections to what I said before running this

Two claims I made in conversation before grounding them turned out wrong. Both are corrected here
rather than quietly dropped.

1. **"Effort has gone into what the notifications say while nothing could receive them."** Wrong.
   The notification-content work in `projectOverview.md` (ring/strap quieting, low-battery
   exception, scale notification) is **native Android** — `OuraRingService.kt`, `ScaleBleService.kt`,
   `PolarStrapService.kt`, `DeviceBatteryNotifier.kt` — and that stack works. The **web-push** stack
   is separate, and it is the one that is inert. The real finding is narrower and is Q-285.
2. **"No data export."** Wrong. `/api/export` is a genuine user-facing NDJSON takeout under session
   auth. What is missing is *deletion* (Q-287) and export *completeness* (Q-288).

---

## 1. Lens I — is the training science sound? (highest value)

### 1.1 The verdict on the model itself is largely positive

This deserves saying plainly, because a review that only finds fault is not measuring.
`packages/shared/src/ai-periodization/` is more defensible than expected:

- **`expectedRpe` is methodologically sound in construction.** It inverts the same `repFactor`
  curve the 1RM math uses to derive reps-to-failure, takes RIR as `maxReps − reps`, and returns
  `10 − RIR`. That is textbook RIR-based autoregulation, and tying it to the shared `repFactor`
  means it cannot drift from the 1RM model — an instance of *One Formula, One Place* doing real work.
- **`MUSCLE_LANDMARKS` is a recognisable MEV/MAV/MRV table** (chest 8/16/22, back 10/18/25, quads
  8/14/20) consistent with the published hypertrophy-volume literature, with a conservative
  `DEFAULT_LANDMARKS` fallback and goal multipliers that correctly spend strength/power budget on
  intensity rather than volume.
- `autoregulation.ts` gates its back-off on **RPE high AND (1RM regressing OR reps missed)** rather
  than RPE alone, which is the right shape — RPE on its own is too noisy to action.

The problem is not the model's structure. It is that **one of its constants was never checked
against the data it consumes.**

### 1.2 `expectedRpe` vs 569 real production sets

Pulled every `set_logs` row with an RPE, an intensity, and reps (n = 569 of 1,009), and ran the
actual shipped `expectedRpe` against each:

```
actual   RPE  mean=7.48  sd=0.87  range=6..10
expected RPE  mean=7.67  sd=1.34  range=5.0..10.0
correlation r = 0.348        MAE = 0.99 RPE points        bias = −0.19
```

Bucketed by prediction — this is the part that matters:

| expected RPE | actual mean | **delta (actual − expected)** | n |
|---|---|---|---|
| 5 | 6.93 | **+1.93** | 68 |
| 6 | 6.87 | +0.87 | 45 |
| 7 | 7.45 | +0.45 | 56 |
| 8 | 7.57 | −0.43 | 288 |
| 9 | 7.90 | −1.10 | 60 |
| 10 | 7.81 | **−2.19** | 52 |

Two things are wrong here:

1. **The model's predictions vary ~5× more than reality.** Predicted spread 5.0→10.0; actual
   bucket-mean spread 6.87→7.90, about one RPE point.
2. **It is non-monotonic at the top.** Expected 9 → actual 7.90; expected 10 → actual 7.81. The
   hardest prescriptions come back *easier* than the second-hardest.

### 1.3 Why that breaks the thing that consumes it

`autoregulation.ts:19` — `const RPE_DEAD_BAND = 1.5`, applied to `rpeDelta = actual − expected`:

- **`rpeDelta >= +1.5`** → back-off, cut load 5–10% (when 1RM is down or reps were missed).
- **`rpeDelta <= −1.5`** → push, add a target rep; **`<= −2` adds two reps**.
- `emergency-deload.ts:35` fires on `rpeTrend.delta > 2.0`.

Set the athlete aside entirely and read the table again. At **expected 5** the systematic error
alone is **+1.93** — past the +1.5 back-off trigger, and within touching distance of the 2.0
emergency-deload threshold. At **expected 10** it is **−2.19** — past the −1.5 push trigger *and*
past the −2 threshold that adds **two** reps rather than one.

**120 of 569 sets (21%) sit in buckets where the model's own miscalibration exceeds the dead band
before the lifter has done anything.** The heaviest prescriptions systematically read as *"that felt
easy, earning the next jump"*, and the lightest as *"RPE ran high"*.

The bulk of sets (expected 8, n = 288) give −0.43 and sit safely inside the band, which is why this
has not produced obvious chaos. It is a tail failure, and the tail is exactly where autoregulation is
supposed to earn its keep. Filed as **Q-289**.

### 1.4 The input signal has almost no variance either

Actual RPE: **sd 0.87, range 6–10**, and the distribution is dominated by 7s and 8s. Whatever
autoregulation computes, it computes from a near-constant. This is a data-collection problem
(a 5–10 slider that in practice gets two values), not a formula problem, and it compounds §1.3 —
a 1-point-variance signal is being differenced against a 5-point-variance prediction. Filed as
**Q-290**.

---

## 2. Lens J — what the AI actually says

### 2.1 Quality is genuinely good

Read across `ai_health_insights` (117 rows). The output is specific, numerically grounded, and
actionable — not the hedged filler this class of feature usually produces:

> *"Your readiness score of 75 reflects a stable trend, though your body temperature is currently
> elevated by 0.8 degrees above your baseline… Keep your planned exercise intensity low."*

### 2.2 The AI surfaces contradict each other on the same day

**2026-08-06**, same user, same day, two AI surfaces:

- **Readiness insight:** temperature 0.8 °C above baseline → *"Keep your planned exercise intensity low."*
- **What actually happened:** `workout_sessions` shows **two** sessions — Legs 01:40, Upper 21:26.
- **Daily digest, same day:** *"Crushing three PRs… dominate today's 6754 kg leg volume session…
  **Keep that same energy tomorrow!**"*

The app advised backing off, the user did a double session including three PRs, and the app then
congratulated them and encouraged a repeat — with no surface aware of the other. Readiness then fell
79 → 76 → 76 → **65** over 08-05…08-08, so the morning signal was arguably right and the evening
digest reinforced the behaviour that degraded it.

This is the user-visible face of **Q-275** (readiness is blind to training load) and **Q-276** (the
pillars disagree). Filed separately as **Q-291** because the fix is different: the AI surfaces need
shared state, independent of what the underlying scores do.

### 2.3 The AI asserted a number that is false

**2026-08-05** activity insight: *"…leading to a perfect activity score."*
`oura_daily_derived.activity_score` for 2026-08-05 is **80**.

`CLAUDE.md` already forbids an LLM self-reported number gating an automatic action. This is the
adjacent case the rule does not cover: a fabricated number rendered to the user as fact. Filed as
**Q-292**.

Also in the sample: *"keep your bedroom temperature at 65 degrees Fahrenheit"* — to a user in
Australia whose entire app is metric. Same entry.

### 2.4 The dedup key is written for one section out of fourteen

`ai_health_insights.context_hash` is **NULL on 109 of 117 rows**. Only `daily-digest` populates it
(8 distinct). Every other section — `sleep`, `readiness`, `activity`, `heart-rate`, `weekly-digest`,
`session-explain`, `session-recap` — writes NULL, so whatever regeneration-avoidance the column was
added for cannot work. Corroborating: `ai_call_log_fingerprint_idx` shows **zero scans**
(also in Q-283). Filed as **Q-293**.

---

## 3. Lens G — what did we build that nobody uses?

Row counts, owner's account:

```
ai_call_log 255 · ai_health_insights 117 · personal_records 30 · coach_messages 16
prescribed_runs 12 · goal_recommendations 11 · coach_threads 5 · saved_meals 3
friendships 2 · fitness_tests 2 · supplements 2 · meal_plans 1 · running_plans 1
push_subscriptions 0 · seasons 0 · season_results 0 · injuries 0 · feedback_submissions 0
```

Classifying the zeros per the prompt's four outcomes: **`injuries` at 0 is correctly empty** — the
owner has no injuries, and that is a good outcome, not a defect. `seasons`/`season_results` and
`feedback_submissions` are unused-but-harmless and are *not* filed; deleting a feature on one user's
non-use is not justified.

**`push_subscriptions` = 0 is the real one, and it is broken at both ends:**

- The subscribe path exists and is user-reachable — `components/more/settings-panel.tsx:78` →
  `subscribeToPush()` → `reg.pushManager.subscribe()` → `POST /api/push/subscribe`.
- Production holds **zero** subscriptions.
- **`sendPushToUser` has exactly one caller in the entire codebase: `/api/push/test`.** No feature
  sends a web push.

So the transport has neither subscribers nor senders. Filed as **Q-285**.

**And it strands a shipped, user-facing feature.** `supplements.reminder_enabled` and
`program_sessions.reminder_enabled` both exist, are synced through the local store
(`sqlite-backend.ts`, `sync-engine.ts`), round-trip through the API — and are exposed as a real
toggle in `components/nutrition/manage-supplements-sheet.tsx:253` (`<Switch checked={reminderEnabled}>`).
Nothing reads them to fire anything, and `docs/module-map.md` §0 states plainly: **"There is no cron
layer, no job queue, and no GitHub Actions schedule in this app."** A user can turn on a supplement
reminder, watch it persist and sync, and no reminder can ever arrive. Filed as **Q-286**.

---

## 4. Lens H — account lifecycle and the Play Store gates

**H1 — No self-service deletion.** Deletion exists only under `app/api/admin/users`. Google Play has
required an in-app *and* web-accessible account-deletion path since 2024, and the Play Store listing
is a stated goal in `CLAUDE.md`. Filed as **Q-287** — scoped, explicitly **not** built, because
deletion is destructive and irreversible and the semantics need the owner's sign-off first.

**H2 — The export is materially incomplete.** `/api/export` covers **27 domains** (17 direct + 9
joined + goals) against **80 tables** in `schema.ts`. Credential/token exclusions are deliberate and
correct. But the export omits, among others:

`oura_daily_derived` (every computed score) · `oura_daily_summary` (the baselines) · `oura_heartrate`
(49,272 rows) · `rr_intervals` · `body_battery_daily` · `set_hr_stats` · `workout_hr_stats` ·
`coach_messages` / `coach_threads` / `ai_health_insights` (the user's AI conversations) · `meal_plans`
/ `saved_meals` / `nutrition_targets` · `fitness_tests` · `running_plans` / `prescribed_runs` ·
`daily_zone_minutes`

An export that silently omits the user's heart rate, derived scores and AI history is worse than no
export, because it presents as complete. Filed as **Q-288**.

---

## 5. Lens K — cost (a negative result, and worth recording as one)

**AI spend is not a problem and should not be optimised.** `ai_call_log`: **255 calls, 632,639
tokens over 24 days ≈ 26,360 tokens/day.** At `gemini-3.1-flash-lite` rates that is cents per month,
and roughly $6/month even at 100× the users. **No backlog entry for cost.**

Two things worth noting anyway, filed together as **Q-295**:

| section | calls | total tokens | input | output | avg latency |
|---|---|---|---|---|---|
| **coach** | 17 | **330,221 (52%)** | 316,687 | 13,534 | **5,840 ms** |
| prescription | 43 | 151,783 | 127,831 | 23,952 | 2,455 ms |
| ai-chat | 4 | 61,015 | 60,346 | 669 | 2,966 ms |

Coach and ai-chat are **21 of 255 calls (8%) consuming 62% of tokens**, at a **23:1 input:output
ratio** — ~19,400 input tokens per coach call. The concern is **latency, not money**: 5.8 s is the
slowest surface in the app, and a large static prompt prefix is exactly what Gemini context caching
exists for.

**A documentation contradiction found here.** `docs/module-map.md` states Coach runs
`COACH_MODEL_ID` (`gemini-3.6-flash`). Production logs **17 coach calls, all on
`gemini-3.1-flash-lite`**, latest 2026-08-13. Either the model was never applied or the logging
misattributes it — one of them is wrong, and both matter. Filed as **Q-296**.

**Database is the real cost curve**, and it is already tracked: `oura_raw_samples` at 341 MB /
1,041,276 rows under an archival policy that correctly forbids server-side pruning
(`docs/db-volume-cleanup-handover.md`). Not re-raised.

---

## 6. Lens L — the degradation matrix

**Desk exercise only** — nothing here was executed. See §7.

Most cells are handled, and much of `CLAUDE.md` exists because of them: poison-pill outbox
quarantine, local-SQLite open-path recovery, cursor pagination, `pool.on('error')`, the
`reconcileSchema` authority. Rather than restate those, the honest output is the short list of cells
where the **intended** behaviour is undefined:

| failure | intended behaviour |
|---|---|
| JWT expires mid-workout | undefined — no recorded decision on whether an in-progress session survives |
| Service worker serves a stale shell after deploy | partly defined (build-stamped cache name); the *in-session* case is not |
| Device clock skewed hours from server | partly defined (ingest tolerances); no user-visible signal |
| Gemini rate-limited during a prescription generate | undefined — does the workout proceed on last-known numbers? |

I am **not filing these**, because a desk-derived list of undefined cells is a weaker artefact than
the same list produced against a running app. The right home is the Q-249…Q-254 testing cluster —
specifically Q-249 (the E2E harness), whose scenario list this belongs in. Noted here so it is not
lost, per *No orphaned findings*.

---

## 7. Surfaces NOT exercised

- **No device, no emulator, no browser, no `pnpm dev`.** Docs-only.
- **Lens L was not executed at all** — no failure was induced. Its table is reasoning from source,
  and it is labelled as such rather than presented as tested.
- **One user's data.** Every production number is the owner's, via row-scoped `claude_ro` views.
  The RPE finding in §1 in particular is **one lifter's 569 sets**: the miscalibration is systematic
  and visible, but the specific bucket means would differ for another athlete.
- **The AI sample is 8 insights read closely out of 117.** Not a systematic content audit.
- **`error_events` prunes at 30 days.**
- **Play Store requirements were not verified against current Google policy documentation** — Q-287
  and Q-288 assert the 2024 deletion requirement from knowledge, and an implementer should confirm
  the current wording before building.
