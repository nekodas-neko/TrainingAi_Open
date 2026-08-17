# Implementation Backlog

Priority-ordered queue of planned work. **Top item = next to implement.** Planning
sessions add entries here; implementer sessions work the queue top-down and clear
entries as they complete. History is not kept in this file — completed work lives in
git history and the session journal (`docs/overview/`).

## Live pointers

**These three numbers are the ones sessions collide on.** They are checked by
`scripts/check-backlog-pointers.js` in the Custom Rules job, which reads the real values from the
migrations directory, `lib/sqlite/migrations.ts` and the queue below — so a stale line here fails
CI instead of silently misdirecting the next session. Update them in the same PR that consumes a
number.

| Pointer | Value | Source of truth |
|---|---|---|
| Next free Postgres migration | **189** | `lib/data/postgres/migrations/` (head: `188_claude_ro_views_plan_meal_answers.sql`) |
| Local SQLite schema version | **v26** | `lib/sqlite/migrations.ts`; `lib/sqlite/__tests__/migrations.test.ts` asserts the max |
| Next unallocated Q band | **538** | the band table in [`docs/agents/README.md`](agents/README.md) |

> **Do not take Q numbers from here one at a time.** Each standing agent owns a band — Lane A
> 314–349, Lane B 350–386, BugFix 387–449, Review 450–499, Tuning 500–529 — and takes numbers from
> its own, so no agent needs to read or write this table for a routine finding. The bands exist
> because a shared next-free pointer is a *floor*, not an authority: it cannot see an unmerged PR,
> and a number can be claimed and merged inside a single session without ever appearing in an open
> one. That caused six collisions in three days, and two live ones — **Q-306 and Q-307 were each
> held by two different entries** — survived in this file until 2026-08-17.
>
> Q numbers are identifiers, not priorities. Priority is queue position, so a Q-451 sitting above a
> Q-314 is correct and expected. When a band runs out, claim the next block of 50 from the pointer
> above, record it in the band table, and bump this row.
>
> **Postgres migration numbers and local SQLite versions belong to Implementation Lane A alone.**
>
> **Known collisions on disk (harmless, do not rename):** migrations 081, 087, 146, 161 are each
> duplicated. Apply order between a same-numbered pair is ambiguous, but each pair is independent.
> Never rename an applied migration — `ensureSchema` tracks by filename, so a rename re-applies or
> silently skips.

## How entries are tagged

> **Every heading carries its `[domain]` tag(s)**, primary first, using the eleven pillar slugs from
> [`docs/domains/README.md`](domains/README.md). To pull one pillar's queue:
> `grep -n '\[sleep\]' docs/implementation-backlog.md`. An untagged heading is invisible to every
> per-pillar sweep, so `scripts/check-backlog-pointers.js` fails on one. Read that pillar's index
> (`docs/domains/<pillar>/README.md`) before starting: it carries the pillar's reference docs, open
> known issues and gotchas.

## The optional `Lane:` field

> Most entries have no lane line, and that is correct — **lane ownership is decided by the file
> paths an item touches**, per §3 of [`docs/agents/README.md`](agents/README.md), which is the
> authority. An entry states a lane only when the answer is worth writing down: the item spans paths
> that are **unlisted** in §3 and therefore need a baton claim, it needs a Postgres migration number
> or local SQLite version (**Lane A alone**), or two queued entries share a path and must not run
> concurrently. Introduced 2026-08-17 on Q-530/Q-288, which are all three at once. Do not read the
> absence of the field as "unassigned" — read it as "§3 already answers it".

## Before you start any item

> **⚠️ Re-verify the premise against current `main`.** Entries are leads, not specs, and this queue
> moves fast enough that a line written yesterday can already be stale. On 2026-08-14 alone, five
> entries had wrong premises, one symptom had self-cleared, and two named the wrong number of call
> sites. If the thing an entry asks for is already done, remove the entry with a one-line note
> rather than forcing a mismatched implementation to clear the queue.
>
> **⚠️ A merge on a stale base can resurrect a completed entry.** On 2026-08-10, #1220 restored
> **Q-173** in full and re-added a bare **Q-174** heading with no body; neither PR did anything
> wrong individually, the branch was simply cut before the removals landed. **A heading with no body
> under it is the specific tell.**
>
> `docs/owner-action-required.md` is **not** kept current — treat it as historical unless you have
> just re-verified it.

---

## Protocol

**For planning sessions (adding work):**
1. Write the implementation plan to `docs/superpowers/plans/YYYY-MM-DD-<name>.md`
   (per the writing-plans conventions). Do **not** implement it.
2. Insert an entry into the Queue below at the priority you judge right (position
   in the list IS the priority). Include: plan doc path, a stable feature-branch
   name, date added, and a one-line rationale for its placement.
3. Land the plan + backlog entry via a docs-only PR (no merge-confirmation gate
   needed per CLAUDE.md).

**For implementer sessions (working the queue):**
1. Take the **top** item in the Queue. One item per session run.
2. Dedup check before starting: if the item's branch already exists on `origin`,
   check it out and **continue** it (don't restart); if an open PR already covers
   the item, don't duplicate — babysit that PR to green or stop.
3. Otherwise: `git fetch origin main && git remote prune origin && git checkout -B <branch> origin/main`,
   then execute the linked plan task-by-task. All CLAUDE.md rules apply (tests +
   lint + local dev-server verification before presenting, offline-sync mirroring,
   cache groups, etc.).
4. **Remove the item's entry from this file in the same PR that completes it** —
   a merged item must never linger in the queue. If the plan was only partially
   completed, leave the entry but annotate what remains and link the PR. **Do not
   leave a "✅ shipped" narrative behind** — the PR and the journal entry are the
   record; this file only tracks what's still open.
5. Merge/deploy policy is governed by CLAUDE.md and the instructions given to
   your session — when in doubt, get CI green, summarise, and stop before merging.
6. After the PR merges, do the standard session-end bookkeeping (journal entry,
   `projectOverview.md` index, version bump + changelog if user-visible).

**Blocked items:** if an item can't proceed (needs a decision, prod data, an
on-device check), annotate it `⛔ blocked: <reason>` in place — implementers skip
blocked items and take the next ready one.

**Security debt is worked on a threshold, not every session:** the **Standing item
— Dependabot vulnerability remediation** (below, above the numbered queue) outranks
every numbered item **when it triggers** — **≥ 5 outstanding high/critical alerts**,
or **any single _critical_ alert older than ~1 week** (per the CLAUDE.md Package
Management rule). Below threshold, skip it and take the top numbered item; the
alerts accumulate until the next sweep. It is never removed — it's driven back
below threshold and left in place for next time.

> **Reading a PR number in these docs.** This repository begins at one commit — the 2026-08-16
> snapshot of a private repo that had reached ~#1399. Every PR number cited below roughly **#1250 and
> under refers to that archived repository**, `nekodas-neko/TrainingAI`, not to a pull request here,
> and the numbering restarts from #1 in this one. The archived repo is read-only rather than deleted
> precisely so those references stay resolvable. See [`NOTICE`](../NOTICE) for why the history could
> not come across.

---


## [platform] Standing item — Dependabot vulnerability remediation (always top priority when triggered)

- **Branch:** `chore/dependabot-remediation` (fresh from `main` each pass)
- **Trigger:** ≥ 5 outstanding high/critical alerts, OR any single critical alert
  older than ~1 week. **Currently below threshold — skip.**
- **State as of 2026-07-27:** `pnpm audit` reports **2 high**, both the same advisory
  (`sharp`'s inherited libvips vulnerabilities, GHSA-f88m-g3jw-g9cj) reached
  transitively via `next > sharp`. Fixing it means a major `next` bump or a
  force-override under Next's own dependency — either gets its own PR per this
  project's major-bump rule, not a drive-by fix. No Dependabot grouped security PR
  was open at last check. Re-check `pnpm audit` and the GitHub Dependabot dashboard
  before taking this — the count may have moved since.

---

## Queue

> **Swept 2026-08-04.** Three entries removed as complete, per this file's own rule that a finished
> item must never linger in the queue:
> **Q-41** (calendar/streak local overlay — both surfaces shipped in #1001/#1009/v1.252.2; only a
> device check remains, and that belongs on the owner checklist, not here),
> **Q-47** (cadence — answered from production, the strap does capture and persist it) and
> **Q-57** (Body Battery inputs — shipped as v5).
> Six more cleared the same day by implementation: Q-63, Q-66, Q-68, Q-69 plus the two above.
>
> **Swept again 2026-08-05.** **Q-65** removed — shipped (PiP now routes the exercise-summary rest
> through `PipView`). **Q-70** removed — **refuted by measurement**, not deferred: the owner's second
> device capture measured `/workout?session` four times at a 115.4 ms median, warm 4 / cold 0, so
> there is no cold payload fetch for a prefetch to remove. Evidence in
> [`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md);
> do not re-add it without a capture showing a cold session tap. **Q-74** removed — done: the
> session-start orientation in `CLAUDE.md` now includes an `error_events` read, with the query
> inline and the "stopped ≠ fixed" rule attached. Its optional second half (keeping a rolled-up
> count past the 30-day prune) was **deliberately not built** — nothing has yet needed a fault older
> than the window, and a new aggregate table is not free on a DB whose growth is the binding
> constraint. Re-raise it if a pruned fault is ever actually missed.
> **Updated 2026-08-05: Q-65 shipped (v1.257.1, JS-only) and Q-67 shipped (v1.257.3, needs the new
> APK) — and **Q-64 shipped too (v1.258.0, needs the new APK), so the batch is closed.** Q-67's Task 2 asked a sibling-surface
> question that is now **answered and shipped** (v1.259.0): the owner asked for the ring and strap
> notifications to be quieted like the scale's, **but with a low-battery exception** — a one-shot
> alert below 35%, hysteresis re-arming at 40%. See
> [`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md).
>
> _Superseded:_ **What is left in the owner bug batch (Q-64, Q-65, Q-67) is native/Kotlin and needs an APK** —
> the JS-only half of that batch is done.


> **⚑ Owner unblocking decisions, 2026-08-02 — read before picking anything up.** Four questions
> that had been stalling this queue were answered, and the answers are recorded with an ordered
> run-list in
> [`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](../docs/handoff-2026-08-02-platform-batch-queue-drain.md).
> In short: **Q-1 is deferred but not cancelled** (do not provision the second Railway `api/`
> service; do not delete the entry); **device access is available** — the owner installs one APK
> and runs one consolidated checklist, so Kotlin items are in scope; **production read-only DB
> access works from the sandbox** and is verified, so measure-first items are no longer blocked;
> and the **`body_hex` bytea migration is declined** in favour of Q-35 — which was then measured
> against production on 2026-08-02 and **retired**: both its findings were dead, and **Q-46**
> replaced it with what the numbers actually justify — **Q-46 has since shipped** (#1003,
> v1.250.6); the one-time `REINDEX` that reclaims the existing ~130 MB is on the owner checklist. Each is annotated on its own entry below.

> **Owner bug batch, reported 2026-08-02 (Q-36 … Q-40).** Five live production bugs, all traced to
> source in the planning session. One plan covers all five as independent, separately-mergeable
> workstreams: [`docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md`](superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md).
> They sit above Q-1 because Q-1's next step is blocked on an owner infra action, and because two of
> them (Q-36, Q-37) were actively losing the owner's data. **All five have shipped** — Q-36 (#987),
> Q-37 (#988), Q-38 (#995), Q-39 (#996), Q-40 (#997). The batch is closed as an implementation
> queue; what remains is device verification, tracked on the checklist in
> [`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](handoff-2026-08-02-platform-batch-queue-drain.md).
> Follow-ups Q-41 (activity-payload hardening) and Q-42 (readiness-composite extraction) stay in the
> queue on their own merits.

> **Owner bug/feature batch, 2026-08-02/03 — final numbering Q-63 … Q-69.** Three separate parallel
> sessions collided on this range: a "per-exercise phase hold" plan claimed Q-52 first; the
> cross-domain bug review below claimed Q-53…Q-56; this batch originally claimed Q-52…Q-58 and was
> renumbered **twice** (52…58 → 57…62 → 63…69) to clear both collisions, since both other claims
> landed on `main` first. Branch names and plan filenames were **not** renamed to match (still say
> e.g. `2026-08-02-voice-logging-android-native-stt.md`, `fix/voice-logging-native-stt`) — only the
> Q number in this file and its cross-references changed.

> **Q-58 is COMPLETE (2026-08-04).** Part 1 (v1.256.2) added Next's `onRequestError` for the 80
> route files with no `catch`; part 2 (v1.256.3) added `reportServerError` to the 21 that caught
> their own error and returned a 500 silently. **30 of the 31 routes that can return a 500 now
> report.** The one that doesn't — `scale-ble/pending/[id]/confirm` — returns a 500 from a data-shape
> guard rather than a catch; reporting a validation branch would be wrong, and whether that case
> should be a 500 at all is a separate question. See
> [`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md).

> **Cross-domain bug review, 2026-08-03 (Q-53 … Q-56).** Four review agents plus a production
> DB-integrity pass turned up five findings across workouts and the BLE/scale ingest pipeline; full
> evidence in [`docs/reviews/2026-08-03-cross-domain-bug-review.md`](../docs/reviews/2026-08-03-cross-domain-bug-review.md).
> **Q-56 shipped 2026-08-04 (v1.255.1)** and its entry is removed — the step path now resolves ring
> time against the anchor nearest each frame and drops anything still dated in the future, rather
> than storing it. The sibling paths it did *not* cover are queued as **Q-71** below; see
> [`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md).
> Q-54 is a workout-prescription regression from the last two days of shipped work.
> **Q-53 shipped 2026-08-03 (v1.252.6)** and its entry is removed — its finding (c) was investigated
> and is unreachable, so no code was written for it; see
> [`docs/overview/overview/history-2026-07-30.md`](overview/history-2026-07-30.md).
> **Q-55 shipped 2026-08-03 (v1.252.5)** and its entry is removed — see
> [`docs/overview/overview/history-2026-07-30.md`](overview/history-2026-07-30.md).
> **Q-76 shipped 2026-08-05 (v1.261.0)** and its entry is removed. The `isAnalysableNight()`
> predicate it proposed was **not built** — `nightSessions()` in
> `packages/shared/src/health/sleep-night.ts` already did both halves of the work (circadian
> nap/night split, then gap-merge), so the fix was routing eleven read sites through the existing
> helper rather than adding a second rule beside it. Group C (2026-06-01, 2026-06-04) and the
> 2026-06-02/03 coverage gap are recorded as Known Issues in `projectOverview.md`; see
> [`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md).
> **Q-77 shipped 2026-08-05 (v1.262.0)** and its entry is removed — the `bedtime-sleep` view is live
> on the Health screen, minutes-from-noon coded, with a test that goes red under raw-clock-hour
> coding (it reproduces the review's r = +0.75 inversion). The **deep-sleep** half of the finding was
> deliberately **not** built: at p = 0.038 it does not survive Bonferroni across the ~60 pairs the
> review tested, and the bucket bars carry one value per bucket. See
> [`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md).
> **Q-78 shipped 2026-08-05 (v1.263.0)** and its entry is removed — the `hrv-volume` view is live,
> HRV coded as percent-of-28-day-baseline (matching its sibling) and tonnage summed per DAY, not per
> session. Its "candidate second use" — an input to the prescription engine — was **deliberately not
> built** and remains correct advice: n = 30 does not survive Bonferroni, so re-measure at n ≥ 60
> before anything automates on it. See
> [`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md).
> **Q-79 shipped 2026-08-05 (v1.264.0)** and its entry is removed — an admin panel under Day Review,
> beside the Sleep Score calibration and sharing its engine (`model-report-calibration.ts`) and card.
> **The pairing was measured, not assumed:** the causally appealing "rating the next morning" lag
> finds nothing (r = +0.115, p = 0.52); only same-date reproduces the review's r = −0.400. See
> [`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md).
> **With that, Q-75…Q-79 — the whole data-analysis review batch — is closed.**
> **Q-84 shipped 2026-08-05 (v1.265.0)** and its entry is removed — cadence now reaches all three
> fast/slow surfaces, and **leads** the pace it used to be missing beside, falling back to pace when
> no cadence source was connected. `walkEffortDisplay()` owns that choice so the three sites cannot
> drift. See
> [`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md).
> **Q-71 and Q-73 were skipped as ⛔ blocked** (owner decision / device capture) and annotated in
> place. **Q-73 is no longer blocked** — the 2026-08-07 full-app review found and reproduced its root
> cause without a device; the "needs a device capture" gate was itself based on a wrong premise. See
> its entry.
> **Q-83 shipped 2026-08-05 (v1.266.0)** and its entry is removed — a measured warmup median is now
> capped at 20% of the budget when today's budget is *below* the session's own configured length,
> which is the only case where the double-charge exists. It stays uncapped at the standard and long
> presets, so no existing plan changes. See
> [`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md).
> **It also produced Q-85 below:** the warmup fix recovers 3 working minutes, but the trimmer's
> exercise-count thresholds are ~6–7 minutes apart, and rest — not warmup — is what dominates a
> short budget.

> **Q-260 FIXED and removed, 2026-08-16 (v1.317.2).** The root cause was narrower than the entry
> guessed and is worth stating exactly: `user-goals` was fetched by `fetchProgressHealthData`, but
> the water goal renders in `waterIntake`, a **`BODY_GROUPS`** card. So a value shown on the Body tab
> was fetched only by the Progress tab's group — and because the shell keeps all five tabs mounted
> for the life of the app, nothing ever re-read it. The fetch moved to `fetchSharedHealthData`
> (which already re-runs on `tabEpoch`), and the localStorage seed moved into `useGoalSeeds`, which
> re-reads on `tabEpoch` instead of on mount alone. `goalsProgress` reads the same payload, so
> shared is correct for both tabs.
> **Proven, not assumed:** `e2e/goal-round-trip.spec.ts` lost its `page.reload()` workaround as the
> entry required, and now passes with the fix, **fails with `health-content.tsx` reverted to
> `main`**, and passes again restored. The extraction was made *after* that first proof, so the
> whole fix/revert/restore cycle was re-run against the final code.
> Journal: [`entries/2026-08-16-health-stale-goal.md`](overview/entries/2026-08-16-health-stale-goal.md).


### [devices][platform] Q-537 — the ring key has one copy and no way to back it up

- **Branch:** `feat/ring-key-export`
- **Added:** 2026-08-17, after an uninstall made the ring unreachable in a live session.
- **What it is.** The 32-hex ring key exists only in Android SharedPreferences
  (`OuraBlePlugin.kt`, `key_hex`). Deliberately — its own comment reads *"the key never leaves
  SharedPreferences; never logged"* — and that is the right call for a credential. But it means the
  key has **exactly one copy**, on one device, with no export, no backup, and no warning before the
  operations that destroy it.
- **Why it matters.** An uninstall or a device change silently makes the ring unreachable: the BLE
  service logs `no key stored`, refuses to start, and the Devices screen keeps showing the ring as
  healthy because that card reads server data. Worse, the intuitive recovery — re-onboarding the
  official Oura app — re-keys the ring and can force a firmware update that changes the BLE event
  encoding, which is precisely what the frozen firmware exists to prevent. **A recoverable
  credential problem turns into a protocol re-validation.** This happened on 2026-08-17 and was only
  recovered because the original `open_oura` `key.hex` still existed on the owner's machine.
- **What to do.** The minimum is an *export* affordance in `/admin/oura-ble` — reveal the stored key
  so it can be copied somewhere durable — plus a confirm-with-warning before `clearKey`. Consider a
  "key present" indicator on the Devices card, so a keyless state is visible where the ring is
  managed rather than only in the admin console.
- **Placement, reported separately.** The owner also asks that the key field be nested behind
  something deliberate rather than sitting in the open — *"so it cant accidently be used"*. That is
  the same subject and is best solved with Q-531, which is re-deciding where these screens live;
  the export/backup half below stands on its own.
- **What NOT to do.** Do not sync the key to the server to "solve" this. It is device-only on
  purpose, and moving it server-side widens the blast radius of every other credential path in the
  app. This is a *backup and visibility* problem, not a storage-location problem.
- **Verification:** the affordance must be shown to work while the key is present, and the warning
  shown to fire on `clearKey`. Device-only — nothing here is verifiable from the sandbox.

### [sleep][devices] Q-536 — every BLE-era sleep window is timezone double-converted: 43 nights show midday bedtimes

> **→ HANDED TO IMPLEMENTATION LANE A, 2026-08-17.** This is engine work — the fault is in
> `aggregateOuraRawSamples` (`lib/data/postgres/adapter.ts:5087`) and the clock-anchor resolution
> beneath it, squarely inside Lane A's ownership. It is **top of queue**: it is a live
> data-correctness fault on displayed health values, it was caused today, and every further
> redecode may compound it.
>
> **Read the corrected diagnosis below before the original text** — the first hypothesis
> (timezone double-conversion) is superseded by the epoch-collision evidence.
>
> **Do not run a corrective pass until the open question is settled:** whether the 2026-07-04 →
> 08-16 rows were already wrong, or were rewritten wrong by the 2026-08-17 redecode. Those need
> opposite responses, and 43 nights of the owner's sleep history are the blast radius.

- **Branch:** `fix/ble-sleep-window-timezone`
- **Added:** 2026-08-17, found while verifying the post-re-sync Health screen.
- **The symptom.** Health lists bedtimes like **12:07 pm – 8:31 pm** and **11:16 am – 10:26 pm**.
  Measured across all 82 stored sessions, start hours are **bimodal**: ~36 in a plausible 19:00–02:00
  band, and **43 clustered at 10:00–14:00** Brisbane, which is not a bedtime.
> **⚠️ DIAGNOSIS CORRECTED, same day.** The entry below hypothesised a timezone
> double-conversion. **That is superseded.** The measured cause is a **ring clock-epoch collision**:
>
> | epoch | anchors | anchor_utc span | anchor_ds range |
> |---|---|---|---|
> | 2 | 3,666 | 2026-07-30 04:18 → **2026-08-17 06:42** | 17,412,570 – **37,112,321** |
> | **3** | 695 | **2026-08-17 06:58 → 07:38** | **33,006,208 – 37,146,216** |
>
> **Epoch 3 was created at 06:58 on 2026-08-17 — the moment the app was reinstalled and the ring
> re-paired** — and its `ds` range *overlaps* epoch 2's. `CLAUDE.md` states the constraint
> directly: `ring_timestamp_ds` is a counter since the ring's own epoch, which **resets on
> re-key or dead battery**, and wall-clock comes from a `(ringDs ↔ utc)` anchor. With two epochs
> holding the same ds values, a resolution that picks the wrong anchor set shifts every derived
> timestamp.
>
> `toDate(ds)` in `aggregateOuraRawSamples` (`lib/data/postgres/adapter.ts:5087`) calls
> `resolveDsToMs(ds, anchors)` over the anchor set, and the rollup elsewhere uses
> `currentEpoch(anchors)`. **Establish whether raw rows carry their own epoch and whether the
> resolver is epoch-scoped per row** — if it is not, every pre-reinstall sample is now being
> resolved against a post-reinstall anchor. That is the fix, and it is also why the full redecode
> reproduced the fault instead of correcting it.
>
> Two things this reframes: the ds→UTC path is **not** generally broken (the newest `measured_at`
> is 07:38 UTC = 17:38 Brisbane, matching the device drain log exactly), and **the uninstall caused
> this**, which links it to Q-537 — the ring key hazard was not the only cost of that reinstall.
> Whether the pre-existing 2026-07-04→08-16 rows were already wrong or were rewritten wrong by
> today's redecode is **not yet established** and must be, before any corrective pass.

- **The display is innocent.** For 2026-08-17, `sleep_start` is stored as `02:07 UTC`, which
  genuinely *is* 12:07 pm Brisbane — the UI renders the stored instant correctly. A real 22:07
  Brisbane sleep should store as `12:07 UTC`; `02:07 UTC` is what you get if that correct UTC
  value is then treated as a Brisbane wall-clock time and converted **a second time**. This is the
  double-conversion shape, not a rendering bug, so do not go looking in the component.
- **It correlates with the pipeline, not the data.** Broken rows span **2026-07-04 → 2026-08-17**;
  plausible rows are predominantly **2026-05-26 → 2026-08-14** and are the Oura Cloud era. The BLE
  re-key was 2026-07-07. So the **direct-BLE sleep aggregation** carries the fault while the Cloud
  writer did not.
- **The redecode did not cause it, which is the useful part.** A full-history redecode on 2026-08-17
  recomputed every row from raw frames and produced **the same wrong windows**. The bug is therefore
  in the aggregation logic, reachable from stored `body_hex` — so a corrected decoder can fix all
  43 nights by re-running, with no data loss and nothing to reconstruct.
- **What is NOT affected:** duration, HRV, average and lowest heart rate all look right. It is
  specifically the window boundaries.
- **Where to look.** The path that turns `ring_timestamp_ds` into wall-clock via the
  `(ringDs ↔ utc)` anchor in `oura_ble_clock_anchors`, and whatever converts that into
  `sleep_start`/`sleep_end`. `CLAUDE.md`'s Timezone section names this exact class as the most
  repeated bug in the project. Suspect an anchor already in UTC being passed through a
  `todayInTz`-style conversion, or a `Date` built from a UTC string and then offset.
- **Verification:** a boundary test at 23:59 and 00:01 Brisbane, plus re-running the aggregation
  over a known night and asserting the window matches the owner's account of it. **Do not fix from
  reading alone** — this is the class that has shipped wrong three times.

### [platform][devices] Q-535 — Redecode reports "failed: 502" for work that succeeded

- **Branch:** `fix/redecode-async-job`
- **Added:** 2026-08-17, after a redecode reported `redecode failed: 502` while in fact completing.
- **What happens.** `POST /api/oura-ble/samples/redecode` hardcodes `fullHistory: true` — there is
  no scoped variant — so it walks all 1.1M rows and then rebuilds **every** daily summary. Q-213
  moved that work off the event loop into the rollup worker, which is why the rest of the process
  survives it, but the route's own comment is explicit that *"the caller still waits for the
  result"*. On real data that exceeds the platform's request timeout, so Railway returns **502**
  and the tester prints `redecode failed`.
- **The work had completed.** Measured this session: `scanned=1098158`, `updated=0`, and every
  `sleep_sessions` row carried `updated_at = 07:58:44` — after the request had already 502'd.
  The aggregate that the UI reported as failed is the one that produced the night the owner was
  trying to see.
- **Why it matters beyond the cosmetics.** A false failure invites a retry, and a retry is another
  full-history walk of the heaviest pair of calls in the app — the same operation whose own comment
  names it as *"the event-loop starvation that took production down on 2026-08-13"*. The UI is
  actively encouraging the thing most likely to hurt. It also cost real diagnostic time here: the
  502 was investigated as a crash before the data showed the write had landed.
- **What to do.** Return a job id immediately and let the client poll, rather than holding the
  request open. The work is already off-loop, so this is a response-shape change rather than an
  architectural one. While in there, consider whether a date-scoped redecode is worth having —
  `fullHistory` is correct after a decoder change, and overkill for "re-aggregate last night",
  which is what it is usually reached for.
- **Related:** Q-534 (the same table's index and vacuum problems) and the `disk_full` Known-Issues
  row. Do not run a full redecode while those are open.

### [platform] Q-534 — the safe half of the disk-full incident: statistics, autovacuum, and an index that stores the payload twice

- **Branch:** `fix/oura-raw-samples-index-and-vacuum`
- **Added:** 2026-08-17, from the live `disk_full` incident (see the `projectOverview.md`
  Known-Issues row for the measurements).
- **This is deliberately the non-destructive half.** The retention question — what `body_hex` is
  for and how long the server must keep it — is a separate, owner-gated decision with an
  irreversible edge. Everything here reclaims space **without deleting a single row**, and should be
  done first, because it may be sufficient on its own.
- **Three findings, in order of likely payoff:**
  1. **The dedup index stores the payload a second time.** It covers
     `(user_id, ring_timestamp_ds, tag, body_hex)`, so `body_hex` is in both the heap and the
     index — which is why indexes are **291 MB against a 175 MB heap**. Indexing a hash of the
     payload instead (generated column, or an expression index) preserves the dedup guarantee on a
     fraction of the bytes. **Verify the uniqueness semantics survive** before proposing it: a hash
     collision would silently drop a distinct event, which is exactly the loss the dedup exists to
     prevent, so the column must remain part of the equality check even if it leaves the index.
  2. **Autovacuum has never run on this table.** `last_autovacuum` and `last_analyze` are both
     null and `n_live_tup` reads 0. Find out why — the default thresholds scale with table size,
     so a table that grew fast from empty can outrun them. No statistics also means the planner has
     been guessing on the largest table in the database; the `DISTINCT ON` that triggered the
     incident takes 6.5 s even with disk available.
  3. **`work_mem` is 4 MB** and the failing query sorts 1.1M rows. Raising it for that path, or
     giving the query an index that avoids the sort, removes the temp-disk dependency that turned a
     full volume into a user-visible error.
- **The target is concrete:** the owner raised the volume 500 MB → 5 GB as a temporary mitigation
  and intends to return to the stock 500 MB. Measure what each change actually reclaims rather than
  estimating, and say whether 500 MB is reachable without touching retention.
- **Do not run a Full re-sync while this is open** — that is what triggered the incident.

### [devices][app-shell] Q-533 — the drain runs unattended but only reports completion to a screen nobody should have to watch

- **Branch:** `feat/drain-complete-notification`
- **Added:** 2026-08-17, owner report during a full re-sync: *"this is very lengthy. We shouldn't do
  any testing that involves this ever again unless it can do it silently in the background."*
- **The premise is half wrong, and that is the finding.** The drain **already runs in the
  background**: `OuraRingService` is a foreground service, it auto-drains on connect and re-drains
  hourly (`DRAIN_INTERVAL_MS`), and since v1.119.0 it POSTs each batch itself rather than needing
  the tester screen to forward frames. Nothing about a drain requires the UI.
- **What is actually missing is the ending.** `onDrainBatchComplete` only `log()`s
  `drain complete` (`OuraRingService.kt:400`). The service posts exactly one notification in its
  whole lifetime — low battery — so a user who starts a full re-sync has no way to learn it
  finished except by staring at the admin log. That is what makes a background operation feel like
  a foreground one.
- **What to do.** Notify on drain completion, at least for a full re-sync (`fromZero=true`), with
  the batch count and whether uploads settled cleanly. Reuse the existing notification channel
  pattern. Consider a quiet progress notification for long drains, since a full re-sync of a
  months-old backlog is thousands of events at 255/batch.
- **Also fix the instructions.** `docs/oura-ble-operations.md` §4 step 2 says *"watch the drain
  finish"*, which reads as a requirement and is only a verification convenience. It should say the
  drain continues unattended and name what to check afterwards.
- **Verification:** device-only. Start a full re-sync, leave the screen, confirm the drain completes
  and the notification arrives.

### [app-shell][devices] Q-531 — Q-234 moved the device consoles out of /admin, and in use that made them worse

- **Branch:** `fix/device-console-ia`
- **Added:** 2026-08-17, from an owner report while running the Oura re-sync runbook.
- **This is feedback on a shipped change, not a new idea.** Q-234 landed 2026-08-15 (v1.313.0):
  `/admin` kept user administration, diagnostics moved to **Settings → Developer**, and the three
  device consoles became rows there. Its journal records that as done and correct. The owner, using
  it under real conditions for the first time, reports the opposite: *"it was moved away from the
  admin section to the diagnostic section = bad"*, and *"everything is spread out sporadically,
  needs organisation"*.
- **Why the disagreement is the useful part.** Q-234's reasoning was taxonomic — device diagnostics
  are not user administration, so they belong apart. That is sound on paper and appears to be wrong
  in use, because the operations these screens support (drain, re-sync, verify) are a **single task**
  that now spans two locations. Re-litigate the premise before re-arranging anything; a second
  reorganisation chosen the same way will land in the same place.
- **What to do.** Read the Q-234 entry and its journal first, then treat this as an IA question with
  a real user's task in hand: what does someone actually *do* on these screens, start to finish, and
  where should that live. The answer may be that diagnostics belong back under `/admin`, or that
  the split is right but the destination is wrong. Decide it deliberately and write down why.
- **Related:** Q-537 (ring key has one copy) and Q-532 (the scan auto-recentre) both live on these
  screens. Q-537's placement half — the key field should be nested behind something deliberate so it
  cannot be edited by accident — is best solved as part of this, not separately.
- **Verification:** device-only. None of it is checkable from the sandbox.

### [app-shell][devices] Q-532 — the BLE screen re-centres itself while a scan runs, making buttons hard to hit

- **Branch:** `fix/ble-scan-scroll-jump`
- **Added:** 2026-08-17, owner report during the Oura re-sync runbook.
- **What it is.** *"The screen constantly moves to the centre while a scan is running — making it
  hard to click buttons."* While a BLE scan/drain is active on `/admin/oura-ble`, the view keeps
  scrolling back, so a control the user is aiming at moves out from under the tap.
- **Where to look first.** The screen re-renders on every status/log update during a scan, so the
  likely causes are a `scrollIntoView` / auto-scroll on new log lines, or a keyed remount that
  resets scroll position on each poll. `components/oura-ble/oura-ble-debug.tsx` holds the log and
  frame panels that update most frequently.
- **Why it matters more than it sounds.** This screen is only ever used during a live drain — the
  one situation where a mistimed tap can hit **Clear key** or interrupt a sync. An unstable layout
  on a destructive control set is a safety problem, not just an annoyance.
- **Verification:** reproduce on-device with a scan actually running; a static screenshot will not
  show it, and the sandbox cannot scan at all.


### [activity][cardio] Q-450 — `/activity` reached without a type: Start works, Finish works, Save silently discards the activity

- **Branch:** `fix/activity-untyped-entry-silent-save-loss`
- **Added:** 2026-08-17 · review sweep (failure-cells lens, **reproduced in a browser**) ·
  [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](reviews/2026-08-17-failure-cells-running-the-app.md)
- **Placement:** top of the queue. This one **loses a completed activity with no error
  message**, and the recording flow up to that point works perfectly, so the user has no reason to
  suspect anything until the data is gone.
- **Observed, not inferred.** Signed in against the seeded local DB, navigated to `/activity`, and
  drove it through Playwright at 412×915:

  | Step | Observed |
  |---|---|
  | Load `/activity` | Renders. Full text of the screen is **`"Title\nStart"`** — 58 KB of HTML, 11 characters of text |
  | Tap **Start** | Works. Active screen, timer running (`0:05 / Pause / Finish`) |
  | Tap **Finish** | Works. Summary renders (`0.1 / min / Discard / Save`) |
  | Tap **Save** | **Nothing.** No toast, no error, no navigation, no state change, **zero network requests**. `select count(*) from activity_logs` = 0 afterwards |

- **Root cause — `components/activity/done-activity-screen.tsx:167`:**
  ```ts
  async function handleSave() {
    if (!activityType || !startMs || !endMs || !draftSummary) return
  ```
  With `activityType === null` this returns before `setSaving(true)` — before the local
  `store.upsertActivityLog`, before the outbox `queueMutation`, and before the `/api/activity-logs`
  web fallback. **Discard is the only working control on that screen.** This is the `CLAUDE.md`
  *"No silent fallbacks on failure paths"* rule and the *"UI feedback fires synchronously"* rule
  failing in the same guard.
- **Why the untyped state is normal, not exotic.** `components/activity/activity-screen.tsx` renders
  `PreActivityScreen` whenever `mode === 'pre'` with **no guard on `activityType`**. The store's
  initial state (`lib/stores/activity-store.ts:71-74`) is `activityType: null, activityLabel: '',
  activityIcon: ''`, and `resetSession()` (`:180`) restores exactly that — and `resetSession()` runs
  **after every successful save** and **on the back button inside `PreActivityScreen` itself**
  (`pre-activity-screen.tsx:24`). So this is where the store sits *between* activities.
- **Why the screen gives no warning.** The `<h1>` and the type caption both bind `activityLabel`,
  which is `''`; `getActivityIcon('')` falls through to a placeholder ellipsis glyph. The user sees a
  back chevron, a dotted circle, an unlabelled "Title" field and a working Start button.
- **Two in-app paths reach it.** `startActivity()` has exactly two callers repo-wide —
  `components/workout/log-activity-sheet.tsx:42` (the picker) and
  `components/running/running-plan-content.tsx:204` — and **both set the type correctly before
  pushing**. The two that do not:
  - `components/coach/handoff-card.tsx:16` — `log_activity: { href: "/activity", … }`, a plain
    `<Link>` in the AI Coach's fixed destination map. Nothing sets a type.
  - `components/guided-walk/walk-summary.tsx:286` —
    `onClick={() => { onDone(); router.push('/activity') }}`, the only exit from the guided-walk
    summary. `onDone` is the *guided-walk* store's reset; **nothing in `components/guided-walk/`
    imports `useActivityStore`** (verified), so this lands on whatever the activity store last held.

  Plus a cold open on `/activity`, `lib/native/run-status-chip.ts:73`'s
  `window.location.assign('/activity')`, and any refresh of the URL.
- **Fix shape (implementer's call, not prescribed here).** Either guard the entry — render a type
  picker or redirect when `activityType == null` instead of a blank Pre screen — or make the two
  offending navigations set a type first, or both. Whatever else changes, `handleSave`'s bail-out
  must stop being silent: it is the last line of defence and it currently fails without a word.
- **NOT device-verified.** Reproduced in the web build, where `getLocalStore` returns null and the
  run took the web fallback. The `:167` guard sits above the local-store branch too, so on device the
  bail-out is if anything earlier — but that is reasoning, not an observation.

### [workouts][app-shell] Q-451 — a brand-new account's Workout tab is a giant empty card with a dead "Start Workout" button

- **Branch:** `fix/workout-select-no-program-empty-state`
- **Added:** 2026-08-17 · review sweep (failure-cells lens, **reproduced in a browser**) ·
  [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](reviews/2026-08-17-failure-cells-running-the-app.md)
- **Placement:** high. This is the app's **primary tab and primary action**, on the **first-run
  path**, and both the screen and the button are inert. Every other first-run screen tested was fine
  — this is the one that fails, and the worst one to fail.
- **Observed.** A second account with no program, no logs and no metrics, signed in and sent to
  `/workout-select` (the `Workout` bottom-nav destination; `/workout` and `/session-select` both
  resolve here). At 412×915 it renders a **~1,400 px tall empty peach card** with a lone 💪 in the
  top-left corner and a full-width green **Start Workout** button at the bottom. Full rendered text
  of the screen: `"Workout / Choose a session to start / 💪 / Start Workout / Cardio Hub / Run · Walk
  · Log anything"`.
- **The button is dead.** Tapped it: same URL, same DOM, no navigation, no toast, **no console error,
  no `/api/` request**. `app/workout-select/workout-select-content.tsx:412`:
  ```tsx
  onClick={() => currentSession && handleStart(currentSession)}
  ```
  With no program there is no `currentSession`, so the expression short-circuits to `undefined`. The
  button is **not `disabled`**, carries no empty state, and gives no hint that creating a program is
  the missing prerequisite.
- **The empty card is the session carousel painting a session that isn't there.** `:337` is
  `{currentSession?.icon ?? p.emoji}` where `p = getPaletteEntry(currentSession?.position ?? 0)` — so
  the 💪 is position-0's palette decoration standing in for absent content, and the card keeps its
  full height. That is position-indexed, so the *No Hardcoded Session Names* rule is **not** violated
  — but it is why the empty state reads as a rendering fault.
- **The comparison that makes it a bug rather than a gap:** `/program` handles the same account
  correctly — *"No programs yet. Create one to get started."* The screen a new user is actually
  dropped on has no such affordance.
- **Fix shape:** give the no-program case a real empty state that routes to `/program`, and disable
  (or repurpose) the button rather than leaving an inert primary CTA. Worth checking the same
  short-circuit pattern on sibling surfaces per the *Sibling-surface sweep* rule.
- **NOT device-verified** (web build, browser only).

### [app-shell][platform] Q-452 — the AI insight card runs an LLM over a prompt of literal "no data" strings, and tells a day-one user their inactivity is a "significant gap"

- **Branch:** `fix/ai-insight-sufficiency-gate`
- **Added:** 2026-08-17 · review sweep (failure-cells lens, **rendered output quoted**) ·
  [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](reviews/2026-08-17-failure-cells-running-the-app.md)
- **Placement:** mid-queue. Not data loss, but it is **wrong user-facing copy shown to exactly the
  users least able to discount it**, and it costs LLM calls that cannot carry signal.
- **No sufficiency gate anywhere between the mount and the model.**
  `components/health/ai-insight-card.tsx:44-48` fires `POST /api/ai/health-insight` on every mount,
  unconditionally. `app/api/ai/health-insight/route.ts` builds its prompt by substituting the literal
  string `"no data"` for every absent field (`:102, :105, :116-119, :125-126, :157-158`) and calls
  `generateText` regardless.
- **Rendered, as a zero-data account, on its first ever visit:**
  - `/health/sleep` — *"Your current sleep dashboard is empty, which prevents us from identifying any patterns in your recovery or rest quality…"*
  - `/health/readiness` — *"Your readiness data is currently unavailable, which prevents me from providing a specific assessment…"*
  - `/health/activity` — *"Your activity tracker currently shows **zero movement and no strength sessions** toward your goal of five per week. **This inactivity creates a significant gap** in your ph…"*
- **The third one is the actual bug.** Handed `Steps: no data`, the model does not report absence — it
  asserts **zero**, then editorialises about it. A user on day one is told they have a significant
  fitness gap. The model cannot distinguish "no data" from "measured zero" because **the prompt does
  not distinguish them either**.
- **Bounded but not free:** `rateLimit('ai-insight:${userId}', 10, 60*60*1000)` (`:64`) plus a 6 h
  client cache caps it at four calls per new user per day. Cost is the aggravation, not the finding —
  the six-round review already measured AI spend and recorded a decision not to optimise it. **This
  entry is about correctness of what is said.**
- **Fix shape:** gate the card on the section actually having data (return `{ insight: null }` and let
  the card's existing `if (!insight) return null` hide it), and/or make the prompt say *absent* rather
  than feeding a bare `"no data"` string the model reads as a measurement.

### [devices][heart-rate] Q-388 — the ring runs SpO₂ and daytime-HR recording permanently, nobody chose it, and it is ~3.5× stock drain

- **Branch:** `fix/ring-measurement-power-budget`
- **Added:** 2026-08-17 · owner: *"the battery life drains too fast. Stock it lasts 7 days; but with
  our build it loses about 20% over night I'm seeing. Well too much. It requires a long charge every
  2 days. Needs to be reviewed to see whats chewing so much of its battery."*
- **The arithmetic:** stock 7 days ≈ 14%/day. A charge every 2 days ≈ 50%/day, with 20% of that
  overnight alone. Roughly **3.5× stock drain**.

**What we turn on, and where.** `OuraRingService.onReady()` runs
`OuraProtocol.enableMeasurementSequence()` on **every connect**
(`android/app/src/main/java/com/trainingai/app/oura/OuraProtocol.kt:123-127`):

```kotlin
reqSetFeatureMode(FeatureId.DAYTIME_HR, FeatureMode.AUTOMATIC),
reqSetFeatureMode(FeatureId.SPO2,       FeatureMode.AUTOMATIC),
reqSetFeatureMode(FeatureId.REAL_STEPS, FeatureMode.AUTOMATIC),
```

Unconditional, idempotent, **no user toggle anywhere in the app**, and re-asserted on every
reconnect so the ring can never drift back. On stock Oura, blood-oxygen sensing is an opt-in the
vendor itself warns costs battery life. We enable it for everyone, permanently, and the only
in-repo note on its cost is the REAL_STEPS comment observing that steps are *"passive (no sensor
power cost, unlike the DHR burst)"* — so the DHR burst's cost was known and never budgeted.

**Measured against production** (`claude_ro.oura_raw_samples`, 7 days, owner's rows only — this view
is row-scoped to one user and prunes at 30 days, so these are the owner's counts, recently):

```
tag  event_name                rows(7d)
139  spo2_r_pi_event             53,412   <- largest single source
 96  ibi_and_amplitude_event     40,898
128  green_ibi_quality_event     14,098
115  ehr_trace_event              3,859
```

**SpO₂ is both the biggest source and concentrated exactly where the owner sees the loss** — events
by hour, Brisbane:

```
hour   00    03    05    08    11    14    16    20    23
spo2 5942  4946  7319  1465     0    11  2149    54  5216
green  45   125     0   587   706   750  1174  1126  1068
ehr     0     0     0     0   648   208   128   556     0
```

~75% of SpO₂ events fall between 22:00 and 09:00 — the overnight window the owner reports losing
20% in. Green-PPG (DAYTIME_HR) carries a steady daytime load on top.

- **A step change on 2026-08-04 that nothing explains — resolve this first.** Daily totals go
  5,378 → 23,874 and hold (SpO₂ 586 → ~8,000/day). **Open question, not a cause:** this counts
  *ingested* events, so better draining looks identical to more sensing. SPO2 has been in
  `enableMeasurementSequence` since 2026-07-07 (#320, v1.117.2), and
  `docs/overview/history-2026-08-04.md` shows no ring-side change that would account for it. It
  decides whether the fix is "sense less" or "we always sensed this much and only now noticed".
- **A separate latent defect, found while tracing — NOT today's cause.** `reqBleFastHrMode(false)`
  and `EXERCISE_HR → AUTOMATIC` appear **only** in `liveHrStopSequence()` (`OuraProtocol.kt:256-259`);
  the connect-time sequence resets DAYTIME_HR, SPO2 and REAL_STEPS but **neither of these**. Any
  live-HR session that never reaches `stopLiveHr()` — app killed mid-workout, Samsung battery
  management killing the service (failure L9 in
  [`docs/oura-ble-operations.md`](oura-ble-operations.md)), or the `/admin/oura-ble` tester's
  **Live HR** button without **Stop HR** — leaves continuous fast-HR sampling on **permanently**,
  healed by no reconnect, app restart or service restart. Production says it is not firing now
  (`ehr_trace_event` is zero 21:00–08:00), so it is a trap waiting, not the current drain. Fix
  regardless: add both resets to the connect-time sequence, the one path guaranteed to run.
- **Evidence that would settle it** (device-only, none reachable from the sandbox): (a) persist the
  ring's battery telemetry — the keepalive already polls it every 5 min and `parseBattery` decodes
  it, but **it is never stored**, so drain cannot be measured at all today; (b) A/B two nights, SPO2
  `OFF` vs unchanged, same wear pattern, compare overnight % — that prices the feature directly;
  (c) confirm whether the owner had blood-oxygen sensing enabled in the stock Oura app before the
  re-key. If it was off there and on here, that alone is most of the gap.
- **Fix directions (undecided — measurement first):** (1) make SpO₂ a user setting defaulting off,
  rather than an unconditional connect-time write; (2) reset EXERCISE_HR and fast-HR mode in
  `enableMeasurementSequence()` — cheap, independent of the measurement, do it regardless;
  (3) persist the battery poll so this is observable rather than argued; (4) *only then* the cadence
  knobs ([`docs/oura-ble-operations.md`](oura-ble-operations.md) §2: raise `DRAIN_INTERVAL_MS`, drop
  idle priority to `CONNECTION_PRIORITY_LOW_POWER`) — **these are radio-side, not sensor-side**, so
  they cannot touch a PPG/SpO₂ duty cycle and are the wrong lever if sensing is the cause. That
  doc's rule against touching the 5-min keepalive still stands: it is the drop detector.
- **What would count as fixed:** overnight drop back near stock (~14%/day), proven by (a) rather
  than a subjective "feels better", and nothing power-hungry enabled that the owner did not choose.
- **Surface: device required.** Every claim here is code-traced or from ingested-event counts;
  **no ring power draw has been measured, because nothing records it.** The sandbox cannot run BLE
  and Kotlin only compile-checks in Android CI, so a fix needs an APK and a wear cycle.

### [nutrition] Q-387 — a half-logged day is indistinguishable from a light day, and it drags the calibrated maintenance down with nothing to stop it

- **Branch:** `fix/tdee-partial-day-completeness`
- **Added:** 2026-08-17 · owner: *"How does the nutrition tracker make a baseline? It requires x
  amount of days for tuning. But what is the control in place if I just log breakfast/lunch and skip
  the rest? does it assume thats all I had for the day and tune around that? Need some control
  around this. either a "complete day" option so it goes into "tuning" OR x% below the expected to
  assume "not completed"."* No screenshot — this is a question about the model, and the answer is
  that the owner's suspicion is correct.
- **Answer to the question as asked: yes, it assumes that is all you ate, and it tunes around it.**
  There is no completeness concept anywhere in the path.

**Confirmed root cause.** `packages/shared/src/nutrition/adaptive-tdee.ts:96` decides what a
"logged day" is with a bare non-zero test:

```ts
const logged = sorted.filter(d => d.intakeKcal != null && d.intakeKcal > 0)
```

A day carrying one 200 kcal apple is a logged day at 200 kcal. It counts toward `MIN_LOGGED_DAYS`
*and* enters `meanIntakeKcal`, the entire left-hand term of the estimate
(`maintenance = meanIntake − Δweight × KCAL_PER_KG / days`). The window is built at
`lib/health/energy-balance-service.ts:151-158` straight from `intakeByDate` with no filter.

**Two partial-day protections exist, and neither covers this** — which is what makes it easy to
miss. (1) A day with *nothing* logged is `intakeKcal: null`: excluded from the mean, still counted
in the window. Correct and deliberate. (2) **Today** is excluded from the window entirely, and the
comment at `energy-balance-service.ts:146-150` spells out this very bug while solving only the
in-progress half of it: *"a day in progress has only part of its food logged, so including it drags
the mean intake down… Same partial-day trap as the Oura `wornHours` mistake."* A **past** day
abandoned halfway is byte-for-byte identical to a completed light day. The author saw the trap,
fixed the version that self-corrects by evening, and left the version that never does.

**Measured with the real module** (`estimateMaintenance`, 14-day window; true maintenance 2600,
eating 2600, weight perfectly stable, all 14 days carrying a log; "partial" = breakfast+lunch at
1400, dinner never logged):

```
partialDays  daysLogged  meanIntake  maintenance  confidence  excludedReason
0            14          2600        2600         medium      null
6            14          2086        2086         medium      null
14           14          1400        1400         medium      null
```

Linear at **86 kcal per partial day**, and every row passes every gate — `excludedReason: null`,
`confidence: medium`. At a realistic 6-of-14 the number is 514 low and looks exactly as trustworthy
as a correct one. `MIN_PLAUSIBLE_MAINTENANCE = 1000` never fires; even 14-of-14 lands at a
"plausible" 1400.

**It reaches the prescription, not just a card.** `energy-balance-service.ts:180` feeds it to
`targetFromMaintenance(maintenanceKcal, goalDeltaKcal)`, so the **recommended daily calorie target
inherits the full error**, with a cut's negative `goalDeltaKcal` on top — the app telling an
under-logger to eat hundreds of kcal below real maintenance, which is the direction of harm the
module's own header calls "actively harmful advice". `restingBaseKcal` (`:172-174`) derives from it
too, so the Balance card's "burned" figure is dragged down in step.

- **Not a duplicate**, checked against both surfaces. **Q-302** is the same module, opposite concern
  (the gate invisible when it *blocks*; this is it passing when it should not). **Q-303** is AI
  coaching on sparse days, not the calibration input. `projectOverview.md`'s 2026-08-11 entry
  presents protections (1) and (2) as the complete story — the claim this corrects.
- **Latent, and about to stop being.** Per Q-302, 0 of the last 30 rolling windows clear
  `MIN_LOGGED_DAYS`, so nothing wrong is shown today. It arms the moment the owner does the thing
  this question is about: logs consistently enough to switch tuning on.
- **Evidence that would confirm it end-to-end** (not gathered): seed 14 local days with ~6 carrying
  only breakfast+lunch, call the route wrapping `computeEnergyBalance`, and compare
  `maintenance.kcal` / `target.recommendedKcal` against the same window fully logged. Expect ≈500
  kcal of delta, `confidence: 'medium'` and no `gapMessage` on either run.

**On the owner's two proposed controls — one is sound, one has a trap, and there is a third:**

1. **Explicit "complete day" marker** — sound, and the only option that can be *right* rather than
   probably-right. Cost is adoption: an unmarked day becomes a gap, and the gate already fails at
   1–4 logged days per 14, so a marker makes `MIN_LOGGED_DAYS = 10` strictly harder to reach.
   **Design it with Q-302** — the "you have 4 of 10 days" copy Q-302 asks for is the natural place
   to say "3 of those aren't marked complete". `day_checkins` already has an `evening` phase
   (`lib/data/postgres/schema.ts:447-451`), so this need not be a new surface.
2. **"x% below expected ⇒ not completed"** — **do not ship as specified.** It is circular:
   "expected" is the calorie target, derived *from* maintenance, which is the number being
   estimated, so a low estimate lowers the threshold and admits more partial days next window.
   Worse, a genuinely low day (fasting, illness, a hard deficit) is exactly the observation the
   calibration needs, and discarding it biases maintenance **high** — trading one wrong direction
   for the other. Any threshold must key off something outside the loop, e.g. the formula baseline.
3. **Infer completeness from logging shape, no new user action** — `food_logs` carries `mealTypeId`
   and `loggedAt` (`schema.ts:554-563`), so "did this day span the usual meal types, and did logging
   continue past the usual last-meal hour" is answerable from stored data, needs no marker, and is
   not circular. Weaker than an explicit marker, better than a kcal threshold. Worth costing before
   choosing 1, since it can *seed* the marker's default so the user confirms rather than authors.

- **What would count as fixed:** a day the user did not finish logging can no longer enter
  `meanIntakeKcal` as though complete — by marker, inference, or both — and the table above
  collapses so partial days push `maintenanceKcal` toward `null` (an honest "not enough data")
  rather than toward a confident wrong number. Whichever mechanism is chosen,
  `adaptive-tdee.test.ts` gains the partial-day case it currently has **zero** coverage of: the
  module is well-tested for empty days and has never been tested for half-full ones.
- **Surface:** no device or production data required — shared-module logic plus a service wrapper,
  reproducible in `pnpm dev` against the seeded DB and unit-testable directly. Only a "complete day"
  control, if option 1 is chosen, would need a device check.

### [platform] Q-313 — the publish dry-run has no `next build` gate, and that is what let A4b's real blocker through

- **Branch:** `fix/publish-dry-run-build-gate`
- **Found:** 2026-08-16, while doing A4b.

`scripts/publish-dry-run.js` runs six gates — typecheck, tests, private-paths, dormancy,
inlined-constants, doc-links — and **not `next build`**. That gap is not theoretical: A3 was recorded
as having made the model constants a runtime-only dependency, and the dry-run's green `--all` was the
evidence. It was wrong. Six modules still read a constant at **module scope**, and `next build`
imports every route to collect page data, so the build opened the files. Deleting them produced
`ENOENT ... energy-expenditure-features.json` at `Failed to collect page data for /api/achievements`
— which would have been a failed Railway deploy, not a local annoyance.

A4b fixed the six modules (they read on first use now). This entry is about the *gate*: nothing stops
the next module-scope read from re-introducing the same class, and the script that exists to answer
"does the published tree still work" cannot currently see a build failure at all.

**Do:** add `['build', 'npx', ['next', 'build']]` to `GATES`. Cost is the reason it was left out —
a build is minutes, not seconds — so consider making it opt-in behind a flag that `--all` sets, since
`--all` is the mode that models the end state and is run rarely. The script's existing
baseline-re-run logic already tells a pre-existing red from a regression, so a slow gate stays
trustworthy.

**Cheaper partial:** a Custom Rules check that fails on a module-scope call to any
`lib/oura-models/constants` getter. That catches the specific class in seconds without a build, and
is worth having either way.

### [platform] Q-312 — the synthetic MET table is physiologically impossible, and it costs ~9 tests in CI

- **Branch:** `fix/test-constants-met-floor`
- **Found:** 2026-08-16, while guarding the constant-dependent tests for A4b.

`scripts/generate-test-constants.js` replaces every number with a ramp in [0.1, 1.0] for fractions and
[1, 8] for integers. Applied to `energy-expenditure-features.json` that yields METs **below 1.0** —
impossible, since 1 MET *is* resting metabolism — and `estWorkoutKcal`'s net-MET guard therefore
returns null for every activity.

The consequence is not that a few parity assertions differ; it is that assertions with nothing to do
with vendor magnitudes cannot run at all. Nine tests are guarded off in CI purely because both sides
of the comparison are null: the "agrees with the aggregate that recomputes the same activity"
consistency check in `activity-log-calories.test.ts` (a Q-230 sibling-drift guard), the run-burns-
more-than-walk ordering, the steps-baseline subtraction, and the three-source summation in
`daily-energy.test.ts`.

**Do:** give the generator a floor for MET-shaped keys — `met_easy`/`met_moderate`/`met_hard` scrub to
a ramp starting at 1.0, ordered easy < moderate < hard. That is public physiology, not the vendor's
tuning, so it discloses nothing. Then remove the `itVendor` guards that were only there because the
value was unusable rather than because the assertion is a parity check.

**Constraint that decides when:** fixtures can only be regenerated on a machine that still has the
vendor's files (`generate-test-constants.js` exits early otherwise). Since A4b that is the owner's
machine or a restored archive — a session cannot do it. Needs the owner to run one command, or a
session working from a temporarily restored copy.

> **Q-258 FIXED and removed, 2026-08-16 (v1.317.3).** Four goal inputs in `goal-targets-section.tsx`
> (steps, sleep, water, calories) and two in `required-info-section.tsx` (weight, body fat) had
> `<Label>`s associated with nothing. **The convention already existed in the same file** —
> `goals-height` and `goals-birthYear` were correctly paired — so this was a consistency fix, not an
> invention; the six now follow the same `goals-<field>` id scheme.
> **Proven the way the entry asked:** `e2e/goal-round-trip.spec.ts` swapped its positional
> `xpath=following::input[1]` selector for `page.getByLabel('Daily Water Goal')`, which passes with
> the association, **fails with `goal-targets-section.tsx` reverted to `main`**, and passes restored.
> The brittle selector was the symptom, so deleting it is the proof.
> Journal: [`entries/2026-08-16-goal-label-association.md`](overview/entries/2026-08-16-goal-label-association.md).

> **Q-259 CLOSED as not achievable, 2026-08-16 — and the measurement is the point.** The entry asked
> for a guard that fails when Q-240's `invalidateGoalRecommendations()` is deleted. **No such guard
> can exist for this path**, established by building it and measuring rather than by argument:
> - Its premise about the seed was wrong. `seed.sql` **does** insert `body_metrics` for
>   `current_date - d`, d in 0..13, so today already carries steps 8000 and calories 2400 and the
>   `goalsProgress` rows render. No seed work was needed.
> - The steps goal **is** the right probe — `STEPS_GOAL_KEY` is read by *Home*, never by Health, so
>   `useGoalSeeds` gives it no device copy to mask staleness, unlike water/target-weight/target-BF.
> - **And it still passes with the invalidation deleted.** `cachedFetchCore` paints the cached value
>   and then *always* revalidates over the network unless `freshWithinTtl` is set; `user-goals` does
>   not set it. So the settled value is correct either way.
> - **Nor does the invalidation remove the stale flash.** Sampling the DOM every 100 ms across the
>   return trip gave the identical sequence both ways — `8,000 / 7,000 ✓` then `8,000 / 9,000`. The
>   first paint on tab re-entry comes from Health's retained React state, not from the cache, so
>   clearing the cache cannot change it.
> **Consequence worth carrying: on this screen `invalidateGoalRecommendations()` has no observable
> effect on the goal at all**, in the settled state or the transient one. Q-240's entry described the
> impact as "renders the old one for 30 minutes", which does not match how `cachedFetch` behaves —
> that framing assumed the cache short-circuits the fetch. The genuinely persistent staleness the
> owner could have hit was **Q-260**, a different mechanism, now fixed.
> The spec built for this survives as `e2e/goal-invalidation.spec.ts`, relabelled: it covers the
> Q-260 shape on the Progress panel (a goal with no device copy, reached client-side), proven by two
> mutations, and its header records why it is not a Q-240 guard.
> Journal: [`entries/2026-08-16-goal-invalidation-not-guardable.md`](overview/entries/2026-08-16-goal-invalidation-not-guardable.md).

> **Q-262 ANSWERED and removed, 2026-08-16 — the answer is "no", for all six keys.**
> [`docs/reviews/2026-08-16-goal-invalidation-audit.md`](reviews/2026-08-16-goal-invalidation-audit.md)
> has the per-key table. None of `energy-balance:<date>`, `nutrition-targets`, `body-metadata`,
> `progress-summary`, `user-goals` or `more-user-profile` is fetched with `freshWithinTtl`, and none
> has a seed-only read path — every screen that seeds one also fetches it, and five are in the
> sync-provider warm list as well. **Every `freshWithinTtl` call site in the app was enumerated**;
> the one in `health-content.tsx` is `activity-types`, not a goal key.
> **No code change, deliberately.** `cache-groups.ts` is untouched: the group is cheap insurance the
> moment anyone adds `freshWithinTtl` to one of these keys, and the convention that every write goes
> through a named group is worth more than removing six inert lines.
> **What did change is CLAUDE.md**, which stated the bug class without stating the mechanism. It now
> names the two conditions that make an invalidation load-bearing — `freshWithinTtl`, or a read path
> that never revalidates — while explicitly not licensing skipped invalidation. The practical
> consequence for triage: a stale-value report is more often condition (b), a read path with no
> fetch, than a missed group entry. That is what Q-260 turned out to be.
> **Scope limit, stated because it would be easy to over-read:** only this one group was audited.
> The others may well contain load-bearing keys — `cache-groups.ts`'s own comments flag
> `freshWithinTtl` entries inside them — and Q-263 files that.
> Journal: [`entries/2026-08-16-invalidation-audit.md`](overview/entries/2026-08-16-invalidation-audit.md).

### [platform] Q-530 — an admin snapshot endpoint, so a migration's first real run is not production

- **Branch:** `feat/admin-db-snapshot`
- **Plan:** [`plans/2026-08-17-admin-db-snapshot-endpoint.md`](superpowers/plans/2026-08-17-admin-db-snapshot-endpoint.md)
- **Lane: A**, and not splittable — `app/api/**`, `lib/data/postgres/migrations/`, and a Postgres
  migration number, which belongs to Lane A alone. No Lane B surface is touched at all.
  ⚠️ **Two of the paths are unlisted in the lane contract and must be claimed in Lane A's baton
  before starting**: `scripts/` (the generator and the restore command) and `lib/export/` — neither
  appears in §3 of [`docs/agents/README.md`](agents/README.md), and `lib/export/` is shared with
  Q-288 below, so the two items must not run concurrently in different sessions.
- **Added:** 2026-08-17 · planning session against the rescoped Q-251
- **Steps, in order — the plan carries the detail, this is the slot list:**
  1. `scripts/generate-claude-ro-views.js` — emit `_meta_excluded_tables` and
     `_meta_withheld_columns`; regenerate into **migration 189** (a new number, never overwriting an
     applied file) and re-point the filename pin in `claude-ro-readonly-role.test.ts` *in the same
     commit*.
  2. `lib/export/db-snapshot.ts` — view enumeration, the drift gate, PK discovery from `pg_index`,
     keyset chunking, the manifest. All the tests live here.
  3. `app/api/admin/db-snapshot/route.ts` — copy `day-review`'s `authorize()` verbatim; `bulk` and
     `tables` params; NDJSON via `ReadableStream`; audit row into `db_query_log`.
  4. `scripts/local-db/snapshot.js` + `pnpm db:snapshot` — local-target guard **first**, then
     restore per plan §5.
  5. Docs — `CLAUDE.md` env-var row, `docs/module-map.md` row, and a
     `docs/runbooks/db-backup-restore.md` section distinguishing this from `pg_dump`.
- **⛔ Step 3 is blocked on the owner** until `ADMIN_SNAPSHOT_SECRET` is agreed and set in Railway —
  secret handling is confirm-first. Steps 1, 2 and 4 do not depend on it and can land first.
- **Placement:** below the four live user-facing bugs above it and below the two CI-integrity items,
  above everything else — it is a capability every later item borrows (rehearse a migration against
  prod-shaped rows, run `pnpm dev` against real data), and it is the first thing that touches
  `CLAUDE.md`'s standing root cause *"a bug that reproduces in prod but not locally: suspect prod
  data drift vs the fresh local seed"*.
- **This is Q-251 shape (a), designed.** Q-251 stays open for shape (b), the second Railway service,
  which remains deferred. Read Q-251 first for the decision history; read the plan for what to build.
- **It is much smaller than Q-251 implies, and the reason is the finding to carry into the work:**
  `claude_ro` already *is* the export — 80 views, one user, default-deny, 9 columns withheld, served
  by a role with no write grants. The endpoint paginates `SELECT *` over that schema. **No new
  scoping map is written**, so there is no second copy to drift, which is the property this could not
  survive losing.
- **What happens when a table is added and the views are not regenerated: the export fails, naming
  it.** The gate is a runtime set difference — `public` base tables minus `claude_ro` views minus a
  generator-emitted exclusion view — computed from `pg_catalog`, which the `claude_readonly` role can
  read for `public` despite holding no `SELECT` there (verified against production: 83 tables, 944
  columns). Column-level, not just table-level. The existing CI parity test stays but does not cover
  this: it is a count rather than a set of names, it is column-blind, its migration pin **went stale
  silently between 181 and 185**, and it checks the *local* schema.
- **Volume, measured 2026-08-17.** The DB is 477 MB and `oura_raw_samples` is 360 MB of it —
  **1,098,005 of its 1,098,183 rows are the owner's**, so scoping to one user removes 0.02% of the
  volume. Scoping is a consent fix, never a size fix. The shaped data that rehearsal actually needs
  is a few MB, so the default export omits the four bulk tables and `?bulk=<days>` opts a window
  back in.
- **Ships with a first-class round-trip** (`pnpm db:snapshot`), guarded to refuse any target that is
  not the local DB. Two verified constraints: `push_subscriptions` **cannot** round-trip (all three
  withheld columns are `NOT NULL`) and is skipped and declared in the manifest; `users.password_hash`
  is withheld and nullable, so the restore stamps the seed's known bcrypt hash or nobody can log in.
- **⚠️ New secret — `ADMIN_SNAPSHOT_SECRET`, not a reuse of `ADMIN_EXPORT_SECRET`.** Secret handling
  is confirm-first per `CLAUDE.md`; the owner has approved the endpoint's existence, but confirm the
  variable before it is added to Railway. Leak analysis is in the plan §6: total health-data
  disclosure for one person, **no** account takeover, no write path, no third-party rows — and the
  marginal risk over today is small, because `CLAUDE_DB_QUERY_SECRET` already reads exactly this data
  through the same views and the same role.

### [platform] Q-263 — audit the remaining cache groups the way Q-262 audited one

- **Branch:** `chore/audit-remaining-cache-groups`
- **Plan:** none needed
- **Added:** 2026-08-16 · the scope Q-262 deliberately did not take
- Q-262 established the method and applied it to `invalidateGoalRecommendations()` only: for each key
  in a group, does any call site pass `freshWithinTtl`, and is any read path seed-only? Those are the
  only two ways an invalidation changes a settled value.
- **The remaining groups are NOT expected to come out the same way**, which is why this is worth
  doing rather than assuming. `lib/cache-groups.ts` comments already name `freshWithinTtl` keys
  inside them — `workout-data:all` and `workout-card:<id>` at TTL_LONG are called out explicitly as
  having caused a real bug (the pre-injury exercise card). Those are load-bearing; the question is
  which others are.
- **The valuable output is not "delete the inert ones".** It is a per-group note saying which keys
  carry the protection, so a future session changing a fetch to `freshWithinTtl` knows it has just
  made an invalidation matter, and a future stale-value report starts by checking condition (b)
  rather than hunting a missing group entry.
- Watch the static blind spot: a key built by a helper (`energyKeyFor(date)`) is invisible to a
  literal grep. Q-262 hit this and resolved it by reading the call site; `check-cache-ttl-divergence.js`
  reports how many such sites it skipped, which is the number to reconcile against.


### [workouts] Q-298 — RESOLVED: a phase-level deload zeroed the 1RM and never stamped `exercise_deloaded`

- **Branch:** `fix/zero-estimated-1rm`
- **Plan:** none needed for the guard; the backfill wants a decision first
- **Added:** 2026-08-15 · from [`docs/reviews/2026-08-15-pillar-model-soundness-review.md`](reviews/2026-08-15-pillar-model-soundness-review.md) §1.1
- **✅ RESOLVED 2026-08-16 — the cause is found, and the work is now small and specific.** All five
  2026-08-09 rows belong to **one `Pull` session**, and `session_periodization` shows **Pull entered
  the `deload` phase on exactly 2026-08-09**. So `estimateOneRm` was called with `deloaded: true`
  from the phase and correctly returned 0 — the same deliberate branch that explains the 08-06
  `Upper` session. **The zeros were never the bug.**
  **The defect is the provenance mismatch: the phase-level deload zeroed the estimate and did not
  stamp `exercise_deloaded` on the row.** That is exactly why Q-228's fix misses them —
  `getLastRealOneRmBatch` filters on `exercise_deloaded`, which is `false` here, so these zeros **do**
  leak into prescription. The original entry claimed that outcome with the wrong reason; the outcome
  stands and now has a cause. Working in
  [`docs/reviews/2026-08-16-multi-user-load-test.md`](reviews/2026-08-16-multi-user-load-test.md) §1.
- **✅ PINNED TO SOURCE 2026-08-16 — the fix is one line.** `packages/shared/src/workout/log-exercise.ts`:
  ```ts
  188:  const isAnyDeload = currentPhaseType === 'deload' || sessionIsEarlyDeload;
  196:    deloaded: exerciseDeloaded === true || (isAnyDeload && !isBaseline)   // zeroes the 1RM
  264:    exerciseDeloaded: exerciseDeloaded ?? false                          // stores ONLY the AI flag
  ```
  Line 196 zeroes the estimate when **either** the AI flag **or the phase** says deload; line 264
  records only the AI flag. **Line 264 should store the same predicate line 196 uses.** The file's own
  comment at 190–191 says both cases must not feed the estimate — they don't; only one is recorded.
  Working in [`docs/reviews/2026-08-16-deferred-measurements.md`](reviews/2026-08-16-deferred-measurements.md) §4.
- **The work, now that it is understood — two small changes:**
  1. **Stamp `exercise_deloaded` from the phase** wherever `estimateOneRm` is called with
     `deloaded: true`, so the row records what actually happened and Q-228's filter works.
  2. **Store `null`, not `0`**, for a deliberately-unestimated 1RM. A null propagates as "no
     estimate"; a zero propagates as an estimate *of* zero, which is what read as −100% on a trend.
  Both are cheap. The historical-row decision (recompute vs null the 10 existing rows) still edits
  training history and still needs the owner's say-so.
- **⚠️ AMENDED 2026-08-15, same day, before any work started — this entry was HALF WRONG as first
  filed.** It claimed all ten rows were a defect. Reading the write path settles it: the write path
  (`log-exercise.ts:194`) calls `estimateOneRm`, and `packages/shared/src/1rm.ts:158` is
  `if (deloaded) return { estimated1rm: 0, target80: 0, targetPct }`. **The five 2026-08-06 rows all
  carry `exercise_deloaded = true` and are zero ON PURPOSE** — deload work is submaximal and must not
  feed a 1RM. That is correct behaviour. Full working in
  [`docs/reviews/2026-08-15-workout-model-round-3.md`](reviews/2026-08-15-workout-model-round-3.md) §1.
  **Two things survive**, and they are what this entry is now about:
  1. **`0` is the wrong sentinel — use `null`.** A null propagates as "no estimate"; a zero
     propagates as an estimate *of zero*. That is what produced the visible damage: a first-vs-last
     trend query reads those exercises as **−100%**. This applies to the deliberate deload case too.
  2. **The five 2026-08-09 rows are still unexplained**, since they carry `exercise_deloaded = false`.
- **Narrowed to at least two mechanisms, and three rows still unaccounted for.** Their `set_logs`:
  ```
  Barbell Shrug           4 × 87.5 kg × 6    use_for_1rm=TRUE   → should compute ~103 kg, stored 0
  Sumo Deadlift           4 × 82.5 kg × 6-7  use_for_1rm=TRUE   → should compute, stored 0
  Bent-Over Barbell Row   4 × 30 kg × 6      use_for_1rm=TRUE   → should compute, stored 0
  Dumbbell Preacher Curl  3 × 16.25 kg × 12  use_for_1rm=FALSE  → no qualifying set
  Pull-Up                 3 × 0 kg × 5       use_for_1rm=FALSE  → bodyweight, weight_kg = 0
  ```
  - **Pull-Up**: `estimateOneRm` substitutes `max(1, bwRef + weightKg)` **only when
    `exerciseType === 'bodyweight'`**. If that did not resolve, `weights` is 0, the `!(w && r)` filter
    drops every set, `oneRMs` is empty and `calculate1RM` returns 0.
  - **Preacher Curl**: `use_for_1rm = false` on all three sets. When the style has *some* `useFor1rm`,
    `calculate1RM` filters to those indices; none qualify, so `oneRMs` is empty → 0.
  - **Shrug / Sumo Deadlift / Bent-Over Row have real weights, real reps and `use_for_1rm = true`.
    Start here — these three are the actual mystery.**
- **The zero was written at compute time, not overwritten later.** Every one of those sets has
  `intensity_pct = NULL`, and the write path derives it as `computeIntensityPct(weight, estimated1rm)`,
  which is null exactly when the estimate is 0.
- **`runningEstimate1RM` already solves the empty-`oneRMs` case** ("fall back to averaging all logged
  sets so a number always shows from set 1") — **and `calculate1RM` does not, while the write path uses
  `calculate1RM`.** So the live widget shows a sensible number and the saved row gets 0. That asymmetry
  is the most likely single fix.
- **Measured:** **10 of 355 `exercise_logs` (2.8%) have `estimated_1rm = 0`** — the value zero, not
  null — alongside entirely real volume and reps:
  ```
  2026-08-09 21:36  Sumo Deadlift           e1rm=0  vol=2062.5  avg_reps=6.3  deload=false
  2026-08-09 21:46  Bent-Over Barbell Row   e1rm=0  vol=720     avg_reps=6    deload=false
  2026-08-09 21:56  Barbell Shrug           e1rm=0  vol=2100    avg_reps=6    deload=false
  2026-08-09 22:04  Pull-Up                 e1rm=0  vol=1064.3  avg_reps=5    deload=false
  2026-08-09 22:13  Dumbbell Preacher Curl  e1rm=0  vol=585     avg_reps=12   deload=false
  2026-08-06 ×5     (all deload=true)
  ```
- **Two clusters; only one is explained.** The 08-06 five are `exercise_deloaded = true` — the
  Q-115/Q-228 deload-corruption date. **The 08-09 five are `exercise_deloaded = false`, consecutive
  over 37 minutes — one entire workout session** where every exercise stored a zero 1RM.
- **Q-228's fix does not cover them.** That fix added an `exercise_deloaded` filter to
  `getLastRealOneRmBatch`; the 08-09 rows have that flag false and pass straight through into
  prescription.
- **Zero is a value, not an absence.** Null means "could not compute"; zero is a number that flows
  into trend charts, PR detection and the next prescription. First-vs-last e1RM reads those two
  lifts as **−100%**.
- **Likely common cause, worth checking first:** **2026-08-09 logged 1,000 `error_events`**, mostly
  connection timeouts, and the same date carries a 0.00 h sleep row at 04:52 (Q-274). Three
  anomalies in three domains on one heavy-fault day points at the connection-starvation class
  (Q-213/Q-107). If `estimated_1rm` is computed from a query that returned nothing under contention,
  the fix is at the computation, not the filter.
- **Do three things, in this order:**
  1. **Find the writer** and establish how a zero is produced from real sets. `logExerciseFromPayload`
     (`packages/shared/src/workout/log-exercise.ts`) is the shared write path.
  2. **Guard at the write**: refuse to persist `estimated_1rm = 0` when sets exist — store null.
     A null is honest and every downstream reader already handles it.
  3. **Then decide on the 10 existing rows.** Recompute from their `set_logs` if the sets survive;
     null them if not. **Ask before writing** — this edits historical training data.
- **Add the sibling check:** `volume = 0` is currently 0 of 355, but the same "computed and stored as
  zero" hazard applies to it and to `avg_reps`.

### [platform][devices] Q-308 — SERIALISE the sync fan-out (RTT measured, recommendation settled)

- **Branch:** `perf/sync-fanout-connection-demand`
- **Plan:** none yet — **the first task is a measurement that may change the answer**
- **Added:** 2026-08-16 · from [`docs/reviews/2026-08-16-multi-user-load-test.md`](reviews/2026-08-16-multi-user-load-test.md) §6
- **Harness exists and is committed:** `scripts/load-test/seed-users.js` +
  `scripts/load-test/sync-fanout.js`. Both refuse to run against a non-local database.
- **Measured at production's `poolMax = 10`, 21 queries per sync:**

  | concurrent syncs | p95 | worst pool wait | failures |
  |---|---|---|---|
  | 10 | 210 ms | 206 ms | 0 |
  | 50 | 778 ms | 794 ms | 0 |
  | 100 | 1,562 ms | 1,596 ms | 0 |
  | 200 | 2,868 ms | 2,973 ms | 0 |

  **Nothing breaks at 10 users or at 100.** Linear degradation, zero failures; extrapolating to
  `connectionTimeoutMillis: 5_000`, first failures near **300 concurrent syncs**, as timeouts.
- **Two results that change the diagnosis, and both matter more than the limit:**
  1. **A bigger pool does not help — it is slightly worse.** At 50 concurrent: poolMax 10 → 778 ms
     p95; 20 → 803 ms; 40 → 952 ms. **Q-107 and Q-213 both attribute production sync failures to
     "DB-pool contention"; on this evidence the pool is not the binding constraint**, and raising
     `max` would spend Railway connection budget for nothing.
  2. **The entire fan-out is 22.6 ms of query work** (serial, warm, one user — `set_logs` 5.4 ms is
     the most expensive of 21). So the parallelism demands 21 connections to save ~8 ms.
- **Serialising gives identical p95 for a 21× cut in connection demand:**

  | concurrent | parallel p95 | serial p95 | parallel conns | serial conns |
  |---|---|---|---|---|
  | 10 | 174 ms | 180 ms | 210 | **10** |
  | 100 | 1,450 ms | 1,519 ms | 2,100 | **100** |

  Serial is also far more predictable (min 152 ms vs 26 ms).
- **✅ RTT MEASURED 2026-08-16 BY THE OWNER — p50 0.86 ms · p95 1.22 ms · min 0.62 ms** (from the
  Railway app service). **The blocker below is cleared and the answer is: serialise.** With a 1 ms
  per-query hop simulated against the production pool of 10:

  | concurrent | PARALLEL (today) | **SERIAL** | CHUNKED ×4 |
  |---|---|---|---|
  | 10 | 155 / 161 ms · 210 conn | **95 / 137 ms · 10 conn** | 138 / 145 ms · 40 conn |
  | 50 | 588 / 625 ms · 1,050 conn | **356 / 607 ms · 50 conn** | 700 / 744 ms · 200 conn |
  | 100 | 1,153 / 1,218 ms · 2,100 conn | **588 / 1,026 ms · 100 conn** | 1,010 / 1,083 ms · 400 conn |

  **Serial is faster at p50 AND p95 at every concurrency, with 21× fewer connections.** No trade-off
  to weigh. Chunking beats neither and is not worth the complexity. Full working in [`docs/reviews/2026-08-16-sync-fanout-rtt-verdict.md`](reviews/2026-08-16-sync-fanout-rtt-verdict.md).
- **Why the earlier "identical p95" reading was wrong:** it was measured at **0 ms RTT**, where the
  two shapes converge because pool queueing dominates. A realistic hop separates them **in serial's
  favour** — the opposite of the risk this entry was written to guard against. Mechanism: a parallel
  fan-out demands 21 connections from a pool of 10, so each sync's own queries queue against each
  other and pay RTT again on every acquisition; serial takes one connection and runs to completion.
- **The work:** replace the single `Promise.all` in `lib/data/postgres/adapter.ts:3362` with a
  sequential loop on one checked-out client. **Keep the pagination contract**
  (`packages/shared/src/sync/cursor.ts`, PR #97) untouched — this changes how reads are issued, not
  what they return. Expect **no user-visible change at current scale** (real concurrency ≈ 0–1,
  about +18 ms on a single sync) and strictly better behaviour under any concurrency.
- **Verify after:** `RTT_MS=1 CHUNKS=1 node scripts/load-test/sync-fanout.js 50 10` — connection
  demand should drop to 1× concurrency with p95 no worse than the table above.
- **Re-frames Q-107/Q-213 without striking them.** Both blame "DB-pool contention". The pool is not
  the constraint — **the fan-out shape is what creates the contention they observed.** A bigger pool
  treats the symptom. Read this before assuming pool size is the lever.
- **⚠️ DO NOT SERIALISE ON THIS EVIDENCE. Measure Railway RTT first.** The harness runs against a
  local Postgres over a Unix socket where per-query round-trip is ~0. On Railway the app and DB are
  separated by a real network, so serial adds **21 × RTT** per sync: +42 ms at 2 ms RTT, +210 ms at
  10 ms. **First task: measure per-query RTT from the Railway app to the Railway database.** If RTT
  is low, serialising is a large win for free; if it is high, the answer is chunking (e.g. 4 batches
  of 5) rather than either extreme.
- **Then re-check Q-107/Q-213's framing** in `projectOverview.md` — not to strike them (the
  production faults were real) but so the next session does not inherit "pool contention" as settled
  cause when the pool was measured not to be the limiter.

### [workouts] Q-306 — the emergency-deload RPE trigger sits 0.07 inside a known measurement error

- **Branch:** `fix/deload-trigger-thresholds`
- **Plan:** none yet
- **Added:** 2026-08-16 · from the load-test review §2
- **Deload has fired once in 3.5 months** — `exercise_deloaded` true on exactly one day
  (2026-08-06, 5 exercises), plus one session type currently in the `deload` phase. So this is not
  an over-firing problem today; it is a threshold that cannot be trusted once Q-289 is fixed.
- **The trigger set** (`emergency-deload.ts`, six conditions OR'd) includes
  `rpeTrend.delta > 2.0`. **Q-289 measured a systematic +1.93 RPE delta at expected-5 sets** — a
  session of light prescriptions is **0.07 from firing an emergency deload on model miscalibration
  alone**, before the lifter has done anything.
- **⚠️ HEADLINE WEAKENED 2026-08-16 — measure before treating this as urgent.** The +1.93 figure
  above is pooled across all history. On **post-cutover data only** (from 2026-07-18, n=278) the
  expected-5 delta is **+1.09**, not close to the 2.0 trigger. **The trigger is not sitting inside the
  error band on current data.** Working in [`docs/reviews/2026-08-16-deferred-measurements.md`](reviews/2026-08-16-deferred-measurements.md) §3.
  **What survives:** the second issue below (ACWR at three uncoordinated thresholds) is untouched by
  this and is now the entry's main content. Also note `rpeTrend.delta` averages over recent sets, so
  a *cluster* of light sets would still be needed to trip it — and deload has fired **once in
  3.5 months**, which is consistent with it not firing spuriously.
- **Sequencing matters here.** Fixing Q-289's calibration will move the delta distribution, so this
  threshold must be re-derived *after* that, not tuned now. **This entry is blocked on Q-289** and
  should be worked immediately after it.
- **Second issue, independent: ACWR now drives three behaviours at three thresholds** —
  `acwr > 1.5` here, `EARLY_DELOAD_ACWR_MIN = 1.2` (readiness early-deload card), and
  `ACWR_TAPER_START = 1.5` (Activity Score taper). Q-279 already questions the evidence base for
  ACWR at all; three uncoordinated thresholds on one contested metric should be consolidated into a
  single named band set whatever else is decided.
- **One thing that is RIGHT and should not be "fixed":** `repCompletionRate < 0.7` is null-guarded
  (`!== null`), so with the field null on ~83% of sets it mostly cannot fire. That fails **safe**,
  and it is the correct treatment — unlike the autoregulation path in **Q-299**, which reads the
  same null optimistically. Use this as the reference when fixing Q-299.
- **Not a finding, recorded so it is not re-raised:** planned deloads exist. The program's phase
  sequence has a `deload` phase at position 4 (Accumulation 4 → Intensification 3 → Peak 2 →
  Testing 1), so ~10 cycles between deloads. Long-ish, but a program-design choice.

### [cardio][activity] Q-307 — pace is null on 32 of the 39 activity logs that carry everything needed to compute it

- **Branch:** `fix/derive-activity-pace`
- **Plan:** none needed — likely the same fix as Q-230
- **Added:** 2026-08-16 · from the load-test review §5
- **Measured** across 46 `activity_logs` (`deleted_at IS NULL`):

  | field | populated |
  |---|---|
  | `duration_min` | 46 / 46 |
  | `distance_km` | 39 / 46 |
  | `avg_hr` | 21 / 46 |
  | `calories_burned` | **18 / 46** |
  | `avg_pace_sec_per_km` | **7 / 46** |
  | `steps` | **1 / 46** |
- **Pace is `duration_min × 60 ÷ distance_km`.** 39 logs carry both inputs; 7 carry the pace. It is
  **read from the column, never derived at render** — `components/cardio/efficiency-chart.tsx` plots
  `p.avgPaceSecPerKm` directly and `done-activity-screen.tsx` guards on `!= null` (so the pace block
  silently disappears rather than showing a wrong value).
- **Consequence:** the efficiency chart has gaps for **32 of 39** distance-bearing activities, and
  pace — the number a walker or runner actually looks at — is absent on **85%** of logs.
- **Same shape as Q-230**, which is about `steps` and `caloriesBurned` being hardcoded `null` at save
  on guided walks. `components/activity/exercise-review-sheet.tsx:143` writes
  `avgPaceSecPerKm: null` explicitly, alongside `splits: null, bestEfforts: null, paceSeries: null`.
  **Check Q-230 before starting — this is very likely one fix covering all of these fields**, and
  doing them separately would be the sibling-surface mistake.
- **Decide derive-at-write vs derive-at-read.** At-write matches how the column is consumed today
  and needs a backfill for the 32 existing rows; at-read needs no backfill but must be applied at
  every consumer. Prefer at-write with a backfill, and keep the column authoritative.
- **Out of scope:** whether pace/HR values are physiologically *correct* where present. This entry
  is about absence only; correctness was not assessed.

### [workouts] Q-304 — 29 sets at 13+ reps feed the 1RM estimate on the one path that skips the AMRAP correction

- **Branch:** `fix/high-rep-1rm-correction`
- **Plan:** none yet — **measure the qualifier below before changing anything**
- **Added:** 2026-08-15 · from [`docs/reviews/2026-08-15-workout-model-round-3.md`](reviews/2026-08-15-workout-model-round-3.md) §2
- **The model is well built — this is one gap in it, not a rewrite.** `repFactor` averages Epley and
  Brzycki and **freezes the Brzycki term at 20 reps** so it cannot blow up toward its 37-rep pole,
  with `REP_CEILING = 30` above which nothing is estimated. That is more careful than most
  implementations and should not be touched.
- **The gap:** `amrapScaleFactor` exists for exactly this problem — 1.0 / 0.97 / 0.93 / **0.88** /
  **0.82** by rep band — and is applied by `calcAmrap1RM`. But `estimateOneRm`'s ordinary
  (non-bodyweight, non-baseline) path calls **`calculate1RM`**, which does not apply it.
- **Measured** (`claude_ro.set_logs`, `deleted_at IS NULL`):

  | rep band | sets | **feeding the 1RM estimate** |
  |---|---|---|
  | 1–5 | 40 | 32 |
  | 6–8 | 497 | 390 |
  | 9–12 | 411 | 191 |
  | **13–20** | **59** | **27** |
  | **21+** | **2** | **2** |

  **29 sets at 13+ reps feed the estimate**, where the band's own scale factor would cut 12–18%.
- **✅ QUALIFIER MEASURED 2026-08-16 — it did NOT close the entry. Skip to the fix.** Of the sets
  feeding the 1RM estimate, **28 of the 29 at 13+ reps carry no `planned_pct`** (13–20 reps: 1 of 27;
  21+: 0 of 2), so `prescriptionFactor` returns 1 and the raw `repFactor` stands with no AMRAP
  correction. **The proxy is exact, not approximate**: `log-exercise.ts:233` writes
  `plannedPct: progressionStyle?.[i]?.pct` — the same value `prescriptionFactor` consumes. Working in
  [`docs/reviews/2026-08-16-deferred-measurements.md`](reviews/2026-08-16-deferred-measurements.md) §1.
  **So apply the band correction on the `calculate1RM` path when no prescription factor applies**, and
  add tests at 13, 20 and 21 reps. The double-correction warning below still stands.
- **⚠️ THE QUALIFIER — do this measurement FIRST, it may close the entry.** `prescriptionFactor`
  rescales by `1 / ((pct/100) × repFactor(targetReps))` when a style supplies both `pct` and
  `targetReps`. **Where a style is present, that normalisation may already absorb most of the
  inflation.** This review did **not** establish how often a style accompanies those 29 sets, so
  this is a flagged risk with a measurement attached, not a proven defect.
  - Query: for the 29 sets at 13+ reps with `use_for_1rm = true`, how many had a progression style
    with a non-null `pct` at write time? `planned_pct` on the row is the closest proxy.
  - **If most had a style → close this entry as measured-and-rejected.** That is a fine outcome and
    a better one than a speculative change to a shared formula.
  - **If most did not → apply the AMRAP band correction** on the `calculate1RM` path when no
    prescription factor applies, and add a test at 13, 20 and 21 reps.
- **Do not simply route everything through `calcAmrap1RM`.** Double-correcting a set that already has
  a prescription factor would deflate the estimate, which is the mirror of the current bug.
- **Related:** `personal_records` (30 rows) is written from these estimates. If a correction lands,
  decide separately whether historical PRs are recomputed — that edits training history and needs the
  owner's say-so.

### [workouts] Q-305 — the volume landmarks are computed and never shown to anyone

- **Branch:** `feat/surface-volume-landmarks`
- **Plan:** none yet
- **Added:** 2026-08-15 · from the round-3 review §3
- **The machinery exists**: `MUSCLE_LANDMARKS` in `packages/shared/src/ai-periodization/volume-targets.ts`
  carries MEV/MAV/MRV per muscle, `normalizeMuscle` resolves the taxonomy correctly, and
  `program_volume_targets` exists as a table.
- **Measured** — weekly sets per muscle over 7 days, unnested from `exercise_logs.muscle_groups`:

  | muscle | sets/7d | MEV | MAV | MRV | |
  |---|---|---|---|---|---|
  | triceps | 17 | 6 | 12 | 20 | above MAV |
  | biceps | 14 | 6 | 14 | 22 | at MAV |
  | glutes | 12 | 4 | 10 | 18 | above MAV |
  | **lats** | **9** | **10** | 16 | 22 | **below MEV** |
  | **upper back** | **7** | **8** | 14 | 20 | **below MEV** |
  | **calves** | **2** | **8** | 14 | 20 | **a quarter of MEV** |
- **The finding is the absent surface, not this week's numbers.** Nothing tells the owner that calves
  are at a quarter of their minimum effective volume while triceps sit above MAV. Same
  "computed and discarded" class as **Q-278** (a score that could not be computed rendered like a real
  one) and **Q-302** (the TDEE gate that never announces itself) — consider one shared treatment
  across all three rather than a third bespoke card.
- **EXTENDED 2026-08-16 — push:pull balance belongs on the same surface.** Sets per group over 60
  days: legs 481 (33%), push 433 (30%), pull 333 (23%), other 168 (11%) — a **push:pull ratio of
  1.30**. Mildly push-dominant, common in self-directed training, generally worth correcting toward
  1.0 and well short of pathological. **Nothing in the app computes or surfaces it.** Same surface
  and same fix as the landmark display above; do them together rather than as two cards.
- **⚠️ One week of one user is a small sample and a light week is not a defect.** Before building
  anything, re-run the query over 4–8 weeks to see whether calves/lats/upper-back are persistently
  under MEV or whether this was one quiet week. The entry is about the missing surface either way;
  the specific muscles are illustrative.
- **Where it likely belongs:** the same screen that already shows weekly volume, rather than a new
  destination — see the IA cluster (Q-232…Q-239) before adding a surface.
- **A related check that came back CLEAN, recorded so it is not re-investigated:** `core` is tagged on
  exercises and absent from `MUSCLE_LANDMARKS`, which looks like a silent fall-through to
  `DEFAULT_LANDMARKS`. It is not — `muscles.ts:17` maps `core: 'abs'` and `volume-targets.ts:58`
  applies `normalizeMuscle` before the lookup. Working correctly.

### [platform][readiness] Q-453 — `/api/training-stress` silently answers for *today* when handed a malformed date; its ten siblings all reject it

- **Branch:** `fix/training-stress-date-param-validation`
- **Added:** 2026-08-17 · review sweep (failure-cells lens, **live request matrix**) ·
  [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](reviews/2026-08-17-failure-cells-running-the-app.md)
- **Placement:** lower-mid. Wrong-day data returned as if correct, but no client is known to send a
  malformed date today.
- **Measured.** All 11 `app/api` routes reading a `date`/`localDate` param, hit live with a real
  session cookie. Nine reject `?date=not-a-date` with **400**. `/api/oura/hr-window` takes
  `start`/`end`, not `date`, and 400s throughout. **`/api/training-stress` returns 200.**
- **Cause — `app/api/training-stress/route.ts:22`:**
  ```ts
  const date = (raw ? normalizeDateParamIso(raw) : null) ?? todayInTz(tz)
  ```
  A malformed `date` normalises to `null` and falls through to *today*. The response carries **no echo
  of which date it answered for**, so a caller asking for the 10th with a typo gets the 17th's numbers
  with nothing indicating the substitution.
- **This is not the `[-/]` separator class** — that came back clean (all 11 routes accept both
  separators; see the review). It is the adjacent one: a normaliser whose `null` return is read as
  "use the default" rather than "reject". Worth grepping for the same
  `normalizeDateParam*(...) ?? today…` shape elsewhere when fixing.

### [platform] Q-454 — two routes validate their params before checking auth, out of 122

- **Branch:** `fix/auth-before-param-validation`
- **Added:** 2026-08-17 · review sweep (failure-cells lens, **all 122 GET routes called anonymously**) ·
  [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](reviews/2026-08-17-failure-cells-running-the-app.md)
- **Placement:** low. **No data leaks** — this is ordering, not a hole.
- **Measured.** 122 `app/api` GET routes called with no session cookie. 120 reveal nothing about their
  contract. Two answer the *parameter* question first:
  - `GET /api/day-log` → `400 {"error":"Missing date"}`
  - `GET /api/exercise-history` → `400 {"error":"Missing name"}`
- **Verified not a leak.** Supply the missing param and both return `401 {"error":"Unauthorized"}`
  (`/api/day-log?date=2026-08-14`, `/api/exercise-history?name=Bench%20Press` — both 401 anonymous).
- **Why fix it anyway:** the stated rule is that security checks fail closed and fail *first*. Today
  the pre-auth code only reads a search param; it is cheap to reorder now, and expensive the day
  someone adds a param handler above the `auth()` call that touches the DB.
- **Filed here rather than separately, same class:** `GET /api/push/subscribe` returns
  `503 {"error":"Push not configured"}` to an anonymous caller, disclosing deployment configuration
  before authentication. (Q-285/Q-286 already cover web push having no senders or subscribers; this is
  only about the pre-auth answer.)

### [platform][devices] Q-455 — an unhandled throw in a GET route returns a bodiless 500, not a JSON error

- **Branch:** `fix/decoder-constants-json-error-shape`
- **Added:** 2026-08-17 · review sweep (failure-cells lens) ·
  [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](reviews/2026-08-17-failure-cells-running-the-app.md)
- **Placement:** low.
- **Observed.** `GET /api/oura-ble/decoder-constants` returned **500 with an empty body** — no JSON,
  no `error` key — because a `JSON.parse(fs.readFileSync(...))` threw straight out of
  `app/api/oura-ble/decoder-constants/route.ts:29` with nothing catching it.
- **The trigger is environmental and is NOT what is being filed.** This sandbox cannot reach the
  model-constants bucket (`SignatureDoesNotMatch (403)` at boot, logged by instrumentation) — the
  already-recorded Known Issue *"The bucket download path for the model constants has never actually
  run (2026-08-15)"*. In production with working credentials the read succeeds.
- **What is filed is the shape.** `CLAUDE.md` requires routes to return a JSON error rather than
  throwing; a client doing `res.json()` on this gets a parse exception stacked on top of the original
  fault. The route has a deliberate boot-time check that turns this into a deploy failure rather than
  a first-request one — but the first-request path still exists and still answers with nothing.

### [workouts] Q-299 — autoregulation's missing-data defaults make "add load" easier and "cut load" harder

- **Branch:** `fix/autoreg-null-defaults`
- **Plan:** none yet — small change, but it moves a safety-relevant behaviour
- **Added:** 2026-08-15 · from the pillar-soundness review §1.3
- **A prescription is recorded on a minority of sets** (of 1,009 total, `deleted_at IS NULL`):

  | field | sets | share |
  |---|---|---|
  | `planned_pct` | 280 | 28% |
  | `planned_rest_sec` | 296 | 29% |
  | **`planned_reps`** | **176** | **17%** |

  `repCompletionRate` is null in the remaining ~83%, and additionally requires
  `lastSessionRanPrescription && sessionsInPhase > 0 && prescription && last5.length > 0`.
- **What `autoregulation.ts` does with null is asymmetric:**
  ```ts
  // back-off (cut load)
  const missedReps = sig.repCompletionRate != null && sig.repCompletionRate < COMPLETION_CEIL
  if (sig.rpeDelta >= RPE_DEAD_BAND && (sig.rm1Trend === 'down' || missedReps)) { … }

  // push (add reps)
  const metReps = (sig.repCompletionRate ?? 1) >= 1
  if (sig.rpeDelta <= -RPE_DEAD_BAND && sig.rm1Trend !== 'down' && metReps) { … }
  ```
  **Null makes `missedReps` false and `metReps` true.** Missing data *removes* a condition from the
  increase path and *adds* one to the decrease path: back-off then needs the 1RM to be actively
  falling, while push needs only the RPE delta plus a 1RM that is not falling.
- **It compounds Q-289.** That measured a systematic **−2.19** RPE delta at expected-10, past the
  `<= -2` threshold that adds **two** target reps — and on 83% of sets the only remaining guard is
  auto-satisfied.
- **Fix direction — decide the intent, then encode it symmetrically.** `?? 1` reads as "assume the
  reps were met", which is the optimistic reading of missing data on the path that adds load. Either:
  - treat null as **unknown and blocking on both paths** (safest: no autoregulation without
    prescription data), or
  - treat null as neutral on both paths.

  What it must not stay is optimistic on one side and pessimistic on the other.
- **Also worth fixing the input:** 83% of sets carrying no `planned_reps` is the root cause. Find out
  why — whether it is sets logged outside a prescribed session, or a write path that drops the
  planned fields.

### [workouts] Q-300 — 37% of sets are taken with materially less rest than prescribed, and the RPE model has no rest term

- **Branch:** `feat/rest-adherence-signal`
- **Plan:** none yet
- **Added:** 2026-08-15 · from the pillar-soundness review §1.4
- **Measured** where both planned and actual rest are recorded (n = 276):
  ```
  mean rest taken     99 s
  mean rest planned  111 s
  rushed   (< 75% of planned)   103 sets  (37%)
  overlong (> 150% of planned)   44 sets  (16%)
  ```
- **Why this is a modelling finding and not a nagging-the-user finding.** `expectedRpe(pct, reps)`
  maps intensity and reps to an expected RPE **as if rest were constant**. It is not: a set at 80%
  with 60 s rest is a materially harder stimulus than the same set with 120 s. With 37% of sets
  rushed, a systematic rest deficit is folded into the RPE residual that Q-289 measured.
- **✅ MEASURED 2026-08-16 — REST IS NOT THE CONFOUND. Q-289 stands alone; do not wait on this.**
  Delta (actual − expected) by rest band:

  | expected | on-target (n=120) | rushed (n=96) | overlong (n=42) | unknown (n=311) |
  |---|---|---|---|---|
  | 5 | +1.00 | +1.10 | +1.25 | **+2.36** |
  | 10 | **−1.75** | **−2.80** | **−2.33** | **−2.21** |

  Rest is *a* contributor — on-target is consistently mildest — but the shape error survives in every
  band and **expected-10 clears the 1.5 dead band in all four**. The non-monotonic top survives too.
  **Q-289's recalibration should proceed without waiting for a rest term.** Working in [`docs/reviews/2026-08-16-deferred-measurements.md`](reviews/2026-08-16-deferred-measurements.md) §2.
  **This entry's remaining value is its secondary half**: rest adherence as a coaching signal, which
  is not surfaced anywhere. Re-scope it that way rather than as a Q-289 dependency.
- **Do this BEFORE recalibrating Q-289.** Re-run the Q-289 bucket table **split by rest adherence**
  (rushed / on-target / overlong). Two possible outcomes and they lead different places:
  - the miscalibration largely disappears within the on-target band → the model is fine and rest is
    the confound, so add a rest term rather than re-fitting the curve;
  - it persists across all three bands → the curve is genuinely mis-shaped, and Q-289 stands alone.
- **Do not add a rest term speculatively.** Establish which of the two it is first; the split is a
  small change to the same harness Q-289 used.
- **Secondary, cheap:** rest adherence is a legitimate coaching signal in its own right and is not
  surfaced anywhere. Note Q-85 (a shortened session keeps full-length rest periods) is adjacent —
  check whether the rushed sets cluster in time-budget-constrained sessions before treating this as
  a user-behaviour finding.

### [cardio] Q-301 — the running baseline is written at plan creation, has zero rows, and nothing reads it

- **Branch:** `fix/running-baseline-wiring`
- **Plan:** none yet
- **Added:** 2026-08-15 · from the pillar-soundness review §2
- **`running_baselines` holds exactly what a run prescription should rest on:** `vo2max`, `max_hr`,
  `resting_hr`, `threshold_hr`, `weekly_base_minutes`, `easy_pace_sec_per_km`.
- **Three verified facts:**
  1. Production holds **0 rows**, against 1 `running_plans` row and **12 `prescribed_runs`**.
  2. `saveRunningBaseline` **is** wired — `app/api/running-plan/route.ts:144` calls it at plan creation.
  3. **`getRunningBaseline` has zero callers outside the repository layer** (`adapter.ts:2425`,
     `repository.ts:543`). Nothing in `app/`, `components/` or the rest of `lib/` reads it.
- **The dead reader is the finding, not the empty table.** Even fully populated, no prescription
  would consult it — so all 12 prescribed runs were generated without reference to the athlete's
  VO2max, threshold HR or easy pace. Whatever they *are* based on is the thing to establish first.
- **Investigate in this order:**
  1. **What do the 12 `prescribed_runs` actually derive from?** Read the generator. If it uses
     sensible inputs by another route, this is dead code to delete, not a broken feature to wire.
  2. **Why is the table empty** when the writer is on the plan-creation path? Either the one plan
     predates the writer, or the write fails silently. Check the plan's `created_at` against the
     commit that added `saveRunningBaseline`.
  3. Only then decide: wire the reader, or delete the table and its repository methods.
- **Third instance of a recurring class** — Q-270 (`training_load_ots`: live producer, zero rows)
  and Q-231 (the "Exercise detected" card losing its only writer). Worth proposing a CI check that
  flags a repository read method with no callers outside the data layer.

### [nutrition] Q-302 — adaptive TDEE has not fired once in 30 days, and nothing tells the user why

- **Branch:** `feat/tdee-gate-visibility`
- **Plan:** none yet
- **Added:** 2026-08-15 · from the pillar-soundness review §3.2
- **The gate** (`packages/shared/src/nutrition/adaptive-tdee.ts`): `MIN_LOGGED_DAYS = 10` within
  `DEFAULT_WINDOW_DAYS = 14` (`MIN_LOGGED_FRACTION = 0.7`), plus `MIN_WEIGH_INS = 4`.
- **Measured against production food logs, rolling 14-day windows:**
  ```
  window ending   logged/14
  2026-08-15         4/14   fail
  2026-08-14         3/14   fail
  2026-08-13         2/14   fail
  2026-08-12         1/14   fail
  …
  of the last 30 rolling windows, 0 pass the >=10-logged-days gate
  ```
  The weigh-in gate passes comfortably (14 weigh-ins in 14 days) — **food logging alone blocks it.**
- **Note the aggregate figure is misleading and was corrected during the review:** "41 of 76 days
  logged (54%)" is true overall, but logging is front-loaded; recent coverage is **1–4 days per 14**.
- **The gate is probably RIGHT — do not lower it.** Estimating maintenance from 3 of 14 days would
  be worse than not estimating it. `MIN_PLAUSIBLE_MAINTENANCE`/`MAX_PLAUSIBLE_MAINTENANCE` show the
  module already takes its own reliability seriously.
- **The defect is invisibility.** `TdeeAdaptationCard` is on the nutrition screen and the user has
  no way to know it is dormant, why, or what would wake it. Show the gate: *"Adaptive TDEE needs 10
  logged days in a fortnight — you have 4. Log 6 more to switch it on."* That is a real, achievable
  instruction and it is strictly better than a card that quietly shows nothing.
- **Check first what the card currently renders** in the not-enough-data state — it may already show
  something, in which case this is a copy change rather than a new state.
- **Ties to Q-278** (a score that could not be computed rendered identically to a real one) — same
  class, different pillar. Consider one shared "this needs more data, here is how much" treatment.

### [nutrition][platform] Q-303 — the AI gives macro coaching on days with almost no logging coverage

- **Branch:** `fix/ai-qualify-sparse-nutrition`
- **Plan:** none needed
- **Added:** 2026-08-15 · from the pillar-soundness review §3.3
- **Observed**, 2026-08-15 daily digest: *"While your activity was great with 8266 steps, let's focus
  on bumping that protein closer to your 150g goal tomorrow to better support those big strength
  gains."*
- **The 14-day window containing that day has 4 logged days.** The protein advice rests on almost
  nothing, and it is delivered in the same sentence, with the same confidence, as the workout
  numbers beside it — which are complete and correct.
- **Distinct from Q-292**, which is about a *false* number ("perfect activity score" when it was 80).
  Nothing here is false; it is **unqualified**. The fix is different: the model needs to know the
  coverage behind each figure it is given, and to say so or stay quiet.
- **Fix direction:** pass a coverage/confidence value alongside each domain's numbers in the digest
  prompt, and instruct the model not to issue a corrective recommendation for a domain below a
  coverage floor. The data is already computed for Q-302's gate — reuse it rather than deriving it
  twice.
- **Sibling sweep:** every AI surface taking nutrition data has this exposure, not just the daily
  digest — check `weekly-digest`, `health-insight` and the Coach's nutrition tools.

### [workouts] Q-289 — `expectedRpe` misses by more than the autoregulation dead band at both ends of its own range

- **Branch:** `fix/expected-rpe-calibration`
- **Plan:** none yet — recalibration wants a written plan
- **Added:** 2026-08-15 · from [`docs/reviews/2026-08-15-uncovered-lenses-review.md`](reviews/2026-08-15-uncovered-lenses-review.md) §1
- **Measured against 569 real production sets** (every `set_logs` row with rpe + intensity_pct +
  reps, `deleted_at IS NULL`), running the actual shipped `expectedRpe`:
  ```
  actual   RPE  mean=7.48  sd=0.87  range=6..10
  expected RPE  mean=7.67  sd=1.34  range=5.0..10.0
  r = 0.348      MAE = 0.99 RPE points      bias = −0.19
  ```

  | expected | actual mean | **delta** | n |
  |---|---|---|---|
  | 5 | 6.93 | **+1.93** | 68 |
  | 6 | 6.87 | +0.87 | 45 |
  | 7 | 7.45 | +0.45 | 56 |
  | 8 | 7.57 | −0.43 | 288 |
  | 9 | 7.90 | −1.10 | 60 |
  | 10 | 7.81 | **−2.19** | 52 |
- **⚠️ NARROWED 2026-08-16 — the low-end half of this finding was a data-era artefact.** The
  **+1.93 at expected-5** above is pooled across all history. `planned_pct` only exists from
  **2026-07-18** (migration `126_set_log_planned_snapshot.sql`), and splitting by era gives:

  | expected | PRE-cutover (n=291) | **POST-cutover (n=278)** |
  |---|---|---|
  | 5 | +2.36 | **+1.09 — does NOT clear the 1.5 band** |
  | 10 | −2.16 | **−2.29 — still clears** |
  | r / MAE | 0.324 / 1.04 | 0.483 / 0.94 |

  **Re-scope this entry to the TOP of the range.** On current data the model reads heavy
  prescriptions as easier than they are (−2.29 at expected-10, past the −2 two-rep-bump threshold),
  and the **non-monotonic top end survives in both eras** — that is the durable defect. The low end
  is inside the dead band now. Working in [`docs/reviews/2026-08-16-deferred-measurements.md`](reviews/2026-08-16-deferred-measurements.md) §3.
- **Why this is actionable and not just interesting.** `autoregulation.ts:19` sets
  `RPE_DEAD_BAND = 1.5` against `rpeDelta = actual − expected`:
  - `>= +1.5` → back-off, cut load 5–10%
  - `<= −1.5` → push, add a target rep; **`<= −2` adds two**
  - `emergency-deload.ts:35` fires on `rpeTrend.delta > 2.0`

  **At expected 5 the systematic error alone is +1.93; at expected 10 it is −2.19.** Both clear the
  dead band before the lifter has done anything, and −2.19 clears the two-rep bump threshold.
  **120 of 569 sets (21%) sit in those buckets.** The heaviest prescriptions systematically read as
  *"that felt easy, earning the next jump"*.
- **Two distinct defects:**
  1. **Scale mismatch** — predictions span 5.0–10.0 while actual bucket means span 6.87–7.90.
  2. **Non-monotonic at the top** — expected 9 → 7.90 but expected 10 → 7.81. The hardest
     prescriptions come back easier than the second-hardest. That is not a calibration offset; it
     suggests `maxRepsAtPct` is unreliable where `repFactor` is extrapolated hardest.
- **The construction is sound — do not rewrite it.** Inverting `repFactor` to get RIR is the right
  method and keeps `expectedRpe` tied to the 1RM math (*One Formula, One Place* working as intended).
  The fix is calibration, not replacement.
- **Directions, in order:**
  1. Re-derive the bucket table excluding warm-up/backoff sets if those are in the 569 — check
     whether `planned_pct` vs `intensity_pct` separates them. A confound here would change everything.
  2. Fit a correction to the realised distribution, or widen `RPE_DEAD_BAND` to a value the model's
     own error cannot reach on its own. **Widening alone is the safer interim**: it makes
     autoregulation fire less, never more.
  3. Investigate the non-monotonic top end separately — it may be a `maxRepsAtPct` bug, not a
     calibration issue.
- **Gate:** re-run this exact measurement after the change. The harness is ~30 lines against
  `set_logs`; the review has the query.
- **Depends on Q-290** — the input signal's own variance bounds what any calibration can achieve.

### [workouts] Q-290 — logged RPE carries almost no information: sd 0.87, and effectively two values

- **Branch:** `feat/rpe-capture-quality`
- **Plan:** none yet
- **Added:** 2026-08-15 · from the uncovered-lenses review §1.4
- **Measured** over the same 569 sets: **actual RPE sd = 0.87, range 6–10**, distribution dominated
  by 7s and 8s. The slider offers 5–10; production uses about two of those values.
- **Why it matters.** Autoregulation differences a ~1-point-variance *signal* against a
  ~5-point-variance *prediction* (Q-289). Even a perfectly calibrated `expectedRpe` cannot extract
  much from an input this flat, so **Q-289's ceiling is set here**.
- **This is a capture problem, not a formula problem.** Candidate causes, none yet checked:
  - The slider's default may anchor the answer (if it opens at 7 or 8, that is what gets logged).
  - RPE may be logged after the fact rather than at the set, when the distinction has faded.
  - The scale may not be explained — RPE is only meaningful if the user knows 8 means "2 reps left".
  - 587 of 1,009 sets have an RPE at all; the 42% that skip it may be the informative ones.
- **First action:** read the RPE input component and check its default value and its position in the
  logging flow. If it opens pre-set to a value, that is very likely the whole finding.
- **Do not "fix" this by widening the model.** A flat signal made wider is still flat.

### [platform][devices] Q-285 — the web-push stack has no senders and no subscribers

- **Branch:** `chore/decide-web-push`
- **Plan:** none needed — this is a decision, then a small change either way
- **Added:** 2026-08-15 · from the uncovered-lenses review §3
- **Measured and traced end to end:**
  - `claude_ro.push_subscriptions` — **0 rows.**
  - The subscribe path exists and is user-reachable: `components/more/settings-panel.tsx:78` →
    `subscribeToPush()` (`lib/push-client.ts`) → `reg.pushManager.subscribe()` →
    `POST /api/push/subscribe`.
  - **`sendPushToUser` (`lib/push.ts:30`) has exactly one caller in the codebase:
    `app/api/push/test/route.ts`.** No feature sends a web push.
- **This is NOT the notification work recorded in `projectOverview.md`.** Those rows (ring/strap
  quieting, low-battery exception, scale notification) are **native Android** —
  `OuraRingService.kt`, `ScaleBleService.kt`, `PolarStrapService.kt`, `DeviceBatteryNotifier.kt` —
  and that stack works. Web push is a separate, inert one. Stated explicitly because the first draft
  of this finding conflated them.
- **Decide, don't drift:**
  - **(a) Wire it.** There is an obvious consumer already shipped and stranded — see **Q-286**.
    Note this needs a scheduler, and `docs/module-map.md` §0 says there is deliberately none.
  - **(b) Remove it.** Delete `lib/push.ts`, `lib/push-client.ts`, both `/api/push/*` routes, the
    settings toggle and the `push_subscriptions` table. Roughly 200 lines and a table.
  - **(c) Keep it dormant** — then say so in `module-map.md`, so the next session does not re-find it.
- **Check before deciding:** whether `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_EMAIL` are
  set in Railway. `sendPushToUser` returns silently when they are not (`if (!VAPID_CONFIGURED) return`),
  so an unconfigured deployment is indistinguishable from a working one with no subscribers.

### [nutrition][workouts] Q-286 — a user can enable a supplement reminder that can never fire

- **Branch:** `fix/stranded-reminder-toggles`
- **Plan:** none yet
- **Added:** 2026-08-15 · from the uncovered-lenses review §3
- **The full path exists, and it ends nowhere.** `supplements.reminder_enabled` /
  `reminder_time` and `program_sessions.reminder_enabled` are:
  - **exposed as a real control** — `components/nutrition/manage-supplements-sheet.tsx:253`,
    `<Switch checked={reminderEnabled} onCheckedChange={setReminderEnabled} />`
  - persisted through `POST /api/supplements` and `PATCH /api/supplements/[id]`
  - synced to the device (`lib/local-store/sqlite-backend.ts`, `sync-engine.ts`)
  - **read by nothing that fires a notification.**
- **Two independent reasons it cannot work**, either of which is sufficient:
  1. `docs/module-map.md` §0: *"There is no cron layer, no job queue, and no GitHub Actions schedule
     in this app."* Nothing exists to wake at `reminder_time`.
  2. The only notification transport that could deliver it has no sender and no subscribers (**Q-285**).
- **User-visible severity is the point.** The toggle persists and syncs, so it *looks* like it
  worked. This is worse than a missing feature.
- **Options:**
  - **(a) Remove the toggles** until there is a scheduler. Smallest honest change; do this if (b) is
    not being taken soon.
  - **(b) Deliver locally, no server needed.** A Capacitor local-notification schedule set on-device
    when the toggle flips sidesteps both blockers — no cron, no web push. This is likely the right
    answer for a device-first app and does not violate the no-cron rule, since nothing server-side
    schedules anything.
- **Sibling sweep:** `program_sessions.reminder_enabled` has the same shape — check whether it has a
  UI toggle too, and fix both together.

### [platform][readiness] Q-291 — the AI surfaces contradict each other on the same day

- **Branch:** `fix/ai-surface-shared-state`
- **Plan:** none yet
- **Added:** 2026-08-15 · from the uncovered-lenses review §2.2
- **Observed in production, 2026-08-06, one user, one day:**
  - **Readiness insight:** temperature 0.8 °C above baseline → *"Keep your planned exercise
    intensity low."*
  - **What happened:** `workout_sessions` shows **two** sessions — Legs 01:40, Upper 21:26.
  - **Daily digest, same day:** *"Crushing three PRs… dominate today's 6754 kg leg volume session…
    **Keep that same energy tomorrow!**"*
- **Readiness then fell 79 → 76 → 76 → 65 across 08-05…08-08**, so the morning signal was arguably
  correct and the evening digest encouraged a repeat of what degraded it.
- **Distinct from Q-275/Q-276, and the fix is different.** Those are about the *scores* (readiness
  is blind to load; the pillars disagree). This is about the *narration*: each AI surface builds its
  own prompt from its own slice and none can see what another said today. Even with perfect scores,
  the digest would still not know the morning advised backing off.
- **Direction:** give the day's AI surfaces a shared context — the simplest version is that any
  same-day generation reads the day's existing `ai_health_insights` rows and is instructed not to
  contradict them without acknowledging the change. `ai_health_insights` already stores by
  `(section, date)`, so the read is cheap and the table already exists.
- **Check while in here:** whether the digest has any access to the day's readiness advisory at all,
  or only to the outcome numbers. That determines whether this is a prompt change or a data-plumbing
  change.

### [platform] Q-292 — the AI stated a score that is false, and gave an imperial measurement to a metric user

- **Branch:** `fix/ai-numeric-grounding`
- **Plan:** none needed
- **Added:** 2026-08-15 · from the uncovered-lenses review §2.3
- **Two defects in one sampled batch of 8 insights:**
  1. **2026-08-05 activity insight:** *"…leading to a perfect activity score."*
     `oura_daily_derived.activity_score` for that day is **80**. The number was fabricated.
  2. **2026-08-05 sleep insight:** *"keep your bedroom temperature at 65 degrees Fahrenheit"* — to a
     user in Australia whose app is metric throughout.
- **The rule this falls just outside.** `CLAUDE.md` (*AI & Security Defaults*) forbids an LLM
  self-reported number **gating an automatic action**. This number gates nothing — it is rendered to
  the user as fact. The rule's spirit covers it; its letter does not.
- **Fix direction:**
  - Pass the score into the prompt as a value the model must quote rather than characterise, and
    instruct it never to introduce a qualitative claim about a number it was not given
    ("perfect", "record", "your best").
  - State the user's unit system and timezone in the shared prompt preamble. Cheap, and this is the
    second unit/locale bug class this app has hit (`toLocale*String` without a `timeZone`).
- **Worth a rule amendment** alongside the fix: extend the *no LLM self-reported number* rule to
  cover numbers **displayed** to the user, not only numbers that gate actions.
- **✅ SYSTEMATIC PASS DONE 2026-08-16 — all 117 audited.** **7 imperial-unit errors** (all
  Fahrenheit, all in `sleep`) and **12 absolute superlatives**; roughly **16% of insights carry at
  least one**. One quasi-medical inference (2026-07-19, hedged, benign advice, but it infers
  "fighting off an infection" from a temperature reading **and says it is advising without a
  readiness score**). One regex hit for train-through-illness was read and is a **false positive**.
  **A second fabricated superlative is now double-confirmed**: *"a perfect recovery index"*
  (2026-07-05) — and the Recovery Index contributor scored **21 of 100** that day. (This line used to
  cite Q-271's "never exceeded 50 on any of 31 scored days"; **Q-500 re-measured that over 41 days and
  it is false** — the contributor exceeds 50 on 12 of them. The fabricated-superlative finding stands
  on its own day's value regardless.) Working in [`docs/reviews/2026-08-16-deferred-measurements.md`](reviews/2026-08-16-deferred-measurements.md) §5.
- **Scope note:** 8 of 117 insights were read closely. A systematic pass over the rest is the
  natural companion and would size the problem properly.

### [platform] Q-293 — `ai_health_insights.context_hash` is NULL on 109 of 117 rows

- **Branch:** `fix/insight-context-hash`
- **Plan:** none needed
- **Added:** 2026-08-15 · from the uncovered-lenses review §2.4
- **Measured:**

  | section | rows | distinct `context_hash` |
  |---|---|---|
  | sleep | 23 | **0 (all NULL)** |
  | readiness | 21 | **0** |
  | activity | 19 | **0** |
  | heart-rate | 18 | **0** |
  | weekly-digest | 6 | **0** |
  | session-explain / session-recap | 17 | **0** |
  | daily-digest | 12 | 8 |
- **So the regeneration-avoidance key is written by one section of fourteen.** Whatever caching or
  dedup the column exists for cannot work anywhere else. Corroborating signal:
  `ai_call_log_fingerprint_idx` shows **zero scans** (also listed in Q-283).
- **Establish intent before writing code.** Find the one writer that populates it and read what it
  hashes. Three possibilities and they need different fixes: the column was added for a feature that
  was never finished; it is `daily-digest`-specific and the schema is too general; or every section
  was meant to write it and only one was wired.
- **Low user impact, real cost impact.** Nothing is broken for the user — insights regenerate rather
  than being served stale. It is redundant LLM calls, and per Q-295 the AI bill is negligible, so
  **treat this as correctness-of-intent, not as an optimisation.**
- **Minor, same area:** `section` embeds a UUID for `session-explain:<id>` / `session-recap:<id>`,
  making it high-cardinality and awkward to group. Consider a separate `subject_id` column if this
  is touched anyway — not worth its own PR.

### [platform] Q-287 — there is no self-service account deletion, and the Play Store requires one

- **Branch:** `feat/account-deletion`
- **Plan:** **required before any code** — this is destructive and irreversible
- **Added:** 2026-08-15 · from the uncovered-lenses review §4
- **Confirmed:** account deletion exists only under `app/api/admin/users`. There is no user-facing
  path, in-app or web. Google Play has required both since 2024, and `CLAUDE.md` names the Play
  Store listing as the goal (alongside the privacy policy, data-safety declarations, and the Health
  Connect declared-use-case review, which are separate gates).
- **📋 PLAN DRAFTED 2026-08-16 — [`docs/superpowers/plans/2026-08-16-account-deletion.md`](superpowers/plans/2026-08-16-account-deletion.md).**
  Still ⛔ blocked: the plan is a set of **seven marked owner decisions**, not an implementation.
  Key findings it records so an implementer does not re-derive them:
  - **The user-scoping map is already solved** — `scripts/generate-claude-ro-views.js` classifies all
    ~80 tables (`user_id` / 17-table `VIA` FK paths / `GLOBAL` / `DENIED`) and **fails loudly on an
    unclassified table**. Generate the delete from that map with the same default-deny failure mode;
    a hand-written list is how a later table survives a deletion request.
  - **`oura_raw_samples` is 341 MB / ~1M rows for one user** — a synchronous delete will exceed
    `statement_timeout: 15_000`. Measure before designing around it.
  - **Q-288 is a hard dependency**: if deletion offers export-first, an export covering 27 of 80
    tables is the user's last chance at data it does not include.
  - **Last-admin lockout** — deleting the only admin removes access to `/api/admin/*`, including the
    `db-query` endpoint every review depends on.
- **⛔ Do not implement without the owner's explicit sign-off on the semantics.** Per *Safety &
  Reversibility*, this is exactly the destructive/irreversible class that stays confirm-first. The
  deliverable of the first PR is a **plan**, not a route.
- **What the plan must settle:**
  1. **Hard delete vs. tombstone**, per table. 80 tables, and `oura_raw_samples` alone is 1M rows.
  2. **The user-scoping map already exists — reuse it.** `scripts/generate-claude-ro-views.js`
     had to solve exactly this problem (which tables are user-scoped, which are FK-reachable, which
     are global) and **fails rather than guessing** on an unclassifiable table. That failure mode is
     the right one here too, and rebuilding the map by hand would be the mistake.
  3. **FK order.** `CLAUDE.md` records that `ON DELETE SET NULL` once wiped session identity across
     four deploys — deletion order is a known hazard in this schema.
  4. **Confirmation UX and a grace period** — a mis-tap must not be terminal.
  5. **What the owner's own account does.** Deleting the only admin has obvious consequences.
- **Verify the current Play policy wording** before building; this entry asserts the 2024
  requirement from knowledge, not from a fetch of Google's current page.

### [platform] Q-288 — `/api/export` covers 27 domains of 80 tables and presents as complete

- **Branch:** `fix/export-completeness`
- **Plan:** none needed
- **Lane: A** — `lib/export/full-export.ts`, `app/api/export/`. ⚠️ `lib/export/` is unlisted in the
  lane contract and is **shared with Q-530**; claim it in Lane A's baton, and do not run the two
  items concurrently in different sessions.
- **Added:** 2026-08-15 · from the uncovered-lenses review §4
- **Measured:** `lib/export/full-export.ts` exports 17 `DIRECT_DOMAINS` + 9 `JOINED_DOMAINS` +
  `goals` = **27**. `schema.ts` declares **80** `pgTable`s.
- **Credential/token exclusions are deliberate and correct** (the file says so). The gap is
  everything added since the export was written, including data the user would most expect:

  `oura_daily_derived` (every computed score) · `oura_daily_summary` (personal baselines) ·
  `oura_heartrate` (49,272 rows) · `rr_intervals` · `body_battery_daily` · `set_hr_stats` ·
  `workout_hr_stats` · `coach_messages` / `coach_threads` / `ai_health_insights` (the user's AI
  conversations) · `meal_plans` / `meal_plan_meals` / `saved_meals` / `nutrition_targets` ·
  `fitness_tests` · `running_plans` / `prescribed_runs` / `running_baselines` · `daily_zone_minutes` ·
  `step_live_windows` · `seasons` / `season_results` · `goal_recommendations`
- **An incomplete export is worse than none**, because nothing signals the omission — and it is the
  artefact a data-portability claim rests on. Pairs with **Q-287**; same Play Store gate.
- **Fix direction — make the list self-maintaining rather than adding 53 lines.** The same
  classification problem is already solved by `scripts/generate-claude-ro-views.js`, which is
  default-deny and **fails on an unclassified table**. Either drive the export from that map, or add
  a CI check asserting every user-scoped table is either exported or on a written exclusion list.
  Hand-extending the array reproduces exactly the drift being fixed.
- **Decide explicitly on the big ones:** `oura_raw_samples` (1M rows, 341 MB) probably should *not*
  stream into a user download; that is a legitimate exclusion, but it should be **written down** as
  one rather than absent by accident.
- **Re-measured 2026-08-17** (Q-530's planning session, checking whether the snapshot endpoint could
  extend this route instead of adding one — it can't; the two have different auth models and opposite
  needs on ops tables). Two corrections and one new defect:
  - **The count is 26 of 82 tables**, not 27 of 80. The old 27 counted `goals`, which is a repository
    call rather than a table. `oura_raw_samples` is now **1,098,183 rows / 360 MB** in production.
  - Also missing beyond the list above: the user's own **`users` profile row**,
    `saved_meal_items`, `meal_plan_variants`, `plan_meal_answers`, `user_dietary_restrictions`,
    `scale_raw_samples`, `oura_workouts`, `user_stats`, `session_periodization`,
    `exercise_estimates`.
  - **⚠️ The route cannot stream a large table today, and its comment says it can.** `exportUserData`
    calls `pool.query` per table, which buffers the entire result set; the route comment claims it
    streams "rather than buffering the whole export in memory", and only the per-table `ReadableStream`
    enqueue is true. Harmless across 26 small tables, an OOM the moment a bulk table is added — so
    **fixing coverage without fixing this is strictly worse than the bug.** Use keyset pagination by
    primary key (every prod table has one, verified) per
    [`plans/2026-08-17-admin-db-snapshot-endpoint.md`](superpowers/plans/2026-08-17-admin-db-snapshot-endpoint.md) §3.3.

### [platform] Q-295 — Coach is 8% of AI calls, 52% of tokens, and the slowest surface in the app

- **Branch:** `perf/coach-prompt-caching`
- **Plan:** none needed
- **Added:** 2026-08-15 · from the uncovered-lenses review §5
- **Cost is explicitly NOT the reason for this entry.** Measured: 255 calls / 632,639 tokens over 24
  days ≈ **26,360 tokens/day**, which at flash-lite rates is cents per month and ~$6/month at 100×
  the users. **Do not optimise this for money.**
- **Latency is the reason.** Measured by section:

  | section | calls | tokens | input | output | avg latency |
  |---|---|---|---|---|---|
  | **coach** | 17 | **330,221 (52%)** | 316,687 | 13,534 | **5,840 ms** |
  | prescription | 43 | 151,783 | 127,831 | 23,952 | 2,455 ms |
  | ai-chat | 4 | 61,015 | 60,346 | 669 | 2,966 ms |

  Coach + ai-chat: **21 of 255 calls (8%) for 62% of tokens**, at a **23:1 input:output ratio** —
  ~19,400 input tokens per coach call. 5.8 s is the slowest user-facing surface in the app.
- **A large static prompt prefix is what context caching is for.** Check how much of those 19,400
  tokens is stable across calls before assuming it helps — if the prompt is mostly per-call user
  data, caching buys nothing and this entry closes as measured-and-rejected, which is a fine outcome.
- **Related history:** Q-170 already cut Coach latency 10.0 s → 3.5 s by addressing reasoning
  tokens. The 5,840 ms measured here is the current state after that fix, so this is the next
  increment, not a regression.

### [platform] Q-296 — the docs say Coach runs `gemini-3.6-flash`; production says otherwise

- **Branch:** `fix/coach-model-discrepancy`
- **Plan:** none needed
- **Added:** 2026-08-15 · from the uncovered-lenses review §5
- **The contradiction:**
  - `docs/module-map.md`: *"Coach alone runs `COACH_MODEL_ID` (`gemini-3.6-flash`) with
    `google.tools.googleSearch({})` grounding; every other AI route stays on `AI_MODEL_ID`."*
  - `claude_ro.ai_call_log`: **17 `coach` calls, every one on `gemini-3.1-flash-lite`**, latest
    2026-08-13. Production shows **no other model** across all 255 calls.
- **One of the two is wrong and they fail differently:**
  - If the **model** is wrong, Coach is not running the model it was designed for, and the grounding
    tool may not be active either — a capability regression nobody would notice.
  - If the **logging** is wrong, `ai_call_log.model` misattributes every call, which makes the Q-295
    measurements above (and any future cost work) unreliable.
- **First action:** read `lib/ai/instrument.ts` — it holds `AI_MODEL_ID` and greps as a binary file,
  which is itself worth a look. `lib/ai/__tests__/instrument.test.ts:43` asserts
  `AI_MODEL_ID === 'gemini-3.1-flash-lite'`; find whether `COACH_MODEL_ID` exists at all, and
  whether the coach route passes it through the logged wrapper or around it.
- **Cheap to settle, and it invalidates measurements while it stands.**

### [platform][app-shell] Q-294 — the failure cells whose intended behaviour is undefined

- **Branch:** folded into Q-249's E2E scenario list — **no branch of its own**
- **Plan:** none · **this is a note against Q-249, not independent work**
- **Added:** 2026-08-15 · from the uncovered-lenses review §6
- **Filed only so it is not lost** (*No orphaned findings*). The degradation matrix was a **desk
  exercise — no failure was induced**, and a desk-derived list is a weaker artefact than the same
  list produced against a running app.
- **Most failure modes are handled**, and much of `CLAUDE.md` exists because of them: poison-pill
  outbox quarantine, local-SQLite open-path recovery, cursor pagination, `pool.on('error')`,
  `reconcileSchema` as the post-partial-upgrade authority. Not restated.
- **The cells where the *intended* behaviour is undefined:**

  | failure | state |
  |---|---|
  | JWT expires mid-workout | no recorded decision on whether the in-progress session survives |
  | Service worker serves a stale shell after deploy | build-stamped cache name handles the cold case; the **in-session** case is undefined |
  | Device clock skewed hours from the server | ingest tolerances exist; no user-visible signal |
  | Gemini rate-limited during a prescription generate | undefined — does the workout proceed on last-known numbers? |
- **What to do with this:** when **Q-249** (the E2E harness) is built, these four become scenarios.
  Each needs a decision on intended behaviour *before* a test can assert anything, so the decision is
  the work, not the test. Do not start this as a standalone item.

### [sleep][devices] Q-274 — fragment "nights" reach the sleep score, and on two dates the fragment is the ONLY record

- **Branch:** `fix/sleep-fragment-nights`
- **Plan:** none yet — needs a scoping pass first (see below)
- **Added:** 2026-08-15 · from the comprehensive review,
  [`docs/reviews/2026-08-15-comprehensive-app-review.md`](reviews/2026-08-15-comprehensive-app-review.md) §1.9
- **Measured in production, all history post-re-key** (`claude_ro.sleep_sessions`, `date >= '2026-07-07'`:
  46 rows over 40 dates). **Ten rows are under 1.5 h; three are exactly 0.00 h with `efficiency = 0`.**
  Rows-per-date:
  ```
  2026-08-09  n=2  durations: 8.58 | 0.00
  2026-08-10  n=2  durations: 7.17 | 0.08
  2026-08-11  n=1  durations: 0.00      ← the ONLY record for this date
  2026-08-13  n=1  durations: 1.42      ← the ONLY record for this date
  ```
  Aggregate `duration_hours` reads mean 6.53 h, **sd 3.08 h** — a spread these rows create.
- **Why it matters beyond the sleep card.** These rows feed `previousNight` (16% of readiness) and
  `sleepBalance` (10%). The stored readiness contributors for the affected days show `sleepBalance`
  collapsing to 0 and 9 — a saturated z-score against a baseline the fragment has poisoned.
- **Relationship to Q-225 — sharpen it, do not replace it.** 2026-08-13 is the night Q-225 was
  opened on, and that entry explicitly asks for *"a reusable local-repro harness for checking whether
  other recent nights hit the same bug"*. **This is that sweep, done at the data layer, and it found
  at least one more: 2026-08-11 shares the signature** (single row, near-zero duration). Whether
  08-11 has the same *cause* as 08-13 is unproven — Q-225's local repro harness is the tool that
  would settle it.
- **Two distinguishable problems, and they may need different fixes:**
  1. A **0.00 h row exists at all.** A sleep session of zero duration is not a short night, it is a
     failed rollup or a stray detection. Decide whether the rollup should refuse to write it.
  2. A fragment can be the **only** row for a date, so every downstream reader picks it as the
     night. `nightSessions` (`packages/shared/src/health/sleep-night.ts`) already has a main-sleep
     notion — check whether it has a minimum-duration floor and what it does when *nothing* clears it.
- **Do not fix by filtering at the read sites.** That is the sibling-surface trap: there are several
  readers (sleep card, readiness payload, trends, score-audit) and a filter added to one is a
  half-fix. Decide the invariant once, at the write or at `nightSessions`.
- **First action:** re-run the rows-per-date query above over all history (not just post-re-key) to
  size the affected set before choosing between the two fixes.

### [readiness][workouts] Q-275 — readiness is structurally blind to training load, and every incumbent treats load as primary

- **Branch:** `feat/readiness-training-load-input`
- **Plan:** none yet — this is a modelling change and wants a written plan before code
- **Added:** 2026-08-15 · from the comprehensive review §1.8 (and §2.1's incumbent comparison)
- **The mechanism, in one line.** `lib/health/readiness-payload.ts:329`:
  ```ts
  const ownActivityScore = activityResult?.preTaperScore ?? null // pre-taper → readiness composite (no double-count)
  ```
  The Activity Score's over-exertion taper is **the only place ACWR reaches a score**, and readiness
  deliberately reads the value from *before* it is applied. The stated reason (avoiding
  double-counting) would hold if load entered the composite anywhere else. It does not.
- **Verified by walking all nine contributors.** The two activity terms — `prevDayActivity` (9%) and
  `activityBalance` (6%) — are **goal-completion** scores. A 12,000-step rest day and a heavy squat
  session that hits the same goals contribute identically. There is no acute-load term, no
  recovery-time term and no session-intensity term in `READINESS_WEIGHTS`.
- **What the incumbents do.** Garmin's Training Readiness takes six inputs — sleep score, **recovery
  time**, HRV status, **acute load**, 3-night sleep history, 3-day stress history — so two of six are
  load. For an app whose primary purpose is resistance training, this is the largest modelling gap
  in the score.
- **A second, cheaper input is already collected and unused:** `oura_daily_derived.daytime_stress_scaled`
  is present on 22 of 40 post-re-key days and feeds nothing. Garmin uses a 3-day stress history as a
  named input.
- **Design questions the plan must answer** (do not skip straight to adding a weight):
  1. Load as its **own contributor**, or as a **taper on the composite** (mirroring how the Activity
     Score already handles it)? The taper shape avoids re-normalising eight existing weights.
  2. Which load signal — session tonnage, ACWR, or a recovery-time estimate? **Note Q-279: ACWR's
     evidence base is weak**, so anchoring a second user-facing behaviour to it needs justifying.
  3. Adding weight anywhere means every other weight moves. Settle **Q-500** first — it re-anchors
     the Recovery Index contributor (measured cost 0.71 pts/day, not the 2.2 Q-271 claimed) and moves
     40 of 41 days, so re-cutting the weights before it lands means doing it twice.
- **Do not ship this and Q-500/Q-272 in the same PR.** Q-273 (model versioning) exists precisely so
  changes like this stay measurable; land that first or this change is unattributable.

### [readiness][platform] Q-273 — five scoring pillars, one `model_version`, no backfill: the history is not comparable to itself

- **Branch:** `feat/score-model-versioning`
- **Plan:** none yet
- **Added:** 2026-08-15 · from the comprehensive review §1.6
- **Measured.** `body_battery_daily.model_version` over 40 post-re-key days holds **four distinct
  models**: `v1:…chg0.4:drn0.6` (9 days), `v2:…str0.2` (1), `v4:…oura-rule` (18),
  `v5:…chg0.2:…hrmax-observed` (12). No recompute or backfill ran when the model changed.
- **This is not hypothetical — it already produced a wrong conclusion that was written down as
  fact.** The 2026-08-04 Known-Issues row recorded end-of-day battery vs next-day readiness at
  **r = −0.06** and used it as evidence the model had no outcome signal. Re-running that
  correlation **split by model version** gives **r = +0.67 on v5 days alone** (n = 11) against
  −0.12 pooled. The pooled number was an artefact of mixing four models, and it stood in the
  documentation for eleven days.
- **Body Battery is the only pillar that records its model at all.** Readiness, Sleep, Activity and
  Training Load write scores with no version stamp, so the same mistake is *undetectable* for four
  of the five pillars — there is no column to split on.
- **Scope:**
  1. A `model_version` (or a shared `score_models` provenance column) on every persisted score in
     `oura_daily_derived`, written by the same code that computes the score.
  2. A backfill/recompute path so a model change can restate its own history — the admin Redecode
     pattern is the closest existing analogue.
  3. A rule, in `CLAUDE.md` alongside *One Formula, One Place*: a correlation computed across a
     model change is not evidence.
- **Do this before the calibration items (Q-500, Q-272, Q-277).** Each of those creates another
  incomparable segment otherwise, and the next review re-learns §1.6 the same way this one did.

### [readiness][body] Q-272 — Body Battery v5 drains 5× faster than it charges and ends at its daily low on 10 of 12 days

- **Branch:** `fix/body-battery-daytime-recovery`
- **Plan:** none yet · tuning notes live in [`docs/body-battery-tuning.md`](body-battery-tuning.md)
- **Added:** 2026-08-15 · from the comprehensive review §1.5
- **Measured, grouped by `model_version` over 40 production days:**

  | model_version | n | charge/day | drain/day | ratio | hit 0 | ended at daily min |
  |---|---|---|---|---|---|---|
  | `v1:…chg0.4:drn0.6` | 9 | 34.2 | 22.1 | 0.6× | 0 | 1 |
  | `v4:…chg0.4:drn0.6:str0.2` | 18 | 34.9 | 30.3 | 0.9× | 0 | 7 |
  | **`v5:…chg0.2:drn0.6:hrmax-observed`** | **12** | **10.5** | **52.4** | **5.0×** | **3** | **10** |

  Across all 40 days: `end_value == day_min` on **19**, and `day_max == anchor` on **13** — on a
  third of days the battery never rises above where it woke up.
- **Cause is known and was deliberate.** Q-57 halved `CHARGE_RATE` 0.40 → 0.20 to stop days pinning
  at the 100 ceiling. It fixed that (ceiling days 14 → 0) and overshot into the opposite failure.
- **The deferred validation says tune, not abandon.** The same review re-ran the check the
  Known-Issues row asked for: **v5 end-of-day battery → next-day readiness is r = +0.67 (n = 11)**.
  v5's *level* carries real signal; its *shape* within the day is wrong.
- **What "wrong shape" means concretely.** Garmin's Body Battery — the model this is built against —
  recovers during waking rest; that is the feature's headline behaviour, and Firstbeat drives it
  from beat-to-beat HRV rather than heart rate alone. Overnight recharge here is handled by the
  morning anchor reset rather than accumulated charge, which is a defensible difference. Near-zero
  *daytime* recovery is not.
- **Directions, in preference order:**
  1. Raise `CHARGE_RATE` back toward v4 **and** keep v5's `hrmax-observed` reserve — the ceiling
     problem v5 solved was mostly the reserve, not the charge rate. Backtest both changes
     independently against the stored HR series before picking.
  2. Feed daytime HRV into the charge term. `rr_intervals` holds ~49,900 rows and
     `daytime_stress_scaled` exists on 22 of 40 days; neither reaches the battery model today.
- **Gate:** re-run the r = +0.67 check after the change. Per Q-273, stamp the new model version or
  the before/after comparison is not interpretable.

### [readiness] ⛔ Q-500 — re-anchor the Recovery Index curve, `RECOVERY_INDEX_OPTIMAL_HOURS` 6 → 5

- **Branch:** `fix/recovery-index-anchor`
- **⛔ blocked: owner sign-off.** This changes a scoring constant and re-scores 40 days of readiness
  history. Do not implement until the owner agrees.
- **Added:** 2026-08-17 · Tuning agent · evidence:
  [`docs/reviews/2026-08-17-readiness-calibration.md`](reviews/2026-08-17-readiness-calibration.md)
- **Supersedes Q-271**, which this measurement found substantially wrong (see below).
- **The change:** one constant in `packages/shared/src/health/readiness-composite.ts` —
  `RECOVERY_INDEX_OPTIMAL_HOURS = 5` (was 6). **The estimator, smoothing window and 9% weight all
  stay as they are.**
- **Why 5.** Fitted against Oura's own `recovery_index` contributor over the 15 nights that carry both
  it and an overnight HR series (2026-06-23 → 07-07), the zero-bias anchor is **4.63 h** (LOO
  4.40–5.14) and RMSE is flat 4.5–5.25. **5** sits on that floor and keeps a small negative bias, so
  it still errs toward under-scoring.
- **Blast radius, all 41 days with stored hours:** 40 of 41 move (the other clamps at 100). Readiness
  **mean +0.67 pts, max +1.44, none lower**. Days above 50 go 12 → 19; cost against neutral 50 falls
  0.71 → 0.05 pts/day.
- **What Q-271 got wrong** (it measured 8 days and generalised): "never above 50, ever" — the
  contributor exceeds 50 on **12 of 41** days and hits **100 on 2026-07-17**; "~2.2 pts/day" — it is
  **0.71**. Its eight quoted values are exactly 2026-08-08 → 08-15. **The estimator is sound** —
  r = +0.712 vs Oura's, beating every stabilisation-style alternative tested (+0.636 best). That
  hypothesis was tested and failed; do not change the estimator.
- **Sequencing:** land **Q-273** (model versioning) first or stamp a readiness version in the same PR,
  else 40 days of history become incomparable with no marker — the Q-501 problem. Also fix the stale
  `lib/health/recovery-index.ts` paths (here + `adapter.ts:5518`); it lives in `packages/shared/src/health/`.
- **Follow-up:** re-derive the anchor on ~15 BLE-era nights. The fit is Cloud-era, and BLE overnight HR
  is ~2× noisier at the same density. If the BLE-only anchor lands well below 5, the input changed and
  that is a `devices` finding.

### [readiness][platform] Q-501 — a stored readiness score cannot be re-derived from the inputs stored beside it

- **Branch:** `fix/readiness-derived-recompute`
- **Plan:** none yet
- **Added:** 2026-08-17 · Tuning agent · found while measuring Q-500 ·
  [`docs/reviews/2026-08-17-readiness-calibration.md`](reviews/2026-08-17-readiness-calibration.md) §6
- **Measured.** Each persisted `oura_daily_derived.readiness_contributors->'recoveryIndex'->>'score'`
  against the `oura_daily_summary.recovery_index_hours` it derives from: **5 of 33 disagree** —
  2026-07-16 (0.89 h → expected 15, persisted 4), 07-20 (2.32 → 39, persisted 4), 07-21 (1.94 → 32,
  persisted 23), 07-26 (0.97 → 16, persisted 13), 08-03 (3.21 → 54, persisted 29).
- **Mechanism.** `oura_daily_summary` rows get recomputed (several updated 2026-08-13); the derived
  readiness rows built from them are not recomputed in step, so the two drift apart silently.
- **Why it matters.** `model_versions->>'readiness'` is **NULL on all 33 rows** too, so there is no way
  to tell whether a past readiness score moved because its inputs changed or because the model did —
  exactly what any calibration needs. The admin score-audit panel pairs a score with "the inputs that
  produced it", and on these five days that pairing is false. **Same class as Q-273** — consider one
  treatment for both.
- **First action:** decide whether derived rows get recomputed with their summary, or store the input
  values they actually used. The second is cheaper and self-describing; the first re-scores days
  silently and needs Q-273's version stamp first either way.

### [readiness][body] Q-276 — Readiness and Body Battery are both sold as "recovery" and share no variance

- **Branch:** `docs/reconcile-recovery-scores` (may become a UI change, not code)
- **Plan:** none yet — **this one likely needs an owner decision, not an implementation**
- **Added:** 2026-08-15 · from the comprehensive review §1.7
- **Measured** over post-re-key days:

  | pair | r | n |
  |---|---|---|
  | Readiness ↔ Body Battery **anchor** | **+0.93** | 31 |
  | Readiness ↔ Body Battery **end value** | **+0.12** | 31 |
  | Sleep ↔ Body Battery end value | −0.00 | 32 |

  The anchor correlates at +0.93 because it *is* readiness (`anchor_source = 'readiness'` on 31 of
  40 days). By end of day that has decayed to +0.12 — the intraday model discards essentially all
  the recovery information it was seeded with.
- **The problem is a presentation contract, not necessarily a bug.** Two headline numbers in the
  same app, both read by a user as "how recovered am I", sharing no variance. Either one is wrong,
  or they answer different questions (readiness = *should I train today*; battery = *how much is
  left right now*) and no surface says so.
- **Decide before building.** Three coherent outcomes, and they are mutually exclusive:
  1. **They are different questions** → the UI must label them as such, and they should probably
     never be adjacent without that framing.
  2. **They should agree** → the intraday model needs to preserve the anchor's information (which
     overlaps heavily with Q-272's charge/drain rebalance).
  3. **One is redundant** → drop it and reclaim the screen space. §2.4 argues *against* adding a
     sixth score for exactly this reason; the same logic applies to keeping a fifth.
- **Do not action this in isolation.** Q-272 changes the intraday curve and will move this
  correlation on its own; re-measure after it lands before deciding.

### [platform][devices] Q-280 — Q-214's duplicate-collapse fix reached one of three same-shaped batch upserts

- **Branch:** `fix/batch-upsert-duplicate-collapse`
- **Plan:** none needed — this is a contained change with a clear reference implementation
- **Added:** 2026-08-15 · from the comprehensive review §3.1
- **Background, confirmed from production.** `error_events` holds **5,771 hits** of `[pg 21000]`
  (cardinality violation) on `POST /api/hr-ingest` — an `ON CONFLICT DO UPDATE` whose VALUES list
  hit the same conflict row twice, which Postgres rejects **for the whole statement**, discarding
  chunks of up to 5,000 HR points. **Last occurrence 2026-08-13T00:17; Q-214's fix landed the same
  day and it has stopped.** Not a regression — this entry is the sibling sweep.
- **`upsertOuraHeartrate`'s own comment states the intent:** *"this makes the guarantee the
  function's own, so every caller gets it rather than each one remembering."* Two siblings in the
  same file have the identical shape and did not get it:

  | function (`lib/data/postgres/slices/oura.ts`) | conflict target | collapses duplicates first? |
  |---|---|---|
  | `upsertOuraHeartrate` (L258) | `(user_id, timestamp)` | ✅ fixed by Q-214 |
  | **`upsertOuraBucket` (L321)** | `(user_id, tier, bucket_start_ms)` | ❌ no — 2,000-row chunks |
  | **`upsertSetHrStats` (L818)** | `set_log_id` | ❌ no |
  | `insertRrIntervals` (L636) | — | n/a — `onConflictDoNothing` is exempt from 21000 |
  | `upsertOuraDailySummary` (L1107) | `(user_id, date)` | n/a — one row per statement |
- **`upsertOuraBucket` is the one that matters.** It is fed by the same BLE rollup that produced the
  duplicates on `oura_heartrate`, and it writes 2,000-row chunks — so one duplicated
  `(tier, bucket_start_ms)` discards 2,000 buckets. `upsertSetHrStats` is lower risk (a repeated
  `set_log_id` in one batch needs a caller bug) but is the same class and the fix is three lines.
- **Fix:** lift the `Map`-keyed-on-conflict-target collapse out of `upsertOuraHeartrate` into a small
  shared helper and use it in all three, so the next batch upsert added to this file inherits it
  rather than remembering it. Last-value-wins, matching the `excluded.*` semantics the ON CONFLICT
  arms already use.
- **Test:** the existing `hr-ingest-poison-pill.test.ts` is the pattern — a batch containing a
  deliberate duplicate must persist, not 500.

### [activity] Q-277 — the Activity Score still occupies a quarter of its range, after v2 fixed the mechanism Q-137 blamed

- **Branch:** `fix/activity-score-discrimination`
- **Plan:** none yet
- **Added:** 2026-08-15 · from the comprehensive review §1.2
- **Measured** over post-re-key production days: **n = 19, range 66 – 91, mean 76.1, sd 5.9, 10
  distinct values.** For comparison on the same days: Readiness sd 13.4 (19 distinct over 29–87),
  Sleep sd 11.7 (16 distinct over 31–97).
- **Why this is not just a restatement of Q-137.** Q-137 diagnosed the Activity Score as
  "effectively a step counter: 57 of 100 weight is constant". Activity Score **v2** fixed that
  mechanism — `computeActivityScore` now carries real strength lanes (movement ≈ 55, strength ≈ 45,
  `W_STRENGTH_FREQ = 25`) and an ACWR over-exertion taper. **The mechanism changed and the outcome
  did not.** Q-137 should be re-scoped or closed in favour of this; do not work both.
- **Leading hypothesis, untested:** the score renormalises over whichever components have data
  (`totalWeight` is summed from present parts only). With `steps`, `activeCalories`, `zoneMinutes`
  and `moveHours` frequently null — the score exists on only **19 of 40** days at all, see Q-278 —
  the strength lanes carry most days alone, and they saturate: `STRENGTH_FREQ_CURVE` reaches 100 at
  1.0 and stays there through 1.5.
- **First action:** for each of the 19 scored days, dump the per-component `parts` array
  (`key`, `weight`, `sub`) and count how often each lane is present and what its realised range is.
  That distinguishes "renormalisation collapses the score onto two saturating lanes" from "the
  owner's activity genuinely varies this little".
- **Sequencing:** Q-278 (coverage) shares the same root and should be investigated in the same pass.

### [platform][readiness] Q-278 — a score that could not be computed is rendered identically to a score of 76

- **Branch:** `feat/score-coverage-surfacing`
- **Plan:** none yet
- **Added:** 2026-08-15 · from the comprehensive review §1.1
- **Measured** over 40 post-re-key days (`claude_ro.oura_daily_derived`):

  | Pillar | days with a value | coverage |
  |---|---|---|
  | Sleep Score | 32 / 40 | 80% |
  | Readiness | 31 / 40 | 78% |
  | Daytime stress | 22 / 40 | 55% |
  | **Activity Score** | **19 / 40** | **48%** |
  | Resilience level | 13 / 40 | 33% |
- **The gap.** `scoreAvailability` exists and is good — but it covers **readiness only**, and it
  reports which *inputs* were available for a score that was computed. It does not cover the case
  where no score exists for the day at all, and the other four pillars have no equivalent.
- **What a user sees today** on a day with no activity score: not "no data", but whatever the trend
  chart and card do with a null — typically a gap, a carried-forward value, or nothing, depending on
  the surface. There is no single answer because there is no single contract.
- **Scope:**
  1. One shared "this pillar has no value today, and here is why" representation, covering all five —
     generalise `ScoreAvailability` rather than adding four parallel versions.
  2. Every score-rendering surface consumes it. This is a sibling-surface sweep: a fix on the
     Readiness card alone is a half-fix.
  3. Distinguish **absent** (never computed) from **provisional** (computed from a cold baseline) —
     they read very differently to a user and the composite already tracks the second.
- **Related:** the always-null columns (`training_load_ots`, `recovery_index_hours`,
  `active_calories_est`, …) are Q-7b / Q-270 / Q-184 and are **not** in scope here; this entry is
  about the middle band that has a producer and fires on half the days.

### [workouts][readiness] Q-279 — ACWR drives two user-facing behaviours on evidence that has substantially collapsed

- **Branch:** `feat/acwr-ewma-and-copy`
- **Plan:** none yet · **has an owner-decision component** (the copy change)
- **Added:** 2026-08-15 · from the comprehensive review §2.2
- **Where it bites.** `computeVolumeAcwr` (`@trainingai/shared/ai-periodization/acwr`) implements the
  naive 7:28 acute:chronic ratio and drives: the **early-deload card**
  (`EARLY_DELOAD_ACWR_MIN = 1.2`, `lib/health/readiness-payload.ts`) and the **Activity Score
  over-exertion taper** (`ACWR_TAPER_START = 1.5`).
- **The evidence problem.** Since 2020 the sports-science literature has moved hard against the
  naive ratio: the acute window is *contained within* the chronic window, so the two are
  mathematically coupled and the ratio generates spurious correlations; when outliers are removed
  and load is treated as continuous the ACWR–injury relationship disappears; the foundational
  studies were underpowered. It is now cited as a standard example of a high-profile result that
  distorted its field. Sources in the review doc §2.2.
- **Two separable pieces of work, and the cheap one is the copy:**
  1. **Immediate, low-risk:** wherever the early-deload card asserts or implies injury risk, state
     what actually tripped (*"your last 7 days are 1.4× your 28-day average, and your readiness is
     under 45"*) rather than a causal claim the literature no longer supports. Q-173 already moved
     this card toward naming its numbers; this finishes that.
  2. **Larger:** switch to the uncoupled EWMA formulation, which is a contained change to one shared
     function with an existing test suite. It does not rescue ACWR's predictive validity, but it
     removes the mathematical coupling, which is the specific criticism that is not in dispute.
- **Do not simply delete it.** Both surfaces it drives are useful behaviours; the objection is to
  the causal claim and the coupling, not to noticing that this week is much heavier than the last
  month. Interacts with **Q-275** — if load enters readiness, decide there whether ACWR is the
  signal it enters as.

### [app-shell][readiness] Q-281 — audit every surface that renders a score bare

- **Branch:** `feat/score-contributor-presentation`
- **Plan:** none yet
- **Added:** 2026-08-15 · from the comprehensive review §2.3
- **The convention this is measured against.** No incumbent shows a recovery number alone: Garmin
  pairs Training Readiness with its six contributing factors and a one-line instruction; Whoop leads
  with the recommended action; Oura shows contributors by default. A bare 0–100 with no contributors,
  no trend and no "so what" is the one presentation none of them ships.
- **This is an omission, not a missing capability.** The machinery already exists and is good:
  `readinessCompositeContributors` (per-factor sub-scores *and* their `provisional` flag),
  the whole `packages/shared/src/health/score-audit/` layer, and `scoreBand()` for the paired
  label/icon. Some surfaces use it; the question is which do not.
- **Scope:** enumerate every surface that renders any of the five pillar scores — cards, detail
  screens, trend charts, the day-in-review, the AI Coach's prose — and for each record whether it
  shows (a) contributors, (b) trend, (c) an action. Then fix the ones failing the repo's own
  colour-only-state rule as a first pass, since `scoreBand()` colour without `scoreBand()` label is
  already a `CLAUDE.md` violation and is the cheapest subset.
- **Sequencing:** this is presentation over numbers that Q-500/Q-272/Q-275/Q-277 are all about to
  change. Do the **audit** now (it is cheap and its output is durable); hold the **UI work** until
  the model changes settle, or it gets done twice.

### [platform][app-shell] Q-282 — no automated accessibility check exists anywhere in CI

- **Branch:** `feat/ci-accessibility-scan`
- **Plan:** none yet
- **Added:** 2026-08-15 · from the comprehensive review §5
- **The gap, stated precisely.** The owner-directed testing cluster (Q-249 E2E · Q-250 emulator ·
  Q-251 staging · Q-252 error tracking · Q-253 device farm · Q-254 unverified-row sweep) is
  well-scoped and correctly prioritised, and this entry does **not** re-raise any of it. Standard
  Android QA practice covers one thing none of the six touches: **automated accessibility scanning.**
- **Why it is the right gap to close next.** It targets exactly the class this project keeps
  rediscovering by hand and cannot currently measure. The 2026-08-08 mobile-UI sweep found 7×7 px
  tap targets by manual inspection, and its **contrast finding could not be measured at all** — it
  is recorded in `projectOverview.md` as "contrast that could NOT be measured". Accessibility
  Scanner / Espresso accessibility checks catch missing labels, undersized touch targets and
  insufficient contrast automatically.
- **Dependency, and why this is not a duplicate of Q-250.** A scanner needs a running app, so this
  rides on the emulator job Q-250 introduces — it is one extra step in that job, not a second
  harness. File it after Q-250 in any implementation ordering.
- **Scope:** Espresso accessibility checks enabled in the emulator run, failing on the touch-target
  and contrast rules only at first (the label rules will produce a large initial backlog). Use the
  **shrink-only baseline** pattern the repo already uses for `check-component-size.js` and
  `check-hex-literals.js`, so the existing violations are recorded rather than blocking, and the
  count can only go down.

### [app-shell] Q-350 — eight `role="radiogroup"`s in the app, none with arrow-key navigation

- **Branch:** `fix/radiogroup-keyboard-nav`
- **Plan:** none needed
- **Added:** 2026-08-17 · found implementing Q-261, which added five of the eight
- **The gap.** The ARIA authoring practices for `radiogroup` expect arrow keys to move between
  options with a roving `tabindex`, so the group is one tab stop rather than N. None of the eight
  sites does this — `Tab` walks every option individually and arrow keys do nothing.
  - Pre-existing: `components/workout/deload-toggle.tsx`,
    `components/workout/session-duration-picker.tsx`, `components/more/home-widgets-section.tsx`.
  - Added by Q-261: `components/profile/goal-targets-section.tsx`,
    `components/profile/required-info-section.tsx` (×2), `components/profile/edit-profile-sheet.tsx` (×2).
- **Q-261 matched the existing three deliberately rather than fixing them** — a roving tabindex for
  five sites inside a labelling fix would have been an unrequested refactor, and five sites with
  keyboard nav beside three without is worse than eight consistent ones.
- **Genuinely low priority**: the canonical runtime is a touch-only APK with no keyboard, and
  TalkBack navigates by swipe, so the affected population on the supported target is near zero
  today. It sits next to Q-282 because an accessibility scanner is what will force it.
- **Do it as one sweep with a shared `components/ui/` primitive** taking
  `{ options, value, onChange, label }`, not eight hand-rolled copies — eight is well past the
  "any pattern at ≥2 sites gets extracted" rule.

### [platform] Q-283 — ~11 MB of indexes have never served a scan, on a DB where index bloat already caused an incident

- **Branch:** `chore/drop-unused-indexes`
- **Plan:** none needed
- **Added:** 2026-08-15 · from the comprehensive review §4
- **Measured** (`pg_stat_user_indexes WHERE idx_scan = 0`, largest first):

  | table | index | size |
  |---|---|---|
  | `oura_heartrate` | `oura_heartrate_user_updated` | **5.7 MB** |
  | `oura_heartrate` | `oura_heartrate_pkey` | 4.3 MB |
  | `error_events` | `error_events_pkey` | 576 kB |
  | `set_logs` | `set_logs_exercise_log_id_set_number_key` | 80 kB |
  | `set_hr_stats` | `set_hr_stats_user_exercise_idx` | 72 kB |
  | `ai_call_log` | `ai_call_log_fingerprint_idx` | 56 kB |
- **Read the numbers carefully before dropping anything.** `idx_scan = 0` counts since the last
  stats reset, **not since creation** — and a `REINDEX` resets it. Primary keys and unique
  constraints (`*_pkey`, `set_logs_exercise_log_id_set_number_key`) enforce correctness and must
  **not** be dropped regardless of scan count; they are listed only so the next reader does not
  re-derive that.
- **The real candidate is `oura_heartrate_user_updated` (5.7 MB, zero scans).** It was added for the
  Track-B timeseries sync delta. Check whether that query path still exists and still uses it before
  dropping — Q-180 recently decided to keep the timeseries delta, so this may be a genuinely-used
  index whose stats were reset by the 2026-08-13 REINDEX work.
- **Context, not scope:** `error_events` sits at **49 MB for 13,203 rows** (~3.8 KB/row) at
  steady state under a 30-day prune, of which 5,771 rows were the single now-fixed `[pg 21000]`
  fault. Worth a glance at what is stored per row. `oura_raw_samples` at **341 MB** is the
  deliberate archival policy and is explicitly **out of scope** here (see
  `docs/db-volume-cleanup-handover.md`).

### [activity][devices] Q-284 — decide the fate of the Oura activity blend, which now fires on 1 day in 40

- **Branch:** `chore/retire-oura-activity-blend`
- **Plan:** none needed
- **Added:** 2026-08-15 · from the comprehensive review (a finding that was **softened** during
  verification — see below)
- **What it is.** `blendActivityScore` (`lib/activity/blend-activity.ts`) exists to credit gym
  training that Oura's Cloud activity score under-counted. It returns early unless
  `ouraActivityScore != null`, and `lib/health/readiness-payload.ts:347` only calls it when
  `ouraToday?.activityScore != null`, falling through to our own score otherwise.
- **Measured, and this corrects the first reading.** The initial finding was "dead code — the Cloud
  is gone, so `oura_daily.activity_score` is always null". **That is not what production says:**
  `count(activity_score)` over post-re-key days is **1 of 40** (16 of 55 across all history). So the
  branch is **nearly inert, not dead**, and it is filed on those terms rather than as a deletion.
- **Why it is still worth an entry.** A branch that fires on one day in forty is a branch nobody can
  reason about and no test exercises meaningfully. Its constants (`TRAIN_CREDIT_BASE = 6`,
  `TRAIN_CREDIT_VOL = 8`, `MAX_ADJ = 14`) are described in their own comment as *"heuristic and
  intentionally bounded; tune against real data over time"* — and there is now no path by which
  real data will accrue, because the Cloud integration was removed on 2026-08-13.
- **Decide, in one small PR:** either (a) retire it and let our own Activity Score stand alone —
  the fallback branch already handles 39 of 40 days and folds in training credit itself — or
  (b) keep it and document why one day in forty takes a different code path. **Check first whether
  that single non-null day is real Cloud data or a stray write**; if it is a stray, (a) is
  unambiguous.
- **Low priority.** No user-visible fault, no data loss. This is dead-weight removal, and it should
  not jump ahead of anything in the scoring cluster above.

### [sleep][devices][platform] Q-225 — a sleep session can get stuck on a stale, narrower window that a fresh rollup would compute correctly, with no self-heal

- **Added:** 2026-08-13/14 · owner reported the app's displayed bedtime for the previous night
  (1:15am) looked way too late. Not the anchor-lag bug (Q-71/Q-139, ≤3 min correction) — this is a
  2h35min gap between the stored value and what the ring's real data supports, so a different
  investigation.
- **Confirmed by full local reproduction, not inference.** Pulled all of that night's real raw
  samples (11,208 rows, 9 tags) and clock anchors from production via the read-only endpoint,
  loaded them into the local dev DB under a throwaway test user, and ran
  `repo.aggregateOuraRawSamples(...)` — the actual shipped function, unmodified — directly against
  them, twice (once with `fullHistory: true` + `debugDate`, once as a bare incremental call). **Both
  runs produced the same, correct result: sleep 22:40pm→8:05am (8.5h), onset 10 min, with the
  neural stager correctly flagging a brief HR-up/movement epoch around 00:50am as `awake`** — i.e.
  the owner's account ("asleep, woke here and there from overheating") is exactly what the current
  algorithm computes from the real data. **What's stored in production does not match this**: the
  live row (`oura_id: ble:33100097`, `sleep_start` 1:15am, 6h05m) is stale/wrong by every check run
  against it — no >2h gap in the raw `sleep_acm_period`/`sleep_temp` stream (biggest gap 17 min), no
  `bedtime_period` (0x76) event to override the clustering, no persisted-`decoded` staleness (every
  row for the night decodes fresh from `body_hex`, as expected post-Lever-1).
- **🔻 The pool-contention lead is contradicted by measurement (2026-08-14). Do not start from it.**
  Three facts, all from the read-only endpoint against live production:
  1. **A rollup HAS re-run since, and reproduced the same wrong window.** Both 08-13 rows and the
     08-14 row share `updated_at = 2026-08-14T11:13:03.720Z` to the millisecond — one range rewrite —
     and `ble:33100097` still reads `sleep_start` 15:15 UTC / 6.08 h. The entry's "evidently none has
     produced the correct window since" is false.
  2. **The raw data is complete right now.** A bounded query over that night returns a dense stream
     from **13:15 UTC** (23:15 AEST) — tag 0x60 alone has 1,036 rows before the stored start. So the
     frames a correct window needs are present and were present for that rewrite.
  3. **It has not self-healed** (unlike Q-228's and Q-229's symptoms, both of which had).
  Together those make it **deterministic given the current data**, not a one-off partial read. A race
  that has stopped racing cannot keep producing the same answer from complete data.
- **Leading hypothesis now: an asymmetric truncation guard. NOT CONFIRMED — see below.**
  `aggregateOuraRawSamples` reads an incremental window (`rollupCutoffDs`), and a night whose early
  frames fall outside it is *truncated, not short*. The daily-summary fold refuses those:
  `summaryFloorDate` (`adapter.ts` ~5824) discards any night within 2 days of the cutoff, and the
  3-day margin on `incrementalFloorDs` exists expressly to give it room — its own comment says so.
  **The `sleep_sessions` write (~5523) has no equivalent filter**, and it deletes by wake-day before
  inserting, so a clipped pass replaces a previously-correct row rather than merely failing to
  improve it. That fits every observation: front-clipped (start late, wake time right), deterministic
  on re-run, and repaired only by `fullHistory` — which has no cutoff and therefore no filter.
- **⚠️ Attempted and withdrawn on 2026-08-14: a one-line guard mirroring `summaryFloorDate`, plus a
  four-case rollup test. Both reverted, unshipped, because the test never discriminated.** Three
  fixture generations were tried and all four cases passed with the guard removed:
  (a) a night seeded with a `bedtime_period` (0x76/118) event — that event carries an explicit
  `bedtime_start_ds` and is stamped at the night's *end*, so it survives any narrowing and the night
  cannot exhibit the bug at all; **the owner's night has no such event**, which is why clustering is
  what gets cut;
  (b) IBI-only samples — no sleep row is produced at all, so nothing to protect;
  (c) `sleep_acm_period` (0x72) + `sleep_temp` (0x75) + IBI, which is what the clusterer actually
  reads (`adapter.ts` ~5064) — a row is produced, but a narrowed run still does not clip it.
  So the mechanism above remains **unreproduced**, and shipping a sleep-pipeline write change that
  cannot be shown to fix anything was judged worse than the bug. **The next session's first job is a
  fixture that fails without the guard** — most likely by driving the exported production samples for
  that night through a narrowed (`sinceDs`) call rather than a synthetic night, since the synthetic
  ones do not clip.
- **Owner-visible state is unchanged:** the 08-12 night still displays 1:15am. A `fullHistory`
  Redecode still repairs it (confirmed locally in the original investigation) and remains the only
  known repair.
- **Immediate fix, verified working:** an admin **Redecode** (`fullHistory: true`) for this user
  would delete the stale row (keyed by wake-day, not `oura_id`/`sleep_start`, so the key mismatch
  between the old narrow window and the new wide one is not a problem) and insert the correct one —
  confirmed by literally running that code path locally. This is the same Redecode the Q-71 backlog
  entry already has queued for the historical-sleep rewrite; the two can likely be done together
  once Q-71 lands, but this row (and possibly other recent nights hit during the same pool-exhaustion
  bursts) may need it sooner, independent of the anchor-offset fix.
- **Not yet done:** checking whether other recent nights (not just this one) also landed a
  stale/narrow window during the same 2026-08-12/13 error bursts — the local-repro harness this
  entry built (raw-sample + anchor CSV export → local DB load → direct `aggregateOuraRawSamples`
  call) is reusable for that sweep without re-deriving the method; confirming the pool-contention
  causal link against Railway's own logs (same "not yet done" item Q-107 already carries); and
  deciding whether the rollup needs a structural fix (e.g., don't write a sleep row from a partial
  read, or re-validate/re-run automatically when new data for an already-written night's wake-day
  arrives) rather than relying on someone noticing and running Redecode by hand.

> **⚑ Q-232 … Q-244 are one cluster** — the 2026-08-14 UI/flow/IA + caching review, requested by the
> owner ("a good review on the ui and flow/location mainly … alongside that have a look at caching
> and cache busting"). Full evidence, the navigation map and the proposed target structure:
> [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](reviews/2026-08-14-app-ui-flow-ia-review.md).
> **Q-240 and Q-241 are done (2026-08-14, v1.307.1)** — shipped together, as their entries said to,
> because they shared a root: the goal caches were never invalidated on write *and* the goals
> themselves lived in two copies that could not agree. Entries removed. The sweep found the
> invalidation missing on two Coach surfaces the entry did not name, and exposed a third bug —
> clearing a goal never worked, in the editor and in the route — which had to be fixed in the same
> PR because making the server authoritative is what would have made it visible. Journal:
> [`docs/overview/overview/history-2026-08-12.md`](overview/history-2026-08-12.md).
> **Q-238 is done (2026-08-14, v1.307.2)** — resolved by deleting the mechanism, not by building the
> customiser. Git history the entry did not carry decided it: the UI existed (`0376da61`, toggles in
> More → Settings), was removed on purpose the next day (`4e9ecffd`), and the orphaned file was swept
> as dead on 2026-06-28 (`73d6d0c3`) while the helpers and every reader stayed. Deleting the readers
> too also fixes a hidden half — a card hidden during that one-day window could never be un-hidden.
> Journal:
> [`docs/overview/overview/history-2026-08-12.md`](overview/history-2026-08-12.md).
> **Q-242 is done (2026-08-15, v1.307.3)** — and it was not the one-line item it was filed as. The
> whole-repo scan its own text asked for found `day-log:` at **three** sites (not two) and two more
> divergent keys, one of them with **unequal values**: `hr-profile` was `HR_PROFILE_TTL` (6 h) at
> seven sites and a raw `TTL_MEDIUM` (30 min) at the eighth. Three divergences under a rule that has
> a constants file built for it is the finding, so the scan shipped as
> `scripts/check-cache-ttl-divergence.js` in the Custom Rules job (34 steps now). Journal:
> [`docs/overview/overview/history-2026-08-15.md`](overview/history-2026-08-15.md).
> **Q-236 is done (2026-08-15, no version bump)** — `/overview`, `components/overview-screen.tsx`
> and the now-orphaned `components/readiness-card.tsx` are gone, along with the `'overview'`
> background palette the entry did not mention (`dynamic-background.tsx`, the `ScreenPaletteKey`
> union, and both light and dark `--screen-palette-overview` blocks). **The three `/sheet/[id]/*`
> shims were NOT deleted** — the owner decided to keep them on 2026-08-10 (Q-136), and that decision
> is theirs to revisit; the overview shim is repointed at `/` instead of a route that no longer
> exists. Why the shims' stated rationale has expired is filed as **Q-255**. Journal:
> [`docs/overview/overview/history-2026-08-15.md`](overview/history-2026-08-15.md).
> **Q-244 is done (2026-08-15, no version bump)** — `scripts/check-hex-literals.js` in the Custom
> Rules job (35 steps now): a **per-file** shrink-only baseline, not a single total, because a total
> lets one file grow while another shrinks — which is what "the trend looks fine" looked like on
> 2026-08-09. A row for a file that reaches zero must be deleted, or the baseline decays into an
> allowlist. The existing 471 are **not** swept, per the entry. Mutation-verified three ways.
> CLAUDE.md's count is corrected to 471 and now records the reversal itself. Journal:
> [`docs/overview/overview/history-2026-08-15.md`](overview/history-2026-08-15.md).
> **Q-233 is done (2026-08-15, v1.309.0)** — `/more/devices`, step 1 of the plan's build order. Three
> things the plan did not anticipate: all four cards already render their own heading (so the wrapper
> section headers were a heading above a heading and are gone), `BackgroundLocationCard` returns null
> off-device (so a "Permissions" heading sat above nothing), and the size ratchet fired at 850 lines
> — fixed by extracting `components/more/more-row.tsx` rather than raising the number, which is the
> grouped-list primitive the rest of the plan needs. Journal:
> [`docs/overview/overview/history-2026-08-15.md`](overview/history-2026-08-15.md).
> **Q-232 step 2 of 3 shipped (2026-08-15, v1.310.0)** — `/more/data` and `/more/about`, splitting
> the block where Sync now / Restore from cloud / Export my data sat under an *About* heading beside
> the version string. `profile-tab.tsx` is **697** lines, down from 845 at the start of the cluster,
> and `components/more/sub-screen.tsx` now owns the navless takeover shell (extracted at its second
> copy). **Settings is deliberately step 3 rather than part of this one** — it is an independent
> block, and About/Data had to split from each other in one commit because they were one block.
> Journal:
> [`docs/overview/overview/history-2026-08-12.md`](overview/history-2026-08-12.md).
> **Q-232 step 3 shipped, and the umbrella's own restructure is done (2026-08-15, v1.311.0)** —
> `/more/settings`. `components/more/profile-tab.tsx` is **465 lines**, from 845, and **its
> `check-component-size.js` BASELINE row is deleted** (5 hotspots left) — no artificial split, four
> screens carved along the seams the IA already implied. Journal:
> [`docs/overview/overview/history-2026-08-15.md`](overview/history-2026-08-15.md).
> **What remains under Q-232 is the rows the other items own** — Program (Q-235), Admin (Q-234) —
> plus the optional `/more/achievements` + `/more/goals` split, which is now cosmetic rather than
> load-bearing since the file is under the limit. Q-234 is unblocked: `/more/settings` exists.
> **Q-235 and Q-256 are done (2026-08-15, v1.312.0)** — `/program`, reachable from the Workout tab's
> header and More → Program; More has two tabs left. **Q-256 was fixed by changing the shape, not the
> string**: the new-program flag is a prop resolved from `/program`'s `searchParams`, because a param
> read from `window.location.search` can be dropped by anything in between without a call site
> changing. The Q-223 regression test was **rewritten rather than deleted** — its specifics were gone
> but its invariant survives — and one of its assertions **did not discriminate** until mutation
> testing caught it (it checked that `searchParams`/`URLSearchParams` *appear*, which a mutation
> setting the suffix to `''` passed while dropping every param); it now calls the route and reads the
> `NEXT_REDIRECT` digest. Journal:
> [`docs/overview/overview/history-2026-08-15.md`](overview/history-2026-08-15.md).
> **Q-234 is done (2026-08-15, v1.313.0)** — `/admin` keeps user administration (9 tabs → 5,
> 476 → 395 lines); diagnostics are **Settings → Developer**, with the three device consoles as rows
> rather than buttons inside a tab inside a console. `exercises`/`activities` stayed on `/admin`
> deliberately — the plan names neither, and they are content administration, not device
> diagnostics. Both sides of the admin gate were exercised by flipping the local user's `is_admin`
> and re-logging in (note `isAdminUser(id, flag)` returns the **JWT** flag when it is a boolean, so
> a DB flip alone changes nothing). Journal:
> [`docs/overview/overview/history-2026-08-12.md`](overview/history-2026-08-12.md).
> **Q-237 is done (2026-08-15, v1.314.0)** — Water and Saved Meals moved to a row directly under the
> macro ring, above every meal card, so their position no longer depends on how many meals the day
> has. **End of Day deliberately stayed put** (Q-112 owns merging it with Home's Day in Review) and
> **"Log Food" was not added** — the plan's row names it, but no global log-food action exists and
> creating one needs a meal-type rule this placement change should not invent; filed as **Q-257**.
> Journal:
> [`docs/overview/overview/history-2026-08-15.md`](overview/history-2026-08-15.md).
> **That closes the 2026-08-14 review cluster's implementation items.** Q-243 (the remaining caching
> item) is still open, and Q-239 stays until Q-234's promotion is confirmed on device. The five IA
> items (Q-232 … Q-237) share one target structure and **must not be worked one-at-a-time from
> these entries**: Q-232 is the umbrella and needs a written plan covering the whole set, or the app
> ends up half-reorganised in two incompatible directions.

> **⚑ Q-249 … Q-254 are one cluster — agent testing capability, owner-directed 2026-08-14, and the
> owner asked for it "before the github migration" (Q-49).** They are placed here, above the IA
> cluster, deliberately: **Q-249 is one PR and de-risks everything below it**, including Q-232's
> restructure, which is the largest UI refactor in the queue and currently has no way to prove it
> did not break a screen. Move the cluster down if you disagree — but do not let Q-49 land first.
> **Why the Q-49 deadline is real and not just a preference:** that migration's owner decisions
> (2026-08-10) commit to *"CI stays offline and holds no credential"*. Q-252 wants a device-farm API
> key in CI and Q-251 an error-tracking DSN. Those are a straightforward conversation **now**, on a
> private repo, and a much more awkward one after the cut. Decide the testing surface before the
> repo becomes public, not after.
>
> **The measurement that produced this cluster** (2026-08-14, in the review session that filed
> Q-232…Q-244): `projectOverview.md` carries **81 rows** marked "NOT verified on device", and they
> are not one gate. Bucketed by what each actually needs — **~25** need nothing but somebody running
> the app in a browser, **17** need an Android runtime (local SQLite, offline, notifications, back
> button, deep links, PiP), **~10** need real data, **25** need real hardware, ~4 are perceived
> performance. The largest bucket needs **no new access at all**. Full working in
> [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](reviews/2026-08-14-app-ui-flow-ia-review.md)
> §7. **The per-row bucketing was done from headings, not by reading each row** — re-check a row
> before claiming a capability closes it.

### [nutrition][app-shell] Q-309 — a touch tap on Nutrition's action row does not activate the button; a synthesised click does

- **Branch:** `fix/nutrition-tap-swallowed-by-date-swipe`
- **Added:** 2026-08-16 · found by the Q-297 water write-path E2E spec, which could not open the
  water sheet by tapping.
- **Measured, and the two cases differ cleanly.** The E2E context runs
  `devices['Galaxy S9+']` (`hasTouch`, `isMobile`), so Playwright's `.click()` dispatches a real
  **touch** sequence. That sequence **never** opens the sheet — 20 s of waiting, and the failure
  screenshot shows the plain Nutrition screen with the Water button visible and untouched. A
  `dispatchEvent('click')`, which skips the pointer sequence entirely and invokes the React handler,
  opens it **immediately**. Same element, same selector, same run.
- **The obvious suspect is the date-swipe binding.** `app/nutrition/nutrition-content.tsx:513`
  `useDrag(..., { axis: 'x', filterTaps: true, pointer: { touch: true } })`, spread onto the
  scrolling container at line 575 that contains the whole action row. `filterTaps: true` is meant to
  let a tap through; something about a zero-movement synthetic tap is not clearing it.
- **This is a known class in this repo, which is why it is worth taking seriously.** CLAUDE.md
  records pull-to-sync swallowing normal scrolling **twice** (sessions 150, 152) before a
  movement-threshold lock was added, and the standing rule is that custom gesture handlers must
  direction-lock before capturing. `components/pull-to-sync.tsx` is also mounted on this screen and
  has not been ruled out.
- **⚠️ What is NOT established: whether a human finger on the S25 reproduces this.** A synthetic
  touch sequence has zero movement and near-zero duration, which is not identical to a real thumb.
  It is entirely possible the harness is the anomaly. **Do not ship a gesture change off this
  entry alone** — reproduce on the device first, or with a slower/jittered synthetic tap, and say
  which. If it does reproduce on device it is a live bug on the owner's most-used write path.
- **Whatever the verdict, the spec should stop needing `dispatchEvent`.** `e2e/water-log-write-path.spec.ts`
  carries the workaround with this number in a comment; a spec that cannot tap the way a user taps is
  testing something adjacent to the product.
- **Check the sibling surfaces in the same pass** — Health and the day-detail screen carry the same
  `useDrag` date-swipe pattern (`app/health/day/day-detail-content.tsx` copies it deliberately), so
  if this is real it is not one screen.

### [platform] Q-297 — finish the E2E specs Q-249's first PR deliberately left, and cover more than one tab per screen

- **Branch:** `feat/e2e-specs-round-2`
- **Added:** 2026-08-15 · follow-up to Q-249, which shipped the harness
  (`playwright.config.ts`, `e2e/`, the `E2E` CI job) plus one spec. Read
  [`e2e/README.md`](../e2e/README.md) first — it records what a green run does and does not prove,
  and every limitation below was measured, not guessed.
- **DONE 2026-08-15 for Health — the multi-panel coverage gap.** `e2e/health-tabs-instant-paint.spec.ts`
  drives `?tab=training|body|progress` and asserts the requested tab is the *selected* one before
  checking, so the panel under test is actually in the viewport. Verified by the mutation Q-249's
  spec could not catch: forcing Health's Body-tile skeletons to never clear now fails — and fails
  **only** the Body case, leaving Training and Progress green.
- **Still open for every other tabbed screen.** The `expectNoSkeleton` viewport rule is unchanged and
  correct (an inactive `SwipeCarousel` panel is mounted but unseen, and its data loads on swipe by
  design), so any single-URL spec still covers one tab. Nutrition's date swipe and any other tabbed
  surface need the same treatment: drive the tab, assert which panel is selected, then check.
- **The specs Q-249 scoped and this did not ship:** log a set, a food entry and a water entry and
  assert each appears without a reload; change a goal and assert the Health tab reflects it (the
  Q-240 regression, four lines of E2E for a bug this repo has already had once).
- **A limitation worth closing separately:** the 20 s skeleton budget cannot tell "seeds instantly
  from cache" from "seeds in 8 s off the network", because the harness runs `pnpm dev` and route
  handlers compile on first call. It catches a card that *never* seeds, not a regression from
  instant to sluggish. Measuring the second would need a warmed server and a much tighter budget.
- **The E2E job is NOT a required status check** and should stay that way until it has a track
  record — branch protection requires Lint, Tests, Build, Custom Rules and Migration Check. Promote
  it once it has run green across a few weeks without flaking, and say so in the PR that does.
- **Do not chase a skeleton into a "fix" without checking which panel it is on.** The Q-249 session
  found the Injuries card stuck in a loading state, traced it to `injuries` being fetched only by
  the Body tab's group, and changed `health-content.tsx` — then reverted it on discovering the card
  is off-screen in an inactive carousel panel and loads on swipe, exactly as designed. The milder
  real behaviour is that arriving on Body or Progress for the first time shows a brief skeleton,
  because nothing has written the cache the mount seed reads. That may be worth fixing; it is not
  the bug it first looked like.

### [platform][devices] Q-250 — an Android emulator job in CI, to close the 17 rows that need an Android runtime and nothing else

> **⛔ THE JOB IS DISABLED AND THE ASSERTION NEVER PASSED — read this before anything below.**
> Corrected 2026-08-17, hours after the note that follows. That note says the local-SQLite half is
> in. **It is not.** The job was merged, ran for the first time on a real runner, and failed — and
> it could never have succeeded:
>
> > **`getLocalStore(userId)` requires a signed-in user** (`lib/local-store/index.ts`). The app
> > launches to the sign-in screen, so the local SQLite database is never created, and
> > `scripts/ci/emulator-local-db-smoke.sh` polls 90 seconds for a file that cannot appear.
>
> **What *is* proven, on a real runner, and should not be rebuilt:** the app builds; the server
> starts (after fixing a readiness probe that hit `/api/version`, the one route that makes an
> outbound GitHub call before responding); the APK assembles against `http://10.0.2.2:3000` with a
> fail-closed guard so it can never be built pointed at production; KVM enables; the emulator boots.
> Steps 1–14 of 15 pass. Only the assertion fails.
>
> **The job is now `workflow_dispatch`-only** (`.github/workflows/android-emulator.yml`), not
> deleted. It failed every run while enabled, and a permanently-red check is worse than no check —
> it trains everyone to ignore the signal, so the next red, which would be a genuine migration
> failure, goes unread.
>
> **To finish it: add Maestro.** A declarative YAML flow that launches the app, signs in, and waits
> for the app shell; the existing `PRAGMA user_version` assertion then runs unchanged. Two things
> make this cheaper than it sounds: the job already runs a **seeded local Postgres containing
> `test@local.dev` / `testpass123`**, so no credentials or secrets are needed — Maestro just types
> into the form — and the job is non-required, so iteration costs nothing but time. Restore the
> `pull_request` trigger in the same PR. Expect several CI rounds: **none of this is runnable in a
> Claude session** (no `/dev/kvm`, Firecracker microVM), so a UI flow can only be iterated by
> pushing.
>
> Once sign-in works, the rest of this entry's deferred scope becomes reachable for the first time:
> offline cold start, the service-worker `/api/` passthrough, deep-link cold launch, the hardware
> back-button guard, local notifications, and PiP.
>
> ---
>
> **The 2026-08-17 note below is superseded in its headline claim and accurate in its detail.** Kept
> because its reasoning about the production-URL trap is what the next session most needs.
>
> **PARTIALLY SHIPPED 2026-08-17 — the local-SQLite half is in.**
> `.github/workflows/android-emulator.yml` + `scripts/ci/emulator-local-db-smoke.sh`: boots an
> emulator, installs the debug APK, and asserts `PRAGMA user_version` read **off the device**
> against the max `toVersion` in `lib/sqlite/migrations.ts` — plus that `reconcileSchema()` did not
> have to repair anything, since a repaired schema reaches the right version while the migration
> that should have produced it is quietly broken. That is the #27/#85 shape, and it is the line
> this entry called the most valuable.
>
> **The entry's suggested shape was wrong in one load-bearing way, found while building it.** It
> said "install the debug APK the existing job already builds" — but the APK is a WebView loading
> `capacitor.config.ts`'s `server.url`, which is hardcoded to **production**. Installing the
> existing APK would have pointed CI write traffic at the real database, and connection-pool
> exhaustion there has taken the app down twice (Q-107, Q-308). The job therefore builds its own
> APK against `http://10.0.2.2:3000` (the emulator's host-loopback alias) with a seeded Postgres
> and a local Next server, and **fails closed** if that URL rewrite stops matching. That also means
> it needs **neither production nor a staging environment**, which decouples it from Q-251.
>
> **Still open, and why it is not done here:** sign-in, offline cold start, the service-worker
> `/api/` passthrough, deep-link cold launch, the hardware back-button guard, local
> notifications/reminders, and PiP. Each needs the app driven through real flows rather than merely
> launched, which is a Maestro/Espresso-shaped job rather than a shell script. Do that as a second
> PR once this one has proven stable across a few runs — it is non-required precisely so its early
> flakiness costs nothing.

- **Branch:** `feat/ci-android-emulator`
- **Added:** 2026-08-14 · same owner ask
- **This cannot run in a session, and that is settled — do not retry it here.** Verified 2026-08-14:
  `/dev/kvm` does not exist and `/proc/cpuinfo` reports neither `vmx` nor `svm`. The sandbox is a
  Firecracker microVM (`Linux 6.18.5-fc-v20`), so nested virtualisation is unavailable. GitHub's
  `ubuntu-latest` runners **do** expose KVM, which is where the emulator has to live —
  `.github/workflows/android.yml` already builds the debug APK there on every native-path PR.
- **What it closes** (the 17-row bucket, and the most valuable part is the first line):
  **local SQLite migrations running against real Android SQLite** — the failure that has silently
  killed the local DB twice (WAL pragma in an upgrade transaction #27; non-idempotent `ADD COLUMN`
  #85) and is the root of the recurring "my data disappeared" reports. Today a migration's first
  real execution is on the owner's phone. Also: Capacitor plugin load, offline cold start, the
  service-worker `/api/` passthrough, deep-link cold launch, the hardware back-button guard, local
  notifications/reminders, and PiP — whose Known-Issues row says it "structurally cannot" be
  verified, which is true of *this* sandbox but not of an emulator.
- **Suggested shape:** `reactivecircus/android-emulator-runner` on `ubuntu-latest`, one API level to
  start, `install` the debug APK the existing job already builds, then run a small instrumented
  smoke: launch, sign in, assert the local DB opens and reports the expected schema version, kill and
  relaunch offline, assert content still paints. Keep it **non-required** at first, exactly as
  `android.yml` is today, so a flaky emulator never blocks a merge.
- **What it does NOT close, and must not be described as closing:** anything involving a radio. No
  emulator gives an agent a paired Ring 5, a Polar H10 or the Renpho scale. It is also **not**
  Samsung's WebView — it is Chromium, so the compositor bugs (SVG wiping sibling gradients) stay
  invisible to it. See Q-252.

### [platform] Q-251 — a staging environment, so a migration's first real run is not production

- **Branch:** `feat/staging-environment`
- **Added:** 2026-08-14 · same owner ask
- **✅ Shape (a) is now planned and split out as [Q-530](#platform-q-530--an-admin-snapshot-endpoint-so-a-migrations-first-real-run-is-not-production)**
  (2026-08-17), which sits higher in the queue. It came out smaller than shape (a) describes below:
  `pg_dump` is the wrong transport, because the consumer is the agent sandbox and Railway's Postgres
  port is blocked there — only 80/443 are open. So it is an HTTPS endpoint reading the `claude_ro`
  views, which already carry the one-user scoping, the default-deny and the column withholding.
  Scrubbing turned out not to be needed at all: filtering to one consenting user replaces it.
  **This entry stays open for shape (b) only** — the second Railway service, still deferred.
- **The gap:** every Postgres migration, every destructive write path and every sync-engine change
  is exercised against a **freshly-seeded local DB** and then against **production**. `CLAUDE.md`
  names the consequence as a standing root cause: *"A bug that reproduces in prod but not locally:
  suspect prod data drift vs the fresh local seed before suspecting code"* — the local DB is always
  seeded correct, which is what makes it misleading. The `claude_ro` read-only endpoint answers
  questions about prod but cannot be written to, so nothing can be *rehearsed*.
- **What it closes:** the ~10 data-gated rows (a real night's sleep data, real HR, the owner's live
  program, real zone data), plus it converts the "confirm before merging a destructive change" gate
  from a judgement call into something rehearsable.
- **⚠️ RESCOPED 2026-08-17 after the owner pushed back, and the pushback was right.** The entry was
  written around a second Railway service. It should have been written around the **data**. The
  environment was only ever the vehicle: what closes the ~10 data-gated rows and makes a migration
  rehearsable is *a prod-shaped database to run against*, and that does not require a second
  deployed service. Two shapes, cheapest first:
  - **(a) Scrubbed snapshot restored into the local DB — recommended, no recurring cost.**
    `pg_dump` from Railway → scrub → restore into the local Postgres the session-start hook already
    provisions. `docs/runbooks/db-backup-restore.md` already covers the dump/restore halves. This
    plugs straight into `pnpm dev` and the existing Playwright harness, needs no credentials
    migrated, and carries **no production risk at all**. The scrubbing is the real work and must be
    got right — see the consent point below — but it is one-off work, not a monthly bill.
  - **(b) A second Railway service**, as originally written. Buys the things (a) cannot: real
    HTTPS, the service worker under a real origin, and an APK that can point somewhere that is not
    production. A minority of the value, all of the recurring cost. Defer until something concretely
    needs a deployed non-prod origin.
- **Scrubbing is the load-bearing part of either shape**, and is the whole reason this is preferable
  to widening `claude_ro`: production holds several real accounts with months of health data, and
  they cannot consent on the owner's behalf — the same reasoning that row-scoped `claude_ro` to one
  user in the first place. Snapshot shape and volume, not other people's rows.
- **A test account on production is NOT a substitute**, though it was raised and is worth having
  separately for deployed-app smoke checks. It does not help here: migrations still run against
  production first (the risk this entry exists to remove), a fresh account has none of the real
  sleep/HR/program data the ~10 rows need, and its writes land in the production database — adding
  CI load to a system that has fallen over from connection exhaustion twice (Q-107, Q-308).
- **Q-250 no longer depends on this.** The emulator job builds its own APK against a host-loopback
  server, so it needs neither production nor staging. That coupling was real when both entries were
  written and is now removed.

### [platform] Q-252 — error tracking with session replay, for the bug class that cannot be reproduced from source

- **Branch:** `feat/error-tracking-session-replay`
- **Added:** 2026-08-14 · same owner ask (they named the Railway key as the model — this is the same
  kind of win: observability an agent can query)
- **What exists today and where it stops.** `error_events` is self-rolled, **prunes at 30 days**,
  and is **row-scoped to one user** through `claude_ro` — so a count from the admin endpoint is the
  owner's faults only, on top of the prune (both limits already documented in `CLAUDE.md`). It
  records that something threw. It cannot record **what the user did before it threw**.
- **That missing half is a live, repeated cost.** Q-226 (2026-08-14) is the clean example: the owner
  described a sequence, a CDP harness never reproduced it, and the fix shipped on source-reading
  alone with the entry conceding *"the owner's sequence is unconfirmed"*. Q-104 sat open for weeks
  waiting for on-device timestamped evidence of what triggered a weigh-in. Session replay answers
  both directly.
- **Also worth having:** source-mapped stack traces (today's client errors are minified), release
  tagging against `package.json` (so a fault can be tied to a version), and breadcrumbs.
- **Decide before Q-49 lands** — this adds a DSN to the client bundle, and the public-repo cut has
  opinions about credentials. A DSN is not a secret in the way a bucket key is, but it should be a
  deliberate call, not a surprise in the first public commit.

### [platform][app-shell] Q-253 — a real-hardware device-farm run, for the Samsung-specific rendering and safe-area rows

- **Branch:** `feat/device-farm-smoke`
- **Added:** 2026-08-14 · same owner ask
- **This is the lowest-value item in the cluster and is filed to be decided, possibly declined.**
  Of the 25 hardware-gated rows, roughly 15–18 are BLE — ring, strap, scale — and **no device farm
  gives an agent the owner's Ring 5 speaking our own re-keyed protocol**. A farm closes the
  remainder: Samsung's WebView compositor (the SVG-wiping-sibling-gradients class), real safe-area
  insets, and the launcher/notification icon rows.
- **Options:** Firebase Test Lab (has real Galaxy hardware, API-driven, agents can trigger a run and
  read the result) or BrowserStack App Live. Both cost per run, so treat this as a **pre-release
  gate**, not a per-PR check.
- **Prerequisite:** Q-250. There is no point paying per run until the free emulator tier has already
  caught the Android-runtime failures.
- **Do not file this as closing "device verification"** — it closes a named minority of it. The
  BLE gate stays exactly where `CLAUDE.md` puts it: with the owner.

### [platform][app-shell] Q-254 — strike the device-verification rows an E2E spec can now cover (re-tagging DONE 2026-08-15, striking remains)

- **Half of this is done. 2026-08-15: all 83 rows now carry a `· needs:` tag** naming the capability
  each is actually waiting on — **browser 32 · android 26 · data 11 · hardware 13**
  (`grep -cE '^### .*needs: browser' projectOverview.md`). The queue no longer reads as one
  undifferentiated wall, and the `data` bucket — real accumulated/owner/ring data that no emulator
  conjures — is now visible as its own gate rather than hiding inside "hardware".
- **What remains is the striking half, and it is blocked on specs, not on access.** Q-249 shipped the
  harness with **one** spec (the five-tab instant-paint walk), and that spec covers **none** of the
  32 browser rows. Each one needs a spec that exercises its actual claim before it can be struck —
  "does an E2E spec cover it" was always the gate, and reading a row is not covering it. Write those
  specs under **Q-297**, then come back here and strike per row.
- **The tags are a claim about the gate, not about verification.** A row tagged `browser` has not been
  verified; it means a browser is the thing it is waiting for. Do not read the tag as permission to
  strike.
- **The 2026-08-14 projection is superseded.** It read "~25 need nothing but running the app / 17
  Android / ~10 data / 25 hardware" from a reading pass; the measured split above is different in
  both directions (more browser, less hardware). The shape held — roughly 40% never needed a phone.
- **Branch:** `docs/device-verification-sweep`
- **Added:** 2026-08-14 · same review
- **The count is 81** (`grep -cE '^### .*(NOT verified on device|NOT device-verified)' projectOverview.md`,
  2026-08-14) and the oldest reach back to **v1.45/v1.50** — versions whose code has been rewritten
  underneath them several times since. Examples from the ~25-row "needs nothing but running the app"
  bucket: *"Bodyweight sets no longer count as zero volume"*, *"AI no longer quotes bodyweight 1RMs
  in kilograms"*, *"Injury workout warning"*, *"Rest timer on the All sets done! screen"*.
- **The honest read of why they accumulated:** the device-verification rule worked exactly as
  designed — it just had **no cheaper tier beneath it**, so "we cannot verify this here" was the
  only truthful thing a session could write, for UI that needed a browser and not a phone. Q-249
  creates that tier; this entry spends it.
- **Do this AFTER Q-249, and drive it from the harness** — a row closed by reading is a row closed
  on intent, which is what `CLAUDE.md` forbids ("never mark an issue fixed from intent"). The
  sequence per row is: does an E2E spec now cover it → yes, strike it and move it to
  [`docs/overview/known-issues-resolved.md`](overview/known-issues-resolved.md) whole; no → re-tag
  it with **which** capability it is actually waiting on (browser / Android / data / hardware), so
  the queue stops reading as one undifferentiated 81-row wall.
- **Expected outcome:** the owner-gated queue drops from 81 to roughly 30, and what remains is
  genuine radio-and-glass work. That number is a projection from the bucketing above, not a promise.
- **Separate these out while sweeping, they are not testing-gated at all:** Q-72 (re-tune the Sleep
  Score), Q-4, Q-3b, the Q-49/Q-50 deletion calls and the P-F P3 go/no-go want an owner **decision**,
  not a test run. No infrastructure in this cluster moves them, and mixing them into the device
  queue makes both look bigger than they are.

> **Q-232-followup CLOSED as "leave inline", 2026-08-16 — owner decision, no code change.** The
> question was whether Stats, Trophy Case, Achievements, "Your Year", season badges and Goals should
> move behind `/more/achievements` and `/more/goals` rows as the IA plan's §2 table proposed. They
> stay on the surface of More. The size pressure that justified the earlier splits is gone —
> `profile-tab.tsx` is 465 lines and off the `check-component-size.js` baseline — and unlike
> Settings/Data/About these sections are **content the owner wants visible**, not navigation. The IA
> plan's §2 table is superseded on this point; do not re-derive it from the plan and re-open this.

> **Q-255 DONE and removed, 2026-08-16 (owner answered).** The question was whether any *external*
> link still used a `/sheet/...` URL, since the three shims had zero in-app referrers and the reason
> they were kept — being the only inbound path to `/chat` — died when `#1293` deleted that subtree.
> The owner confirmed there is no such bookmark, home-screen shortcut or saved note, so
> `app/sheet/[id]/{config,overview,workout}/page.tsx` were deleted. **Re-verified before deleting
> rather than trusting the entry**: `grep` over every `href`, `router.push` and `redirect` outside
> `app/sheet/` found zero referrers on current `main`, and no test, sitemap, manifest or service
> worker names the paths. The 2026-08-10 Q-136 decision that kept them is annotated as answered in
> `projectOverview.md` rather than silently overwritten.


### [activity][devices] Q-231 — the "Exercise detected" card can never show anything again; its only writer was the Oura Cloud sync

- **Branch:** `fix/detected-activity-has-no-source`
- **Added:** 2026-08-14 · found while removing the Oura Cloud integration (Q-224), by checking which
  repository methods lost their last caller rather than only which ones lost their compile target.
- **Measured, not inferred.** `upsertOuraWorkouts` had exactly one caller — the Cloud sync route. In
  production the owner's `oura_workouts` holds **13 rows, newest `day = 2026-07-05`**, two days
  before the re-key, with 3 still unreviewed. `getOuraWorkouts({ unreviewed: true })` filters to the
  last 30 days, so the card stopped having anything to show around **2026-08-04** — ten days before
  Q-224 deleted the writer. **Removing the Cloud sync did not break this; it made an already-dead
  pipeline visible**, and the entry is filed so the deadness is recorded rather than rediscovered.
- **Blast radius is wider than the card.** `app/api/day-timeline/route.ts:255` filters the same
  table for walks, so the day timeline has silently lost Oura-detected walks for the same period.
- **Not the same thing as Q-222.** That entry is about auto activity-detection producing *false
  positives*, which means something is still firing — that path writes `activity_logs` from the BLE
  classifier, not `oura_workouts`. Confirm which surface the owner is actually seeing before
  treating these as one item; they may want the BLE detector to feed this card and retire the
  Cloud-shaped table entirely.
- **Fix**: decide whether detected activities come from the BLE classifier (then feed them into the
  existing review UI, and `OuraWorkout` in `lib/oura/types.ts` stops being a Cloud shape) or whether
  the card and its route retire. Do not restore `upsertOuraWorkouts` — nothing can call it.

### [activity][devices] Q-222 — auto activity-detection false positives trace to a classifier the codebase already flags as unvalidated

- **Branch:** `feat/gait-classifier-calibration-capture`
- **Plan:** [`docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md`](../docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md) Task 41
- **Added:** 2026-08-14 · owner: "the auto activity detection is still really bad and triggers for
  almost all false positives." (Same report reconfirmed the still-open Q-104 scale recurrence —
  already root-caused, no new entry there; this covers the detection half only.)
- **The classifier's own comments already predicted this, and the fix was scoped but never run.**
  `classifyGait()` (`packages/shared/src/health/gait-classifier.ts`) drives the ring-cadence
  walk/run confirmation, and its header says outright: **"PROVISIONAL BANDS — NOT yet confirmed
  on-device… physiological priors… do not hand-tune further without real data."**
  `auto-detection-service.ts` separately documents a confirmed false positive this produced (a
  Sumo Deadlift rest period read as ~90s of walk-band cadence) and notes the workout-in-progress
  gate closes only that *one reproduced case* — the uncalibrated bands themselves are untouched and
  can misfire on anything else with similar cadence outside a tracked workout.
- **The originating plan already specifies the fix in detail** — `docs/superpowers/plans/2026-07-23-ring-cadence-activity-detection.md`'s
  "Calibration" section (explicitly marked "device-gated — the load-bearing task") calls for
  captured frames from a counted walk, a run, a stationary lifting session (named as "the
  false-positive case"), and idle — then setting the bands from real data and pinning the frames
  as test fixtures. None of this has been done; the bands today are still the plan's initial
  priors. Grepped the backlog for a tracking entry — none exists; this gap has sat as a code
  comment only.
- **Needs the owner, not just an implementer** — the capture step is physical (an actual counted
  walk/run/lifting session with the ring on), via the plan's referenced admin device-data capture
  panel or an ad-hoc capture. No code review substitutes for real frames.

### [platform] Q-220 — every session pays ~194,000 tokens of orientation before it starts

- **Branch:** none yet · **Added:** 2026-08-10, raised by the owner during the public-repo migration.
- **Plan:** [`2026-08-10-orientation-cost.md`](superpowers/plans/2026-08-10-orientation-cost.md)
- **The measurement:** `CLAUDE.md` is 918 lines (~27k tokens) and loads automatically; its first
  standing instruction sends every session to `projectOverview.md`, which it calls *"a lean index"*
  and which is **8,068 lines / 669 KB (~167k tokens)**. That is ~194k tokens read before the first
  useful action — more than many context windows.
- **Where the bulk is:** Known Issues & Risks is **5,821 lines, 72%** of `projectOverview.md` —
  **267 entries averaging 22 lines**, of which **63 are resolved** and **204 are open**.
- **The thing not to misread:** archiving everything already fixed removes 1,338 lines — **17%**.
  The other 4,626 are genuinely-open issues. *The file is big because the backlog is big*, so a
  tidy-up is not the fix and should not be sold as one.
- **Three levers, in order:** (1) archive the resolved entries **and add the retention rule** to
  the wrap-up ritual, or it regrows; (2) move open entries into `docs/domains/<pillar>/known-issues.md`,
  which is the lever that changes the number and where the multi-tag visibility risk lives;
  (3) cap entry length — incrementally, on touch, never as a big-bang rewrite.
- **✅ Lever 1 DONE 2026-08-13.** 53 entries / 1,092 lines moved to
  [`docs/overview/known-issues-resolved.md`](overview/known-issues-resolved.md); retention rule added
  to `CLAUDE.md` Session Wrap-Up step 2. **`projectOverview.md` 9,184 → 8,105 lines (−11.7%),
  748 KB → 668 KB.** Conservation was proved rather than asserted: 885 non-blank lines removed, 885
  archived, identical and in order; 284 headings → 231 + 53.
  **It came to 11.7%, not the 17% this entry predicted, and the gap is the point:** of the 72
  ✅-marked entries, **19 still had something owed** — a pending device check, a blocked finding, a
  WAL restart, an unrecoverable-data note — and those stay where the orientation read sees them.
  A sweep that archived all 72 would have hidden the sign-out-wipe check the current handoff is
  still chasing. One stale claim was found and corrected on the way out (the gap sweep's "a
  per-column null-rate sweep… has not been run" — it ran the same day).
- **Levers 2 and 3 remain, and Lever 2 is the one that changes the number** — 207 open entries,
  ~6,000 lines, still in `projectOverview.md`. Note the file grew **~370 lines/day** over the three
  days before Lever 1, so archiving alone does not hold the line.
- **`CLAUDE.md` is downstream of lever 2, not parallel to it.** Its domain-specific bug-class
  sections could move to the pillar docs, but only once those are demonstrably read. Moving a rule
  into a file nobody opens is how a rule stops firing, and this repo has already paid for that.
- **Does not block the public cut**, and should not be bundled into it. It makes every session
  after it cheaper, which is the argument for soon rather than never.

> **Q-173 removed 2026-08-11 — it was already shipped.** #1223 ("Tell the user why the early-deload
> card fired") added `earlyDeload: EarlyDeloadReason | null` to `ReadinessScoreResponse` and gave
> `EarlyDeloadCard` its "Why this recommendation?" section. The entry was resurrected by a merge on a
> stale base — the exact failure the warning at the top of this file describes, now on its second
> occurrence for this same entry. Verified against source before removing, not from the PR title.

> **Q-182 completed 2026-08-11 — all 35 filters covered, entry removed.** `adapter.ts` (6) and
> `nutrition.ts` (1) came from Q-178; `user-stats.ts` (7) in #1244, `periodization.ts` (17) in #1251,
> and `oura.ts`'s 11 in the PR that removed this entry. Every one was verified by individual
> mutation. **The entry's own deferral reason turned out to be wrong**, which is worth remembering
> before deferring on a size estimate again: `oura.ts` was held back as "needs a seeded rollup
> window", but its eleven filters are all in the HR-attribution *work-list* queries over
> workout_sessions/exercise_logs/set_logs — the same fixture shape as the rest, and no rollup
> anywhere. See
> [`docs/overview/overview/history-2026-08-08.md`](overview/history-2026-08-08.md).

### [platform] ✅ Q-213 — production stalls: all three stages SHIPPED 2026-08-13 (entry kept only until the production numbers confirm it)

- **Branch:** `fix/pool-starvation-workout-data-fanout`
- **Handoff:** [`docs/handoff-2026-08-13-platform-production-connection-starvation.md`](../docs/handoff-2026-08-13-platform-production-connection-starvation.md) — full evidence; read it before touching this.
- **Added:** 2026-08-13 · owner ("everything that needs a network connection is landing very slow",
  then Railway logs showing `[rate-limit] shared store unavailable, memory-only: …timeout exceeded
  when trying to connect`).
- **Measured, from outside the container:** `/api/version` — a route that touches nothing — went
  0.47 s → 3–14 s → **seven minutes of no response at all** (23:31–23:38 UTC) → 5–11 s. It recovers
  on its own and re-degrades. An admin query whose DB time was **353 ms** took **14 s** end to end.
  `pg_stat_database.numbackends` = **10**, exactly the pool's `max`. Postgres is healthy; the app is
  the bottleneck.
- **`claude_ro.error_events` cannot see this** — the app must reach the DB to write an error row,
  which is the thing failing. 13 rows across the 90 minutes covering the worst of it. Do not read a
  quiet `error_events` as a quiet production.
- **✅ DIAGNOSED 2026-08-13 from the Railway deploy logs — the hypothesis above is refuted.** Plan:
  [`docs/superpowers/plans/2026-08-13-oura-ble-rollup-incremental-and-off-loop.md`](superpowers/plans/2026-08-13-oura-ble-rollup-incremental-and-off-loop.md).
  Evidence: [`docs/handoff-2026-08-13-platform-production-event-loop-starvation.md`](../docs/handoff-2026-08-13-platform-production-event-loop-starvation.md).
- **It is event-loop starvation, and the pool exhaustion is a symptom of it.** `aggregateOuraRawSamples`
  decodes a 35-day window of `oura_raw_samples` in main-thread JS on every BLE sync. The table holds
  **984,862 rows** against ~37 days of ring history, so that window covers effectively the whole
  table, and one run outlasts the gap between syncs — so runs go back-to-back and the single Node
  main thread stays pegged for 15–30 minutes. Measured: CPU sustained **1.0–1.6** of an 8-core limit
  against an idle 0.001, memory 0.9–2.1 GB against an idle 0.38 GB.
- **Why the connection errors are downstream of it:** `pg`'s connect timeout is a JS `setTimeout`. On
  a blocked loop it fires late and kills healthy connections, which is exactly why the logs read
  `Connection terminated due to connection timeout` while the database answers in milliseconds. The
  `numbackends = 10` reading is the pool being unable to hand out connections, not the DB struggling.
- **The `/api/version` observation above was the decisive clue and is now quantified**: it touches no
  DB, its one outbound call is bounded to 5 s and cached for 300 s, and it measured **122,044 ms**
  (mean 24,723 ms over 25 requests) during the window against 5 ms healthy. Nothing but a blocked
  loop explains that — the 5 s abort is itself a JS timer and could not fire either.
- **The workout-data fan-out is refuted, and #1287 is not the cause.** A fan-out of DB queries shows
  CPU near zero while blocked on I/O and cannot make a DB-free route take two minutes. Both
  predictions fail. **Do not ship the fan-out change** — it would have changed nothing. (Bounding the
  fan-out may still be worth doing on its own merits; it is not this bug.)
- **It is chronic, not new.** Seven days of CPU history show **1–3.5 hours a day** of a pegged core,
  with *higher* peaks on 08-06…08-11 than on 08-13. The three PRs that merged during the owner's
  morning are why it was noticed, not why it happens — a rollback fixes nothing.
- **✅ Stage 1 SHIPPED 2026-08-13 (v1.303.0).** `aggregateOuraRawSamples` takes an optional `sinceDs`
  and re-derives only the span an ingest touched; `hrSeriesCutoffDs` is clamped to the read cutoff so
  the HR-series delete can never outrun what the pass can rebuild. The route accumulates the oldest
  un-rolled timestamp per user (a coalesced batch is skipped, never dropped), restores it on failure,
  and forces a full-window pass once per process so a cold start cannot inherit a gap.
  **Measured 10,560 ms → 930 ms (11.4×)** on a seeded 35-day table; production has ~40× the rows and
  the narrowed cost does not scale with history. Journal:
  [`docs/overview/overview/history-2026-08-12.md`](overview/history-2026-08-12.md).
  ⚠️ Not device-verified. **The cold-start full-window pass this originally left in place cost six
  minutes of a pegged thread per deploy and is fixed in v1.303.2** — the watermark is persisted in
  `oura_rollup_state` (migration 184) rather than held in process memory.
- **✅ Stage 2 SHIPPED 2026-08-13.** `POST /api/oura-ble/samples` dispatches through
  `runRollupOffLoop` (`lib/oura-ble/rollup-worker.ts`) into a `worker_threads` realm with its own
  `pg` pool (`PG_POOL_MAX=2`, so a replica running a rollup holds 12 connections, not 20). The worker
  needs its own esbuild bundle (`scripts/build-rollup-worker.mjs` → `.rollup-worker/`, built by both
  `pnpm build` and `pnpm dev`) because the repository reaches `onnxruntime-node`, which webpack
  cannot bundle — there is no Next output to point a `Worker` at. **A missing or unstartable bundle
  falls back to in-process, i.e. to the previous behaviour**, proven by deleting the bundle and
  watching the correctness test still pass. Measured: main-thread lag during a rollup **185 ms of a
  262 ms in-process run → 4 ms of a 439 ms worker run**. Journal:
  [`docs/overview/overview/history-2026-08-12.md`](overview/history-2026-08-12.md).
  ⚠️ **Production is where this claim settles** — watch Railway CPU for the sustained 1.0–1.6
  plateaus and `/api/version` latency. Both of the outage session's confident cost predictions were
  wrong, and only production caught them.
- **✅ The admin redecode route moved too, 2026-08-13.** Both phases of
  `app/api/oura-ble/samples/redecode/route.ts` now go through `runRedecodeOffLoop`, keeping the
  route's per-phase results and errors — a redecode failure still cannot prevent the re-aggregate.
  Verified on dev: 200 in 0.9 s with both phases populated and both errors null.
- **✅ Stage 3 SHIPPED 2026-08-13.** `isFinalOrSmallBatch` (`frames.length < 255`) was written to
  mean "the drain's LAST batch" and meant "any batch" — §2 of `docs/oura-ble-operations.md` says a
  routine drain is 1–2 batches and almost always under 255 frames, so it bypassed its own 8 s window
  nearly every time. Replaced by a trailing-edge debounce with a max-wait
  (`lib/oura-ble/rollup-debounce.ts`, 3 s / 20 s, injected clock + timer so it is testable at its
  boundaries; the timer is `unref`'d and a skipped run is safe because the watermark persists).
  Three mutations verified the tests, including reintroducing the old predicate (5 of 6 fail).
  Dev: three batches in quick succession → three 200s and **one** rollup.
- `lib/data/postgres/client.ts`'s pool error handler and both timeouts are load-bearing (CLAUDE.md) —
  do not weaken them to paper over this.

### [platform] ✅ Q-219 — over half the database was indexes; the worst one is REINDEXed (owner, 2026-08-13)

- **✅ DONE 2026-08-13 — owner ran `REINDEX INDEX CONCURRENTLY oura_heartrate_user_updated`.**
  Measured after: **52 MB → 2.75 MB** (19×), database **484 MB → 435 MB**, indexes **261 MB → 212 MB**.
  Predicted ~50 MB reclaimed, actual 49 MB. The index is kept, not dropped — 0 scans means Track-B's
  pull has not run, not that the cursor is unnecessary.
- **Still open, lower priority:** `oura_raw_samples` carries 183 MB of indexes against 146 MB of heap.
  Its 69 MB unique key indexes `body_hex` and is legitimately large (204,117 scans — it is the dedup
  key), but `oura_raw_samples_user_tag_ts` (52 MB, 1,055 scans) and `idx_oura_raw_samples_user_measured`
  (41 MB, 1,932 scans) are worth re-measuring — **though D4 (Q-30) may make the whole table moot, so do
  not invest here before that direction is planned.**
- **Added:** 2026-08-13 · owner asked "do we need all these rows of raw data; are we aggregating
  where we can?" while Q-213 was being fixed. Measured rather than estimated — all figures from
  `pg_class`/`pg_stat_user_indexes`, catalog reads only, no row scans.
- **The premise turned out to be wrong in an interesting way.** The raw rows are not the problem:

  | | heap (data) | indexes | note |
  |---|---|---|---|
  | whole database | 171 MB | **261 MB** | 484 MB total — **54% of it is indexes** |
  | `oura_raw_samples` | 146 MB | 183 MB | 986,797 rows |
  | `oura_heartrate` | **6.6 MB** | **67 MB** | 48,450 rows — a **10:1** index-to-data ratio |

- **The single worst offender: `oura_heartrate_user_updated` — 52 MB, `idx_scan = 0`.** It is
  `(user_id, updated_at, id)`, the Track-B pull cursor's keyset index (migration 130). For 48,450 rows
  a three-column index should be ~2 MB; it is **~25× bloated**, and nothing has ever read it.
  `oura_heartrate_pkey` is a further 4.2 MB, also at 0 scans.
- **Cause, and it is ours.** The rollup's HR-series block DELETEs every `source='ble'` row in its
  window and re-INSERTs them on each run. Every cycle writes fresh index entries, and a B-tree does
  not return freed space to the OS without a REINDEX. The `setWhere` guard on `upsertOuraHeartrate`
  that avoids churning `updated_at` for unchanged rows **cannot help here**, because delete-then-insert
  makes every row genuinely new.
- **Q-213 Stage 1 already cut the churn rate ~14×** (the rebuild window went from a rolling 14 days to
  the span a sync touched), so this accumulates far more slowly now. But it does not reclaim what is
  already there.
- **Fix**: `REINDEX INDEX CONCURRENTLY oura_heartrate_user_updated;` reclaims ~50 MB — about **10% of
  the whole database** — with no downtime. Worth doing the rest of `oura_heartrate` at the same time
  (~60 MB total). Do **not** drop the index: 0 scans means Track-B's pull has not run, not that the
  cursor is unnecessary. Re-measure `oura_raw_samples`'s 183 MB afterwards; its 69 MB unique key
  indexes `body_hex` and is legitimately large (204,117 scans — it is the dedup key), but
  `oura_raw_samples_user_tag_ts` (52 MB, 1,055 scans) and `idx_oura_raw_samples_user_measured`
  (41 MB, 1,932 scans) are worth a second look.
- **Not the same thing as `docs/db-volume-cleanup-handover.md` / Q-30**, which is about whether the
  raw archive should move to the device (D4). This is reclaimable waste inside the current design and
  needs no architectural decision.

### [platform] Q-214 — a tap during the sync pull queues behind the whole delta on the one SQLite connection

- **Branch:** `perf/sync-pull-sqlite-connection-hold`
- **Added:** 2026-08-13 · found while fixing the check-in saves (#1292).
- The Capacitor SQLite plugin has a single connection, and `applyDelta` holds a native transaction
  (`beginTransaction`, `lib/local-store/sqlite-backend.ts:384/1201/2077`) across the whole delta. A
  user write landing during a pull queues behind all of it — measured as **~2 minutes** of a
  "Saving…" button on the readiness sheet on 2026-08-13.
- **#1292 stops this being *visible*** (both check-in sheets now close on the tap and finish the
  write behind it). It does not stop it happening, and every other local write site still waits.
- **Fix**: batch/chunk the `applyDelta` transaction so it yields between groups, or give user-
  initiated writes a way past a bulk sync in progress. Note `_inTransaction` in
  `lib/sqlite/sqlite-service.ts` is a module-level global — a concurrent write during a sync
  transaction currently joins that transaction, which is its own correctness question.

- **📋 Investigated 2026-08-13, not implemented. Read this before starting — three things change the
  shape of the work, and two of them are not in the description above.**

  1. **The `_inTransaction` "own correctness question" is the more serious half, and it is silent
     data loss, not latency.** `runSQL` passes `!_inTransaction` as the plugin's auto-wrap flag
     (`sqlite-service.ts:208`), so a user write that interleaves at an `await` while a sync
     transaction is open **executes inside that transaction**. If the sync then rolls back, the
     user's write is rolled back with it — and nothing throws, so the write site sets
     `savedLocally = true` and shows success. Latency is the symptom that got reported; this is the
     one that loses data.

  2. **Chunking is safe from a data-completeness view, and the reason is worth knowing.**
     `sync-engine.ts:598-611` calls `setLastSyncAt(raw.syncedAt)` **after** `applyDelta` and only on
     success; a throw returns `null` without advancing the cursor. Every write in `applyDeltaBody`
     is an idempotent upsert gated on `sync_status='synced'`. So a partially-applied delta is
     re-fetched and re-applied on the next pull, and cannot clobber a pending local edit.

  3. **🔴 But chunk boundaries CANNOT be placed by statement count — `applyDeltaBody` contains
     delete-then-reinsert groups that must stay atomic.** The program-structure block
     (`sqlite-backend.ts:1724-1739`) deletes `session_exercises`, `schedule_days`,
     `program_sessions` and `schedules` for every changed program, and the rows are re-inserted by
     *later loops in the same body*. A commit between the delete and the re-insert leaves the user's
     entire program structure locally empty until the next successful pull — the "my data
     disappeared" class (#27, #85). The same pattern applies to `meal_plan_variants` /
     `meal_plan_meals` and to `style_sets`. **Chunk at logical seams, hand-placed, never every N
     statements.** `applyDeltaBody` is ~700 lines / 48 `runSQL` calls across ~28 domains.

  **Why it was not implemented in the session that investigated it:** fixing (1) properly means
  replacing the ambiguous `_inTransaction` global with an explicit transaction handle
  (`withTransaction(tx => tx.run(...))`) so a queued write can never be mistaken for one inside the
  transaction — a mechanical refactor of all 48 call sites plus `logWorkoutLocally` and
  `replaceMealTypes`. A flag-based mutex cannot disambiguate "this runSQL belongs to the
  transaction" from "this runSQL arrived during it", which is the whole bug. That refactor lands in
  the file where a bad local migration has twice made every read return empty, and **native SQLite
  does not run in the sandbox**, so none of it is verifiable here. It needs the on-device smoke run
  in the same session, not a Known-Issues row.

### [platform] ✅ Q-217 — the TOKEN_ENC_KEY boot log was crying wolf; measured and fixed 2026-08-13 (owner still has one optional call)

- **Branch:** not started
- **Added:** 2026-08-13 · found in the Railway deploy logs while confirming Q-213. **Numbered 217,
  not 215** — Q-215 was already taken by the hr-ingest cardinality bug on PR #1292's branch, which
  was unmerged and therefore invisible to a `grep` of this file. Claim a number against open PR
  *contents*, not just the queue and the PR list.
- Every container start logs `[token-crypto] TOKEN_ENC_KEY unset — token writes will fail closed`,
  twice, at `error` severity, on every deploy examined.
- **✅ MEASURED AND ANSWERED 2026-08-13. The variable is genuinely unset; the message is accurate
  about the mechanism and overstates the situation.** Three facts settle it:
  1. **`encryptToken` is reachable from exactly two callers** — `saveOuraPat` and
     `saveOuraOAuthTokens` (`slices/oura.ts:63,80-81`). Both mean *connecting an Oura Cloud
     credential*, a surface that gets no new data since the 2026-07-07 BLE re-key. Nothing else in
     the app writes a token.
  2. **Production's stored tokens cannot be affected.** The row was written **2026-06-22** and never
     updated; `token-crypto.ts` landed **2026-08-11**, seven weeks later. So the stored values are
     unprefixed plaintext, and `decryptToken` returns them unchanged with or without a key.
  3. **`has_pat` is `false`** — there is no PAT at all, only OAuth access+refresh. The bullet below
     said "PAT"; it is the OAuth pair.
- **The `error` severity was a red herring:** it was a `console.warn`, and Railway labels anything on
  stderr as error. Nobody escalated it.
- **✅ Fixed:** the import-time warning is gone (it fired on every container start, twice, on a
  deployment where nothing was wrong), and the case that was actually silent now reports —
  `decryptToken` returning a `v1:` ciphertext because the key vanished, which a caller then uses as a
  bearer token and Oura rejects as "malformed", sending you to look at the credential instead of the
  key. Both changes are mutation-verified.
- **⚠️ Owner call, now optional rather than blocking:** setting `TOKEN_ENC_KEY` in Railway
  (`openssl rand -hex 32`) is only needed to connect an Oura *Cloud* credential again. Leave it unset
  and nothing breaks; the logs are quiet either way now.
- **Still open, separate — the dead Oura Cloud token is still called on every workout completion.**
  `syncAndAttributeSessionHr` (`lib/workout/post-completion-hr.ts:32`) calls `syncHrForSession`,
  which hits the Oura Cloud and 401s every time, logging a warn per completion. **Do not just delete
  the call** — another user with live Cloud credentials would lose HR sync; the app is no longer
  safely single-user (see `docs/device-agnostic-source-architecture.md`). The fix is to skip or
  quiet it when the stored credential is known-dead, which needs a decision about whether a 401
  should auto-disconnect the Cloud integration. Filed here rather than fixed.

### [workouts] Q-211 — a deload week reduces a BASELINE lift, which the rest of the app treats as a real max test

- **Branch:** `fix/baseline-exempt-from-deload`
- **Added:** 2026-08-12 · found while implementing Q-185, by chasing a guard that mutation testing
  said was unreachable.
- **The contradiction, in two files.** `session-data.ts`'s AI deload branch
  (`else if (aiDeload || isDeloadActive)`) has **no baseline carve-out**, so a confirmed deload week
  reduces a prescribed baseline lift to 50% / 2 sets. But `log-exercise.ts` has the carve-out twice
  over — `estimateOneRm` is called with `deloaded: exerciseDeloaded === true || (isAnyDeload && !isBaseline)`
  and `shouldCountTowardPr` returns `!args.isAnyDeload || args.isBaseline`, both commented as
  *"a baseline test is a genuine max-effort attempt even during an otherwise-active deload window"*.
- **So the app prescribes half weight and then records the result as a real max test**, feeding it
  into the 1RM estimate and letting it set a PR. A baseline taken during a deload week understates
  the athlete, permanently, in `personal_records`.
- **How to see it**: `session-data-manual-deload.test.ts` →
  *"records that a baseline phase is NOT protected from a deload today (Q-211)"*. That test asserts
  the current (wrong) behaviour on purpose, so this entry has something concrete to flip.
- **Fix**: add `&& !isBaselinePhase` to that `else if`, flip the test's expectations, and check
  whether the automatic per-exercise engine (`p.deloaded`) needs the same exemption — it is a
  separate branch and was not audited.
- **Why it was not fixed with Q-185**: it changes prescribed load on a path the owner's decision did
  not cover, and it is pre-existing rather than introduced. Small, but it is a load change.

### [nutrition] Q-187 — Meal Plan (Phase 2): prefill the day's food logs from the active plan

- **✅ Second slice SHIPPED 2026-08-14: the `plan_meal_answers` table and its full sync path**, with
  nothing reading it — the plan's own sequencing ("provable in isolation"). Migration 187 + 188
  (regenerated `claude_ro` views), local SQLite v26, `getSyncDelta`/`pullDelta`/`applyDelta`, a
  `pushMutations` branch sharing the web route's functions, and `/api/nutrition/plan-meal-answers`.
  Only *declines* are stored — "ate it" stays derivable from the food log, and unconfirmed prefills
  never enter `food_logs`, so none of its 23 readers change. Journal:
  [`docs/overview/overview/history-2026-08-12.md`](overview/history-2026-08-12.md).
- **✅ Second UI slice SHIPPED 2026-08-15 (v1.315.0): a planned meal can be declined.** The dismiss
  button sits beside "I ate this", hides once the meal is logged (that answer is derived from the
  food), and undoes in one tap. Declining writes nothing to `food_logs`, with a test on the day's
  food rather than on row counts. Journal:
  [`docs/overview/overview/history-2026-08-15.md`](overview/history-2026-08-15.md).
- **⏭️ What is left: automatic prefill only** — the plan's step 4, deliberately last because an
  automatic prefill that guesses wrong trains the owner to ignore it. Its recommendation is an
  explicit "fill my day" action rather than filling on open.
- **⏭️ Superseded note (what was left before 2026-08-15): the prefill UI only** — the day-open (or explicit "fill my day") prefill and the
  per-meal yes/no wired to `logPlanMeal` (yes) and the new table (no). **Held deliberately** until
  the Q-232 cluster's Q-237 lands, so `app/nutrition/nutrition-content.tsx` has one owner at a time.
  The plan's steps 2-4 are the remaining work; steps 1 and its offline-first checklist are done.
- **✅ First slice SHIPPED 2026-08-12 (v1.299.0): one-tap "I ate this" on the plan card.** The plan
  now does something on the day it is for. What remains here is only the *automatic* half — the
  prefill and its per-meal yes/no, which is what forces the "prefilled but unconfirmed" state into
  existence. See [`docs/overview/overview/history-2026-08-12.md`](overview/history-2026-08-12.md);
  the shared write path is `packages/shared/src/nutrition/log-plan-meal.ts`.

- **Branch:** `feat/meal-plan-prefill`
- **📋 PLAN WRITTEN 2026-08-13:**
  [`plans/2026-08-13-meal-plan-prefill-and-confirmation.md`](superpowers/plans/2026-08-13-meal-plan-prefill-and-confirmation.md).
  Its central recommendation, which changes the shape of the work: **keep unconfirmed prefills out of
  `food_logs` entirely** rather than adding a `confirmed_at` column and filtering it. `food_logs` is
  read in **24 files**; a column means teaching all 24 a new filter in the domain with the worst
  data-loss history, with 24 chances to be half-done — the same shape as the Q-182 soft-delete
  burn-down that took 35 sites and its own session. A separate `plan_meal_answers` table makes the
  illegal state unrepresentable instead of filtered, and needs **zero** reader changes.
  Second finding: **only "no" needs storing.** "Ate it" stays derivable from the day's food exactly as
  phase 1 does it; an absent log cannot be told apart from "hasn't answered yet", so a decline is the
  one fact that must persist. Storing "confirmed" as well as the food log would be two sources of
  truth for one fact.
- **Added:** 2026-08-11 · owner-requested · **unblocked** — Q-186 shipped 2026-08-11 (v1.282.0)
- **What it is.** With a plan active, prefill the day's meals and prompt accept/deny per meal
  ("did you actually eat this?"), instead of logging each food by hand.
- **Why it is split out.** It writes to `food_logs` — an offline-first synced domain with an outbox
  path, a `pushMutations` branch that must mirror the web route, and the app's worst history of
  data-loss bugs. Prefilled-but-unconfirmed rows also need a state that never counts toward
  totals, or the energy-balance bar starts reporting food that was never eaten. Needs its own plan
  once Q-186 is in real use and the shape of a plan is settled. The shape is now settled: a plan
  has variants (`all`, or `training`+`rest`) and each variant has positioned meals carrying their
  own macros — see `docs/overview/entries/2026-08-11-meal-plan-phase-1.md`.
- **Q-192 is done (v1.288.0), so this is fully unblocked.** A saved plan's meals now carry an
  ingredient snapshot and a suggested time, which is what a prefill needs to write a food log from.
  `savedMealToIngredients()` and `sumIngredients()` give the macros; the remaining work is the
  offline-first write path and the "prefilled but unconfirmed" state, exactly as described above.
- **A shippable first slice, if the whole thing is too big for one session (added 2026-08-12).** A
  one-tap **"log this planned meal"** on the plan card needs none of the hard half: the user taps it,
  so there is no unconfirmed state to invent and no risk of totals counting food nobody ate. The
  write is the ordinary `logMealItems` path that Saved Meals already uses, over the ingredient
  snapshot Q-192 added. It delivers most of the daily value and leaves the automatic prefill — the
  part that needs the unconfirmed state — as a genuinely separate decision.

### [nutrition] ✅ Q-207 — SHIPPED 2026-08-12 (v1.292.0): a saved meal declares how many servings it makes

> `saved_meals.servings` (mig 182, default 1), one shared `oneServingItems()` used by both the log
> path and the meal-plan conversion, local SQLite v25. Slice A of
> [`plans/2026-08-12-meal-plan-portions-and-editing.md`](superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md).
> Still needs the on-device check of the v25 upgrade — see the `projectOverview.md` Known-Issues row.

### [nutrition][platform] Q-201 — a plan meal's suggested time is stored, shown, and never used for anything

- **⛔ Needs an owner decision before implementing (added 2026-08-12, while shipping Q-200).** The
  two things are not the same notification. The existing reminders fire at a **meal type's end
  hour** as a *"you didn't log this"* catch-up (`computeMealReminderActions`); a plan's
  `suggestedTime` is a *"time to eat"* prompt. Meal types and plan meals are not 1:1 either — a plan
  meal's `mealTypeId` is usually null. Three different products follow:
  **(a)** plan times replace the meal-type end hour as the reminder time while a plan is active —
  one stream, but it changes what the existing reminder *means*;
  **(b)** a second, separate "time to eat" stream — which is the two-sources-for-one-notification
  trap this entry already names;
  **(c)** leave them as labels and close this.
  Notifications cannot be verified anywhere but the device, so guessing here ships an unverifiable
  behaviour change to a surface that interrupts the user.

- **Branch:** `feat/meal-plan-time-reminders`
- **Added:** 2026-08-12 · found reviewing v1.290.0
- **What it is.** `meal_plan_meals.suggested_time` is written by the generator, carried through
  sync, rendered on three surfaces and fed to the AI as context. Nothing schedules a notification
  from it. The app **does** have meal reminders (`lib/meal-reminders.ts`), but they key off
  `mealTypeId` — the user's Breakfast/Lunch/Dinner buckets — with no awareness that a plan exists or
  that it disagrees about the time.
- **Why it matters.** "Eat at 12:30" that never says anything at 12:30 is a label, not a plan. This
  is also the cheapest thing that would make an active plan feel alive between building it and
  Q-187's prefill landing.
- **What to do.** Decide first whether plan times *drive* the existing meal-type reminders or add a
  second reminder source — two sources for one notification is the trap here, and the existing
  `computeMealReminderActions` is the place that should keep deciding. Needs the notification
  permission story checked on-device; reminders are one of the surfaces the sandbox cannot verify.

### [platform][app-shell] ✅ Q-170 — FIXED 2026-08-09: Coach latency was reasoning tokens, 10.0 s → 3.5 s

- **Kept only as the record of how it was found**, and of two plausible fixes that made it worse.
- **The measurement that settled it.** `ai_call_log` for two turns:

  | turn | input tok | **output tok** | latency |
  |---|---|---:|---|
  | picker, 9 options | 10,832 | **2,204** | 10.0 s |
  | short text answer | 9,636 | **348** | 3.1 s |

  Two points, one line: **~1.8 s fixed overhead, then ~270 output tokens/sec.** Latency is output
  generation, nothing else. And a 9-option choice list is only ~400 tokens of actual JSON — so
  **~1,800 tokens were reasoning the user never sees.**
- **The fix is one line:** `providerOptions.google.thinkingConfig.thinkingLevel = 'minimal'` on the
  Coach route. Same turn: **554 output tokens, 3.5 s.** Five-run wall-clock **2.2–3.4 s** against a
  baseline median of 8.2 s.
- **Quality checked on the hardest flows, not assumed:** the three-turn swap (list →
  `findSwapCandidates` → correct `proposeChange`), create-an-exercise-with-muscles (correct
  `Hamstrings, Lower back` + `Barbell`), and a six-tool progression analysis that still returned real
  numbers. `low` is the fallback if a regression appears — it measured 1,305 tokens / 6.5 s.
- **Two levers were measured FIRST and both made it worse. Do not re-try without new evidence:**
  - *Inlining the program into the system prompt* — removed the `getProgramStructure` round trip and
    still came out **~1.1 s slower** (9.7 s vs 8.6 s mean). A bigger prompt on every turn costs more
    than the call it saves. `lib/coach/program-brief.ts` was written, measured and deleted.
  - *A sentence before every tool call* — first text at ~4.2 s instead of ~9 s, but the widget slipped
    to ~12 s. Earlier reassurance is not worth a later button.
- **The lesson worth keeping:** the first two attempts were guesses at *where* the time went. The
  token log answered it in one query. **Measure the output-token count before optimising an LLM
  route** — wall-clock alone cannot tell reasoning from generation.

> **Q-141 removed 2026-08-11 — the bug was real, the route was not.** The entry targets
> `/api/ai-chat` and `components/chat.tsx`, which **no UI links to any more**: every entry point now
> goes to `/coach` (`overview-screen`, `coach-fab`, `done-screen`), and `/sheet/[id]/chat` only
> redirects to the orphaned `/chat`. Re-checking before implementing found something worse on the
> live surface, which was fixed instead (v1.281.0): **Coach's system prompt instructed a chart it had
> no way to draw.** Asked "show my body weight progression over time on a chart", it emitted no chart
> and a `renderChoiceList` of colour-keyed date ranges — the prompt's chart-pairing rule firing with
> the chart half missing, so the user got a *legend for a chart that does not exist*, as tappable rows
> that do nothing. Coach now has a `renderChart` widget; measured on the same prompt, it returns a
> real line series. See
> [`docs/overview/overview/history-2026-08-08.md`](overview/history-2026-08-08.md).
> **Not covered by that fix, and deliberately not filed as a new entry:** the dead `/chat` surface
> itself. It is unreachable rather than broken, and deleting it belongs with the "old pair is
> deleted" cleanup already described in `app/api/coach/route.ts`.

### [activity][devices][platform] ✅ Q-139 — `resolveDsToMs` compresses ring time by up to 18× during a backlog drain — FIXED FORWARD 2026-08-08

**Status: SHIPPED (option 2 — fix forward, no backfill; owner decision 2026-08-08).** `resolveDsToMs`
no longer interpolates between anchors: it applies the fixed 100 ms/ds slope with one robust
(p10-of-lag) offset per epoch, which removes the compression outright and makes the mapping
monotonic in `ds` — something the interpolating version could not promise. The sibling gap named
below shipped with it: `mergeStepCounterWithLive` now applies `isPlausibleStepWindow` to **model**
windows too, not just live ones. **Stored history was deliberately NOT rewritten**, so the last ~35
days read inconsistently with everything after the deploy — that is the accepted cost of option 2,
and the read-only `previewStepsBackfill` is still there if the owner ever wants to see the size of
the drift. Original analysis kept below, because Q-71 shares the anchor model and will want it.

**Superseded framing:** Found 2026-08-07 investigating an owner report that app steps read higher than the
Samsung Health phone count. **The step gap was not the bug** — see "What this does NOT fix". This is.

#### The defect

A clock anchor is `(batch max ds, server receive time)`, so its *lag*
(`anchorUtcMs − anchorDs × 100`) is however long that batch took to reach the server.
`resolveDsToMs` (`lib/oura-ble/clock.ts:70`) interpolates linearly between the two anchors
bracketing a ds, so the local time-scale it applies is `Δutc / Δds`. While the ring drains buffered
history, ds advances far faster than the wall clock and that ratio collapses. Ring time is squeezed;
the steps inside it pile up.

**⚑ MEASURED 2026-08-07 on real production frames.** The reproduction is exact — replaying the
rollup's own `computeStepsByDay` over the same anchors and frames returns **4,178** against the
stored **4,176**, so nothing below is inferred.

| | value |
|---|---|
| anchor-lag spread over the day's ds range (n=99 anchors) | **56.2 min** |
| lag p0 → p10 | 1.4 min — a sharp lower edge with a long upper tail |
| worst observed compression | Δds 17,094 (**28.5 min** of ring time) → **95 s** of wall clock (~18×) |
| paired windows landing in one 60 s block (should be 2 at the 30 s cadence) | 79 @ 11:42 · 70 @ 10:41 · 66 @ 14:01 · 60 @ 17:11 |
| resulting 60 s step windows | **1,555** · 664 · 268 steps — the top one is 26 steps *per second* |

`resampleSteps` folds per-sample steps into fixed 60 s wall-clock blocks, so every window squeezed
into a block sums there. That is the mechanism turning a compressed timeline into an impossible
step rate.

#### Blast radius — steps only (corrected 2026-08-07)

An earlier draft of this entry said the fix would move sleep boundaries and HR bins. **It will
not.** The two converters are separate and only one of them compresses:

| Converter | Used by | Failure mode |
|---|---|---|
| `resolveDsToMs` (interpolates between anchors) | `lib/oura-ble/step-day-buckets.ts` (→ the steps rollup write **and** `previewStepsBackfill`), `app/api/oura-ble/step-counter-export` (admin console) | **This bug** — local time-scale collapses during a drain |
| `measuredAtMs` (fixed 100 ms/ds slope from one anchor) | everything else the rollup writes — sleep session start/end, HR bins, temperature, and its own `dayForDs` | Q-71 — whole timeline offset by that one anchor's lag. Cannot compress: the slope is constant |

So fixing `resolveDsToMs` touches **the step total and the admin step console, and nothing else.**
That is a materially smaller and safer change than Q-71, which is the one that moves sleep.

#### What this fixes

1. **Physically impossible step windows stop being produced.** With a corrected clock, 2026-08-07
   goes from three implausible windows to **zero**.
2. **The intra-day step timeline becomes true.** Steps currently land up to ~28 minutes from when
   they happened, and cluster into false bursts. Any surface reading step *timing* rather than the
   daily total is wrong today — hourly movement, the step sparkline's shape, and anything that
   correlates steps against the HR chart.
3. **Day-boundary assignment gets more reliable.** `dayForDs` derives the local day from this same
   conversion, so a distorted clock can file a step window under the wrong date near midnight.
4. **It unblocks a correct Q-71.** The right fix here — a robust, non-interpolating offset — is also
   the right fix for Q-71's paths, which would let one converter serve both instead of trading
   Q-71's offset error for this compression error.

#### What this does NOT fix

- **It does not close the gap to Samsung Health, and moves the ring further from it.** Corrected,
  2026-08-07 reads **4,652** against the phone's 3,376 (uncorrected: 4,178). That direction is
  expected — a finger-worn sensor counts movement a pocketed phone never sees — and the owner has
  already said the difference is acceptable. **No step tuning or scale factor is warranted**; the day
  is 100 % `step_counter` over ring frames (`body_metrics.source_map->>'steps'` = `oura_ble`, and
  `step_live_windows` has held no row since 2026-07-28), so no phone or Health Connect value is even
  in the mix. If a calibration is ever wanted, collect several days of paired ring/phone counts
  first — one day is not a calibration.
- **It does not correct already-stored inflated days.** See the monotonic guard below.
- **It does not touch sleep, HR or temperature.** Those are Q-71.

#### What happens if we don't

- **The daily step number stays roughly right.** This is the honest reason it is not urgent:
  compression redistributes steps in time far more than it changes the total. Measured on two days,
  correcting moved 2026-08-07 by +474 (4,178 → 4,652) and 2026-08-06 by +13 (1,232 → 1,245). Only
  two days were measured — the spread across a wider window is unknown.
- **The step timeline stays wrong, every day.** This is not a rare event tied to one bad sync: on
  2026-08-07 the crowding appears at 10:41, 11:42, 14:01 and 17:11. Any drain of buffered history
  reproduces it, so it recurs whenever the ring is out of range for a while and then re-syncs.
- **Impossible values keep reaching the database**, and the monotonic guard makes some of them
  permanent (below). Each one is a day that can only be repaired by an owner-gated backfill.
- **Q-71 stays booby-trapped.** Anyone who implements Q-71 as currently written — swap the
  sleep/HR/temperature paths onto `resolveDsToMs` — will spread this compression to sleep boundaries
  and HR bins while believing they are fixing an accuracy bug. That is the most expensive outcome of
  leaving this unrecorded, and it is why Q-71 now carries a pointer here.

#### Interaction with the monotonic step guard (read before choosing an option)

The rollup recomputes a **35-day** window (`ROLLUP_WINDOW_DAYS`), but the write is guarded by
`mergedSteps > existingSteps` (`lib/data/postgres/adapter.ts`) — it can only ever *raise* a stored
value. So a clock fix is **not** "future days only":

- Days where the corrected total is **higher** are silently raised, across the whole 35-day window.
- Days where the corrected total is **lower** keep the old inflated value forever, unless the fix
  ships with `allowStepsDecrease` — which is the destructive, owner-gated backfill path.

Both measured days moved *upward*, so the likely outcome is a batch of recent days drifting up on
the first rollup after deploy. That should be expected and communicated, not discovered.

#### The decision (owner)

| | Pros | Cons |
|---|---|---|
| **1. Leave it** (status quo) | Zero risk. Daily totals are approximately right. Nothing to verify on device. | The timeline stays wrong daily; impossible values keep landing; Q-71 stays booby-trapped. |
| **2. Fix forward, no backfill** *(recommended)* | Correct timeline from deploy onward. Blast radius is steps + the admin console only — **sleep and HR are untouched**. No destructive migration. | The last 35 days drift upward wherever the corrected number is higher, so recent history reads inconsistently with older history. Days that should come *down* stay inflated. |
| **3. Fix + `allowStepsDecrease` backfill** | Internally consistent throughout; the already-open "three days hold inflated step totals" issue could close in the same pass. | Destructive and irreversible — it rewrites stored step history. Needs an explicit preview-then-authorise step (`previewStepsBackfill` already exists and shares `computeStepsByDay`, so preview and write cannot drift). |

**Recommended: option 2**, with the preview from option 3 run first as read-only evidence so the
size of the 35-day drift is known before deploy rather than after.

#### Implementation direction (not yet decided in detail)

- The lag distribution's **sharp lower edge** (p0 → p10 is 1.4 min against a 56.2 min full spread) is
  why a minimum-lag offset is the right estimator: an event cannot be received before it happened, so
  the floor of the distribution is the honest clock offset and the tail is pure receive latency.
- Use a **robust low percentile** (not the raw minimum) over a sliding ds window, so one glitched
  anchor cannot define the offset for a whole span.
- **Do not interpolate between two anchors whose lags disagree.** The slope between anchors is not
  information — the ring's ds ticks at exactly 100 ms by construction. Only the offset is unknown.
- **Fold in the sibling gap while here:** `mergeStepCounterWithLive`
  (`packages/shared/src/health/step-estimate.ts`) applies `isPlausibleStepWindow` to **live** windows
  only — model windows go through unfiltered, which is what let the three impossible windows above
  reach the daily total. Worth closing as a backstop even though a correct clock would not have
  tripped it on 2026-08-07.
- **Verification:** the analysis above is server-side only — replaying production frames through the
  real pipeline. **Nothing was checked on device.** Steps are an offline-first domain, so the
  device-verification gate applies before this can be called done.

### [platform] ⏳ Q-181 — a schema per vitest worker: WATCH ONLY, deferral re-confirmed by measurement

- **Branch:** `test/db-per-worker-schema` (unclaimed)
- **Added:** 2026-08-10 · what Q-177 concluded rather than what it left undone
- **The open question is unchanged:** every DB test shares one `trainingai_dev` (CI: `trainingai_ci`),
  and vitest runs files in parallel workers. The durable answer would be a schema or database per
  worker (`search_path`, or `CREATE DATABASE … TEMPLATE`), rather than chasing shared state one
  writer at a time.
- **It was NOT built, and that is a finding, not an omission.** Q-177 set out to build it and
  measured first. Every instability actually observed has had a specific, locatable cause that the
  per-worker isolation would have hidden rather than fixed:
  1. A data migration running table-wide in a parallel worker (Q-171) — fixed by an advisory lock.
  2. **Four TEST_USER_ID collisions across nine DB-touching files** (Q-177) — two of them both
     running `DELETE FROM users WHERE id = $1` on the same id, with **55 of 58 FKs onto `users.id`
     cascading** (proven against the live schema, not read off `schema.ts`). Fixed by unique ids +
     `scripts/check-test-user-ids.js`.
  3. `implausible-cadence.test.ts` failing **2 runs in 10 alone** — two unrelated defects in one
     file: a 4.2 s module import billed to the first test's 5 s budget, and a rate-limit bucket that
     **persists in the `rate_limits` table** across runs. Both fixed; 0/12 after.
- **None of those is "two ordinary suites colliding on rows"** — the hypothesis that motivated the
  per-worker work. Isolation would have made all three invisible instead of fixed, and this same
  session already saw speculative harness hardening (a blocking `pg_advisory_lock`) cost more than
  it bought.
- **The trigger to build it:** an instability that the three causes above do not explain — in
  particular, two files failing on each other's *rows* with distinct user ids and no migration
  involved. Until then, the cheap detectors are the better spend.
- **If it is built:** measure the baseline first (`npx vitest run lib/data/postgres/__tests__`, ~6
  runs — it was 72–107 s wall, 387 tests, 0 failures on 2026-08-10), and note that
  `CREATE DATABASE … TEMPLATE` needs no other session connected to the template, so the per-worker
  databases have to be created in `globalSetup` before workers start, not lazily.
- **⏳ Deferral RE-CONFIRMED 2026-08-14, and the evidence got stronger rather than staler.**
  Re-measured against the same command: **89 files / 545 tests, 3 consecutive runs, 0 failures**, at
  **86–88 s** wall. Compare the 2026-08-10 baseline this entry recorded — 387 tests at 72–107 s. The
  DB suite has grown **+41% in tests** since the deferral was taken, which is *more* parallel
  pressure on the same shared database, and the spread got **tighter**, not wider. `check-test-user-ids`
  reports 72 DB-touching files, all ids distinct. No journal entry since 2026-08-10 reports an
  instability outside the three known causes.
- **⚠️ One unattributed failure observed 2026-08-15, hours after the re-confirmation above.** Running
  the **full** suite against a `main` carrying ~20 merges from two parallel lanes: **1 failed /
  3,906 passed**, then **three consecutive clean runs** of 472 files / 3,907 tests. **The identity of
  the failing test was lost** — the run was tailed to the summary line only, so there is no name and
  no assertion to attribute it to. That is a data-collection error, recorded as such.
  **Why it is here rather than discarded:** it is one observation, it is not any of the three known
  causes (no concurrent suite, `rate_limits` cleared beforehand, no migration involved), and Q-181's
  trigger is precisely an instability those three do not explain. One occurrence is not the trigger.
  **Hunted the same day and not reproduced: six further full-suite runs, all 472 files / 3,907 tests
  clean** (three immediately after, three more with output captured to disk rather than tailed). So
  it is **1 in 7**, with six deliberate reproduction attempts against it — weaker evidence of a real
  flake than a bare "failed once" implies, and why this stays a note rather than becoming the trigger.
  **If a second unattributed full-suite failure is seen, that is two — treat this as the first, and
  capture the failing file name before re-running.** The earlier 3-run DB-subset measurement stands;
  this was the full suite, which that measurement did not cover.
- **Kept as a watch item rather than completed**, because the trigger above is still live and
  deleting the entry would lose its definition. Nothing to implement today.
- **Do NOT paper over any of it with `retry: 2`.** A flaky red on an unrelated PR is exactly how a
  real regression gets waved through as "that test again" — CLAUDE.md already records a genuine
  deterministic CI failure being nearly dismissed as noise.

### [app-shell] Q-154 — three inline sparklines remain, and the primitive cannot draw any of them yet

- **Branch:** `refactor/day-sections-use-sparkline-primitive`
- **Added:** 2026-08-08 · [review §9.3](reviews/2026-08-08-claude-md-and-test-suite-review.md) ·
  **rewritten 2026-08-09 after reading all six files**
- **Half the list was misclassified, and converting those three would have been a bug.**
  `components/ui/sparkline.tsx` projects x by **index** (`step = width / (values.length - 1)`).
  Three of the six draw a **time** axis, so redrawing them through the primitive would move every
  point that is not evenly spaced:
  - `health/day-detail/day-sections.tsx` — `x = minute / 1440`, a fixed whole-day axis so the
    overnight trough sits where the night was. It **already carried that reason in a comment**; the
    "sixth copy" framing read past it.
  - `activity/exercise-review-sheet.tsx` — `x = (timestamp - startMs) / durationMs`.
  - `body-battery-card.tsx` — `x = (t - t0) / span`, plus a 50% guide line and wall-clock labels.

  All three are now `EXEMPT` in `scripts/check-sparkline-primitive.js`, the same category
  `live-hr-chart.tsx` already sat in for exactly this reason. **Do not "replace on touch".**
- **The three that really are sparklines** — `exercise-history-sheet.tsx`,
  `health-metric-sheet.tsx`, `workout/active-workout-screen.tsx` — are blocked on the primitive,
  not on effort. Each needs something it does not have:

  | need | why the primitive can't |
  |---|---|
  | value label on the last point | no such prop (2 of the 3 draw one) |
  | `strokeWidth` | hardcoded `1.5`; all three draw at `2` |
  | emphasized last dot | `showDots` renders every dot at r=2.5, full opacity |
  | exact min/max scaling | it pads by **±0.5**, which halves the amplitude of a 0.5 kg body-weight spread |
  | grid lines | `exercise-history-sheet` draws three |

- **`SparklineChart` is not the answer either, and the reason is load-bearing.** It already draws
  this exact "1RM trend" shape (and `exercise-stats-sheet` + `exercise-summary-screen` use it), but
  it is **chart.js**. `active-workout-screen.tsx` imports no chart.js today, and CLAUDE.md's own
  performance rule forbids pulling it into a hot top-level screen. So the app has *two* sparkline
  primitives with overlapping purpose and neither fits all three call sites — **that** is the real
  finding, and it wants a decision before any conversion.
- **Done 2026-08-09:** the misclassification is fixed, and `health-metric-sheet.tsx`'s local
  component — which was **also named `Sparkline`**, so `grep -rn '<Sparkline'` counted its two call
  sites as uses of the primitive — is renamed `MetricTrendChart`.
- **What remains:** add the five props above to `components/ui/sparkline.tsx` (all defaulted, so
  its 20 existing call sites are unchanged), then convert the three. **Verify the amplitude change
  on real data** — the ±0.5 padding is the one that alters what a chart says, not just how it
  looks.

**Read all three side by side, 2026-08-10 — it is two convertible, not three, and there is a sixth
prop the list missed.** Attempted, then backed out deliberately rather than shipped half-verified.

|  | `exercise-history-sheet` | `health-metric-sheet` | `active-workout-screen` |
|---|---|---|---|
| padding | uniform `PAD` | uniform `PAD=10` | **asymmetric** `PAD_X`/`TOP`/`BOTTOM` |
| fill gradient | yes (0.28) | yes (0.25) | **no** |
| stroke | 2, opacity 1 | 2, opacity 1 | 2, **opacity 0.7** |
| dots | last r=4 + **halo ring r=7**, rest r=2.5 @0.45 | last r=4, rest r=2.5 @0.4 | **uniform r=3**, no emphasis |
| value label | — | anchor `middle` | anchor **`end`** |
| grid lines | **3** | no | no |

- **The first two are genuinely one component**, differing only in gradient opacity, the halo ring
  and grid lines. **The third is not**: asymmetric padding, uniform dots, no fill, dimmed line and
  an end-anchored label are four more props that *no other caller would use* — a pass-through
  wearing a primitive's name, which is the abstraction CLAUDE.md tells you not to add. Convert two;
  leave `active-workout-screen` inline with a written reason, and drop it from the to-convert list.
- **The missed prop is vertical padding.** The primitive bakes in `height * 0.1` / `height * 0.8`
  (10%); both convertible sites use `PAD=10` of `H=72` (~14%) with their own formula. Close, but it
  moves every point — and it decides whether the value label at `y - 8` clips at the top of the
  viewport when the last point is the series max. That needs a `padY` prop **and** a look at a real
  chart, which is why this was not shipped blind.
- **Still wants the decision the entry names above** (this primitive vs the chart.js
  `SparklineChart`) — nothing here resolves that; it only narrows the conversion from three files
  to two.

### [platform] 🟠 Q-155 — a cross-user data leak passes all 3,270 tests

- **Branch:** `test/repository-ownership-coverage`
- **Added:** 2026-08-08 · [review §11](reviews/2026-08-08-claude-md-and-test-suite-review.md)
- **Measured by mutation, not inferred.** Removing the `user_id` scope from
  `lib/data/postgres/adapter.ts:1852` (`getBodyMetricsBaseline`) — turning a user-scoped read into one
  that returns any user's row — leaves the suite fully green: **414 files, 3,270 tests, 0 failures.**
  The method is live, called by `app/api/progress-summary/route.ts:39` and
  `app/api/workout-sessions/[id]/energy/route.ts:40`.
- **Read this correctly:** the 2026-08-07 review certified ownership discipline clean *by reading*,
  and it was right — the scope **is** correct today. The gap is that **nothing would tell you if it
  stopped being right**, in the highest-severity class the project has.
- **Supporting signal, with its limits:** of 286 `async` repository methods, **180 (63%) appear in no
  test file by name**. That grep is a crude proxy — a method can be covered indirectly through a
  route test — so treat it as *where to look*, not as a count of untested behaviours. The mutation
  above is the hard evidence.
- **Also measured:** breaking a `scoreBand()` threshold fails exactly **1** test, for a formula
  CLAUDE.md names by name and 18 call sites consume. Caught, so not a hole — but thin.
- **Fix direction:** a focused ownership-scoping test per user-scoped repository read is a lot of
  tests for the value. Better: one table-driven test that enumerates the user-scoped read methods and
  asserts each returns nothing for a second user's id. That catches the whole class in one place and
  fails loudly when a new unscoped method appears. **Do not install a coverage package as part of
  this** — that is a separate dependency decision.

**QUANTIFIED AND STARTED, 2026-08-09 — still open.** Full method in
[`docs/reviews/2026-08-09-ownership-mutation-coverage.md`](reviews/2026-08-09-ownership-mutation-coverage.md).
All **246** `user_id` predicates in the adapter and its slices were neutralised at once:
**286 of 317 DB tests still passed**, so ~90% of that suite is blind to a total loss of user
scoping. Per-file, **`nutrition.ts` (22 predicates), `body-battery.ts` (1) and `social.ts` (1) fail
ZERO tests** with every ownership check removed; a quartile bisect found two ranges of `adapter.ts`
(69 predicates) behaving the same. **Lower bound: 93 of 246 predicates unguarded.** The uncovered set
includes ten destructive writes (`deleteInjury`, `deleteSupplement`, `deleteActivityLog`,
`updateInjury`, `updateFoodLog`, `deleteFoodLog`, `deleteSavedMeal`, …) and the bulk mutations
`applyLbsToKgFix` / `reconcilePersonalRecord`. Note `updateInjury` is the method CLAUDE.md calls
*"the reference"* for the write-path ownership rule.

**Burn-down done for the zero-coverage slices (2026-08-09, second pass).**
`repository-ownership-scoping.test.ts` is now **30 tests**, each verified to fail under mutation.
Re-measured with the same harness: detecting tests **31 → 70**, detecting files **14 → 20**,
`adapter.ts` **23 → 42**, and **no slice sits at zero any more** — nutrition 0 → 12, body-battery
0 → 1, social 0 → 2.

**Third pass (same day) closed the named remainder.** The bulk mutations and the last named write
methods are covered — `previewLbsToKgFix`, `applyLbsToKgFix`, `reconcilePersonalRecord`,
`updateActivityLogMetrics`, `updatePrescribedRun`, `updateGoalRecommendationStatus`. **36 tests**, all
verified failing under mutation. Re-measured: all-246 detection **31 → 75**, detecting files
**14 → 21**, `adapter.ts` **23 → 44**, and the two dead quartiles **0 → 13** and **0 → 7**.
**No quartile and no slice is at zero.**

**Why this stays open anyway.** "No range at zero" is a much weaker claim than "all 246 covered": the
quartile bisect *bounds*, it does not attribute, and a range producing 7 failures is not 34 covered
predicates. Exact per-predicate attribution needs ~246 individual runs (~5.5 h). Also untouched by
this method entirely: ownership enforced by a **join or a pre-check** rather than a `user_id`
predicate (`ensureWorkoutSession` is the pattern), and the ~3,270-test full suite, of which only the
363 DB tests were measured.

**Mechanised the omission half, 2026-08-09.** `scripts/check-repository-user-scoping.js` (Custom
Rules) fails any method in the adapter or its slices that takes `userId: string` and never uses it —
the `getBodyMetricsBaseline` mutation, made permanent. **368 methods take `userId`; all 368 use it**,
so it passes clean today and its whole value is what it stops tomorrow. Mutation-verified against
that exact method, plus four unit tests over synthetic trees. **It does not narrow the residual
below**: it catches an omitted scope, not a wrong one, not a join that mentions `userId` without
constraining, and not a pre-check that exists but is wrong. Those are still only covered where a
hand-written case names them.

**Read this before adding to that file:** two of the nine tests **could not fail** as first written —
`getBodyBatteryHistory` returns a row shape with no `userId`, so asserting `not.toContain(USER_B)`
was unfalsifiable, and it survived the mutation run that killed the other eight. Assert *emptiness*
against a freshly-created user, and **check every new case by mutation before counting it as
coverage**.

**Re-counted 2026-08-14: the figure below is 13 and is now 15** — `meal_plan_variants` and
`meal_plan_meals` were added by Q-186 on 2026-08-11, *after* that count, so the sweep was
structurally blind to them too. **Both turned out to be covered already**, by
`meal-plans.test.ts` ("will not edit a meal owned by another user — the join is two levels deep",
"will not restructure another user's", "will not write ingredients onto another user's"), and
Q-187's `plan-meal-answers.test.ts` adds a third reject/permit pair over the same two-level join.
So this correction **closes** a suspected gap rather than opening one — recorded because a stale
count sends the next session hunting for a hole that is not there. The residual below is unchanged.

**The join/pre-check class was opened 2026-08-10 — and it is bigger than "also untouched by this
method" suggested.** Counted from the schema: **13 tables have no `user_id` column at all**
(`session_exercises`, `exercise_logs`, `set_logs`, `style_sets`, `program_sessions`,
`program_phases`, `schedules`, `schedule_days`, `saved_meal_items`, `program_volume_targets`,
`exercise_media`, `friendships`, `exercise_gif_cache`), so for every one of them the 246-predicate
sweep was structurally blind. **Two are now covered** — `removeSessionExercise` (join through
`program_sessions → programs`) and `ensureWorkoutSession` — each as a reject/permit pair verified by
mutation. **No hole was found**, and two that looked like holes are not: `removeSessionExercise`
deletes by bare id but has its pre-check directly above (a grep for the DELETE misses it), and
`renameExercise`'s cross-user UPDATEs key on `exercise_library.name`, which is globally UNIQUE, so
they are shared-catalogue maintenance rather than a leak. See
[the journal entry](overview/history-2026-08-08.md).
`ensureWorkoutSession` is the one to protect hardest: a caller that adopted another user's session
id goes on to write `exercise_logs` and `set_logs` into it, and neither table has a `user_id` to
stop it.

**The pre-check/join class is CLOSED for all 13 tables, 2026-08-12.** The remaining eleven are
covered by 13 new cases — `saveProgressionStyle` (`style_sets`), `updatePhaseSet`
(`program_phases`), `updateSavedMeal` (`saved_meal_items`) and `saveProgram`
(`program_sessions`/`schedules`/`schedule_days`), each the parent-row-count-guard shape CLAUDE.md
names; plus the three `friendships` methods, which are scoped by `requester_id`/`addressee_id` and
so are invisible to **both** the 246-predicate sweep and
`scripts/check-repository-user-scoping.js`. Every guard was correct already — nothing here is a
fix — and every reject case was verified by breaking its own guard and observing **exactly one**
failing test. `exercise_media` and `exercise_gif_cache` are deliberately excluded as
shared-catalogue maintenance (keyed by exercise name, no per-user row, admin-written), the category
`renameExercise` sits in. See
[the journal entry](overview/history-2026-08-12.md).

**What keeps Q-155 open is now only the two residuals named above** — exact per-predicate
attribution across the 246 (~246 runs, ~5.5 h), and the fact that only the DB tests have ever been
measured, not the ~3,300-test full suite.

### [app-shell] ⏳ Q-151 — WATCH ONLY, nothing to implement — the sign-in React #418 did not reproduce and the whole series stopped

- **Skip this when working the queue top-down.** It is a dated re-check, not a task.
- **Added:** 2026-08-08 · [review §2](reviews/2026-08-08-running-app-review.md) ·
  **investigated and refuted 2026-08-08**, see
  [`docs/overview/overview/history-2026-08-07.md`](overview/history-2026-08-07.md)
- **As filed:** `/sign-in` carries a second, still-live React #418 hydration mismatch, and Q-73 closed
  only the home instance, so the highest-count production error stays open. Three measurements say
  otherwise.
- **1. Production has never recorded a #418 on the sign-in page.** Not once:
  `0` of `272` rows, against `/` (234), `/more` (15), `/health` (13) and four `/workout` URLs. The
  count the entry attributes to `/sign-in` belongs entirely to authenticated app routes.
- **2. The series stopped at Q-73's deploy.** Last #418 anywhere: **2026-08-07 20:53 UTC**. #1130
  merged **21:12 UTC**, 19 minutes later. Nothing since. Daily counts for the fortnight before were
  1–13 (12 on 08-03, 13 on 07-28), so zero is a real break in the trend and not a quiet week.
- **3. It does not reproduce.** `/sign-in` loaded signed out in a scripted browser at 412×915, in
  **both** a dev server and a **production `next build`**, under four localStorage states (none,
  `theme=light`, `theme=dark`+`ta_brand_hue`, `ta_brand_theme=violet` — the states that make the
  inline theme script mutate `<html>` before hydration, which is the mechanism the entry suspects).
  **Zero console messages of any kind, all eight runs.** The page's three candidates were read and
  cleared too: `Meteors` renders empty on the server and fills in from `useEffect`, `Typewriter`
  starts from `""`, `GoogleSignIn` does everything in a click handler.
- **The honest limits of this.** (a) **One clean day** against a ~4/day baseline is a good signal
  paired with a matching deploy boundary and a causal fix, but it is one day — *something that
  stopped is not something that was fixed*. (b) The signed-in home path could **not** be exercised
  under a production build here: `NODE_ENV === 'production'` hard-forces `ssl` on in
  `lib/data/postgres/client.ts:16`, and the local Postgres refuses SSL, so login fails against
  `next start`. Home-after-Q-73 is therefore argued from telemetry, not reproduced locally.
- **The re-check, which is all that is left:** run the standing `error_events` query about a week
  after 2026-08-08. **If #418 has returned, the row's `url` names the route** — file a fresh entry
  against that route with the evidence. If it is still zero, delete this entry; Q-73 closed the class
  and this was a misattribution.

### [devices][platform][sleep] 🟡 Q-71 — the rest of the ring rollup still converts ring time from one anchor — CODE SHIPPED 2026-08-12, historical redecode still owed

- **⚑ Re-scope condition from below is now satisfied.** This entry was blocked pending Q-139's
  decision on whether `resolveDsToMs` should interpolate or use a robust offset. **Q-139 shipped
  2026-08-08**: `resolveDsToMs` no longer interpolates — it applies the fixed 100 ms/ds slope with a
  single **p10-of-lag robust offset per epoch** (`lib/oura-ble/clock.ts:78`, `robustOffsetMs`), which
  cannot compress and is stable regardless of which anchor happens to be newest when it's called. That
  is exactly the "robust, non-interpolating offset" this entry's own note said would be the right fix
  for sleep/HR/temperature too. Two entries, one converter, as predicted.

- **⚑ MEASURED 2026-08-12 — tested against real production data before writing this, not assumed.**
  Traced a live owner report (a night's displayed bedtime/wake time looked ~45–75 min off, then kept
  changing — three different values across three rollup re-runs of the *same* stored night: 23:46:54,
  then 23:30:05, then 22:50:07, each using a newer "current anchor" per the existing `measuredAtMs`
  single-anchor extrapolation `toDate` still uses). Confirmed the mechanism precisely at the write site
  (`insertOuraRawSamples`, `lib/data/postgres/adapter.ts:4655`): `anchorUtc = new Date()` stamps
  **server batch-receive time**, and the plugin drains a backlog in ~255-event sequential POSTs
  (`docs/oura-ble-operations.md` §2) — during any drain, several batches covering very different ds
  ranges all land within seconds of each other, each minted as its own anchor. That is the "burst"
  pattern already on record in this entry's own 2026-08-04 measurement, now traced to its source.
  - **Tried plain `resolveDsToMs`-style bracket interpolation first (the pre-Q-139 shape) — it made
    things WORSE, not better**, confirming Q-139's original finding rather than contradicting it: run
    against the 9 most recent real nights (2026-08-04→12), every single one shifted **later** by
    10–48 minutes (one outlier +79 min), because the "bracketing" anchors are frequently from the same
    burst and don't actually bracket anything meaningful. **Do not re-attempt naive interpolation** —
    this is the second independent measurement landing on the same conclusion Q-139 already reached.
  - **Then ran the actual shipped `resolveDsToMs` (Q-139's p10-offset method) against the same 9
    nights, using all 2,844 real epoch-2 anchors** — clean, stable, and small:

    | Night | Currently stored | With `resolveDsToMs` | Shift |
    |---|---|---|---|
    | 08-04 | 10:36 PM – 7:41 AM | 10:33 PM – 7:38 AM | −3m / −3m |
    | 08-05 | 9:57 PM – 7:07 AM | 9:55 PM – 7:05 AM | −3m / −3m |
    | 08-06 | 10:16 PM – 7:56 AM | 10:13 PM – 7:53 AM | −3m / −3m |
    | 08-07 | 10:16 PM – 6:26 AM | 10:14 PM – 6:24 AM | −3m / −3m |
    | 08-08 | 10:10 PM – 6:10 AM | 10:07 PM – 6:07 AM | −3m / −3m |
    | 08-09 | 10:21 PM – 7:25 AM | 10:18 PM – 7:22 AM | −3m / −3m |
    | 08-10 | 9:51 PM – 5:34 AM | 9:48 PM – 5:31 AM | −3m / −3m |
    | 08-11 | 10:26 PM – 7:21 AM | 10:23 PM – 7:18 AM | −3m / −3m |
    | 08-12 | 10:50 PM – 7:35 AM | 10:47 PM – 7:32 AM | −3m / −3m |

    Every night shifts by exactly the same 3 minutes, both edges — the signature of a real, consistent
    transport-lag correction rather than noise, and (unlike the current `measuredAtMs` path) a
    **stable** answer regardless of when the rollup happens to run, since it's a percentile over the
    whole epoch's anchors rather than whichever one is newest right now.

- **✅ Owner decision made 2026-08-12: rewrite stored history too, conditional on seeing the numbers
  first.** Owner's exact words: *"happy to rewrite history as long as we see it doesn't change the
  times incorrectly"* — the 9-night comparison table above (shown before any code was written) is
  that evidence. Re-checked immediately before shipping: anchor count unchanged (2,844) since that
  measurement, so the same uniform −3m result holds.
- **✅ Code shipped 2026-08-12.** `aggregateOuraRawSamples`'s `toDate` (`lib/data/postgres/adapter.ts`)
  now routes every ds→wall-clock conversion for sleep/HR/temperature through `resolveDsToMs` and the
  full per-user anchor list (`getOuraClockAnchors`), instead of `measuredAtMs` off a single newest
  anchor. The redundant second `getOuraClockAnchors` fetch in the same function (steps path) now
  reuses the one list instead of re-querying. Verified against the full local DB-backed rollup suite
  (21 files / 57 tests, including the anchor-drift regression test, which stays valid because with
  exactly one anchor `resolveDsToMs` and the old `measuredAtMs` path are mathematically identical) —
  all green, plus the full repo suite (3,186 passed) and clean typecheck/lint.
- **⛔ Still open: this PR only fixes *future* rollups.** It does not touch already-stored
  `sleep_sessions` rows. Per the owner decision above, an admin **Redecode** (full, not `dump`) needs
  to run in production after this deploys to rewrite history — `POST
  /api/oura-ble/samples/redecode` with no `date` param, which forces `fullHistory: true` and
  reprocesses everything. This is session-auth-gated (no bearer-token path exists for this route,
  unlike `/api/admin/db-query`), so it needs the owner (or a session with their login) to trigger it
  from the admin oura-ble tester, not an unattended script.
  1. ~~Does this fully fix the live-drift symptom, or only shrink it?~~ **Answered by the fix design
     itself, not just the measurement**: the old symptom (16–79 min swings, a different answer every
     rollup run) was caused by `measuredAtMs` picking whichever single anchor was newest at call time.
     `resolveDsToMs`'s percentile is computed over the *whole epoch's* anchors, so it can only move
     as new anchors get added to that pool — one new anchor among thousands can't swing the p10 by
     tens of minutes the way replacing "the one anchor in use" could. The instability is structurally
     gone, not just smaller on this sample.
  Full session writeup: [`docs/overview/overview/history-2026-08-12.md`](overview/history-2026-08-12.md).

- **What this does NOT fix, and can't from the server side.** The root defect is that `anchorUtc` is
  stamped at server batch-receive time, not true ring-capture time — no math on top of that recovers
  data that was never recorded. A materially better anchor (phone-side receive timestamp sent with
  each batch, or a live ring-clock poll independent of a backlog drain) needs a native (Kotlin) change
  and a new APK. `resolveDsToMs`'s robust offset is the best fix available without touching native
  code — it removes compression and run-to-run instability, not the underlying transport lag itself.

- **Branch:** `fix/rollup-nearest-anchor-sweep`
- **Added:** 2026-08-04, split out of Q-56 rather than folded into it (see
  [`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md)).
- **The gap:** Q-56 converted the **step** path to nearest-anchor resolution (`resolveDsToMs`) plus a
  future guard. `toDate` in `aggregateOuraRawSamples` (`lib/data/postgres/adapter.ts:4696`) is still
  `measuredAtMs(ds, newestAnchorDs, newestAnchorUtc)` — bare, unbounded linear extrapolation from
  whichever anchor is newest — and it is the shared converter for **everything else the rollup
  writes**: sleep session start/end, HR bins, temperature samples, and its own `dayForDs` at 5256.
  Production anchor rows show ring time running ~15 minutes ahead of wall time per re-stamp during a
  drain, so the same unbounded skew Q-56 removed from steps is still live on those paths.
- **Why it was NOT folded into Q-56:** it looks like a one-line change and is not. It would move
  sleep-session boundaries across the whole rollup, and the owner's wake times had just been
  corrected the same day by an unrelated fix (`denseSensingSpan`, v1.252.8). Shifting the clock
  underneath that, unverified, is how a fix becomes a regression.
- **⚑ MEASURED 2026-08-04 — historical record, superseded by the 2026-08-12 measurement above.** Kept
  because it's what first found the "error grows with distance" pattern and the burst artifact this
  entry later traced to its source. Method that works: take the 400 most recent real
  `oura_raw_samples.ring_timestamp_ds` values in
  epoch 2 and convert each **both** ways from `oura_ble_clock_anchors` — newest-anchor linear
  extrapolation (what `toDate` does today) vs interpolate-between-bracketing-anchors (what
  `resolveDsToMs` would do). No inverse, no assumptions.

  | | seconds |
  |---|---|
  | min | 0.0 |
  | **median** | **304.1 (~5 min)** |
  | p95 | 578.8 (~9.6 min) |
  | max | 609.1 (~10 min) |

  And that is the *recent* window, where the newest anchor is closest. Frames further back diverge
  further — the error grows with distance from the newest anchor, exactly as `lib/oura-ble/clock.ts`
  says in its header.

  **Method that does NOT work, recorded so it isn't repeated:** deriving a ds from a stored
  `sleep_start` by inverting the newest-anchor formula, then re-resolving it. That uses the broken
  conversion to build its own input, so the error compounds — it produced deltas of *4.7 days* for
  two-week-old nights, which is an artefact of the method, not a finding. Also note the
  `/api/admin/db-query` endpoint truncates at **1000 rows**: an `ORDER BY ... ASC` over the anchors
  table silently drops the newest ones, which is precisely the data the analysis needs.

  **The direction is a correction, not a regression** — the interpolated value is the more accurate
  one. But ~5 minutes is visible on a sleep card, it only applies to *future* rollups (stored rows
  keep their values unless re-decoded), and it would therefore make new nights read ~5 min different
  from old nights. That inconsistency is the owner's call, not a judgement to make for them,
  especially the week their wake times were wrong twice.
- **Also open on that path:** `oura_raw_samples` carries a per-row `epoch` column that the step and
  rollup queries do not select, so every frame resolves against the *current* epoch. Not a regression
  (behaviour across a ring reset is unchanged), but it is the honest completion of this work.

### [sleep][readiness] 🔴 Q-72 — the Sleep Score cannot tell a good night from a bad one (MEASURED, needs an owner decision)

- **Added:** 2026-08-04. Started as *"put the sleep rating on the morning check-in"* (the owner's
  idea). **That turned out to be already built** — `MorningCheckinSheet` has collected
  `sleepQualityFeel` (1–5, 1 = best) since at least 2026-07-03, and
  `/api/admin/sleep-feel-calibration` already reads exactly that column. The owner has been rating
  their sleep every morning for a month without knowing it fed calibration. **No UI work needed.**
- **So Q-3b is NOT data-gated any more.** Its entry says *"No code without that data. ⛔ owner/data-
  gated"* — there are **32 rated nights** in production (2026-07-03 → 2026-08-04, every morning
  check-in rated). Strike that gate.

**The measurement, run 2026-08-04** — production `sleep_sessions` through the real
`computeSleepScoreSeries`, paired against `day_checkins.sleep_quality_feel`, longest session per
date:

| | value |
|---|---|
| paired nights | 32 |
| **Sleep Score** | mean **91.3**, sd **4.4**, range **80–98** |
| owner's feel (1 = best) | mean 2.59, sd 0.78, range **1–5** |
| correlation | **r = −0.354** |

The sign is correct (a lower feel number means a better night, so negative is the right direction)
and −0.354 is a real but weak relationship. **The finding is the variance, not the correlation:**
the score never left the 80s or 90s across an entire month, while the owner's experience used the
whole 1–5 scale. Concretely:

| date | felt | scored |
|---|---|---|
| 2026-07-26 | **5 (worst)** | 80 — the month's lowest, but still a "good night" number |
| 2026-07-21 | 4 (bad) | **93** |
| 2026-07-03 | **1 (best)** | 93 |
| 2026-07-17 | **1 (best)** | 92 |

A night the owner rated worst-of-month and a night they rated best-of-month score within a point of
each other. The score has ~18 points of dynamic range and spends all of it above 80.

- **⛔ Needs an owner decision before code.** Re-tuning the Sleep Score changes a number they read
  every morning, and "what should a bad night score" is a product judgement, not a fit. Two shapes:
  (a) rescale so the observed range spreads across 0–100, or (b) leave the score and add a separate
  "how it felt vs how it scored" signal. Do not pick one for them.
- **Method note for whoever runs this next:** join `day_checkins` to `sleep_sessions` on date and
  you get 37 rows from 32 ratings — five dates carry a nap as a second session, and pairing a
  morning rating against a 40-minute nap is meaningless. Take the longest session per date.

- **⚑ Updated 2026-08-07 — the mechanism is now known, which narrows the owner decision.**
  [`docs/reviews/2026-08-07-full-app-review.md`](reviews/2026-08-07-full-app-review.md) §6.4.
  Contributor-level sub-scores pulled from `/api/admin/day-review` across **91 days**
  (2026-05-09 → 2026-08-07) show the lost variance is not spread across the model — it is
  concentrated in **four contributors**:

  | contributor | n | mean | **sd** | at exactly 100 |
  |---|---|---|---|---|
  | `hrv` | 39 | 97.7 | **7.4** | **33/39** |
  | `hr` | 39 | 96.5 | **9.2** | **29/39** |
  | `schedule` | 47 | 97.0 | **4.9** | 16/47 |
  | `latency` | 43 | 92.5 | **7.6** | 0 |

  The other six **do** discriminate: `deep` (sd 19.0), `totalSleep` (18.7), `rem` (18.5), `timing`
  (13.0), `efficiency` (12.3), `restfulness` (10.0). So the model is not uniformly compressed — four
  inputs sit at their ceiling and dilute the six that work.
  - **This makes option (a) cheaper than it looked.** Rescaling need not touch the whole model:
    re-tuning or down-weighting these four is a smaller, more defensible change than a global
    rescale, and it preserves the contributors that already track the owner's experience.
  - **Also worth an owner note:** `hr` and `hrv` are present on only **39 of 56 scored nights** —
    17 nights were scored with neither contributor. Whatever is chosen, the score currently means
    something different on those nights than on the others.
  - **Control case, for confidence that this is calibration and not data:** on the same 91 days the
    Readiness pillar's contributors show healthy spread (`hrvBalance` sd 27.1, `sleepBalance` 26.2,
    `recoveryIndex` 23.0, `restingHeartRate` 15.9). Same ring, same nights, same pipeline.

- **⚑ PARTIALLY ADDRESSED 2026-08-13 (v1.304.0) — and measuring it corrected the diagnosis twice.**
  See [the journal entry](overview/history-2026-08-12.md).
  1. **It is three stuck contributors, not four.** Re-measured over 60 nights: `latency` reaches 100
     on **zero** of 48 nights. Its range is 61–99 — compressed, not pinned. Drop it from the list.
  2. **The curves were never the problem; the baseline was.** `hrv`/`hr` used a plain mean over
     *every* prior night. The owner's overnight HRV rose **24.8 → 62.7 ms** and average HR fell
     **74.0 → 60.2 bpm** across the record, so against an all-time mean of 47.2 ms every recent night
     scored **1.3–1.8×** better than baseline — past `HRV_RATIO`'s 1.1 ceiling. An all-time baseline
     structurally cannot track someone who improves. Re-tuning the curves, as this entry proposed,
     would have compressed them to manufacture spread around a wrong baseline.
  - **Shipped**: a 14-night trailing **median** (`SLEEP_AUTONOMIC_BASELINE_WINDOW_NIGHTS`), window
    chosen by measuring five options. `hrv` sd 5.2 → 12.9 and pinning 40/44 → 25/44; `hr` sd
    6.9 → 14.3. Worst-rated night 78 → 71.
- **⛔ WHY THIS STAYS OPEN, and what the next attempt must not assume.** The fix above did **not**
  move agreement with the owner's own ratings: r **−0.220 → −0.226**, and overall score sd is
  unchanged at 10.1. Un-pinning the contributors was necessary and insufficient.
  - **The correlation target is not a sound acceptance criterion as things stand.** Of 39 rated
    nights, **33 are a "2" or a "3"**; only 6 sit at the extremes. Correlation against a target with
    that little variance cannot move much whatever the model does — and this entry's headline
    r = −0.354 (n=32) reads −0.220 on 60 nights *before* any change. **Do not tune against r.**
    Whatever closes this needs a better yardstick first: more spread in the ratings, a different
    outcome to predict, or a rank-based measure over the extreme nights only.
  - `schedule` still pins (26/52) and was deliberately left alone — its baseline is a circular mean
    of habitual bed/wake times, where a long-run window is more defensible than for autonomic state.
  - **The open sub-question below is unchanged and still unanswered.**

- **⚑ OWNER DECIDED 2026-08-12: option (a), narrowed — re-tune the four stuck contributors.** Not a
  global rescale, and not a separate "felt vs scored" signal. Re-tune or down-weight `hrv`, `hr`,
  `schedule` and `latency` so they stop sitting at their ceiling and diluting the six that already
  track the owner's experience. The owner was told their nightly number will change and that bad
  nights will start scoring genuinely low, and accepted that.
- **Open sub-question the implementer must still resolve (do not guess):** `hr` and `hrv` are
  present on only **39 of 56** scored nights, so the score already means something different on the
  other 17. Down-weighting them changes that asymmetry rather than fixing it — decide and document
  what a night with neither contributor should score before shipping.

### [platform][workouts][nutrition] Q-168 — AI Coach follow-ups (Q-157 is complete)

- **Added:** 2026-08-09 · Q-157 shipped across four PRs (#1191, #1195, #1197, and phase 3b) and its
  entry is removed per this file's own rule that a finished item must never linger.
- **What Q-157 delivered:** five write domains (session exercises, macro targets, user goals,
  injuries, program phase), eight widgets, three confirmation tiers, thread + change history, undo.
  Journals: [`…-widget-protocol`](overview/history-2026-08-07.md) ·
  [`…-route-and-thread`](overview/history-2026-08-08.md) ·
  [`…-write-domains`](overview/history-2026-08-08.md) ·
  [`…-tier3-and-widgets`](overview/history-2026-08-08.md).

#### What is actually left

- **⛔ Device verification** — the blocking one. `/coach` and `/coach/confirm/[toolCallId]` are both
  navless full-screen routes with bottom-anchored controls, the shape that has regressed 11+ times.
  Run the **AI Coach** section of [`docs/device-smoke-checklist.md`](device-smoke-checklist.md) and
  strike the Known-Issues row in `projectOverview.md`.
- **Cardio goals** — planned for phase 3 and **not built**. Dropped rather than rushed: unlike the
  other domains it has no single stored field to patch (a 5k target implies a running plan and a
  weekly frequency), so it needs its own shape rather than a fifth case in the switch.
- ~~**Early deload via Coach**~~ — **done 2026-08-09, v1.274.0**, and not as the handoff this entry
  proposed. A link to the `EarlyDeloadCard` on `/session-select` would have been a dead end: that
  card renders only when `readiness.earlyDeloadRecommended` is already true, which is exactly when
  the user would not need to ask. Shipped instead as the sixth write domain, `early_deload`
  (tier 2, one boolean field — the server stamps the date, since which day "today" is depends on a
  timezone the model has no business deciding).
- **`/api/ai-chat` is NOT dead** — corrected 2026-08-09. `app/chat/page.tsx` → `components/chat.tsx`
  posts to it, and `app/sheet/[id]/chat` redirects there. The phase-2 note claiming it was
  unreferenced checked for overlay imports, not route callers. Retiring `/chat` is its own decision,
  not a Coach cleanup.
- ~~**A long widget prompt truncates** in the ChoiceList header~~ — **done 2026-08-09**, clamped to
  two lines rather than one.

**What remains here is device verification and cardio goals.** Both need the owner.

#### What it is

The assistant today has **fourteen read-only tools and zero write paths**. It can tell you your
deadlift has stalled and can do nothing about it. This gives it a widget vocabulary it renders
*inside the conversation* — say "change my workout" and it draws your session list rather than
asking you to type a name — and a confirmation flow for anything that writes.

Three phases, strictly ordered:

1. **Protocol + apply path.** Client-side tools (no `execute`) carry typed widget payloads;
   `ChoiceList` and `ChangePreview`; `POST /api/coach/apply` with re-validation against current
   state; `coach_changes` for history and undo. Ships with **no user-facing entry point**.
2. **Route + thread.** `/coach` as a full page replacing the 78vh sheet, `useChat` from the
   already-installed-and-unused `@ai-sdk/react`, the resolved-widget collapse, persistence, offline
   state, `gemini-3.6-flash` + search grounding, and repointing all four entry points.
3. **Write domains.** The remaining widgets and the rest of the approved scope, including the
   tier-3 pushed confirmation screen for phase changes and deload.

#### Three findings that change the build, recorded so they are not re-derived

- **Do not extend the `<sheet_chart>` in-text block pattern.** It survives for charts because a bad
  block silently disappears; a bad *input* widget would render an Apply button over an unvalidated
  patch. Use client-side tools, where the SDK schema-validates args and the model retries on
  mismatch.
- **The SDK's tool-approval flow looks perfect and is not usable here.** `ToolApprovalResponse` is
  `{ approvalId, approved: boolean, reason? }` — binary, no edited payload (verified in
  `@ai-sdk/provider-utils@4.0.33`). The owner confirmed per-row toggles, which a binary approval
  cannot express. So: **the model proposes, code applies** — the client POSTs the final patch to an
  ordinary Zod-validated route and the model is never in the write path.
- **The injury domain is nearly free.** The owner asked that Coach match manual injury entry, and
  that behaviour already exists end to end — `signals.ts` derives `activeInjuredMusclesInSession`,
  the periodization prompt weighs it via `session_swap_recommended` / `deload_recommended`, and
  `injurySafeAlternatives` drives workout-time swaps. Coach writes the record and stops. The
  round-3 mockup D3 draws a "flag exercises" toggle that is **superseded** by this.

#### Scope boundary

Writable: session exercises, nutrition/goal targets, injuries, cardio goals, phase settings, early
deload. **Never writable:** set logs, workout sessions, sleep, HR, scale and ring metrics, food
logs — the owner declined record-logging for v1, and device-sourced rows go through the ranked
per-field merge where an AI write has no honest source rank to claim.

#### Gotchas the plans call out

- Phase 2 needs the floored **`pb-safe-action-lg`** on the composer — navless full-screen route, and
  bare `pb-safe` puts the send button under the gesture bar.
- **All four AI entry points are live**, not just Home. `session-select-content.tsx:1427` renders
  the overlay *uncontrolled*, so the FAB comes from inside the overlay component and there is no
  button in that screen's source to grep for.
- `updateUserGoals` also writes through to localStorage; Home widgets read those keys, not the DB.


### [app-shell] ⛔ Q-147 — cold app start has never been measured on the device (owner action)

- **Added:** 2026-08-08 · [journal](overview/history-2026-08-07.md)
- **⛔ blocked: needs the S25.** Not implementable in a session — filed so the gap is tracked rather
  than rediscovered.
- **What is known.** Bundle sizes are now measured (first time): **105 kB shared by every route**,
  and the four main tab screens sit at **316 kB First Load JS** while carrying only 235 B of their
  own code — so the weight is shared-layer, and screen-level splitting would move almost none of it.
  `/workout` is heaviest at 361 kB.
- **What is not.** The 2026-08-05 device capture measured **in-app navigation** — 22 navigations,
  warm 22 · cold 0, no RSC payload fetched at all, worst sample entirely client-side render. That
  rules bundle transfer out as the *navigation* cost. It says nothing about **cold app start**, which
  is when the shared baseline and a screen's First Load are actually paid, and which no capture has
  ever covered.
- **Do not "optimise the bundle" off the numbers above.** They are a baseline, not a finding —
  nothing has been shown to be slower because of them. Q-127 (same day) is the cautionary case: a
  real static import chain whose claimed cold-start consequence did not reproduce under measurement.
  Measure first, on the device.
- **Method:** add a cold-start timing to `docs/device-smoke-checklist.md` — app killed, then time to
  first interactive paint — and compare against the in-app navigation median of 146.2 ms already on
  record.


> **Q-180 DECIDED and removed, 2026-08-14 — KEEP, and the code now says why.** The entry asked one
> question: is the device ever going to restore intraday HR from the cloud? Answered from
> measurement rather than preference — **`ouraHeartrate` appears nowhere in `SyncDelta`**, so
> intraday HR reaches a fresh device by no other path (`restoreFromCloud` drains only the
> day-grained delta and says so itself), and the owner's 2026-08-02 retention decision makes the
> device-local raw store a 14-day rolling window with the **server** as the archive — so a
> re-install or a new phone loses history that still exists server-side. It costs nothing at
> runtime. **The entry's real complaint was the audit cost**, not the code: an uncalled method buys
> a paragraph in every dead-code sweep. That is what was fixed — `getOuraTimeseriesDelta` and its
> test file now carry the decision and its evidence, so the next sweep reads the answer instead of
> re-deriving the question. Re-litigate only if the device stops needing a cloud restore of
> intraday HR.

### [activity][readiness][heart-rate] Q-204 — the HR-derived load lane (Q-137 direction B), gates now measured

- **Branch:** `feat/activity-hr-load-lane`
- **Added:** 2026-08-11 · was Q-137 direction B, held as *gated, not queued* until its two questions
  were answered. Both now are — see
  [§11 of the calibration doc](activity-goal-calibration.md).
- **The problem it solves, restated:** the Activity Score can see *that* you trained, never *how
  hard*. Two sessions of wildly different intensity score identically. Every app that handles
  strength training well (Whoop Strain, Strava Relative Effort, Garmin Training Load) measures
  **HR-derived load** instead of counting minutes above a cardio threshold; the ones that count
  threshold-minutes bolt a second, load-based metric alongside.
- ✅ **Gate 2 PASSED — coverage is fine, and my own stated worry was wrong.** §5 argued the ring
  power-gates its PPG when worn-idle, so non-workout HR might be too sparse for a fair load model.
  Measured over 14 days: **13.3 of 15 waking hours** carry at least one sample (range 12–15
  excluding a partial day in progress). On **2026-07-30 the ring alone covered 12 of 15 with zero
  chest-strap samples** — coverage is not strap-dependent. The fairness objection does not hold.
- ❌ **Gate 1 FAILED — there is no head start.** §3 and §5 both said `training_load_ots` "already
  exists and may be most of it". That was read off the **schema**, not the data: it is populated on
  **0 of 42 days**, the same empty-pipe shape as `active_calories_est` (Q-184). Any load term is a
  from-scratch derivation.
- **⚑ Gate 1 UPDATED 2026-08-15 — the head start is arriving, but only from now on.** Q-270 found
  why that column was empty and it was not a broken producer: **all four gates of
  `computeTrainingStress` pass** in production (readiness `ble-derived` 31 days, `n_history` 40 vs a
  threshold of 14, RHR on 30 of 30 days, MET grid 1,425 min / 1,146 values against floors of
  720/360). The route simply was never called — it persists only as a side effect of rendering one
  card on a Health tab the app does not open by default. It is now warmed once per launch, so
  `training_load_ots` should populate **forward**. **Two caveats that matter for this entry:** the
  persist is unverified (the dev seed gates before the write — re-read the column before relying on
  it), and there is **no backfill**, so the historical days stay empty. A load lane can use the
  forward series; it cannot train or calibrate on history that does not exist. Journal:
  [`docs/overview/overview/history-2026-08-15.md`](overview/history-2026-08-15.md).
- **Design questions to settle first:** MET-minutes (WHO's ~500–1,000 MET-min/wk equivalence gives
  an absolute anchor) vs a Banister-style TRIMP; whether it *replaces* `zoneMinutes` and the dead
  `activeEnergy` or sits alongside them; and what value equals 100, which is the same
  "pick the number honestly" problem Q-137 §4 solved with WHO/Paluch anchors.
- **Precedent to follow:** the volume anchor must be **absolute**, not the user's own rolling load —
  Q-190 removed exactly that self-reference from the volume lane, and a load lane anchored on a
  trailing average would reintroduce it.
- **Sequencing:** independent of Q-184. If a load lane lands, the case for reviving
  `active_calories_est` weakens considerably — a calorie estimate and an HR load term measure much
  the same thing, and Q-184's own entry already says to check this first.

### [readiness][devices] ✅ Q-270 — FIXED FORWARD 2026-08-15: the route is warmed on launch

> **The column was empty because nothing called the route.** All four gates were measured and all
> four pass — readiness `ble-derived` (31 days), `n_history` 40 vs 14, RHR on 30 of 30 days, and a
> MET grid of 1,425 min / 1,146 values against floors of 720/360. `/api/training-stress` persists
> only as a side effect of being called, and its only caller was a Health → **Body** card while the
> tab defaults to **Training**. Fixed with one sync-provider warm-list entry: once per launch,
> **deliberately off the BLE ingest path** that Q-213 traced an outage to, and with no cron layer
> available. ⚠️ **Populates forward only — the 89 empty days stay empty**, and the persist itself is
> unproven locally (the seed has no `ble-derived` readiness, so the route gates before the write).
> **Re-read `training_load_ots` in a day or two**; if it is still 0, the diagnosis was incomplete.
> **This unblocks Q-204**, whose design assumes the column is most of its input. Journal:
> [`docs/overview/overview/history-2026-08-15.md`](overview/history-2026-08-15.md).
> Original entry below.

#### (original) Q-270 — `training_load_ots` has a producer and is still 0 of 89 days in production

- **Branch:** none yet · **Added:** 2026-08-14, doing the check Q-184's own entry asks for before building.
- **The measurement.** `claude_ro.oura_daily_derived` holds **89 days** for the owner. Both
  `training_load_ots` **and** `active_calories_est` are populated on **0** of them.
- **Why that matters more than it looks.** `docs/activity-goal-calibration.md` §5-B justifies the
  HR-load direction (Q-204) partly on *"`training_load_ots` already exists and may be most of it"*.
  That is **true in code and false in the data**: the column has a real server-side producer
  (`app/api/training-stress/route.ts`, computing OTS from the ring's MET stream + our derived
  readiness + derived VO₂max) and it has never persisted a single value.
- **Two gates ruled OUT by measurement**, so the next session does not re-check them:
  - **Readiness is not it.** `oura_daily_derived` has **31 days** of `readiness_source='ble-derived'`
    with a non-null score, latest **today**.
  - **MET data is not absent.** Tag `0x50` events are arriving — **222 rows in the most recent
    50,000** `oura_raw_samples` (bounded query; do not scan that table).
- **✅ DIAGNOSIS COMPLETE 2026-08-15 — all four gates pass, so the value is computable and simply
  never computed.** Measured each gate of `computeTrainingStress` against production rather than
  reasoning about them:

  | gate | condition | measured | verdict |
  |---|---|---|---|
  | `no_readiness` | `readinessSource === 'ble-derived'` | 31 days, latest today | **passes** |
  | `readiness_learning` | `nHistory < BASELINE_MIN_NIGHTS` (14) | `n_history` = **40** | **passes** |
  | `no_profile` | age / sex / **RHR** present | RHR on **30 of 30** recent days | **passes** |
  | `insufficient_met` | grid < 720 min **or** valid < 360 | 2026-08-13: **1,425 min span, 1,146 values** | **passes** |

  MET decoding detail, since it looked like the likely culprit and is not: **104 events on 08-13**,
  14 values each (~1/min), 17 gaps over 20 min, largest 59 min — patchy but far above both floors.
  **Corrected 2026-08-15:** an earlier note here said `decoded` is NULL on every `0x50` row, implying
  a tag-specific decoder gap. Re-measured over the most recent 50,000 samples, it is NULL for **every
  tag** — that is the archival design (`body_hex` is truth so a later decoder can re-derive; the
  adapter re-decodes on read), not a fault. No `0x50` decoder bug exists to find.
- **So the cause is the remaining one: nothing ever calls the route.** It computes and persists
  **only as a side effect of rendering `training-stress-line.tsx`**, for `?date=${today}` only. That
  card sits in Health → **Body**, and the Health tab defaults to **training** — so the value is
  written only if the user switches tabs on the day in question, and never for any past day.
- **⚠️ The fix has a real footgun: do NOT hang this off the BLE ingest path.** That is where
  `aggregateOuraRawSamples` runs, and Q-213 traced a multi-week production outage to exactly that
  loop being saturated. Adding an OTS computation to the hot ingest path risks reintroducing the
  fault that was just fixed. There is also **no cron layer** (`docs/module-map.md` §0), so a
  scheduled job is not available either.
- **Fix shape, unbuilt:** compute-and-persist for *yesterday* from a path that already runs at most
  once per app open and is off the ingest loop, and/or a bounded backfill for the retained window.
  Whatever the trigger, it must be measured against the Q-213 CPU signature before merging.
- **Original leading cause, now confirmed as the answer:** the route only ever computes **today**, on demand,
  and only persists when `result.status === 'ok'`. Its only client is
  `components/health/training-stress-line.tsx`, which fetches `?date=${today}`. So nothing backfills,
  and a day only persists if the Health card renders that day *and* the OTS core returns `ok`. Either
  the card is rarely reaching a passing state, or `computeTrainingStress` is gating (insufficient MET
  minutes is the candidate — 222 events is thin).
- **What to do:** confirm which, by calling the route for a recent day with a real session and reading
  `result.status` / its gate reason. If it is the never-backfilled shape, this is **server-side work
  with no APK** — much cheaper than Q-184's Kotlin.
- **This gates Q-204.** The HR-load lane assumes this column is most of its input. It is currently
  none of it.

### [devices][activity] Q-184 — `active_calories_est` is plumbed end-to-end and never written

- **Branch:** `feat/ble-active-energy-estimate`
- **Added:** 2026-08-11 · found while investigating Q-137
- **The pipe is complete and empty.** `activeCaloriesEst` has a Zod schema
  (`packages/shared/src/validation/oura-summary.ts:96`), a column (`oura_daily_derived
  .active_calories_est`), an adapter write, a `getSyncDelta` mapping, a local SQLite column and a
  pull mapping. **0 of 42 days are populated** — the device never computes a value to send.
- **Why it matters:** `activeEnergy` was the Activity Score's second-most discriminating contributor
  (weight 15, **sd 29.5**) and its input died at the BLE re-key — `body_metrics.active_calories` last
  landed **2026-07-07**, sourced from Oura Cloud `daily_activity`, which stopped. The pillar went
  from two informative inputs to one.
- **This is device work.** The estimate has to be computed in the on-device rollup from accelerometer
  and HR, so it needs Kotlin **and a new APK** — which is exactly why it is not part of Q-137's
  server-side model change.
- **✅ CHECK DONE 2026-08-14 — and it says do NOT build this as specified.** Two findings:
  **(a)** `docs/activity-goal-calibration.md` §5-B's direction B "replaces `zoneMinutes` and the dead
  `activeEnergy` with one physiologically-grounded contributor" — and the owner **chose direction C
  on 2026-08-11** (A now, B as its own project, now queued as Q-204). So computing
  `active_calories_est` on-device would be building the input that B is designed to *remove* from the
  model. **(b)** The suggested alternative is not ready either: `training_load_ots` is **0 of 89 days**
  populated in production despite having a live server-side producer — filed as **Q-270**, which
  gates Q-204.
  **Recommendation: hold Q-184 behind Q-270 and Q-204.** Kotlin plus an APK is the most expensive
  work available here, for a number the agreed direction discards. Do not start it until Q-204's
  design confirms it still wants a calorie term.
- **Check before building (original):** `training_load_ots` already exists on the same table and may
  cover more of this than a calorie estimate would. See
  [`docs/activity-goal-calibration.md`](activity-goal-calibration.md) §5-B — a heart-rate load term
  may be the better target than reproducing a calorie number.

### [activity][readiness] Q-137 — the Activity Score is effectively a step counter: 57 of 100 weight is constant, and it lost its second-best input a month ago

- **Branch:** `fix/activity-score-calibration`
- **Added:** 2026-08-07 · [review §6.1-6.3](reviews/2026-08-07-full-app-review.md)
- **⛔ Needs an owner decision before code**, same shape as Q-72 — this changes a number read daily.
- **Measured over 91 days** (2026-05-09 → 2026-08-07) via `/api/admin/day-review`, contributor-level:

  | contributor | weight | n | mean | **sd** | at exactly 100 |
  |---|---|---|---|---|---|
  | `strengthFreq` | 25 | 91 | 100.0 | **0.0** | **91/91** |
  | `moveHours` | 12 | 44 | 100.0 | **0.0** | **44/44** |
  | `strengthVolume` | 20 | 91 | 94.8 | 18.0 | 82/91 |
  | `steps` | 18 | 91 | 56.1 | **33.6** | 19/91 |
  | `zoneMinutes` | 10 | 44 | 5.3 | 20.9 | 2/44 |
  | `activeEnergy` | 15 | 16 | 53.1 | **29.5** | 2/16 |

  **r(steps, activityScore) = 0.775.** `strengthFreq` — the single **largest** weight — has been
  exactly 100 on all 91 days across three months and has never once carried information. The cause is
  goals far below actuals: strength-frequency goal **3** against 5–7 sessions/week, move-hours **15**
  against 19–24, volume **4,700** against 29,661. A hard training day and a rest day with the same
  step count score identically.
- **The score lost its second-best input at the BLE re-key and nothing surfaces it.** `activeEnergy`
  is `excludedReason: "no input available"` on every recent day — `body_metrics.active_calories` came
  from Oura Cloud `daily_activity`, which stopped. The model handles this **correctly** (excluded,
  weights renormalised, not silently zeroed) but with **sd 29.5** it was the second-most
  discriminating contributor. The pillar went from two informative inputs to one.
- **`zoneMinutes` exposes an absent-vs-zero asymmetry.** Absent data is excluded and renormalised; a
  *structural* zero is scored as a genuine zero at full weight. Zone 1 spans 55–134 bpm (≈60% HRR),
  and strength training with rest rarely sustains above it, so a lifter scores ~0 on a cardio metric
  permanently. **An initial hypothesis that chest-strap HR was missing from `oura_heartrate` is
  WRONG** — it carries `chest_strap` samples (1,090 on 2026-08-07). Do not re-chase that.
- **Options for the owner:** (a) re-anchor the goals to the user's actual baseline so the three
  saturated contributors can move; (b) drop or re-weight contributors that cannot discriminate for
  this training style; (c) find a BLE-derived replacement for `activeEnergy`. Do not pick one for them.

**Re-measured and worked up 2026-08-11 — the three options were all downstream of a question none of
them asked.** Owner was asked to choose and said the goals need to be *scientifically calibrated*
first, so the output is a design discussion, not a patch:
[`docs/activity-goal-calibration.md`](activity-goal-calibration.md). What changed:
- **Every premise re-verified against production and holds, sharper.** `active_calories` last landed
  **2026-07-07** (34 days dead at time of writing). Strength frequency is **4.9/wk** against a goal
  of 3 → ratio 1.63, and `STRENGTH_FREQ_CURVE` caps at 100 from ratio **1.0**, so the largest weight
  is pinned *structurally*, not just observed.
- **Stated as an outcome rather than as contributors:** the score's own 30-day spread is mean
  **74.3, sd 5.9, range 60–81**, while steps — its one live discriminating input — runs sd **4,028**
  on a mean of 6,959. The input swings ±58%; the output moves in a 21-point band.
- **Option (a) partly reverses a deliberate decision.** The 2026-07-22 rewrite moved *away* from
  self-referential scoring precisely because "a lazy week lowered the bar"; any rolling-baseline goal
  reintroduces that plus a treadmill. The doc proposes fixed *personal* goals instead.
- **Option (c) is bigger than it reads** — the replacement's plumbing already exists and is empty.
  Split out as **Q-184** (device work, needs an APK).
- **The "missing score-days" worry was unfounded** — checked: every day from **2026-07-28** onward
  has an activity score and all gaps precede it. That is the score's start date, not a fault.
- ✅ **DECIDED 2026-08-11 — direction C, and goals set ABOVE typical.** See
  [§8 of the doc](activity-goal-calibration.md). No longer blocked; what remains is implementation.
  - **The "above typical" half is load-bearing and was nearly missed.** A strength goal of 5 against
    a measured 4.9/wk is ratio 0.98 → ~99 — the saturation re-created with better-looking numbers.
    Targets must sit meaningfully above typical or this does nothing.
  - **Expect the score to move AND to centre lower than 74.** Intended (100 should be reachable, not
    routine) and not to be read as a regression. Q-183 pushed the other way and has **already
    shipped**, so **measure any before/after against a post-Q-183 window, not against the 74.3
    quoted above.**
  - ✅ **SHIPPED 2026-08-11 (v1.284.0): `DEFAULT_STRENGTH_FREQ_GOAL` 3 → 5.** One line, and it
    unfroze **both** strength lanes — the volume target is derived from the same number
    (`volTarget = typicalSessionVolumeKg × strengthFreqGoal`), so at goal 3 it sat at 14,100, below
    even a weak week. Regression test pins the bug as a property: **at goal 3 a weak week and a
    strong week scored identically on both lanes**; at 5 they separate and a strong week still
    reaches 100. See
    [the journal entry](overview/history-2026-08-08.md).
    **What remains on this entry: nothing** — move hours is Q-188, the volume anchor is Q-190, and
    direction B is still gated. Strike this entry once those two land.
  - ✅ **Target values set 2026-08-11 — see [§9 of the doc](activity-goal-calibration.md).** Steps
    **8,000** (unchanged), strength frequency **5** (at the optimum, deliberately not above it — the
    ACWR taper already penalises over-reaching, so a goal of 6 would have one part of the model
    rewarding what another punishes), weekly volume **28,000**. **Move hours is BLOCKED on Q-188** —
    it is saturated by a window mismatch, not by a low goal, and raising it would hide that.
  - **Re-verifying the baselines paid for itself:** the filed weekly volume of **29,661** is not
    representative — the measured 8-week mean is **25,159** (sd 4,545, range 16,843–31,083), so
    29,661 sits near the *maximum*. A target set from the filed figure would have been ~18% above
    the real mean rather than ~11%.
  - **B is gated, NOT queued.** Before filing it, measure HR coverage during non-workout hours (the
    ring power-gates its PPG when worn-idle, so sparse coverage would under-count ordinary movement
    and over-weight workouts) and whether `training_load_ots` is actually populated — **the column
    was verified from the schema, not from the data.** Q-183's 40-of-45 finding below is the
    strongest argument *for* B: that is what a threshold-minute metric looks like when it cannot see
    the training.
- **Q-183 went first and shipped 2026-08-11 (v1.279.2)** — a lifting day with no zone-2+
  minutes now excludes that lane instead of scoring it zero, worth **+5 points** on a measured local
  A/B. Its measurement also sharpened this entry: of the owner's last 45 days, **40 had exactly zero
  zone minutes**, so `zoneMinutes` carries almost no information either way and any re-anchoring of
  its goal should account for that.
- **Confidence that this is calibration and not data:** on the same 91 days the **Readiness** pillar's
  contributors show healthy spread (`hrvBalance` sd 27.1, `sleepBalance` 26.2, `recoveryIndex` 23.0,
  `restingHeartRate` 15.9, `checkin` 13.1; only `activityBalance` at 7.5 is low-signal). Same ring,
  same days, same pipeline — Readiness is the control case.
- **Clean result worth keeping:** **zero** persisted-vs-live score divergence across 88 checked
  pillar-days. No stale-model drift anywhere.

### [platform][app-shell] Q-138 — component-size hotspots, with concrete extractions

- **Branch:** `refactor/component-size-hotspots`
- **Added:** 2026-08-07 · [review §4](reviews/2026-08-07-full-app-review.md)
- Low priority individually; the rule exists because these files absorb every new feature by default.
  Take them opportunistically when already touching the file, not as a dedicated PR.

  | lines | file | proposed extraction |
  |---|---|---|
  | 1851 | `components/workout-screen.tsx` | the data-loading layer — `fetchExercises` (289-444), `loadPeriodization` (445-481), `handleDurationPresetChange` (482-506), `refreshExercises` (507-…) plus their `useState`s → `components/workout/use-workout-session-data.ts`; and the two terminal states (1604-1640) → `workout-load-states.tsx`. ~350 lines. |
  | 1478 | `app/session-select/session-select-content.tsx` | the banner stack (1128-1193) → `app/session-select/components/home-banner-stack.tsx`, taking the APK-banner and day-review dismiss state with it (182, 193, 344-355). ~110 lines, 4 `useState`s. |
  | 997 | `components/config-screen.tsx` | progression-style CRUD (152-249, already a self-labelled section) → `components/config/progression-style-editor.tsx`. ~100 lines. |
  | 991 | `app/health/health-content.tsx` | the day-overlay subsystem (588-779) → `app/health/hooks/use-day-overlay.ts`, alongside the existing `use-health-calcs.ts`. ~190 lines. |
  | 963 | `components/config/program-editor-sheet.tsx` | exercise-row mutations (199-325) → `components/config/use-program-exercise-edits.ts`. ~130 lines. |
  | 849 | `components/more/profile-tab.tsx` | the notification-toggle block (154-257) + its switch rows → `components/more/notification-settings-section.tsx`. ~100 lines. |

- **Related, latent — record but do not act:** `components/shell/bottom-nav.tsx:27-33` reads three
  `persist`-ed Zustand stores with no `skipHydration` anywhere in `lib/stores/`. Zustand rehydrates
  synchronously at module eval, so the client's first render can see persisted state the server
  render could not. Today it only drives `className`, so no mismatch — but it makes any future *text*
  under `workoutActive`/`walkActive`/`activityActive` an instant #418 (see Q-73).


### [workouts] Q-85 — a shortened session keeps full-length rest periods, which is what actually caps its exercise count

- **Branch:** `feat/preset-aware-rest-compression`
- **Plan:** [`2026-08-15-preset-aware-rest-compression.md`](superpowers/plans/2026-08-15-preset-aware-rest-compression.md)
  (written 2026-08-15). **⛔ Needs one owner decision before code** — the plan measures the options
  and recommends one, but the choice is a prescription-quality call.
- **⚑ What the measurement changed about this entry.** Modelled through the real `dropToBudget`:
  **rest is 79% of a five-exercise Push** (29 min rest vs 8 min work). And the safe-sounding option
  is the useless one — **compressing accessories alone changes nothing below a 45-minute budget**,
  because accessory rests are already 60 s. Every meaningful gain comes from compressing the
  compound's 180 s, which is the rest that is load-bearing at heavy loads. So the trade is sharper
  than this entry assumed: there is no version that is both worthwhile and safe for the main lift,
  and "leave it" is a better answer than compressing the compound. The plan's §4 is the question.
- **Added:** 2026-08-05, measured while implementing Q-83 (see
  [`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md)).
- **JS-only — no APK needed** (server-side AI-periodization math).
- **The gap:** Q-83 fixed the warmup double-charge and recovered 3 working minutes at Quick, which
  on the owner's real Push session was enough to give back one exercise. It is not enough in
  general. The trimmer's exercise-count thresholds sit **~6–7 minutes apart** (measured on a
  five-exercise Push: 1 exercise below 29 min, 2 at 29, 3 at 35, 4 at 41, 5 at 48), so a 3-minute
  recovery only crosses one by luck of where the session already sat.
- **Where the time actually goes:** a single main compound at 4×5 with 180 s rests costs ~19 min,
  most of a 21–24 min Quick working budget — and ~12 of those 19 are rest, not work. Rest is the
  dominant term at short budgets and it is currently preset-blind: choosing "Quick" shortens the
  budget without touching the prescribed rest.
- **Why it is not just "cut rest":** rest length is load-bearing for the training effect at heavy
  loads, so compressing it trades intensity quality for exercise count. That is a
  prescription-quality decision for the owner, not a mechanical fix — the plan needs to establish
  *whether* a Quick session should prefer fewer exercises at full rest or more at compressed rest,
  and likely differ by role (main vs accessory) rather than applying one factor to all.

### [heart-rate][devices] Q-116 — Health tab's "Live HR" shows a live reading without tapping "Measure now"; likely tied to overnight ring drain

- **Branch:** `investigate/live-hr-leak-ring-battery`
- **Plan:** [`docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md`](../docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md) Task 31
- **Added:** 2026-08-06 · owner noticed a live (non-stale) HR reading on the Health tab without ever
  tapping "Measure now," and suspects it explains ~15%/night ring battery drain.
- **⚑ Investigation, not a confirmed fix — needs on-device diagnostics before scoping the fix.**
  Structurally confirmed the symptom is real: the Health card is a read-only view of an app-wide
  live-HR manager singleton, so a live reading there means *something else* currently has the
  workout-grade live-HR path engaged — the ring is deliberately workout-only/never-ambient by
  design ("keeps the ring's battery-costly burst loop from running 24/7"), so this is a real
  deviation, not a documented feature. Three leak vectors flagged, most likely first: a stale
  workout stuck at `mode === 'active'` in the persisted Zustand store (workout state deliberately
  survives a refresh) keeping `LiveHrManager.start()` engaged since its `stop()` only fires in a
  React effect cleanup; the native BLE foreground service surviving an app crash/force-kill without
  the JS-side stop call ever reaching it; or (lower likelihood) an admin debug console left running.
- **Next step is diagnostic, not code**: capture `getLiveHrManager().getDiagnostics()` and the
  workout store's persisted state during/after a period of reported drain to confirm which vector is
  real before writing a fix.

### [devices][body] Q-114 — scale "Weighing you…" progress bar has already drifted from the real native timeout; shorten both together

- **Branch:** `fix/scale-cycle-budget-drift-and-trim`
- **Plan:** [`docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md`](../docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md) Task 29
- **Added:** 2026-08-06 · owner asked to trim ~2s off the scale weigh-in progress bar now that the
  persistent connection makes it activate near-instantly. **Clarified**: the bar's job is telling
  the owner how long to keep standing still — it's wrong regardless of exact duration if weight is
  already captured before it visually finishes, so match real capture time, don't just shorten it.
- **⚑ Found a real drift bug while checking, not just a pacing tweak.** The JS progress-bar
  duration (`SCALE_CYCLE_BUDGET_MS = 12_000`, `capacitor-native-init.tsx:18`) has an explicit
  comment saying it mirrors the native retry-give-up deadline — and it no longer does. The real
  Kotlin value is `CYCLE_BUDGET_MS = 16_000L` (`ScaleBleService.kt:94`), 4 seconds longer. The bar
  currently finishes 4 seconds before the native side actually gives up — exactly the
  hand-sync-drift trap the JS comment itself warned about.
- **Real data supports shortening**: `docs/scale-ble-connect-latency.md` (2026-08-01 on-device
  capture) measured link-establishment at 2206ms cold / 1270ms on reconnect — well under even the
  JS-side's current (already short-of-native) 12s figure. Supports the owner's instinct, though that
  capture is link-latency only, not full weight-stabilization time — pick the final number from a
  fresh capture, not from this alone.
- **Native-only APK caveat**: `CYCLE_BUDGET_MS` is also the real retry-give-up budget, not just a
  visual duration — shortening it trades away retry margin for slower-than-typical connections, so
  reconcile + shorten carefully and re-verify on-device, not just visually.

### [nutrition][app-shell] Q-112 — merge "Day in Review" + "End of Day" into one richer daily-review experience; extend to the weekly recap

- **Branch:** `feat/unified-day-review`
- **Plan:** [`docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md`](../docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md) Task 27
- **Added:** 2026-08-06 · owner wants Home's "Your Day in Review" (AI digest + HR chart + workout-load
  chart) merged with Nutrition's "End of Day" (meal backfill + wellness scales + journal), using
  nutrition's UI as the visual base, with richer data (HR min/max, body composition, calories
  burned/expended, session volume, body temp, steps, a day-timeline treatment), a nicer
  banner/notification entry point, a read-through → missed-meals → wrap-up flow, ~7-day rolling
  lookback, and possibly the same treatment for the weekly recap at a longer lookback. **Explicit
  ask: primarily a UI/design uplift.**
- **⚑ Spec-sized, not batch-task-sized — every other entry in this queue is one PR; this one isn't.**
  Whoever picks this up should write a proper implementation plan first (per the writing-plans
  convention) rather than execute the batch entry as a checklist — several product decisions
  (banner vs. notification, exact section-skip logic, which stats get trend treatment) are
  deliberately left open in the plan-doc entry, not resolved.
- **Both source components already exist and are more different than the owner may realize**: Day
  in Review is a thin AI-text + 2-chart Home banner sheet; End of Day is a reasonably rich but
  visually plain nutrition/wellness/journal sheet triggered from a Nutrition-tab button, not a
  banner. They share no component today. The weekly analog (`weekly-recap-banner.tsx`/
  `weekly-digest`) already exists too and is the natural target for the "monthly scale" ask.
- **No new domain math needed** — every requested stat (HR min/max, body composition, calories
  burned, session volume, body temp, steps, scores) already has exactly one correct source elsewhere
  in the app (several catalogued in this same session's Q-105/Q-96/Q-110 investigations); this is an
  assembly + design problem, not a new-formula problem.
- **Cross-reference**: shares its swipe-between-days interaction question with Q-110 (same plan doc)
  — check both before implementing either so the app doesn't end up with divergent swipe patterns.

### [devices][app-shell] Q-111 — Home header device-battery chips (ring/strap/scale); question whether the manual refresh button is still needed

- **Branch:** `feat/home-device-battery-chips`
- **Plan:** [`docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md`](../docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md) Task 26
- **Added:** 2026-08-06 · owner wants small icon+battery chips on Home for the ring, chest strap,
  and scale (if available) — ring always-current, strap/scale live-when-connected +
  last-seen-when-disconnected — and asked whether the header refresh button is still needed given
  pull-to-sync exists.
- **✅ RING HALF DONE (2026-08-08, v1.270.30).** `oura-battery-chip.tsx` now reads
  `/api/oura-ble/battery-latest` instead of the frozen Cloud value, and is wired into the Home
  header beside the weather chip. It reuses the `oura-ble-battery-latest` key + `cachedFetchToday`
  variant that `health/oura-section.tsx` already owns (a second key for one endpoint causes
  stale/blank first paints). Two latent bugs in the same file went with it: a `readCacheSync` in a
  `useState` lazy initializer (the documented hydration-mismatch pattern) and five hardcoded `rgb()`
  literals now on theme tokens. Readings older than 3h render muted and say "last seen Nh ago" in
  the aria-label rather than looking current. **The strap and scale halves below are untouched and
  are what keeps this entry open.**
- **Very different starting points per device.** Strap: a live `battery` value already exists natively
  (`PolarStrapService.onBattery`, exposed via `getStatus()`) but **no JS call site reads it and
  nothing persists it** — needs wiring + a "last seen" store, genuinely new work. Scale: **no
  battery capability exists anywhere**, not even a one-shot native read — new BLE work, correctly
  flagged by the owner as a stretch/"if that comes up" item.
- **⚑ Concrete answer to the refresh-button question, not just an opinion**: checked what each
  does — pull-to-sync bumps `refreshTick`, which is what drives Body Battery/training-load/
  muscle-recovery/HR-chart refresh; the manual header button does **not** bump `refreshTick` at all,
  so it's strictly narrower than pull-to-sync, not merely redundant with it. Supports removing it and
  reusing the header slot, though discoverability of a gesture vs. a visible button is a real
  counter-consideration — flagged as a decision to make, not resolved here.

### [platform] ✅ Q-107 — MEASURED 2026-08-14: the batching half is superseded by Q-213, and the fault has stopped

- **⚑ Read `error_events` first — done 2026-08-14, and it settles this.** The entry's own instruction
  was to read production before building the batching half, because #1149 made the Postgres codes
  visible. Doing that changes the answer.
- **The dominant production fault was never this one.** Grouped over the retained window, the largest
  signature by an order of magnitude is **`[pg 21000]` cardinality violations on `oura_heartrate`
  inserts — 5,771 events**. That is Q-215's batch-dedupe fault, not pool contention.
- **The pool/connect signature is real but small, and it has stopped.** Counting the two connect
  fingerprints (`timeout exceeded when trying to connect`, `Connection terminated due to connection
  timeout`) per day:

  | day | cardinality (21000) | connect-timeout | total events |
  |---|---|---|---|
  | 08-09 | 2,568 | 33 | 2,615 |
  | 08-10 | 0 | 16 | 31 |
  | 08-11 | 0 | 20 | 38 |
  | 08-12 | 2,472 | 39 | 2,556 |
  | 08-13 | 731 | 16 | 757 |
  | 08-14 | **0** | **0** | **0** |
  | 08-15 | **0** | **0** | 1 |

- **Both families stop dead after 2026-08-13**, which is when Q-213 stage 1 (v1.303.0, the
  incremental off-loop rollup) and the HR batch-dedupe fix shipped.
- **The batching fix should NOT be built.** Q-213 diagnosed the pool exhaustion as a *symptom of
  event-loop starvation*, not a cause — `pg`'s connect timeout is a JS `setTimeout`, so on a blocked
  loop it fires late and kills healthy connections while the database answers in milliseconds. That
  is why the entry's own 2026-08-08 update already found **79% of failures were a lone query failing
  while everything else in flight succeeded** — the wrong shape for pool exhaustion. Chunking the
  fan-out would have changed nothing, exactly as Q-213 concluded for the workout-data fan-out it
  explicitly refuted.
- **Corollary, recorded because it was acted on:** `getSyncDelta` went from 23 to **24** queries on
  2026-08-14 (Q-187's `plan_meal_answers`). That is safe on this evidence, not merely tolerated.
- **⚠️ Stopped is not fixed.** Two quiet days is not proof, and 08-14 shows *zero* events of any
  kind, which is as consistent with a quiet day as with a fix. **Re-read `error_events` at the next
  session start** — if either family returns, the diagnosis reopens as Q-213's, not as this entry's.
  The `/api/readiness-score` and `/api/body-battery` Known-Issues rows share this fault and should be
  struck only on the same evidence.
- Entry closed as superseded rather than implemented. Original text follows for context.

#### [platform] (original) Q-107 — `/api/sync/pull` intermittently fails, likely DB-pool contention from `getSyncDelta`'s 21-query fan-out

- **Branch:** `fix/sync-delta-query-batching`
- **Plan:** [`docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md`](../docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md) Task 22
- **Added:** 2026-08-05/06 · owner-reported the client symptom (pull-to-sync toast: "Sync is backing
  off after an earlier error"); traced to a real production fault via `claude_ro.error_events`, not
  just a copy question. See the `[platform]` Known-Issues row added the same session for the full
  evidence writeup.
- **⚑ Real, evidenced production fault — not cosmetic.** The owner's account hit `/api/sync/pull`
  server failures 2026-07-30 → 2026-08-01, a different domain table each time, all sharing the exact
  same stuck `since` cursor across 4+ days — meaning this device's pull was retrying the same page
  without fully succeeding over that window. Quiet since in the 7-day window checked, which is not
  proof it's resolved.
- **Leading theory, not yet confirmed against Railway's own Postgres logs:** `getSyncDelta`
  (`adapter.ts:3211-3235`) fires ~21 queries in one flat `Promise.all` per pull — against a
  deliberately-capped `max: 10` connection pool. A single pull call alone can want more connections
  than the pool has; the query left waiting under any concurrent load is the one that errors. Matches
  the observed fingerprint (near-random table each time, not a deterministic 100%-repro query bug).
- **Fix direction:** chunk the 21-query fan-out into smaller concurrent batches to cut peak
  connection demand; separately, capture the underlying Postgres error cause in the server
  error-report path (currently only Drizzle's generic wrapper message is stored, which is why this
  took a manual DB dig to diagnose). Check Railway's actual Postgres logs first if reachable, to
  confirm the pool-contention theory before committing to the batching fix.

- **⚑ Updated 2026-08-07** — [`docs/reviews/2026-08-07-full-app-review.md`](reviews/2026-08-07-full-app-review.md) §2.9.
  Three corrections and one escalation:
  1. **The fan-out is 22, not 21.** `adapter.ts:3246-3249` destructures 22 results from the single
     `Promise.all`. Pool is `max: 10`, `connectionTimeoutMillis: 5_000` (`client.ts:20-24`), so 12
     queries queue behind 10 slots on every pull.
  2. **It is NOT sync-specific — the scope is wider than this entry assumes.** `/api/readiness-score`
     (2026-08-06) and `/api/body-battery` (2026-08-05) fail with the *identical* `Failed query`
     signature; they lose the connection race while a pull is in flight. Fixing only `getSyncDelta`
     reduces the pressure but does not close the class. Both routes already have their own ⚠️
     Known-Issues row ("cause NOT diagnosed") — that row and this entry are the **same fault**.
  3. **✅ The "capture the underlying cause" half SHIPPED 2026-08-08 (v1.270.10, PR #1149).**
     `summariseCause` in `lib/observability.ts` now lifts the Postgres `code` into a message
     **prefix** (a suffix would sit past the `left(message,120)` the standing session-start query
     groups by) and records severity/code/message/detail/constraint/table in the stack. Verified
     against a live driver: `57014` and `42P01` both come through. **The batching half below is
     what remains** — and the next session should read `error_events` in production FIRST, since
     the codes are there now. Original specification, kept for context:
     `lib/observability.ts:9-10` records `err.message` and `err.stack` but never `err.cause` —
     and `DrizzleQueryError` assigns the real Postgres error (carrying `code`, `severity`, `detail`)
     to exactly that field (`node_modules/drizzle-orm/errors.js:41`, verified). That single omission
     is why every `Failed query` row in `error_events` is undiagnosable. It is a one-line change and
     it converts this entry from "leading theory" to a measurable fact (`57014 query_canceled`
     = `statement_timeout`; a pool acquisition timeout = the `connectionTimeoutMillis` path).
     **Do this before the batching work** — otherwise the batching fix cannot be proven to have
     worked.
  4. Still live: a `/api/sync/pull` failure was recorded 2026-08-06 02:00, so this has **not** gone
     quiet as the note above hoped.

- **⚑ Updated 2026-08-08** — [`docs/reviews/2026-08-08-db-scalability-and-tooling-review.md`](reviews/2026-08-08-db-scalability-and-tooling-review.md) §1.2.
  **The failure distribution argues against pool contention being the main cause, so measure before
  building the batching half.** Widening the query from `/api/sync/pull` to all **98** `Failed query`
  events across every route and grouping by the second they landed in:

  | failures in the same second | occurrences | total errors |
  |---|---|---|
  | 1 | 77 | 77 |
  | 2 | 6 | 12 |
  | 4 | 1 | 4 |
  | 5 | 1 | 5 |

  **79% are a lone query failing while every other query in flight succeeded.** Pool exhaustion
  fails everything competing for a connection at once — that is the shape of the two bursts (21 of
  98 errors), not of the 77. An isolated single-query failure fits a per-connection drop or
  `statement_timeout: 15_000` better than a 22-query fan-out starving a 10-slot pool.

- **⚑ Updated 2026-08-13/14 — much sharper burst evidence, found investigating an unrelated sleep-data
  report, and a candidate downstream consequence.** Queried `error_events` for the last 3 days while
  chasing why a stored sleep session read 2.5h later than the ring's real data supports (see the new
  `[sleep]` Known-Issues row / backlog entry). Found:
  - **A low, chronic background rate (1–9 `timeout`/`connection terminated`/`aborted` errors per
    hour) sustained continuously for 3+ days**, not an isolated blip — this has been running the
    whole time this entry has been open.
  - **Two much sharper bursts on top of that background rate: 23 errors in the 23:00–23:59 UTC hour
    of 2026-08-12, and 15 in the 02:00–02:59 UTC hour of 2026-08-13.** Unlike the 2026-08-08
    measurement (max burst size 5), these bursts span a wide, unrelated set of routes hit within
    the same few minutes — `/api/oura-ble/samples`, `/api/next-session`, `/api/oura/hr-day`,
    `/api/supplements`, `/api/workout-sessions/day`, `/api/nutrition/food-logs`, `/api/sync/pull`,
    `/api/body-battery`, `/api/readiness-score`, `/api/nutrition/meal-types`,
    `/api/oura-ble/freshness`, `/api/nutrition/targets`, `/api/nutrition/meal-plans`,
    `/api/weekly-stats`, `/api/nutrition/weekly-summary`, `/api/user/bedtime-estimate`,
    `/api/weekly-muscle-sets`, `/api/progress-summary`, `/api/injuries`,
    `/api/ai-periodization/session/...`, `/api/body-metadata`, `/api/sleep-sessions` — all within a
    ~20-minute window each time. That is the shape pool exhaustion predicts (everything competing for
    a connection fails together), not the lone-query-drop shape the 2026-08-08 measurement mostly
    found. The two theories are not mutually exclusive — this reads as both failure modes being real,
    at different times.
  - **The captured `cause` (shipped 2026-08-08, point 3 above) confirms the mechanism directly now**:
    messages read `[cause: timeout exceeded when trying to connect]` and `[cause: Connection
    terminated due to connection timeout]` on the anchor/session-lookup queries specifically — i.e.
    the app's own `pool.max: 10` (`client.ts:19`) is the thing being exhausted, not a
    `statement_timeout` query-cancellation. Checked Postgres's own side: `max_connections = 500`,
    only 11 connections in use at the time of checking (quiet), so there is no database-side capacity
    problem — the constraint is entirely the app-side pool size relative to concurrent demand during
    a burst.
  - **Not confirmed as ongoing right now** — 0 matching errors in the last hour as of this check.
    Confirms the "stopped ≠ fixed" rule: this has gone quiet before (per the 2026-08-05 entry) and
    come back.
  - **Candidate downstream consequence, not fully proven:** the sleep-session row investigated in the
    new `[sleep]` entry was last (re)written at 2026-08-13T12:11:50Z — a few hours *after* the second
    burst above ended (08:49 UTC) — with a stale/narrow sleep window that a fresh recomputation
    against the same real raw data does NOT reproduce (verified via a full local repro of
    `aggregateOuraRawSamples`, see that entry). The timing is close enough to be worth recording as a
    lead, not close enough to call proven; a rollup run succeeding overall while one of its internal
    queries silently returned a partial result during pool contention is a plausible mechanism, but
    unconfirmed.
  - **Not done this session:** reducing `getSyncDelta`'s fan-out, raising `pool.max` (500-connection
    Postgres ceiling leaves large headroom — even `max: 25–30` per replica stays comfortably under
    it, but this is the file CLAUDE.md marks load-bearing/"do not weaken", so a size change should go
    through the same review discipline as the timeout/error-handler settings next to it, not be
    changed opportunistically). Both remain candidate fixes for a focused session.

  This does not refute item 2's "wider than sync" correction — the bursts are real and the fan-out is
  a genuine peak-demand risk. It means the **batching fix may address the smaller half of the
  problem**. Now that #1149/#1150 have landed the `code` capture, one production `error_events` read
  settles it: a `57014` majority means `statement_timeout` and the batching fix is aimed correctly;
  a spread of connection-acquisition failures with no code means something else is dropping
  connections. **Read the codes before writing the batching PR.**

> **Q-105-followup DECIDED and removed, 2026-08-15 (v1.308.0).** The entry was blocked only on
> having no channel to ask the owner. Measured first: the owner is at **40 nights** and crossed 30
> around 2026-08-05, so the sub-30 state affects only a new account or a baseline reset — which
> reframed the question and made it cheap to answer. **Owner chose to show the progress.** The
> explainer now says how far along the baseline is, as its own line rather than as a deload
> *reason* — `temperatureBaselineProgress` returns `number | null`, not a `Signal`, so it cannot
> join that list. Journal:
> [`docs/overview/overview/history-2026-08-15.md`](overview/history-2026-08-15.md).

### [devices][body] Q-104 — "Weighing you…" toast still fires on a plain Home-tab visit, despite the 2026-08-01 fix

- **Branch:** `fix/scale-onunstablereading-ungated-recurrence`
- **Plan:** [`docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md`](../docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md) Task 19
- **Added:** 2026-08-05 · owner-reported (screenshot): the "Weighing you…" progress toast appeared
  on the Home screen with nobody on the scale — recurrence of a symptom a 2026-08-01 session
  already investigated and shipped a fix for
  (`docs/overview/entries/2026-08-01-scale-false-weighing-toast-on-home-focus.md`).
- **⚑ 2026-08-10 update — the on-device log capture this entry was waiting for, and hypothesis (b)
  now looks confirmed by direct code read, not just log speculation.** Owner reported "when
  scrolling to home screen the weigh-in keeps triggering" with two screenshots: Home's live
  "Weighing you…" bar, and the OS notification shade showing the actual native sequence —
  `5:43am Oura Ring connected`, **`5:46am "Weigh-in logged — 71.0 kg logged"` (a genuine capture)**,
  **`5:47am "Scale — Connected — listening for weigh-ins"` (a fresh reconnect, one minute later,
  with the Home screenshot's clock also reading 5:47 and "Weighing you…" actively showing)**. A
  brand-new weigh-in cycle starting 60 seconds after a real one was already captured, with nobody
  newly stepping on, is exactly the resubscribe-replay shape hypothesis (b) predicted.
- **Traced to the exact line: `onUnstableReading` in `ScaleBleService.kt:314-329` has no gate at
  all**, by explicit design — the class's own comments call it "the one signal allowed to lift
  suppression, since that's real proof someone is on the scale right now" (`onState`'s comment,
  line 296-298) and it actively **undoes** the post-capture suppression on every call
  (`hasCapturedThisWake = false`, line 319) before force-firing a fresh "waiting" state to JS
  (line 328) — restarting the progress bar unconditionally. The entire `hasSeenActivityThisWake`/
  `hasCapturedThisWake` suppression system built by the 2026-08-01 fix and confirmed present exists
  precisely to stop a reconnect-with-nobody-there from looking like a new weigh-in — and this one
  code path bypasses all of it, on the explicit (but apparently wrong) assumption that an
  "unstable reading" BLE notification can only originate from a real person standing on the scale.
  If the scale's GATT characteristic instead replays its last-buffered notification on resubscribe
  (a documented behavior class for cheap BLE body-composition scales), this signal fires with
  nobody there and the suppression system has no way to catch it, by construction.
- **"Scrolling to home screen" matches the already-documented trigger, not a new one**: the
  `setHomeScreenActive` mechanism (`capacitor-native-init.tsx:346-347`, tracked via `usePathname()`)
  stops/restarts the scale service on Home-tab focus — the Kotlin class doc (lines 138-140)
  already names this as the reconnect trigger ("returning to Home while the scale is still
  finishing its own post-use re-advertising re-links the persistent connection with no one there").
  The owner's "scrolling to home" almost certainly means navigating/swiping to the Home tab, which
  is exactly this path.
- **Fix direction, now more concrete than "needs a capture"**: gate `onUnstableReading` itself
  against a plausibility check rather than treating it as unconditional proof — e.g. require either
  (a) a minimum elapsed time since the last captured/unstable reading before honoring a fresh one as
  "new," or (b) require the reported weight to differ from the last captured value by more than
  scale noise tolerance, given a same-value replay is the specific failure mode observed. Kotlin-only,
  needs an on-device `chrome://inspect` capture to confirm the replayed-value theory precisely
  before writing the gate (does the replayed unstable reading match 71.0kg exactly?), then a
  rebuild + on-device re-test — no dev-server verification is possible for this one. Update the
  existing scale-toast Known-Issues entry in `projectOverview.md` rather than adding a duplicate
  when this ships.

### [sleep] ⛔ Q-102 — wire the morning sleep-feel rating into the live Sleep Score, neutral at 3/5 — OWNER DECLINED 2026-08-06

> **⛔ Owner explicitly ruled this out, in person, 2026-08-06** — walked through it live against a
> real disrupted night: does not want `sleep_quality_feel` driving the score at all, wants it kept
> independent for backlog/model calibration (i.e. keeps the Q-16 decision this entry would have
> reversed). Asked for an objective awake-time criterion instead, which shipped as a separate
> mechanism — see [`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md).
> Do not implement this entry without the owner explicitly reopening it.
>
> **Also moot on separate grounds** (found 2026-08-06, same session as Q-113): `sleepQualityFeel`'s
> on-screen slider is pre-filled from the Sleep score itself (`prefillMorningScales()`), so an
> unedited answer would have fed the score a value derived from itself — a second, independent
> reason this direction was never safe to implement as originally scoped. See the `[readiness]`
> Known-Issues row and **Q-113**.

- **Branch:** `feat/sleep-feel-score-adjustment`
- **Plan:** [`docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md`](../docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md) Task 17
- **Added:** 2026-08-05 · owner-reported: wants the morning check-in's 1-5 sleep-feel rating to
  adjust the live Sleep Score, with 3 (their typical rating) as neutral/no effect, and the
  adjustment scaling with distance from 3 in either direction.
- **JS-only fix — no APK needed.**
- **⚑ Corrects a mistaken premise and reverses a prior owner decision — read before implementing.**
  The owner believed this was already wired up; it isn't — `sleep_quality_feel` is currently
  read-only (an admin calibration diagnostic + a separate AI-periodization signal), never an input
  to the actual Sleep Score. Implementing this **reverses a documented 2026-07-27 decision (Q-16)**
  that deliberately kept the self-report out of the score specifically so it could be used to
  *validate* the score independently (feeds Q-72's own "does the score match how it felt"
  finding). Not a blocker — the owner can reverse their own prior decision — but it means
  `sleep-feel-calibration.ts` and any future score-vs-feel correlation work need to account for
  the score no longer being feel-independent once this ships. Does **not** resolve the still-open
  Q-72 (a different, still-unanswered rescale-vs-separate-signal question) — this is a third,
  distinct direction. Seventeenth entry in the running owner UI-bug batch (see the plan doc); the
  plan specifies the formula shape (symmetric, zero at 3, clamped to [0,100]) but leaves the
  adjustment magnitude as an open parameter to sanity-check against real nights before shipping.
- **⚑ Scoped 2026-08-05, not built — wider than it looks.** `computeSleepScoreSeries`/
  `computeSleepScore` have real callers beyond the Health screen: `sleep-trend.ts`, `adapter.ts`,
  `readiness-score/route.ts`, `body-battery/route.ts`, `score-audit/sleep.ts`,
  `weekly-digest/route.ts` — six sites, not one. **"Thread it through every caller" is
  underspecified**: at least two of those (readiness-score's composite, body-battery's anchor)
  arguably want the *raw* physiological score, not one already mixed with a same-user self-report —
  otherwise a subjective rating starts influencing a supposedly-objective composite one layer
  removed from the Sleep Score itself, which is a bigger circularity than the calibration-module
  concern the plan already flags. Needs a decision on which callers get the adjusted value vs. the
  raw one before implementing, not just a magnitude for `k`. Deferred rather than guessed at.


### [app-shell] Q-93-followup — wire the workout Today's Timeline card to a detail screen

- **Added:** 2026-08-06 · split off from Q-93 after the meal-card half shipped
  (see `docs/overview/entries/2026-08-06-timeline-meal-tap-navigation.md`).
- **Why split:** Q-93's plan claimed the sleep-card wiring was "straightforward... once
  ids/dates [are] threaded through" alongside the meal card. That premise didn't hold up under
  inspection at the `/health/sleep` route (`SleepContent` has no date-selection UI, always renders
  the latest night) — but a *different* existing surface did have per-night date selection built
  in: `HealthMetricSheet`'s sleep detail view already lists and renders any of the last 14 nights.
  That gap was closed 2026-08-07 (see
  `docs/overview/entries/2026-08-07-sleep-timeline-detail-deeplink.md`) by deep-linking to it
  instead of building new screen work. The workout card remains genuinely unscoped: no historical
  per-session HR-chart + exercise-detail screen exists at all (the only HR chart component renders
  live, in-progress data only).
- **What shipped:** the meal card navigates to `/nutrition?date=YYYY-MM-DD`; the "Woke up"/"Fell
  asleep" cards navigate to `/health?tab=body&openSleepDate=YYYY-MM-DD`, which pre-selects that
  night in `HealthMetricSheet`'s sleep sheet instead of showing the list. Both wired on both
  timeline renderers (`components/home-day-timeline.tsx` and `app/health/timeline/page.tsx`).
  `TimelineEvent`'s `date` field is reused for all of this — don't re-derive from `timeMs`
  client-side.
- **Remaining scope:** workout card → needs a screen to navigate to. **⚑ Corrected 2026-08-08:**
  the claim above that a historical per-session HR chart "doesn't exist yet at all" and that "the
  only HR chart component renders live, in-progress data only" is **wrong**.
  `components/health/day-overlay-sheet.tsx:186-190` already renders `HrRecoveryChart` per session,
  for an arbitrary historical date, with per-exercise markers — visible in the owner's 2026-08-07
  screenshots. The *capability* is built; what's missing is a screen to host it properly. That makes
  Q-110 the destination for this card, not a separate build — see the design mockups at
  `docs/design/2026-08-08-day-detail-screen-mockups.html`.
- **JS-only — no APK needed** once scoped.

### [sleep] Q-91-followup — decide whether the BLE ingest rollup should emit its own invalidation signal

- **Added:** 2026-08-06 · deferred decision point from Q-91 (see
  `docs/overview/entries/2026-08-06-sleep-screen-oura-sync-refetch.md`), not a bug.
- **Context:** Q-91 fixed the reactivity gap for the two signals that already existed (a manual
  Redecode / a BLE drain settling → `ta:oura-ble-synced`). The ingest route's own background
  rollup (`app/api/oura-ble/samples/route.ts:82-124`, the I20-documented lag path) is fire-and-forget
  and still emits no client invalidation at all — for the *ordinary* (non-manual) flow, the sleep
  screens' only guaranteed refresh is still the next natural mount or the 30-min TTL.
- **Why not done now:** the plan explicitly flagged this needs care — the rollup is intentionally
  fire-and-forget for latency reasons (I20), and wiring a signal off its completion risks
  reintroducing that timeout risk. Needs a scoped design (e.g. a lightweight polling flag vs. a
  push signal), not a quick add-on.
- **JS-only** once scoped.

### [app-shell] 🔴 Q-51 — the perf work is not aimed at the screen the owner actually uses

> **⚑ Now has evidence, 2026-08-05 — and it points HERE rather than at the network.** The device
> capture makes the residual file-splitting work the *only* perf item with a measurement behind it.
> **Sharpened by the second capture: it is a FIRST-MOUNT cost, not a general one.** `/workout` was
> visited 5 times in one session — four at ~100 ms, one at **1086 ms**, all warm. Capture 1 showed
> the same shape (1348.7 ms, warm). So the number to move is *first render of the workout screen*,
> and the median is already fine. Measure first-mount specifically, before and after.
> Median navigation is 146 ms and **zero of 22 navigations fetched anything**, so there is no network
> cost left to remove. But the worst sample — `/cardio` → `/workout` at **1348.7 ms** — also had
> `rscCount: 0`. That 1.3 s, ~9× the median, is **entirely client-side**: render, layout, and mount
> work. Splitting `session-select-content.tsx` (1,453 lines) and `workout-screen.tsx` (1,815) stops
> being "readability" and becomes the thing the number actually implicates. Re-measure after, using
> the same capture.

- **Branch:** `perf/home-nav-cold-start`
- **Plan:** none — this entry is the spec. Task 3 is a measurement, not a build.
- **Added:** 2026-08-02 · **renumbered from Q-50** — #1016 and #1015 both claimed 50 in parallel;
  the other holder is attached to shipped Q-49 Phase A0 work, so this standalone entry moved.
- **From the owner directly:** *"it's not the workout screen that needs the
  native feel for me — it's the home screen and switching tabs and navigating through the app."*
- **Why top:** placed above Q-49 because it is the owner's stated felt pain, it is cheap, and none
  of it needs an architecture decision. **This is a judgement call on placement** — Q-49 answers a
  daily distribution cost and is equally defensible first. Reorder freely.

**The finding.** The "Swift feel" push (Q-1, issue #868) and the goal layout's Stage 6 are both
aimed somewhere other than the owner's complaint, and the roadmap says so in its own words:

- **Q-1/Phase 3 does not fix navigation.** Its own sizing note: *"tab switches are already local …
  it will not make navigation faster."* The responsiveness investigation retracted the broader claim
  too — tab flips never reach the network, so bundling the shell *"buys less than implied."*
- **Stage 6 ranks the workout screen first**, home second. Worse, home is listed as *"session
  select (1,407)"*, which hides what it is: `components/shell/tab-shell.tsx:97` renders
  `SessionSelectContent` for the **`home` tab**. By Stage 6's own criterion — highest daily touch —
  home outranks the workout screen, since it is hit on every app open and every tab return.

**What the code says the felt lag actually is.** Verified 2026-08-02:

1. **Cold start.** The device profile put JS parse/execute — not the document fetch — as the
   dominant cost, and `app/session-select/session-select-content.tsx` (**1,414 lines**) is
   **statically** imported into the tab shell so first paint never waits on a second chunk
   (`tab-shell.tsx:5`, deliberate). The cost is that it sits in the main bundle. It is also one of
   the two files `CLAUDE.md` names as hotspots that "absorb every new feature by default".
2. **First switch to each tab.** The other four tabs are `dynamic()` imports loading on first
   activation — chunk fetch + first render + first data fetch. Repeat switches are a CSS visibility
   flip (`invisible` + `content-visibility:hidden` + `tab-panel-idle`, all five panels stay mounted)
   and should already be instant.
3. **Not the day timeline.** `home-day-timeline` was the one unseeded surface visible on load; it
   seeds now (`home-day-timeline.tsx:209`). That note in
   [`app-responsiveness-investigation.md`](app-responsiveness-investigation.md) is stale.

**Tasks, cheapest first — do 3 before deciding anything downstream of it.**

1. ⚠️ **PARTLY DONE 2026-08-02 (#1023)** — see
   [`docs/overview/overview/history-2026-07-30.md`](overview/history-2026-07-30.md).
   Seven interaction-gated sheets were code-split out of the initial bundle: **home First Load JS
   326 kB → 312 kB**, measured with `pnpm build`, no behaviour change.
   **The file itself is NOT split — still 1,417 lines, still over the ~800-line rule.**
   **And the finding that matters: ~14 kB is close to the ceiling here.** Extracting the file's own
   code into `components/` children moves *zero* bytes (a static child shares its parent's chunk),
   and everything left is the visible home screen, which instant-paint forbids making dynamic. Going
   further means a product change, not a refactor. Factor that into Task 3's verdict: if the tab
   prefetch (#1022) plus this does not close the gap, "keep splitting" is not the answer — the
   bundle has run out of easy give.
   Splitting the file for **readability** is still worth doing, just not as a performance claim.
2. ✅ **DONE 2026-08-02 (v1.251.2, #1022)** — see
   [`docs/overview/overview/history-2026-07-30.md`](overview/history-2026-07-30.md).
   Verified against a control run: 0 tab modules fetched on load before, 4 after. **It adds 22 chunk
   requests to load**, deferred to idle — whether that is a net win is exactly what Task 3 measures.
   If it is not, stagger the imports or cut to the two most-used tabs before reverting.
   ~~Prefetch the other four tab chunks on idle~~ once home has painted (`requestIdleCallback`, or
   after first paint). Removes the first-switch cost outright without touching the deliberate
   static-import decision for home. ✅ **Owner endorsed this one specifically (2026-08-02):**
   *"your idea of prefetch other tabs on load is probably the right move."* Build it — the approach
   is settled, only the trigger point (idle callback vs post-paint) is an implementation choice.
   Prefetch the **chunks**, not the data: warming the four tabs' fetches on load would put five
   screens' worth of requests on the critical path and make cold start worse, which is the opposite
   of this item's goal.
3. ✅ **DONE 2026-08-04 — the owner ran it on the S25, and it settles both this entry and Q-1b.**

   | | ms |
   |---|---|
   | First paint (FCP) | **472** |
   | of which: waiting for the document (TTFB) | **439** |
   | JavaScript execution | **~15** |
   | DOM interactive | 454 |

   **439 of the 472 ms is the round trip to Railway for the HTML document.** The JavaScript — 87
   files, all served from the service-worker cache — parses and runs in about 15 ms. **There is no
   JavaScript problem to solve on this screen**, which is the opposite of what items 1 and 2 assumed
   and the reason taking the measurement before committing to Stage 5/6 was the right call.

   Also answered on the same pass: **returning to an already-opened tab is instant** (so the
   v1.251.2 prefetch in item 2 is working), and **no ~1 Hz idle repaint** — both of which would have
   been bugs taking priority over any of this.

   **Verdict: Q-1b is dropped** (see its entry). The remaining lever on this screen is the 439 ms
   document fetch, not the bundle — the service worker's navigation handler is network-first, so a
   **cache-first shell** is a far cheaper attack on the same number than bundling. Not queued as its
   own entry yet; size it if the owner reports the home screen still feels slow, because at 472 ms
   it is already under the 1.5 s threshold this item set.

**Explicitly not in scope:** Compose, Phase 3, and any architecture change. If 1–3 close the gap,
that is a result worth having *before* committing to Stage 5/6, and it is exactly the measurement
the goal layout's §7 off-ramp says is missing.

### [platform] Q-311 — the E2E CI job puts a credential-shaped literal in a file that is about to be public (Q-49 blocker-adjacent)

- **Branch:** `chore/e2e-auth-secret-before-public-cut`
- **Added:** 2026-08-16 · found while writing the Q-249 handoff against Q-49's constraints.
- **`.github/workflows/ci.yml:367`** sets `AUTH_SECRET: e2e-ci-secret-not-used-outside-this-job`
  inline. It is genuinely a dummy: NextAuth needs *some* signing key or the credentials callback
  returns `?error=Configuration`, and this value signs nothing outside that ephemeral job against an
  ephemeral database that is dropped with the runner.
- **The problem is not the value, it is the reader.** Q-49's own constraint is *"CI stays offline and
  holds no credential"*, and someone reading a public repo cannot tell a dummy from a leak by
  looking. A plausible-looking secret in a workflow file is exactly the thing that gets reported.
- **Decide before the cut, and it is a two-minute job either way:** move it to a repository secret
  (costs nothing, removes the question entirely), **or** keep it inline and add a one-line comment
  in the workflow stating explicitly that it is a throwaway signing key for an ephemeral job. Do not
  leave it bare and unexplained.
- **While you are there:** the seeded test user (`test@local.dev` / `testpass123`, in
  `scripts/local-db/seed.sql`, used by `e2e/fixtures.ts`) is also public-safe by design but will
  read as a leak to a stranger. One sentence in the public README covers it.
- **Small, and it has a deadline rather than a priority** — it only matters at the moment the repo
  goes public, and it is much cheaper to settle now than to answer afterwards.

### [platform] 🔴 Q-49 — public repo migration (Phase A: model delivery · Phase B: the cut)

> **⚑⚑ 2026-08-10 — THE PLAN'S IP SCOPE WAS INCOMPLETE, and the gap is the most sensitive material
> in the repo.** A full audit of what is tracked (`scripts/check-private-paths.js`, shipped with this
> finding) measures **81.2 MB** of Oura-extracted material across **seven** directories. Everything
> below this line — this entry, `required-models.ts`, `model-files.json`,
> `scripts/upload-model-assets.js`, the bucket, and both plans — covers **only the 8 `.onnx` files
> (22.8 MB)**. `lib/oura-models/constants/` (11.6 MB) is known but deferred, with a stated reason.
> The remaining **46.9 MB is in no plan, no script and no `.gitignore`** — nobody has ever written it
> down:
>
> | Uncovered | Size | What it is |
> |---|---|---|
> | `lib/oura-models/weights/` | 43.6 MB | 14 `.npz` — Oura's full trained tensors. Its own README calls it archival |
> | `docs/oura-models/` | 2.3 MB | **271 `.py` — Oura's own decompiled TorchScript source** |
> | `scripts/oura-models/_source/` | 0.9 MB | **148 `.py` — a second copy of the same** |
> | `.agents/skills/oura-models/` | 0.1 MB | Six reference docs on Oura's model internals |
> | `.agents/skills/oura-native-ble/` | 40 KB | The BLE protocol knowledge base |
>
> **Following the roadmap literally would have published Oura's decompiled source code and their raw
> weight archive in the public repo's first commit.** The `.onnx` files were never the worst item.
>
> **The good news is that the gap is also the cheap half.** Verified by the new gate: *nothing
> imports any of those five paths* — they appear only in code comments as provenance pointers. **46.9
> of the 81.2 MB can leave the tree with zero code changes**, and it is the half that matters most.
> What stays entangled is `lib/oura-models/constants/` (11.6 MB, statically imported by
> `constants/index.ts`) and the `.onnx` tree (22.8 MB, CI reads it off disk) — 34.4 MB, both already
> known and both separately scoped.
>
> **Owner decisions, 2026-08-10** — these close the open questions this entry and #999 carried:
>
> | | Decision |
> |---|---|
> | BLE protocol port | **Public.** It is our own code and is imported throughout the app; splitting it out means a two-repo build. The *knowledge base* (`.agents/skills/oura-native-ble/`) goes private — that raises the effort to reproduce the work without pretending the protocol is unknowable from published code |
> | Extracted material | **Archive to the bucket, then remove from the tree.** Not deleted: re-extraction needs a re-onboarded ring, which the protocol-freeze rule forbids |
> | CI model delivery | **Distilled fixtures.** Record each model's output once and assert against the recording; CI stays offline and holds no credential. Rejected: bucket credentials as Actions secrets — a live credential in CI on a repo about to be public, plus a 27 MB download per run that makes every red CI ambiguous |
> | Docs | **Publish all except `docs/oura-models/` and the two Oura skills.** The orientation workflow depends on them and they are engineering notes, not secrets |
> | Licence | **MIT + a `NOTICE`** stating the BLE work is independent and no third-party weights are included. MIT was never wrong — it was being applied to Oura's files, which is not the owner's to give away |
> | Repo | New public repo (`TrainingAI_Public` or similar, not yet created). Old repo **archived private**, never deleted — the docs cite PR numbers throughout |
>
> **The protective effect worth understanding:** the ports are public, the numbers are not.
> `cumulative-stress.ts` is 874 lines that does nothing without
> `cumulative_stress_1_2_2.constants.json`. Publishing the code while the constants stay in the
> bucket means what is public is a shell. That is real protection and it falls out of decisions
> already made.
>
> **📍 PHASE A STATUS after 2026-08-10.** A1 (inventory + gate), **A2 (the CI blocker)**, A5 (hygiene)
> and A6 (dry-run) are done. Journal:
> [`2026-08-10-github-repo-migration.md`](overview/history-2026-08-08.md).
>
> - **`node scripts/publish-dry-run.js --ready` is GREEN** — 46.9 MB, including every decompiled
>   source file, can be removed today with the full suite passing. That is the A4 payload.
> - **`--all` is blocked on one static import**, `constants/index.ts`. Its ~170 test failures are a
>   single root cause: `adapter.ts` fails to import and takes every DB test with it. Do not read them
>   as 170 problems.
> - **✅ A3 SHIPPED 2026-08-13** — the constants are read at runtime, `--all` is green on all six
>   gates with the full 81.2 MB removed. Journal:
>   [`2026-08-13-constants-runtime-loader.md`](overview/history-2026-08-12.md).
>   Two corrections it produced: the client-chain problem A3b was written around **no longer exists**
>   (nothing under `app/`/`components/` reaches these files), so the MET table moved behind the loader
>   rather than needing its values re-sourced — re-sourcing from the public Compendium stays worth
>   doing as #999 Task 2, but is no longer a blocker; and the manifest was over-claiming, listing our
>   own loader and its test as unpublishable until the dry-run failed to compile a tree missing its
>   own source.
> - **A3 was scoped smaller than this entry assumed** —
>   [`2026-08-10-constants-runtime-loader.md`](superpowers/plans/2026-08-10-constants-runtime-loader.md).
>   No client component imports the constants, so it is a lazy `readFileSync` behind the ten existing
>   getters. The one exception, `energy-expenditure-features.json` (11.8 KB, on a `'use client'`
>   chain), should be **replaced** from the public Compendium (#999 Task 2) rather than moved.
> - **The CI model-delivery gate this entry called "the real remaining gate" is CLOSED.** Every
>   model-dependent test in the repository passes with all ten `.onnx` files removed, via recordings
>   (`inference/__tests__/helpers/replay-session.ts`). No bucket credential in CI, no network in the
>   test run.
> - **Owner actions outstanding:** rotate credentials, sign off the `ADMIN_EMAIL` bootstrap
>   (auth-adjacent, untested against a fresh DB), name the new repo.
> - **The bucket archive is OPTIONAL, and this entry said otherwise on 2026-08-10 — corrected after
>   the owner asked whether it was already uploaded.** It largely is. Three copies already cover the
>   private paths: the old repository is **archived, not deleted** (roadmap B5), so its git history
>   holds all of them; the decrypted `.pt` originals are in the bucket under
>   `oura-model-pt-originals/` (recorded uploaded and verified 2026-07-21), and `weights/`,
>   `constants/` and the decompiled source were all derived mechanically from those; the `.onnx`
>   files are in `oura-model-onnx/`. `scripts/archive-private-paths.js` exists for the residual
>   case — reproducing from `.pt` needs a torch environment and extraction tooling this project no
>   longer has anywhere, and the hand-written material (model skills, the three extraction docs) was
>   never derived from a `.pt` at all. Cheap insurance; **not a prerequisite for deleting anything**.
>
> **Shipped with this finding:** `scripts/private-paths.json` (the manifest, one entry per path with
> its kind, reason and archive destination) + `scripts/check-private-paths.js` (Custom Rules CI step,
> `pnpm ci:local`, pinned by `scripts/__tests__/private-paths.test.ts`). The check proves the
> `importedByCode: false` claim rather than asserting it, and was **verified falsifiable** — injecting
> a real import of `lib/oura-models/weights/` fails it by name, removing the import passes. It also
> prints the **25 provenance comments** that must be rewritten before the cut, so that worklist is
> measured rather than remembered.

> **⚑ Model-delivery question ANSWERED 2026-08-04, and the reasoning changed.** It was framed to the
> owner as a repo-size/git-history question. It is not. `docs/oura-models/readable/BUNDLE-README.md`
> records that the `.onnx` files are the **decrypted, introspected and extracted** form of Oura's own
> `oura_models.apk` — they are Oura's proprietary trained weights, not ours. Publishing them in a
> public repo redistributes another company's models under the owner's name.
>
> **Therefore the models MUST NOT be committed to the public repo, and this is no longer a
> trade-off.** They move to the Railway bucket (already uploaded — `scripts/upload-model-assets.js`,
> verified by `GET /api/admin/model-assets`) and CI fetches them at build time via an Actions secret,
> which is the one thing the owner has to set. Owner agreed. The earlier "leave them in git until
> Phase B" option is withdrawn: it would mean the public repo's very first commit carries them.
>
> **Watch out:** 14 test files read the `.onnx` files off disk, and CI has no bucket credentials
> today — that is exactly why the delete step was blocked before. The fetch step has to land in CI
> *before* the files leave the tree, not after.


> **Phase A0 (dormancy sweep) shipped 2026-08-02** — `scripts/check-oura-models-dormancy.js`, a
> Custom Rules CI step, a `pnpm test` pin, and 7 byte-identical duplicate constants deleted
> (`lib/oura-models/onnx/constants/` mirrored `lib/oura-models/constants/`). **Two deletions it
> deliberately did not make are filed as Q-50.**
>
> **A1 step 5 (the boot-time model-asset assertion) shipped early, 2026-08-02** — ahead of the
> move rather than with it, so the guard exists before the thing it guards against becomes
> possible. `lib/oura-models/required-models.ts` + a drift test + a boot check in
> `instrumentation-node.ts`. It **logs loudly, it does not fail the boot**: while the files are
> still in git the check can only fire on a false positive, and taking production down on one is
> pure downside. **Flipping it to fatal is one `throw`, and belongs in the PR that moves the
> files.**
>
> **A1's storage question is ANSWERED (owner, 2026-08-02): the app's existing Railway S3 bucket** —
> the one already serving exercise gifs through `lib/exercise-storage.ts`. This is better than the
> plan's Cloudflare-R2 suggestion and better than a private GitHub release on a repo about to be
> archived: `@aws-sdk/client-s3` is already a dependency, the credentials already exist as Railway
> **runtime** env vars, and `downloadMedia(key)` already performs exactly the fetch needed.
>
> **This changes A1's design — do not follow the plan's step 4 literally.** It specifies a
> *build-time* fetch via `nixpacks.toml` plus a **new build secret**. Neither is needed: fetch at
> **runtime** instead, inside `getSession`, which already memoises per process — so a container
> downloads each model once after a deploy rather than per request, using credentials that are
> already there. Fewer moving parts, no new secret, and it keeps working if the build environment
> ever loses the vars.
>
> **Read half shipped 2026-08-02 (#1021): `getSession` reads the bucket first, the repo tree
> second.** Owner uploaded the eight files to `oura-model-onnx/` via the Railway UI. The order is
> deliberate — reading the bucket first while the local copies remain means production exercises the
> real path with a safety net under it, and the logs say which source served each model.
> **The gate is no longer the deploy logs — it is `GET /api/admin/model-assets`** (shipped
> 2026-08-03, v1.252.3; Admin → Tools → Additional tools → **Model asset delivery**). The log-line
> gate was replaced because it could not work: the loaders are lazy, so the lines only appear once a
> sleep rollup happens to run, and their *absence* is indistinguishable between "bucket empty" and
> "nothing has asked for a hypnogram yet". The endpoint asks the bucket directly and returns one of
> three verdicts — `complete` (all 8 present and non-empty: **this is what unblocks deleting the
> local copies and flipping the boot check to fatal**), `incomplete` (something is missing or
> zero-length — re-run the upload script, delete nothing), or `unreachable` (could not talk to the
> bucket, so its contents are unknown). See
> [`docs/overview/overview/history-2026-07-30.md`](overview/history-2026-07-30.md).
> **⛔ CORRECTED 2026-08-04 — a `complete` verdict is NOT sufficient to delete the local files, and
> this entry previously said it was.** The owner ran the check today and it reads `complete`, so the
> *production* half is proven: the bucket really can serve every model. But **the repo-tree copies
> are load-bearing for CI, not just a production fallback.** Fourteen test files read
> `lib/oura-models/onnx` — most via `fs.readFileSync` directly, bypassing `getSession` and its bucket
> path entirely — and `inference/__tests__/sleepnet.test.ts` asserts `not.toBeNull()` with a comment
> reading *"incl. CI"*. `.github/workflows/ci.yml` carries no bucket credentials at all, only
> Postgres. **Deleting the files today turns those fourteen files red, with no way for CI to fetch
> replacements.**
>
> **The real remaining gate is a CI model-delivery story that nobody has scoped.** Options, to be
> decided before any deletion: bucket credentials as Actions secrets plus a pre-test fetch step (puts
> a network dependency and a secret in every CI run); or commit small distilled test fixtures and let
> the full models live only in the bucket; or accept the models staying in git until Phase B forces
> the issue, since **Phase B — the public cut — is what actually requires them out of git**, not A1.
>
> **The fatal boot check has the same problem and a second one.** `instrumentation-node.ts`'s
> `checkModelAssets()` verifies files **on disk**, so it would fail instantly the moment the files
> are deleted — it has to be repointed at the bucket in the same change, not merely `throw`n. And
> while the repo-tree fallback still exists, a fatal check has nothing real to catch: production
> cannot silently degrade while a working local copy is sitting there. Flipping it *before* the
> deletion is the "pure downside" the code comment already warns about.
>
> If it is repointed at the bucket, it should be fatal on **`incomplete`** (definitively missing —
> a real, otherwise-invisible failure) and a loud log on **`unreachable`** (transient network or
> credential blip — taking production down on one is exactly the downside the owner accepted this
> risk to avoid, and the distinction is free because `bucket-report.ts` already returns it).
>
> **Owner has approved the availability trade** (2026-08-04, *"If this is the way to proceed then
> yes"*) — so the decision is not the blocker; the CI story is.
>
> **`scripts/upload-model-assets.js` ships the upload half** (`--check` to verify without writing).
> It cannot run from a session sandbox — the bucket env vars are present but are non-authenticating
> placeholders, exactly like `$GITHUB_TOKEN` (`SignatureDoesNotMatch` against `t3.storageapi.dev` on
> every region). **The owner runs it once**; the remaining code work is then unblocked.
>
> **Only the `.onnx` files move. `lib/oura-models/constants/` cannot, and this is not a scoping
> choice** — those constants are *statically imported* by `constants/index.ts`, so webpack bundles
> them at build time and no runtime fetch can replace a static import. Moving them needs that file
> restructured into a runtime loader, which touches every port that reads a constant. That is its
> own task and it means **the repo cannot go fully public on the `.onnx` move alone** — 12 MB of
> vendored constants stay in git until it is done. Size it before promising Phase B a date.
>
> Journal:
> [`docs/overview/overview/history-2026-07-30.md`](overview/history-2026-07-30.md).
> Journal: [`docs/overview/overview/history-2026-07-30.md`](overview/history-2026-07-30.md).

- **Runbook (start here):** [`public-repo-cut-runbook.md`](public-repo-cut-runbook.md) — the
  ordered checklist, who does each step, and how each one is checked.
- **Plan:** [`2026-08-02-public-repo-migration-roadmap.md`](superpowers/plans/2026-08-02-public-repo-migration-roadmap.md)
- **Depends on:** [`2026-08-02-oura-ip-triage.md`](superpowers/plans/2026-08-02-oura-ip-triage.md) (#999) — the
  *what*; this entry is the *how it reaches production* plus the cut itself
- **Added:** 2026-08-02
- **Why top:** the private repo has a **running daily cost** the roadmap never weighed — the
  `apk-latest` release URL 404s unauthenticated (so `/api/download-apk` + a PAT is the only
  distribution path, and a second user cannot install without it), and Actions minutes are metered.
  **This entry releases the Q-1 + Q-30 gates on Q-32**, which were sequencing preferences rather
  than technical dependencies.
- **The one real dependency it replaces them with:** #999's gitignore verdict (rows 4/5/6) says to
  keep SleepNet, `step_counter` and `steps-motion-decoder` on the owner's private build machine — but
  those models run **server-side on Railway** (`onnxruntime-node`, `adapter.ts:5006`, inside
  `aggregateOuraRawSamples`), Railway deploys from git, and every loader returns `null` on failure.
  Gitignore alone silently kills the hypnogram and ring steps in production. **Owner chose
  build-time fetch from private storage** (2026-08-02) so the ring path keeps working.
- **Ordered tasks:** A0 dormancy sweep (= #999 Task 0) → **A1 private-asset delivery** (`ONNX_DIR` at
  `inference/session.ts:12` is a one-line choke point; the deliverable is the *boot-time assertion*
  that makes a missing asset fail loudly) → A3 publish dry-run → B1 hygiene → B2/B3 snapshot + CI →
  B4 Railway repoint → B5 archive → B6 cleanup. **#999's replacement tasks (2/3/5/6) are A2 and are
  NOT on the critical path** — A1 makes a gitignored asset deployable, so they can land at any pace,
  before or after the cut.
- **Owner actions:** a private storage bucket + one Railway build secret · create and name the repo ·
  the Railway repoint · credential rotation · read #999's closing ported-logic section before B2.
- **Critical path ≈ 5 sessions.** Confirm-first at B4 (production repoint) and B1 (credential
  rotation); everything before that is ordinary.

### [platform] 🟡 Q-50 — two vendored-model deletion decisions the dormancy sweep could not make

- **Branch:** none yet · **Added:** 2026-08-02 by Q-49 Phase A0 (the sweep itself shipped; these are
  what it deliberately did not act on).
- **Why filed rather than done:** both are one-way deletions of extracted Oura assets that cannot be
  recovered from this repo, and the plan's own framing of A0 as "pure subtraction" does not hold for
  either.

**1. `inference/dhrv` — the plan says delete it; `docs/module-map.md` says keep it.**
It is genuinely unreachable from production: `computeDaytimeStress` and `buildDaytimeStressSeries`
(`lib/health/daytime-stress.ts`) are the only callers of `runDhrvImputation`, and since D5 replaced
that path with our own regression they are reached from **tests alone**. But that unreachability is
**deliberate and has a named exit condition** — `docs/module-map.md` and
`docs/oura-ondevice-hybrid-implementer-progress.md` both record that the ONNX path *"stays
golden-tested but unreachable from production **until D7**"*, and that golden test is what pins our
D5 replacement against Oura's original. Deleting it now discards the validation while the replacement
is still young. **Decide as part of D7, not as a sweep.** The "deletable today" wording has been
corrected in the three docs that carried it.

**2. Two BDI weight files have no loader.** `onnx/sleepnet_bdi_0_3_0_core.onnx` and
`sleepnet_bdi_0_4_0_core.onnx` (plus their constants) are never named by a `MODEL_FILE` — BDI is
derived from the moonstone model's own apnea head via `bdiFromApnea` (`sleepnet-assemble.ts:131`).
They look genuinely unused, but they are extracted weights and a future BDI revision is exactly what
would want them. ~~Owner call: delete, or move to private storage with the rest under Q-49 A1.~~
✅ **ANSWERED 2026-08-03: keep them** (owner: *"yes lets keep then"*). So they move to the bucket
with the other eight under Q-49 A1 rather than being deleted — add them to
`lib/oura-models/model-files.json` as a **separate, non-required list** when A1's remaining step
runs, so the boot check does not start demanding files no loader reads. **Item 1 (`inference/dhrv`)
is still open and still deferred to D7** — that one is not covered by this answer.

Both are registered in `scripts/check-oura-models-dormancy.js`'s `KEEP` map with these reasons, so CI
passes and the inventory is explicit rather than forgotten.

### [platform][app-shell] 🟠 Q-48 — roadmap gaps found by the 2026-08-02 native-convergence review

- **Branch:** `docs/native-roadmap-corrections` (docs-only; each sub-item may spawn its own build entry)
- **Review:** [`docs/reviews/2026-08-02-native-convergence-roadmap-review.md`](reviews/2026-08-02-native-convergence-roadmap-review.md)
- **Added:** 2026-08-02 · **renumbered from Q-46**, which run-1 claimed the same day (#1003)
- **F1/F6 are now actioned by Q-49 above** — the rest stand.
- **Why here:** these are gaps in the *plan*, not the code, so each one costs a stage-sized mistake
  later rather than a bug now. Four of the eight findings are one-line edits and are already applied
  (F8 drift). The four below need an owner decision or a short planning pass, and none has an owner.

| Ref | Gap | Recommended edit |
|---|---|---|
| ~~**F1**~~ | ✅ **APPROVED by the owner 2026-08-03** (*"I dont see an issue in splitting it. go for it."*) — Q-1 is split below into **Q-1a** (client bearer auth + `apiUrl()`; **no Gate A, startable now**) and **Q-1b** (workspace split + static export; still deferred with the second Railway service) | Done |
| ~~**F2**~~ | ✅ **ANSWERED by the owner 2026-08-03: GitHub Releases + the in-app update button.** *"I wanted app updates through the github releases so we just press the update button in the more section to download the new apk."* **This already exists end to end** — `UpdateCheckCard` (More) compares the installed APK's `versionName` against `/api/version` and links to `/api/download-apk`, which redirects to the `apk-latest` release asset that `.github/workflows/android.yml` republishes on every push to `main`. **No OTA plugin, no Play internal track.** The finding's premise ("no update-delivery path exists") was wrong — it looked for a live-update plugin and missed the sideload path already built. ⚠️ It was, however, **broken**: `versionName` was hardcoded at `1.30.0` while the app ran 1.252.x, so the card claimed an update forever, including right after installing the newest build. Fixed 2026-08-03 — `build.gradle` now derives both `versionName` and `versionCode` from `package.json`. **Needs the next APK to take effect** (the fix is in the file that builds it). | Done — no Stage 2 precondition needed; record the mechanism and keep the version stamp honest |
| **F3** | Play Store + multi-user are stated requirements in `device-agnostic-source-architecture.md` and appear in no stage; `public-launch-checklist.md` holds one item while five launch-gating items sit in four other docs (HC declared-use-case review, privacy policy/data-safety, map attribution, one-owner BLE assumptions, `006_admin_flag.sql`) | ✅ **ANSWERED 2026-08-03: IN.** Owner: *"yes part of the plan. I want other people to be able to use this app as its really good."* So: **every write stays `user_id`-scoped, the sync engine is maintained and extended rather than reduced, and no surface may assume the owner's own device or ring.** Still to do — add Stage 8 to the goal layout and gather the five scattered launch-gating items into `public-launch-checklist.md`. The **Health Connect declared-use-case review is the long pole** (an external approval with a lead time nobody controls) and should be started well before the rest |
| **F4** | Stage 1 is called "the spine" and defines no schema — 70 `pgTable` vs 37 local tables with no residency/ownership record. Stage 5 generates Room entities from it. Q-44 Phase 3's 22-table rename is unsequenced against it and must land *at* Stage 1 or never | Stage 1's deliverable becomes a table-by-table residency matrix (device/server/both, writer, retention tier, derived?) + the `oura_*` rename go/no-go |
| **F5** | Stage 5 re-implements the subsystem with the worst incident history in the repo (#47/#74/#82) with no plan, no parity harness, an unowned native replacement for `scripts/check-push-mutations.js`, and a transitional *third* write path per domain | Stage 5 opens with a golden-vector parity harness driving both implementations; add the native one-write-path guard as a named task; add a "Stage 5 without Stage 6" off-ramp |
| **F6** | Q-31/Q-32 gate on Q-1, which the owner deferred — so Stage 4 is transitively parked and nothing says so. The gate is a sequencing preference, not a technical dependency, and a Play Store listing does not require a public repo | State the deferral on Q-32; decide whether the Q-1 gate survives |
| **F7** | Push is web-push/VAPID through the service worker with no FCM anywhere; `output: 'export'` already disables `next.config.ts` headers, and E6 (server-side scheduler) has never been built — nothing can notify a user who has not opened the app that day | Add push to Stage 2's exit criteria; add an FCM decision point at Stage 5/6 |

**F8 (five drifted doc claims) is already fixed in the same PR as this entry** — do not re-file it.

### [app-shell][platform] 🟢 Q-44 — remove vendor naming: Phases 2 and 3 only

> **⚑ Owner answered 2026-08-04: Phase 3 IS the goal, not optional.** *"yes your choice; but I want
> the end goal of moving from your example of oura_daily -> sensor_daily."* So Phase 2 proceeds as a
> plain refactor, and **Phase 3 gets a written migration plan rather than being quietly dropped** —
> which is what this entry already said it needs (*"needs its own plan"*). Do not close Q-44 on
> Phase 2 alone.

- ✅ **Phase 1 (user-visible copy) shipped 2026-08-02, v1.250.12** — eight strings, see
  [`docs/overview/overview/history-2026-07-30.md`](overview/history-2026-07-30.md).
  That was the whole owner-facing goal; the app no longer presents as an Oura client on any
  non-admin, non-pairing surface. **Two exemptions are deliberate and must not be "finished" by a
  later sweep:** `app/admin/**` + `components/admin/**` (diagnostic — the vendor is the subject) and
  `components/more/oura-section.tsx` (the OAuth/pairing screen — the user really is authorising
  Oura). Both are argued in the journal entry.
- **Branch:** `refactor/de-oura-identifiers` (Phase 2)
- **Plan:** [`2026-08-02-de-oura-naming.md`](superpowers/plans/2026-08-02-de-oura-naming.md)
- **What is left is hygiene, not the owner request.** Phase 2 is 182 identifiers and Phase 3 is the
  schema tables (~2,813 repo-wide references). Both carry real regression risk — Phase 2's trap is
  cache keys. Neither is urgent now that Phase 1 has landed.
- ✅ **Phase 3 now HAS its plan (2026-08-04):**
  [`docs/superpowers/plans/2026-08-04-vendor-table-rename-phase-3.md`](superpowers/plans/2026-08-04-vendor-table-rename-phase-3.md).
  Three PRs, not one: rename behind compatibility **views** (an `ALTER TABLE … RENAME` is
  catalogue-only, so 794,659 rows in `oura_raw_samples` cost nothing, but an overlapping Railway
  container would query a table that moved — the view is what removes that window), then move the
  code, then drop the views in a later session.
  **The trap the schema-only framing missed:** `sync-engine.ts` dispatches on domain *strings*, and
  an **already-installed APK keeps sending the old ones** until the owner reinstalls — so the
  handlers must accept both for at least one APK cycle or every queued mutation on the device
  strands silently.
  **Counted 13 vendor-named tables, not 22**, and the plan keeps **two** of them: `oura_tokens`
  (genuinely Oura Cloud credentials) and `oura_raw_samples` — the backlog's doubt about that one is
  correct, because it holds reverse-engineered frames of *that ring's* firmware and
  `sensor_raw_samples` would imply a shared frame format that does not exist.

### [app-shell] 🟢 Q-1a — client bearer auth + `apiUrl()` (SPLIT OUT 2026-08-03 — startable now)

- **Branch:** `feat/client-bearer-auth`
- **Split from Q-1 on the owner's approval, 2026-08-03** (review finding F1) — *"I dont see an issue
  in splitting it. go for it."*
- **Why it is separate:** a native client needs client-side bearer auth **permanently**, whichever
  way the shell is delivered. The static-export bundle below is throwaway the moment Compose
  replaces a screen. Fused together, the durable half inherited the throwaway half's blocker — the
  second Railway service, which the owner deferred. Split, this half has **no Gate A and can start
  immediately**.
- **Already decided, do not re-open:** Q-1's Task 1 chose **bearer-token-in-Capacitor-secure-storage
  reusing the existing NextAuth session JWT** — not a new credential; the PKCE mobile flow already
  mints it.
- **Read first — three load-bearing corrections** are in Q-1's Task 2b (auth preconditions) below,
  the sharpest being that `isActive === false` is enforced **only** in `middleware.ts:18`, so a
  client that talks to the API directly bypasses the deactivation check entirely.
- **Scope:** the bearer-token client + an `apiUrl()` indirection so every fetch can target either
  origin. **Not** the workspace split, **not** `output: 'export'` — those are Q-1b.

### [app-shell] ⛔ Q-1b — native ("Swift-like") feel: Phase 3 (bundle the shell into the APK) — **DROPPED 2026-08-04, measurement says it is not worth it**

> **The gating measurement was taken (Q-51 Task 3, owner on the S25, 2026-08-04) and it does not
> support this.** Home paints in **472 ms**, of which **439 ms is the document round trip to
> Railway** and about **15 ms is JavaScript** — 87 files, all served from the service-worker cache.
>
> Bundling the shell into the APK removes exactly one thing: that 439 ms fetch. It does not touch
> native process start or Capacitor init. **So the entire prize is ~0.44 s**, for a large piece of
> work, on a screen already painting in under half a second — against the 1.5 s threshold Q-51 set
> for "already fine, do not bundle".
>
> The responsiveness investigation had already retracted the navigation claim ("tab switches are
> already local … it will not make navigation faster"), and the same device pass confirmed
> returning to an opened tab **is** instant. Cold start was the only remaining case for this entry,
> and cold start is fine.
>
> **The cheaper attack on the same 439 ms**, if the owner ever reports home feeling slow: the
> service worker's navigation handler is **network-first**, so the document waits on the network
> even when a copy is cached. A cache-first shell targets the same number without bundling
> anything. Not queued — 472 ms does not justify it yet.
>
> **Do not reopen this without a new measurement.** It was deferred by the owner twice on cost
> grounds and is now closed on evidence; reopening on intuition would discard the one number anyone
> actually took. Kept (not deleted) because the plan documents below still describe real work if the
> premise ever changes.

Plan: **[`docs/superpowers/plans/2026-07-28-native-feel-roadmap.md`](superpowers/plans/2026-07-28-native-feel-roadmap.md)**,
Phase 3 detail: **[`docs/superpowers/plans/2026-07-28-native-feel-phase-3-bundled-shell.md`](superpowers/plans/2026-07-28-native-feel-phase-3-bundled-shell.md)**.
Owner's active directive (issue #868). Phases 0–2 and 4, plus several device-profile
findings (screen transitions, wallpaper compositing, hidden-tab animation pausing,
Capacitor bridge logging) are all shipped — see `projectOverview.md`'s Current Status
for the up-to-date list; this file doesn't repeat it.

**Current state (2026-07-29):**
- **Task 1 (auth model) — done.** Owner chose bearer-token-in-Capacitor-secure-storage
  (the existing NextAuth session JWT, not a new credential — the PKCE mobile flow
  already mints it).
- **Task 2 (static-export spike) — done, and it changed the shape of the work.**
  `output: 'export'` is a whole-app flag: 105 of 195 API routes have non-GET
  handlers, and 87 of the remaining 89 call `await auth()` — only ~2 routes are
  actually exportable. The shell and API **must be built separately**.
- **Task 2b (auth preconditions) — written**, three corrections load-bearing for
  Task 3: (1) `isActive === false` is enforced *only* in `middleware.ts:18` — a
  client gate that just checks "is there a session" lets deactivated users into
  every screen; (2) the matcher is a **negative** pattern (guards most routes by
  default) — reproduce it as default-deny client-side, never a whitelist; (3) the
  bearer token is the existing session JWT, no new credential needed.
- **Task 3 (move auth client-side, ~21 sites) — UNBLOCKED 2026-07-30.** It was briefly
  ⛔ blocked because its page conversions and its Step 4 (removing `middleware.ts` route
  protection) are only safe once a static export means no middleware runs — i.e. after
  Task 4 — and would have been pure loss under option C. **Task 4 is now decided (B), so
  that objection is resolved.** Sequence it *after* the workspace split, not before:
  Step 4 must not land while middleware is still the live gate. Merge stays confirm-first.
- **Task 3 (move auth client-side, ~21 sites) — original note, retained for detail.** A
  bearer token is a prerequisite under all three Task-4 build-split options. Read
  Task 2b in the plan before touching anything. Shape: one commit per page,
  `app/layout.tsx` **last**, cookie path stays valid throughout so each step is
  individually revertible. **Merge is confirm-first** — auth-boundary change.
- **Task 4 — DECIDED 2026-07-30: option B, two apps in a workspace.** Owner delegated
  the choice with criteria "best option not easiest", performance/efficiency, and more
  updates coming. Runtime performance is identical between A and B; what discriminates
  is that A's tree-mutating shell build is a hazard paid on *every* future build, while
  B's cost is a one-off refactor with honest per-app configs. C rejected — it leaves the
  shell JS on the network, which is most of what Phase 3 removes. Full reasoning in the
  plan's Task 4 decision block. **Cost accepted: B touches every import path and is
  multi-session** — sequence as workspace + shared `lib/` package, then the app split,
  then Task 4c, so each step is independently revertible.

**Workspace-split plan (Task 4, option B) written 2026-07-30:**
[`docs/superpowers/plans/2026-07-30-phase-3-workspace-split.md`](superpowers/plans/2026-07-30-phase-3-workspace-split.md)
— workspace + shared `lib/` package → app split (`shell/` + `api/`) → Task 4c (flip
`output: 'export'`). Sequences Task 3 (client auth) between its Step 3 and Step 4, per the
existing note above. **Step 1 (workspace scaffold + first isomorphic package slice) has
merged** (`@trainingai/shared`), and Step 2 (finish moving isomorphic `lib/` code) has also
merged — see `projectOverview.md`'s Current Status for the up-to-date state.

**Step 3 (the app split into `shell/` + `api/`) was attempted 2026-07-31 (#952) and immediately
broke production** — the root `build`/`start` scripts deployed `shell/` alone, and `shell/`'s
`/api/*` rewrite falls back to `http://localhost:3001` because the second Railway service for
`api/` was never provisioned, so every API call (including `/api/auth/*`) failed. Reverted clean
(#962). **Blocked on an owner/infra action, not code:** stand up a second Railway service for
`api/`, confirm it serves `/api/**`, and set `API_ORIGIN` in `shell/`'s Railway environment —
*before* re-merging. The branch content itself is already built and tested; nothing needs
redoing once the service exists.

**Both adjacent auth fixes are now done — nothing auth-side blocks Phase 3.**

**Note (not actioned, optional, low-priority): no OTA/live-update path exists for post-split shell
updates.** Found 2026-07-31. Today, shell/UI changes ship through Railway with no APK rebuild —
only rare Kotlin/native changes need one. Once the shell is bundled into the APK, every shell
change becomes a Kotlin-style change: a new build, a new GitHub Release (the existing `android.yml`
workflow already publishes a rolling `apk-latest` release), and the user manually tapping through
the existing in-app update card (`components/more/update-check-card.tsx` →
`/api/download-apk` → sideload install). That flow already exists and needs no changes to keep
working post-split — but there's no silent OTA/hot-swap path (`capacitor-updater` or equivalent)
anywhere in the codebase, so every shell change costs a full manual reinstall. Not worth doing now
given how rarely rebuilds happen today; worth revisiting *if it turns out to be low-effort* once
Phase 3 ships and this update cadence is actually felt. Full detail in the Phase 3 plan doc's new
"post-split update delivery" note (added same session).

**🆕 2026-08-02 — DEFERRED BY OWNER, NOT CANCELLED.** After #952 broke production, the owner asked
whether Next.js+Capacitor is the right architecture at all for an Android-only, offline-first app,
and floated a from-scratch rewrite (e.g. native Kotlin + Jetpack Compose) instead of continuing
Phase 3. **Owner decision (2026-08-02): work everything else first, but Phase 3 is still expected
to ship *before* any native rewrite — "we can push it till we HAVE to do it."** So:
- **Do not provision the second Railway `api/` service** and do not re-land the workspace split
  while other queue items exist. That infra spend stays unmade for now.
- **Do not delete or retire this entry** as superseded — it remains on the roadmap.
- Q-31 and Q-32 stay `⛔ blocked` behind it.

The original framing and the research prompt for the rewrite question are still valid reading; see
[`docs/handoff-2026-08-02-platform-offline-architecture-review.md`](../docs/handoff-2026-08-02-platform-offline-architecture-review.md)
for the full reasoning and a ready-to-run research prompt for the next session.

**Deactivation staleness — FIXED 2026-07-30 (v1.243.1).** `auth.ts`'s jwt callback re-reads
`isActive` via `refreshIsActiveClaim` (`lib/auth/is-active-refresh.ts`), throttled to once per 24 h.
Owner chose the bounded-window option over closing it fully at a per-render query. The Edge-runtime
retraction stands: the check cannot live in middleware. ⚠️ The 24 h flip is unit-tested but was not
observed end-to-end (needs a day or a faked clock).

**`/mobile-signin` behind the auth gate — FIXED 2026-07-30 (v1.242.3).** Added to
`PUBLIC_PATHS`; measured A/B against `pnpm dev`, unauthenticated
`GET /mobile-signin?challenge=abc123` went 307→`/sign-in` (param dropped) before, 200
after. ⚠️ **Still not confirmed on a real first-run install** — that needs a fresh APK
install with no existing browser session.

**Sizing honesty (from the Phase-0 device measurement):** Phase 3 buys cold start
and hard reloads only — tab switches are already local
(`components/shell/tab-shell.tsx`), and non-tab routes are RSC fetches, already
fast. It will not make navigation faster. Cold start is now dominated by JS
parse/execute, not the document fetch — bundling removes the network hop but not
the execute time. **Do not naively retry Phase 2's cached-document approach**
(reverted in #891) — serving a cached document stamped with an old Next build id
against a newer server looped the app on a blank shell for nearly two minutes.

**Owner framing, worth keeping in mind:** an earlier draft of this entry judged
Phase 3 purely as a latency optimisation and called it marginal. That was retracted
— the owner's stated direction is app-native (everything on device, Postgres
demoted to sync/redundancy), and Phase 3 *is* that direction. Don't let a
millisecond count talk a future session out of it.

> **🆕 OWNER DECISION 2026-08-02 — Phase 3 is now gated behind Q-51's measurement.** *"Let's roll
> with that — we can test for speed then move to the bundling shell if there is further issues."*
>
> This **narrows the note directly above it**, so read both together. The architecture rationale
> stands: Phase 3 remains the app-native direction and is **not** cancelled or downgraded to an
> optimisation. What changed is the *trigger*. The owner's felt problem is the home screen and tab
> navigation (Q-51), and Phase 3's own sizing note says it will not make navigation faster — so
> **Phase 3 waits until Q-51's tasks 1–2 have shipped and its task-3 cold-start profile has been
> taken on the S25.** If that profile shows the remaining gap is the WebView shell rather than
> bundle parse/execute, Phase 3 is back on. If Q-51 closes the gap, Phase 3 stays queued on its
> architecture merits alone and stops being urgent.
>
> **What this does NOT license:** deleting this entry, calling it superseded, or treating "the owner
> deprioritised it" as "the owner rejected it". It also does not unblock Gate A — do not provision
> the second Railway `api/` service.
>
> Full reasoning: [`docs/reviews/2026-08-02-native-convergence-roadmap-review.md`](reviews/2026-08-02-native-convergence-roadmap-review.md)
> and the Q-51 entry.

### [devices][readiness][app-shell] 🟠 Q-29 — Oura on-device rollup migration — Task 4 built, Task 5 next

**Not a new planning item — this corrects a duplicate entry a different 2026-07-30 session
nearly created.** [`docs/offline-first-target-architecture.md`](offline-first-target-architecture.md)
names `aggregateOuraRawSamples` (`lib/data/postgres/adapter.ts:4658–~5764`) as the load-bearing
piece of the offline-first direction and initially asked for a fresh plan. One already exists, in
far more depth, and is ~40% shipped: the **Oura on-device + own-analysis program** (D0–D7,
owner-directed 2026-07-21, four adversarial reviews). Entry point:
[`docs/oura-ondevice-hybrid-handover.md`](oura-ondevice-hybrid-handover.md) →
[`docs/oura-ondevice-hybrid-implementer-progress.md`](oura-ondevice-hybrid-implementer-progress.md)
(live state) →
[`2026-07-21-oura-ondevice-hybrid-master-plan.md`](superpowers/plans/2026-07-21-oura-ondevice-hybrid-master-plan.md)
(the D0–D7 plan — read its Review Outcome block first). **Do not write a second plan for this.**

**Shipped:** D0 (step_counter primary steps), D1 (full six-form durability/sync chain +
full-history restore), D5 (own daytime-HRV), D6 (Polar H10 comparison harness), D2 Tasks 1–3
(local-store accessors + native `oura_raw.db` raw store + WebView bridge, sandbox-verified
2026-07-27).

**✅ BLOCKING GATE CLEARED 2026-07-30.** Owner ran the ops-doc §4 runbook on the S25: a Full
re-sync drained 694 batches clean ("drain complete: batches=694 bytesLeft=0"), and the
kill-mid-drain test (force-closed the app mid-drain, reopened) resumed with no gaps, no repeats,
and no errors. Two sub-checks (`getUnrolledRaw`/`markRolledUp`, `rawStoreOpen`/`lowDisk`) have no
admin-console UI to run directly — **`rawStoreOpen`/`lowDisk` now do**, via the Raw store card
shipped in #1002 / v1.250.5 (Q-33, closed); `getUnrolledRaw`/`markRolledUp` still don't — and were inferred passing from
the drain log itself (see
[`docs/oura-ondevice-hybrid-implementer-progress.md`](oura-ondevice-hybrid-implementer-progress.md)
for the reasoning).

**Task 4 (on-device clock anchor) — MERGED as #953 on 2026-08-02.** Kotlin compiles, debug APK
assembles, 6 new JVM unit tests pass,
full TS gate green. Deviated from the plan's literal single-forward-anchor design (stale — the
codebase moved to a multi-observation epoch-aware design in migration 161 before this session);
ported the current `insertOuraRawSamples` epoch/reset logic instead. **Not device-verified** — see
`docs/oura-ondevice-hybrid-implementer-progress.md`'s Task 4 note for detail.

**Next: D2 Task 5** (port the deterministic rollup to the WebView) — detail in
[`2026-07-21-oura-raw-on-device-phase-1.md`](superpowers/plans/2026-07-21-oura-raw-on-device-phase-1.md).

> **Task 5 groundwork landed 2026-08-03** — see
> [`docs/overview/overview/history-2026-07-30.md`](overview/history-2026-07-30.md).
> Task 5's Step 3 says to "port the binning verbatim in structure", which taken literally produces a
> **second implementation** of the night's HRV / resting HR / average HR. Those three are now
> `packages/shared/src/health/night-vitals.ts`, called by `adapter.ts`, with 18 unit tests and a
> fuzzed equivalence oracle (400 randomised nights vs a frozen copy of the pre-extraction code).
> **`rollupNight` should call that module, not re-derive it.**
>
> **Two corrections for whoever takes Task 5:**
> 1. **The plan's file map is stale.** It points at `lib/health/daily-medians.ts` and
>    `lib/oura-models/illness-radar.ts`; both are under `packages/shared/src/health/` now. Same
>    staleness class as Q-34's plan — re-verify every path before following it.
> 2. **The DB rollup tests are a weaker net than they look.** Measured by mutation: with resting-HR
>    gating disabled entirely, `oura-ble-aggregate`, `oura-ble-decoded-from-hex`,
>    `oura-ble-daily-summary` and `oura-ble-sleep-bedtime-fragment` all still passed. Only
>    `oura-hrv-median-rollup` caught it. Do not treat a green DB suite as parity evidence.
>
> **What remains is device-paired and was deliberately not started:** `rollup-device.ts` itself, the
> `getUnrolledRaw`/`markRolledUp` bridge wiring, the foreground trigger and cache-group
> invalidation. None is verifiable in a sandbox (`getLocalStore` returns null, no Capacitor bridge).

> **Retention constraint added 2026-08-02** (owner decision, see
> [`2026-08-02-native-convergence-goal-layout.md`](superpowers/plans/2026-08-02-native-convergence-goal-layout.md)
> §4 Stage 1a): raw BLE frames are retained on-device for a **14-day rolling window** only —
> measured production rate is ~25,200 rows/day (~3.2 MB/day), so an uncapped local raw store would
> reach ~1.2 GB/year. This makes Task 8 (prune) load-bearing rather than cosmetic, and means the
> Task 5 rollup must run, push, and release frames *within* that window. A rollup that silently
> falls behind turns the buffer unbounded — it needs a bound and a visible failure state.
Then Task 6 (neural WASM), 7 (tier-ladder), 8 (prune), 9 (storage readout), D3 (silent read-flip to
local-first), D4 (the destructive server-raw drop, its own confirm-first gate), D7 (oracle
deprecation).

**Also worth doing soon:** the D1 restore-proof check (More → profile → "Restore from cloud" on
the S25) — the client pieces have been ready since #758/v1.200.0 and nobody has run it. This is
D4's durability precondition and can happen in the same device session as future D2 work.

### [platform] 🟠 Q-30 — DB volume: finish the diagnosed fix, and resolve the O1 tension with D4's raw-drop-vs-bytea decision

**✅ OWNER DECISION 2026-08-13 — D4 is confirmed as the direction, and the reason is multi-user.**
Owner, verbatim: *"I believe that was my goal; to have majority of data on my phone - and only
summary/daily rollups or the minimum needed on railway. This architecture currently does not support
many users."*

That last sentence is the new constraint, and it is measurable. Footprint split, measured from the
catalog 2026-08-13 (after the REINDEX below):

| | size | rows |
|---|---|---|
| raw / timeseries (`oura_raw_samples`, `oura_heartrate`, `rr_intervals`, anchors, accel, battery) | **364.4 MB** | ~1.08 M |
| derived / summary — what the app actually renders (`oura_daily_summary`, `oura_daily_derived`, `oura_daily`, `sleep_sessions`, `body_metrics`, `oura_bucket`, `workout_sessions`, `set_logs`) | **1.6 MB** | 730 |
| | **231×** | |

Per user, extrapolating the ~37 days of ring history: raw is **~3.6 GB/year**, derived is
**~16 MB/year**. Ten users on the current design is ~36 GB/year of Railway Postgres; ten users on a
device-primary design is ~160 MB/year. **That ratio, not the absolute size, is what makes the current
shape single-user-only** — and it is the strongest argument yet for D4 over any in-place compaction.

**✅ REINDEX DONE 2026-08-13 (owner ran it).** `oura_heartrate_user_updated` went **52 MB → 2.75 MB**
(19×); database total **484 MB → 435 MB**, indexes **261 MB → 212 MB**. Predicted ~50 MB, actual 49 MB.
See Q-219 for how it got that bloated and why Q-213 Stage 1 slows the re-accumulation ~14×.

**What this decision does NOT settle**, and should not be assumed:
- The retention rule for the device copy. `CLAUDE.md` records a **14-day rolling window** on-device
  (owner decision 2026-08-02) — that is a *cache* policy, and it is incompatible with the device
  holding the **archive** unless it changes. An archive that prunes at 14 days is not an archive.
- What happens to a user with no device, a wiped device, or a second device. "Restore from cloud"
  exists in More/Profile, but if the server no longer holds raw frames there is nothing to restore
  the archive *from* — only the derived rows.
- Whether the server keeps a cold/compressed copy as a backstop, and where.
- Sequencing against the public-repo migration (Q-49) and Phase 3.

**These want a planning session before any code.** The decision above fixes the *direction*; it does
not answer "and then what happens when the phone is lost", which is the question that decides whether
this is a migration or a data-loss event.


**Do not re-investigate — a full diagnosis with real production numbers already exists:**
[`docs/db-volume-cleanup-handover.md`](../docs/db-volume-cleanup-handover.md) (2026-07-21).
`oura_raw_samples` is real protected archival data, 91% of the DB, growing ~50MB/week — not bloat.
An index-bloat problem was already fixed via `REINDEX` (~105MB reclaimed); the WAL-trim +
Postgres-restart step was left **"recommended, not yet confirmed done."** First action, no code:
re-run the doc's §7 diagnostic queries in the Railway console and finish the WAL/restart step if it
never happened.

**⚠️ Cross-reference found 2026-07-30, not yet resolved:** this doc's own §5 recommends a
`body_hex` TEXT→bytea migration as the first structural fix (roughly halves the table forever, no
data loss). But the Oura on-device master plan's owner-decision table (Q-29 above, §3 O1) already
covers this exact column: **"Server raw: drop-after-pull (D4) vs bytea migration — mutually
exclusive. Recommendation: drop; bytea only if D4 slips."**

**✅ RESOLVED 2026-08-02 — owner declined bytea.** The tension above is settled: **do not build the
`body_hex` TEXT→bytea migration.** It becomes throwaway work once D4 drops the table, and the owner
chose the cheap, decision-independent path instead — Q-35. **Q-35 has since been retired**
(2026-08-02): measured against production, its Finding 1 was already done by Lever 1 and its
Finding 4 would have made the table *bigger* — see
[`docs/overview/overview/history-2026-07-30.md`](overview/history-2026-07-30.md).
**Q-46** replaced it and **has shipped** (#1003, v1.250.6) — the guard that stops the bloat
re-accumulating. The remaining half is the one-time `REINDEX` (~130 MB of the table's 306 MB of
indexes), a Railway-console action on the owner checklist.
What remains of *this* item is the no-code Railway-console steps (WAL trim + Postgres restart,
the `VACUUM (VERBOSE, ANALYZE)`, and now the `REINDEX`); all are on the owner device/console checklist in
[`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](../docs/handoff-2026-08-02-platform-batch-queue-drain.md).

**🆕 Re-measured 2026-08-08 — the console steps will not stop the trend, and the growth rate is
~3× what CLAUDE.md records.** ([review §2.1](reviews/2026-08-08-db-scalability-and-tooling-review.md))

| when | `pg_database_size` |
|---|---|
| 2026-07-21, pre-REINDEX | 320 MB |
| 2026-07-21, post-REINDEX | 205 MB |
| **2026-08-08** | **421 MB** |

**205 MB → 421 MB in 18 days ≈ 12 MB/day.** `oura_raw_samples` is 306 MB of that 421 MB (73%) at
881,603 rows, up from 432,919 on 2026-07-21 — the row count **doubled in 18 days** (~24,900
rows/day). The distinction that matters for sequencing: **Q-46's guard stopped index *bloat*
re-accumulating; it cannot slow *data* growth**, and the remaining console actions reclaim bloat
too. At 12 MB/day the database alone returns to the ~924 MB alarm level in roughly six weeks whether
or not they run. Only D4 (drop-after-pull) or a retention policy changes the direction. Also note
CLAUDE.md's stated ~3.2 MB/day for this table describes the **device-local** window and has been
read as the server rate — the measured server rate is ~9.6 MB/day for the table, ~12 MB/day for the
database.

**Also blocks Q-31/Q-32 below** — the owner's 2026-07-30 sequencing decision put the DB volume fix
before the public-repo release, alongside Phase 3.

### [devices][platform] ➡️ Q-31 — own resilience weights & own workout-energy MET table — RE-SCOPED by #999, gates released

> **🆕 2026-08-02 — no longer blocked, and no longer the public-repo blocker.** Two changes: (1)
> #999 re-scoped this against the real seven-module import graph — read
> [`2026-08-02-oura-ip-triage.md`](superpowers/plans/2026-08-02-oura-ip-triage.md), not the narrative
> below, which retains the false "two live imports" premise for the record; (2) once Q-49 Phase A1
> lands, a gitignored asset still reaches production, so **these replacements stop gating the repo
> cut** and become ordinary quality work at whatever pace suits. They are Q-49's "A2", explicitly
> off its critical path. The Q-1 + Q-30 gates are released.

~~**Blocked — do not pick up yet.** Owner decision (2026-07-30): the public-repo release this item
exists to unblock does not start until Phase 3 (Q-1) ships **and** the DB volume item (Q-30)
lands.~~ **Struck 2026-08-02 — both gates released, see the header above.**

Plan: [`docs/superpowers/plans/2026-07-30-d8-own-resilience-and-energy-constants.md`](superpowers/plans/2026-07-30-d8-own-resilience-and-energy-constants.md)
(see its 2026-07-30 sequencing update at the bottom). Branch `feat/d8-own-resilience-energy-constants`.
> **⚠️ RE-SCOPED 2026-08-02 — read the triage plan before touching this entry.**
> [`docs/superpowers/plans/2026-08-02-oura-ip-triage.md`](superpowers/plans/2026-08-02-oura-ip-triage.md)
> replaces this entry's premise, which was wrong: it claimed two live imports of Oura's extracted
> constants with everything else "confirmed dormant". A fresh audit of `main` found **seven live**
> and **one genuinely dormant** — and the dormant one is neither of the two it names. Its Task 3
> ("grep confirms nothing else imports it → delete the tree") therefore cannot succeed as written.
>
> The triage plan carries the full table, a verdict per module (replace / gitignore / delete) and a
> task order. Headlines:
>
> - **`inference/dhrv` is dead code** — `buildDaytimeStressSeries` has no caller (both production
>   sites use D5's own `buildDaytimeStressSeriesFromModel`). One Oura dependency deletable today at
>   zero product cost.
> - **The MET table leads the replacements** and is nearly free: `daily-energy.ts` already
>   documents its source as the public Compendium of Physical Activities, so this is re-sourcing
>   the same numbers, not deriving new ones.
> - ~~**One owner question blocks the gitignore strategy entirely** — fresh `init` or a push of this
>   repo's history?~~ **✅ ANSWERED: fresh `init`** (triage plan Task 1). So `.gitignore` is a real
>   strategy, and the 43 MB of assets in this repo's history never reach the public repo.
> - **Ported *logic* is a separate question from vendored *constants*** and is not resolved —
>   `lib/oura-ble/decode.ts` is the whole BLE protocol port.

> **⚠️ SECOND FALSE PREMISE, found 2026-08-02 — the gitignore plan does not work as written.** This
> entry says to "gitignore (don't delete) SleepNet/`step_counter`'s asset files, keeping them only on
> the owner's private build machine… **now that Phase 3 means no public server deploy**". Phase 3 does
> not remove the server — it splits `api/` onto its own Railway service, which still deploys **from
> git** and still runs the rollup. Traced this session:
>
> - `lib/oura-models/inference/*.ts` load their `.onnx` via `await import('onnxruntime-node')` and are
>   marked **"Server-only"** in their own headers.
> - `sleepNetStages5Min` is called from `lib/data/postgres/adapter.ts:5006`, inside the server-side
>   `aggregateOuraRawSamples` rollup.
> - The inference wrappers are deliberately **infallible** (return `null` on any failure), so a missing
>   asset degrades the hypnogram *silently* rather than failing the build.
> - `.gitignore:45` covers only `lib/oura-models/pt/*.pt`. The **87 MB of `.onnx` weights is committed**
>   and is in ~900 commits of history — which is why the cut must be a fresh snapshot, and why making
>   *this* repo public is not an option at any point.
>
> **Consequence: the public repo cannot be cut until the server stops needing those assets from git.**
> Three ways, none of them started: (a) fetch them at Railway build time from private storage with a
> build secret — cheapest, decision-independent; (b) finish **D2 Task 6 (neural WASM)** so SleepNet and
> `step_counter` run on-device and the server needs neither — already planned, on the Stage 3 track;
> (c) replace them (tier 3), which is the expensive one. **This — not Q-1 or Q-30 — is the real
> dependency in front of Q-32.** The triage PR (run-list item 6) should pick between (a) and (b) as its
> first decision.

> **Owner steer (2026-08-02):** replace these over time with our own maths or public sources;
> gitignore what is still in use until replaced; triage case by case. So the re-scope is a triage
> list, not one swap. Two have public substitutes and should lead — the workout MET table
> (Compendium of Physical Activities) and, plausibly, training-stress. SleepNet and `step_counter`
> remain gitignore-not-replace for now, but see **C1** in
> [`device-agnostic-source-architecture.md`](device-agnostic-source-architecture.md): the owner
> does want them replaced eventually, and Health Connect already serves non-Oura users for both,
> so this is a tier-1 quality project rather than a portability blocker.

~~`lib/health/stress-resilience.ts` and `lib/health/workout-energy.ts` are the only two live, wired
features still importing Oura's actual extracted proprietary numeric constants~~ — **false, see the
re-scope above: seven live imports, not two.** The two named here are real, but they are rows 1 and
2 of seven, and `lib/oura-models/` is *not* otherwise dormant. Swapping these two for
independently-derived values, calibrated (not copied) against Oura's own official Cloud-API scores
via the existing D6 comparison harness (`lib/oura-comparison-harness.ts`), is what lets the vendored
tree be deleted rather than merely excluded from a public mirror. SleepNet/`step_counter` (the two
models the 2026-07-21 strategy decided to keep forever) are handled differently now that Phase 3
means no public server deploy: their asset files move to `.gitignore` and stay only on the owner's
private build machine. Implement in the new public repo once it exists, per owner preference — this
repo's production path is unaffected until then.

### [platform] ➡️ Q-32 — cut the public GitHub repo — SUPERSEDED by Q-49, gates released

> **🆕 2026-08-02 — the Q-1 + Q-30 + Q-31 gates on this entry are RELEASED, and the mechanics moved
> to [Q-49](#platform--q-49--public-repo-migration-phase-a-model-delivery--phase-b-the-cut).** None
> of the three was a technical dependency: Q-1 (Phase 3) is deferred by the owner and unrelated to a
> repo cut, Q-30's remainder is two Railway-console actions, and Q-31's *implementation* is not
> required once a gitignored asset can still reach production (Q-49 Phase A1). The real dependency
> — server-side model **delivery** — is what Q-49 supplies. **Take Q-49; do not work this entry
> directly.** The notes below stay because Q-49's Phase B references them.

Full context:
[`docs/handoff-2026-07-30-platform-public-repo-migration-gated-on-apk-offline-build.md`](../docs/handoff-2026-07-30-platform-public-repo-migration-gated-on-apk-offline-build.md)
(on branch `claude/github-public-migration-0u4r7m`, not yet merged — the plan/backlog content is
folded into this file and `docs/offline-first-target-architecture.md`; that branch's own copies of
these entries are superseded by this one, do not duplicate).

When unblocked: cut a **fresh, history-free snapshot** (not a `git filter-repo` scrub — too easy to
miss a trace of vendored weights across ~900 commits); exclude `lib/oura-models/` +
`scripts/oura-models/` wholesale; gitignore (don't delete) SleepNet/`step_counter`'s asset files,
keeping them only on the owner's private build machine; strip model-provenance comments/docs even
for the gitignored files (the loader code is fine to publish, text describing "extracted from
Oura's decrypted `.pt`, sha256 X" is not); rewrite the BLE-protocol docs
(`lib/oura-ble/`, `android/.../oura/*.kt`, `docs/oura-ble-*.md`) in our own words for public
consumption; fix `lib/data/postgres/migrations/006_admin_flag.sql`, which hardcodes the owner's
real email; delete the orphaned `docs/preserve-pt-originals-and-goldens` remote branch (holds the
raw decrypted `.pt` originals, 52MB, unmerged). New public repo name + which GitHub account: asked,
never answered — needed before this step, not urgent before then.

### [readiness] 🟡 Q-3b — awakenings-calibrated restfulness + the chronic-stress two-scale column

> **⚑ The data gate is CLEARED (2026-08-04).** This entry says *"No code without that data. ⛔
> owner/data-gated"* — the data exists: **32 rated nights** in `day_checkins.sleep_quality_feel`,
> collected automatically by the morning check-in since 2026-07-03. See **Q-72** for the analysis of
> what those ratings say, which is stronger than expected and reframes this item.

Two independent findings, both low-urgency:

- **(a) Awakenings-calibrated restfulness term — TRIED 2026-08-06, REJECTED, superseded by a
  different mechanism.** `restlessPeriods` (the ring's 0–5 wake-event count) was tested as the
  driving signal for exactly this: production data showed the SAME value (4) on both a real
  disrupted night (2026-08-06) and the single best-rated night of the prior month (2026-07-17) —
  it carries no separating information for this ring, confirmed empirically, not assumed. Do not
  revisit this specific approach without new evidence it's more informative than that. What
  shipped instead: an awake-TIME-fraction fragmentation cap (not an awakenings-count term) — see
  [`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md).
  Closed.
- **(b) `chronic-stress-assembly.ts:65`'s `gotUps` two-scale concern — RE-INVESTIGATED
  2026-07-30, does not reproduce on current `main`.** Traced the full input chain:
  `oura_daily_summary` (migration 116, "Oura BLE Phase 5 addendum A3") is written only
  by two paths — the server-side `aggregateOuraRawSamples` rollup (`nightInputsByDate`
  in `lib/data/postgres/adapter.ts`, built exclusively from `oura_raw_samples`, i.e.
  BLE-only, post-2026-07-07-re-key) and the on-device push path
  (`pushMutations`'s `oura_daily_summary` branch, same device-computed
  `model.awakenings` scale). No code path ever writes Oura Cloud's
  `sleep_sessions.restless_periods` (138–330 scale) into `oura_daily_summary` — the
  table didn't exist before the BLE era, so there's nothing pre-cutover for a 31-night
  window to straddle. Downgrading — no action needed unless new evidence surfaces.

### [sleep] 🟠 Q-4 — `respiratory_rate` is persisted from an estimator its own docs call uncalibrated

> **⚑ Owner answered 2026-08-04: willing to wear the Polar H10 overnight for ground truth — *"yes but
> not tonight."*** Still owner-gated, but the gate is now scheduling rather than consent.

⛔ **Owner decision, not a fix.** Owner chose calibrate-against-Polar-H10, but
production has 23,065 RR rows and only 50 between 00:00–06:00 Brisbane — the strap
is essentially never worn for sleep, so there's no ground truth to calibrate
against yet. Blocked on real-data capture, not code.

### [devices][readiness] 🟠 Q-7b — the **ten** device-owned `oura_daily_derived` columns have no producer

> **⚑ Re-measured 2026-08-08 — it is ten, not eight, and here is the exact list.** Machine-counted
> every column in the table against 82 rows rather than spot-checking: **`active_calories_est`,
> `training_load_ots`, `training_load_high`, `recovery_index_hours`, `worn_hours_ble`,
> `night_hrv_baseline_ms`, `chronic_stress_score`, `chronic_stress_contributors`, `vascular_age`,
> `pwv`** are NULL in **every** row. The 2026-08-05 pass below named seven of them; `active_calories_est`,
> `training_load_high` and `chronic_stress_contributors` were missed, and `body_comp`/`bdi_derived`
> are populated so they are not in this set. The table is also sparse where it *is* populated —
> `sleep_score` 25/82, `readiness_score` 24/82, `activity_score` 12/82 — so "has a producer" and "has
> coverage" are separate questions and this entry is only about the first.

> **⚑ Re-confirmed against production 2026-08-05** ([data-analysis review](reviews/2026-08-05-data-analysis-opportunities.md)
> §4 B4). Of 79 `oura_daily_derived` rows: `training_load_ots` **0**, `night_hrv_baseline_ms` **0**,
> `chronic_stress_score` **0**, `recovery_index_hours` **0**, `vascular_age` **0**, `pwv` **0**,
> `worn_hours_ble` **0**. Partially populated: `body_comp` 57, `illness_score` 29, `bdi_derived` 29,
> `resilience_level` 13, `daytime_stress_scaled` 11.
>
> **New detail worth chasing separately:** `/api/training-stress` *does* compute and persist an OTS,
> yet `training_load_ots` is empty across the entire history — so that route's gating conditions
> (readiness still learning / incomplete profile / insufficient MET signal) are never being met in
> practice. That is a live route returning `status:'gated'` forever, which is a different failure
> from "no producer exists".

**Not a sync bug — do not "fix" the push layer, it's already correct.** Tracing the
push chain: `lib/oura-ble/rollup/` does not exist (there is no on-device rollup at
all), zero `queueMutation` call sites exist for `oura_daily_derived`/`oura_daily_summary`
anywhere in the repo, and the local table's only writer is `applyDelta`'s
pull-apply (hardcodes `sync_status='synced'`, can never produce an outbox row).
This is Phase-1 Task 5/6 (build `lib/oura-ble/rollup/rollup-device.ts`) + Phase-2
Task A2 (local write + `queueMutation`) of the on-device Oura program — both
planned, neither started:
[`2026-07-21-oura-raw-on-device-phase-1.md`](superpowers/plans/2026-07-21-oura-raw-on-device-phase-1.md),
[`2026-07-21-oura-raw-on-device-phase-2-durability.md`](superpowers/plans/2026-07-21-oura-raw-on-device-phase-2-durability.md).
⛔ Gated on the D2 device-verification run — see the Oura on-device handover below.
Owner direction (2026-07-27): these stay device-owned; do not move them to the server.

✅ **The independent phantom-`oura_daily`-row finding — DONE 2026-07-30.**
`app/api/oura/sync/route.ts` now filters to rows with real scoring data
(`hasRealScoringData`) before calling `repo.upsertOuraDaily()`, so a Cloud sync
that returns nothing but `non_wear_time_sec` no longer writes a false-positive
"synced" row.

### [sleep] 🟡 Q-10 — degenerate sleep rows are stored; no session `type`

**Downgraded** — originally filed as a prerequisite for classifying naps vs nights,
but `lib/health/sleep-night.ts` already classifies by circadian position, no stored
`type` needed. Persisting Oura's `type` / the ring's bedtime-period tag is now a
nice-to-have, not queued in detail.

✅ **The live symptom — DONE 2026-08-02 (v1.250.8).** `groupSleepPeriods`
(`packages/shared/src/health/sleep-night.ts`) now drops windows with no duration
before classifying, so a degenerate row can no longer become the most recent night
and null out `previousNight`.

The entry's suggested fix — *"skip/floor sub-20-minute sessions"* — was **not** what
shipped, and deliberately so. Of the nine sub-20-minute sessions only the one with
`duration_hours = 0.00` can produce the null: `computeSleepScore` returns null for
`duration == null || duration <= 0` and nothing else, so a 15-minute session scores
fine (badly, which is correct). A 20-minute floor would also have discarded genuine
short windows that `groupSleepPeriods` merges into fragmented nights on purpose.

What is left of Q-10 is only the nice-to-have above: persisting Oura's session
`type` / the ring's bedtime-period tag.

### [sleep] 🟢 Q-34 — sleep-staging Phase 1b: items 2 and 4 remain

Plan: [`docs/superpowers/plans/2026-07-11-oura-ble-sleep-staging-phase1b-signal-upgrades.md`](superpowers/plans/2026-07-11-oura-ble-sleep-staging-phase1b-signal-upgrades.md).
Branch: `feat/sleep-staging-ultradian-prior` (item 2).

**⚠️ The plan is stale in two ways — verified 2026-08-02, do not trust it unread.**
Its file map points at `lib/health/`; the sleep modules live in `packages/shared/src/health/` now.
And **item 1 (LF/HF HRV) was already shipped** before the plan was picked up — `hrv-frequency.ts`,
the `lfhf` epoch field and `W_LFHF = 0.5` are all on `main`.

- ✅ **Item 1 (LF/HF)** — already on `main`, nothing to build.
- ✅ **Item 3 (SpO₂ variability)** — shipped 2026-08-02, v1.251.0, see
  [`docs/overview/overview/history-2026-07-30.md`](overview/history-2026-07-30.md).
  ⛔ Its verdict is blocked on a device check (is the `spo2V` debug column even populated, and does
  it separate?) — on the owner checklist. Do not tune `W_SPO2` before that answer exists.
- ✅ **Item 2 (ultradian ~95-min cycle prior)** — shipped 2026-08-02, v1.251.1, see
  [`docs/overview/overview/history-2026-07-30.md`](overview/history-2026-07-30.md).
  Added alongside the linear `W_TIME` term, not replacing it; `W_CYCLE = 0.15`. The plan's
  instruction to anchor the clock to `onsetEpoch` was **not followable** — onset trimming is step 4,
  the scoring loop is step 3, so the real onset does not exist yet; `sleepIdx[0]` is the anchor.
  ⛔ Its verdict is blocked on the same device Redecode as item 3. **The revert is two addends** if a
  real night says the fixed period fights the Viterbi decoder.
- **Item 4 (offline clustering fit)** — not started, and correctly sequenced last: it wants item 2
  landed and more accumulated real nights before an unsupervised fit means anything.

### [workouts] 🟡 Q-52 — per-exercise phase hold: a stalled compound stays behind while the session moves on

Plan: [`docs/superpowers/plans/2026-08-02-per-exercise-phase-hold.md`](superpowers/plans/2026-08-02-per-exercise-phase-hold.md).
Branch: `feat/exercise-phase-hold`. Added 2026-08-02 from an owner design question.

Phase lives on `session_periodization`, keyed by `program_session_id`, so every compound in a
session transitions together. When bench has earned intensification but overhead press has stalled,
OHP is dragged into a heavier zone on the strength of a lift that is not it.

Adds `session_exercises.phase_offset` (`0 | -1 | -2`), **written by the engine at transition time,
never configured by the user** — a new deterministic `exerciseEarnedTransition` predicate decides
per compound whether it comes along, and a held exercise catches up on its own once its signal
recovers. Applied as `shiftPhase(sessionPhase, offset)` at the two `intensityZoneForRole` call sites
in `generate-prescription.ts`. One session phase, one counter, one transition prompt — the offset is
a derivation, not a second phase state.

**A manual/default offset was explicitly rejected by the owner** (2026-08-02: *"I don't want it to
DEFAULT behind. I'd want it to only be in a different session if it needed to be"*) — do not
reintroduce a configuration field if the derived version proves fiddly. Backwards-only:
`capLoadToAnchor` caps every non-anchor exercise at the anchor's pct, so a forward offset cannot take
effect and the CHECK constraint rejects it.

**⚠️ A production audit on 2026-08-03 undercut this item's priority — read before building it.** Of
26 tracked exercises, **22 are progressing** and exactly **one** primary/secondary compound is
genuinely stalling (Cable Pulldown, Upper, −7.7%). Every other apparent stall is an artifact: two
bodyweight movements whose estimated 1RM is meaningless (Hanging Leg Raise, Pull-Up), a 0.5 kg move
on a light isolation (Lateral Raise), and an exercise dropped from the program in July (Front
Squat). Worse, the hold **could not have fired even for that one** — holds are computed at a phase
transition, and Upper had never had one (the cause of that was a separate defect, fixed in
v1.252.0). So this feature would today apply to a single exercise. Re-measure before implementing:
if the transition fix means blocks now actually cycle, the picture may change.

> **✅ RE-MEASURED 2026-08-03 (same day, after v1.252.4). The conclusion survives; three of its four
> supporting claims did not.** Measured over the **active program's 25 exercises** (last logged 1RM
> vs the one before), with roles read from the active program rather than joined across every
> program — which is where the original went wrong.
>
> **18 up · 3 flat · 4 down.** The four declining:
>
> | Exercise | Session | Role | Type | prev → cur | % |
> |---|---|---|---|---|---|
> | Dumbbell Lateral Raise | Push | accessory | weighted | 14.3 → 12.5 | −12.3 |
> | Hanging Leg Raise | Legs | accessory | bodyweight | 119.3 → 113.5 | −4.8 |
> | Dumbbell Preacher Curl | Pull | accessory | weighted | 24.5 → 24.3 | −1.0 |
> | Cable Pulldown | Upper | **secondary** | weighted | 30.3 → 30.0 | −0.8 |
>
> **What holds:** exactly one primary/secondary compound is declining, so the feature would still
> apply to a single exercise today. That is the load-bearing claim and it is confirmed.
>
> **What was wrong:**
> 1. **Cable Pulldown is a `secondary`, not a primary** — the audit's role attribution came from a
>    join across inactive programs too. Roles matter here: the hold predicate keys off them.
> 2. **The two bodyweight movements are NOT artifacts.** Corrected in v1.252.4 — a bodyweight
>    `estimated_1rm` is a BW_REF-relative index that is *monotone in reps*, so its trend is exactly
>    as readable as a weighted lift's (see
>    [`2026-08-03-year-review-bodyweight-1rm.md`](overview/history-2026-07-30.md)).
>    **Pull-Up is +4.6% and belongs in the "progressing" column**, not excluded; Hanging Leg Raise's
>    −4.8% is a real decline in reps. Both are accessories, so neither would trigger a compound hold
>    either way — but the arithmetic was wrong.
> 3. **26 tracked / 22 progressing** does not match the active program, which holds 25.
>
> **What was right:** Barbell Front Squat is indeed no longer in the active program.
>
> **The "re-measure once blocks cycle" note is still outstanding.** Checked the same day: four of
> five sessions (Legs, Pull, Push, Upper) are still in `accumulation`, and only Lower has moved —
> on 2026-08-01, *before* v1.252.0 landed. **No session has transitioned since the auto-apply fix
> shipped**, so the picture that fix might change has not had a chance to change yet. Re-run this
> once at least two sessions have cycled.

Note the plan's stall escalation (an exercise held two transitions running needs a reset or a swap,
not more holding) is part of scope, not a nice-to-have — without it the feature hides a stalled lift
indefinitely.

### [sleep][platform] 🟢 Q-156 — `sleep_sessions.sleep_score` is NULL in all 69 rows — TRACED, dead column, no fix warranted

- **Added:** 2026-08-08 · found by the production data-vs-code audit that produced Q-149 and the
  Year Review deload bug.
- **The measurement:** `sleep_sessions.sleep_score` is **0 non-null of 69 rows** (2026-05-26 →
  2026-08-08). `onset_latency_sec` (53), `average_hrv_ms` (50), `efficiency` (57) and
  `respiratory_rate` (51) are all populated on the same rows, so this is one column, not a dead table.
- **Why it is empty:** the Oura Cloud sync writes `daily_sleep.score` into **`oura_daily`**
  (`app/api/oura/sync/route.ts:135-142`, via `dailyMap`), never into `sleep_sessions`. The column is
  in `upsertOuraSleep`'s column map (`slices/oura.ts:41`) but no caller supplies it.
- **Why it matters:** `GET /api/sleep-sessions` maps and serves it anyway
  (`app/api/sleep-sessions/route.ts:40`, `sleepScore: r.sleepScore ?? null`), and three surfaces
  consume that payload — `app/health/sleep/sleep-content.tsx`, `session-select-content.tsx`,
  `app/health/day/day-detail-content.tsx`. **This is the same shape as the Year Review bug fixed
  today** (a reader trusting a column nothing populates), which is why it is filed rather than
  assumed harmless.
- **✅ TRACED 2026-08-08 — it is dead-column cleanup, NOT a bug. No surface renders the null.**
  Every consumer was followed to the component that paints:
  - `app/health/sleep/sleep-content.tsx` passes `scoreField="sleepScore"` to `HealthScoreDetail`, but
    that component reads its score from the **readiness-score** response and the local `oura_daily`
    mirror (`health-score-detail.tsx:143-144`, `store.getOuraDaily`) — **not** from the
    `/api/sleep-sessions` rows it also fetches. Those rows feed the list and hypnogram only.
  - `app/session-select/session-select-content.tsx` fetches `sleep-sessions` but never references
    `sleepScore` at all.
  - `app/health/day/day-detail-content.tsx:154` reads it via `/api/day-log` **behind a fallback** —
    `s?.sleep ?? data?.sleep?.sleepScore ?? null` — so the derived score wins and the null is
    unreachable in practice.
- **Consequently: no fix is warranted, and none was made.** The column is inert, not harmful. Two
  routes (`sleep-sessions:40`, `day-log:229`) map it out of habit; deleting the column needs a
  migration (destructive, owner sign-off) and removing it from the payloads risks an unknown offline
  consumer for zero user-visible gain. **Left alone deliberately.**
- **The one useful follow-up, if anyone ever wants a per-night score on those payloads:** source it
  from `oura_daily.sleep_score` or `oura_daily_derived.sleep_score`, never from this column.
- **Note when scoping the fix:** `oura_daily` only has a sleep score for **22 of the 69** nights, so
  populating `sleep_sessions.sleep_score` from it would fill a third of the rows at best. The BLE
  pipeline's own derived score (`oura_daily_derived.sleep_score`, 25/82) is the other candidate
  source. Neither makes the column complete.

### [heart-rate][workouts] ✅ Q-149 — `rest_adequate` was true for every set ever recorded — FIXED 2026-08-08

- **Decision:** the owner handed the call back ("make the call for the more data-driven and accurate
  response that sets up a better structure for future"), so: **the `bpmAtLog < 120 → true` shortcut is
  gone, `adequate` now requires a measured `hrr1`, and returns `null` when there is none.**
- **The measurement it rests on** (`claude_ro.set_hr_stats`, 615 rows, 2026-08-08): 278 verdicts, all
  true, **271 (97.5%) via the shortcut**, 7 via `hrr1 >= 15`, and `bpm_at_end` min 39 / **max 128** /
  mean 94. The 120 threshold assumes chest-strap-grade end-of-set HR (140–170); the ring power-gates
  when worn-idle and samples at 1/min, so it could never not fire.
- **Why not re-tune the number:** picking 100 instead of 120 is the same population assumption with a
  different constant, and it needs re-picking whenever the source changes. Requiring the measurement
  is source-independent, and leaves the per-source/per-user refinement (via `set_hr_stats.source`,
  populated since 2026-08-06) available later **without changing what the column means**.
- **Coverage drops from 278 verdicts to ~7.** That is the honest coverage of a question this data can
  answer; a reader cannot tell a constant `true` apart from a signal, which is how this got as far as
  gating Q-11's B2 analysis.
- **No backfill** — the 278 stored `true` values stay. `computed_at` separates pre- from post-change
  rows, and the admin backfill can recompute on request. **Still open, separately:** whether 15 bpm is
  the right bar for this user — it now at least applies to something real.
- Journal: [`2026-08-08-rest-adequate-requires-hrr.md`](overview/history-2026-08-07.md).

### [heart-rate][workouts] 🟡 Q-11 — per-set HR attribution only runs when the recap is opened (Defect B FIXED 2026-08-05, one item remains)

> **⚑ 2026-08-05 — this now BLOCKS an analysis, which raises its value.** The
> [data-analysis review](reviews/2026-08-05-data-analysis-opportunities.md) §4 B2 went looking for
> the most interesting unbuilt question in the dataset — *does how physiologically recovered you
> were at the end of rest predict the next set?* — and could not answer it. Field-level coverage of
> `set_hr_stats` (582 rows): `peak_bpm` 210, `drop_60s` 160, `pct_hrr_at_rest_end` **122**,
> `sec_to_hrr50` 74, `coverage_ok` 138. Only **92** rows join to a following set. That is not enough
> to test anything. Fixing Q-11 unlocks a genuinely new class of set-level physiology analysis, so
> it is a prerequisite, not an independent cleanup.
>
> **✅ Re-measured against production 2026-08-08 (615 rows).** The side-check is answered and split
> out as **Q-149** — `rest_adequate` is not stuck, it is *degenerate*: 278 non-null, 278 true, and
> **271 of them (97.5%) come from the `bpmAtLog < 120 → true` shortcut**. Do not build a view on it.
> The B2 blocker has eased but not cleared: rows joining to a following set went **92 → 108**, and
> `pct_hrr_at_rest_end` is accruing at ~10–13 per training day, so it is a matter of waiting rather
> than re-engineering.

> **⚑ Half of this shipped as v1.257.2; the other half is now precisely stated.** Two separate
> defects were hiding behind one entry, and neither was the device-side cause this entry originally
> guessed at. (The earlier "~20% of sets" / device-gate framing on this entry is superseded by
> Defect A/B below — dropped here rather than kept as a third, redundant annotation.)

**Defect A — `workout_hr_stats` at 0 rows. FIXED (v1.257.2), root cause proven.** Not a missing
producer: `upsertWorkoutHrStats` was called on every recap, sitting three lines above the
`upsertSetHrStats` call that reached 582 rows. It threw every single time.
`workout_hr_stats.workout_hrv_ms` is the **only integer HRV column in the schema** — every sibling
(`sleep_sessions.average_hrv_ms`, `oura_daily_derived.hrv_rmssd_ms`, …) is `doublePrecision` — and
its producer `rmssdFromRr` returns `Math.sqrt(mean)`. node-postgres sends the float as text and
Postgres rejects the whole insert:

```
invalid input syntax for type integer: "38.42156862745098"
```

Reproduced against the local DB, and the new regression test fails with that exact message when the
`Math.round` is removed. The caller's fire-and-forget `.catch(err => console.error(…))` swallowed
it, and the recap renders either way, so there was no user-facing symptom for months. Both persist
calls now go through `reportServerError`, and the previously button-less
`/api/oura-ble/backfill-hr-stats` has an Admin → Tools card.

**Defect B — four recent sessions have ZERO `set_hr_stats` rows. FIXED 2026-08-05, v1.266.1.** See
[`docs/overview/overview/history-2026-08-04.md`](overview/history-2026-08-04.md).
`POST /api/complete-workout` now fires a best-effort fire-and-forget HR compute/upsert at completion
(closes the gap outright for a live chest strap already in `oura_heartrate`), and
`listSessionsMissingSetHrStats`/`listSessionsMissingHrStats` are now coverage-aware — a session whose
only attempt produced `readings_count = 0` rows stays on the backfill work-list instead of being
permanently marked done, so a delayed Oura-ring drain still gets picked up by a later backfill pass.
**Did not** fold `coverage_ok = false` into the coverage-aware check, only `readings_count = 0` — the
two are different questions (see "Also still open" below) and conflating them risked the work-list
permanently re-listing genuine-dropout sessions that can never improve on reprocessing.

Measured per session against production before the fix, kept for the record:

| day | session | sets | set_hr_stats rows | computed_at |
|---|---|---|---|---|
| 2026-08-02 | Pull | 15 | **0** | — |
| 2026-08-01 | Lower | 18 | 18 | 2026-08-04 (3 days later) |
| 2026-07-30 | Upper | 18 | **0** | — |
| 2026-07-30 | Legs | 18 | **0** | — |
| 2026-07-27 | Push | 14 | 14 | 2026-07-28 |
| 2026-07-26 | Pull | 15 | **0** | — |
| 2026-07-20 | Push | 14 | 14 | 2026-07-29 (9 days later) |

**Zero rows, not rows-with-null-metrics** — so attribution never ran, rather than running and
finding nothing. And every `computed_at` lags its workout by days. The cause is structural: the
only trigger is `GET /api/oura/hr-data`, which is the **recap fetch**. Finish a workout and never
open its recap and that session is never attributed, permanently. Everything before 2026-07-22 has
rows because the backfill was run once that day; the four gaps are all sessions after it.

- Admin → Tools → "Backfill per-set HR stats" still exists and still works for any pre-fix gaps
  already in production — running it once is on the owner checklist, since this fix only prevents
  *new* gaps, it doesn't retroactively attribute old sessions.

**✅ ANSWERED 2026-08-08 — it was the artefact, not device dropout.** The open question was whether
the 79% `coverage_ok=false` / 67% NULL `peak_bpm` figures meant real strap dropout during lifting or
were contaminated by days-late computes. Re-measured against production by `computed_at` day, which
separates the two cleanly:

| computed_at | rows | coverage_ok | peak_bpm | readings_count = 0 |
|---|---|---|---|---|
| **2026-07-22** (the one-off backfill) | **508** | 74 | 138 | **334** |
| 2026-07-23 → 08-04 (recap-triggered) | 74 | 64 | 71 | 0 |
| 2026-08-06 (post-fix, same-day) | 24 | 18 | 23 | 0 |
| 2026-08-08 (post-fix, same-day) | 9 | 3 | 9 | 1 |

**508 of 615 rows are that single backfill batch**, run over old sessions whose HR series was thin
or absent — 334 of them have zero readings. Every aggregate that treated the table as one population
was measuring that batch. Same-day computes since the Defect B fix carry near-complete `peak_bpm`
and no zero-reading rows. So: no evidence of systematic device dropout; nothing further to fix here.

Two things confirmed while measuring, recorded so they are not re-investigated: `source` is populated
only from 2026-08-06 onward (23/24 then 8/9), which is exactly when v1.260.0 shipped it — not a gap;
and the whole dataset's **maximum `bpm_at_end` is 128**, which is what makes Q-149's threshold
degenerate.

### [platform] 🟢 Q-28 — `applyDelta` crosses the Capacitor bridge once per row (measured 2026-08-02 — deprioritised, not dead)

Plan: [`docs/superpowers/plans/2026-07-29-prefetch-remainder-and-applydelta-batching.md`](superpowers/plans/2026-07-29-prefetch-remainder-and-applydelta-batching.md),
Gap 2. Found 2026-07-29 while auditing what Q-1 does not already cover; the sibling finding (prefetch
remainder) shipped as v1.242.1.

`runSQL` (`lib/sqlite/sqlite-service.ts:134`) is one `_db.run()` — one JS↔native bridge crossing —
per statement, and `applyDeltaBody` (`lib/local-store/sqlite-backend.ts:1186`) awaits one per row
across ~20 domains. A pull is therefore O(total rows) **sequential** crossings. The bridge is not
cheap: the owner's 2026-07-29 device profile put `androidBridge.onmessage` at 18.1% total. Same shape
as #906 (`getWorkoutHistory` ~121 queries → 3), on the write path.
`@capacitor-community/sqlite` exposes `executeSet` for batched parameterised writes; it is used
nowhere in the repo.

**Do the measurement before the refactor.** Steady-state daily deltas are a handful of rows, where
batching changes nothing perceptible. The cost lands on **first sync after install** and
**restore-from-cloud**. If a restore is a few hundred rows this drops well down the queue; if it is
five figures it is the largest remaining win outside Phase 3. The measurement could not be taken in
the session that found this — no reachable production data, and native SQLite does not run in the
sandbox.

**✅ MEASURED 2026-08-02 — the answer is "few hundred", so this waits.** A full restore is
**≈ 1,800 rows** across `applyDeltaBody`'s twenty domains (largest: `set_logs` 887, `exercise_logs`
308, `body_metrics` 96, `session_exercises` 87, `workout_sessions` 79). Per this entry's own
criterion that is the low end, not the five-figure case, and it is a one-time path — so the
refactor is not worth taking on the code with the worst data-loss history in the repo yet. Full
numbers:
[`docs/overview/overview/history-2026-07-30.md`](overview/history-2026-07-30.md).

> **⚠️ TRIPWIRE — read this before adding any timeseries domain to the sync delta.**
> `oura_heartrate` is **37,950 rows** in production and *is* mirrored in the local SQLite schema,
> but it is **not** one of `applyDelta`'s twenty domains — it has its own local write path. That
> single fact is the difference between 1,800 crossings and 40,000. **Add the HR series (or any
> other high-cardinality timeseries) to the delta and this item becomes urgent in the same PR.**
> Q-29 D2 (the on-device rollup) is the most likely source of such a change.

Native SQLite still does not run in the sandbox, so the *bridge-crossing* cost itself remains
device-only — but the row count is what decides priority, and that is now known.

Three constraints that make it non-trivial, detailed in the plan: statement **order** must be
preserved (dependent rows); the deliberate failing-statement diagnostic in `runSQL` must survive
(replay the batch row-by-row on error); and `executeSet` must be called with `transaction: false`
because `applyDelta` already owns a transaction. `lib/local-store/__tests__/sqlite-backend.test.ts`
mocks `runSQL` and asserts on issued SQL, so equivalence is checkable statement-for-statement — but
that is not a device proof, and this is the code path with the worst data-loss history in the repo.

### [workouts][platform] 🟡 `exercise_estimates` has no local mirror, but do not build one on its own

Found while building the `meal_types` local mirror (2026-07-30): mirroring
`exercise_estimates` alone would be **inert**. `lib/local-store/program-assembler.ts`
deliberately renders an offline program as *structure only* — `estimated1rm`,
`target80` and `latestWeight` are all hardcoded `null` in `buildWorkoutExercise`
by design (see its own comment). `computeInitialWeights`
(`components/workout-screen.tsx`) therefore always falls through every branch to
its `return 60` fallback offline, regardless of whether a log/PR/estimate exists
locally — mirroring the raw `exercise_estimates` rows wouldn't change that unless
`buildWorkoutExercise`/`computeInitialWeights` are also taught to resolve a
working weight from the local mirrors (log > estimate > PR, matching
`resolveWorkingBasis`'s server-side priority). That is exactly the change the
Q-5b handoff's `return 60` follow-up already flagged as touching the hot workout
path and wanting a device check before merging — so this is one entangled piece
of work, not two. Take the `return 60` fix and the offline weight-resolution
wiring together, with a device check, rather than building a mirror table nobody
reads.

### [cross] 🟢 Q-27 — finish the per-domain documentation migration — **CLOSED, not doing either item**

> **⚑ Owner delegated the call 2026-08-04 (*"your decision. I don't read docs — so if it's better for
> you then go for it"*). Having looked: neither item is worth doing.**
>
> **Item (a), move the ~25 loose root docs into pillar folders — NO.** The problem it solves is
> already solved. `docs/domains/*/README.md` carries **55 links** to those exact files, which is the
> subject-based view the migration was meant to create. Moving them breaks all 55 links plus every
> reference in `CLAUDE.md`, `projectOverview.md` and the backlog, to achieve physical colocation
> that nothing navigates by. Churn with a real breakage surface and no reader.
>
> **Item (b), split `projectOverview.md`'s Known Issues per pillar — NO.** That file is what a fresh
> session reads first to orient; splitting it means rewriting the orientation convention in
> `CLAUDE.md` at the same time. Not a side effect of a docs tidy.
>
> Reopen only if the domain indexes stop being maintained — the indexes are the mechanism, and they
> are working.

Added 2026-07-30, alongside the PR that shipped the domain structure. **Plan:**
[`docs/superpowers/plans/2026-07-30-domain-docs-deep-migration.md`](superpowers/plans/2026-07-30-domain-docs-deep-migration.md).

Already shipped: the eleven-pillar taxonomy and indexes under [`docs/domains/`](domains/README.md),
`[domain]` tags on every `projectOverview.md` Known-Issues heading **and** every heading in this
file, and the domain segment in handoff filenames (`docs/handoff-YYYY-MM-DD-<domain>-<title>.md`).

**Item 1 (docs link check in CI) — DONE 2026-07-30.** `scripts/check-doc-links.js` walks every
`.md` under `docs/` and the three repo-root docs, strips fenced/inline code first (a regex literal
or a quoted markdown example in backticks reads exactly like `[text](path)` otherwise — both
occurred in this repo's review docs and produced false positives before the strip was added), and
fails on any relative link that doesn't resolve. Wired into the Custom Rules CI job. Running it
found 42 broken links beyond the 16 the ad hoc pre-check caught — 36 in `docs/overview/uplift-archive.md`
missing a `../` (linking from `docs/overview/` as if it were `docs/`) plus 12 of those additionally
needing `archive/` (their target plans had moved to `docs/superpowers/plans/archive/` since the
links were written), and one in `docs/handoff-phase-3-bundled-shell.md` with one `docs/` too many.
All fixed in the same PR.

What's left — both **explicit go/no-go decisions, not assumed work** (the indexes already make
everything findable, and each move is a large link-rewriting diff — `oura-ble-operations.md` alone
is referenced from `CLAUDE.md`, several plans, a skill and multiple journal entries):

2. **Optionally** move the ~25 loose `docs/` root reference docs into their pillar folders
   (`sleep-system.md` → `domains/sleep/`, the six `oura-ble-*.md` → `domains/devices/`, etc.).
3. **Optionally** split the `projectOverview.md` Known Issues into per-pillar files.

Record the decision either way rather than silently skipping it — now safe to attempt either move
since the CI link check (item 1) catches a botched rewrite immediately.

### [platform] 🟡 J1 residual — CI-enforced cache/fetch hygiene gates

- ✅ **`invalidateCache(` outside `lib/cache-groups.ts` — DONE 2026-07-30.** All 7 remaining raw
  call sites migrated to named group helpers (`invalidateOuraWorkoutReview`,
  `invalidateWorkoutMetaRefresh`, `invalidateWorkoutDataImmediate` — the last two new, both
  documented as also needing `clearLegacyHomeSeeds()` per this file's own top-of-file invariant,
  which two of the raw call sites had been silently missing since they had no way to call the
  unexported helper directly) plus one dead duplicate call deleted (`invalidateOuraSync()` already
  covered `sleep-performance-correlation`). The CI gate for this half is now enforced — "No
  hand-rolled invalidateCache outside lib/cache-groups.ts" in the Custom Rules job.
- Bare `fetch('/api…` in `components/`/`app/`/`lib/`: **~228 sites** — genuinely blocked, a static
  scan can't separate GETs from mutations without parsing the `method` option. Leave blocked.
- ✅ **Migration-number collisions (081/087/146/161) — VERIFIED HARMLESS 2026-08-03, no action.**
  `migrate.js` applies in plain filename sort order, so a duplicate number makes apply order
  ambiguous *only if the two files touch the same object*. Checked all four pairs; every one is
  disjoint:

  | # | file A writes | file B writes |
  |---|---|---|
  | 081 | `exercise_library` (ALTER) | `exercise_media` (CREATE TABLE) |
  | 087 | indexes on `body_metrics`/`exercise_logs`/`sleep_sessions`/`workout_sessions` | `oura_tokens` columns |
  | 146 | `UPDATE workout_sessions` | `CREATE TABLE running_baselines` |
  | 161 | `activity_logs` (ALTER) | `oura_ble_clock_anchors` + `oura_raw_samples` (ALTER) |

  Either order produces the same schema in all four cases, so the "unverified for the 146 pair
  specifically" caveat is now answered — it is fine, as are the other three. **The rule at the top
  of this file still stands** (claim a number against the directory *and* open PRs/plan docs): this
  closes the four that exist, it does not make future collisions safe.

---

## [devices] ▶ Oura on-device + own-analysis — live handover (owner-directed 2026-07-21, ongoing)

**Implementer entry point:** [`docs/oura-ondevice-hybrid-handover.md`](oura-ondevice-hybrid-handover.md)
(condensed baton, D0–D7 sequence) and
[`docs/oura-ondevice-hybrid-implementer-progress.md`](oura-ondevice-hybrid-implementer-progress.md)
(live state + exact next tasks). This entry is the short pointer, not a duplicate spec.

**D0 (steps) and D1 (durability chain, all sync tracks) are closed.** D5 (own
daytime-HRV) and D6 (comparison harness) are shipped, pending a real H10 spot-check
to validate tolerances. D2 Tasks 2+3 (native raw store + WebView bridge) are built
and **device-verified 2026-07-30** (Full re-sync drain + kill-mid-drain, both clean on the S25).

**Ordered, with what gates what:**

1. ~~⛔ BLOCKING, owner-only. D2 Tasks 2+3 need on-device verification~~ ✅ **CLEARED
   2026-07-30.** Full re-sync (694 batches) and kill-mid-drain both ran clean on the S25. See
   Q-29 above and `docs/oura-ondevice-hybrid-implementer-progress.md` for the evidence and two
   UI-gap caveats (Q-33).
2. **D2 Tasks 4-9** (clock anchor, rollup port, neural WASM, tier-ladder, prune,
   storage readout) — **unblocked, next up.** Neural port is SleepNet + step_counter only.
   CSP prerequisite before Task 6: add `wasm-unsafe-eval` to the prod `script-src`.
3. **B3 (Track-B replace-by-day outbox) + B5 (concurrent-pool load test)** —
   D2-blocked.
4. **D3** — silent read-flip to local-first. Needs D2 Tasks 4-9.
5. **D4** — server-raw cutover: pull-to-device + completeness audit + **staged drop
   of the 437k-row `oura_raw_samples` table**. ⚠️ **DESTRUCTIVE — explicit owner
   confirmation required before touching this.** Must rewrite the CLAUDE.md "never
   prune `body_hex`" rule in the same PR.
6. **D7** — delete the dormant oracle ONNX models from serving (~T+3mo out). Keeps
   SleepNet + step_counter.

**✅ CLOSED 2026-08-02 — shipped as #1004** (migration `166_sleep_sessions_oura_id_user_scope.sql`).
Kept below for the reasoning, which explains why the constraint is user-scoped now. **Not verified
with two real BLE-ring accounts** — there is only one today.

~~Also still open, found while closing a prior session, otherwise orphaned:~~
`sleep_sessions.oura_id` was a **global** unique constraint, but the BLE rollup
derives it as `` `ble:${startDs}` `` with **no user component** — a second real
account wearing a BLE ring collides with the first account's nights, and because
`aggregateOuraRawSamples` writes errors into `stepErrors` rather than throwing,
that account's sleep data would silently stop landing (this already happened
between test users — it was the year-long CI flake, now fixed for tests but not for
the underlying id scheme). Fix: either `` `ble:${userId}:${ds}` `` or move the
constraint to `(user_id, oura_id)`. Touches the Cloud dedup key — wants its own
migration + PR, sandbox-buildable.

**Not part of this initiative, but found doing the 2026-07-29 handover and
otherwise orphaned:** migration numbers 081, 087, 146 and 161 are each claimed
twice on disk (see the migration-number note at the top of this file).

---

## [cardio] ▶ Cardio training system — remaining

- **Plateau handling + block-end review (D-7, D-8)** — deferred deliberately, needs
  real push-session history to be meaningful (needs a full training block on the
  now-shipped baseline-anchors system first). No plan yet, deliberately.
- **Chronic-stress Chunk 2 (Health card)** — owner-gated: `chronic_stress_score` is
  null until ~21 nights of real ring data accumulate. Build the card once the owner
  confirms a plausible on-device value.
- **Polar PMD cadence** — shipped (#790); remaining is on-device validation only
  (native strap path unverifiable without a rebuilt APK), not a build item.

---

## [cardio] ▶ Guided walk — remaining

> **Phase D — Android status-bar pill for phase + countdown ✅ SHIPPED v1.243.1 (2026-07-29)** —
> reused the existing `AndroidRunChip` native bridge (built for the running screen's duration chip)
> instead of adding a new Kotlin plugin; its countdown-to-target/overtime-flip behaviour already
> covers a walk phase's remaining time. `walk-active.tsx` re-anchors it on every phase change with
> the phase name as the label. Per-phase color was investigated and not built — no color hook exists
> on the reused bridge, and the phase name already satisfies the no-color-only-state rule. **Not
> verified on device** — compile-gated only in the sandbox, no APK rebuild available this session.
> Entry: [`docs/overview/overview/history-2026-07-28.md`](overview/history-2026-07-28.md).

- **Phase E** — reactive walk/jog nudge notifications from live speed + HR.
  Foreground-only v1. Depends on live pace-tracking (shipped) + live-HR verified
  on-device first.
- **Phase G steps** — real per-activity step counts need a windowed raw-BLE-frame
  reader that doesn't exist yet. Same underlying blocker as the Oura on-device
  program's steps gap — build the reader once for both consumers.

---

## [heart-rate] ▶ HR Recovery Profile — remaining

**HRP-2b — within-run interval-rep detection.** Requires either real multi-peak
signal processing over `oura_heartrate`, or execution-time rep tracking added to
the running system (neither exists today) — scope this properly before starting,
don't bolt onto the existing single-episode-per-workout detector.

---

## [devices] ▶ Oura on-device models program — remaining

- **P-A Lever 5** — aged-`body_hex` cold-storage/delete. ⛔ Owner deferred
  ("needs a discussion on best practice… wait till the system is fully built").
  Confirm-before-merge, not started. Recommended shape when taken: compress/move
  aged `body_hex` at a ~12-month window, not a hard delete.
- **P-C** — sleep feature-stack remainder (on-device REM% spot-check owed).
- **P-D** — Phase B (neural energy-expenditure heads) device-gated on workout-window
  motion capture; activity detection (P3) ⛔ blocked — needs daytime raw motion +
  location, neither available over BLE.
- **P-F P3** — vascular-age PPG spike. ⛔ Owner GO/NO-GO gate, not started.
- **P-G G-2** — `DbFootprintCard` + `db-stats` route (pairs with the culling work).

---

## Native APK holding pen (owner rebuild required — sandbox can only compile-gate)

- **R-1 BLE cursor hole-jump race** — code shipped (v1.181.2), needs the owner's
  APK rebuild + an on-device Full re-sync check to take effect/verify.
- **Durable background sync remainder** — CompanionDeviceManager association +
  bonded-device reconnect (highest-risk blind Kotlin piece, deliberately deferred).
- **Native steps decode** — `steps_motion_decoder` native port.
- **Per-epoch clock anchor** (native-adjacent half — the server-side epoch model
  already shipped, see the Oura on-device handover above).
- **Native battery time-series UI polish**, **WK-18 calendar-event outbox domain**
  (lowest priority — owner's own recommendation was to drop this one; confirm
  before spending time on it).

---

## Not yet queued — needs a planning session first

- **Frequency-domain HRV over the `rr_intervals` corpus** — 28,476 RR intervals since 2026-07-17,
  and `hrv-frequency.ts` (LF/HF) plus `tachogram.ts` already exist in `packages/shared/src/health/`.
  The only consumer today is a breathing-rate signal inside the adapter. This is the **largest
  untouched analytical asset in the database** ([data-analysis review](reviews/2026-08-05-data-analysis-opportunities.md)
  §4 B5). Not queued as a feature because there is no product question attached to it yet — LF/HF is
  easy to compute and easy to over-interpret. Wants a specific question before scoping.
- **The two nutrition-dependent trend views are structurally dead — an owner decision, not code.**
  `food_logs` stops at **2026-07-26**; only **14 of 110** days carry calories and **6** carry macros
  ([data-analysis review](reviews/2026-08-05-data-analysis-opportunities.md) §4 B3). The
  `energy-balance` view needs food *and* workouts on the same day and can essentially never fire;
  `meal-timing` is nearly as thin. Both render "not enough paired data" indefinitely, which is the
  worst of the three options. Either nutrition logging gets prompted again, or the two views get
  retired — that is the owner's call.

- **Whole-week re-balance after a short session** — a `short` session drops whole
  exercises, removing weekly volume nothing tells the rest of the week about.
  Deferred deliberately: the weekly-MAV trim priority already gives most of the
  benefit implicitly. **Do not build a second weekly-volume model** —
  `muscleOverageRatio` is the currency. Wants evidence a muscle actually ends a
  week under target before scoping further.
- **Time-summary "planned work" from measured pace** — switch the Time Summary
  card's planned-work-time source from the standard duration-model pace to the
  per-exercise learned pace (`lib/workout/time-profile.ts`) once enough samples
  exist, falling back to the standard pace otherwise. Small, self-contained, no
  migration.
- **Bundle-the-shell-into-the-APK + native FCM push (endgame)** — the unscoped
  project beyond Q-1 Phase 3. Needs its own planning; auth + `apiUrl()` abstraction
  first.
- **The remaining server-computed aggregates** — `weekly-stats`,
  `weekly-muscle-sets`, `weights-summary`, `muscle-recovery` and the `day-timeline`
  sanctioned exception all render from the server, so each is blank or stale with
  the network off. Named as gaps in
  [`docs/offline-first-target-architecture.md`](offline-first-target-architecture.md)
  (2026-07-30) with no backlog entry until now. Each is small next to the Oura
  D0–D7 program and should be taken **after** it, reusing D2's on-device rollup
  pattern rather than inventing a second one. Stage 3 of
  [`docs/superpowers/plans/2026-08-02-native-convergence-goal-layout.md`](superpowers/plans/2026-08-02-native-convergence-goal-layout.md).
- **Polar H10 PMD streaming (raw ECG/accelerometer)** — R&D, no product use yet
  (YAGNI). Protocol fully documented in the `polar-h10-ble` skill if ever wanted.
- **Runtime convergence endgame** — wasm SQLite in the browser so local-first works
  on web too. Against the current "APK-only supported target" policy — owner
  re-scope only, don't start without it.
- **`ActiveWorkoutScreen`'s own 1Hz self-tick** and **`workout-select-content.tsx`'s
  hand-rolled swipe → shared `useDrag`** — both deferred given the regression risk
  of touching the highest-traffic screens further without a narrowly-scoped plan.
- **Count-up on `home-card-widget.tsx`'s stat tiles** — each widget is a
  `switch`-case with an early `return null`, so `useCountUp` can't be called
  inline without violating rules of hooks; needs a small per-widget wrapper.
- **E6 — cron/proactive layer** — genuinely unbuilt; needed for anything that must
  fire without the app ever having been opened that day. The shipped proactive
  recaps reuse client-scheduled local notifications, not real server-side push.
- **Batch O remainder** — progress photos, warm-up protocol customization, voice
  logging, mesocycle retrospective. See `docs/planned_upgrades.md` § Batch O.
