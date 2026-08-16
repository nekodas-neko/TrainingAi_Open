# Handoff — device-agnostic architecture decisions + the owner bug batch

**Date:** 2026-08-02 · **Domain:** `platform` · **Session outcome:** two data-losing production bugs
fixed and shipped; the device-agnostic goal written down for the first time; two implementation
plans queued.

---

## What this session was trying to achieve

It began as "continue the Oura on-device rollup (D2 Task 5)". It became something else twice:

1. The owner opened a set of architecture questions — device-agnosticism, own-models progress,
   multi-user — that had never been recorded anywhere.
2. Mid-conversation, another session filed **five live production bugs**, two actively losing data.
   Those outranked everything planned.

D2 Task 5 was **not started**. That is deliberate, not an omission.

---

## What actually shipped

| PR | What | State |
|---|---|---|
| **#980** | Native-convergence goal layout + owner decisions | Merged |
| **#987** | Q-36 — guided walks could never sync | Merged |
| **#989** | Q-36 bookkeeping (journal, v1.249.5) | Merged |
| **#988** | Q-37 — local SQLite open path | Merged, **unverified on device** |
| **#990** | `CLAUDE.md` APK section correction | Merged |
| this PR | Architecture record + 2 plans + Q-37 bookkeeping (v1.249.6) | — |

**Q-36:** `computeWalkSegmentStats` rounds segment mean HR to 1dp; the schema demanded an integer,
so one fractional value rejected the *entire* activity payload on both write paths. The walk
dead-lettered and never reached the training calendar (`getCalendarData` reads Postgres). Fixed at
both ends — the schema relaxation is what lets an *already-serialised* outbox payload drain.

**Q-37:** three faults on every launch — WAL never enabled (`PRAGMA` sent through `execute()`,
which cannot return rows), the v13 upgrade retried forever (fallback never stamped the version
forward), and a leaked connection registration misdiagnosed as an upgrade fault.

---

## Decisions made, and why (do not re-litigate)

**Convergence, not rewrite.** All ~38 screens are kept, so the one condition that would have
re-opened the clean-slate rewrite does not hold. Reinforced by a discovery: `@trainingai/shared`
(#939/#941, 348 files, 36,450 lines, 492 importers) **is live on `main`** — #962 reverted only
#952's `shell/`+`api/` split, not the shared-package extraction. The bulkiest mechanical step is
already done.

**Tiered local retention**, measured against production: `oura_raw_samples` is ~97% of all volume
(~25,200 rows/day ≈ 3.2 MB/day). A uniform 1-year window would cost ~1.2 GB; what the UI actually
queries costs ~55 MB. So: raw frames **14 days**, decoded HR **1 year**, rollups and logs
**uncapped** — ~85–100 MB, cheaper than a uniform 90-day window. This makes D2 **Task 8 (prune)
load-bearing**, not cosmetic.

**Multi-user and multi-device are permanent.** An initial "I'll only ever use the S25" answer was
recorded as single-device and used to propose retiring the sync engine. **The owner corrected this
same-session**: friends have accounts, more phones are likely, and production/Play Store is the
long-term intent. Nothing in the sync subsystem retires. The withdrawal is recorded in the goal
layout rather than deleted, so it is not re-derived.

**Three source tiers**, the session's main architectural output — see
[`docs/device-agnostic-source-architecture.md`](device-agnostic-source-architecture.md). The useful
split is **raw-capable sources** (we derive) vs **computed sources** (vendor already derived), not
"Oura vs Health Connect". A future raw device slots in without special-casing.

---

## The correction that mattered most

An earlier audit reported that Health Connect "gives only stage durations, never IBI or PPG",
implying sleep staging was unportable. **That was answering the wrong question.** Verified against
the pinned plugin source: `RecordConverter.kt:81-90` serialises a **full sleep-stage interval
array**, and `lib/health-connect-sync.ts:401-407` already consumes it. Sleep staging for non-Oura
users is *already solved* via HC — and we currently discard the interval structure, so a hypnogram
for those users is nearly free.

The general lesson, and it bit twice this session: **read the pinned source, not a plausible
summary.** The same class produced the Q-31 error below.

---

## Findings that changed existing plans

**Q-31/D8's premise is factually wrong.** It claims two live Oura-IP imports; there are **seven**
(training-stress constants, steps-motion-decoder, cumulative-stress, SleepNet, `step_counter`, plus
the two it knows about). Its final "delete the vendored tree" step therefore cannot succeed as
written, so the item as scoped does not unblock the public-repo cut it exists for. The entry now
carries the full table and a re-scope note. Likely cause: a stale comment at
`steps-motion-decoder.ts:17-18` claiming it is "not yet wired in".

**D2 Task 6's text is stale.** It says the device neural half is SleepNet + dHRV. D5 already
replaced dHRV; the master plan's Review Outcome says SleepNet + `step_counter`. Anyone following
that page ports a deleted model and skips the primary steps source. Corrected in place.

**Only one D-item is a genuine Oura-model replacement** — D5 (daytime HRV). D0 is the *opposite*:
it adopted Oura's `step_counter` as the primary steps source, replacing a heuristic of ours.
"Own-analysis" in that program's name means "our servers, not Oura's cloud", not "our models".

**CI already builds and publishes the APK** to `releases/download/apk-latest/app-debug.apk`.
`CLAUDE.md` had been telling the owner to run `./gradlew assembleDebug` locally. More importantly it
implied a rebuild is the normal response to "needs device verification" — usually false, since the
APK loads JS from Railway. That misunderstanding caused a wrong call on #988 (recommending a hold
that no sideload could have satisfied).

