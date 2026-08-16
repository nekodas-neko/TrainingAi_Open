# Handoff — Lane A (platform / data), 2026-08-14

**Branch:** `claude/trainingai-backlog-v0abea` · everything below is merged to `main` unless marked.

This is the continuing lane of the two-lane split recorded in
[`docs/handoff-2026-08-14-app-shell-ia-cluster-delegation.md`](handoff-2026-08-14-app-shell-ia-cluster-delegation.md).
Read that first — it holds the file-ownership boundary and the number allocation, both of which still
bind.

## What shipped this session

| PR | Item | Note |
|---|---|---|
| #1337 | Q-230 — a walk records its steps and calories | Reworked server-side after CI's Build check |
| #1341 | Q-240, Q-241 — goals: invalidate on write, server as source of truth | Plus a third bug found on the way |
| #1342 | The lane split and its coordination contract | Docs |
| #1344 | Q-187 phase 2 slice 1 — `plan_meal_answers` table + sync path | **Item still open**, annotated not removed |
| #1346 | Q-155 table-count correction + this handoff | Docs |
| #1348 | Q-180 decided — keep, and the code now says why | Entry removed |
| #1351 | Q-181 deferral re-confirmed by re-measurement | Watch-only |
| #1352 | Q-107 closed as superseded; Q-184 checked; **Q-270 filed** | Docs |
| #1355 | Q-105-followup — the explainer says "still learning" (v1.308.0) | Entry removed |
| #1356 | **Q-85 plan** written; Q-270 diagnosis completed | Q-85 needs an owner call |
| #1364 | **Q-270 fixed forward** — training-stress warmed on launch | Forward only, persist unverified |

## What Q-187 still owes

**Only the prefill UI.** The table, both sync directions, the `pushMutations` branch and
`/api/nutrition/plan-meal-answers` are done and tested; nothing reads them yet, which is the plan's
own sequencing. Remaining work is steps 2–4 of
[`plans/2026-08-13-meal-plan-prefill-and-confirmation.md`](superpowers/plans/2026-08-13-meal-plan-prefill-and-confirmation.md):
the read-only prefill, then answers wired to `logPlanMeal` (yes) and the new table (no), then the
decision on automatic-vs-explicit — the plan recommends explicit first.

**It is held deliberately, not blocked.** It touches `app/nutrition/nutrition-content.tsx`, which the
IA lane owns for Q-237. Start it once Q-237 lands, so that file has one owner at a time.

**The verification bar the plan sets** is worth re-reading before writing any of it: a day with
prefills showing and none answered must report *identical* totals to the same day with the plan off —
asserted on `/api/nutrition/energy-balance` and the macro rings, not on row counts.

## Four things that will otherwise be relearned

1. **Run the suite under the TCP `DATABASE_URL`, not the socket form the session hook exports.**
   `claude-ro-readonly-role.test.ts` *skips entirely* under the socket URL. A local run reporting
   `470 files | 1 skipped` reads as green and is not: under
   `postgresql://postgres:postgres@localhost:5433/trainingai_dev` it is `471 files, 3,900 tests,
   none skipped`. That skipped file is what failed CI on #1344. **Treat a nonzero skip count as
   something to explain.**
2. **`pnpm build` is part of the gate.** tsc + lint + rules + suite passed on a change that failed
   CI's Build job, because a client component imported a module reaching `node:path` (Q-221's
   boundary). That cost a full rework on #1337.
3. **A new table means repointing `claude-ro-readonly-role.test.ts`** at the newest `claude_ro` views
   migration, in the same commit. Each migration DROPs and rebuilds the schema, so an older file
   rebuilds it without the new view and the coverage assertion fails (80 views vs 81 tables). The
   file's own comment says so; it still went stale.
4. **Verify a guard by running it against the unfixed code.** Two guards written this session were
   wrong before they were right: one keyed on a string the fix itself introduced (so it recognised
   only code already carrying the fix), and one matched a pure read site because it tested for the
   URL and the method separately rather than in the same call.

## Next on this lane

Work the queue top-down, skipping the 2026-08-14 IA cluster (Q-232…Q-244), which the other lane owns
and has largely landed.

**⚑ Updated 2026-08-15 (late): the IA lane CLOSED and released file ownership**, so none of the
paths listed in the delegation contract are held any more. Q-243 was its last open item and Lane A
took it. Three follow-ups it filed remain: **Q-255** (owner-gated), **Q-232-followup**
(device-gated), and **Q-257** — which is the one worth picking up, see below.

**Everything actionable without the owner has been worked.** What remains, and why:

- **⛔ Owner-gated:** **Q-85** (the §4 call in its plan — protect the compound, compress everything,
  or decline; the plan recommends the first and says declining beats the second), **Q-137**, Q-201,
  Q-231, Q-222, Q-214, Q-211, Q-72, Q-147, Q-168.
- **⛔ Device / Kotlin:** Q-116, Q-114, Q-111, and **Q-184** — now recommended *held* behind Q-204,
  since the direction the owner already chose replaces the number Q-184 would compute.
- **Q-204** — the design questions (MET-minutes vs TRIMP, replace vs alongside, what equals 100) are
  the same "pick the number honestly" problem Q-137 is gated on. **Its Gate 1 improved on
  2026-08-15**: Q-270 means `training_load_ots` should populate forward, though with no backfill.
