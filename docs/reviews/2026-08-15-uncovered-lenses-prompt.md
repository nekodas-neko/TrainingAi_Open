# Prompt — the six lenses twelve reviews never used

**Written:** 2026-08-15 · **For:** this session, re-runnable by a fresh one · **Type:** review, docs-only output
**Companion to:** [`2026-08-15-comprehensive-app-review.md`](2026-08-15-comprehensive-app-review.md) (Q-271…Q-284)

Everything below the horizontal rule is the prompt.

## Why this exists

Twelve review sweeps have run since 2026-07-04. Between them they cover security, correctness,
caching, offline behaviour, database scalability, information architecture, mobile UI standards,
performance, empty states, and — as of Q-271…Q-284 — the five health scoring pillars measured
against production.

The owner asked what was still missing. Six answers survived a grounding check against the repo and
production, and **two of them produced concrete findings during that check**:

- **`push_subscriptions` has 0 rows in production.** The subscribe path exists
  (`app/api/push/subscribe/route.ts`, `lib/push-client.ts`, `lib/push.ts`) and no device is
  registered — so every notification feature is inert. Meanwhile `projectOverview.md` carries at
  least three Known-Issues rows about tuning notification *content*. Not recorded anywhere.
- **There is no self-service account deletion.** `/api/export` is a real user-facing takeout
  (session-auth, NDJSON) so that half is covered; deletion exists only under
  `app/api/admin/users`. Google has required an in-app *and* web-accessible deletion path since
  2024, and the Play Store listing is a stated goal.

One candidate was **checked and dropped**: DST. `DEFAULT_TZ = 'Australia/Brisbane'` has no DST and
the rulebook leans on that, but the date helpers use `date-fns-tz`'s `formatInTimeZone`, which
handles DST correctly. Worth a targeted check some day, not a lens.

---

## Prompt

You are running the six lenses this project's review history has never used. Output is a review
document, one backlog entry per actionable finding, `projectOverview.md` rows for anything
found-but-not-fixed, and a journal entry — in **one docs-only PR**. Per *Backlog-driven
implementation*: plan now, build later.

### Read before looking at code

1. `projectOverview.md` open rows — do not re-raise what is recorded.
2. `docs/implementation-backlog.md` — **Q-271…Q-284 were just filed** and cover the scoring pillars;
   check the "Next free Q number" line against **both** the file and `list_pull_requests`.
3. `CLAUDE.md`, and `docs/module-map.md` before claiming anything should be shared.

### Ground rule

**Measure before you claim.** Two findings in the companion review died on verification (a "dead"
column that was documented as deliberately frozen, "dead" code that fires on 1 day in 40). Expect
the same rate here and treat it as the process working. Every quantitative claim carries its query.

**The `claude_ro` limit applies to every production number:** views are row-scoped to one user;
`error_events` prunes at 30 days. Write "the owner's", never "everyone's".

---

## Lens G — what did we build that nobody uses?

Distinct from Q-239 (screens with one entry point). That asked *can you reach it*; this asks
*did anyone*.

**G1 — Row counts across every feature table**, owner's account. Starting point, already measured:

```
ai_call_log 255 · ai_health_insights 117 · personal_records 30 · coach_messages 16
prescribed_runs 12 · goal_recommendations 11 · coach_threads 5 · saved_meals 3
friendships 2 · fitness_tests 2 · supplements 2 · meal_plans 1 · running_plans 1
push_subscriptions 0 · seasons 0 · season_results 0 · injuries 0 · feedback_submissions 0
```

For each zero and near-zero, decide which it is — and the four outcomes are genuinely different:
1. **Broken** — the write path does not work (this is the `push_subscriptions` hypothesis).
2. **Unreachable** — no UI writes to it.
3. **Reachable, unwanted** — built, findable, and the owner does not want it. Candidate for deletion.
4. **Correctly empty** — `injuries` at 0 is a *good* outcome if the owner has no injuries. Do not
   file this as a defect.

**G2 — The push finding specifically.** Chase it to a cause. Does the APK ever call
`pushManager.subscribe`? Is the VAPID key configured in Railway? Does `lib/push.ts` have send sites
that are firing into nothing? **Count the effort already spent on notification content while the
transport had no subscribers** — that number is the argument for this lens existing.

**G3 — The inverse.** Which tables are large *relative to the feature's visibility*? A feature with
heavy write volume and a buried entry point is the mirror-image problem and worth the same table row.

---

## Lens H — account lifecycle and the Play Store gates

The owner has stated the goal is production and a Play Store listing. `CLAUDE.md` names the privacy
policy, data-safety declarations, and the Health Connect declared-use-case review. Nobody has
audited the account lifecycle itself.

**H1 — Deletion.** Confirm there is no self-service path, then scope one. It is not a DELETE
statement: enumerate every table holding user data (the `claude_ro` generator already had to solve
exactly this problem — reuse its user-scoping map rather than rebuilding it), and decide hard-delete
vs. tombstone per table. Note the FK hazards `CLAUDE.md` already records.

**H2 — Export completeness.** `/api/export` exists and streams NDJSON. Diff the domains it covers
against the full table list. An export missing tables is worse than no export, because it looks
complete.

**H3 — The rest of the gate.** Privacy policy, data-safety declaration, Health Connect declared-use
review, and what a second real user implies for each. Produce a checklist with a status per item,
not prose — this is a gate, and gates want checkboxes.

**H4 — Do not build any of it.** This lens produces a scoped backlog entry and a checklist. Account
deletion is destructive and irreversible and needs the owner's explicit sign-off on the semantics
before a line is written.

---

## Lens I — is the training science sound? (the highest-value lens here)

