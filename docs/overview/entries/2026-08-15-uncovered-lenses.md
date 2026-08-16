# 2026-08-15 — the six lenses twelve reviews never used

**Branch:** `claude/gym-app-comprehensive-review-j38fo9` (restarted from `main` after #1377 merged) ·
**Type:** review, docs-only · **Backlog:** Q-285 … Q-296 (12 entries)

Follow-up to the same day's scoring-pillar review (#1377, Q-271…Q-284). The owner asked what was
still unexamined after twelve sweeps. Six lenses survived a grounding check against the repo and
production — feature usage, account lifecycle, training science, AI output, cost, degradation — and
two of them produced findings during the check itself. Prompt in
[`2026-08-15-uncovered-lenses-prompt.md`](../../reviews/2026-08-15-uncovered-lenses-prompt.md),
findings in [`2026-08-15-uncovered-lenses-review.md`](../../reviews/2026-08-15-uncovered-lenses-review.md).

## The one that mattered

**`expectedRpe` measured against 569 real production sets** — the mirror of what #1377 did to the
health scores, applied to the training model. It drives RPE autoregulation and the emergency-deload
safety net, and it predicts logged RPE at **r = 0.348**.

The bucket table is the finding. At expected RPE 5 the systematic error is **+1.93**; at expected 10
it is **−2.19**. `RPE_DEAD_BAND` is **1.5**, `<= −2` adds two target reps, and emergency deload fires
at 2.0. **The model's own miscalibration clears its consumer's thresholds before the lifter does
anything**, on 21% of sets. It is also non-monotonic at the top — expected 9 comes back harder than
expected 10 — which points at `maxRepsAtPct` rather than a constant offset.

Worth being clear that the model's *construction* is good: inverting `repFactor` to get RIR is the
right method, and tying it to the shared 1RM curve is *One Formula, One Place* doing real work. The
defect is that a constant was never checked against the data it consumes. `MUSCLE_LANDMARKS` came out
of the same review looking sound.

## What the grounding check corrected

Two things I asserted in conversation before measuring them were wrong, and both are recorded in the
review rather than quietly dropped:

- **"Effort went into notification content while nothing could receive it."** The notification work
  in `projectOverview.md` is **native Android** and works. The **web-push** stack is the inert one.
  Narrower finding, same file, filed accurately (Q-285).
- **"No data export."** `/api/export` is a real user-facing NDJSON takeout. What is missing is
  *deletion* (Q-287) and export *completeness* — 27 domains against 80 tables (Q-288).

## A shipped control that cannot work

`supplements.reminder_enabled` is a live `<Switch>` (`manage-supplements-sheet.tsx:253`) that
persists through the API and syncs to the device. Nothing reads it to fire anything. There is no
cron layer (`module-map.md` §0 says so deliberately) and `sendPushToUser` has one caller —
`/api/push/test`. The toggle looks like it saved because it did save. Q-286 leans toward Capacitor
local notifications, which sidestep both blockers without violating the no-cron rule.

## The AI is good, and it argues with itself

Read across `ai_health_insights`: specific, numerically grounded, genuinely useful. Then 2026-08-06:
the readiness insight said *"Keep your planned exercise intensity low"*, `workout_sessions` shows
**two** sessions that day, and the digest said *"Crushing three PRs… Keep that same energy
tomorrow!"* Readiness fell 79 → 76 → 76 → **65** over the following days. Each surface builds its own
prompt from its own slice; none can see what another said today (Q-291).

Separately the AI claimed *"a perfect activity score"* on a day the stored score was **80** (Q-292).
`CLAUDE.md` forbids an LLM number *gating an action* but not one *displayed as fact* — worth
amending alongside the fix.

## Cost: measured, negative, do not optimise

255 calls / 632,639 tokens over 24 days ≈ 26,360 tokens/day. Cents per month; ~$6/month at 100× the
users. No entry filed for cost. Coach still earns Q-295 on **latency** — 8% of calls, 52% of tokens,
19,400 input tokens and 5.8 s per call.

Measuring it turned up a documentation contradiction: `module-map.md` says Coach runs
`gemini-3.6-flash`; production logs **all 17 coach calls on `gemini-3.1-flash-lite`** (Q-296). Either
the model never applied or the logging misattributes it — and while it stands, the numbers above are
not fully trustworthy.

## What I did not do

Lens L (degradation) was a **desk exercise — no failure was induced**. Rather than dress that up, its
four undefined cells are filed as a note against Q-249's scenario list (Q-294) instead of as
standalone work. No device, emulator, browser or `pnpm dev` run. The RPE result is one lifter's sets.
Eight of 117 AI insights were read closely. The Play Store requirements behind Q-287/Q-288 are
asserted from knowledge, not from a fetch of Google's current policy.