- **Held on sequencing, not blocked:** **Q-187's UI half**, until the IA lane's **Q-237** lands. As
  of 2026-08-15 Q-232/233/234/235/236/239/242/244 have merged and **Q-237 has not** — check before
  assuming.
- **Deliberately not work:** Q-155, Q-180, Q-181, Q-107, Q-270 (fixed forward), Q-105-followup.
- **▶ Q-257 is the best next build, and its blocker turned out not to exist.** The entry says
  "decide, then build" — a global "Log Food" needs a meal-type rule. **That decision is already made
  in code, twice:** `mealTypeForHour` picks by clock time against the user's configured windows and
  is used by both the saved-meals sheet and `logPlanMeal`, with a doc comment saying it is shared so
  the two cannot drift. Build on it rather than re-deciding. One judgement call while doing so: both
  callers pass the **device's** `getHours()`, which is defensible here but should be deliberate.
- **▶ Q-187's last slice** is automatic prefill, deliberately last: the plan recommends an explicit
  "fill my day" action over filling on open, since a prefill that guesses wrong trains the owner to
  ignore it.

### Do this first, and it is not optional

**Re-read `training_load_ots` in production.** Q-270's fix is forward-only and its persist could not
be proven locally — the dev seed gates before the write.

```
SELECT count(*) AS days, count(training_load_ots) AS populated, max(date) AS latest
FROM claude_ro.oura_daily_derived;
```

**If it is still 0 after a day or two of real use, the Q-270 diagnosis was incomplete** and the entry
should be reopened rather than trusted. Also re-read `error_events` per the session-start rule —
Q-107 was closed on two quiet days, which is not proof.

**Q-155 needs no immediate work.** It has had three burn-down passes; what remains is per-predicate
attribution the entry itself prices at ~5.5 h and defers with reasons. Its table count was corrected
on 2026-08-14 (13 → 15) and **both new tables proved already covered** — that correction closes a
suspected hole rather than opening one.

## Owed to the owner

Nothing shipped today is device-verified. In rough order of risk:

- **Local SQLite v26 (`plan_meal_answers`).** **v25 has never run on a phone**, and v26 stacks on it.
  The migration is about as safe as a local one gets — `CREATE TABLE IF NOT EXISTS`, no PRAGMAs, no
  `ADD COLUMN` — and it is registered in `RECONCILE_TABLES`, but the risk is not zero. **If Saved
  Meals or the meal-plan card comes up blank after this ships, revert rather than debug forward.**
- **The goals change (Q-241).** The behaviour that matters most is "a second device sees the goals
  the first one set", which is by definition a two-device check the sandbox cannot make.
- **A walk's step count (Q-230).** The arithmetic and wiring are proven; that a real 5,000-step walk
  reports something a phone pedometer would recognise is not. The first walk after this deploys is
  the one to look at.

All of it is JS/server, so it reaches the device on the next Railway deploy — no APK rebuild.

## Pickup prompt

You are the platform/data lane (Lane A) on the TrainingAI backlog, working alongside a second agent
that owns the 2026-08-14 UI/IA review cluster (Q-232…Q-244).

Check out `claude/trainingai-backlog-v0abea`, cutting it fresh from `main`:
`git fetch origin main && git remote prune origin && git checkout -B claude/trainingai-backlog-v0abea origin/main`.

Read in this order: `projectOverview.md` → `docs/handoff-2026-08-14-app-shell-ia-cluster-delegation.md`
(the lane boundary and number allocation — you claim Q-270 upward and all migrations from 189) →
`docs/handoff-2026-08-14-platform-backlog-lane-a.md` (this document) → the entry you pick up.

**Do not touch** `app/more/**`, `components/more/**`, `components/profile/**`, `app/admin/**`,
`app/overview/**`, `app/nutrition/nutrition-content.tsx`, `app/health/health-content.tsx`, or
`lib/health-card-order.ts` — the other lane holds them.

Your first action: verify Q-270's fix landed as intended, by querying production for
`count(training_load_ots)` on `claude_ro.oura_daily_derived` (the query is in this document's "Next
on this lane"). It is forward-only and its persist could not be proven in the sandbox, so **if the
column is still 0 after a day of real use, reopen Q-270 rather than trusting it**. Then re-read
`error_events`, since Q-107 was closed on only two quiet days.

After that: Q-180, Q-181, Q-105-followup, Q-107 and Q-270 are all resolved — **do not re-open them**.
Q-184 has been checked and is recommended held. The remaining queue needs owner decisions; if none
have arrived, the useful work is **Q-187's UI half once the IA lane's Q-237 lands**.

Gate every PR on: `pnpm dev` exercising each changed route, `pnpm build`, `npx tsc --noEmit`,
`pnpm lint`, `pnpm check:rules` (quote its `Ran N of N` count), and the full suite **run under
`DATABASE_URL=postgresql://postgres:postgres@localhost:5433/trainingai_dev`** — the socket form the
session hook exports silently skips a whole test file. Verify every new test by running it against
the unfixed code first and watching it fail. Re-verify each backlog entry's premise against current
`main` before implementing: several this week were wrong in ways that changed the work.

Merge a green, tested PR without asking; confirm first only for data-dropping migrations, auth or
secrets. Per PR: a new journal file in `docs/overview/entries/`, a `projectOverview.md` update, the
backlog entry removed (or annotated if the item is only partly done), and a version + changelog bump
if anything user-visible changed.