**This is the exact mirror of the companion review.** That one asked whether the *health* scores are
defensible. This asks the same of the *training* model — and for a gym app it is arguably the more
important half. `packages/shared/src/ai-periodization/` has been reviewed repeatedly for code
correctness and **never once for whether its model reflects good practice**:

```
autoregulation.ts · expected-rpe.ts · deload-constants.ts · volume-targets.ts · goal-ranges.ts
per-exercise-deload.ts · muscle-recovery.ts · emergency-deload.ts · phase-guards.ts · time-budget.ts
role-plausibility.ts · signals.ts · confidence.ts · generate-prescription.ts · apply-prescription.ts
```
plus `packages/shared/src/1rm.ts` and `phase-engine.ts`.

**I1 — Enumerate the constants and claims.** Every threshold, curve, volume landmark, rest
prescription, deload trigger and RPE expectation. For each: what does it assert about physiology,
and where did the number come from? Expect most to have come from nowhere in particular — that is
the finding, and it is the same shape as Q-271's 6-hour anchor.

**I2 — Compare against the evidence base.** Research rather than recall: volume landmarks (MEV/MAV/MRV
and the criticism of them), proximity-to-failure / RIR-based autoregulation, deload necessity and
protocols, frequency-vs-volume findings, 1RM estimation error at high rep ranges, and progression
models (double progression, percentage-based, velocity-based). Where the app's model contradicts
current consensus, say so with the source. Where it *matches*, say that too — a review that only
finds fault is not measuring.

**I3 — Measure against production.** 30 `personal_records`, 52 `workout_sessions` in 60 days,
`set_logs`, `exercise_logs`, `session_periodization`, `phase_sets`. Concretely:
- Do prescribed weights actually get lifted? Compare prescription to logged load and reps.
- Does `expected-rpe` predict the logged RPE? That is a directly checkable claim.
- Does the deload logic fire at defensible times, or on noise? Q-115 and Q-228 are both deload
  corruption incidents — the *mechanism* was fixed twice; the *policy* has not been examined.
- Do the volume targets correspond to what the owner sustainably does?

**I4 — The 1RM question.** `calc1RM`/`calcAmrap1RM` have a documented history of a wrong high-rep
guard inflating PRs. Estimation error grows sharply above ~5 reps in every published formula. Check
what the app does with high-rep estimates now and whether `personal_records` contains any that
should not be trusted.

---

## Lens J — what is the AI Coach actually saying?

`ai_call_log` (255 rows), `coach_messages` (16), `ai_health_insights` (117), `coach_threads` (5),
`goal_recommendations` (11) are all readable through `claude_ro`. Q-170 measured the coach's
*latency*. Nobody has read its *output*.

**J1 — Read the actual messages.** Sample across the full range, not just recent. Judge: is it
correct, is it specific to this user's data, does it contradict the app's own numbers, does it
hedge into uselessness?

**J2 — Safety.** The sharp edge for a training app. Does the coach ever recommend training through
an illness flag (`illness_score` is populated on 39 of 40 days), through flagged soreness, or
against an active deload recommendation? Does it give medical advice? Does it assert a number it
cannot know? `CLAUDE.md` already forbids an LLM self-reported number gating an automatic action —
verify that holds in the *output*, not just the code.

**J3 — Grounding.** `ai_health_insights` at 117 rows against `coach_messages` at 16 means insights
are generated far more often than the user converses. Are they read? Are they regenerated
identically? Is anything deduplicating them (`ai_call_log.fingerprint` has an index — that is a
hint, and its index shows **zero scans**).

---

## Lens K — cost

No review has looked at money.

**K1 — AI spend.** `ai_call_log` is the source. Tokens per call, calls per day, cost per day at
current Gemini pricing, and the trajectory if the user count goes from 1 to 10 to 100. Identify the
most expensive route and whether its cost matches its value.

**K2 — Database.** 341 MB today, `oura_raw_samples` is 1,041,276 rows of it, growing ~3.2 MB/day
under an archival policy that explicitly forbids pruning the server copy. Project the cost curve and
name the point at which the policy needs revisiting. **Do not propose pruning** — `CLAUDE.md` is
emphatic and the reasoning is sound; the useful output is the number and the date, so the decision
can be made deliberately rather than at capacity.

**K3 — Railway.** Compute and bandwidth, to whatever resolution is reachable without new
instrumentation. If it is not reachable, say so and stop; do not build a metrics pipeline for a
review.

---

## Lens L — the degradation matrix

Offline has been reviewed as a *feature*. Failure has never been reviewed as a *matrix*.

**L1 — Build the table.** Rows are failure modes; columns are: what the user sees, what the code
actually does, whether that is the intended behaviour, and whether anything tests it.

Failure modes to cover at minimum: airplane mode mid-set · network drops mid-sync-pull · Postgres
unreachable · Gemini down or rate-limited · ring disconnects mid-workout · strap disconnects mid-set
· scale times out · phone reboots mid-workout · local SQLite fails to open (this has taken the app
down twice) · outbox has a poison-pill mutation · JWT expires mid-session · service worker serves a
stale shell after deploy · clock skew between device and server.

**L2 — Only the cells that disagree are findings.** Most will be handled — several reviews and a
great deal of the rulebook exist because of them. Cells where the intended behaviour is undefined,
or where code and intent diverge, are the output.

**L3 — Note which cells no test covers**, and feed that into the Q-249…Q-254 testing cluster rather
than filing parallel entries.

---

## Output

1. `docs/reviews/2026-08-15-uncovered-lenses-review.md` — findings by lens, each with its evidence.
2. One backlog entry per actionable finding, tagged with its pillar slug(s).
3. `projectOverview.md` rows for anything found-but-not-fixed.
4. A journal entry in `docs/overview/entries/`.
5. One PR, CI green, merged.

State which surfaces you did **not** exercise. Per *Communication*, that section is not optional.