---

## Deliberately NOT done

- **D2 Task 5** (port the deterministic rollup) — displaced by the bug batch.
- **Q-38, Q-39, Q-40** — remaining bugs from the batch, plans already written.
- **Gate A** (second Railway service for `api/`) — owner infra action, blocks Stage 2 only.
- **Phase 2/3 of de-Oura naming** — deliberately unbundled; Phase 3 needs its own plan.
- **The rewrite-validation research prompt** from the previous handoff — now moot (38 screens).

---

## Blocked on the owner

1. **Tap Retry on the sync-health card.** #987 is deployed; the stranded walk will not drain on its
   own, and should reappear on the training calendar once it does.
2. **Confirm Q-37 on the S25** — reopen the app, check the console for the *absence* of
   `duplicate column name: attempts` and `could not enable WAL mode`. No sideload needed. Until
   then the Known-Issues row stays.
3. **Gate A** — provision the second Railway service and set `API_ORIGIN`, if Stage 2 should move.
4. **Public repo name + GitHub account** — needed before Stage 4 only.

---

## Process note worth carrying forward

The post-merge bookkeeping for #987 was **skipped** — merged without the journal entry and version
bump `CLAUDE.md` requires *before* the merge fires. It was caught only because a scheduled check-in
happened to restate it. With self-merging there is no human beat to catch this. Corrected in #989.

---

## Pickup prompt

> Check out `main` and pull. Read, in order: `projectOverview.md`'s Current Status (the 2026-08-02
> paragraphs — note the resolved architecture question and the Q-37 Known-Issues row),
> `docs/device-agnostic-source-architecture.md` in full, then
> `docs/handoff-2026-08-02-platform-device-agnostic-decisions.md`, then
> `docs/implementation-backlog.md` from the top.
>
> Context you need that is not obvious from the code: the convergence-vs-rewrite question is
> **settled** (incremental, all ~38 screens kept) and must not be re-opened. Multi-user and
> multi-device are **permanent** — an earlier "single device" note in the goal layout was withdrawn
> the same day and the sync engine is maintained, not reduced. The owner's ring is a *personal
> enhancement*, not the app's dependency: Health Connect already supplies sleep stages and steps for
> everyone else, and the app must stop presenting as an Oura client.
>
> The queue's top open bug is **Q-38** (accepting a phase transition permanently empties the
> prescription card; plan is Workstream D of
> `docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md`). The two
> new items are **Q-43** (Health Connect as a first-class tier — a friend's score cards render blank
> today) and **Q-44** (remove vendor naming from user-visible copy, Phase 1 only, ~26 strings).
>
> **First concrete action:** ask the owner which of Q-38 / Q-43 / Q-44 they want first, and whether
> they have run the two device checks listed under "Blocked on the owner" in the handoff. Do not
> pick for them — Q-38 is a live bug they feel daily, Q-43 affects a real second user, Q-44 is
> cheap and visible.
>
> Constraints that will otherwise be re-discovered: **CI builds and publishes the APK** to
> `https://github.com/nekodas-neko/TrainingAI/releases/download/apk-latest/app-debug.apk` — do not
> tell the owner to run Gradle. **JS/TS changes reach the device through a Railway deploy with no
> APK rebuild**, so "verify on device before merging" is circular for a pure-TypeScript PR.
> **Q-37 (#988) merged unverified on device** — do not strike its Known-Issues row on intent. The
> DB-backed test files are flaky in the full suite and pass in isolation; re-run individually before
> reporting a failure. And per `CLAUDE.md`, the journal entry and version bump must be committed
> **before** the merge fires, not after — that was missed once this session.
