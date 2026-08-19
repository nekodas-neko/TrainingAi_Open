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
| Next free Postgres migration | **203** | `lib/data/postgres/migrations/` (head: `202_claude_ro_views_food_logging_complete.sql`) |
| Local SQLite schema version | **v27** | `lib/sqlite/migrations.ts`; `lib/sqlite/__tests__/migrations.test.ts` asserts the max |
| Next unallocated Q band | **602** | the band table in [`docs/agents/README.md`](agents/README.md) |

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
> Journal: [`entries/2026-08-16-health-stale-goal.md`](overview/history-2026-08-15.md).


<!-- NUTRITION FOCUS BLOCK — the owner asked on 2026-08-18 to concentrate on nutrition. The eight
     entries below are ordered by dependency, not by Q number. Do not re-sort them into numeric
     order; the sequence is the point. -->

## Nutrition focus — the owner's priority, 2026-08-18

*"lets focus on the nutrition changes now. id like to get this perfected today"*

The nutrition cluster is **eight entries**, ordered by dependency rather than Q number, starting at
Q-401 below. **Q-407** (the meal-plan wizard as a coach conversation) and **Q-409** (paste a recipe
URL, get a meal) were added on 2026-08-19 from the owner. Q-407 sits after Q-398 because a
conversational plan needs somewhere to land — plan meals becoming ordinary saved meals is its exit
route. Q-409 sits after Q-407 because it extends the same step, but it depends on nothing and can be
built into the existing stepper at any time.

Two have shipped since this block was written: **Q-399** (#163, the centred label now has
room for its ingredient list) and **Q-402** (#165, a component is told when its cache key is
invalidated). Their entries were correctly removed on merge.

**Q-359 sits above the block deliberately** — it is Lane B's follow-up to Q-402, and it reports that
**36 other fetch-once effects carry the same latent bug**. That is the general version of the defect
Q-402 fixed in one place, so it outranks the remaining nutrition work rather than interrupting it.

**Realistically today, and this is the honest split:**
- **Achievable** — Q-401 is small, self-contained and independent of the rework. (**Q-399 and Q-402
  are done** — v1.325.0 gave the default label its three ingredient lines at 0.401 mm per module,
  and v1.325.1 gave the cache an invalidation signal so Home's energy card stops freezing.)
  Q-387's wiring is a shared-module change and can run in parallel in the other lane.
- **Not a one-day job** — Q-395 is a full rework across six screens, gated behind extracting
  `food-row.tsx` because both landing files sit on the 800-line limit. Q-398 wants that row component
  first. **Q-396 and Q-400 need a new APK**, so they cannot complete in a single web-deploy cycle
  whatever else happens.

**Parallel-safe:** the Lane B half of Q-401 is now unblocked on both counts. Everything else is
sequential.

---

**2026-08-19 — the owner reviewed the interactive prototype, and the cluster is now fully decided.**

Prototype: <https://claude.ai/code/artifact/4fc7f99e-71f3-442c-b88b-1bb83b5fa9d6>. **Nothing in this
cluster is waiting on the owner any more.** Every open question that was blocking it has an answer,
and the answers live in the entries rather than here:

| decided | where it is written | build order |
|---|---|---|
| Label styles all draw **square** | **✅ Q-411 SHIPPED 2026-08-19 (v1.325.5)** — [`journal`](overview/entries/2026-08-19-square-label-canvas.md) | done |
| Save-to-gallery, and the PNG's missing physical size | **Q-400**, moved up to 2nd on 2026-08-19 | **now 1st — it is the gate on every print test** |
| Ingredient row: **option A**, collapse when not editing | Q-395 (the DECIDED block) | after `food-row.tsx` |
| Log Food tabs are **Recent · My Foods**; Frequent dropped, Saved merged | Q-395 note 17 | with the rework |
| Action row is **Photo · Barcode · Describe or enter** | Q-395 note 15 | with the rework |
| Meal photo uploads from **Edit Meal**, 64 px tile left of the name | Q-396 | independent |
| The coach must **write every plan meal into My Foods** | Q-407, and it makes Q-398 a prerequisite | after Q-398 |

**Two things carry a caveat rather than a blocker, and both resolve on the same physical print:**
Q-411 shipped the square canvas and every module grew (the default 0.401 → **0.561 mm**), **but that
gain is only real if the owner's circle template CROPS rather than SCALES.** If it scales, the square
lands at 50 ÷ √2 = 35.4 mm and the default falls to **0.397** — fractionally worse than what it
replaced. Q-400's saved PNG also declares no physical size, so it prints at 312 mm.

**That print cannot happen at all until Q-400 ships** — the owner, 2026-08-19: *"I can only do a
print once the option to save to gallery exists"*. There is no export path on the APK, so **Q-400 is
the gate on three separate answers** and is now first in this queue. Until it lands, **describe
Q-411 as a simplification, not a scannability improvement.**

**Q-406's headroom half is DONE** (v1.325.3): `nutrition-content.tsx` is 732 and
`saved-meals-sheet.tsx` is 753, so the landing files are no longer the gate — that sentence was
already stale when written. What remains of Q-406 is the row component itself, and it now waits on
Q-395 rather than blocking it: the four call sites are four different shapes, so unifying them is a
design decision. See the correction at the top of that entry.

### [nutrition][platform] Q-400 — "Share or save" does nothing on the APK; the label cannot reach the gallery

- **Branch:** `fix/label-save-to-gallery`
- **Added:** 2026-08-18 · owner, on v1.324.6: *"the share button doesnt do anything - it should give
  a download to gallery/images when clicking it."*
- **Lane A** if it needs a Capacitor plugin or a Kotlin bridge (it does — see below), which also
  means **a new APK**. State that in the PR: this half does not reach the device through a Railway
  deploy.

**Why it does nothing.** `meal-label-sheet.tsx` has two paths and both miss on the canonical runtime:
1. `navigator.canShare?.({ files: [file] })` — share-*with-files* is narrower than share-with-text
   and is not reliably available in the Samsung WebView, so the guard correctly returns false and
   falls through. The guard is right; there is just nothing behind it.
2. The fallback is `<a download>` on a blob URL — and **the code's own comment says this is
   unreliable inside the WebView**, which is why it was written as the fallback. It is a silent
   no-op there: no error, no file, no toast. Exactly what the owner reports.

So the feature has only ever worked in `pnpm dev`. This is the failure class CLAUDE.md names
directly — green on web, dead on the device, because the failing path is unreachable in the sandbox.

**What to build.** A native save, not a better guess at a web API.
- Write the PNG with **`@capacitor/filesystem`**, then make it visible to the gallery. On Android a
  file written to app storage is invisible to the Photos app until it is registered with
  **MediaStore** — writing to `Directory.Documents` and hoping is the trap here. Either use a
  community MediaStore plugin or add a small Kotlin bridge beside `OuraBlePlugin`.
- Keep the **share sheet** as a second, explicitly-labelled action: saving to the gallery and handing
  the PNG to a label-printer app are different intents, and the owner asked for the first. One button
  doing whichever happens to be available is what produced this bug.
- **Fail loudly.** Every branch ends in a toast — saved, shared, or failed. A silent path is what made
  this invisible for a release.

- **⚠ Do not "fix" this by removing the `canShare` guard.** Calling `navigator.share` with files where
  it is unsupported rejects, and the existing catch swallows `AbortError` — which would turn a dead
  button into a dead button that also lies in the log.
- **Verification is on-device only.** `pnpm dev` cannot prove any of it: tap save, then open the
  Samsung Gallery and find the file. Web is not evidence here, and neither is a passing unit test.
- **Related:** the label this saves was missing its ingredient list — **Q-399, fixed 2026-08-19
  (v1.325.0)**. That prerequisite is cleared; the artwork this reaches the gallery with is now the
  one the owner picked.

**A small one alongside it, and the owner has set the priority: the chosen label style does not
persist.** `meal-label-sheet.tsx` holds it in `useState(DEFAULT_MEAL_LABEL_STYLE)` and never stores
it, so every open resets to the default. The docstring calls that deliberate (*"picked at print time
… cycling is the point anyway"*), which was right when there were four styles and no settled
favourite. **The owner's own read, 2026-08-19:** *"I would make the image very rarely; happy for it
to default to the default and I can change it whenever I want. Keep in mind I just save the image
and reuse that. Happy for it to persist if its easy."* So: **do it only if it is genuinely a few
lines** — a `localStorage`-backed initial value, no schema, no settings surface — and drop it
otherwise. It is a papercut on a flow used a handful of times, and the label PNG is saved and reused
externally, so the cost of re-picking is near zero. **Do not spend a migration on this.**

**A second defect on the same button, found 2026-08-19 — the PNG has no physical size, so it prints
at the wrong size even once it reaches the gallery.** The owner's ask is *"download in full res to
print onto a label"*, and **the resolution half is already done**: `DEFAULT_RENDER_SCALE = 6.24`
makes a 50 mm label **1,179 px, which is 600 dpi** (`meal-label-render.ts:23`), and the docstring is
explicit that *"the canvas IS the printed artwork"*. Nothing needs to be raised. **What is missing is
the metadata that tells a printer what those pixels are worth.**
- `canvas.toBlob(res, 'image/png')` (`meal-label-sheet.tsx:73`) writes a PNG with **no `pHYs`
  chunk** — the canvas API has no way to set one. A PNG without `pHYs` has no declared physical
  size, so every print path falls back to its own default, which is **96 dpi** almost everywhere.
- The arithmetic is the whole bug: **1,179 px ÷ 96 dpi = 12.3 inches ≈ 312 mm**. A label drawn to be
  50 mm arrives as a third of a metre. On a label printer with fixed media it will not fit at all;
  in a print dialog the user has to notice and hand-set the scale to ~16%, every time.
- **Fix:** inject a `pHYs` chunk declaring 600 dpi (23,622 pixels/metre, unit = 1) into the blob
  before it is saved or shared. It is a 21-byte chunk spliced after `IHDR` with its own CRC — a
  small pure function, so it gets a unit test that reads the chunk back rather than a visual check.
  Write it in `packages/shared` beside the renderer so both the save and the share path use it; two
  copies of this would drift and only one of them is easy to notice.
- **This is invisible in every check we run.** The PNG is valid, the pixels are correct, the E2E
  decodes the QR fine — the defect only appears on paper, which is also why it survived the 300→600
  dpi change that was made specifically for print quality. **Verification is a physical print**: send
  the saved file to the label printer and measure the code with a ruler. `metrics.codeMm` in the
  sheet says what it should measure, so the check is exact rather than a judgement call.
- **Order matters:** there is no point testing this before the save path exists. Fix the delivery
  first, then the metadata, then print once and measure — one print proves both halves.

**⚠ THIS ENTRY IS NOW A GATE ON Q-411 TOO, and the owner has said so outright:** *"I can only do a
print once the option to save to gallery exists"*. Nothing reaches a printer until this ships —
there is no export path at all on the APK. That makes one PR the blocker for **three** separate
verifications:
1. this entry's own delivery fix (does the file reach the gallery),
2. the `pHYs` metadata above (does it print at 50 mm rather than 312), and
3. **Q-411's central claim** — whether the owner's circle template crops the corners (module holds
   at 0.56 mm) or scales the square inside the circle (module falls to 0.397, and the change is a
   small regression instead of a 40% gain).
**Treat it as higher priority than its queue position suggests**, and when it ships, tell the owner
in the same breath that the print test is now unblocked — all three answers come from one print with
a ruler.


### [nutrition] Q-413 — `logged_at` records when you pressed the button, not when you ate; resolve it against the meal window

- **Branch:** `feat/resolve-eaten-at`
- **Added:** 2026-08-19 · owner, specifying the rule while reviewing Q-412
- **Owner's words:** *"for time 'eaten' lets use the same logic we have; if its logged within the
  time bucket - then record that as the time. If its added outside the window; then choose the
  midpoint of the window and record that as the time. This way we can also build up a calories x
  time on a graph which will be nice."*
- **Lane A** — a shared formula plus the write paths and a backfill. **Build it before Q-412's
  reassign**, which has to call the same function; see the cross-reference at the end.

**What is stored today.** `food_logs.logged_at` is `timestamp notNull().defaultNow()`
(`schema.ts:579`), and nothing computes it — `createFoodLog` passes through a client-supplied value
when one exists (offline replay) and otherwise takes the database default. So the column means
**"when the row was created"**, which is only accidentally the same as when the food was eaten.
- Log yesterday's dinner over breakfast the next morning and the row says 8 am, on yesterday's
  `date`. The timestamp and the date disagree, and the timestamp is the wrong one.
- That is not an edge case. Back-filling a missed day is the single most common way this app's food
  log gets used after the fact.

**The rule, stated precisely.** For a log on local date `D`, assigned to meal type `M` with window
`[M.timeStartHour, M.timeEndHour)`, created at instant `T`:
- If `T` falls on `D` **and** its hour is inside `M`'s window → **keep `T`**. The user logged it as
  they ate it and the real time is better than any derived one.
- Otherwise → **the midpoint of `M`'s window on date `D`**: `(start + end) / 2` hours, so Lunch
  12–15h stamps 13:30 and Pre Workout 6–10h stamps 08:00.

**Four details that decide whether this is right or subtly wrong.**
1. **The midpoint is computed in the USER's timezone on `D`, never device-local and never UTC.**
   This is the repo's most-repeated bug class and the exact shape it takes: `setHours` on a `Date`
   resolves in the device's zone, so the same log stamps a different instant on a phone set to
   another country. Use the `packages/shared/src/date-utils.ts` helpers and thread
   `session.user.timezone` through. Note `lib/meal-reminders.ts:39-42` already does the
   `setHours` thing — it is defensible there because a reminder fires on the device, but **do not
   copy that pattern into this**, and do not "fix" it in the same PR either.
2. **Anchor to the log's `date`, not to "today".** This is what makes back-dating work and is the
   entire value of the change. Reading `todayInTz()` here would reproduce the bug in new clothes.
3. **Define the wrapping window before writing the arithmetic.** If `timeEndHour <= timeStartHour`
   the window crosses midnight (22→2) and the naive midpoint lands at noon — the opposite side of
   the clock from the truth. Either compute it as `(start + (end + 24)) / 2 mod 24`, or reject
   wrapping windows in the meal-type editor. **Say which**, and cover it with a test either way.
   `timeEndHour = 24` is the ordinary end-of-day case and is not a wrap: 21–24 → 22:30.
4. **One formula, one place.** This is called from the web route, the `pushMutations` branch, the
   local write, and Q-412's reassign. It goes in `packages/shared` as something like
   `resolveEatenAt({ date, window, at, tz })` and is imported everywhere, per the standing rule.
   Four copies of a midpoint calculation is how the weekly-cadence formula ended up with two
   different semantics.

**Existing rows — recommendation, and it is deliberately conservative.** A calories-over-time graph
is only interesting with history behind it, so the stored values matter. **Do not blanket-rewrite
`logged_at`**: for rows where the user logged as they ate, the stored instant is the *better* datum
and overwriting it with a midpoint destroys real information. Ship a one-off idempotent migration
that recomputes **only rows whose stored `logged_at` falls on a different local date than the row's
`date`** — those are unambiguously "logged later" and carry no information about when the food was
eaten. Leave everything else untouched. If a broader backfill is wanted later it can be a separate,
explicit decision.

**What this unlocks, and what is NOT in this entry.** The calories × time graph the owner is after
becomes possible once the column means what its name says — but it is a **new surface** and is not
in scope here. File it separately once this lands; building the chart against today's column would
plot when the user reached for their phone.

**Cross-reference — Q-412 depends on this.** Reassigning a log to a different meal type has to
re-run the same rule against the **new** window: if the stored time is inside it, keep it; if not,
move it to the new midpoint. Otherwise a 3 pm snack reassigned to Lunch keeps a 15:00 stamp that
sits outside Lunch's 12–15h window, and the graph inherits the inconsistency the reassign was
supposed to tidy. **Land this first**, then Q-412 calls it.

- **Verification.** Unit-test the resolver directly and cover: inside-window, outside-window,
  back-dated (T on a different day than D), `timeEndHour = 24`, a wrapping window, and **a
  fixed-offset timezone whose local time is currently near midnight** — per the standing rule, a
  timezone regression test must not wait for the clock to reach the failing window, so pick an
  `Etc/GMT±N` that is near 01:00 *now* and run the case there. Then confirm end to end that a log
  created for yesterday from today's session stores yesterday's midpoint, not this morning.

### [nutrition][health] Q-414 — energy in against energy out, on one timeline

- **Branch:** `feat/energy-timeline-chart`
- **Added:** 2026-08-19 · owner, once Q-413 made the timestamp mean something
- **Owner's words:** *"This would just be a display of calorie intake over time? would be nice on a
  graph like widget; could be superset with calorie out too; so can see what times energy is
  expended vs refueled."*
- **Lane B** (`components/**` + an aggregate GET, which is Lane A if a new route is needed — check
  whether `day-timeline` can carry it before adding one).
- **⚠ BLOCKED ON Q-413, and this is not a soft dependency.** `food_logs.logged_at` currently records
  when the row was created, so a chart built today would plot **when the user reached for their
  phone**, not when they ate. Every back-filled day would spike at whatever hour it was logged.
  Q-413 makes the column mean what its name says; do that first or this graph is confidently wrong.

**What it is.** One chart, x = time of day, two series:
- **In** — calories eaten, from `food_logs` bucketed by the resolved `logged_at`.
- **Out** — calories expended across the day.
The point is the *relationship*: where refuelling sits against expenditure, so a 2,000 kcal day
eaten entirely after 7 pm reads differently from the same total spread across it.

**Design decisions to make before building — these are the real content of this entry.**
1. **Which shape.** Intake is **discrete events** (four meals), expenditure is **continuous**. Do
   not draw both as lines: a line through four meal points implies the user was eating at 10:30
   because the segment passes through it. Recommendation: **bars for intake, a filled area or line
   for expenditure**, same axis. That is the honest encoding of "events against a flow".
2. **Cumulative or per-hour?** Both are defensible and they answer different questions. Per-hour
   shows *when*; cumulative (two rising curves, the gap between them being the running balance) shows
   *whether you are ahead or behind*, which is closer to what the owner already sees on the energy
   bar. Recommendation: **cumulative**, because the gap between the curves is the day's energy
   balance and this app already frames nutrition that way (Q-401 retired the second budget precisely
   to have one number). Per-hour bars can be the intake series drawn against it.
3. **Where "out" comes from, and it is not one source.** BMR accrues continuously (~1 kcal/min and
   flat), movement is bursty. Decide whether the curve is BMR + measured movement (honest, and
   already the app's model since Q-401) or measured only (misleading — it implies you burn nothing
   sitting still). Recommendation: **BMR + movement**, drawn as one curve, with the method stated
   under the chart. Do not invent a third TDEE model — Q-401 exists because there were two.
4. **Resolution.** Movement data granularity decides this, not taste. Check what the step/activity
   pipeline actually stores per interval before picking an hourly or 15-minute bucket; a chart
   smoother than its data is a lie with a nice curve.

**Where it lives.** The owner said *"graph like widget"*. Two candidates: the Nutrition tab under the
existing energy bar, or the day-detail screen. Recommendation: **day detail**, and link to it from
the energy bar — the Nutrition tab is already the densest screen in the app and Q-395 is trying to
make it lighter, not heavier. A widget on the tab that opens the full chart is the compromise if the
owner wants it visible.

- **Per the repo's own rules:** chart colours resolve through `resolveColor`, never a `var(--x)`
  string handed to canvas (that renders black and has shipped twice); the intake series uses the
  shared `MACRO_COLORS` only if it is split by macro, otherwise a single accent; and the card seeds
  from cache and uses `useCachedValue`, never a fetch-once effect (Q-402/Q-359).
- **Verification.** Compare the chart's totals against the day's existing figures — the intake curve
  must end exactly on the day's logged calories and the expenditure curve on the day's burn. A chart
  that disagrees with the number above it is worse than no chart.

### [nutrition] Q-412 — "reassign them first" instructs the user to do something the app cannot do

- **Branch:** `feat/meal-type-reassign`
- **Added:** 2026-08-19 · owner, from Nutrition Settings on v1.325.x, with a screenshot
- **Owner's words:** *"how would I delete meals? say I wanted to move back to 3 a day or so. it
  seems I cant if there are meals assigned"*
- **Lane A** — the fix is a new write path (`app/api/**` + repo slice + the sync chain). The dialog
  that calls it is Lane B and is small; land the endpoint first.
- **Placement:** medium-high. It is not a data-loss bug, but it is a **dead end with no exit**, and
  the only way out a user can find on their own destroys history.

**The trap, end to end.**
1. `deleteMealType` (`lib/data/postgres/slices/nutrition.ts:100`) probes `food_logs` for any live row
   pointing at the meal type and throws `MEAL_TYPE_HAS_LOGS` if one exists.
2. The route turns that into a 409 reading **"Meal type has food log entries — reassign them
   first"** (`app/api/nutrition/meal-types/[id]/route.ts:45`).
3. **There is no reassign, anywhere.** `PATCH /api/nutrition/food-logs/[id]` accepts
   `quantityMultiplier` and nothing else — `meal_type_id` is not a settable field on any route, and
   no UI offers to move a logged item between meal types.

So the message names the one action that would clear the block and the app has never implemented it.
**The only escape a user can actually perform is deleting every food log ever recorded against that
meal type**, which throws away nutrition history to change a setting. The owner's case — dropping
from five meal types back to three — is the ordinary case, not an edge one.

**What is NOT the problem, so nobody re-derives it.** This is not a foreign-key limitation and the
guard is not protecting the database. `meal_types` already soft-deletes (`deleted_at`, Q-179), and
that function's own docstring says so: *"Soft-deleting sidesteps the RESTRICT entirely: the
soft-deleted logs keep pointing at a row that still exists."* The row survives, so historical logs
would still resolve their meal type.

**What the guard IS protecting is the day view, and this is the constraint the fix has to satisfy.**
`listMealTypes` filters `deleted_at IS NULL` (`:65-70`) and `nutrition-content.tsx:591` renders
`mealTypes.map(...)`. Soft-delete a type that has logs and **those logs stop being rendered at all** —
they still exist, still count toward the day's totals, and have no section to appear under. An
invisible-but-counted food log is worse than the dead end, which is presumably why the probe was
written this way.

**Recommendation — build the reassign the message already promises.**
- **The delete flow becomes a choice, not an error.** Count the affected logs first and say so:
  *"Afternoon Meal has 34 entries. Move them to…"* with a picker of the remaining live meal types,
  and a secondary *"Delete them instead"*. A 409 that names a number and offers the fix is a
  different product from one that names a number and stops.
- **One new endpoint**: bulk `UPDATE food_logs SET meal_type_id = $new WHERE meal_type_id = $old AND
  user_id = $user`, then the existing soft-delete, **in one transaction** — a partial reassign that
  then fails the delete leaves the user halfway with no way back. Validate the target belongs to the
  user and is not the type being deleted.
- **It rewrites history and that is the intent, but say it in the dialog.** A 3 pm snack reassigned
  to Lunch will read as Lunch on every past day. For "I want three meals a day from now on" that is
  what the owner wants; it should still not be a surprise.
- **⚠ The reassign must also re-resolve `logged_at` — see Q-413, which should land first.** A log
  moved into Lunch keeps its old 15:00 stamp, which sits outside Lunch's 12–15h window and leaves
  the very inconsistency the move was meant to tidy. Call Q-413's shared resolver against the
  **new** window: inside it, keep the time; outside it, take the new window's midpoint.
- **`food_logs` is an offline-first domain, so this is a full sync chain, not one UPDATE** — the
  outbox mutation, the `pushMutations` branch, `getSyncDelta` and the `applyDelta` mapping all need
  it, per the standing rule. A bulk row-rewrite is also the shape most likely to conflict with a
  device that has unsynced edits: **gate the local upsert on `sync_status === 'synced'`** so a pull
  cannot clobber a pending local edit, exactly as the other branches do.

**The alternative, and why it loses.** Let the soft-delete through and render orphaned logs under
their archived meal type on days that have them, labelled *Archived*. It preserves history perfectly
and needs no data movement — but it leaves a ghost section on old days forever, complicates the day
query, and does not give the owner what he asked for, which is a tidy three-meal day going forward.
Worth reaching for only if the reassign proves harder than it looks.

- **A smaller thing worth fixing in the same PR:** the manager's delete button gives no warning
  before the attempt. It fires the DELETE, gets a 409, and shows a toast. Fetch the count when the
  sheet opens and disable-with-explanation, or open the move dialog directly — a button that can
  only fail is worse than one that explains itself.
- **Verification.** Reassign a meal type with logs across several days, then confirm on the day view
  that the entries appear under the new type with the same calories, that the day total is
  unchanged, and that the old type is gone from the picker. Then **verify on the APK** — this is an
  offline-first domain and the local mirror is where the sync half fails silently. Prove the reassign
  survives an app restart with the network off.

### [platform] Q-360 — `goal-invalidation.spec.ts` depends on the seed's step data reaching today, and it does not

- **Branch:** `fix/goal-invalidation-spec-seed`
- **Added:** 2026-08-19 · Lane B, found while running the full E2E suite before merging Q-359 slice 4
- **Placement:** low-mid. It is a **test-harness** fragility, not a product bug — but it is the shape
  CLAUDE.md already has a rule about, and it costs a session's confidence every time it fires.

**What happens.** `e2e/goal-invalidation.spec.ts:57` — *"a steps-goal edit reaches Health without a
reload"* — writes the goal successfully (the PATCH is asserted `r.ok()`), then fails waiting for
`/ 7,000` on Health's Progress panel. Measured 2026-08-19 against `origin/main` at `968516f` with an
**unmodified checkout**, so it is not any open branch's doing.

**Why.** The panel renders `steps / goal`, and the local database's most recent row carrying a
`steps` value is **2026-08-17**; today's `body_metrics` row exists with `steps` NULL. With no steps
figure there is nothing to draw the `/ 7,000` into, so the locator never appears. The test asserts a
*goal* propagates but reads it off a line that only renders when there is a *step count*.

**This is the rolling-window class CLAUDE.md already names**, one layer out: the rule there is *"a
test may hardcode a timestamp only when BOTH sides of the comparison are fixed"*. Here neither side is
hardcoded — but the fixture is a **static seed** and the assertion is against **today**, so the gap
widens by one day per day until it breaks. `scripts/local-db/seed.sql` seeds a fixed window of
history; CI reseeds the same fixed window onto whatever today is.

**Two fixes, and the second is the one to take.**
- Make the spec seed its own steps row for today before asserting. Local and cheap, but every
  future Health-panel spec needs the same and they will each invent it.
- **Make the seed relative to the run date** — generate `body_metrics`/`sleep_sessions` dates as
  offsets from `current_date` rather than as literals. That fixes this spec and every other one that
  quietly assumes recent data, and it is the same reasoning as deriving a fixture from the clock
  instead of pinning it.
- **Lane B owns the spec; the seed is `scripts/local-db/` and unlisted in §3** — claim it in the
  baton before touching it, or hand the seed half to Lane A.
- **Not verified:** whether this also fails in CI. CI has been green on `main`, which suggests the
  hosted run either seeds differently or the panel renders for another reason there — **that
  difference is the first thing to establish**, because "green in CI, red locally" is exactly the
  shape that trains sessions to ignore a real failure.

### [app-shell] Q-359 — 36 other fetch-once effects have Q-402's latent bug; only the shell ones can bite

- **Branch:** `chore/adopt-use-cached-value`
- **Added:** 2026-08-19 · Lane B, while fixing Q-402 · [`journal`](overview/entries/2026-08-19-cache-invalidation-signal.md)
- **Placement:** low. **Latent, not broken.** Q-402 shipped the mechanism (`subscribeToInvalidation`
  + `useCachedValue`); this is adoption, and adopting it everywhere at once is a large diff across
  screens with no component-test route.
- **What.** **36** `useEffect(() => { … cachedFetch … }, [])` blocks remain — 37 on `main` before
  the one conversion below (see the counting correction above; this entry originally said 36, from a
  scan that missed single-line effects). All of them evict correctly through `lib/cache-groups.ts` and none of them ask for a new
  value afterwards. **That is only a bug where the component does not unmount**, which is why 36 of
  them have never been reported: navigate away from a sheet or a screen and its next mount refetches.
  The persistent tab shell is the exception, and it is where the owner found it.
- **Do the shell ones first, and identify them rather than assuming.** Anything rendered by Home /
  the tab shell that is not behind a route change: `components/home-day-timeline.tsx` (two),
  `components/calendar-widget.tsx`, `components/health/*-card.tsx` where Home renders them. The
  full list, regenerated:
  ```
  grep -rn -A6 'useEffect(() => {' app components --include='*.tsx' --include='*.ts' | grep -B6 cachedFetch
  ```
  (the count above came from a small AST-free scan for `useEffect(…, [])` blocks containing
  `cachedFetch`; it is a starting list, not a proof of completeness).
- **Not every one should convert.** A site that deliberately fetches once — a sheet that snapshots
  data at open, `sync-provider`'s warm pass — is correct as it stands. Converting it would add
  refetches with no reader waiting for them. Judge per site; this is not a codemod.
- **✅ THE RATCHET SHIPPED 2026-08-19 (v1.325.4). The sweep is what remains.**
  `scripts/check-fetch-once-effects.js` freezes all 36 with a shrink-only per-file baseline: a file
  not listed must have zero, a listed file may only shrink, and a file that reaches zero must have
  its row deleted. Growth is stopped; each conversion is now visible in a diff.
  [`Journal`](overview/entries/2026-08-19-fetch-once-ratchet.md).
  **The baseline is grouped by whether the site can actually bite: 19 / 1 / 16.** Work the first
  group. **⚠ The grouping was wrong the first time and the correction is the reusable part:** sheets
  do NOT unmount here — the tab screens render them unconditionally with a null prop
  (`<ActivityDetailSheet log={selectedActivity} />`), so they are permanently mounted too. Re-checked
  by tracing each renderer up to a tab screen, the "can bite" group went from 14 to **19**. Judge a
  site by where it is mounted, never by its filename.
  **⚠ The count in this entry was one low, found by mutation-checking the new rule.** The scan
  behind it required a newline before the effect's closing brace, so it **missed single-line
  effects entirely**. Measured on `main`: **37** with the correct pattern against 36 with the old
  one, and `nutrition-content.tsx` has **two**, not one. One conversion below leaves **36**.
  **`useCachedValue` gained an `onError` callback** in the same change, because the first real
  conversion needed it — `cachedFetch` swallows `!res.ok` including this app's own rate limit, and a
  card without it cannot tell "no data" from "the request failed".
- **✅ SLICE 1 SHIPPED 2026-08-19 (v1.325.6) — six leaf-card files, 36 → 29.**
  [`Journal`](overview/entries/2026-08-19-fetch-once-slice-1.md). Converted: `home-day-timeline`
  (2), `calendar-widget` (its keyed `calendar-data:` effect too, which the ratchet does not count
  because its deps are not `[]` but which goes stale the same way), `activity/exercise-detected-card`,
  `health/hr-recovery-profile-card`, `health/strength-progress-card`, `cardio/trends-section`.
  Three results worth carrying:
  1. **`useCachedValue` gained a `today` option.** Without it the hook could only ever convert the
     plain-`cachedFetch` half of the sweep, and the `cachedFetchToday` half would have had to
     *switch variant* to adopt it — the exact drift the one-variant rule forbids.
     `lib/hooks/__tests__/use-cached-value-today-agreement.test.ts` cross-checks every literal-key
     hook call against `sync-provider`'s warm list, and is mutation-checked both ways.
  2. **`home-day-timeline`'s bespoke `ta:oura-ble-synced` listener is gone.** Q-91 added it because
     that widget never refetched after a BLE drain invalidated its key — Q-402's bug with a
     hand-built workaround for one event. The invalidation signal covers every writer instead.
     Safe because `cache-groups.test.ts` already asserts `invalidateOuraSync` clears that key.
     **Three sibling listeners remain** (`session-select-content`, `health-content`,
     `sleep-content`) and should go the same way when those files are converted.
  3. **The can-bite grouping was wrong again** — see the note in the check script. It was 18, not
     19: `cardio/trends-section` is rendered only by `/cardio`, which is not one of the five tabs.
- **✅ SLICE 2 SHIPPED 2026-08-19 (v1.325.7) — four more files, 29 → 25.**
  [`Journal`](overview/entries/2026-08-19-fetch-once-slice-2.md). `health/training-stress-line`
  (the first real use of slice 1's `today` option), `activity/exercise-review-sheet`,
  `activity/activity-detail-sheet` (the shared `hr-profile` key in both) and
  `workout-select-content` (`muscle-recovery`). ~~The can-bite group is down to 8, all of them in
  the four tab-screen orchestrators.~~ **That was wrong — see slice 3.**
- **✅ SLICE 3 SHIPPED 2026-08-19 (v1.325.8) — and most of it was a correction, not a conversion.**
  [`Journal`](overview/entries/2026-08-19-fetch-once-scanner-correction.md).
  **`scripts/check-fetch-once-effects.js` was over-counting, and by a lot: 25 sites across 16 files
  were really 15 across 12. Ten of the twenty-five never existed.** Its non-greedy regex started at
  a `useEffect(() => {` and ran to the first `}, [])` *anywhere* after it, so when that effect had
  real dependencies the match swallowed everything up to a later effect's close — other effects,
  `useCallback` bodies, plain functions — and searched the lot for `cachedFetch`. Five lines
  reproduce it, and they are in the script. It now brace-matches the effect body.
  **What that changes about the work, which is the part worth reading:**
  - `health-content` (2) and `nutrition-content` (2) have **no fetch-once effect at all**. Their
    fetches sit in tab-group `useCallback`s re-run on `tabEpoch` — the shape this rule is *steering
    people toward*. Two sessions' worth of "the hard ones, do them last" was aimed at nothing.
  - `sync-provider` (1) the same: its warm pass is a plain function. The "deliberately fetch-once"
    category that entry justified had no members and is gone.
  - `workout-screen` (2) is a `[userId]` effect; `running-plan-content` was 3, not 4.
  - **So the can-bite group was two sites, not eight.** This slice converts one —
    `session-select-content`'s `more-user-profile`, which is load-bearing: two paths invalidate that
    key, so changing a display name or avatar left Home's greeting stale until an app restart.
  - ~~One can-bite site remains.~~ **Done in slice 4.**
- **✅ SLICE 4 SHIPPED 2026-08-19 (v1.325.9) — the can-bite group is now ZERO.**
  [`Journal`](overview/entries/2026-08-19-invalidation-refetch-hook.md). **12 sites across 10 files
  remain and every one of them unmounts on navigate**, so what is left is latent by definition. The
  shell-level half of this entry is finished.
  - **A second hook was needed and is the reusable part**: `lib/hooks/use-invalidation-refetch.ts`.
    `useCachedValue` replaces a read outright — it holds, seeds and fetches the value — which does
    not fit a read that also seeds from the local SQLite store, wraps its fetch in `fetchWithRetry`,
    or sets several pieces of state. `useInvalidationRefetch(keys, fn)` gives such a read the half it
    does need: something asks for a new value when a write clears the old one.
  - **The real bug it fixed, beyond the ratchet**: three screens listened for `ta:oura-ble-synced`
    and refetched. `sleep-sessions` is also cleared by `invalidateBiometrics`, so a manually-edited
    sleep row or a Health Connect ingest left all three stale until a remount — only the BLE path
    self-healed, because it was the only writer that dispatched an event. All three converted
    together per the sibling-surface rule.
  - **It coalesces, and the three-key call site needs that**: `invalidateCache` fires once per key,
    so a group clearing all of health-content's three would otherwise run its whole meta load three
    times.
- **What is left of Q-359, for whoever takes it next.** Twelve latent sites, none urgent, and the
  entry stays queued only for them. Judge any future addition by where the component is **mounted** —
  grep for its name and check the renderer against `components/shell/tabs.ts`. That rule has been got
  wrong three times in this Q's own history.
  - **The lesson is about the check, not the sweep:** a scanner's own baseline is evidence, and this
    one had never been checked against a hand count. The mutation check it shipped with proved it
    caught a *new* site; nothing proved the sites it already listed were real.
- **Correction to slice 1's note about `lib/__tests__/q165-cache-seeded-reads.test.ts`:** it said
  that test would red when the two sheets converted. **It did not, and the reason is worth keeping.**
  It asserts `readCacheSync<` and `cachedFetch<` appear literally in three files; each sheet has
  *two* fetches, and only the `hr-profile` one is a fetch-once site. The keyed `hr-window:` fetch
  stays (its key changes per session, and `useCachedValue` has no way to express "no key yet" for a
  sheet mounted with a null prop), so both strings survive. `coach/coach-history.tsx` has a single
  fetch and is the one that will actually red — it is in the unmount group, so not soon.
- **Lane B owns this** (`app/**` ex-`app/api`, `components/**`, `lib/hooks/**`).
- **Not verified:** static scan for the remaining 29. **No screen was observed going stale** — they
  are inferred from the shape, and the one confirmed instance is Q-402's, which is fixed. Slice 1's
  six files were exercised on `pnpm dev` (Home, Health and `/cardio` render clean and fetch their
  routes) but **the refetch-on-invalidation half was not driven end to end** — that needs the Home
  fixture below, which still does not exist.
- **A guard needs a fixture that does not exist, and this is the reusable part.** Q-402's fix could
  not be driven end to end because the seeded user has no `height_cm`/`date_of_birth`/`sex` (so the
  energy card shows "add your details") **and** `DEFAULT_CARD_WIDGETS` is empty, so Home renders no
  card widgets at all until one is turned on. Three probes measured zero
  `/api/nutrition/energy-balance` requests. Whoever takes this should build that fixture first —
  a seeded body plus `ta_ss_cards` via `page.addInitScript` — because every Home-card guard needs
  it, and its absence is part of why a shell-only staleness bug reached a user report.

### [platform] Q-324 — the first suite run against a freshly-migrated database times out two test files, which is exactly what CI does every run

- **Branch:** `fix/ci-fresh-db-schema-contention`
- **Added:** 2026-08-19 · Lane A, while diagnosing a red `Tests` job on PR #195
- **Placement:** medium. It is **not** a product defect — it is intermittent CI red on changes that
  are fine, which costs a diagnosis every time it fires and trains people to re-run rather than read.

- **Reproduced on `main`, with no change of any kind applied.** Create an empty database, run
  `node scripts/local-db/migrate.js`, then run the suite **once**:
  ```
  FAIL  lib/data/postgres/__tests__/complete-workout-increment-race.test.ts
        Error: Hook timed out in 10000ms.   (beforeAll — getPool / getRepository)
  FAIL  app/api/admin/backfill-derived-scores/__tests__/backfill.test.ts
        Error: Test timed out in 5000ms.
  Test Files  2 failed | 487 passed      Tests  1 failed | 4133 passed
  ```
  **Run the suite a second time against the same database and it is 489/489 green.** Both files also
  pass in isolation on the fresh database. So it is neither test's own logic.

- **The mechanism.** On the first run each vitest worker calls `ensureSchema`, and against a database
  where `migrate.js` has not recorded anything in `schema_migrations`, every worker re-applies the
  whole migration set concurrently. The Postgres server log fills with `relation … already exists`
  and `deadlock detected` — the noise `CLAUDE.md` already tells sessions to ignore — and while that
  is happening the shared instance is saturated, so a `beforeAll` that only opens a pool exceeds its
  10 s hook timeout. On the second run `ensureSchema` is a no-op and nothing is slow.

- **Why it hits CI and never a local session.** CI creates a fresh `postgres:16` service for every
  run, so **CI is always in the first-run state**. A local session's `trainingai_dev` is warm and has
  been through this once, months ago. That asymmetry is the whole reason the failure looks
  unreproducible from a session — running `pnpm test` locally cannot reproduce it, and re-running CI
  usually cannot either, because it is a race rather than a determinism.
- **Evidence it is a race, not a rule:** PR #197's `Tests` job passed at 06:53 on the same base where
  #195's failed at 06:52.

- **Fix direction — pick one, do not do all three:**
  1. **Make `migrate.js` record what it applied** so the workers' `ensureSchema` is a no-op on the
     first run too. Cheapest, addresses the cause rather than the symptom, and makes CI's first run
     look like a session's warm one. **Recommended.**
  2. Serialise `ensureSchema` across workers with the advisory lock the migration tests already use.
     Correct but slower, and `migration-test-lock.test.ts` shows that lock has its own hazards.
  3. Raise the two timeouts. Rejected — it hides the contention and the next slow file just moves the
     goalposts.

- **Do NOT "fix" this by re-running the job.** That is what it currently costs, and it is why the
  entry exists. `CLAUDE.md` is explicit that a re-run is the fix only when the job died before any
  test body ran; here the bodies run and time out.
- **Lane A owns this** (`scripts/local-db/`, `vitest.config.ts`).

### [nutrition][app-shell] Q-323 — the calorie budget grows with activity; the macro grams under it do not

- **Branch:** `feat/macros-follow-earned-calories`
- **Added:** 2026-08-19 · Lane A/B split, the residual of Q-401 after both its halves landed.
- **What is now true.** One TDEE model: `nutrition_targets.calories` is the **rest-day floor**, and
  the zone bar renders `base + earned from movement`. So the calorie figure a user sees moves during
  the day. The **macro grams do not** — they come from the same stored row and are fixed.
- **That is deliberate for now, and it is the safer half.** Q-401's load-bearing choice was that the
  ring keeps the SET goal, because the grams beneath it are derived from that row; pointing the ring
  at a moving number while the bars stay fixed makes the card contradict itself internally, which is
  worse than the gap it would close.
- **The question this leaves.** If 300 earned kcal are added to the budget, which macro absorbs them?
  **Not protein** — it is dosed per kg of bodyweight (`PROTEIN_G_PER_KG_BY_GOAL`) and does not scale
  with a day's movement. Q-401's answer was *"the earned calories belong to carbs"*, which is
  sensible and unimplemented. Fat is currently 25% of calories, so scaling it uniformly would be a
  third answer nobody chose.
- **Do not scale all three uniformly.** That reintroduces the Q-401 shape in a new place: the ring
  and the bars disagreeing, this time within one card.
- **✅ THE PRODUCT CALL IS MADE — owner, 2026-08-19. Carbs and fat scale; protein holds.** The owner
  asked for *"%'s to calculate the protein/fat/carbs so that when it increase due to excercise; the
  macros increase as well"*, and after the arithmetic below was put in front of them, agreed to the
  amended version. **This unblocks the entry — implement it.**
  - **Protein is excluded, and the reason is arithmetic rather than taste.** It is dosed per kg of
    bodyweight (`PROTEIN_G_PER_KG_BY_GOAL`), so 150 g is ~2 g/kg. Express that as a share
    (31.6% of a 1,900 kcal base) and apply it to a 2,447 kcal day and it becomes **193 g — 2.6 g/kg**:
    a protein requirement that rises because the user went for a walk. Movement burns carbohydrate
    and fat; it does not create protein demand.
  - **Carbs take the majority and fat takes the rest, in their existing ratio.** Q-401's own answer
    was *"the earned calories belong to carbs"*, and fat sitting at 25% of calories means a
    carbs-only split makes fat's share drift downward as the day's movement grows. Splitting the
    earned kcal between carbs and fat **in the proportion they already hold to each other** keeps
    both percentages stable and needs no new constant.
  - **This resolves the "do not scale all three uniformly" warning above rather than contradicting
    it.** That warning was about the ring and the bars disagreeing inside one card. Here every
    figure moves off the same budget, so the card stays internally consistent — which is the
    property the warning was protecting.
- **Lane A** for the arithmetic (`packages/shared/src/nutrition/calorie-balance.ts`), **Lane B** for
  whatever renders it. **No longer blocked.**

**Two display changes ride with this, from the same owner review, and they are the reason the entry
is now worth doing as one piece.**

**(1) The macro ring shows its remainder in grey.** *"I'd like the macro ring to show grey to
indicate whats left."* Today the ring is a full 360° split by macro — it encodes *composition* and
says nothing about progress. Sweep the coloured arc to `eaten / budget` of the circle and leave the
remainder a neutral grey, so the same ring answers "what have I eaten" **and** "how much is left"
without a number changing. At or past the budget there is no grey and the centre flips from
`left` to `over`.

**(2) The zone bar becomes a progress bar you finish.** *"more like Red/Orange/green; all the way
like a progress bar with the green towards the end, and then a little orange/red bar after to depict
going over. So it still looks like a progress bar where you want to go to the end."*
  - The track runs **red → amber → green → amber → red** left to right, with the **green band
    immediately before the goal notch** and only a short tail beyond it. The fill grows with intake
    and takes the colour of the band it currently ends in.
  - **The overshoot tail is deliberately short** — long enough to read, short enough that it does
    not present itself as a second target to aim for.
  - **This inverts what the bar means today**, and that is the point: it currently renders fixed
    zones with a marker showing where you sit, which reads as a gauge. The owner wants something
    with an end you walk toward.
  - **Colour is not the only signal** — the remaining/over figure beside it carries the state in
    words, per the standing rule.
  - Drawn in three states (under, on target, over) during the 2026-08-19 review.

**⚠ Do this in the same PR as the Q-415 budget fix below, or the bar will fill toward the wrong
number.**

### [nutrition][app-shell] Q-415 — Home shows two calorie budgets 271 apart; Q-401's sweep missed the donut

- **Branch:** `fix/home-donut-budget-source`
- **Added:** 2026-08-19 · owner, from a Home screenshot: *"explain this widget what ars those
  nutrition numbers"*
- **Lane B** (`components/home/home-card-widget.tsx`). One expression. No schema, no route.
- **Placement: with Q-323**, whose bar and ring changes fill toward this number. Landing those
  first would draw a progress bar pointing at the wrong total.

**Measured from the owner's screenshot, and the arithmetic is the whole report.** The Home nutrition
card reads **`1458 / 2447 kcal`** and prints **"1,629 base + 547 earned from movement"** directly
underneath it. **1,629 + 547 = 2,176.** The card contradicts its own subtitle by **271 kcal**.

**Two budgets are live on one screen:**

| surface | expression | today |
|---|---|---|
| Home nutrition donut | `calorieGoal + activeEnergyKcalToday` (`home-card-widget.tsx:121-125`) | 1,900 + 547 = **2,447** |
| zone bar · Home Energy Balance · Nutrition tab | `budgetProvenance()` → `restingBaseKcal + targetNetKcal + activeKcal` | 1,629 + 547 = **2,176** |

The donut adds movement to the **stored** `calorieGoal`; everything else adds it to the **derived**
baseline. That the Energy Balance card two rows below says **"718 kcal left"** — exactly
`2,176 − 1,458` — is the confirmation: the two cards are visibly disagreeing on the same screen at
the same moment.

**This is Q-401's defect in a surface its sweep did not reach.** Q-401 retired the second TDEE model
so one baseline feeds every calorie figure, and it shipped (#175). `home-card-widget.tsx` was not
converted and still reads the stored goal. Grepped the backlog: **no entry mentions this widget**, so
it was missed rather than deferred.

**The fix.** Feed the donut the same `budgetProvenance()` total the zone bar and Energy Balance card
already use, rather than `calorieGoal + activeEnergyKcalToday`. The stored goal keeps its job as the
rest-day floor that the derived baseline is built from; it is simply not the number to render.

- **Sibling sweep, per the standing rule — do not fix only the one surface the owner photographed.**
  Grep for every other read of `calorieGoal` that renders a *displayed* budget, and convert or
  justify each in this PR. The weekly branch in the same component (`isWeekly`, `boostedGoal * 7`)
  multiplies the same wrong base by seven and needs the same treatment.
- **Check the macro grams while you are there.** They come from the stored row too; Q-323 makes them
  shares of the budget, so both entries must agree on which budget that is. **They are one PR.**
- **Verification.** On one day with movement logged, the Home donut, the Home Energy Balance card and
  the Nutrition tab must show the **same** total, and `donut total − eaten` must equal the Energy
  Balance card's "left" figure exactly. That equality is the test — it is what failed here, and it
  is checkable at a glance on the running app.

### [nutrition] Q-387 — a half-logged day is indistinguishable from a light day, and it drags the calibrated maintenance down with nothing to stop it

- **✅ THE LANE A HALF SHIPPED 2026-08-19. WHAT REMAINS IS LANE B'S: the button and the counter.**
  Done: `day_checkins.food_logging_completed_at` (migration **201**, local SQLite **v27**, both sync
  directions, `claude_ro` views **202**), `POST /api/food-logging-complete` with its Undo, and
  `estimateMaintenance` filtering on the flag instead of `intakeKcal > 0`. The partial-day case the
  module had **zero** coverage of now has five tests, plus an end-to-end pair through
  `computeEnergyBalance`. [`Journal`](overview/entries/2026-08-19-tdee-day-completeness.md).
- **⚠️ Until the button ships, the calibration cannot engage** — no day can be marked, so every day
  is excluded and `source` stays `'formula'`. That is the intended failure mode ("the estimate
  waits", not "the estimate is quietly wrong") and it costs nothing today, because per Q-302 **0 of
  the last 30 rolling windows** cleared `MIN_LOGGED_DAYS` anyway. It does mean the feature is inert
  until Lane B lands.
- **Still open — Lane B:** the *"Complete Today's Logging"* button as the last element in the day's
  scroll (not the header, not beside the ring), the copy beneath it, the receipt-with-Undo it
  becomes, and the **"N of 10 days" counter shipped with it, not after** — the button feeds
  something invisible, and that invisibility is why this bug survived. `POST /api/food-logging-complete`
  takes `{ date?, complete }` and answers `{ date, complete, completedAt }`; sending
  `complete: false` is the Undo.

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


**✅ THE CONTROL IS DECIDED — owner, 2026-08-18.** *"A button at the bottom of the log after the last
meal that says 'Complete Today's Logging'"*. That is **option 1**, the explicit marker, and it is the
one this entry recommended. Options 2 and 3 are closed: option 2 was circular by construction, and
option 3 (silent inference) cannot be corrected by the person who knows the answer.

**Where it goes and what it says.** The last element in the day's scroll, after the final meal group
— not in the header, not beside the ring. It is a statement about a day that has finished, and its
position should say so. Copy beneath it, because the reason is not guessable: *"Tells the app this
is everything you ate. Only completed days are used to work out your maintenance calories."*
Completing swaps the button for a receipt carrying an **Undo** — a day marked complete by accident
must be reversible, since the whole point is that a wrong day poisons the estimate.

**Ship the counter with it, not after it.** The button feeds something invisible today, and that
invisibility is why this bug survived: nothing on any screen said how many usable days the estimate
had. Pair it with the "N of 10 days" strip drawn on the mockup — which is also the copy Q-302 asks
for, so the two land together rather than one inventing a second version of the other.

**Wiring, in one PR:** the completeness flag is what `adaptive-tdee.ts:96` filters on, replacing the
`intakeKcal > 0` test that treats one apple as a logged day. A day with no flag is **excluded**, not
assumed complete — the failure mode has to be "the estimate waits" rather than "the estimate is
quietly wrong". Backfill is deliberately **not** attempted: past days have no flag and cannot get an
honest one, so the estimate starts from days marked after this ships and the counter shows that
plainly.

### [nutrition][app-shell] Q-406 — extract `food-row.tsx` first, so the rework has somewhere to land

- **Branch:** `refactor/nutrition-food-row`
- **Added:** 2026-08-18, split out of **Q-395** so it can start immediately and in parallel rather than
  waiting for the rework's turn in the queue.
- **Lane B.** Pure extraction — no behaviour change, no schema, no route.

- **✅ THE HEADROOM HALF IS DONE (2026-08-19, v1.325.3). THE ROW HALF IS RE-SCOPED — read the
  correction below before starting it.** `nutrition-content.tsx` is **732** and
  `saved-meals-sheet.tsx` is **753**, both well under 800, **with no new BASELINE rows**. Q-395 can
  land. [`Journal`](overview/entries/2026-08-19-nutrition-headroom.md).

**⚠ CORRECTED 2026-08-19 — the mechanism in this entry does not work, measured twice.**

**1. Extracting a food row frees ZERO lines from either landing file.** Neither contains food-row
markup. `nutrition-content.tsx` renders no rows at all — `MealCard` owns the diary row — and its
only `foodItem` references are data mapping. `saved-meals-sheet.tsx` had already delegated both its
lists, to `SavedMealCard` and `IngredientRow`. The two files are large for entirely different
reasons, so the "unblocker" could not have unblocked anything.

**What actually took them under**, and what was done instead: `AddFoodByHandForm` out of
`saved-meals-sheet.tsx` (793 → 753 — a self-contained five-field form that owned its own state) and
`useFoodLogsLoader` out of `nutrition-content.tsx` (800 → 732 — 69 lines, the file's largest and
most self-contained function, no JSX and four inputs).

**2. The four call sites are four DIFFERENT shapes, not one shape drawn four times.** Measured:
- diary (`meal-card.tsx:82`) — calories in a fixed `w-16` right column, secondary line is **coloured
  P/C/F chips**, trailing edit + delete buttons.
- library (`food-library-sheet.tsx:100`) — calories right-aligned over a serving sub-line, whole row
  is a button.
- search/db (`ingredient-search.tsx:72`) — calories **inside** the secondary line, trailing `+` icon.
- search/external (`ingredient-search.tsx:132`) — same, plus a macro-mismatch warning line and a
  spinner.

So a component covering all four **faithfully** needs a secondary-line node, a trailing slot and a
calories-placement variant — at which point it is a wrapper, not a unification. And unifying them
properly means **changing how three of the four look**, which this entry explicitly forbids
(*"Behaviour must not change… Any visual difference belongs to Q-395"*). **The row cannot be
extracted without first deciding what it should look like, and that decision is Q-395's.** Take the
row after Q-395's design pass, not before it.

**Why this was its own entry.** Q-395 could not start: both files it lands in were on the 800-line
ceiling (`nutrition-content.tsx` at exactly **800**, `saved-meals-sheet.tsx` at **793**, neither
grandfathered), so one added line failed Custom Rules. That part was right, and is now resolved.

**What to build.** One component, `components/nutrition/food-row.tsx`, with the shape used by all six
drawn screens: optional thumbnail · name · grey secondary line of *what and how much* · calories
right-aligned in a fixed column · optional chevron. Props are **scalars**, not objects — the row
renders inside `.map()` where hooks are unavailable, and an inline object literal at the call site
silently defeats `React.memo` (`meal-macro-bars.tsx` is the reference this repo already keeps for
exactly that reason).

**Then convert the existing call sites, one per commit.** A food currently reads four different ways —
diary, search, saved meal, builder. Converting them is what takes both landing files back under the
line and makes the rest of Q-395 additive rather than blocked.

- **⚠ Behaviour must not change in this entry.** It is an extraction. Any visual difference belongs to
  Q-395, and mixing them makes the diff unreviewable and the regression unattributable.
- **Done when:** ~~`node scripts/check-component-size.js` reports both files under 800 with **no new
  BASELINE rows**~~ — **met 2026-08-19** (732 and 753, no new rows). What remains is the row
  component, and its done-condition is now Q-395's: the four call sites render *the agreed* row,
  which is a visual change, not "identically to before".
- **Unblocks:** Q-395, and Q-398 which wants the same row for plan meals.

### [nutrition][app-shell] Q-395 — the nutrition surface needs a visual pass, and three of the reasons it looks unfinished are measurable

- **Branch:** `feat/nutrition-visual-uplift`
- **Added:** 2026-08-18 · owner: *"can we backlog a UI uplift for the nutrition side. I think it
  could have a bit of a design uplift"*, with screenshots of **Saved Meals** and **Edit Meal**.
- **What this entry is for.** A taste request cannot be implemented from as written, so this
  separates the part that is objectively wrong (findings 1–3, each with a CI check that already
  measures it) from the part that is genuinely a design decision (findings 4–5, which need
  mockups before code). Do the first half regardless of what is decided about the second.
- **Scope.** `app/nutrition/nutrition-content.tsx` and `components/nutrition/**` — the Nutrition
  tab, the Saved Meals sheet, the Edit Meal builder, and the meal-plan sheets that share their
  visual language. Nothing server-side: no route, no schema, no migration.

**1 — 48 hardcoded hex literals, and `#22c55e` is the one that actually breaks.**
`--brand` is **user-selectable at runtime**: `components/theme-color-picker.tsx:38` writes
`--brand`/`--color-brand` from a hue the user picks, and `app/globals.css:59-65` *darkens* the
light-mode value on purpose (the comment there says why — the vivid dark-mode green is unreadable
as light-mode text). Every `#22c55e` in nutrition opts out of both. Change the accent to blue and
nutrition's selected chips and checkboxes stay green; switch to light mode and they stay at the
value the CSS deliberately avoids. Sites: `saved-meal-card.tsx:75,97` · `my-meals-picker.tsx:226,270,276` ·
`restrictions-picker.tsx:183` · `meal-plan-edit-sheet.tsx:220` · `meal-plan-manage-sheet.tsx:173` ·
`meal-plan-setup-sheet.tsx:206,433` · `meal-plan-review-step.tsx:114,158` · `meal-plan-section.tsx:30`.
Same story for `#ef4444` where `text-destructive` already exists — `ingredient-row.tsx:52` uses the
token correctly, `saved-meal-card.tsx` and `meal-plan-manage-sheet.tsx:248,263` use the literal.

**2 — CI is already pointed at this, which is what makes it cheap.**
`scripts/check-hex-literals.js:91-103` carries **14 nutrition files** as shrink-only baselines
totalling 48 literals. Lowering those numbers *is* the deliverable for finding 1, the check proves
it, and the ratchet means a redesign structurally cannot make it worse. Do not sweep the whole repo
(471 literals) — that is a separate, much larger job.

**3 — ⚠ Both landing files are at the 800-line ceiling, and this bites on line one.**
`app/nutrition/nutrition-content.tsx` is **exactly 800** and `components/nutrition/saved-meals-sheet.tsx`
is **793**. Neither is in `scripts/check-component-size.js`'s BASELINE, so both are held to
`LIMIT = 800` hard — verified by the script's own counting, not `wc`. **Adding a single line to
`nutrition-content.tsx` fails Custom Rules.** Extraction into `components/nutrition/` children is
the first commit, not the cleanup at the end. Note the BASELINE is shrink-only: do not add these
files to it to buy room.

- **✅ FINDINGS 1 AND 2 SHIPPED 2026-08-18 (v1.324.4, Lane B).** Every `#22c55e` and `#ef4444` in
  the nutrition surface is now `brand` / `destructive`, so selected chips, checkboxes and the plan
  card follow the user's chosen accent and light mode's deliberately-darkened value. **Repo total
  471 → 428**, and **eight nutrition files came off the hex baseline entirely**, which holds them at
  zero from here — the ratchet now makes this class structurally unable to come back in those files.
  One site needed more than a swap: `meal-plan-section.tsx` passed its literal to `accentCardStyle()`,
  which needs real colour channels and **returns an accent-less card for anything that is not a hex**,
  so handing it a `var()` would have silently dropped the tint. Its gradient is now built locally with
  `color-mix` on `var(--color-brand)`, mirroring that helper's output including the `willChange` layer
  promotion.
- **Finding 3 did not bite and is still true.** Replacing literals with tokens is line-for-line, so
  nothing was added to either 800-line file — but `nutrition-content.tsx` is still exactly at the
  limit, so **the extraction is still the first commit of any change that adds a line.**

**4 — Edit Meal is three times taller than it needs to be (the design half).**
Each `IngredientRow` (`components/nutrition/ingredient-row.tsx`) stacks four bands: name + macro
line, a 44 px delete button, a 44 px −/qty/+ stepper row, and a serving-conversion hint. Two
ingredients fill the S25 screen — which is exactly what the owner's screenshot shows, with the
whole-batch total already off-screen. A five-ingredient recipe is a blind scroll. **This needs a
decision, not a fix.** Two shapes worth drawing: a compact row that reveals its stepper on tap, or
the stepper inline with the name. Do not pick one in code first.

**5 — Card metadata has an uneven rhythm.** `saved-meal-card.tsx:102,118` gate "Makes N portions"
and "· per portion" on `servings !== 1`, so the first card in the owner's screenshot carries two
lines the other two do not. The behaviour is right; the ragged card heights are the cost. A
redesign should either reserve the slot or move it into the expanded view.


**6 — MOCKUPS AND A DESIGN-SYSTEM REVIEW EXIST (2026-08-18).** The owner asked for drawn options
before code, so both screens were recreated at true S25 size from the real tokens and reviewed
against the `ui-ux-pro-max` rule set. **Canvas:**
<https://claude.ai/code/artifact/936866ab-387b-44a3-9de0-de080a8d6c3b> — nine artboards: Edit Meal
today vs proposed, Saved Meals today vs proposed, three srv/g options, a tap-target audit and the
theme finding drawn out. The three findings below came out of that review and are additional to 1–5.

**7 — Every control on both screens is 44 px. Rule 15 says 48 dp with 8 dp between.**
44 is the iOS floor, not this repo's. Measured: srv/g segments **40 px** (`ingredient-row.tsx:86`,
the smallest targets on either screen); quantity steppers, row delete and all four card actions
**44 px** (`ingredient-row.tsx:50,59,75` · `saved-meal-card.tsx:194-217` ·
`saved-meals-sheet.tsx:628,650`); stepper gap **6 px** against the 8 dp minimum
(`ingredient-row.tsx:55`). The only compliant control on either screen is `Update Meal`
(`saved-meals-sheet.tsx:774`, `h-12`). Treat this as **one systemic change**, not eight fixes.

**8 — The srv/g toggle is a hand-rolled segmented control, and `components/ui/segmented-tabs`
exists (rule 24).** `ingredient-row.tsx:81-95` rebuilds the pill-tab markup inline — the exact
pattern that was copy-pasted ~17× with drifting font sizes before the primitive was extracted.
Whichever option below wins, the control that survives comes from the primitive.

**9 — What the toggle actually is, and the three ways out.** It selects an *input mode* for a value
the row already prints both ways: `ingredient-row.tsx:100-107` always renders
`1 serving of X = 250 g · using 300 g`. It is also per-row (`unitById` in `saved-meals-sheet.tsx`),
so two rows can sit in different modes at once and `1.2` beside `60` means different things.
- **A — the unit rides on the number** (`[−] [ 60 g ▾ ] [+]`), one tap inside the field swaps it.
  **Recommended.** It removes a control rather than relocating one, the number is never bare, and
  the freed width is what pays for 48 px steppers.
- **B — grams only**, the stepper stepping by one serving. No mode at all, but you can no longer
  *type* "2 scoops" — the exact case `ingredient-row.tsx`'s own comment says both units exist for.
- **C — the toggle moves below the value row** at full size. No behaviour change, safest, and the
  tallest of the three, which works against the density complaint that started this.

**10 — ⚠ `#22c55e` is ALSO the literal value of `MACRO_COLORS.protein`.** A find-and-replace of that
string onto `var(--brand)` would repaint the protein macro with whatever accent the user picked.
The selection-state literals and the macro palette are the same eight characters and must not share
a fate — finding 1 is the former only.


**19 — Owner answers, 2026-08-18 (asked as four blocking questions).**
- **Scope of the design pass:** *"the full work through; the nutrition tab; and all features from
  logging food - to creating a meal to editing a meal."* Sixteen screens are now drawn end to end.
- **Targets stay in Profile, with a shortcut.** `components/profile/macro-targets-pane.tsx` keeps
  ownership; Nutrition Settings gets a row that jumps to it. They are profile-level facts like
  weight, and moving them is churn — but editing them two tabs from where they are judged is the
  friction the shortcut removes.
- **"Complete Today's Logging" is a button at the foot of the day's log** — see **Q-387**, where the
  decision and its wiring live.
- **The meal plan becomes a generator of saved meals** — see **Q-398**.

**11 — THE DIRECTION IS SETTLED, AND IT IS BIGGER THAN A VISUAL PASS (2026-08-18).** The owner sent
MyFitnessPal screenshots and asked for a rework that reads as naturally. Six screens are drawn at
true S25 size in our own tokens — **canvas page "Reworked screens"**,
<https://claude.ai/code/artifact/936866ab-387b-44a3-9de0-de080a8d6c3b>: the day, add food, my meals,
meal detail, edit meal, and the quantity sheet. What was borrowed is **structural, not visual** —
none of the chrome, colour or type is copied.

**12 — The root cause of "bulky" is that a list row carries an editor.** Findings 7–9 treated the
srv/g control as the problem; it is a symptom. Mainstream food loggers put **no controls on a list
row at all** — row is name, a grey line of what and how much, calories right-aligned — and every
quantity edit happens on a separate surface. Our `IngredientRow` instead replicates a delete
button, a stepper, a value field, a unit toggle and a conversion hint onto *every* ingredient. Two
ingredients fill the S25 screen; the drawn version fits five with room left over.
**This supersedes srv/g options A, B and C** as a fork: the toggle now appears once, in the quantity
sheet, at 56 px. Option A's shape (unit chip on the number) is what that sheet uses.

**13 — One row component, six call sites.** Today a food reads one way in the diary, another in
search, another in a saved meal, another in the builder — four shapes for one thing. The drawings
use exactly one: optional thumbnail · name · grey secondary line · calories right-aligned in a fixed
column · optional chevron. Build it as `components/nutrition/food-row.tsx` and use it on all six
screens; per the repo's own reuse rule a pattern at ≥2 sites gets extracted before the third copy,
and this is the sixth.

**14 — The other structural changes, in the order they pay off.**
- **The macro summary becomes a donut with each macro as a share of calories**, next to grams.
  `components/nutrition/macro-ring.tsx` already exists — extend it rather than adding a second one.
- **Grouped sections with full-bleed dividers** replace gapped cards, which is most of the vertical
  space the day screen currently spends on nothing.
- **Source tabs on the food picker** (Recent · Frequent · My meals · Recipes) replace separate
  sheets, so a repeat log is one tap from the top of the list.
- **The meal name becomes the screen title**, not a labelled input box, and the three-line batch
  explainer becomes a subtitle: *"Makes 2 portions · 278 kcal each"*.
- **Destructive actions leave the summary row** — delete lives in the quantity sheet and behind a
  swipe on a saved meal, not beside the button pressed daily.

- **⚠ Sequencing.** This is a rework, not a repaint, and it lands in the two files that are already
  at the 800-line ceiling (finding 3). Order: extract `food-row.tsx` first, then the quantity sheet,
  then convert screens one at a time behind the existing behaviour. **Do not start by editing
  `nutrition-content.tsx`** — one added line fails Custom Rules.
- **The known cost, stated so it is not discovered late:** changing a quantity now takes a tap. For
  a saved meal built once and logged for months that is cheap; for someone tweaking amounts while
  assembling, inline steppers were faster. The owner has seen this trade drawn and chose the rework
  anyway.
- **Related:** meal thumbnails are **Q-396**, filed separately because they need a migration and a
  sync-payload change (Lane A) while everything above is Lane B.


**15 — OWNER REVIEW OF THE MOCKUPS, 2026-08-18. Six notes, all folded in; one caught a real gap.**
- **Ring:** use the shipped `MacroRing` (96 px masked conic + value/target bars), not a new donut —
  with the filled arc **split by macro** instead of a single `var(--brand)` sweep. Do not add a
  second ring component.
- **Log Food is one screen.** The current capture step's six scattered entry points collapse to:
  search across everything · tabs · a bottom row of capture actions. **Both were revised by the
  owner on 2026-08-19 and the revision wins over this line** — the tabs are **Recent · My Foods**
  (see note 17), and the action row is ordered **Photo · Barcode · Describe or enter**, in that
  order, not the Barcode-first order originally drawn. The order is the owner's; it is also the
  right default, since photo is the fastest path for a plated meal and barcode only works on
  packaged food.
- **Describe and manual entry become one sheet.** Type what you ate and the fields fill in; skip the
  box and type them yourself. The fields are always visible, so neither path is a hidden mode.
- **My Meals rows carry their macro split** (P/C/F beside the calorie column) so the list can be
  chosen from. The label/QR and the full breakdown stay **inside** the meal on the detail screen.
- **Edit Meal keeps a real servings control** — "This recipe makes [− 2 portions +]" at 48 px, in a
  band that also states the per-portion cost. It had been demoted to a subtitle; that was wrong.
- **The quantity sheet must show where it came from:** the tapped ingredient row stays lit under the
  scrim and the sheet is headed "Ingredient 1 of 5 · <meal>". Without that the sheet reads as an
  unrelated screen.

**16 — ⚠ THE COVERAGE AUDIT THE OWNER ASKED FOR, AND WHAT IT FOUND.** *"Make sure you compare each
page/section to what's in prod right now — we don't want to silently lose any sections."* The first
draw showed **3 of the 11 sections** the Nutrition tab actually renders. In shipped order
(`app/nutrition/nutrition-content.tsx`): ScreenHeader + date nav · **CalorieBalanceBar** ·
MacroRing · **NutritionActionRow (three buttons — Saved Meals had been dropped)** ·
**MealPlanReviewCard** · **MealPlanSection** · **TdeeAdaptationCard** · MealCard × meal types ·
**End of Day** · **WeeklyNutritionChart** · **SupplementsSection**. The eight in bold were missing
and are now drawn. **Any implementation PR carries this list and checks it off** — a rework that
quietly loses a section is the failure mode this entry exists to prevent.

**17 — DECIDED 2026-08-19, and it went further than the question asked. The tabs are `Recent` and
`My Foods`. Two, not four.** The question here was where to put `My Foods`; the owner answered by
collapsing the row: ***"I Think recent tab is fine; dont think we need frequent - saved and myfoods
I dont think need to be seperated. Saved could contain foods made or saved. Maybe we just have 'my
foods'"***.
- **`Frequent` is dropped.** It was a second ordering of the same list Recent already shows.
- **`Saved meals` and `My Foods` merge into one `My Foods` list** holding anything the user made or
  saved. This is the right call for a reason worth writing down: a saved meal and a food you built
  were always the same kind of row wearing two labels, which is exactly what finding 13's single
  row component says. Two lists that render identically and differ only in provenance are one list
  with a subtitle.
- **Nothing is lost, and check that before building.** `FoodLibrarySheet` and `SavedMealsSheet` are
  separate components today; merging the tabs must not silently drop a capability that only one of
  them has (bulk delete, meal-plan linkage, the label path). Diff them first and carry every action
  across, or say in the PR which was intentionally dropped.
- Ordering within `My Foods`: most recently used first, so the merge does not bury saved meals under
  one-off foods.
- **⚠ The merge is a RENAME as well as a merge, and the rename has to be swept.** The owner spotted
  the half-done version immediately — *"So im picking up a discrepancy between My Meals and My
  foods? Whats the difference"* — against a prototype that still had a `My Meals` screen beside a
  `My Foods` tab. There is no difference, and that is the point: **two names for one list is the
  defect**. Grep for every user-facing occurrence of *Saved meals*, *My Meals* and *My Foods* —
  sheet titles, tab labels, empty states, toasts, the `+ Add food` destinations, the nav copy — and
  land on the single name in one pass. A surface left on the old name reads as a second list that
  is missing rows.

**18 — Sheets not yet drawn, listed so they are not assumed done.** `FoodLoggerSheet` review and
assign steps (only capture is drawn) · `QuickEditLogSheet` · `WaterLogSheet` · `FoodLibrarySheet` ·
`MealTypeManager` and the Nutrition Settings sheet · `MealPlanSetupSheet`/`EditSheet`/`ManageSheet` ·
`ManageSupplementsSheet` · `EndOfDayReview` and its seven children · the barcode overlay · the
delete-log dialog. Roughly eleven more surfaces. They inherit the row language and the 48 dp floor
whether or not anyone draws them first.

**What NOT to change — all three exist because a CLAUDE.md rule required them:**
- `MACRO_COLORS` (`@trainingai/shared/nutrition/macro-colors`) is the shared semantic palette,
  correctly imported at every site. It is **not** finding 1 and must not be tokenised away.
- `saved-meal-card.tsx` is well built: `role="button"` + `aria-expanded` (`:80-82`) for the
  nested-control WebView rule, macro colour always paired with its P/C/F label (`:130-142`) for the
  colour-only-state rule, and an inline delete confirmation (`:172+`). A visual pass keeps all three.
- No new dependencies — `motion` v12, `@use-gesture/react` and shadcn primitives are installed.

- **DECIDED BY THE OWNER, 2026-08-19 — the ingredient row is unblocked.** Both open questions were
  answered in one reply: ***"go with A, and yes collapse the row when not editing"***.
  1. **Option A wins** — the unit rides on the number as a chip inside the field, `60 g` ⇄ `2 srv`
     on one tap. B and C are dead; do not revisit them. The control comes from
     `components/ui/segmented-tabs`, not a fourth hand-rolled segmented control (finding 8).
  2. **Rows collapse when not being edited**, one expanded at a time. The collapsed shape is
     finding 13's single row component — name · grey secondary line · calories right-aligned ·
     chevron — so this is not a second component, it is `food-row.tsx` with an expanded state.
  **Read this together with finding 12, which is not contradicted by it.** Finding 12 retired A/B/C
  *as a fork over what sits on a list row*, because the answer there is **nothing** — a diary or
  search row carries no editor and never expands. What the owner has now chosen is the shape of the
  quantity control **wherever it does appear**: the quantity sheet, and the expanded row in Edit
  Meal, which is a builder rather than a list. Finding 12 already anticipated this
  (*"Option A's shape (unit chip on the number) is what that sheet uses"*), so the decision confirms
  it rather than reopening it. **A row in the diary that expands to edit would be a
  misreading of both.**
- **The drawings exist** (finding 6); `unit-options.png`'s column A is the reference for the
  expanded row, and its `Full Cream Milk` row is the reference for the collapsed one. Findings 1, 2,
  3, 7 and 8 never depended on this answer and can still go first — but nothing is blocked now.
- **Still open, and deliberately not blocking: where `My Foods` lives** (note 17). Recommendation
  stands — a **fourth tab** beside Recent, Frequent and Saved meals, because it is a list of foods
  like the other three and a tab is where someone looks for it. Build it that way unless the owner
  says otherwise; it is one line to move later.
- **Lane B** — `components/nutrition/**` and `app/nutrition/**` are both Lane B's under §3, and
  nothing here touches an engine path.
- **Read first:** [`docs/domains/nutrition/README.md`](domains/nutrition/README.md), then the
  `ui-ux-pro-max` skill — it is this repo's own design system and the authority for this item.
- **Verification.** `node scripts/check-hex-literals.js` must report a **lower** number for every
  file touched; `node scripts/check-component-size.js` clean without new BASELINE rows;
  `pnpm check:rules`. Then the **on-device smoke run** — this is pure UI on the canonical runtime,
  in both themes, so a green `pnpm dev` is not sufficient evidence and a Known-Issues row is the
  fallback if no device is available.

### [nutrition] Q-398 — the meal plan should produce saved meals and then get out of the way

- **Branch:** `feat/meal-plan-to-saved-meals`
- **Added:** 2026-08-18 · owner, asked how much the meal plan is really used: *"The meal plan wont be
  used too much; it will be created - then likely not used again. It would be good if each item from
  the Meal plan was saved as a 'saved Meal' with its own QR code - so a good spot to combine these
  sections."*
- **Lane B** for the UI. **Lane A** if the plan→meal copy needs a column or a sync change — check
  before starting, and hand that half over rather than taking a migration number.

**What this replaces.** The meal plan is five surfaces — `meal-plan-section`, `meal-plan-review-card`,
`meal-plan-setup-sheet`, `meal-plan-edit-sheet`, `meal-plan-manage-sheet` — plus its own row shape,
its own staleness banner and its own editing model. All of it exists to maintain a thing the owner
builds once and then stops opening. That is a lot of surface earning very little.

**The reframe, and it is the owner's:** a plan is not somewhere you live, it is a **batch generator**.
Each meal it produces gets a **Save** action; saved, it becomes an ordinary `saved_meals` row and
inherits everything that already works — the detail screen, the macro split, the printable label and
its QR, logging in one tap. The plan can then be discarded without losing anything worth keeping.

**What to build.**
1. **A `Save` action per plan meal, and a `Save all N`.** Saving writes `saved_meals` +
   `saved_meal_items` from the plan's own items — the same rows the meal builder writes, so there is
   exactly one representation of a meal in the app. A saved row shows its QR affordance in place of
   the Save button, which is also how you see at a glance what you have already kept.
2. **A `plan` tag on the resulting My Meals row**, so provenance is visible and nothing else about
   the row is special.
3. **Then delete surface, do not add it.** Once meals live in My Meals, `meal-plan-section` on the
   day screen and `meal-plan-review-card`'s staleness nag have no job — the plan is not a live thing
   to keep fresh any more. **Confirm that with the owner before removing anything**; this entry
   proposes the reduction, it does not authorise it.

- **⚠ Do not merge the two data models.** `saved_meals` is the destination, the plan stays its own
  tables. Copy on save; never make a plan row and a meal row the same record. A plan is a schedule of
  suggestions and a saved meal is a recipe you own — collapsing them means editing a saved meal
  silently rewrites a plan, or deleting a plan takes your meals with it.
- **Idempotence matters more than it looks.** "Save all" pressed twice must not produce nine
  duplicates. Key the copy on `(plan id, plan item id)` and make a repeat save a no-op that reports
  what already existed.
- **Verification:** save one plan meal, then prove the resulting row logs, prints a label, and that
  the label's QR scans back to it — the whole claim of this entry is that a plan meal becomes
  indistinguishable from a hand-built one, so the label path is the test that proves it.

### [nutrition][platform] Q-407 — the meal-plan wizard is seven screens for six answers, and the one piece the Coach lacks is multi-select

- **Branch:** `feat/nutrition-coach-meal-plan`
- **Added:** 2026-08-19 · BugFix Intake, from the owner · mockup rendered in-session
- **Placement:** in the nutrition cluster, after Q-398. It **depends on Q-398**: the plan's exit
  route in this design is "Save all as meals", and until plan meals can become ordinary saved
  meals, a conversational plan has nowhere to land and is only a nicer-looking dead end.
- **Owner's words:** *"lets get the meal plan setup wizard mocked up too -> This could use some
  work - its too step by step - Could we try implement this into an AI coach/meal builder type
  thing? Where it feels like a chat with a UI? Also there should be options for 'select all' as I
  keep clicking each grocery store."* and, on the mockup, *"This looks really good - I'd like to
  see that in prod"*.

- **What it is today.** `components/nutrition/meal-plan-setup-sheet.tsx` (445 lines) is a linear
  stepper: `const STEPS = ['Stores', 'Avoid', 'Skip', 'Meals', 'Yours', 'Training', 'Review']`
  (line 28), seven screens holding thirteen `useState` fields, with a fixed footer per step. It
  works, and the docstring's reason for the stepped shape is sound (a fixed action row that never
  scrolls away, and `SheetFooter` owning the bottom inset — this repo's most repeated on-device
  regression). **Keep that property.** The problem is not the footer, it is that six of the seven
  screens ask a question the app can mostly answer itself, and none of them can be skipped.

- **Three of the four pieces already exist, which is why this is smaller than it sounds.**
  - `lib/coach/widgets.ts` is a **union of client-side tool schemas**, explicitly documented as the
    extension point: *"Adding a widget means adding a member here and a row in
    `components/coach/widget-registry.tsx`. The union is the extension point; the protocol does not
    change."*
  - `CHOICE_SOURCES` (`['sessions','exercises','swap_candidates']`) is the **server-fills-the-list**
    mechanism, and its docstring is already the token argument the owner is asking for: a
    nine-option picker the model typed out cost **~554 output tokens**, and *"having a language
    model re-type it is paying to transcribe your own database"*. `app/api/coach/options/route.ts`
    is where a source is resolved.
  - `HandoffSchema` routes to real screens (`destination: 'program_builder' | 'log_activity' |
    'profile' | 'nutrition'`), so a conversation that must hand off to a full screen has a route.

- **The one genuine gap: `choice_list` is single-select, and that is exactly the owner's complaint.**
  `ChoiceListSchema` (lib/coach/widgets.ts) has `prompt`, `source`, `sourceId`, `options[]` — **no
  multi flag** — and `ChoiceList`'s callback is `onChoose?: (option: { id, label }) => void`, one
  option, singular. There is no configuration that makes it multi-select. So "I keep clicking each
  grocery store" is not a missing convenience on top of a multi-select; the widget has never had
  one. **Extend the schema rather than adding a second widget:**
  - add `multi?: boolean` and `selectAll?: boolean` to `ChoiceListSchema`, defaulting false so
    every existing call site is unchanged;
  - `ChoiceList` gains checkbox rows, a "Select all" row (with an `n of m` count) and a Continue
    button, resolving to a **list** of options;
  - **flat, not a discriminated union** — the schema's own comment says why: *"Gemini's
    function-declaration schema is fussy about unions, and this feature has already lost a day to
    one (`z.literal(false)`)."* Do not model this as a union of single/multi variants.
  - `MAX_VISIBLE_ROWS = 6` already scrolls the list; six stores fit, so no change needed there, but
    check the Continue button is inside the widget and not below the scroll region.

- **The stores list is the reference case for the token saving.** `STORES` is a hardcoded curated
  six-item AU list in the component (line 21) with a docstring saying it is deliberate. The coach
  must **never type those six names** — add a `grocery_stores` source to `CHOICE_SOURCES` and serve
  it from `app/api/coach/options/route.ts` alongside the existing three. Same for the ingredient
  lists (`PROTEINS`, `CARBS`, `FATS`, `VEG` — 32 more strings) and the dietary-restriction
  catalogue, which is already an API (`/api/nutrition/dietary-restrictions`). **Every one of those
  is a string the model would otherwise generate and the app already holds.**

- **The conversation shape (from the mockup).** Three things, in order:
  1. **Answers are widgets.** Stores as the new multi-select with Select all; restrictions as chips.
     The coach **states what it already knows instead of asking** — *"I already know you log dairy
     most days, so I have left it in"* — which is both the token saving and the better manner. The
     seven steps become at most three exchanges, and any of them can be typed past instead of
     tapped.
  2. **The plan arrives as a widget, not prose.** A card listing each meal with its calories and
     item count, plus **Save all as meals** (Q-398) and Redo. The plan is then disposable, because
     the meals outlive it.
  3. Entering from the Nutrition tab starts you **inside the nutrition scope**. **Scope it by giving
     the coach a tool subset, not by instructing it** — a prompt that says "do not read workout
     data" is a request the model will occasionally ignore, while a tool it never receives is a
     boundary it cannot cross. **Make that subset a named record** (prompt section + tool subset +
     patch domains + widget sources) rather than an inline filter, so a second coach can have one
     without a refactor. That one line is all that survives of Q-408 — see the note below.

- **Q-408 was descoped into the line above, 2026-08-19, on the owner's call.** It proposed the full
  architecture from the owner's original message: Home as an "AI Coach" routing to scoped Nutrition,
  Workout and Goal specialists. **Removed rather than deferred, for three reasons worth keeping so
  nobody re-files it unexamined:**
  1. **It is a router for one destination.** There is one coach. Routing has value when it picks
     between coaches, and every decision in that design would have been made against imagined
     requirements until a real second coach exists.
  2. **Its hardest problem argues against it.** The owner's own example — *"what should I eat before
     tomorrow's legs session?"* — is nutrition **and** workout. A strict boundary breaks it, so the
     architecture's central question was never how to separate the coaches but how to let them talk
     anyway, which is a harder problem than the one that motivated it.
  3. **The token argument does not survive contact with Q-170's measurement.** Latency is almost
     entirely *output* tokens; a shorter per-scope system prompt saves *input* tokens, which are not
     the bottleneck. And inlining more prompt context was measured **twice** and made things worse.
     The real saving — naming a `source` and letting the server fill the list — already exists as
     `CHOICE_SOURCES` and is already in this entry.
  **Reversal cost is nil.** If a second coach earns its place, write the architecture then, against
  real requirements. The named-record shape above is what keeps that cheap.

- **OWNER REVIEW OF THE PROTOTYPE, 2026-08-19 — the plan must end by writing meals, and that is not
  optional polish.** ***"Meal plan coach needs more work - I want it to make the meal plan; then add
  each item to the saved meals/my foods"***. The conversation is not finished when it prints a plan;
  it is finished when **every meal in the plan exists as a row in `My Foods`**, indistinguishable
  from one built by hand — loggable, editable, and with its own printable label.
  - **This makes Q-398 a hard prerequisite rather than a related item.** Q-398 is the write path
    (plan meal → saved meal, keyed on `(plan id, plan item id)` so a repeat save is a no-op). Without
    it there is nothing for the widget's button to call, and a coach that produces an un-saveable
    plan is the same dead end the stepper already is.
  - **The plan is disposable once its meals are saved**, and the copy should say so. That is the
    whole reason this beats a plan document: the user keeps meals, not a plan.
  - The prototype demonstrates the loop end-to-end (tap *Save all to My Foods*, then find the four
    meals under `My Foods` tagged *from your plan*) —
    <https://claude.ai/code/artifact/4fc7f99e-71f3-442c-b88b-1bb83b5fa9d6>.

- **Do not delete the stepper in this PR.** The wizard is a working flow the owner uses; ship the
  conversation as the path behind the same entry point and keep the stepped sheet reachable until
  the conversation has been used on-device for a plan the owner actually keeps. A conversational
  flow that stalls mid-plan with no fallback is strictly worse than seven screens that finish.

- **Lane.** Split, and **`lib/coach/**` belongs to neither lane's declared paths** — whoever takes
  it claims that path in their baton first (`docs/agents/README.md` §"A path neither lane lists").
  `lib/coach/widgets.ts` + `app/api/coach/options/route.ts` + `app/api/coach/route.ts` (the SYSTEM
  prompt's widget rules, lines 27–59) are **Lane A**; `components/coach/choice-list.tsx`,
  `components/coach/widget-registry.tsx` and `components/nutrition/meal-plan-setup-sheet.tsx` are
  **Lane B**. The schema change lands first — the component cannot render a flag the schema does
  not carry.

- **Verification.** The multi-select half is testable in the sandbox: a widget rendered with
  `multi: true` returns every checked id, Select all toggles all six, and an existing single-select
  call site still resolves to one option (that regression is the actual risk). The **conversation
  half is not** — it needs a real Gemini turn, so run one plan end-to-end against `pnpm dev` and
  say plainly that the on-device pass (safe-area under the composer, the widget inside a scrolling
  thread) was not exercised unless it was.

### [nutrition][platform] Q-409 — paste a recipe URL and get a meal; the fetch is the whole security surface

> **⚠️ The Lane A half SHIPPED (PR #180). What is left is Lane B only** — the UI in
> `components/nutrition/my-meals-picker.tsx` that sends a `url` and renders what comes back.
> `POST /api/nutrition/scan` now takes `{ url }`, answering with the ordinary scan payload plus
> **`sourceUrl`** (the final URL after redirects — that is the attribution this entry asked for) and
> **`recipeYield`** (servings, or **`null`**).
>
> **`recipeYield: null` is the one thing Lane B must handle, and it is not cosmetic.** With a stated
> yield the route has already divided and the payload is per-serving (`notes` leads with *"Per
> serving (1 of 12)."*). Without one the payload is the **whole recipe** — verified live: a
> banana-bread page returned 1,956 kcal for the loaf. This entry's own rule applies — *ask, do not
> assume 1* — so the picker must prompt for serves and divide, or it logs a tray as a meal.
>
> Rationale, measurements and the SSRF verification are in
> [`entries/2026-08-19-recipe-url-to-meal.md`](overview/entries/2026-08-19-recipe-url-to-meal.md);
> the modules are in [`module-map.md`](module-map.md). Everything below is the original entry.

- **Branch:** `feat/recipe-url-to-meal`
- **Added:** 2026-08-19 · BugFix Intake, from the owner
- **Placement:** in the nutrition cluster, immediately after Q-407 — it extends the same step, and
  in the conversational shape it is one more thing you can hand the coach. It does **not** depend on
  Q-407: the stepper's "Yours" step can take a URL today, and shipping it there first is fine.
- **Owner's words:** *"when making the meal plan; I should be able to link recipe websites/urls and
  it create a meal from it. So in the section where it asks any meals you want to add - I'd like
  that ability too."*

- **Where it goes.** `components/nutrition/my-meals-picker.tsx` — the "Meals you already eat" step
  (`STEPS[4] = 'Yours'`). It already takes free text, POSTs it to `/api/nutrition/scan` (line 95),
  and stores the result as a `TypedMeal { text, name, ingredients, looking, failed, keep }`. **A
  URL is a third input mode alongside image and text, resolving to the same shape**, so the widget,
  the `keep` semantics and the downstream plan payload need no change at all. That is why this is a
  small feature and not a new subsystem.

- **`/api/nutrition/scan` is the route to extend, not a new one.** It already runs
  `generateObject` against `ScanSchema` (`identified` + `ingredients[]`), is rate-limited
  (`rateLimit(\`${userId}:nutrition-scan\`, 10, 60_000)`), caps its text input at 500 chars with a
  control-character strip, and sets `maxRetries: 0`. Add a `url` branch beside `image` and `text`.
  **Match the existing branches' discipline** — a new branch that skips the cap or the rate limit
  reintroduces what the other two already handle.

- **The fetch is the part that can go wrong, and it is not a detail.** This is the app's first
  server-side fetch of a **user-supplied URL**, which is a server-side request forgery surface: the
  server sits on Railway's private network with the database on it. CLAUDE.md's rule is that
  security checks **fail closed**. Concretely:
  - **Allow `https:` only.** Reject `http:`, and reject every other scheme outright — `file:`,
    `gopher:`, `data:`. Scheme-checking by prefix string is not enough; parse with `new URL()` and
    compare `protocol`.
  - **Resolve the host and reject private/loopback/link-local ranges before connecting** —
    `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (cloud metadata), `::1`, and the
    IPv6 unique-local range. Rejecting on the *hostname* is not sufficient: a public name can
    resolve to a private address.
  - **Do not follow redirects blindly.** A permitted URL that 302s to `169.254.169.254` defeats
    every check above. Either set `redirect: 'manual'` and re-validate each hop, or cap at zero
    hops and tell the user.
  - **Bound the response**: a timeout (a few seconds), a byte cap, and a content-type check for
    HTML. An unbounded read of an attacker-chosen URL is Q-322/Q-498's class in a new place.
  - **Never surface the fetch error verbatim** — Q-320 is exactly this leak (`e.message` as a 500
    body). "Could not read that page" is the whole message.

- **Parse before you prompt, because most recipe sites hand you the answer.** Recipe pages very
  commonly carry schema.org `Recipe` JSON-LD (`<script type="application/ld+json">`) with
  `recipeIngredient[]`, `recipeYield` and sometimes `nutrition`. **Read that first and only fall
  back to the model when it is absent** — it is free, exact, and it gives real serving counts,
  which the owner has already asked for elsewhere (Q-395's "how many serves" note). When falling
  back, send the extracted **text**, never the raw HTML: page markup is both enormous and
  attacker-controlled, and the existing text branch's 500-char cap exists for that reason. Treat
  page content as untrusted input to the prompt, not as instructions.

- **`recipeYield` is the field that makes this useful.** A recipe is *n* servings; a meal is one.
  Divide the ingredient quantities by the yield and say so in the UI ("from a 4-serve recipe"),
  because silently importing a whole tray as one meal is a 4× calorie error that looks plausible.
  If the yield is missing, ask rather than assume 1.

- **Attribution.** Store the source URL on the resulting meal and show it. It tells the owner where
  a meal came from six months later, and it is the honest thing to do with someone else's recipe.

- **Lane.** `app/api/nutrition/scan/route.ts` and any shared parser are **Lane A**;
  `components/nutrition/my-meals-picker.tsx` is **Lane B**. The route branch lands first — **it has
  (PR #180), so only Lane B remains.**

- **Verification.** Paste three real recipe URLs — one with JSON-LD, one without, one that 404s —
  and confirm: ingredients and yield resolve from the structured path; the fallback produces a
  sane estimate; and the failure shows a message rather than a stack. **Then prove the SSRF
  guards by test, not by reading the code**: `http://`, `file:///etc/passwd`,
  `https://127.0.0.1`, a URL that redirects to a private address, and an oversized response must
  each be rejected. Those five cases are the acceptance criteria for this entry — the feature is
  the easy half.

### [nutrition][platform] Q-396 — a photo per saved meal, and the size cap is the whole design

- **Branch:** `feat/saved-meal-thumbnail`
- **Added:** 2026-08-18 · owner: *"can we have base64 saved images of meals? small icons?"*, while
  reviewing the Q-395 rework — a meal you built weeks ago is hard to recognise from its name alone.
- **Lane A.** Needs a Postgres migration, a local SQLite column and a sync-payload change. The Q-395
  rework it serves is Lane B; the two can land independently because the UI degrades to no image.

**The precedent exists and does not transfer.** `users.avatar` stores a **full `data:` URI in a text
column**, validated by MIME whitelist and capped at **5 MB**
(`app/api/user/avatar/route.ts:34-45`). That works because an avatar is **one row per user and is
never in the sync delta**. A meal thumbnail is one per saved meal, and saved meals sync — so every
image rides the outbox push, the pull delta, and the on-device SQLite mirror, on a phone, forever.
Copying the 5 MB cap here would be the largest single regression the sync engine has ever taken.

**Recommendation — a hard-capped thumbnail, stored as a data URI.**
- **128 × 128 WebP, target ~6 KB, reject over 16 KB.** Downscale on-device with a canvas *before it
  leaves the client*, and re-validate server-side — a client-side cap alone is not a cap. At 6 KB,
  100 saved meals is ~600 KB across the whole sync surface, which is the same order as the text
  already moving.
- **Why base64 in a text column and not object storage:** the app is offline-first and has no blob
  host. A URL renders nothing in airplane mode, which breaks the standing rule that *a local table
  must hold everything needed to render the row offline*. A capped data URI is the only shape that
  survives the canonical runtime. This is the rare case where the "obviously wrong" storage choice
  is the right one, and the cap is what makes it so — **do not relax it later without re-reading
  this paragraph**.
- **What it costs if the cap slips:** nothing fails loudly. The outbox gets slower, the local DB
  grows, and the first symptom is a sync that times out on a bad connection. Put the byte cap in a
  named constant next to the column, not inline in the route.

**Where the upload lives — unspecified until now, and asked for on 2026-08-19.** The owner, looking
at the prototype: *"Edit meal doesnt contain an image upload seciton; did we agree on this? with a
base64 small DB? Ideally stored locally"*. The storage answer is yes and it is above — base64 data
URI, on the device, which is what "stored locally" means here and is the whole reason it is not a
URL. What this entry never said is **which screen uploads it**. Recommendation: a **64 px tile to
the left of the meal-name field in Edit Meal**, tapping to camera/gallery, long-press or a clear
action to remove. Reasons: Edit Meal already owns the meal and already saves it, so the image rides
the existing write rather than needing its own; and the tile doubles as the preview, so there is no
separate "current photo" row. Drawn in the prototype at
<https://claude.ai/code/artifact/4fc7f99e-71f3-442c-b88b-1bb83b5fa9d6> (screen 4, tap the tile).
**Show the byte size on the tile after a pick** — this entry's whole risk is the cap slipping, and a
number the user can see is the cheapest possible tripwire.

**The zero-cost alternative, worth shipping first if this slips.** No photo at all: a Lucide glyph
on a tinted tile, keyed off the meal's dominant macro or its meal type. No migration, no sync
weight, no upload path — and it already carries most of the recognition benefit in the drawings,
where every thumbnail is exactly that placeholder. If the photo work is deferred, ship this and the
Q-395 rows still look finished.

**The full chain this has to touch, per the offline-sync rule — all in one PR:**
`saved_meals` column → the web route's Zod schema → the `pushMutations` branch → `getSyncDelta`
output → `pullDelta` mapping → `applyDelta` upsert columns → the local SQLite migration → **and its
row in `RECONCILE_TABLES`/`RECONCILE_COLUMNS`**, which is the one most often missed and the one that
silently breaks upgraded devices while every test and fresh install passes.

- **Verification.** Not "it saved" — prove a non-null value **round-trips to the device and renders
  with the network off**, which is the only test that distinguishes this from a URL. Then check the
  outbox still drains on a throttled connection with a dozen meals carrying images.
- **Not in scope:** photos on individual food items or on logged entries. One image per *saved
  meal*, which is the surface the owner asked about and the only one where the row is durable.

### [workouts][platform] Q-405 — a Coach swap silently inherits the old exercise's role, and the role sets the loading

- **Branch:** `feat/coach-swap-role-prompt`
- **Added:** 2026-08-18 · owner, after swapping Barbell Romanian Deadlift → Barbell Jefferson Curl:
  *"it should ask what role the exercise should be with a recommendation; this changed from RDL →
  Jefferson; and it looks like it took the 'secondary' role rather than accessory."*
- **Lane A** — `lib/coach/domains/session-exercise.ts` is the write path. The picker UI half is Lane B
  if one is added; check before starting.

**Confirmed: the swap never touches the role.** `session_exercises.exercise_role` is
`'primary' | 'secondary' | 'accessory'` (`schema.ts:132`, default `'primary'`), and
`lib/coach/domains/session-exercise.ts` contains **no reference to it** — grep returns nothing. The row
keeps whatever the outgoing exercise had, so RDL's `secondary` carried straight onto Jefferson Curl.

**This is not a badge problem.** Role selects the progression style —
`resolveStyleForExercise(program, phase, { exerciseRole })` — so it decides the prescribed percentages
and sets. In the owner's screenshot the inherited role prescribed **60 kg × 6 at 80%** for a
Jefferson Curl: a heavy secondary loading pattern on a slow spinal-flexion movement that is normally
loaded light. **A wrong role is a wrong prescription, on a movement where that carries injury risk.**

**What to build.**
1. **Ask, with a recommendation pre-selected** — the owner's words. Three options, the suggested one
   already chosen, so the common case is one confirm rather than a decision.
2. **Where the recommendation comes from, in order of preference:** the incoming exercise's own entry
   in `exercise_library` if it carries a default role; otherwise its muscle groups and equipment
   (a compound barbell lift on a primary mover → primary/secondary; an isolation or mobility movement
   → accessory). **Do not ask the model to invent it** — a guessed role feeds a real prescription, and
   CLAUDE.md is explicit that no LLM self-reported value may gate an automatic action.
3. **Never silently inherit.** If no recommendation can be derived, ask without a pre-selection rather
   than defaulting to the outgoing role — inheriting is what produced this.

- **Sibling sweep:** the same silent inheritance applies to any other path that replaces an exercise in
  a session. Grep for writers of `exercise_role` before calling this done; the Coach may not be the
  only one.
- **Related, and worth doing together:** **Q-403** — the same swap flow calls an applied change a
  "proposal" and says so after the fact. Both are about the swap telling the user what it actually did.
- **Verification:** swap a compound for an isolation movement and confirm the role prompt appears, the
  recommendation is sensible, and the prescribed sets change to match the chosen role — the last part
  is the one that proves the fix reached the thing that matters.

### [platform] Q-404 — the Sentry SDK was deliberately deferred and never queued, so nothing was going to wire it

- **Branch:** `feat/wire-sentry-sdk`
- **Added:** 2026-08-18, after the owner got Sentry's *"no errors are coming through yet"* email and
  asked whether it was set up. It is not — and the reason is documented, but **only in a handoff.**
- **Lane A** (root config, `instrumentation.ts`, `next.config`, a new dependency).

**The state, precisely.** `docs/handoff-2026-08-17-platform-agent-model-and-device-session-findings.md`
lists under *Deliberately NOT done*: **"The Sentry SDK is not wired. DSN is in Railway, a read token is
in a session env. Deferred on purpose so the session that wires it can verify events arrive rather
than assume — a configured DSN and a silently-dropping one look identical."** Confirmed in the tree:
no `@sentry/nextjs` dependency, no `sentry.*.config.ts`, no `SENTRY_*` reference in any source file.

**Why this entry exists at all.** The deferral was a good call, and it was recorded in the right place
for a narrative — but **there was no backlog entry**, so nothing in the queue was going to pick it up.
A deferral that lives only in a handoff is an orphaned finding by the repo's own rule, and Sentry's own
email is what surfaced it rather than anything in this repo.

**⚠ The verification requirement is the whole point — do not skip it.** The deferring session's
stated reason was that a wired-but-silent DSN is indistinguishable from a working one. So this item is
not done when the SDK is installed; it is done when **a deliberately-thrown error is observed arriving
in the Sentry project**. Throw one from a server route and one from the client, and record both in the
PR.

**What it adds that `error_events` does not.** Server errors are already captured — `instrumentation.ts`
`onRequestError` → `lib/observability/request-error.ts` → `error_events` — and client errors too, via
`components/error-reporter.tsx` (mounted at `app/layout.tsx:143`) and `app/error.tsx`. So Sentry is not
filling a capture gap. It fills the **alerting** gap: `error_events` is pull-only, prunes at 30 days,
and CLAUDE.md records that the first read found three faults of which two had already stopped before
anyone looked. Nothing notifies. Wire it for that, and say so in the PR so the next reader does not
think the home-grown path is now redundant — **it is not, and it should not be removed.**

**⚠ PII, and this is a health app.** Sentry's defaults capture URLs, breadcrumbs and sometimes request
bodies. Health values, user ids and food/weight data must not leave to a third party by accident. Ship
the scrubbing config **in the same PR as the DSN**, not after — `beforeSend`, `sendDefaultPii: false`,
and a denylist for the health routes. There is also a **prior decision against a vendor** on record
(`docs/overview/history-latest.md:625`, *"Decision made against a Sentry-type vendor: single user, data
stays in Railway, no CSP changes"*) — that decision has since been reversed by the owner, and the CSP
note is a live consideration for the WebView, not a stale one.


### [cardio][devices] Q-410 — the guided walk should show speed and steps and pace itself by cadence, but the cadence signal is gated and reads `--`

- **Branch:** `feat/walk-step-goal`
- **Added:** 2026-08-19 · owner, mid-session, with a screenshot of a live walk
- **Owner's words:** *"for the walking section I'd it to show the speed and total step count.
  rather than a HR goal we should be looking at a step goal; we should enough data on how to do
  this."*
- **Placement:** medium, and **read the blocker below before scheduling it** — one third of this is
  a display change that can ship next session, and two thirds depend on a measurement problem that
  is open.

**What the screen shows today.** `components/guided-walk/walk-active.tsx` (224 lines) renders the
segment name, the countdown, live **bpm**, `distanceKm` when a route exists (`:189-190`), a cadence
readout, and a verdict line built from HR targets: `In zone (target ≤99 bpm)` / `Push harder` /
`Ease off` (`:201-204`). The owner's screenshot is a slow segment reading **96 bpm, in zone**, with
cadence showing **`--`**.

**Split this into three pieces, because they are not equally ready.**

**1 — Speed. ⚠ CORRECTED 2026-08-19 — pace IS already rendered, and the earlier wording here was
misleading.** `walk-active.tsx:167-176` renders pace as **min/km** whenever `currentPaceSecPerKm`
is non-null, and drops to an HR-primary layout when it is null (no GPS lock — indoor or treadmill).
**The owner's screenshot was that fallback**, which is why no pace appeared; it is a GPS-lock
situation, not a missing feature. An implementer reading the old sentence would have gone looking
for an absent line and found it already there.
**What is genuinely missing is the unit the owner asked for — km/h — and a step total.** That
layout also carries a prior owner decision, recorded in its own comment: *"pace is the real
fast/slow signal, HR drifts set-over-set and is only a secondary confirmation."* So the screen
already has a primary-metric hierarchy, and cadence slots into it rather than replacing it. **Decide the unit deliberately**: pace (`min/km`) is the
convention for running and is what the summary already computes (`computeAvgPaceSecPerKm`), while
speed (`km/h`) is the more natural reading for a walk and is what the owner asked for by name.
Recommendation: show **km/h** on the live screen, keep min/km in the summary where it sits beside
splits and best efforts, and derive both from the one pace series rather than adding a second
computation — the One Formula rule applies.

**2 — Total step count. Ready only when a strap is worn.** `stepsEstimate` exists and is already
saved (`walk-summary.tsx:150,167`), and it comes from **integrating the strap's cadence series over
the walk** (Q-230 replaced a hardcoded `null` with it). So a running total can be shown live from
the same tracker with no new plumbing — but it is a strap-only number today, and it must be
labelled as an estimate rather than a count, because it is integrated cadence and not counted
steps.

**3 — ⚠ Replacing the HR goal with a step goal. BLOCKED on a measurement problem, and this is the
finding that matters.** The premise *"we should have enough data on how to do this"* is the part to
check before building: **we do not, yet, and the screenshot is the evidence.**
- Cadence is fused from two sources (`lib/activity/cadence-tracker.ts`): the **strap** at ~1
  reading/second, and the **ring** at one gait window per ~30 s. The `--` in the screenshot means
  neither was live — no H10 that walk, and the ring had delivered nothing usable.
- The ring path is **explicitly gated**: `RING_CADENCE_VALIDATED = false`
  (`packages/shared/src/health/cadence.ts:218`). Its docstring is worth reading in full before
  planning this — the signal is not broken, it is **octave-ambiguous**. Three counted captures land
  on opposite sides of an octave split (64 spm → 0.98 Hz reads as step rate; 114 spm → 1.02 Hz reads
  as *stride* rate), and a metronome-referenced capture agreed with the strap to **0.4 spm**. The
  comment is explicit that shipping it uncorrected gives a number **wrong by 2×**, which is worse
  than showing none.
- **So a step goal built on today's cadence would be paced by a signal that is absent without a
  strap and can be double or half with one.** An HR goal, whatever its faults, is at least always
  present — the ring gives HR continuously. **Do not swap the target over until the ring path is
  octave-corrected and re-validated across counted cadences**, which is the concrete next step that
  docstring already names.
- **Recommendation:** ship pieces 1 and 2 now as *additional* readouts, keep the HR verdict as the
  pacing target, and treat the swap as a follow-up gated on ring validation. That gives the owner
  the two numbers asked for on the next deploy without keying the workout to a signal that reads
  `--`.

**ANSWERED BY THE OWNER, 2026-08-19 — it is a cadence target.** *"Yes a cadence target- like a SPM
to indicate a 'walk faster' option to get the most out of the work screen"*. So the verdict line
becomes an **spm** target, not a step total: `Walk faster (aim ≥120 spm)` where it currently reads
`Push harder (aim ≥140 bpm)`. The daily/session step-total reading is **not** what was wanted and
should not be built.
- **This is the right instinct for a reason worth stating: cadence responds and heart rate lags.**
  HR takes 30–60 s to catch up with a pace change, so a prompt driven by it arrives after the
  moment it is about. Cadence changes the instant the legs do — which is exactly what makes it
  useful as a *"walk faster"* cue rather than a report.
- **The pacer runs in BOTH directions — owner, 2026-08-19:** *"Should also be able to say to
  slowdown during the slow part. so pacer for speed/steps both ways"*. A slow segment is not an
  unpaced rest; walking it too hard is what stops the fast set from being fast. So a fast segment
  reads against a **floor** (`Walk faster — aim ≥120 spm`) and a slow segment against a **ceiling**
  (`Ease off — aim ≤95 spm`), from the same control and the same bar.
- Keep `classifyZone`'s three-state shape (`push` / `in` / `ease`) and swap what it reads — **it is
  already symmetric**, which is why this costs nothing structurally: `push` and `ease` exist today
  and are chosen by `kind === 'fast'`. The copy and the thresholds change; the shape does not.
- **So `walk-config.tsx` needs a cadence PAIR, not a single target** — a fast floor and a slow
  ceiling, mirroring the two HR targets it already stores. A single cadence number cannot express
  the slow half.
- **The fast/slow interval targets become cadence numbers**, so `walk-config.tsx`'s target model
  needs a cadence pair beside the HR pair rather than in place of it — see the fallback below,
  which needs both.

**⚠ It still cannot be the ONLY target, and this is the part to design rather than discover.**
The blocker above has not moved: cadence is **absent** without a strap and **octave-ambiguous** from
the ring. A verdict line keyed solely to cadence shows nothing at all on a walk where the owner left
the H10 at home — which is the walk in the screenshot that started this.
- **Recommendation: the verdict follows whichever source is live, and says which.** Cadence when a
  cadence source is live (strap, or the ring once validated); the existing HR verdict when it is
  not. One line, two possible drivers, labelled — `Walk faster (aim ≥120 spm)` or
  `Push harder (aim ≥140 bpm)`. That ships the owner's decision **today** for strap walks without
  regressing strapless ones to a blank line, and it needs no ring work to be useful.
- The alternative — cadence-only, gated on finishing the ring octave correction first — is cleaner
  but delivers nothing until Lane A lands a decoder fix, and leaves strapless walks unpaced
  forever. Not recommended.
- **Do not silently fall back.** A user who thinks they are being paced by cadence and is actually
  being paced by HR will not understand why the prompt is late. The unit on the line is the tell,
  and it is already there.

**REVISED 2026-08-19 after the owner reviewed the drawing — three changes, all of them load-bearing.**

**(a) The bar is banded, and "the right direction" is never an error.** *"color code the bar based on
whether its in the right direction of the pacer; i.e slower than expected = green … green for in
range: orange for slightly out; and red for way off."* So the band is chosen by **signed** distance
from the target, not absolute:
- **Fast** segment, floor `F` — `spm ≥ F` **green** (and it stays green however far above; on a fast
  set, faster is the point) · `F − 10% ≤ spm < F` **amber** · below that **red**.
- **Slow** segment, ceiling `C` — `spm ≤ C` **green** · `C < spm ≤ C + 10%` **amber** · above that
  **red**.
- **10% of the target is the proposed band width**, not a measured one. It is a starting value and
  should be a named constant next to the thresholds so it can be tuned after a few real walks — do
  not scatter it inline.
- **Colour never travels alone** — CLAUDE.md forbids it, and the drawn version pairs each band with
  a mark and a sentence (`✓ On pace`, `▲ Walk faster — aim ≥120`, `▼ Way over — ease off to ≤95`).
  A red bar with no words is a rule violation, not a style choice.
- **⚠ One consequence worth deciding rather than discovering: standing still scores green.** On a
  slow set, "slower is always better" means stopping is perfect. Recommend a **stopped** state below
  roughly 40 spm that renders **neutral rather than green** — not scolding, but not congratulating a
  walk that has stopped being a walk. Flagged, not decided.

**(b) When cadence is absent the pacer falls to SPEED, not heart rate.** *"when no source detected
for cadence it still shouldn't be BPM; probably speed would be good there."* That gives a precedence
ladder of **cadence → speed → heart rate**, and it is consistent with the decision already recorded
in `walk-active.tsx`'s own comment (*"pace is the real fast/slow signal, HR drifts set-over-set and
is only a secondary confirmation"*). HR becomes the last resort, reached only when GPS is out too —
which is the treadmill case.
- **This needs a speed target pair**, the same way cadence does. **Do not add a third manual config
  block**: `walk-config.tsx` would then ask for HR, cadence *and* speed targets for one walk, which
  is three ways to say the same intent. Recommend **deriving the speed pair from the user's own
  recent fast/slow segments** — `segments` already stores `avgPaceSecPerKm` per segment, so the data
  to seed it is in the table today — and letting the cadence pair stay the thing the user sets.

**(c) Storage — mostly already done, and the entry should say so rather than asking for "store
everything".** *"make sure all these values get stored so we can do data analysis on it later like
steps x distance x time."* Measured against `schema.ts` and `walk-summary.tsx`:
- **Already persisted per walk:** `steps` (Q-230, integrated from strap cadence), `distanceKm`,
  `durationMin`, `paceSeries`, `avgPaceSecPerKm`, `splits`, `bestEfforts`, elevation gain/loss/profile,
  `cadenceSpm`, `cadenceSeries`, `cadenceSource`, `avgHr`/`maxHr`.
- **Already persisted per segment** (`activity_logs.segments` JSONB): `index`, `setNumber`, `kind`,
  `startSec`, `endSec`, `avgHr`, `maxHr`, `hrAtStart`, `avgPaceSecPerKm`, `distanceKm`,
  `avgCadenceSpm`.
- **So steps × distance × time is already answerable at the walk level.** What is genuinely missing
  is small and specific, and all three are additions to the existing `segments` object rather than
  new columns:
  1. **`steps` per segment** — derivable from `avgCadenceSpm × duration`, but derived-at-read-time
     means every consumer re-derives it differently. Store it.
  2. **Adherence per segment** — the fraction of the segment spent in each band. This is the number
     the pacer *creates* and the most interesting thing to analyse later ("did I actually hit the
     targets, or just see the prompt"). Nothing records it today because nothing computed it before.
  3. **Which signal paced the segment** (`cadence` | `speed` | `hr`). With the ladder in (b) an
     adherence figure is uninterpretable without it — 60% in-range against a cadence target and
     against an HR target are not the same measurement.
- **Adding a key to the `segments` JSONB type is a schema edit** (`lib/data/postgres/schema.ts:344`)
  and therefore **Lane A**, and per the offline-sync rule the local SQLite mirror, the outbox
  payload, `getSyncDelta` and `applyDelta` all move in the same PR.

**Drawn 2026-08-19, redrawn after the review — five states, and the layout follows from the fallback rule above.** Speed
leads at 40 px; cadence and HR sit beneath it as a pair; the step total joins distance on one grey
line; and the verdict gains a **progress bar against the cadence target**, so *"walk faster"* is a
reading rather than a sentence. The slow panel shows the bar reading against a
ceiling rather than a floor, so both directions use one control. The degraded panel is the important
one: cadence dims to `--`, HR takes the verdict back, and a single line says which signal is pacing
and how to change it — *"No cadence source — pacing by heart rate. Wear the strap for step pacing."*
Without that line the screen silently changes what it means. **`walk-active.tsx` is 224 lines**, so
this fits without an extraction.

- **Lane.** `components/guided-walk/**` is Lane B. Any ring octave correction is
  `packages/shared/src/health/cadence.ts` + the decoder, which is **Lane A**, and it is the harder
  half by a distance.
- **Verification.** Speed is checkable in `pnpm dev` against a mocked pace series. **Steps and
  cadence are not** — they need a real walk with the H10 paired, and the ring half needs a counted
  capture against a metronome, which is the procedure that produced the numbers in the docstring.
  State plainly that no device pass was run if none was.

### [workouts][devices] Q-486 — the outbox enqueue for a workout is the only write in the app that fails silently, and it is the last line of defence

- **Branch:** `fix/tier-a-enqueue-visibility`
- **Added:** 2026-08-18 · review sweep (swallowed failures on write paths) ·
  [`docs/reviews/2026-08-18-tier-a-enqueue-silence.md`](reviews/2026-08-18-tier-a-enqueue-silence.md)
- **Placement:** mid. Narrow trigger, but the loss is unrecoverable and un-diagnosable, on the domain
  the codebase itself calls worst-case. The fix is four lines.
- **The four sites — the ONLY `queueMutation` calls in the app that swallow, and all Tier-A:**
  ```
  components/workout-screen.tsx:1320  queueMutation({domain:'workout_log'}).catch(() => {})
  components/workout-screen.tsx:1324  queueMutation({domain:'workout_log'}).catch(() => {})
  components/workout-screen.tsx:1527  queueMutation({domain:'complete_workout'}).catch(() => {})
  components/workout-screen.tsx:1532  queueMutation({domain:'complete_workout'}).catch(() => {})
  ```
  `lib/local-store/dead-letter-signal.ts` defines Tier-A and says why: *"a lost workout is the app's
  worst-case data loss."*
- **Read this before judging the size: the surrounding design is GOOD and must not be undone.**
  `logWorkoutLocally` writes locally first (and logs its own failure); the **primary** send is a direct
  `POST /api/log-exercise`, deliberately *"independent of the on-device outbox / sync-push path (which
  can fail silently)"*; the outbox enqueue is only the **fallback**. This is not a write with no outbox
  — it is a well-layered write whose last layer is silent.
- **It can throw.** `queueMutation` is a bare `runSQL` INSERT (`sqlite-backend.ts:2669`), so it throws
  whenever the local DB is unavailable — which `CLAUDE.md` records as having happened **twice** on
  Android (*"the local DB has been silently dead … every local read returned empty"*), plus the
  partial-migration and `disk_full` cases.
- **The sequence that loses a set:** the POST fails (offline — the case this fallback exists for)
  **and** the local store is broken. Then the set is not sent, not queued, not recoverable; **nothing
  is logged**; and `hapticLight()` + `setLoggedCount(c => c + 1)` have already told the user it worked.
- **The inconsistency is the argument.** In the same function, `logWorkoutLocally` failing is
  `console.warn`ed and `queueMutation` failing is not — the *less* consequential failure is the visible
  one. The warn above shows the intent; this looks like an oversight, not a decision.
- **Fix shape (do NOT change control flow):**
  1. `.catch(err => console.warn('queueMutation failed:', err))` ×4 — matches the line above, makes the
     condition diagnosable at all.
  2. Signal the user, since this loss is unrecoverable — a toast, or route it through the existing
     `lib/local-store/dead-letter-signal.ts` so the More-tab badge lights. The mechanism already exists.
  - **Do NOT convert these to `await`.** They are fired without blocking on purpose so the UI stays
    instant (`Saves feel instant`); awaiting puts a SQLite write in front of the haptic.
- **Lane B owns this** (`components/**`).
- **NOT reproduced, and cannot be here.** Inducing it needs a broken local SQLite on a device; in the
  web sandbox `getLocalStore` returns null, so `store_?.` short-circuits and the enqueue never runs.
  That `queueMutation` throws on a dead local DB is read from source, not observed. **On-device is the
  only real verification.**
- **Clean and worth not re-checking:** **26 of ~30** `queueMutation` sites correctly `await`, so a
  throw reaches a `try` and suppresses the success toast — `components/health/metric-log-sheet.tsx:96`
  is the reference shape.

### [platform][body][devices] Q-321 — decide per field which discarded values should quarantine the mutation

- **Branch:** `feat/push-coercion-per-field-policy`
- **Added:** 2026-08-19 · Lane A, the deliberately-deferred third step of Q-485.
- **What Q-485 did and did not do.** It made the discard *visible* — a named `warnings[]` entry per
  mutation and one `error_events` row per push, so a value the web route refuses with a message is no
  longer dropped without a trace. It did **not** change which values are dropped, and that was on
  purpose: the entry called it *"a product decision, not one an implementer should make in passing."*
- **The question.** 12 of 14 `body_metrics` bounds checks coerce silently; 2 throw (`waterMlDelta`,
  `sleep_session`) and both are defensible — a dropped *increment* loses the add entirely, and a
  malformed sleep session is meaningless rather than incomplete. Which of the other 12 are
  "incomplete, keep going" and which are "meaningless, quarantine"?
- **Why it cannot just be "throw everywhere":** a throw quarantines the mutation, and the poison-pill
  rule forbids retrying a validation failure forever. Twelve new dead-letter paths would trade an
  invisible failure for a queue of red badges over values the user cannot correct from a badge.
- **✅ UNBLOCKED 2026-08-19 — the owner delegated the call** (*"Unsure how to continue on this. I
  dont understand enough - happy for you to make the best guess on how to proceed"*), and the answer
  is **none of the twelve should quarantine.** The two that throw are the two that should, and the
  principle behind them is real rather than a coin flip:
  - **Quarantine when the value IS the mutation.** `waterMlDelta` is an *increment* — drop it and
    the user's add is gone with nothing left behind. A malformed `sleep_session` is meaningless
    rather than incomplete. Both are "the payload has no residual value".
  - **Coerce when the field is one independent observation among many.** Every `body_metrics`
    column is a separate daily figure on a shared row; dropping an implausible HRV still leaves a
    valid weight, step count and macro set on the same day. Twelve new dead-letter paths would
    trade one invisible failure for a queue of red badges over values the user cannot correct from
    a badge — which the entry above already argues, and which holds field by field.
- **But the framing hid the better fix, and this is the part worth building.** Coerce-vs-quarantine
  is the wrong axis. The one that matters is **whether the person can act on it**:
  - **Device-sourced** (`hrvMs`, `spo2Pct`, `restingHr`, `steps`, `distanceKm` from the ring or
    Health Connect) — the user cannot fix a bad reading. Silent coercion plus the `warnings[]` entry
    Q-485 already emits is exactly right. **No change.**
  - **User-typed** (`weightKg`, `bodyFatPct`, the six `measurementCm` fields, macros and calories
    entered by hand) — the user *can* fix it, and dropping it three layers later is the actual
    defect. **Measured 2026-08-19: `components/health/metric-log-sheet.tsx:60-96` writes to the
    local store and queues the mutation with no bounds check at all**, and
    `packages/shared/src/validation/body-metrics.ts` — which holds every threshold already — is
    imported by nothing under `components/` or `app/`. A 5,000 kg weight is accepted by the sheet,
    stored locally, queued, pushed, silently dropped server-side, and the number the user typed
    never appears anywhere.
  - **So the work is: import the existing validators into the log sheet, reject at the keyboard with
    an inline message, and never queue the value.** No new thresholds, no new policy, no schema — the
    bounds are already written and shared. That is a smaller change than twelve quarantine paths and
    it fixes the case the user can actually do something about.
- **One bug found while deciding this, worth fixing in the same PR:** `validStepsOrNull` uses
  `Number.isInteger`, so a **fractional** step count is rejected outright rather than rounded. Any
  decoder or estimator that produces `8000.5` loses the whole day's steps. Every sibling validator
  takes `Number.isFinite` and rounds where it matters (`validRestingHrOrNull` does exactly that).
  Round it.
- **Related, and the natural client half:** nothing renders `warnings[]` yet. Surfacing it is
  `components/**` (Lane B). With the decision above it is **lower value than it looked** — the
  warnings that remain are all device-sourced and unactionable, so a badge would report noise the
  user cannot clear. Worth doing only as a diagnostic surface, not a user-facing alert.

### [platform] Q-322 — 92 route files still read their body with bare `req.json()`; the ratchet holds the line

- **Branch:** `fix/bounded-request-bodies`
- **Added:** 2026-08-19 · Lane A, the deferred halves (2) and (3) of Q-484. **Rewritten 2026-08-19
  after the first slice shipped (PR #182), which also closed Q-498.**

- **What is already done, so it is not re-done.**
  - **The shared bounded reader exists** — `readJsonLimited(req, maxBytes)` in
    `packages/shared/src/http/request-guards.ts`. Piece 1 of the original entry is complete; it
    shipped with Q-498's sibling work and is measured: against a 20 MB body on a 16 KB cap it cuts
    off at 2,949,120 bytes.
  - **The three routes reachable without a session are converted** — `auth/register`,
    `auth/exchange-mobile-token`, `health-connect/ingest` (Q-498, now removed from this queue). All
    three used to accept the full 20,000,048 bytes and then answer 400; all three now answer 413.
  - **`health-connect/ingest`'s ordering is fixed**, which was the larger half of Q-498: the
    per-IP brute-force limiter now runs **above** the body read. Q-498 said this needed the secret
    moved to a header; it did not — the limiter is keyed on the IP from the request headers, so
    nothing had to come out of the body and the owner's Tasker profile was not touched.
  - **`scripts/check-bounded-request-body.js` is in the Custom Rules job**, shrink-only per file.
    The three converted routes are at zero, so re-adding a bare read to any of them fails
    immediately. Verified by reverting one and watching it go red.

- **Slice 2 shipped (PR #184): the six offline-first hot paths.** `nutrition/food-logs` (+ `[id]`),
  `log-exercise`, `complete-workout`, `sync/push`, `water-log`. Two of them threw on malformed JSON —
  a bare `req.json()` with no `.catch()`, which Next turned into a **500** rather than the 400 it is —
  so those now answer 400 as well. `sync/push`'s cap was **measured**, not guessed: the envelope caps
  the batch at 100 and the largest bounded domain (`workout_log`, arrays capped at 20, strings at 200)
  is 6,010 bytes at its own limits, so a full worst-case batch is 0.57 MB against a 4 MB cap. **Do not
  lower that one without re-measuring** — it is the outbox, and a rejected batch is the app's
  worst-case data-loss path.
- **What is left: 98 bare reads across 86 route files.** The baseline in that script is the list.
  The number may only go down; a file that reaches zero is removed from it in the same PR.
- **Do this in slices, not one sweep** — that is what the ratchet is for. Converting 92 files at
  once is how a mistake hides in a diff nobody can read.
- **This is a candidate count, not a defect count.** All 92 require a session, several do
  hand-rolled checks, several are admin-gated. Read each before calling it broken *or* fine. The
  suggested next slice, by exposure: `user/password`, `profile`, `user/goals`, then the admin and
  AI routes, then the rest.
- **Priced honestly.** Not attack — this app's users are its own account holders. It is worth doing
  because `CLAUDE.md` runs a session-start database-size ritual and records a real `disk_full`
  outage (2026-08-17), and an unbounded user-writable body is the shape that ritual exists to
  catch — and because the stated direction is multi-user + Play Store, at which point "nobody is
  attacking it" stops being an argument.
- **⚠️ Do NOT quote 20 MB as a storage figure.** `pg_column_size` read ~120 kB for the probe rows
  because the payload was one repeated character and TOAST compressed it almost perfectly. Real text
  would not. The defensible statement is that the **transfer and parse** cost was unbounded.
- **Lane A owns this** (`app/api/**`, `scripts/`).

### [platform] Q-479 — a revoked admin can still write to the shared exercise catalogue for up to 24 hours, and the module docstring says this cannot happen

- **⛔ OWNER-DEFERRED 2026-08-18 — accepted risk, do NOT implement. The fix already exists.**
  The owner's call: *"leave that as a known issue for now — only admin will be me for a long time."*
  The window opens only on **revocation**, and with a single permanent admin it never opens.
  - **The work is done, tested and CI-green on `fix/exercises-route-admin-db-check` (PR #124)** —
    the one-argument route change, the corrected `is-active-refresh.ts` docstring, four contract
    tests, and `scripts/check-admin-claim-in-api.js`. Re-implementing it would duplicate that
    branch, not add anything. If this becomes live, **merge #124**; do not start over.
  - **What makes it live again:** a second admin granted and later revoked; the Play Store /
    multi-user path advancing; or `isAdminUser` gaining another API-route caller (the CI check that
    would catch that is on the branch, not on `main`).
  - Full reasoning, and the caveat that `is-active-refresh.ts`'s docstring is currently **wrong**
    until #124 lands, are in the `projectOverview.md` Known-Issues row.
  - **Left in the queue rather than removed**, because the risk is accepted, not resolved — and a
    removed entry is how a decision like this gets silently forgotten.

- **Branch:** `fix/exercises-route-admin-db-check`
- **Added:** 2026-08-18 · review sweep (auth/session boundaries) ·
  [`docs/reviews/2026-08-18-auth-session-boundaries.md`](reviews/2026-08-18-auth-session-boundaries.md)
- **Placement:** mid. **Moderate-low impact** — the gain is rows in a catalogue, not user data — but
  it is privilege persistence with a working proof of concept and the fix is deleting one argument.
- **Two admin checks in one file disagree.** `lib/admin.ts`: `requireAdmin(userId, _isAdmin?)` accepts
  the flag for signature compatibility and **refuses to trust it**, reading the row every call (**61
  API routes**). `isAdminUser(userId, isAdmin?)` **returns the passed flag** when given one.
- **Ten sites call `isAdminUser`; seven pass `session.user.isAdmin` (the JWT claim).** Six are page
  guards, which is UI and fine. **The seventh is an API write route** —
  `app/api/exercises/route.ts:38`, gating `createExercise`, a write into `exercise_library`, the
  catalogue every user reads.
- **The claim is refreshed only once a day.** `lib/auth/is-active-refresh.ts` re-reads `isActive`/
  `isAdmin` inside the jwt callback, throttled by `ISACTIVE_RECHECK_MS = 24h` — a sound decision
  (unthrottled would be a DB query per request). The problem is what it then claims:
  > *"This governs the **UI** only: `requireAdmin` reads the row from the database on every call and
  > never trusts this claim."*

  **That is false**, and it is why this is easy to miss — a reviewer who reads it stops looking.
- **Measured**, admin granted → fresh login → token warmed → admin revoked in the DB, **no re-login**,
  cookie rotation persisted as a browser does:
  ```
  POST /api/exercises    = 201   ← isAdminUser, JWT claim
  GET  /api/admin/errors = 403   ← requireAdmin, DB read  (the control)
  session claim still says: isAdmin = True
  → row "ZZ Probe Revoked" created in exercise_library
  ```
  Same cookie, same instant, one route refusing and the other admitting. **Window: up to 24 h.**
- **Fix shape:**
  1. `app/api/exercises/route.ts:38` — drop the second argument, or better, use `requireAdmin` like
     its 61 siblings so the file stops being the odd one out.
  2. **Correct the docstring** in `lib/auth/is-active-refresh.ts`; step 1 is what makes "UI only"
     true. Say outright that an API route must never pass the claim — **the wrong comment is more
     dangerous than the wrong call, because it scales to the next route someone adds.**
  3. *Optional ratchet:* fail Custom Rules on `isAdminUser(` with a second argument under
     `app/api/**`. Cheap, and the shape this repo already uses where prose did not hold.
- **Lane A owns this** (`app/api/**`, `lib/admin.ts`, `lib/auth/**`).
- **Do NOT "fix" the six page guards** — they are UI, they match the docstring, and a revoked admin
  seeing an empty admin shell for ≤24 h while every API behind it 403s is the intended trade.
- **Not verified on:** the APK (its WebView keeps cookies, so it behaves like the corrected harness)
  or production. `ISACTIVE_RECHECK_MS` is read from source, not observed over a real 24-hour window.
- **⚠️ If you re-run this, persist cookie rotation.** My first run reported revocation working and was
  **wrong**: `curl -b` without `-c` discards the rotated cookie, so every request re-sent a token with
  no `isActiveCheckedAt`, the throttle never engaged, and the DB was re-read every time. Use `-b` and
  `-c` on the same file.


### [nutrition][app-shell] Q-357 — four memoised call sites are still defeated, and one of them is inside a list

- **Branch:** `fix/memo-call-sites-stable-props`
- **Added:** 2026-08-18 · Lane B, while shipping Q-490 · [`journal`](overview/entries/2026-08-18-memo-scalar-props.md)
- **Placement:** low. Performance, not correctness, and it is **already frozen** —
  `scripts/check-memo-prop-stability.js` baselines these four, so nothing new can join them. This
  entry is for clearing the four, not for stopping the bleeding.
- **Q-490's review said "no inline arrows exist anywhere".** There are four, on four different
  memoised components, none of them the two Q-490 fixed. Found by running the check repo-wide:
  ```
  app/nutrition/nutrition-content.tsx:627   <MealPlanReviewCard>  4 inline arrows
  app/nutrition/nutrition-content.tsx:638   <MealPlanSection>     1 inline object
  components/nutrition/saved-meals-sheet.tsx:587  <SavedMealCard>  5 inline arrows
  components/oura-ble/oura-ble-debug.tsx:704      <LogConsole>     1 inline arrow
  ```
- **`SavedMealCard` is the one that costs anything.** It renders inside `visibleMeals.map(...)`, so
  all five arrows are rebuilt per meal per render and the memo never holds for any card. The other
  three are single instances; their memo is defeated too, but the render they cause is one component.
- **The list site cannot be fixed with `useCallback`** — it is inside a `.map()`, where a hook is not
  allowed. Q-490's answer was scalars; here the shape is different, because the props are *callbacks*
  rather than data. The fix is to change the callback contract so the parent can pass one stable
  function: `onLog={quickLog}` with the child calling `onLog(meal)`, rather than
  `onLog={() => quickLog(meal)}`. Six props, one component, plus its call site.
- **Do the debug console last or not at all** — `oura-ble-debug.tsx` is an admin surface and its
  `onClear={() => setLines([])}` costs one re-render of a console nobody is watching for performance.
  Fixing it is one `useCallback`; skipping it is defensible. Either way, **update the baseline in the
  same PR** — the check fails when a listed file drops below its number, which is the point.
- **Lane B owns this** (`app/nutrition/**`, `components/nutrition/**`, `components/oura-ble/**`).
- **Not verified:** static analysis, same as Q-490. **No render counts were measured** — the claim
  follows from object identity and React's shallow compare, not a profiler run.

### [activity][platform] Q-556 — `DELETE /api/activity-logs` reports success for a delete that deleted nothing

- **Branch:** `fix/activity-log-delete-affected-rows`
- **Added:** 2026-08-18 · review sweep (cross-user isolation, two real accounts) ·
  [`docs/reviews/2026-08-18-cross-user-isolation.md`](reviews/2026-08-18-cross-user-isolation.md)
- **Placement:** low. **Not a leak — verified, not assumed.** As user B, deleting user A's activity
  log returns `200 {"success":true}`; the database immediately after shows the row **intact**,
  `deleted_at` NULL, still owned by A, A's count unchanged. The scoping is deliberate and already
  tested (`repository-ownership-scoping.test.ts:326`).
- **The route cannot report what happened.** `deleteActivityLog(userId, id): Promise<void>` returns
  nothing, so the handler `await`s it and answers `{ success: true }` unconditionally.
- **Why file it anyway:**
  1. **Inconsistent with every sibling.** The house posture — verified by an enumeration control in
     the same run — is **404 for both a nonexistent id and someone else's**. This route is **200 for
     both**. Both are safe against enumeration, but they cannot both be the convention.
  2. **Offline-first makes a false success expensive.** A queued mutation receiving a 2xx is confirmed
     and dropped from the outbox, so a delete that matched zero rows *for a different reason* (sync
     ordering; row not yet on the server) is indistinguishable and gets confirmed away.
     **⚠️ That path was NOT demonstrated** — it is why the response matters, not an observed bug.
  3. Same family as the existing rule *"after a user-scoped UPDATE whose row id came from the client,
     check the affected-row count"*, applied to a DELETE.
- **Fix:** return the affected-row count from `deleteActivityLog`; answer 404 when zero, matching siblings.
- **✅ Everything else held.** 10 of 11 probes rejected by the route's own ownership check — A's recap/
  energy/timing, deleting A's workout, logging a set **into A's session**, completing A's workout.
  **The enumeration control passed:** nonexistent and A's ids return byte-identical responses.
- **Not exercised:** `PATCH /api/activity-logs/<id>/metrics` returned `400 Invalid body` (my payload was
  wrong), so that route's ownership check is **still unverified**. Local DB + web build; not production,
  not on device; two accounts only — says nothing about admin-vs-user boundaries.

### [app-shell][platform] Q-555 — offline, a tab tap is a silent no-op until the service worker claims the page

- **Branch:** `fix/offline-first-load-navigation`
- **Added:** 2026-08-18 · review sweep (offline read surfaces, driven for real) ·
  [`docs/reviews/2026-08-18-offline-read-surfaces.md`](reviews/2026-08-18-offline-read-surfaces.md)
- **Placement:** low. Narrow by construction — needs a first-ever load (or a cleared worker) plus
  connection loss inside that window, and it self-heals on the next load.
- **⚠️ Lead with the good news, because three of four results here are positive.** Both offline paths
  **work** once the worker is in control: a full reload serves the precached `/offline` page verbatim,
  and an offline tab tap navigates and paints **2515 chars against 2486 online (~101%)** with no
  offline page and no skeleton. The offline-first design delivers.
- **The defect is the uncontrolled window.** Measured:
  | State | Offline tab tap |
  |---|---|
  | `controller: true` | navigates, paints ~101% of cached content |
  | `controller: false` | **URL unchanged, no navigation, no offline page, no feedback at all** |
- **The uncontrolled state is the first-ever page load** — the worker registers *during* that
  navigation and claims only afterwards. So a genuine first session that loses connection inside that
  window gets a tab bar where taps do nothing and nothing explains why.
- **Why file something this narrow:** the symptom (*a tap that does nothing, silently*) is
  indistinguishable from a frozen app, and on the APK the service worker **is** the offline cold-start
  mechanism — so install day is exactly when a new user is most likely to be moving between networks.
- **Not diagnosed:** whether the no-op is Next's router aborting a failed RSC fetch or the click
  handler swallowing it. That needs the router's internals, not another probe.
- **Not exercised — and this limit is load-bearing:** web build only. On web `cachedFetch` falls back
  to `localStorage`, so what was verified is the **seed** path, **not** the native SQLite local store
  that is the real source of truth on the APK. Re-check the first-load window **on device**, where the
  worker's install timing and the WebView lifecycle differ.

### [platform] Q-554 — the orientation indexes named paths that do not exist, including a module that was never built

- **Status: FILED AND FIXED in the same PR** (docs + a new CI check, Custom Rules now **42 of 42**).
- **Added:** 2026-08-18 · review sweep ·
  [`docs/reviews/2026-08-18-orientation-index-paths.md`](reviews/2026-08-18-orientation-index-paths.md)
- **The gap.** `scripts/check-claude-md-paths.js` guards `CLAUDE.md` for the reason in its header —
  *"a wrong path in a rulebook is worse than a wrong path in code: nothing compiles it, so it rots
  silently and is copied confidently"* (Q-153). Sessions are also told to read `docs/module-map.md`
  before building any shared helper and `docs/domains/<pillar>/README.md` before working in a pillar.
  **Nothing checked either.**
- **⚠️ `docs/module-map.md:232` carried a row for a module that has never existed.**
  `lib/oura-ble/steps-motion-decoder.ts` → `decodeStepsPacket(cols27)`: **zero references to either in
  the whole tree.** What exists is the row twenty lines below — `lib/oura-models/steps-motion-decoder.ts`
  → `runStepsMotionDecoder(input)`, golden-verified and described there as **"NOT yet wired"** into the
  BLE decode or the step pipeline. So row 232 described *that wiring*, in the present tense, in a table
  whose stated purpose is **"what already exists and where … to stop new work re-implementing
  infrastructure the app already has."** It produced both errors at once: someone looking for the
  decoder finds nothing, someone checking whether the wiring is done reads that it is.
- **Three stale domain-index rows:** `workouts` listed a UI route `app/history/` (gone — history renders
  via `components/exercise-history-sheet.tsx`), `devices` listed `docs/oura-models/` (no such dir; the
  ops reference is `docs/oura-ble-operations.md`), `app-shell` listed `app/overview/` (no such route).
- **49 malformed display paths.** Every domain index rendered history links as
  `` `docs/../overview/history-…md` `` — **link target correct, visible label wrong** (`docs/../overview/`
  normalises to `overview/`, which does not exist). Fixed across all eleven; link targets untouched.
- **The check:** `scripts/check-index-doc-paths.js` — **748 paths across 12 docs**. Deliberately
  narrower than its sibling: root-anchored backticked paths only; globs/ellipses/templates skipped; a
  path named *while saying it is gone* needs a `DELIBERATE` entry with a reason.
- **⚠️ Those narrowings were earned, not designed.** The first pass reported **59 of 787**, all but four
  being relative fragments, globs, or the display-path bug. **And the fixes then re-triggered the
  check** — writing *"there is no `app/overview/` route"* names the path in backticks just as surely as
  claiming it exists. Four `DELIBERATE` entries now carry their reason.
- **Not exercised:** existence only. The check does **not** verify that the description beside a path is
  accurate — row 232 was caught only because its path was wrong too. A row naming a real file while
  describing behaviour it does not have still passes.

### [platform] Q-553 — a Known Issue was in both the live list and the resolved archive; nothing checked

- **Status: FILED AND FIXED in the same PR** (docs + a new CI check). Kept as the record of the class.
- **Added:** 2026-08-18 · review sweep ·
  [`docs/reviews/2026-08-18-known-issue-duplication.md`](reviews/2026-08-18-known-issue-duplication.md)
- **The invariant nothing enforced.** `CLAUDE.md`: *"Striking a Known Issue means MOVING it … Cut the
  entry whole, append it to the archive, **leave nothing behind**."* Two entries were in both lists.
- **Q-139 — `🔴 OPEN` live and `✅ fixed` archived, for ten days.** `projectOverview.md` carried 69
  lines describing the bug as unfixed while the archive recorded it fixed 2026-08-08 in v1.270.25.
  **Every session's mandated orientation read showed a red, highest-severity open issue for a
  ten-day-old fix.** Both halves verified fixed **in source**, not taken on the archive's word — the
  backstop the live row called still-open is closed at
  `packages/shared/src/health/step-estimate.ts:176`, whose comment names Q-139.
- **Q-81 — a byte-identical 31-line entry in both files.** A pure copy.
- **⚠️ Both were also archived *early*.** `CLAUDE.md` says only move when nothing is owed, *including a
  pending device check* — and both entries say one is outstanding (Q-139: not verified on device;
  Q-81: whether the model fits the owner's real data). So the mistake was two-part: **copied rather
  than moved, and moved before it was allowed.**
- **Applied here:** cut the premature archive copies and kept the live entries (the conservative
  direction — the live list is what everyone reads and where an owed check belongs). Q-81's copy was
  identical so nothing was lost; Q-139's unique material was folded into the live entry first, and its
  stale 69-line `🔴 OPEN` body replaced with a compact `⚠️ FIXED, not verified on device` row.
  `docs/domains/activity/README.md` had the same stale claim (*"needs one owner decision"*, which had
  been made) — updated.
- **The check:** `scripts/check-known-issue-duplication.js`, now step **41 of 41** in Custom Rules.
  **Its first version reported 4 and only 2 were real**, so two narrowings are written into its header:
  a heading's identity is its **first** Q number (an archive heading may name a second issue in
  passing), and **range headings are skipped** (a batch row spanning `Q-63…Q-69` overlapping one
  archived member is a stale range wanting a human, not a red build).
- **Not exercised:** static reconciliation. Q-139's own outstanding item is an on-device check after the
  next history drain, and Q-81's needs production — neither possible here.

### [platform] Q-552 — two sources of truth for the next Q band; the prose one was wrong

- **Branch:** `docs/q-block-ledger-procedure` · **(fixed in the same PR that filed it — see below)**
- **Added:** 2026-08-18 · review sweep ·
  [`docs/reviews/2026-08-18-card-429-reproduction.md`](reviews/2026-08-18-card-429-reproduction.md)
- **Placement:** already actioned; kept as the record of *why* the procedure changed.
- **The near-miss.** Review's band 450–499 was exhausted by Q-499. `docs/agents/README.md` says
  *"claim the next block of 50 above 529"* — which literally gives **530–579** and collides with
  **fourteen numbers already in use**. The predecessor baton had already written 530–579 into the
  handover, so the next session would have taken it.
- **The ledger recorded 530–537, 538–542 and 543. `544–551` were also live** — across
  `docs/handoff-2026-08-18-platform-db-storage-and-device-primary-compute.md`,
  `docs/handoff-2026-08-18-platform-database-reclaim.md`, `docs/overview/history-2026-08-15.md`,
  `docs/domains/devices/README.md` and this backlog — and appeared nowhere in it.
- **⚠️ Correction to the first draft of this entry, which said the ledger is "the only defence". It is
  not, and the truth is more interesting — there are TWO sources for the same fact:**
  | Source | Said | Status |
  |---|---|---|
  | this file → *Live pointers* → "Next unallocated Q band" | **552** | ✅ correct, **CI-enforced** by `scripts/check-backlog-pointers.js` |
  | `docs/agents/README.md` prose ledger + "next block of 50 above 529" | **530** | ❌ stale — omitted 544–551 |
  The machine-checked pointer was right the whole time. **The collision was reachable only by
  following the README's prose instruction** — which is what the README tells you to do, and what the
  Review baton had already copied.
- **The check earns its place:** claiming 552 without updating the band table **failed Custom Rules**
  with *"Q-552 is in use but the next unallocated band starts at 552 — a band was used without being
  recorded."* It caught this in the same PR.
- **Third confirmed instance of Q-492's thesis** — *a count in prose is a claim with a decay date; a
  count in a script is a fact* — and the first where the checked copy was silently **right** while the
  prose copy was silently **wrong**.
- **Fixed in this PR:** claimed **552–601**, recorded **544–551** retroactively, bumped the pointer to
  **602**, and pointed the instruction at the checked source — *read the "Next unallocated Q band"
  pointer, not the prose list; then record your block in both.*

### [app-shell][health] Q-499 — self-fetching cards cannot tell "no data" from "the fetch failed"

- **Branch:** `fix/card-fetch-error-states`
- **Added:** 2026-08-18 · review sweep (three lenses) ·
  [`docs/reviews/2026-08-18-silent-card-failures.md`](reviews/2026-08-18-silent-card-failures.md)
- **Placement:** low-medium. Cosmetic in the common case. The sharp edge is diagnosability: a
  rate-limited or erroring card is **indistinguishable from an empty one**, which makes an owner
  report of *"the card is gone"* unanswerable.
- **⚠️ One correction to `CLAUDE.md`'s premise.** The rule says `cachedFetch` *"swallows `!res.ok`"*.
  It does **not** unconditionally — `cachedFetchCore` accepts
  `onError?: (info: CacheFetchErrorInfo) => void`. It swallows *unless the caller opts in*. That makes
  this a **coverage** problem with an existing mechanism, not a missing capability, and the rule's
  wording should name `onError` so the next reader knows the hook is there.
- **Adoption:** 78 components call `cachedFetch`; **18 reference `onError`** — an upper bound, since
  some are unrelated matches (`components/ai/code-block.tsx`, `components/ai/response.tsx`).
- **Verified by hand, two instances:**
  - `components/health/hr-recovery-profile-card.tsx` — `cachedFetch` at :48 with no `onError`, then
    `:57 if (!profile || profile.bands.length === 0) return null`. `profile` stays `null` on failure,
    so a failed request and an empty profile render identically.
  - `components/health/strength-progress-card.tsx` — `:36 ).catch(() => {})` (the smell `CLAUDE.md`
    names), then `:40 if (withData.length === 0) return null`.
- **Scoped honestly:** a crude filter produced **12** candidates; **2 were verified**. The other ten
  are a **worklist, not a defect count** — several `return null` paths there are legitimate empty
  states, and telling them apart needs per-file judgement.
- **Why it matters more than it looks:** `cachedFetch` treats **any** `!res.ok` alike, **including a
  429 from the app's own rate limiter**. A user who trips a limit watches health cards vanish instead
  of seeing "try again in a minute", and the same silence covers a 500. Offline it is worse —
  `cachedFetch` cannot revalidate at all.
- **Fix:** pass `onError` and render a compact error state. In-repo references that already do it:
  `components/health/observed-hr-card.tsx`, `components/workout/workout-load-error.tsx`. Amend the
  `CLAUDE.md` wording in the same PR.
- **✅ REPRODUCED 2026-08-18 (sweep 34) —
  [`docs/reviews/2026-08-18-card-429-reproduction.md`](reviews/2026-08-18-card-429-reproduction.md).**
  Forced `/api/weights-summary` to 429 by Playwright route interception at the S25 viewport:
  **`Estimated 1RM` went from 1 node at baseline to 0 under the 429, with no error wording anywhere on
  the page.** **The control holds** — blocking a *different* endpoint (`/api/oura/stats`) in the same
  harness left it at 1, so the disappearance is caused by blocking that card's own endpoint, not by
  the interception. (`Ring Status` is **inconclusive**, not clean: absent at baseline too.)
- **⚠️ The vanish is invisible on a warm cache and appears on a cold one.** A repeat visit paints the
  seeded value and the failed refresh is silent; a first visit has no seed and the card is gone. So
  the person most likely to hit it is opening the app fresh, and least likely to reproduce it a minute
  later — which makes *"the card is gone"* **intermittent-looking**, inviting the "can't reproduce"
  dismissal that `CLAUDE.md`'s report-invalidation rule exists to prevent.
- **A paste-ready reproduction spec is in the review doc.** Deliberately not committed as a test: it
  asserts the *correct* behaviour and is red today, so it belongs in the fix PR, not before it.
- **Still not exercised:** on device (APK WebView + native local store) and offline, where
  `cachedFetch` cannot revalidate at all. Only **one** card is proven; the other eleven remain a
  worklist.

### [platform] Q-497 — a 31-day range that passes every guard makes two admin routes loop forever

- **Branch:** `fix/shift-date-str-year-padding`
- **Added:** 2026-08-18 · review sweep (admin date-range routes) ·
  [`docs/reviews/2026-08-18-admin-range-loop-termination.md`](reviews/2026-08-18-admin-range-loop-termination.md)
- **Placement:** medium. **Admin-only** — a session cookie or the `ADMIN_EXPORT_SECRET` bearer — so
  not an unauthenticated vector. Weigh it as *"one mistyped year takes the app down"*, not an attack.
- **The defect.** `for (let d = start; d <= end; d = shiftDateStr(d, 1))` compares **strings**.
  `shiftDateStr` builds its year from `getUTCFullYear()` with **no width padding** (month and day both
  get `padStart(2,'0')`; the year is the one field without it), so one day after `9999-12-31` is
  `10000-01-01` — and `'10000-01-01' <= '9999-12-31'` is **true**, because `'1' < '9'`.
- **Every guard passes on the way in** for `from=9999-12-01&to=9999-12-31`: `normalizeDateParamIso`
  accepts both, `end < start` is false, and the span is **31 — exactly `MAX_RANGE_DAYS`**.
- **Measured**, replicating the loop verbatim:
  ```
  iter 31 d = 9999-12-31
  iter 32 d = 10000-01-01     <-- should have exited here
  ...still looping at iteration 5000 d = 10013-08-08
  CONTROL (2026-08-01..31): 31 iterations — terminates correctly
  ```
  It exits only once the year reaches five digits starting with `9` — ~80,000 years, ~29M iterations.
  Each is a `buildDayAudit`, which the route's own comment puts at **~12 queries**, against a
  `max: 10` pool.
- **The irony is the comment directly above the loop:** it explains the days run sequentially rather
  than concurrently because fanning out *"would starve the rest of the app (the failure mode that took
  production down in session 165)"*. The sequential loop avoids that — and then never stops.
- **Two sites, and the second one writes.** Three loops use `shiftDateStr` as the increment:
  `admin/day-review:118` ❌ (read-only), `admin/backfill-derived-scores:80` ❌ (**identical guards,
  identical loop, and `dryRun=false` commits** — an unbounded write, not just a hang),
  `lib/health/energy-balance-service.ts:152` ✅ safe (start is derived by shifting *back* from the
  user's today, so it cannot reach the boundary).
- **Fix — not a year bound, that treats the symptom.** Pad the year in `shiftDateStr`
  (`padStart(4,'0')`), the single place that produces the malformed value: it fixes both call sites at
  once and is the one-formula-one-place answer. Cheap belt-and-braces: an iteration cap of
  `MAX_RANGE_DAYS` in both loops, so a future ordering bug degrades to a truncated response, not a hang.
- **Not exercised:** the loop was reproduced verbatim in isolation rather than by hitting the route —
  deliberately, since driving it against a running server *is* the hang and the point was proven.

### [devices][platform] Q-493 — the ingest brute-force gate is bypassed by rotating one request header (7 sites)

- **Branch:** `security/client-ip-from-trusted-hop`
- **Added:** 2026-08-18 · review sweep (secret-gated ingest, driven for real) ·
  [`docs/reviews/2026-08-18-health-connect-ingest.md`](reviews/2026-08-18-health-connect-ingest.md)
- **Placement: high.** It defeats a mitigation (SEC-I3) written specifically to stop this, on the
  **only unauthenticated write into `body_metrics`**, and the same pattern guards the bearer path to
  the owner's full health history.
- **The defect.** Every limiter keys on `x-forwarded-for`'s **leftmost** hop — the value the *client*
  supplied (a proxy appends its peer to the right). The caller therefore chooses the rate-limit key.
- **Measured**, 30 wrong-secret attempts each way, limit 20/60 s. Both return 401 throughout (by
  design), so the observable is `rate_limits`:
  - **fixed** `X-Forwarded-For` → **1 key, count 20** — gate engaged, 10 attempts blocked.
  - **rotating** → **30 keys, count 1 each** — **all 30 reached the secret compare.**
- **Seven sites:** `health-connect/ingest`, `admin/day-review` (bearer → full health history),
  `admin/db-query` ×2, `auth/register`, `auth/exchange-mobile-token`, `status`.
- **Nothing in the docs records this, and the R1 security-hardening plan *propagated* it** — the
  `status` route was added keyed by `x-forwarded-for` *"matching the existing pattern in
  `auth/register` and `auth/exchange-mobile-token`"*.
- **⚠️ Not verified:** whether Railway's edge proxy sanitises the header before the app sees it. Not
  determinable from the sandbox, and probing production's limiter was not done unasked. The
  code-level bypass is proven; production exploitability turns on that one unknown. **The fix does
  not depend on it** — the leftmost hop is untrustworthy under the header's own semantics regardless.
- **Fix:** one shared helper deriving the client IP from the **rightmost** hop or a configured
  trusted-proxy count — the treatment `safeCompare` already has. Seven call sites should not each
  re-decide this.

### [devices][body] Q-494 — a far-future ingest date permanently captures every "most recent" read

- **Branch:** `fix/ingest-date-range-bounds`
- **Added:** 2026-08-18 · review sweep ·
  [`docs/reviews/2026-08-18-health-connect-ingest.md`](reviews/2026-08-18-health-connect-ingest.md)
- **Placement: high.** Single request, permanent, silent, and it corrupts a value feeding the scale
  pipeline and every activity-calorie estimate.
- **Measured.** The regex bounds the date's shape, nothing bounds its range:
  ```
  before: getMostRecentConfirmedWeightKg -> 2026-08-18, 81 kg
  POST {"date":"9999/12/30","weightKg":499} -> {"success":true}
  after:  getMostRecentConfirmedWeightKg -> 9999-12-30, 499 kg
  ```
  `ORDER BY date DESC LIMIT 1` answers **499 kg until the year 9999**; no later write can outrank it.
  Two readers use that shape: `getMostRecentConfirmedWeightKg` (BLE-scale confirmation) and
  `deriveActivityKcal` (multiplies body weight into activity calories).
- **The ranked source merge cannot help, and the reason is worth keeping.** `health-source.ts` ranks
  per **column, per date** — it stops a worse source overwriting a better one *on the same day*. A row
  on a date nothing else ever writes has no competitor, so rank 1 (`health_connect`, the lowest) wins
  outright. The documented protection is orthogonal to this, not weak against it.
- **⚠️ This is not a novel class — it is the one ingest path that never got the fix its siblings have.**
  `packages/shared/src/validation/ingest-clock.ts` already exists for exactly this
  (`INGEST_PAST_TOLERANCE_MS` 7 d, `INGEST_FUTURE_TOLERANCE_MS` 60 s, `resolveMeasuredAt`), and the
  workout path has its own parallel guard `resolveCompletedAt` from **Q-24 §7** — whose comment says
  `completedAtMs` *"was accepted unbounded and uncompared"*, the same sentence that describes `date`
  here. Coverage: `scale-ble/samples` ✅, `oura-ble/samples` ✅ (downstream, via `step-day-buckets.ts`),
  `complete-workout` ✅, **`health-connect/ingest` ❌ — none, anywhere in its chain.** The
  sibling-surface rule was missed twice: once when `resolveMeasuredAt` was written, once at Q-24 §7.
- **Fix:** route the ingest date through the existing **`ingest-clock`** module rather than adding a
  bespoke range check — the one-formula-one-place answer, and it inherits the reconcile-don't-reject
  behaviour the other paths chose (`resolveCompletedAt`'s comment argues that case and it applies
  verbatim: a 400 would quarantine the outbox mutation and lose a real reading over a bad clock).
  **Caveat:** `resolveMeasuredAt` takes an *instant*, this route takes a *calendar date* in the user's
  timezone — the bound belongs on the resolved date against the user's today, not on a UTC instant.
- **Wider lens, checked:** 10 `desc(...).limit(1)` "latest X" readers exist; the other 9 read
  server-derived or device-monotonic columns, and `workoutSessions.completedAt` — the one that *was*
  exposed — is now guarded. **`bodyMetrics.date` is the only unguarded one.**

### [devices] Q-496 — a regex-passing but invalid ingest date returns 500 and writes an `error_events` row

- **Branch:** `fix/ingest-date-semantic-validation`
- **Added:** 2026-08-18 · review sweep ·
  [`docs/reviews/2026-08-18-health-connect-ingest.md`](reviews/2026-08-18-health-connect-ingest.md)
- **Placement:** medium. Needs the secret, so not an open spam vector — but it makes the fault table
  every session is required to read less trustworthy.
- **Measured:** `2026-13-45`, `2026-02-31`, `0000-00-00` each → **HTTP 500** plus an `error_events`
  row (`[pg 22008]`). The regex accepts any `\d{4}[-/]\d{2}[-/]\d{2}`, so month 13 and day 45 pass
  validation and fail at the driver.
- **This is the class `normalizeDateParam` exists to prevent.** `CLAUDE.md` lists the routes
  retrofitted with that guard; this one is not among them. A client input error is being recorded as a
  server fault.
- **Fix:** route the param through `normalizeDateParam` and return 400. Shares a location with Q-494.

### [devices] Q-495 — `z.coerce.number()` launders `[]`, `true` and `""` into stored readings

- **Branch:** `fix/ingest-no-coercion`
- **Added:** 2026-08-18 · review sweep ·
  [`docs/reviews/2026-08-18-health-connect-ingest.md`](reviews/2026-08-18-health-connect-ingest.md)
- **Placement:** low. Needs the secret, writes at the lowest rank, and produces implausible rather
  than dangerous values.
- **The route's own comment is accurate about what it tested and silent about coercion.** It says the
  bounds *"reject clearly-garbage values (a stringified `75kg`, a 1e308 double)"* — **both named
  examples are indeed rejected.** Three unnamed ones are not: `"steps":[]` → **0**, `"steps":true` →
  **1**, `"weightKg":""` → **0 kg**. Each landed in `body_metrics` stamped `health_connect`; a 0 kg
  body weight is in range for `.min(0)`.
- **Fix:** `z.number()` rather than `z.coerce.number()` (Tasker sends real JSON numbers), or reject
  non-primitive input before the bounds. Give body weight a plausible floor, not zero.

### [platform] Q-492 — seven of nine hand-typed counts in `CLAUDE.md` are stale; every script-backed one is current

- **Branch:** `docs/claude-md-counts-cite-the-command`
- **Added:** 2026-08-18 · review sweep (documentation self-maintenance) ·
  [`docs/reviews/2026-08-18-claude-md-prose-counts.md`](reviews/2026-08-18-claude-md-prose-counts.md)
- **Placement:** medium. Docs-only and cheap, but `CLAUDE.md` is the file every session reads before
  it may start, so a wrong number there is read by five concurrent agents before any code is touched.
- **The measurement.** Every checkable count in the file, re-derived against `main` at `63fb89c`:
  - **Script-backed: 3 of 3 current** — sparkline (3 inline / 6 exempt), `Ran 40 of 40` custom rules,
    the rollup vitest glob.
  - **Prose: 7 of 9 stale** — hex literals **471 → 428**; the >800-line hotspot list still names
    `more/profile-tab.tsx` (**476 lines**); `health-sections.tsx` 795 → **777**; the script glob
    "22 of 33" → **29 of 40**; `READINESS_SCORE_TTL` "four sites" → **6**; suite "448 files" →
    **504**; the nine chevron paths (already Q-491). Two prose counts *are* right (score-band 17,
    "11 inline grep rules") — the correlation is strong, not absolute, and is recorded that way.
- **Two items that are more than drift:**
  - `more/profile-tab.tsx` **should already have been struck** — the same paragraph mandates removing
    a hotspot that drops under the line, and cites `health-sections.tsx` being removed on 2026-08-09
    for exactly that. The procedure was followed once, then not again.
  - **The rollup-glob maintenance command cannot detect what it is for.** `CLAUDE.md:976` says keep
    the glob in step with `grep -rl aggregateOuraRawSamples lib/data/postgres/__tests__/`, to catch
    "a new rollup test outside it". But it is scoped to the directory the glob covers, so it can only
    confirm the glob against itself; and `grep -l` matches comments (it reports two files that never
    call the function). **Both defects are latent** — no test outside the glob actually calls the
    rollup today. Nothing is mis-timed; the procedure just would not fire when needed.
- **One ratchet with slack.** `check-component-size.js` is shrink-only; four baselines are exact,
  `components/workout-screen.tsx` is pinned at **1850** against an actual **1831** — 19 lines of
  regrowth that would pass silently.
- **The fix is not "correct the seven numbers"** — that resets the decay clock for about a week. For
  each count, **cite the command or delete the number and keep the rule**. The file already contains
  the model, in its own sparkline paragraph: *"Don't hand-count from `grep -rn '<polyline'`; run
  `node scripts/check-sparkline-primitive.js`, which is the maintained list."* `check-hex-literals.js`
  and `check-component-size.js` both already print their own totals.
- **Scope:** `CLAUDE.md` (rewrite each count as a command citation); optionally lower the
  `workout-screen.tsx` baseline to 1831 and broaden the rollup grep to repo-wide + call-site-aware.
- **Not exercised:** static verification only, no runtime or device.

### [app-shell] Q-491 — nine collapsible toggles still ship no `aria-expanded`, and the hand-maintained list of them has drifted

- **Branch:** `fix/aria-expanded-collapsibles-ratchet`
- **Added:** 2026-08-18 · review sweep (control semantics) ·
  [`docs/reviews/2026-08-18-aria-expanded-collapsibles.md`](reviews/2026-08-18-aria-expanded-collapsibles.md)
- **Placement:** low. **No known screen-reader user today.** Filed because the stated direction is a
  **Play Store listing**, where accessibility is a review surface rather than a preference, and
  because the recommended fix is a ratchet that removes a maintenance burden rather than adding one.
- **Still 9, but not the same 9.** `CLAUDE.md` names a specific nine (re-counted 2026-08-09). Re-checked:
  - **`more/profile-tab.tsx` is fixed** — 0 chevrons remain.
  - **`components/weights-summary.tsx` has the defect and was never on the list.**
  - `deload-explanation` and `signal-sections` **moved** (`app/session-select/components/`,
    `app/session-explain/components/`) — the paths in the rule are stale.
  - The other six are unchanged: `health/day-overlay-sheet`, `workout/active-workout-screen`,
    `workout/ai-prescription-card`, `workout/added-weight-toggle`, `nutrition/meal-card`,
    `nutrition/saved-meals-sheet`.
- **One partially compensates:** `weights-summary.tsx` carries
  `aria-label={collapsed ? "Expand" : "Collapse"}`, so state does reach a screen reader — just not
  through the attribute that also expresses the control→region relationship. Better than the other
  eight; still not the rule.
- **Fix shape — prefer the ratchet over the sweep.** Adding `aria-expanded={isOpen}` (+ `aria-controls`
  where the region has an id) to nine sites is easy and will drift again. `CLAUDE.md`'s own rule says
  to prefer Radix `Collapsible`, **which supplies both attributes for free** — converting the worst
  offenders is the better trade. Then add a Custom Rules step counting chevron collapsibles without
  `aria-expanded`, shrink-only, so the list stops needing a human.
- **⚠️ The pattern is worth more than the finding — third stale hand-maintained count this run:**

  | Rule | Recorded | Actual |
  |---|---|---|
  | *"Repo day-window helpers currently hardcode `DEFAULT_TZ`"* (**Q-480**) | broken | a parameter every caller passes |
  | *"both long-standing memos in the codebase"* (**Q-490**) | 2 | **66** |
  | *"9 hand-rolled chevron toggles"* (this) | a specific 9 | a **different** 9 |

  Every **ratcheted** count is current — hex literals, TTL divergence, component size, doc-index size,
  backlog pointers. `CLAUDE.md` already drew this lesson for hex literals (*"recorded here as improving
  and it was not … because this line was prose and nothing measured it"*); it applies to its own prose.
  **A count in prose is a claim with a decay date; a count in a script is a fact.** Consider a
  standing follow-up to replace remaining prose counts with script citations.
- **Lane B owns this** (`components/**`, `app/**` surfaces); the ratchet script is a `scripts/` addition.
- **Not verified: no screen-reader testing.** The claim is that the attribute is absent, not that a
  specific announcement is wrong. Not on the APK, where TalkBack is the relevant reader.
  `app/coach/coach-content.tsx` was examined and **excluded** — its chevron is a back button.

### [platform] Q-480 — a `CLAUDE.md` line marks the repository layer as timezone-broken; it is the reference pattern instead

- **Branch:** `docs/claude-md-repo-tz-line`
- **Added:** 2026-08-18 · review sweep (server-side verification) ·
  [`docs/reviews/2026-08-18-server-tz-and-rate-limit-verification.md`](reviews/2026-08-18-server-tz-and-rate-limit-verification.md)
- **Placement:** low. A one-clause documentation correction — but a load-bearing one, because it
  misdirects anyone picking up **Q-477**.
- **The line**, in the Date Arithmetic section:
  > *"Repo day-window helpers currently **hardcode** `DEFAULT_TZ` — thread the session tz through when
  > touching them, and never re-declare `DEFAULT_TZ` locally."*
- **They do not hardcode it — they take it as a default parameter, and every caller passes the session
  timezone:**

  | Helper | Callers | Threads tz? |
  |---|---|---|
  | `getCalendarData(…, timezone = DEFAULT_TZ)` | `app/api/calendar-data` | ✅ |
  | `getRecentTrainedDays(…, timezone = DEFAULT_TZ)` | `app/api/streak-data` | ✅ |
  | `getNextSession(…, timezone = DEFAULT_TZ)` | 5 sites incl. `lib/ai-chat/tools.ts` | ✅ at all 5 |

  A default every caller overrides is a safety net, not a hardcoded value.
- **Why the stale line costs something.** It marks `lib/data` as a known-broken area, so an
  implementer taking Q-477 (the client-side timezone sweep) starts there, finds nothing, and a
  reviewer treats a repo call site as suspect when it is in fact the pattern to copy.
- **The other half of the same sentence is holding** — zero local re-declarations of `DEFAULT_TZ`
  outside `packages/shared/src/date-utils.ts`. Keep that clause verbatim.
- **Fix:** replace the "currently hardcode" clause with what is true — the helpers *default* to
  `DEFAULT_TZ` and every current caller threads the session tz; keep the instruction to keep doing so,
  since the default is what makes forgetting silent.
- **Filed rather than edited directly** because `CLAUDE.md` is the contract all five agents read, and
  a Review agent quietly rewriting a rule line is a change the other four should see come through the
  queue. Any lane can take it.
- **Verified alongside, and worth keeping in the entry so it is not re-derived:** all 4
  timezone-sensitive SQL sites in `lib/data` interpolate a parameter (no hardcoded zone string
  anywhere in the repository layer), and every caller of the shared sleep helpers
  (`nightSessions`, `isNightWindow`, `sleepScoreBaselines`, `sleepDurationTrend`, `sleepScoreTrend`)
  passes `tz`. **This bounds Q-477 to the client** — its fix does not need to touch `lib/data` or
  `packages/shared/src/health`.

### [app-shell][platform] Q-477 — the Profile "Auto-detect timezone" button is what breaks the app's dates: the server honours the new zone, 100 of 125 client call sites do not

- **Branch:** `fix/client-today-uses-user-timezone`
- **Added:** 2026-08-18 · review sweep (non-default-timezone lens) ·
  [`docs/reviews/2026-08-18-timezone-non-default-user.md`](reviews/2026-08-18-timezone-non-default-user.md)
- **Placement:** upper-mid. **Latent today** — every user row is `Australia/Brisbane`, so nothing is
  broken in production — but the app ships the button that triggers it, and the fix wants a ratchet
  before the count grows further.
- **The inversion worth reading first.** While a user is on `Australia/Brisbane`, client and server
  both compute Brisbane and agree; nothing is wrong. **Setting the timezone is what introduces the
  bug** — the server moves immediately, the client does not.
  `components/profile/edit-profile-sheet.tsx:190` exposes an **"Auto-detect timezone"** button, so the
  intended one-tap action for anyone not in Brisbane is exactly the action that desynchronises them.
- **Measured** with a user set to `Pacific/Kiritimati` (UTC+14) and re-logged-in so the JWT carried it,
  at a moment when three calendar dates were live (Midway 08-17, UTC/Brisbane 08-18, Kiritimati 08-19):

  | Layer | Expression | Value | |
  |---|---|---|---|
  | Server routes | `todayInTz(tz)` | 2026-08-19 | ✅ |
  | Client, **25** sites | `todayInTz(tz)` via `useUserTimezone()` | 2026-08-19 | ✅ |
  | Client, **91** sites | `todayInTz()` → `DEFAULT_TZ` | 2026-08-18 | ❌ |
  | Client, **9** sites | `localDateString()` → the *device's* zone | 2026-08-18 (here) | ❌ |

  Live: `POST /api/day-checkin` (no date) → `"logDate":"2026-08-19"`; `GET /api/workout-data?tab=<id>`
  → `"dataDate":"2026-08-19"`.
- **Observed on screen**, Health → Training as that user: the **Training Calendar highlights 18** and
  Training Load highlights **"Tue"**, on a day that was Wednesday the 19th for them. Source:
  `components/calendar-widget.tsx:110`, `const todayStr = localDateString()` — the *device's* zone, a
  third answer that follows neither the user's setting nor the server. `CLAUDE.md` already warns
  *"Client code has two 'today' sources … Pick one per feature"*; there are three.
- **Nothing is missing except the argument.** `useUserTimezone()`
  (`components/shell/user-timezone-provider.tsx:40`) is a context available anywhere in the tree, and
  `components/profile/goals-section.tsx:114` already calls `todayInTz(user?.timezone)` correctly.
- **Fix shape — ratchet first, then sweep by surface:**
  1. **A Custom Rules step rejecting a bare `todayInTz()` / `localDateString()` in client code**, with
     a shrink-only per-file baseline — same shape as `check-hex-literals.js` and
     `check-cache-ttl-divergence.js`, both of which exist because prose alone did not hold a count.
     That freezes the number at 100 and puts every future addition in a diff.
  2. Sweep highest-visibility first: the calendar today-marker, then write paths, then display.
     **Q-478 is done** (2026-08-18) — the two cache today-guards now take a `tz`, and
     `scripts/check-tz-aware-cache-guards.js` keeps every call site passing one. Its ratchet is a
     narrower shape than step 1 asks for: it guards two named helpers, not bare `todayInTz()`.
     Step 1 is still owed.
  **Do NOT** make `todayInTz`'s default throw or read a global — the function is shared with server
  code that passes `tz` explicitly, and a global reintroduces the ambiguity somewhere harder to see.
- **Lane B owns the sweep** (`app/**` ex-`app/api`, `components/**`, `lib/hooks/**`); the CI ratchet is
  a `scripts/` addition either lane can carry, but it should land **first** and on its own.
- **Not verified on:** the APK — and note the 9 `localDateString()` sites read the *phone's* zone
  there, a third value this harness cannot reproduce. Not against production, where every user is
  Brisbane and the symptom does not arise.

### [platform] Q-549 — Postgres holds 0.79 GB to serve 171 MB, at 0.002 vCPU

- **Plan:** [`docs/superpowers/plans/2026-08-18-device-primary-compute.md`](superpowers/plans/2026-08-18-device-primary-compute.md) section 1
- **Branch:** `perf/postgres-memory-footprint`
- **Added:** 2026-08-18 · **Lane A.** Largest single line item on the bill and near-zero risk.
- **Measured (Railway, ~19.6 days to 2026-08-18):** `prod_DB` averages **0.79 GB RAM** and **0.002
  vCPU** — **$7.87/month of memory for a database that does essentially no work**, against 171 MB of
  data. Its own CPU graph is flat at 0.0 across a 3-hour window.
- **Candidates:** `shared_buffers` sized for the container rather than the data; the app pool is
  `max: 10` and the rollup worker carries its own `PG_POOL_MAX=2`, so up to 12 backend processes each
  with their own memory. `work_mem` is already 4 MB (noted on Q-534) and is not the problem.
- **Careful with the "it's only 200 MB now" reading.** The 3-hour graph taken 2026-08-18 shows ~200 MB
  **climbing** — the service had just restarted during the volume incident and Postgres memory grows as
  caches warm. **0.79 GB is the warmed steady state and will return.** Measure over a full day, not
  after a restart.
- **Load-bearing constraint (`CLAUDE.md`):** total connections = `max` x replicas must stay under the
  Railway connection limit, and the pool's error handler and timeouts must survive any change here.

### [platform] Q-551 — OWNER DECISION: stay on Railway or leave, once the D-track has shrunk the server

- **Plan:** [`docs/superpowers/plans/2026-08-18-device-primary-compute.md`](superpowers/plans/2026-08-18-device-primary-compute.md) section 8
- **Added:** 2026-08-18 · BLOCKED: owner, and deliberately **after** Q-545.
- **The owner's stated goal:** *"The Goal was to move off railway if there were enough benefits"*, with
  a target of **under $5/month** against today's ~$18.63.
- **Do not decide this yet.** Q-545 moves the compute to the phone and shrinks the server to a thin
  store, which changes the comparison materially — and Q-547 found that **a large share of the current
  bill is deploy churn from two lanes shipping**, not steady-state cost. Deciding on today's numbers
  would be deciding on an inflated, pre-fix baseline.
- **What each side looks like, to be re-costed when the time comes.** *Stay:* realistic floor ~$8/month
  after Q-545 + Q-549; keeps managed deploys, backups and the git-push workflow. *Leave:* a small VPS
  (Hetzner CX22 class, ~4 EUR/month, 2 vCPU / 4 GB / 40 GB) runs both services with far more headroom
  and lands near the target — at the cost of owning backups, TLS, deploys and the Postgres that is
  currently managed. **Weigh that against 2026-08-18**, when a staged volume change took `prod_DB`
  offline and Railway's own tooling recovered it.
- **One hard input either way:** Railway **cannot shrink a volume** and bills on storage *used*, so the
  5 GB provisioning is free and is not a reason to move.

### [devices][platform] Q-545 — OWNER-DIRECTED FOCUS: move the Oura rollup onto the device (D2 Task 5) — the D-track's missing middle

- **Plan:** [`docs/superpowers/plans/2026-08-18-device-primary-compute.md`](superpowers/plans/2026-08-18-device-primary-compute.md)
- **Branch:** `feat/device-rollup-port`
- **Added:** 2026-08-18. **Owner-directed: "do the D-track first, that should have a lot of focus."**
- **Lane A.** `lib/oura-ble/**`, `lib/data/**`, `lib/local-store/**`. JS/server + client; no Kotlin.
- **The gap, in the owner's words:** *"I assumed all the ring data would go directly to the phone and
  once it's aggregated and calculated it sends to DB."* That is the D-track north star verbatim. Today
  it is inverted — the phone ships raw frames up and **Railway** decodes them and runs SleepNet.
- **Why it is a port, not a rewrite — measured 2026-08-18:** `aggregateOuraRawSamples` is
  `adapter.ts:4958-6067`, **1,110 lines, of which only 17 touch `this.db`/`.select(`/an `oura.*` slice
  helper.** The rest is computation over already-shared helpers (`sleepNet`, `computeDailySummaries`,
  `computeSleepScore`, `computeResilienceForDay`, `computeStepsByDay`, `resolveDsToMs`,
  `decodeEventBody`). Extract it behind a small `RollupIO` port with two implementations — Postgres and
  local SQLite. **Do not hand-write a second device rollup**; that is the duplicate-implementation bug
  `CLAUDE.md`'s One Formula, One Place rule exists to prevent.
- **Half the device side already exists and is inert.** D2 Task 1 shipped
  `upsertOuraDailySummary`/`upsertOuraBucket`/`upsertOuraHeartrate` to `LocalStore`; Tasks 2-3 shipped
  the native store and the `getUnrolledRaw`/`markRolledUp` bridge, **device-verified**. A repo-wide grep
  finds **no caller** for either bridge method. The device drains and stores correctly, then nothing
  consumes it.
- **It closes Q-538 as a side effect.** Measured on device 2026-08-18: 209,326 rows, **0 rolled up**,
  31.2 MB. `pruneRaw` needs `rolled_up = 1`, and `markRolledUp` is what this task finally calls.
- **Safety, non-negotiable:** never `markRolledUp` before the derived forms are durably written locally.
  Marking a frame consumed while its output is unstored frees the pruner to delete raw that produced
  nothing. And **do not touch the ingest writer or the history cursor** — device-verified, and a botched
  change there loses drained spans forever (ops-doc I18/I21).
- **Extraction gate:** the server rollup must produce identical `sleep_sessions`/`body_metrics` output
  over a sample of historical days before and after. The extraction ships **no** behaviour change.

### [platform][devices] Q-546 — WASM cannot instantiate in production: `script-src` has no `wasm-unsafe-eval`

- **Plan:** [`docs/superpowers/plans/2026-08-18-device-primary-compute.md`](superpowers/plans/2026-08-18-device-primary-compute.md) section 4
- **Branch:** `fix/csp-wasm-unsafe-eval`
- **Added:** 2026-08-18 · **Lane A** (`next.config.ts`). Independent of everything else — do it early.
- **Verified today.** `next.config.ts:10` sets `script-src 'self' 'unsafe-inline'` (plus `'unsafe-eval'`
  in dev only) `https://accounts.google.com`. There is no `wasm-unsafe-eval`, so **no WASM session can
  start in production**, and every on-device neural plan (D2 Task 6 — SleepNet + step_counter) is
  blocked behind it.
- **The trap is the one the master plan predicted:** *"the parity test runs under Node (no CSP) and
  would false-green."* `lib/oura-models/__tests__/wasm-parity.test.ts` passes under vitest and proves
  nothing about the device. It is a genuine parity proof against the TorchScript golden and a **useless
  CSP proof**.
- **Fix:** add `wasm-unsafe-eval` to the production `script-src`, then **assert on the S25 that a real
  WASM session instantiates under the deployed header** — a green test is not the gate here, a device is.
- **Security note:** `wasm-unsafe-eval` is narrower than `unsafe-eval` (it permits WASM compilation
  only). State that in the PR rather than letting it read as a blanket eval relaxation.

### [platform] Q-547 — ANSWERED 2026-08-18: the app CPU is spiky (so Q-545 fixes it), and much of it is deploy churn

- **Plan:** [`docs/superpowers/plans/2026-08-18-device-primary-compute.md`](superpowers/plans/2026-08-18-device-primary-compute.md) section 1, Task 0
- **Branch:** *(none — an owner measurement, then a finding)*
- **Added:** 2026-08-18 · **Answered the same day.** No longer blocking. Remaining work is the quiet-window baseline named below.
- **The number.** Railway, ~19.6 days to 2026-08-18: the app averages **0.22 vCPU** and **0.61 GB**
  (**$4.42 + $6.07/month**), against `prod_DB` at 0.002 vCPU. **The app is computing, not waiting on
  queries.** Storage, by contrast, is **$0.12/month, 0.6 percent of the bill** — so the entire
  805 MB to 171 MB exercise moved it by about nine cents.
- **Three hypotheses tested and refuted — do not re-file them:** (a) a server cron — there is none,
  every `setInterval` in the repo is client-side; (b) the rollup re-decoding the 35-day window —
  **Q-213 already fixed it**, a persisted watermark narrows the window to the touched span (see the
  comment at `adapter.ts:4981`); (c) an epoch-mismatched watermark forcing the full window — anchors,
  frames and watermark all read **epoch 0**.
- **What is left.** Drains land ~19x/day for 1-6 active minutes — a ~3 percent duty cycle that **cannot**
  produce 0.22 vCPU sustained. So there is a baseline consumer between drains that source-reading has
  not found in three attempts.
- **MEASURED 2026-08-18 — ANSWERED. It is spiky, so Q-545 is the right fix.** Owner pulled the 3-hour
  graphs. `TrainingAI` CPU sits near **0.0 vCPU between events** and spikes to **1.0-1.2 vCPU** (once
  2.0). Memory tracks it exactly: **~400 MB baseline, spiking to 800 MB-1.2 GB** on the same events —
  the allocation signature of decoding frames and running SleepNet. `prod_DB` CPU is **flat at 0.0**,
  confirming the app computes while the database only holds memory. **Request-driven, not a leak.**
- **A second finding the measurement surfaced, and it may matter more than the first.** The TrainingAI
  charts carry **~12-15 dashed vertical markers in three hours**, each paired with a ~10 MB network
  ingress spike — apparently **deploys**, at roughly 5/hour. Both Implementation lanes have been
  merging continuously and each merge restarts the service (cold start + `instrumentation.ts` schema
  warm-up). **A large share of the measured CPU/RAM is development churn, not steady-state app cost**,
  which means the $18.63/month projection is inflated by an atypical period. **Confirm those markers
  are deploys before trusting any before/after comparison** — and take a baseline during a quiet window,
  not a shipping day.
- **Third correction: `prod_DB` reads ~200 MB and climbing on the 3-hour graph, not 0.79 GB.** It
  restarted during the volume incident and Postgres memory grows as caches warm, so the billed 0.79 GB
  is its warmed steady state and will return. Tuning `shared_buffers` still caps it; the cold reading
  is not evidence the problem went away.
- **Revised expectation, not a promise:** app CPU ~$4.42 → ~$1, app RAM ~$6.07 → ~$4 (the 400 MB
  baseline), DB ~$7.90 → ~$3 tuned. **~$18.63 → ~$8/month.** Reaching $5 needs leaving Railway or
  cutting deploy frequency, not more tuning.
### [platform][nutrition] Q-471 — the double-trip metric counts deliberate rerolls as redundant, and that is the AI-usage screen's top row

- **Branch:** `fix/ai-fingerprint-granularity`
- **Added:** 2026-08-18 · review sweep from **owner-supplied production screenshots** of More →
  Developer → AI usage · [`docs/reviews/2026-08-18-ai-double-trips.md`](reviews/2026-08-18-ai-double-trips.md)
- **Placement:** above Q-470/Q-469, because it decides how those are read. A misleading diagnostic
  sends implementers at the wrong row.
- **What the screen shows (30d):** 268 calls, 89 of them "redundant" (33%), topped by
  `meal-plan-generate-meal` at **32 redundant · 4 distinct**.
- **Why the top row is an artefact.** Redundancy is `(user_id, section, fingerprint)` repeating within
  120 s (`lib/data/postgres/adapter.ts:4489`). Three sections fingerprint on a calorie target alone:
  ```
  meal-plan-generate-meal   String(Math.round(input.targetCalories))
  meal-plan-top-up          String(Math.round(targets.calories))
  meal-plan-generate        `${mealCount}:${dayTypes.join('/')}`
  ```
  Rerolling a meal is the feature working — tap reroll, dislike it, tap again — and every such call
  carries the same rounded calorie target, so **every deliberate reroll after the first counts as
  redundant**. "32 · 4" most plausibly reads as four meal slots rerolled ~8 times each.
- **⚠️ The reroll path is already correctly guarded — do not "fix" it.** `meal-plan-review-step.tsx`
  sets `rerolling` before the fetch and every control carries `disabled={rerolling != null}` (reroll
  icon, instruction submit, both reorder arrows). There is no tap-spam here. This entry exists partly
  to stop someone being sent to that file by the screen.
- **So 44 of the 89 redundant calls (32 + 9 + 3) are artefact; the other 45 are real** (Q-470, Q-469).
- **Fix shape:** fingerprint on what actually distinguishes one request from another — for
  `generate-meal` at least the meal `position` plus `avoidNames` (which already changes on every
  successful reroll); for `meal-plan-generate`, excluded foods and stores. The instrument's rule
  ("ids/dates/keys only, never raw prompt text or health data") still holds — these are ids and keys.
  Alternatively mark user-initiated repeats at the call site, which is the distinction the screen is
  actually trying to draw. **Lane A.**

### [workouts][platform] Q-470 — the background prescription regeneration has a rate limit but no in-flight guard, so a second page-load fires it again

- **Branch:** `fix/prescription-regen-in-flight-guard`
- **Added:** 2026-08-18 · review sweep from owner-supplied production screenshots ·
  [`docs/reviews/2026-08-18-ai-double-trips.md`](reviews/2026-08-18-ai-double-trips.md)
- **Placement:** mid. A real duplicate LLM generation for the same session-day, on the path that
  decides prescribed load.
- **This one is genuine, unlike Q-471's rows.** `prescription` fingerprints on
  `{ programSessionId, today }` (`packages/shared/src/ai-periodization/generate-prescription.ts:295`)
  — stable for one session on one day. **14 redundant across 8 distinct** is therefore the same
  logical prescription generated twice within 120 s.
- **Cause.** `regeneratePrescriptionInBackground` (`app/api/workout-data/route.ts:50-59`) is
  fire-and-forget and called from **two** sites in the same `GET` handler — `:541` when
  `reevalResult.needsRegenerate`, `:561` when `aiPrescriptionPending && !isPoll`. It carries
  `rateLimit('prescribe:${userId}', 20, 60*60*1000)`, which caps a runaway loop but **does not
  dedupe**:
  - `/api/workout-data` is fetched via `cachedFetch`, which paints from cache and **then always
    revalidates over the network** — so every open of the workout screen issues a real GET;
  - until the first background generation lands, `needsRegenerate` / `aiPrescriptionPending` are still
    true, so the second GET starts a second generation for the same session-day.
- **The rate limit is not the bug and should stay** — its comment says it exists to stop "an unattended
  poll loop" minting unlimited Gemini calls, and it does that. It was never an idempotency mechanism.
  Note `:561` already excludes polls via `!isPoll`; `:541` has no such guard.
- **Fix shape:** an in-flight marker keyed on `(userId, programSessionId, today)` — the same key the
  fingerprint already uses — checked before spawning and cleared when the generation settles. A
  process-local `Set` covers the common case; a short-lived DB marker survives multiple replicas,
  which matters because Railway can run more than one. **Lane A.**

### [nutrition] Q-393 — an ingredient breakdown on the printed label, which does not fit on a round one

- **Branch:** `feat/meal-label-ingredient-breakdown`
- **⬆ MOVED TO THE TOP OF THE QUEUE by the owner, 2026-08-18** — *"can this be added to the top
  of the lanes queue - I will test and get back"*. Take this before the numbered items below it.
- **✅ The owner has approved ALL the drawn variants as shippable styles** (*"I like all of these
  ones… lets keep them all as options to cycle through and choose a default"*), so this is no
  longer a pick-one decision — every layout below becomes an entry in the style registry the
  renderer already reads. **The default is the open question, and it is a stored preference:**
  see the Q-392 note further down before choosing where to keep it.
- **Added:** 2026-08-18 · owner: *"could we have a small font showing the break down of the meal i.e
  Pasta / [macros] / (100g pasta, 200g mince, etc etc) so its the full summary of the meal."*
- **Follow-up to Q-389, which shipped 2026-08-18 (v1.320.0)** — the label renderer exists
  (`components/nutrition/meal-label-render.ts`, canvas, four styles, style passed as a parameter),
  so this is a new layout variant inside a working system, not new machinery.

**The measurement first, because it decides the shape.** On a **round** 50 × 50 mm label the usable
area is a centred **130 × 137 px** box, and the shipped default already spends all of it:

```
band header 34 + calories 22 + macros 12 + code 46 + gaps 16  =  130 px
                                                     leaving  =    7 px
```

**That is zero ingredient lines.** A list cannot be added to the round label without removing
something already on it. A **square** label gets the corners back — 171 × 171 usable, **1.64× the
area and 34 px more height** — and a full five-ingredient list fits there comfortably, with the code
moving *beside* the calories rather than under them.

- **⚠ It cannot go in the QR instead.** `packages/shared/src/nutrition/label-payload.ts:22-23` sets
  `QR_V2_M_BYTE_CAPACITY = 26`; the shipped payload is the bare 22-char id, leaving four bytes.
  Q-389's journal records that **a unit test asserts the length against that budget precisely so a
  later "let's also put the name in" fails in CI rather than on paper.** An ingredient list is
  hundreds of bytes. It goes on the paper or it does not go.
- **Data is available and needs no new shape.** `NutritionIngredient`
  (`packages/shared/src/types/nutrition.ts:91-97`) already carries `name` and `weightG`, which is
  exactly "200g Beef mince". For a saved meal it comes from `saved_meal_items` →
  `food_items`; the plumbing to get it as far as the label sheet is the only new work on the data
  side.
- **Three options drawn at true size in the design canvas** (ask the owner for the link):
  1. **Square, full list** — all five ingredients, code beside the calories at 62 px / **0.656 mm per
     module**, the roomiest code of anything drawn for this feature, because the corners paid for it.
     Cost: the artwork does **not** survive a round die, which reverses Q-389's settled
     "one artwork serves both".
  2. **Round, trimmed** — three ingredients then "+2 more — scan", calories and macros merged onto
     one line. **⚠ Forces the code down to 44 px = 0.465 mm per module, below the 0.487 that was
     already the tightest in the set** — so it trades scan reliability for a partial list, and a
     partial list is what the request was trying to avoid.
  3. **Round, scan only** — no list; the code already resolves to the full breakdown in the app.
     Keeps the code and the name at full size.
- **The honest framing for the decision:** the printed list is only worth its cost when reading a
  tub **without** a phone. With a phone in hand, option 3 gives the *whole* breakdown where option 2
  gives three of five lines at 6.5 px. So the real question is not "can we fit it" but "is this label
  read away from a phone" — and if the answer is yes, the round die is what has to give, not the code.
- **✅ Answered 2026-08-18 — two of the owner's follow-up questions, checked against shipped code:**
  1. **"Will the QR work?"** The shipped renderer uses a **real encoder** — `qrcode@1.5.4`,
     `QRCode.create(encodeMealLabelToken(mealId), { errorCorrectionLevel: 'M' })`
     (`components/nutrition/meal-label-render.ts:125`), and its own comment already reasons about
     exactly this: *"the code is 12.2–16.4 mm on these layouts, so ink spread on a home printer is
     the expected failure and M is the level that survives it."* EC level M tolerates ~15% damage,
     which is the margin that absorbs spread. **What is still unproven is the print**, and nobody has
     run one — it is one of the two physical checks Q-389 already owes. **The mockup codes are
     placeholder patterns and will not scan; do not test with those.**
  2. **"Can the image be saved for a label-printer app?"** **Already shipped.**
     `meal-label-sheet.tsx` does `canvas.toBlob(…, 'image/png')` → `navigator.share({ files })`
     behind a "Share or save" button, with `<a download>` as the browser fallback. On Android the
     share sheet is where a label-printer app appears, which is why it was built that way rather than
     as a Capacitor plugin. **No work needed here.**
- **⚠ "Cycle through them and choose a default" is two requests, and the second one is new.**
  Cycling is nearly free — the renderer already takes the style as a parameter and four styles ship,
  so the breakdown variants are more entries in the same registry. But **Q-389 deliberately ships the
  style as picked-at-print-time and NOT stored**, so a *default* is a stored preference — which lands
  straight on **Q-392** (preferences live only on the device). If a label default is written to
  `localStorage` it is lost on the next reinstall, which is the exact complaint that produced Q-392.
  **Build the default on whatever Q-392 settles**, not beside it.
- **✅ SHIPPED 2026-08-18 (v1.323.0, Lane B) — option 1, and NOT option 2.** `square` is now a style
  in the registry: full per-serving ingredient list, code at 70 units, marked **SQUARE** in the
  picker with a standing warning under the preview that a round die crops the list. The preview also
  reports how many ingredients actually printed and how many were summarised, so a truncated list
  cannot ship silently. Guarded by `e2e/meal-label.spec.ts`, mutation-checked — an earlier version of
  that guard **passed** with the ingredient path switched off (the style fell through to the round
  painter and still painted ink), which is why the spec now asserts the reported count.
- **⚠️ CORRECTION, measured — every module-pitch figure in this entry and in Q-389 is ~24% too
  optimistic.** The renderer draws the 4-module quiet zone **inside** the code box
  (`cell = codeW / (moduleCount + 8)`), so the pitch actually printed divides by **33**, not 25:

  | style | code | pitch as documented (÷25) | **pitch as drawn (÷33)** |
  |---|---|---|---|
  | band (default) | 12.17 mm | 0.487 mm | **0.369 mm** |
  | editorial | 13.23 mm | 0.529 mm | **0.401 mm** |
  | ticket | 13.76 mm | 0.550 mm | **0.417 mm** |
  | plaque | 15.87 mm | 0.635 mm | **0.481 mm** |
  | **square (new)** | 18.52 mm | 0.741 mm | **0.561 mm** |

  The app was already showing the honest number; only the docs were wrong. This makes the print test
  **more** important, not less, and it is why `square` was sized at 70 units — its 0.561 mm is the
  only style above the 0.487 that everything here was assumed to have.
- **⛔ Option 2 (round, trimmed) is NOT shipped, and needs an owner decision.** At 44 units its true
  pitch is **0.353 mm** — below every shipped style, not merely below the "0.487 floor" this entry
  names. It buys three of five ingredient lines at 6.5 px in exchange for the least reliable code in
  the set. Recommendation: do not build it; the square die is the answer to wanting the list on paper.
- **✅ SUPERSEDED AND CLOSED by Q-397, shipped 2026-08-18 (v1.324.0).** This entry's central
  premise — that the list "does not fit on a round one" — was true only for a **stacked** list. The
  owner's actual suggestion was an **inline wrapping run**, which spends width instead of height:
  five ingredients become three wrapped lines rather than five, and the height handed back goes to
  the code. The complete list now fits a **round** label with a code larger than the old default's.
  **B2 — round-safe, inline, centred — is the new `DEFAULT_MEAL_LABEL_STYLE`**, asserted in
  `components/nutrition/__tests__/meal-label-code-size.test.ts` per Q-397's verification note.
  **Corrected 2026-08-19 (Q-399):** the "complete list at 0.529 mm per module" claimed here was
  never printed. The shipped geometry left room for **zero** ingredient lines, and 0.529 was the
  pitch of a code box the layout could not fit a list underneath. Retuned to **0.401 mm per module
  with three wrapped lines** — still above the old default's 0.369, and now the *lines* are asserted
  rather than only the code size.
  Option 2 as costed here is moot; the stacked square style stays in the picker.
- **Still open:** **the stored default**, which stays blocked on **Q-392** exactly
  as this entry says — the style remains picked-at-print-time and nothing was persisted.
- **What would count as done:** a saved meal's label can render its ingredient list with weights;
  whichever option is chosen, **the code's module pitch is not reduced** without an explicit owner
  decision recorded here (the "0.487 mm" this line named was the ÷25 reading; the shipped default is
  now **0.401** — 0.529 briefly, but that box left no room for the list, per Q-399 — and the old one
  measured 0.369 — see the correction above); and if a square-only variant ships, the app makes
  clear which labels are square-only rather than letting a round die silently crop the list.
- **Surface:** the renderer and its preview are browser-testable (`pnpm dev`, the label sheet), so
  layout and overflow need no device. **The two checks that matter are still physical** — print it and
  scan it — and those are the same two Q-389 already owes. `components/nutrition/**` is Lane B's.

### [workouts][platform] Q-474 — `workout_sessions` has two foreign keys to `program_sessions`, and the dead one owns the name the live one is used under

- **Branch:** `chore/workout-sessions-dead-program-session-id`
- **Added:** 2026-08-18 · review sweep (write-concurrency lens) ·
  [`docs/reviews/2026-08-18-write-concurrency.md`](reviews/2026-08-18-write-concurrency.md)
- **Placement:** low. **Nothing is broken today** — nothing uses the dead column. File it as the
  maintenance hazard it is, not as a bug.
- **What.** `lib/data/postgres/schema.ts` declares both:
  ```ts
  sessionId:        uuid('session_id').references(() => programSessions.id, ...)          // 157 — live
  programSessionId: uuid('program_session_id').references(() => programSessions.id, ...)  // 168 — dead
  ```
  `program_session_id` came from `079_ai_dynamic_periodization.sql:19` ("for prescription trigger
  linkage"). `grep workoutSessions.programSessionId` across `lib app packages` returns **zero hits** —
  nothing writes it, nothing reads it.
- **Confirmed in production:** 0 of the owner's 91 `workout_sessions` rows have `program_session_id`
  set; 45 have `session_id`. (`claude_ro` is row-scoped to one user, so that is the owner's rows —
  but a column no code references cannot be populated for anyone else either.)
- **The trap, which is the actual finding.** The identifier `programSessionId` means the **live**
  column everywhere in code, while the column actually named `program_session_id` is inert:
  - `getWorkoutSessionProgramSessionId()` — named for the dead column — selects
    `s.workoutSessions.sessionId` (`slices/periodization.ts:299-306`).
  - `ensureWorkoutSession(userId, sessionId, programSessionId, …)` writes its `programSessionId`
    argument into the `sessionId` field (`adapter.ts:772-780`).
- **It has already cost a session.** The Q-473 repro fixture populated `program_session_id`, the
  periodization block took the `null` branch, the counter never moved, and the honest reading of that
  run was "the race does not exist". It does. The next person to build that fixture hits the same wall.
- **Fix shape:** rename the reader (and comment the schema) — zero-risk, removes most of the trap on
  its own. Dropping the column is cleaner but is a **data-losing migration**, so it needs owner
  confirmation under `CLAUDE.md` and a Lane A migration number; it is not obviously worth that on its
  own, and would ride better alongside other schema work.
- **Lane A owns this** — schema and migrations.

### [platform][devices] Q-476 — the worse sync failure gets the softer handling: a schema-rejected mutation is deleted forever with no badge, no toast and no retry

- **Branch:** `fix/sync-push-drop-reports-error`
- **Added:** 2026-08-18 · review sweep (offline-sync failure paths) ·
  [`docs/reviews/2026-08-18-outbox-under-failure.md`](reviews/2026-08-18-outbox-under-failure.md)
- **Placement:** low-mid. **Not a live outage** — see reachability below. File it as the trap it is.
- **The asymmetry, which is the finding:**

  | Failure | Caught | Outbox row | User signal | Recoverable |
  |---|---|---|---|---|
  | Fails **inside** `pushMutations` (bad value, FK, ownership) | adapter loop | kept, `status='failed'` | badge + toast (Tier-A) | yes, Retry button |
  | Fails the route's **`MutationSchema`** (unknown domain, malformed date) | route, before the adapter | **deleted** | **none** | **no** |

- **Measured:**
  ```
  3 mutations, middle one domain "retired_domain"  →  {"processed": 2, "errors": []}
  1 mutation, date "06-08-2026"                    →  {"processed": 0, "errors": []}
  ```
  An empty `errors` array is how the client is told everything succeeded: `resolveFailedOutboxIds`
  returns an empty map, `confirmed` takes the whole chunk, `deleteMutations` removes all of it —
  including the one that was never written.
- **The route calls this "quarantined". It is not.** Quarantine is what the other path does: hold the
  row, badge it, let the user retry. This is deletion.
- **The opposite policy is written in the same request path, for exactly this case, and cannot run.**
  `adapter.ts:4355-4362`'s `Unsupported domain` branch argues *"…treats it as succeeded and deletes it
  forever. Report it as a retryable failure instead: the client's existing bounded-retry/dead-letter
  path (`MAX_MUTATION_ATTEMPTS`) already caps how long it survives"*. It is **unreachable** —
  `MutationSchema.domain` is `z.enum(SYNCED_MUTATION_DOMAINS)`, so an unknown domain never reaches the
  adapter. The layer that got the policy right is the one that never runs.
- **Reachability, stated honestly:**
  - *Malformed date — latent, not live.* The date argument at **all 36 `queueMutation` call sites** is
    `todayInTz()`, an `<input type="date">` value, or a stored `YYYY-MM-DD`. Nothing produces a
    rejected date today. There is no client-side validation behind that — it holds because every
    author has happened to get it right.
  - *Unknown domain — needs a domain removed* from `SYNCED_MUTATION_DOMAINS` while devices hold queued
    rows of it. Tomorrow's problem, and note `SYNCED_MUTATION_DOMAINS` exists because the **inverse**
    mistake once silently dropped every new-food log on the APK (the D-1 incident its own comment
    cites).
- **Why it is worth the entry anyway:** a `workout_log` that dead-letters gets a toast because, in the
  dead-letter module's own words, *"a lost workout is the app's worst-case data loss"*. The same
  workout dropped one layer earlier gets nothing at all — no badge, no toast, no row, no way back.
- **Fix shape:** have the route's drop path return an error entry instead of silence, so the existing
  dead-letter machinery handles it — row kept, badge shown, `MAX_MUTATION_ATTEMPTS` still capping it,
  which is the argument the adapter comment already makes. That also makes the unreachable adapter
  branch redundant rather than merely dead. Cheap companion: validate `domain` and `date` in
  `queueMutation` at write time, so an unsyncable mutation is refused where the user can still see it.
- **Lane A owns this** — `app/api/sync/push` and `lib/local-store/**`.

### [app-shell][platform] Q-472 — the Coach's write capability has never once been used in production

- **Branch:** `docs/coach-write-usage-decision`
- **Added:** 2026-08-18 · review sweep (this run's findings checked against production) ·
  [`docs/reviews/2026-08-18-production-verification.md`](reviews/2026-08-18-production-verification.md)
- **Placement:** low as work — **this is not a defect**. Filed because it re-prices Q-467/Q-468 (both
  amended) and because "is this earning its complexity?" is an owner question a reviewer should not
  answer alone.
- **Measured.** `claude_ro.coach_changes` is **empty**: `total 0, ever_undone 0, first null, last null`.
  Not "no undos" — **no applied changes at all, ever.**
- **The Coach is not unused.** 5 threads / 16 messages (8 user, 8 assistant), latest 2026-08-13; the
  AI-usage screen shows 17 Coach calls in 30 days. The widget vocabulary is rendering:

  | | count |
  |---|---|
  | assistant messages | 8 |
  | carrying any tool call | **8 of 8** |
  | carrying a `choice_list` | 5 |
  | carrying a **`change_preview`** | **1** |
  | **changes applied** | **0** |

  Across five conversations the model proposed a change **once**, and it was not accepted.
- **What this does NOT mean.** Apply is **not** broken — the previous sweep applied a patch through the
  real route successfully, and all four client call sites are wired. Whether the zero is because the
  model rarely proposes (1 preview in 8 assistant messages) or because the single proposal was simply
  declined is **not determinable from this data**, and the entry deliberately does not guess.
- **Scope caveat that governs the whole entry:** `claude_ro` is **row-scoped to one user**. Zero means
  *the owner* has never applied a Coach change; other accounts are structurally invisible here. Do not
  restate this as "no user has ever used it".
- **What would answer it:** a wider window, a second account, or instrumenting how often the model
  emits a `change_preview` at all. None available from this endpoint.
- **The decision this is really asking for:** five domain handlers, apply, preview, undo,
  `coach_changes` and ~1,100 lines under `lib/coach/domains/` currently produce no writes. Keep and
  drive adoption, or narrow? **Owner's call, not Lane A's.**

### [app-shell][workouts][platform] Q-467 — the Coach can change your programme and nothing in the app can undo it

- **Branch:** `feat/coach-undo-control`
- **Added:** 2026-08-18 · review sweep (the Coach write path — **the first review ever to cover it**) ·
  [`docs/reviews/2026-08-18-coach-apply-path.md`](reviews/2026-08-18-coach-apply-path.md)
- **Placement:** upper-mid. An AI-initiated write to the data that decides what the user is told to
  lift, with no in-app way back.
- **A complete undo subsystem exists and has no caller.** All of this is built:
  `POST /api/coach/apply/[id]/undo` (auth-gated, rate-limited, ownership-scoped, with a well-reasoned
  "until the next workout started after the change" window); `undoCoachChange()` with a double-undo
  guard; an `undo()` handler in **all five** domains; `captureBefore()` in each, existing solely for
  it; the `coach_changes.undone_at` column; and `components/coach/coach-history.tsx` already styling
  undone changes with strikethrough, muted colour and a "· undone" suffix.
- **Nothing calls it.** Every client fetch to a Coach endpoint, enumerated across `app/`,
  `components/` and `lib/`:
  ```
  /api/coach   /api/coach/threads   /api/coach/preview   /api/coach/apply   /api/coach/options
  ```
  `/api/coach/apply/[id]/undo` appears in **no** client file, and `coach-history.tsx` renders the
  list read-only — no Undo button anywhere.
- **⚠️ This is NOT the known "no user-facing entry point" note** (this file, in the Coach phase-1
  entry). That note is about phase 1 shipping the **apply** path without an entry point; phases 2–3
  then wired apply — `change-preview.tsx`, `number-dial.tsx`, `confirm-content.tsx` and
  `lib/coach/pending-change.ts` all POST to it and it works. **Undo was never wired with it.** The
  asymmetry is the finding; do not close this as already-known.
- **Why this severity:** the user approves changes per row, which implies reversibility, and the
  history screen then styles for an undo that cannot be reached. The only way back is to ask the Coach
  to change it again — a *new* change against current state, not a restore, and for `early_deload` or
  `program_phase` possibly not expressible at all.
- **Fix shape:** an Undo control in `coach-history.tsx` for changes that are not `undoneAt` and still
  inside the window, treating the route's 409 ("you've trained since") as a first-class state rather
  than an error. **Lane B** — the route already exists.
- **⛔ Do Q-468 first, or in the same change.** Wiring the button onto today's undo would ship the
  defect below.
- **🔎 AMENDED 2026-08-18 from production — re-scoped, not closed.** `claude_ro.coach_changes` is
  **empty**: no Coach change has ever been applied by this account, so **there has never been anything
  to undo** and the harm this entry describes has not yet happened. The code path is still wrong and
  the first real use will meet it — but the "upper-mid" placement was priced on an exposure that does
  not exist yet. See **Q-472** and
  [`docs/reviews/2026-08-18-production-verification.md`](reviews/2026-08-18-production-verification.md).
  (`claude_ro` is row-scoped to one user — this says nothing about other accounts.)

### [workouts][platform] Q-468 — `undo` restores its captured state without checking the target still holds what the change set

- **Branch:** `fix/coach-undo-drift-check`
- **Added:** 2026-08-18 · review sweep (the Coach write path) ·
  [`docs/reviews/2026-08-18-coach-apply-path.md`](reviews/2026-08-18-coach-apply-path.md)
- **Placement:** directly with Q-467. **Latent today** (nothing can call undo) and **exactly what
  Q-467 would expose** the moment a button is wired.
- **The asymmetry.** `applyCoachPatch` refuses to write over a moved target — every domain runs
  `driftAgainst(...)` and returns `stale` → 409 with a per-field drift report. `undoCoachChange` has
  no equivalent: it reads `beforeState` and writes it back. The route's guard asks *"have you trained
  since?"*, not *"has this row changed since?"*.
- **Measured live, entirely within the Coach's own flow — no external edit needed:**

  | Step | Action | `session_exercises.exercise_name` |
  |---|---|---|
  | 0 | initial | `Barbell Bench Press` |
  | 1 | Coach change **A**: Barbell → Dumbbell | `Dumbbell Bench Press` |
  | 2 | Coach change **B**: Dumbbell → Incline | `Incline Bench Press` |
  | 3 | **Undo A** → `200` | **`Barbell Bench Press`** |
  | 4 | **Undo B** → `200` | **`Dumbbell Bench Press`** |

- **Two things are wrong.** After step 3 `coach_changes` shows A struck through and B as `NOT UNDONE`
  — the history claims "Swapped Dumbbell → Incline" is in effect while the row says `Barbell Bench
  Press`, so the screen that exists to report what the Coach did is wrong. And after step 4 — undoing
  **everything** — the exercise is `Dumbbell Bench Press` when it started as `Barbell Bench Press`:
  undoing every Coach change does not return the programme to where it began, and leaves it holding a
  value the user never chose.
- **All five domains share the gap.** No `undo()` in any handler checks current state; only
  `session-exercise` re-verifies ownership on the way back. (The lone `drift` string in `goals.ts` is
  a comment about a drifting local-storage copy, not a check.)
- **Fix shape:** run `driftAgainst` on the way back too — compare the target's current values against
  what the change **set** (`to`) and refuse with 409 + drift when they disagree, exactly as apply
  does. The data is already there: `coach_changes.patch` holds the `to` values. A weaker but simpler
  alternative is to allow undo only on the most recent un-undone change per `target_id`. **Lane A.**
- **🔎 AMENDED 2026-08-18 from production — zero live instances.** Production has **not one
  `target_id` with more than one change** (`coach_changes` is empty entirely), so the stacked-change
  scenario that triggers this has never occurred. The defect reproduces locally and is real; its
  exposure today is nil. Re-priced alongside Q-467 and Q-472.

### [readiness][platform] ✅ Q-394 — RESOLVED: `anchor-source.test.ts` was red on `main`, fixed by Q-356's fixture change

- **✅ Resolved 2026-08-18, and NOT by this entry.** Verified after merging `main` at `74efac6`:
  the test passes 3/3 locally where it failed 3/3 an hour earlier on the same tree plus docs.
  **The likely fix is #90 (Q-356)** — *"Anchor the periodization fixture to the user-local day,
  not a UTC offset"*. That is the same root shape: a fixture anchored to a UTC offset while the
  query computes a user-local day window. **I did not bisect**, so treat the attribution as
  strongly-indicated rather than proven; what is proven is that it fails before `74efac6` and
  passes after.
- **Kept rather than deleted for the one part that is still open:** Q-356's own entry flagged a
  sweep — *any other test inserting `now() - interval '…'` and querying a user-local day window
  has this hole*. This was the second test to hit it and it was found by accident, taking out two
  unrelated PRs first. That sweep is worth doing, and the structural point below stands.
- **Branch:** `fix/body-battery-anchor-source-test`
- **Added:** 2026-08-18 · found while shepherding a docs-only PR (#89) whose `Tests` job went red.
- **⚠ This blocks every lane, not one PR.** `main` is the broken base: two unrelated PRs failed the
  same job within fifteen minutes (`claude/trainingai-bugfix-intake-sozcr7` at 05:30,
  `claude/implementation-lane-b-0o7kb9` at 05:15), and CI runs only on `pull_request` here, so a
  broken `main` is invisible until it takes out the next PR — which is what happened.
- **Reproduced locally on a tree differing from `main` by two documentation files**, so the diff is
  provably not the cause:
  ```
  FAIL  app/api/body-battery/__tests__/anchor-source.test.ts
    > body-battery — anchor precedence (S2) > anchors on our own computed sleep score…
      AssertionError: expected 'readiness' to be 'sleep'
    > body-battery — anchor precedence (S2) > prefers today's persisted derived readiness…
      AssertionError: expected 55 to be 77
    anchor-source.test.ts:65   expect(body.anchor).toBe(77)   // received 55
  ```
  **3 failed locally, 2 in CI** — the count differs between environments, which is itself worth a
  look: it suggests at least one assertion is sensitive to seeded data or ordering rather than purely
  to the code change.
- **Likely cause — not confirmed, and deliberately not guessed at further.** `main` has taken several
  Tuning-lane recalibrations in the last few hours that touch this pillar: **#84** ("a threshold
  pointing backwards, and a score with one value"), **#85**, **#87** ("protect a side effect worth
  17.7 points") and **#88** (Body Battery range). The failures are about *anchor precedence* —
  whether Body Battery anchors on persisted derived readiness or falls back to the computed sleep
  score — so a recalibration that changed which source wins, without updating this test, fits the
  evidence. **Whoever takes this must decide which side is wrong**: if the new precedence is correct
  the test needs updating, and if the test still encodes the intended contract the recalibration
  regressed it. Do not simply re-baseline the expected numbers to make it green.
- **What would count as fixed:** `anchor-source.test.ts` passes on a clean checkout of `main`, and
  the entry records which of the two readings was right — the test or the behaviour — so the next
  recalibration does not silently repeat it.
- **Worth considering separately:** CI runs on `pull_request` only, so nothing tests `main` after a
  merge. Every squash-merge lands unverified against whatever else landed beside it, and the cost
  shows up as an unrelated lane's red PR. A push-triggered run on `main` would have caught this at
  the merge that caused it rather than two PRs later. Not this entry's work.
- **Surface:** reproducible in the sandbox against the seeded local DB — no device, no production
  data. `app/api/body-battery/**` is Lane A's.

### [workouts][app-shell] Q-391 — the day screen's Training card has no calories-burnt stat, and the estimate it needs is already on the same screen

- **Branch:** `feat/day-training-card-kcal-stat`
- **Added:** 2026-08-18 · owner, with a screenshot of the day screen (Tuesday 18 August):
  *"the training shohld have a stat saying the calories burnt from the workout."*
- **What the screenshot shows:** a day detail with READY 76 / HR 51 / SLEEP 92 / MOVE 65 across the
  top. Under **TRAINING**, one session card — "Push, 8:24am → 9:13am · 49 min" — listing five
  exercises, footed by three stats: **VOLUME KG 2,364 · EXERCISES 5 · SETS 10**. Directly below,
  the **ACTIVITY** card for a treadmill walk *does* show "101 kcal" alongside bpm and steps. That
  contrast is the report: the activity gets a calorie figure and the workout does not.

**This was already considered and deliberately deferred — the reasoning is on file.**
`projectOverview.md` (Q-247's entry) says outright: *"Deliberately not done: a per-workout kcal
estimate in the day screen's Training section. It needs `estWorkoutKcal` per session, which is the
Q-230 bundle hazard from a client component — doing it properly means computing it server-side in
`/api/day-log`."* The owner asking for it is what moves this from *deferred* to *queued*; the
blocker and the intended shape were both already named, so **do not re-derive them.**

- **Where it goes:** `components/health/day-detail/day-sections.tsx:112-116` — the `TrainingSection`
  stat row (`Volume kg` / `Exercises` / `Sets`, all derived client-side from the sets data).
  `data.workoutDurations[sessionName]` on the same component already carries `{start, end, minutes}`
  **per session**, so the duration the estimator needs is present; the profile inputs are not.
- **⚠ The existing `workoutKcal` is a DAY total, not a session figure — this is the thing to get
  right.** `computeActiveEnergy` (`packages/shared/src/health/daily-energy.ts:104-107`) sums
  `estWorkoutKcal` over *every* strength session in the day, and that day-level number **already
  renders on this very screen**, as the "Workouts" row of the ENERGY section
  (`components/health/day-detail/energy-summary.ts:33`). So this is not "surface the field that
  exists" — a card is per session, and two sessions in one day would both show the day total.
  It needs a **per-session** call to the same shared estimator, server-side per the deferral note.
- **⚠ The deferral note undersells the blocker: it is not a bundle-size hazard, it is impossible.**
  `estWorkoutKcal` → `getEnergyFeatureSpec()` (`lib/oura-models/constants/index.ts:442`) → `readJson`,
  which calls **`fs.readFileSync`**. That cannot run in a client component at all, so there is no
  "accept the bundle cost" option — the per-session figure has to come from the server. **That makes
  this cross-lane: `/api/day-log` is Lane A's.** Lane B can render it the moment the field exists.
  Verified 2026-08-18 while working the queue.
- **⚠ And it is a duration-only estimate.** `daily-energy.ts:106` is
  `estWorkoutKcal({ durationMin, …, activityId: 8, intensity: 'moderate' })` — a flat MET 8 over the
  clock. **Load, volume and reps are not inputs.** A 49-minute session moving 2,364 kg and a
  49-minute session moving 800 kg produce the *same* number. Placing it in the same row as VOLUME KG
  / EXERCISES / SETS — three measured facts — implies it is derived from them, and it is not. Either
  label it so the basis is legible ("~kcal", "est."), or put it somewhere the implication is weaker.
  This is a presentation decision, not a formula one; the formula is fine for what it is.
- **Consistency requirement:** once a per-session figure ships, the session cards on a day must sum
  to the ENERGY section's "Workouts" row on the same screen. `energy-summary.ts`'s own header states
  the principle it was built on — *"the day screen disagreeing with Nutrition about how much was
  burned is worse than either being slightly off"* — and this adds a third place on one screen for
  the two to disagree. Assert the sum in a test.
- **Empty state:** `computeActiveEnergy` returns zeros and `estWorkoutKcal` returns `null` when
  age / weight / sex are missing (`workout-energy.ts:109-110`). A profile-less user must not see a
  confident `0 kcal` — same class as Q-278 (a score that could not be computed rendering identically
  to a real one). Decide what the stat shows when the estimate is unavailable.
- **Not a duplicate:** nothing in the backlog covers it, and `projectOverview.md`'s only mention is
  the deferral quoted above. **Q-312 is unrelated** despite touching `estWorkoutKcal` — that is the
  synthetic *test* constants scrubbing METs below 1.0 in CI, not the production MET table.
- **What would count as done:** each session card on the day screen carries a calories figure for
  *that session*, computed server-side in `/api/day-log` from the session's own duration, labelled so
  it does not read as measured; the figures sum to the ENERGY section's Workouts row; and a user with
  an incomplete profile sees an honest absence rather than a zero.
- **Surface:** browser-reproducible at the S25 viewport against the seeded DB — no device or
  production data needed. Spans `app/api/day-log` (Lane A) and `components/**` (Lane B); the deferral
  note says the server half is the correct home, so **route it to Lane A** with the display change
  riding along.

### [platform][app-shell] Q-392 — preferences live only on the device, so a reinstall or a second browser starts from defaults

- **Branch:** `feat/server-backed-user-preferences`
- **Added:** 2026-08-18 · owner: *"I would like the app/settings to remember the settings we choose
  - when i do a new install or open on computer - it loses all the saved preferences. We need to
  make it persist across installs/etc."*
- **Screenshot context** (Home, so it does not need to survive): the customised surface is exactly
  what resets — the score-ring style behind Readiness / Heart Rate / Sleep / Activity, the three
  chosen quick-log tiles (kg · Steps · Calories), card colours, and which widgets appear at all.

**Confirmed: these are `localStorage` only, with no server copy.** Inventory as of this trace —

| what | key | lives in |
|---|---|---|
| Home widgets / cards | `ta_ss_widgets`, `ta_ss_cards` | `lib/home/home-prefs.ts:29-30` |
| Pill & card colours | `ta_pill_colors`, `ta_card_colors` | `home-prefs.ts:31,40` |
| Score-ring style (20 options) | `ta_score_ring_style` | `home-prefs.ts:159` |
| Weight lookback | `ta_weight_lookback` | `home-prefs.ts:57` |
| Push / meal / health / day-review / calendar toggles | `ta_pref_*` | five call sites |
| Rest & run status chips | `ta_pref_rest_chip`, `ta_pref_run_chip` | `lib/native/*-chip.ts` |
| Background / wallpaper | `ta_background_settings` | `lib/stores/background-settings-store.ts:36` |
| Food region | `ta_food_region` | four component sites |

- **✅ The pattern to copy already exists and is proven — do not invent one.** **Q-241 (done
  2026-08-14, v1.307.1)** made goals server-authoritative for exactly this reason, and left the
  shape behind: the server owns the value, `PATCH /api/user/goals` writes it, and
  `hydrateGoalSeeds()` (`home-prefs.ts:85`) pushes it into the same `localStorage` keys so first
  paint stays instant. `app/api/user/` already holds `goals`, `profile`, `avatar`,
  `equipped-title`, `bedtime-estimate`. **This item is extending that to the rest of the table
  above**, not designing persistence from scratch.
- **⚠ One row is already half-built, and is the cheapest possible proof.** `users.food_region`
  **exists as a column** (`lib/data/postgres/schema.ts:31`, `NOT NULL DEFAULT 'AU'`) and **nothing
  reads or writes it** — a grep of `app/api/**` and `lib/data/**` finds only the definition. The
  region the app actually uses comes from `localStorage.getItem('ta_food_region') ?? 'AU'` at
  `components/nutrition/capture-step.tsx:130,138`, `review-step.tsx:124`, and is set at
  `components/profile/edit-profile-sheet.tsx:238`. So the column is dead, the setting is
  device-only, and the landing spot is already in the schema. Wire this one first — it validates
  the whole approach against a real preference for almost no work.
- **Decisions the spec has to make:**
  1. **A column per preference, or one JSONB blob?** Columns match `users.*` as it stands and keep
     things queryable; a blob avoids a migration per new preference, which matters given how many
     are listed above. **Either way the migration is Lane A's to claim, not intake's.**
  2. **Conflict rule when two devices disagree.** Q-241 settled it for goals — server wins, local is
     a seed — and the same rule should hold here rather than a second, different one.
  3. **What deliberately stays device-local.** Not everything above should sync: `ta_pref_rest_chip`
     and `ta_pref_run_chip` drive Android status-bar chips that mean nothing in a desktop browser,
     and push-notification enablement is per-install by nature. Decide the list rather than syncing
     the lot; a desktop browser inheriting a phone's notification state is its own bug.
- **⚠ Related, and more urgent than it looks now that the owner has said they reinstall:** **Q-537
  — the ring key has one copy and no way to back it up.** `CLAUDE.md` is explicit that an uninstall
  destroys the Oura ring key irrecoverably (it lives only in Android SharedPreferences) and that
  re-onboarding the official app to recover risks a firmware update that breaks the BLE protocol.
  This report establishes that reinstalls are part of the owner's normal routine, which changes
  Q-537 from a latent risk to a live one. **Not this entry's work — but worth re-prioritising.**
- **What would count as done:** sign in on a fresh install or a different browser and the chosen
  ring style, widgets, colours, weight lookback and food region are already applied — no
  re-configuration; changing one on either device and reopening the other shows the new value; and
  the preferences that are deliberately per-install are documented as such rather than silently
  not syncing.
- **Surface:** browser-reproducible end to end (two profiles, or one profile and a private window)
  against the seeded DB — no device needed to prove the sync. Only the native chip toggles need the
  APK, and those are the ones likely to stay local anyway. Spans a migration + route (Lane A) and
  the read sites (Lane B); **route to Lane A**, the schema half is the gating piece.

### [workouts][platform] Q-403 — the Coach calls an already-applied swap a "proposal", and says it after the fact

- **Branch:** `fix/coach-applied-change-copy`
- **Added:** 2026-08-18, from owner screenshots of a working swap. **The swap itself is fine** — this
  is the sentence around it.
- **Lane B** if the fix is the system prompt in `app/api/coach/route.ts` (it is). No schema, no route
  logic.

**What the screen showed, in this order:**
1. Green result card — *"Swapped Barbell Romanian Deadlift → Barbell Jefferson Curl in Legs"*
2. Then the assistant's line — *"Here is the proposal to swap Barbell Romanian Deadlift for Barbell
   Jefferson Curl."*
3. Then the owner, unprompted — ***"Is this complete?"***

That third line is the finding. The user could not tell from the screen whether anything had happened,
on a change that had already been written.

**Two defects, both against rules the prompt already states.**
- **"Proposal" is the wrong word for this domain.** `program_phase` is **the only tier-3 domain**
  (`lib/coach/domains/program-phase.ts:8`) — the only one that routes through a confirmation screen.
  A `session_exercise` swap applies immediately, which is why the card is past tense. Calling it a
  proposal asserts something is pending that has already happened.
- **The sentence rendered after the widget.** The prompt is explicit: *"Write your one sentence
  BEFORE calling a widget tool, never after"* (`app/api/coach/route.ts:91`). Two candidate causes and
  the fix differs — **the model wrote it after the tool call**, or **the UI renders tool results
  ahead of streamed text**. Check the transcript order before changing the prompt; changing the wrong
  one leaves it broken.
- It also **restates what the card already shows**, which the same prompt calls noise.

**What to do.** For domains that apply immediately, the sentence is past tense and adds something the
card cannot — *"Swapped. Jefferson Curl keeps the hamstring work but drops the loading, so expect the
session to feel easier."* — **or it is omitted entirely**, because the card is already a complete
statement. Reserve "proposal", and the future tense, for tier 3.

- **Cheap guard worth having:** the tier is known server-side when the sentence is generated. Feed it
  into the prompt so "proposal" is only ever available for tier 3, rather than relying on the model to
  remember which domain it is in.
- **Verification:** run a swap and confirm the reply reads as a completed action, in an order where
  the text is not explaining something the user has already seen. Owner screenshots are the fixture.
- **Not a bug in the swap.** The write path works on device and that is now recorded in
  `projectOverview.md` — do not "fix" the apply logic.

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

### [app-shell][devices] Q-317 — declaring a ring re-key has no button: `POST /api/oura-ble/rekey` is curl-only

- **Lane B.** `components/oura-ble/` only — the route, the repository methods and the classifier are
  Lane A's and already shipped (Q-314).
- **Added:** 2026-08-18 (filed by Lane A, which does not own `components/**`)
- **Why it matters more than a convenience.** The whole point of Q-314 is that a re-key is
  **declared** rather than inferred, because inferring it from counter shape re-timed the owner's
  entire sleep history twice. A declaration nobody can make in the app is a declaration that will be
  forgotten at exactly the moment it is needed — right after a re-key, on a laptop, mid-`open_oura`.
- **What exists:** `GET /api/oura-ble/rekey` → `{ pending: { id, declaredAt } | null }`;
  `POST` (optional `{note}`, idempotent — declaring twice returns the pending one and says so);
  `DELETE` cancels an un-consumed one. Admin-gated, POST rate-limited 5/min.
- **Shape:** a control in the BLE admin console. It must say plainly that **nothing happens until the
  ring next reports** — the effect is deferred because the new ds is not knowable at declaration
  time, and a button that looks like it acted immediately would invite a second press or a "did it
  work?" Show `pending` from the `GET` so the waiting state is visible, and offer cancel while it is
  pending.
- ⚠️ **Do not offer cancel once it is consumed.** The API refuses, correctly: the epoch it opened
  already exists and every timestamp derived from it depends on that row as the audit trail.
- **Verification:** the route is already proven end to end on `pnpm dev` (all four verbs, including
  idempotency and the 401). This item is the affordance only.

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
- 🚧 **The Lane A half SHIPPED 2026-08-18; the 502 is NOT gone yet.** `POST …?async=1` returns
  `{ jobId, status, startedAt, alreadyRunning }` immediately and `GET …?jobId=…` polls it (status is
  *derived* from the timestamps, never stored, so nothing can disagree). Migration **196** adds
  `oura_redecode_jobs` (**197** regenerates the `claude_ro` views), with one in-flight job per user
  on a partial unique index — the 4/min rate limit does not stop two overlapping runs, and two
  concurrent full-history re-aggregates are the load this exists to prevent — plus a staleness reaper,
  because a process that died mid-run would otherwise hold that slot forever and refuse every future
  redecode. That would be a worse and quieter failure than the 502.
  ⚠️ **`?async=1` is opt-in and the default is unchanged, deliberately.** Both current callers read
  the synchronous shape and report completion from it: `oura-ble-debug.tsx` falls back to *"redecode
  ran … data refreshed"* and `step-backfill-console.tsx` says *"Done. Backfill applied"*. Flipping the
  default without a poller would make both state that work had finished when it had only started.
  **Q-318 is the other half** — the poller and the default flip, Lane B.
- ⚠️ **Half this entry's premise expired on 2026-08-18.** The redecode's row-walking phase is now a
  no-op (Q-541 Task 7 made `measured_at`/`event_name` derived, so it had nothing to correct), which
  removes the `scanned=1098158` full-table walk. **The remaining weight is the full-history
  re-aggregate**, which still rebuilds every daily summary and still exceeds the gateway timeout. The
  `scanned` counts quoted above are historical.
- **Related:** Q-534 (the same table's index and vacuum problems) and the `disk_full` Known-Issues
  row. Do not run a full redecode while those are open.

### [app-shell][devices] Q-318 — poll the redecode job, and stop the two consoles reporting "done" for work that has started

- **Lane B.** `components/oura-ble/oura-ble-debug.tsx` and `components/oura-ble/step-backfill-console.tsx`
  only — the job store, the route and the reaper are Lane A's and already shipped (Q-535).
- **Added:** 2026-08-18 (filed by Lane A, which does not own `components/**`)
- **Why the default was not flipped for you.** `?async=1` exists and works, but both consoles read
  the synchronous response shape and report completion from it. Switched blind, `oura-ble-debug.tsx`
  falls back to *"redecode ran (response was slow to return) — data refreshed"* and
  `step-backfill-console.tsx` says *"Done. Backfill applied — re-run preview to confirm 0 days
  remain."* — for a backfill that has only begun. That is a quieter and more misleading failure than
  the 502 it replaces, which is why Lane A left the default alone rather than crossing the boundary.
- **The contract:** `POST …?async=1` → `{ jobId, status: 'running', startedAt, alreadyRunning, note }`.
  `GET …?jobId=<id>` (or no id for the most recent) → `{ job: { jobId, status, startedAt, finishedAt,
  opts, error, ...phases } }` where `status` is `running` | `done` | `failed`, and the phases payload
  is exactly what the synchronous route used to return (`redecoded`, `redecodeError`, `aggregated`,
  `aggregateError`). `GET` with no jobs yet → `{ job: null }`; a non-numeric `jobId` → 400.
- **Shape:** POST with `async=1`, then poll the `GET` on a timer until `status !== 'running'`, then
  render exactly what the synchronous path rendered. `alreadyRunning: true` means someone else's run
  is in flight and this press started nothing — say so rather than showing a spinner that implies it
  did. A run can take **minutes**; the point is that the response arriving first is normal.
- ⚠️ **Do not treat a `failed` status as a reason to retry automatically.** A retry is another
  full-history re-aggregate, which is the whole hazard Q-535 is about.
- **Once both consoles poll, drop `?async=1` and make it the default** — the synchronous branch in
  the route exists only to keep these two working in the meantime, and should go with it.
- **Verification:** the route is already proven end to end on `pnpm dev` — start, poll to `done` with
  the full phases payload, `alreadyRunning` on a second press with one genuinely in flight, a 400 on a
  bad id, and the reaper turning an abandoned job into `failed` with a reason. This item is the
  client only.

### [app-shell][devices] Q-316 — the frame packer has no button: `POST /api/oura-ble/samples/pack` can only be driven by curl

- **Lane B.** `components/oura-ble/db-footprint-card.tsx` only — the route, the repository method and
  the slice all exist and are Lane A's, already shipped.
- **Added:** 2026-08-18 (filed by Lane A, which does not own `components/**`)
- **What exists already:** `GET /api/oura-ble/samples/pack` returns `{ buckets, sealBelowDs }` — how
  many sealed buckets are packable right now, touching nothing. `POST` (optional body
  `{ maxBuckets }`, default 25, cap 200) packs that many and returns
  `{ buckets[], packed, refused, framesMoved, bytesWritten, remaining, ms }`. Both are admin-gated
  and the POST is rate-limited to 10/min.
- **Shape:** a third control in the card's ① Data section beside "Null historical decoded" and
  "Reclaim disk — VACUUM FULL", following the same `ConfirmDialog` pattern. Show `remaining` from the
  `GET` so the owner knows how many presses are left, and re-fetch the footprint after each press so
  `oura_raw_samples` shrinking and `oura_raw_packed` growing are visible in the same table.
- ⚠️ **The confirm copy must not say "no data is lost" the way the VACUUM one does.** It is true —
  frames are moved, not deleted, and the packer refuses to delete a bucket it cannot prove equal —
  but this is the one control in the app that issues a DELETE against archival frames, and copy that
  reads identically to a lossless VACUUM trains the wrong instinct. Say what it does: moves sealed
  buckets older than 7 days into compact blobs, after re-reading each blob and proving the frames
  match.
- **Surface a refusal.** `refused > 0` with a per-bucket reason means a bucket could not be proven
  equal and was left intact — that is a finding, not a no-op, and it must not read as "packed 0".
- **Verification:** the route is already proven end to end on `pnpm dev` (251 frames → 10 blobs, API
  dump hashing identically before and after). This item is the affordance only.

### [platform] Q-315 — `error_events` holds 4 live rows in 49 MB: Q-539 stopped the bleeding but never reclaimed the space

- **Lane A.** Server only. No migration, no schema change — an admin-triggered `VACUUM FULL`.
- **Added:** 2026-08-18 (found while measuring production for Q-541)
- **Measured production, 2026-08-18:** `error_events` is **49 MB total against `n_live_tup = 4`** —
  12 MB heap, 1.1 MB indexes, and the remaining ~36 MB in TOAST. That is **6% of the whole 819 MB
  database** held by four rows.
- **This is dead weight, not data.** Q-539 diagnosed the cause: one fault wrote **5,771 rows** because
  the dedupe key varied with a generated `VALUES` list, each stored message truncated to exactly
  2,000 chars of `(default, $N, $N),` boilerplate. Q-539 fixed the key and cut the cap to 1,000, and
  the rows themselves have since been pruned — but Postgres MVCC leaves the dead tuples in place, so
  the file never shrank. **Nothing here re-grows**: the write path is already fixed, so this is a
  one-off reclaim, not a recurring chore.
- **Why it is worth a queue entry rather than a footnote:** it is the cheapest MB in the database
  against the owner's end-of-week 500 MB deadline (Q-534). Q-541's packing is worth ~680 MB and is
  several sessions of careful work; this is ~49 MB for a single statement over a four-row table, with
  no data at risk and no read path to reason about.
- **Shape:** the existing `app/api/oura-ble/samples/vacuum/route.ts` already runs
  `VACUUM (FULL) oura_raw_samples` behind an admin gate — generalise it to take a table name from a
  small allowlist, or add a sibling. `VACUUM FULL` takes an ACCESS EXCLUSIVE lock and rewrites the
  table; on four live rows that is milliseconds, but it still needs free disk equal to the current
  file (49 MB against a 5 GB volume — not a constraint today, and worth re-checking if the volume is
  cut back to 500 MB before this runs).
- **Verification:** `pg_total_relation_size` before and after via `/api/admin/db-query`, and
  `SELECT count(*) FROM error_events` unchanged either side. Do not assume the count is 4 by the time
  it runs — read it first.
- 🚧 **The ROUTE shipped 2026-08-18 (Lane A); the PRESS has not happened.** `POST /api/admin/vacuum`
  with `{"table":"error_events"}`, admin-gated, 4/min, allowlisted to `error_events` and
  `oura_raw_samples`; `GET` lists what may be vacuumed. The table name is interpolated into
  `VACUUM (FULL) <table>` because VACUUM accepts no bind parameter, so **the allowlist is the safety
  boundary, not validation** — checked with `hasOwnProperty` (an `in` check accepts `toString`, and
  there is a mutation-checked test for exactly that) in both the route and the slice. Verified live
  on `pnpm dev`: a disallowed name and a missing body both 400, and a real run on the local
  `oura_raw_samples` reclaimed **5.7 MB of 6 MB**.
  **Still outstanding: someone has to press it against production.** No button — that is Q-316's
  territory (`components/**`, Lane B) — so until then it is a curl with an admin session cookie.
  The same route is what reclaims the space after Q-541's backfill and after migration 193's index
  drop, which is why it was generalised rather than copied.

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
> **⚠️ The 500 MB target is withdrawn — 2026-08-18, and this is settled rather than deferred.**
> Railway **cannot shrink a volume**: *"Down-sizing a volume is not currently supported, but
> increasing size is supported."* And it does not need to, because Railway bills *"only … the amount
> of storage used by your volumes,"* not the provisioned size — so the 5 GB volume costs exactly what
> a 500 MB one would at the same usage. Reverting would mean a dump/restore onto a fresh volume,
> i.e. real downtime and risk on the database holding the ring archive, to save nothing. **Do not
> attempt it.** Treat every "return to stock 500 MB" line below as historical context for why the
> work was prioritised, not as an outstanding action.
>
> What was genuinely lost is the tripwire: 500 MB is what made the bloat scream rather than creep, and
> 5 GB is ~30 years of headroom at the post-packing rate. Replace it deliberately — a database-size
> line in the session-start orientation read, beside the existing `error_events` check.

- **The target is concrete:** the owner raised the volume 500 MB → 5 GB as a temporary mitigation
  and intends to return to the stock 500 MB. Measure what each change actually reclaims rather than
  estimating, and say whether 500 MB is reachable without touching retention.
- **Do not run a Full re-sync while this is open** — that is what triggered the incident.

- **⚠️ Finding 2 above is a measurement artifact — do not chase it.** Re-measured at 08:04 and 08:45
  UTC, `oura_raw_samples` reads `last_autovacuum = 2026-08-17T07:57:35Z` and
  `n_live_tup = 1,097,626`. **Autovacuum has run, twice, today.** The null/zero reading was taken
  while the statistics were still empty: an unclean shutdown makes Postgres discard the stats file
  on recovery, and `stats_reset` stays `NULL` because only an explicit `pg_stat_reset()` sets it —
  so freshly-zeroed counters are indistinguishable from "never" unless you know the crash happened.
  The same artifact showed on `error_events`, which read `n_live_tup = 0` while really holding 6,222
  rows. **Every counter on this table is "since ~07:42 recovery", not lifetime** — which matters for
  finding 1, since index `idx_scan` counts are now a ~1-hour window, not evidence of disuse.
- **What actually consumed the space, proven:** `n_tup_ins = 0`, `n_tup_upd = 681,005`,
  **`n_tup_hot_upd = 0`**. A full-table `measured_at` re-stamp — the Full re-sync was the *trigger*,
  a catch-up drain, and the re-stamp it prompts (ops-doc I14/I25) is the *mechanism*. The table went
  360 → 666 MB while live rows went **down** by 557 and `body_hex`/`event_name` did not move at all.
  Zero new data; ~306 MB of pure bloat.
- **This makes a fourth finding, and it is the one with leverage.** `measured_at` is indexed, so **no
  update that changes it can ever be HOT** — each rewrites a heap tuple plus an entry in all four
  indexes. `measured_at` is also the *only* indexed column such a re-stamp changes. **Dropping
  `idx_oura_raw_samples_user_measured` (117 MB, and it exists to serve range queries that can be
  expressed as ds ranges instead) makes the whole operation HOT-eligible** — so it is both a space
  win and the fix for the mechanism. Q-46's `IS DISTINCT FROM` guard is present and correct at
  `adapter.ts:4954`; **it is not the bug and must not be "re-fixed"** — it can only skip a re-stamp
  writing back the same value, and the Q-71/I25 clock correction changed every row's derived value.
- **Two more, for sequencing:** (a) the owner must run `VACUUM FULL` (existing admin button) once the
  re-stamp is confirmed finished — it reclaims the ~306 MB and gets the DB to ~465 MB, under stock;
  (b) **do not revert the volume to 500 MB until the `measured_at` index is dropped**, or the next
  prescribed re-stamp refills it. Add a pre-flight free-space guard to the redecode route: the
  operations manual prescribes Redecode as the remedy for five failure modes (I12, I14, I19, I20,
  I25), so the documented fix procedure is itself a disk-fill hazard.
- **⚠️ Finding 4 is NOT a drop-in index drop — measured 2026-08-17 (Lane A).**
  `idx_oura_raw_samples_user_measured` (118 MB, `idx_scan` 14 in the ~1 h since crash recovery) has
  **two live consumers**, and both break into a sequential scan of the largest table in the DB if it
  goes:
  1. `getLatestOuraBleMeasuredAt` (`slices/oura.ts:173`) — `WHERE user_id AND measured_at IS NOT
     NULL ORDER BY measured_at DESC LIMIT 1`. Without the index this is a full scan per call.
  2. `getOuraRawSamplesForTags` (`adapter.ts:6446`) — `WHERE user_id AND tag IN (…) AND measured_at
     >= now() - N days ORDER BY measured_at`.
  This entry's *"it exists to serve range queries that can be expressed as ds ranges instead"* is a
  **plan, not a fact**: expressing them as ds ranges means converting the window bound through the
  clock anchors at both call sites, and `getOuraRawSamplesForTags` is on a read path. So the order is
  **rewrite both call sites to be ds-keyed, prove equivalence, then drop the index** — three steps,
  not one. Do not drop it first and measure afterwards.
- ✅ **Finding 4 is DONE, 2026-08-18 (Lane A), in that order.** Both consumers now convert their
  wall-clock window through the anchors and read ds-keyed and two-tier; migration **193** drops the
  index (**136 MB** by then, on a 699 MB table whose indexes were 443 MB). Three consequences the
  entry did not anticipate, recorded so they are not re-derived:
  (a) **the stored `measured_at` and `event_name` columns are now dead**, so the redecode's re-stamp
  loop — *the mechanism of the outage* — was writing values nothing reads, and is a documented no-op;
  the pre-flight free-space guard this entry asks for is therefore moot, because the operation it
  guards no longer exists;
  (b) **`/api/oura/stats` read `connected` off "we can name a last-measured time"**, which stopped
  being the same question once the time became derived — split into `hasOuraBleSamples`, or a ring
  with frames but no resolvable anchor would have silently taken the Health tab's whole Ring section;
  (c) **dropping the now-dead columns is NOT done** — that is a data-dropping migration and
  owner-gated, whereas the index drop is reversible with one `CREATE INDEX`. Findings 1–3
  (payload-in-index, autovacuum, `work_mem`) are untouched and still open.
- **The redecode's own cost, since this entry gates it.** `POST /api/oura-ble/samples/redecode`
  re-stamps `measured_at` over every row (its own opening comment says so), which is exactly the
  non-HOT full-table rewrite that produced the ~306 MB of bloat. Measured 2026-08-17 **after** the
  incident: DB **786 MB**, `oura_raw_samples` **667 MB** (245 MB heap / 422 MB indexes). On the
  temporarily-raised **5 GB** volume a redecode has ample headroom; on the stock 500 MB it does not.
  **So the sequencing is: redecode now while the volume is large, and do not revert to 500 MB until
  the index work above has landed** — otherwise the next prescribed redecode refills it.
- **Answering this entry's own closing question — is 500 MB reachable without touching retention?
  Yes, and it is now measured rather than estimated.** `VACUUM FULL` → ~465 MB; + the index work
  → ~355 MB; + Q-540 → ~305 MB; + `error_events` self-clearing → ~260 MB. **No retention change is
  needed, and the owner has chosen none** (Q-542). The one caveat is that *reaching* 500 MB and
  *holding* it differ: vacuum alone re-crosses it in ~5 days, this entry plus Q-540 in ~7 weeks, and
  **Q-541 (repack) in ~3 years**. Full analysis:
  [`docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md`](superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md) §0.


### [app-shell][platform] Q-544 — server-side disk maintenance is trapped behind a native-plugin gate, so it cannot be run from a desktop

- **Branch:** `fix/admin-db-maintenance-off-native-gate`
- **Added:** 2026-08-18, found while reclaiming 513 MB during the `disk_full` recovery.
- **Lane B.** `components/oura-ble/**` + `app/admin/oura-ble/**`. No server change.
- **What happens.** `components/oura-ble/oura-ble-debug.tsx:391` early-returns a "Native OuraBle
  plugin unavailable" banner when the Capacitor plugin is absent. `<DbFootprintCard />` is rendered at
  line 555 — *after* that return. So on any desktop browser the VACUUM FULL button, the Lever 1b
  backfill button and the footprint readout do not render at all.
- **Why that is wrong.** None of those three touch the plugin. `POST /api/oura-ble/samples/vacuum` is
  a plain server-side call behind `auth()` + `requireAdmin`; it has nothing to do with BLE. It is
  gated only by being rendered inside a component that gates on something else.
- **Why it matters more than it looks.** Reclaiming disk becomes possible only from the phone — and
  **`VACUUM FULL` takes an `ACCESS EXCLUSIVE` lock**, so the APK is the one client blocked while it
  runs, with a WebView timeout free to swallow the response. Worse, if the APK is broken, uninstalled
  or mid-rebuild, the disk cannot be reclaimed *at all* — which is exactly the situation where a full
  volume is most likely. On 2026-08-18 the workaround was a `fetch()` from a desktop console.
- **Fix shape:** move `DbFootprintCard` (and any other server-only card) above the availability
  early-return. The genuinely native panels — `RawStoreStatusConsole`'s `rawStats()`, the SleepNet
  dump, the sensor probe — correctly stay behind it.
- **Second half: the pack backfill has no button at all.** `POST /api/oura-ble/samples/pack` shipped
  with Q-541 Task 4 and its own comment says *"the button sends none"*, but nothing in `app/` or
  `components/` references it. The 2026-08-18 run — 764 buckets, 941,233 frames — was five hand-typed
  `fetch()` calls. It needs the same GET-preview + press-until-`remaining: 0` treatment the other
  levers have, beside them in the footprint card.

### [devices][platform] Q-538 — `oura_raw.db` grows without bound on the phone: `pruneRaw` has no caller, and `rolled_up` is never set

- **Plan:** [`docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md`](superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md) §3
- **Branch:** `fix/oura-raw-device-store-visibility`
- **Lane B.** `app/admin/oura-ble/**` + `components/oura-ble/**` only — it calls plugin-bridge methods Lane A already shipped, so it needs nothing from Lane A and can run fully in parallel.
- **Added:** 2026-08-17 · **Placement:** above the storage-policy items because it is true and getting
  worse under every option in that plan, and it is the one that can wedge the drain (ops-doc I21,
  `SQLITE_FULL` → cursor held).
- **What's actually on `main`:** `OuraRawDb.kt` implements `pruneRaw`/`markRolledUp`/`getUnrolledRaw`/
  `rawStats`, all four exposed as `@PluginMethod`s and declared in `lib/oura-ble/plugin.ts:90-99`.
  **A repo-wide grep finds no caller for any of them** outside that interface declaration. The
  documented "14-day rolling window" (owner retention decision, 2026-08-02) is a plan, not shipped
  behaviour.
- **Two independent causes, and fixing the first does not fix the second:** (1) nothing invokes
  `pruneRaw`; (2) the predicate is `rolled_up = 1 AND synced = 1 AND measured_at < ?`, and `rolled_up`
  is set only by `markRolledUp`, which is called only by the WebView rollup consumer — **D2 Task 5,
  not built**. Wiring the prune tomorrow would delete zero rows.
- **Consequence:** the store has accumulated everything drained since 2026-07-27 at ~2–3 MB/day, with
  no bound and no visible failure state — exactly what the retention decision warned about (*"a rollup
  that silently falls behind turns Tier 1 into unbounded growth"*).
- ✅ **MEASURED ON DEVICE 2026-08-18 — the panel exists now and the owner read it.** First-ever
  observation of this store, and it confirms the static analysis exactly:

  | | |
  |---|---:|
  | total rows | **209,326** |
  | **rolled up** | **0** |
  | unrolled | 209,326 |
  | on disk | **31.2 MB** |
  | low disk | no |

  **Zero rows are marked rolled up**, so `pruneRaw`'s `rolled_up = 1 AND synced = 1` predicate matches
  nothing and the documented 14-day window cannot delete a single row. Both causes are now confirmed
  from the device, not inferred.
- **31.2 MB is a floor, not an accumulation.** The store was wiped by the 2026-08-17 reinstall and
  rebuilt to 209,326 rows in ~1.5 days — that is the Full re-sync re-draining the ring's whole buffer
  into a fresh cursor-0 store. Forward growth is ~23,000 rows/day at ~149 bytes/row ≈ **3.4 MB/day**,
  matching the ~3.2 MB/day in `CLAUDE.md` and the ~1.2 GB/year the 2026-08-02 retention decision
  predicted for an unpruned tier.
- **It already exceeds Android Auto Backup's 25 MB per-app quota**, so the phone-side backup covers
  none of it — see the `allowBackup` note below. That was a projection when this entry was filed; at
  31.2 MB it is now a measurement.
- **What is left here:** the bound and the visible failure state. The real prune still needs D2 Task 5
  (the WebView rollup consumer) to set `rolled_up`, which is what this entry has always said and what
  the device reading now proves.
- **Also record:** `AndroidManifest.xml:14` sets `allowBackup="true"` with no `dataExtractionRules`.
  Android Auto Backup's cloud quota is 25 MB/app and `oura_raw.db` passed that within two weeks, so
  **the device raw store has no working backup.** That is load-bearing for the D4 decision (Q-542).


### [devices][platform] Q-540 — narrow the `oura_raw_samples` row: drop `event_name`, `body_hex` → `bytea`

- **Plan:** [`docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md`](superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md) §6 B
- **Branch:** `perf/oura-raw-row-narrowing`
- **Lane A.** Migration + `lib/data/**`.
- **Added:** 2026-08-17
- ✅ **UNBLOCKED 2026-08-17.** The owner kept D4 as the destination **but with no deadline**, which
  lapses master-plan decision **O1** (*"do not do both"* — it vetoed `bytea` on the grounds the table
  was about to be dropped; a drop that is years out cannot veto a cheap reversible win today).
- **Take the `event_name` half regardless. Take the `bytea` half only if Q-541 is NOT imminent** — a
  packed blob is already `bytea`, so doing both is the same migration twice over 1.1M rows.
- **Gives up nothing.** `event_name` is 20 MB owner-scoped across **30 distinct values, fully derivable
  from `tag`** — the Kotlin/TS cross-language parity test already pins that mapping. `text` → `bytea`
  is a lossless re-encoding that halves `body_hex` (26 MB → ~13 MB) and shrinks the 78 MB dedup index
  with it. Together: ~45–50 MB, and ~328 B/row → ~270 B/row.
- Needs `VACUUM FULL` to reclaim (ops-doc I17).


### [devices][platform] Q-541 — repack raw frames: ~20× smaller, byte-for-byte lossless

- **Plan:** [`docs/superpowers/plans/2026-08-17-oura-raw-frame-packing.md`](superpowers/plans/2026-08-17-oura-raw-frame-packing.md)
  — full implementation plan, written 2026-08-17. Decision context in
  [`…-db-storage-raw-samples-retention.md`](superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md) §6 C.
- **Branch:** `perf/oura-two-tier-frame-reader` (Tasks 0–2 landed on `perf/oura-raw-frame-packing`)
- **Lane A.** Server/JS only — migration, `lib/data/**`, `lib/oura-ble/**`. No Kotlin, no APK.
- **Added:** 2026-08-17
- ✅ **UNBLOCKED — owner chose A+B+C on 2026-08-17 (see Q-542).** This is the option the current
  archival rule does not consider, and the only one that makes the growth curve sustainable without
  deleting anything or depending on the phone.
- **It is load-bearing, not polish.** Against the stock 500 MB target: `VACUUM FULL` alone re-crosses
  500 MB in ~5 days, A+B in ~7 weeks, **C in ~3 years** (~0.37 MB/day vs ~7.5 today). C is the only
  step that makes 500 MB a home rather than somewhere the database passes through.
- **It also deletes the failure mode behind the Q-534 outage.** A packed table holds ~30 rows/day
  instead of 22,910, and `measured_at` stops being a stored per-frame column — it is derived at decode
  time from the anchor — so a clock correction re-stamps nothing at all.
- **Supersedes the `bytea` half of Q-540** — a packed blob *is* `bytea`. If C is taken promptly, skip
  the standalone `text` → `bytea` migration rather than doing the work twice.
- 🚧 **Task 4 SHIPPED 2026-08-18 — the packer.** `lib/data/postgres/slices/oura-raw-pack.ts` +
  `GET|POST /api/oura-ble/samples/pack`, admin-gated, bounded, idempotent, resumable, never automatic.
  **This is the first code in the project that deletes an archival frame**, and it does so only after
  re-reading the committed blob and proving the frames equal; a refusal is returned per bucket rather
  than thrown. Four decisions the plan left open are settled in it: the hot window anchors to
  `max(ring_timestamp_ds)` not `now()`; a wall-clock quiet guard (`max(recorded_at) < now() - 1 day`)
  sits on top, because ds says when the ring recorded a frame and not when we received it; and
  `body_sha256` hashes the frame *sequence*, not the blob, so it is an independent check rather than a
  restatement of the re-read. Verified live: 251 seeded frames → **2,800 bytes of blob (≈29×)**, and
  the API's full dump hashes identically before and after. ⚠️ **No button yet — Q-316, Lane B.**
- 🚧 **Task 3 SHIPPED 2026-08-18 (v1.318.12) — the two-tier reader.**
  `lib/data/postgres/slices/oura-raw-frames.ts`: `readRawFrames` (ds range + tags, ascending) and
  `readRecentRawFrames` (newest-first, limited), returning **exactly the shape of the `select` they
  replace**. Eleven read sites converted — the rollup, both step-feature reads, the temp/MET and
  battery range reads, the two tag censuses, the admin raw dump and the summary. Still inert in
  production: nothing writes a blob yet.
  Three findings worth not re-deriving: **(a)** an aggregate cannot use the reader's identity dedupe,
  and the summary's per-tag counts double-counted a bucket sitting in both tiers — 80 frames read as
  120 on the dev server — so they now anti-join on `(epoch, tag, ds_bucket)`; **(b)** `event_name` had
  to become derived from `tag`, because a packed frame carries none and grouping on a column one tier
  lacks splits a tag into two rows; **(c)** a tag dormant longer than the hot window needs a cold
  fallback in three places or it reads as never having produced data.
  Verified on `pnpm dev` by rehearsing the packer by hand over four seeded ring-days: every read is
  byte-identical across all-hot, both-tiers and hot-rows-deleted.
- 🚧 **Tasks 0–2 SHIPPED 2026-08-17 (v1.318.11), additively.** Task 0 answered structurally rather
  than by counting — `epoch` is **not** in the dedup unique constraint, so a cross-epoch duplicate
  was never insertable, and the count the plan proposed now returns "none" for the wrong reason
  because migration 190 merged the epochs. Migration **191** creates `oura_raw_packed`; **192**
  regenerates the `claude_ro` views a new table requires; `lib/oura-ble/frame-pack.ts` is the codec,
  with 7 property tests and 2 DB-backed round-trip tests. **Nothing reads or writes it yet, and no
  row has moved** — `oura_raw_samples` and the ingest path are untouched.
  **Remaining: Tasks 5–7** — the backfill (run the packer over all history in bounded batches, then
  `VACUUM FULL` **after**, not during), the hot-window prune, and the `measured_at` range-query sweep.
  The plan's gate still stands: a verified backfill on a copy of production before the real one.
- ✅ **Planned 2026-08-17 — ready for an implementer.** The three open questions are answered in the
  plan: **(a)** the dedup key does not move at all — ingest and `oura_raw_samples` are left untouched
  and a *second* table holds sealed blobs, so `ON CONFLICT DO NOTHING` and the cursor path carry no new
  failure mode; **(b)** every reader becomes "cold blobs ∪ hot rows", which is one shared helper rather
  than a per-call-site rewrite, because nearly every read is already the same
  `user_id + tag IN (…) + ds BETWEEN` shape; **(c)** the migration adds a table and moves data with a
  packer that only deletes a hot row after re-reading its blob and proving the frames equal.
- **Measured shape (production 2026-08-17):** **968 blobs replace 1,098,956 rows — 1,135×.** 22.5
  blobs/day, mean 1,135 frames each, 13 MB of raw payload for all history. Projected steady state
  **~70 MB** (hot 7 days ~52 MB + cold ~16–20 MB) growing ~117 MB/year, against ~7.5 MB/day today.
- **The bucket key is `(user_id, epoch, tag, ring_timestamp_ds/864000)` — NOT a calendar day.** Wall
  time is derived through anchors and that derivation changes (Q-71/I25), so a calendar-day partition
  would need re-partitioning on every clock fix, reintroducing exactly the failure this removes.
  `epoch` is load-bearing and the data proves it: the four epochs' ds ranges overlap heavily.
- **Task 0 first** — check whether any rows share `(user_id, ring_timestamp_ds, tag, body_hex)` across
  different epochs. The existing unique constraint omits `epoch`; given the overlap that is worth
  ruling out before relying on the key. Cheap, and it could change the design.
- **The number that motivates it:** `body_hex` averages **24 hex chars — 12 bytes of real frame** —
  stored at **~328 bytes/row**. A 27× overhead. Measured 22,910 rows/day over the last 14 complete
  days: the irreplaceable payload grows at **205 MB/year**, the table at **2.7 GB/year**. The 2.5 GB
  difference is representation, not information.
- **Shape:** one row per `(user, day, tag)` holding a `bytea` blob of concatenated frames with
  delta-encoded `ring_timestamp_ds`, plus count and ds range. TOAST compresses blobs over 2 kB on top.
  At ~16 effective bytes/frame that is **~134 MB/year**, and the existing 1.1M rows repack to under
  50 MB.
- **The hard part is the dedup key**, which currently includes `body_hex` and is what makes re-sends
  free (ops-doc I8) — it has to move in-blob or to a narrow side index. Ingest, the rollup reader,
  redecode and the admin tester all change. Bounded, sandbox-testable, touches **no native code**.


### [devices][platform] Q-542 — ANSWERED 2026-08-17: A+B+C, nothing irreversible. Keep for the audit trail, then remove.

- **Plan:** [`docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md`](superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md) §6, §7b
- **Added:** 2026-08-17 · **Answered the same day.** No longer blocking anything.
- **The owner chose A + B + C — index audit, row narrowing, repack. Options D and E are declined.**
  Nothing irreversible is being done: every chosen step preserves `body_hex` byte for byte, so the
  `CLAUDE.md` archival rule stands unchanged and needs no rewrite.
- **The reframing the decision rested on:** the archival rule protects `body_hex`, which is **26 MB of
  the 360 MB table — 7.3%**. The rest is indexes and row overhead, all reversible. So the expensive
  thing and the irreplaceable thing were never the same thing.
- **The `disk_full` incident (Q-534) did not change this and must not be read as forcing it.** That
  was a bloat event from a full `measured_at` re-stamp, not growth; **§6 A would have prevented it and
  neither D nor E would have.** Against the stock 500 MB target the non-destructive path alone reaches
  ~260 MB and, with C, holds it for years.
- **Also settled:** D4 remains the destination with **no deadline**, which lapses decision O1 and
  unblocks Q-540. The 2026-08-02 retention decision justified the 14-day device tier *because* the
  server keeps `body_hex` forever — that premise now holds indefinitely, so the tier needs no revision.
- **Remove this entry** once Q-534/Q-540/Q-541 are all closed; it carries no work of its own.



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

- ⛔ **blocked: needs an owner decision before any code moves.** Skipped by Implementation Lane B on
  2026-08-17 while taking Q-532 below it. This entry asks for the *premise* of a shipped IA decision
  to be re-litigated against a real user's task, and the owner's report is the only evidence of what
  that task actually is. An agent choosing the new structure alone would be repeating exactly the
  mistake the entry describes — Q-234 reasoned taxonomically, correctly on paper, and was wrong in
  use. What unblocks it: the owner walking the drain/re-sync/verify flow start to finish and saying
  where they expected each step to live. That is a planning session's output (a plan doc), not a
  Lane B implementation item.
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

### [workouts][app-shell][platform] Q-461 — the workout flow cannot be automated past set 1: the Start Set button animates forever, so Playwright never sees it as stable

- **Branch:** `fix/start-set-bounce-blocks-automation`
- **Added:** 2026-08-18 · review sweep (workout write path) ·
  [`docs/reviews/2026-08-18-workout-write-path.md`](reviews/2026-08-18-workout-write-path.md)
- **Placement:** mid. **This is a testability finding, not a user-facing defect** — a human tapping a
  bouncing button is entirely unaffected, and the entry must not be implemented as if the animation
  were broken.
- **Observed.** Driving a real workout in Playwright at 412×915, every step worked — select,
  pre-workout, warm-up, Begin Exercises, Start Set 1, Log Set 1 — then `Start Set 2` **hung to the
  300 s test timeout**. The locator resolved; the click never completed. Proven:
  ```
  ##CLASS  … transition hover:opacity-90 active:scale-95 animate-bounce
  ##ANIM   bounce | infinite
  ##NORMAL BLOCKED: TimeoutError: locator.click: Timeout 8000ms exceeded
  ##FORCED CLICKED     → screen advanced to "2 … ▶ active"
  ```
- **Cause.** Playwright's actionability check needs a stable bounding box for two consecutive frames;
  an infinite CSS animation never gives one. This is the W1 bounce `CLAUDE.md` documents by design
  (*"Start button `animate-bounce` when `workoutPhase === 'rest'`"*).
- **Why it matters anyway.** The repo has just built an E2E harness to catch regressions (Q-249,
  extended by Q-352's zero-data account), and **the app's core write path cannot be driven by it past
  the first set.** The two worst findings of the preceding week — Q-450's silently discarded activity
  and Q-451's dead first-run button — were both exactly the shape an E2E spec catches.
- **`force: true` is not the fix.** It bypasses *all* actionability checks including "is this covered
  by an overlay", so a spec written that way would keep passing straight through a real regression.
- **Fix shape (Lane B):** gate the animation on something a test can turn off — honour
  `prefers-reduced-motion` (Playwright sets it via `contextOptions`), or suppress the bounce when a
  test hook is present. Keep the affordance on device; make the control automatable. A spec covering
  log-set → complete-workout is the follow-on this unblocks.

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

### [body][app-shell] Q-319 — the Water widget's web fallback posts to a route that has no water field, and the value is discarded behind a 200

- **Lane B.** `app/session-select/components/log-value-sheet.tsx` only.
- **Added:** 2026-08-18, found while implementing Q-464 — **this is the live instance of that class**,
  which Q-464's own entry said it did not have.
- **Measured live on `pnpm dev`:**

  | Sent to `POST /api/body-metadata` | Response | Row after |
  |---|---|---|
  | `{"localDate":"2026-08-18","waterIntake":750}` | `200 {"success":true}` | `water_ml` **still NULL** |
  | `{"localDate":"2026-08-18","steps":4242}` (control) | `200` | steps written |

- **The mechanism.** `MetaKey` includes `waterIntake`, and the sheet's **web fallback** (the branch
  taken when the local store is unavailable) does
  `fetch('/api/body-metadata', … JSON.stringify({ localDate: localDateString(), [widget.key]: numVal }))`.
  `BodyMetadataPostSchema` names no water field at all — water lives on **`/api/water-log`** — so the
  key was silently dropped, the route returned success, and the sheet painted an optimistic value
  that the next fetch reverts.
- **The device path is FINE and must not be "fixed" with it.** The local-store branch maps
  `waterIntake → waterMl` and writes + syncs correctly. Only the web fallback is wrong.
- ⚠️ **Since Q-464 shipped, this now fails LOUDLY** — `BodyMetadataPostSchema` is `.strict()`, so the
  same call returns `400 {"error":"Unrecognized key: \"waterIntake\""}` and the sheet shows
  "Failed to save — reverting". That is the intended improvement (a visible failure beats a silent
  one, and the value was already being lost either way), but it makes this user-visible rather than
  invisible, which raises its priority.
- **Fix shape:** in the web fallback, route `waterIntake` to `POST /api/water-log` — the same
  endpoint `components/profile/water-log-sheet.tsx` already uses — instead of `/api/body-metadata`.
  Check the water route's payload shape (it takes a delta, not an absolute, per `validWaterMlDeltaOrNull`)
  before wiring it; a straight rename of the key would be wrong.
- **Verification:** with the local store unavailable, log a water value from the session-select
  metric tile and confirm `body_metrics.water_ml` changes. The 400 above is the current behaviour to
  start from.

### [platform][body][nutrition] Q-464 — request schemas are almost never `.strict()`, and on a date-bearing write route that turns a mistyped key into a silent wrong-day write

- **Branch:** `fix/strict-request-schemas`
- **Added:** 2026-08-18 · review sweep (ingest + input validation) ·
  [`docs/reviews/2026-08-18-ingest-and-input-validation.md`](reviews/2026-08-18-ingest-and-input-validation.md)
- **Placement:** mid-low. **Not a live bug** — the app's own clients send the right keys. Filed because
  the failure mode is silent data misplacement and this repo has already paid for the class once.
- **Measured:** of **70** files defining a `z.object(...)` request schema across `app/api` and
  `packages/shared/src/validation`, only **6** call `.strict()`. Zod's default silently drops unknown keys.
- **Demonstrated live** on `POST /api/body-metadata`:

  | Sent | Response | Row written |
  |---|---|---|
  | `{"date":"2026-08-10","weightKg":81}` | `200 {"success":true,"date":"2026-08-18"}` | weight 81 on **2026-08-18** |
  | `{"date":"3026-08-18","weightKg":81}` | `200 {"success":true,…}` | **2026-08-18** |
  | `{"date":"not-a-date","weightKg":81}` | `200 {"success":true,…}` | **2026-08-18** |

- **Do NOT change the route — it is correct.** `app/api/body-metadata/route.ts:236` reads
  `body.localDate` and defaults to today in the user's timezone when absent, which is the documented
  pattern. The defect is that `date` is not in the contract, the schema is not strict, so the key is
  dropped and the write lands on today with a success response.
- **Why file it:** the repo has already lost a full release to this exact class — the `ai-chat`
  `localDate` regex that rejected every real request, documented at length in `CLAUDE.md`. A strict
  schema turns that mistake into a 400 at the boundary instead of a silent wrong-day write.
- **Eleven date-bearing write schemas are non-strict**, including `sync/push`, `health-connect/ingest`,
  `running-plan`, `running-plan/override`, `plan-meal-answers`, and the shared `body-metrics`,
  `activity-log` and `fitness-test` schemas. `WorkoutEntryPatchSchema` is one of the six that **is**
  strict — use it as the reference.
- **Fix shape:** add `.strict()`, date-bearing schemas first, then a CI rule — same shape as the
  hex-literal and TTL-divergence ratchets, which exist because prose alone did not hold the line.
- 🚧 **The ratchet and the demonstrated schema SHIPPED 2026-08-18; 89 non-strict remain.**
  `scripts/check-strict-request-schemas.js` runs in the Custom Rules job (now **39** steps) with a
  shrink-only per-file baseline: a file not listed must have zero, a listed one may only shrink, and
  reaching zero requires deleting its row. `BodyMetadataPostSchema` — the one the entry demonstrated
  — is strict, and all four measured wrong-key writes now 400 instead of landing on today.
- ⚠️ **Two corrections to this entry, both found while implementing it.**
  **(a) It IS a live bug.** The entry says "not a live bug — the app's own clients send the right
  keys". They do not: the Water widget's web fallback posts `waterIntake`, which no schema names, and
  the value was discarded behind a `200`. Filed as **Q-319** (Lane B) with the measurement.
  **(b) The `sync/push` caveat is far wider than one route.** The entry singles out `sync/push`, but
  the same argument applies to **every schema `pushMutations` parses** — `activity-log`,
  `fitness-test`, `day-checkin`, `oura-summary`, mood, food-item, log-exercise, session-rpe,
  complete-workout. An outbox payload is written to local SQLite by whatever bundle was current when
  the user acted and sits there until the device syncs, so tightening any of those can reject a
  mutation queued by an older bundle and dead-letter real data. Plus `health-connect/ingest`, whose
  client is the owner's Tasker profile and is not in this repo. Both classes are named with their
  reasons in the script's header rather than silently skipped.
- **What is left is the sweep**, deliberately not done here: 89 non-strict schemas, each needing its
  clients checked the way `BodyMetadataPostSchema`'s two were. The ratchet is the mechanism; the
  sweep is separate and much larger, exactly as `check-hex-literals` says of its own 471.
- **⚠️ `sync/push` needs care and is the reason not to codemod this.** Outbox payloads from an older
  APK may legitimately carry fields the current schema does not name; making that one strict could
  reject mutations from a device that has not updated. Handle it deliberately, or exempt it with a
  written reason. **Lane A.**

### [platform] Q-466 — CI re-downloads the Playwright browser on every E2E run, and a slow CDN turns that into an indefinite stall

- **Branch:** `ci/cache-playwright-browsers`
- **Added:** 2026-08-18 · review sweep (observed while landing the section-coverage PRs) ·
  [`docs/reviews/2026-08-18-ingest-and-input-validation.md`](reviews/2026-08-18-ingest-and-input-validation.md)
- **Placement:** low-mid. Costs nothing when the CDN is healthy and blocks a PR entirely when it is not.
- **What.** `.github/workflows/ci.yml:391-392` runs `npx playwright install --with-deps chromium` on
  **every** E2E run, with no cache:
  ```yaml
  - name: Install Chromium
    run: npx playwright install --with-deps chromium
  ```
  `actions/setup-node`'s `cache: 'pnpm'` (five jobs use it) caches the pnpm store, **not** the
  Playwright browser binaries, which live in `~/.cache/ms-playwright`. So each run pulls ~150 MB of
  Chromium plus system packages afresh.
- **Observed three times on 2026-08-18**, on PR #47 and twice on PR #66, out of roughly 8–10 E2E runs
  that day — a small sample, so treat the *rate* as indicative rather than measured, but three in one
  day on one repo is not a coincidence. In both cases the step sat
  `in_progress` for **6–22 minutes** with every other job already green, and the job had to be
  cancelled and re-run; the re-run completed the same step in well under a minute. The tell is
  distinctive and worth knowing: `Install Chromium` `in_progress` while `Run pnpm e2e` is still
  `pending` means the download, not the specs.
- **Why it is worth fixing rather than tolerating.** E2E is a **required check**, so this blocks the
  merge outright rather than degrading it, and the recovery (cancel the run, re-run the workflow,
  wait again) costs ~20 minutes of wall clock each time. With five concurrent agents landing PRs, that
  is paid repeatedly.
- **Fix shape:** add `actions/cache` for `~/.cache/ms-playwright`, keyed on the resolved
  `@playwright/test` version from `pnpm-lock.yaml` so a version bump invalidates it — the standard
  pattern from Playwright's own CI docs. Keep the `install` step (it must still run to place the
  browser and system deps on a cache miss); the cache only removes the download.
- **Note for the implementer:** `playwright.config.ts` deliberately prefers the sandbox's
  `/opt/pw-browsers/chromium` when present and falls back to Playwright's managed download elsewhere,
  which is why CI needs the install at all. That comment explains the design — do not "simplify" it
  away while adding the cache.

### [readiness] Q-465 — `POST /api/day-checkin` creates a check-in row from a completely empty body

- **Branch:** `fix/day-checkin-requires-an-answer`
- **Added:** 2026-08-18 · review sweep (ingest + input validation) ·
  [`docs/reviews/2026-08-18-ingest-and-input-validation.md`](reviews/2026-08-18-ingest-and-input-validation.md)
- **Placement:** low. **The consequence is unproven and the entry says so** — do not implement this as
  if a known symptom were being fixed.
- **Observed.** `POST /api/day-checkin` with a body of exactly `{}` returns **201** and writes a row
  with every metric null:
  ```
  log_date    phase    physical_tiredness  mental_drain  hydration  sore_muscles
  2026-08-18  evening  (null)              (null)        (null)     {}
  ```
  An unknown field is accepted and dropped too (`{"sleepQuality":"banana"}` → 201, nothing stored —
  `day_checkins` has no such column). That half belongs to Q-464.
- **Both consumers were checked and neither shows a user-visible bug.**
  `components/morning-checkin-sheet.tsx:58-70` pre-fills from a saved row but coalesces every field
  through `?? NEUTRAL_SCALES`, so an all-null row behaves identically to no row.
  `app/api/workout-data/route.ts:471` feeds the check-in into `reevaluationKey(...)`, where an empty
  row changes the key and can trigger a re-evaluation carrying no new information.
- **Why it is still worth closing:** the row is indistinguishable from a real check-in in which the
  user answered nothing, and readiness is precisely the pillar where *"the user told us nothing"* and
  *"the user told us they feel neutral"* must not collapse to the same value.
- **Fix shape:** require at least one meaningful field, or return the existing row unchanged when the
  body carries no answers. **Lane A.**
- **🔎 AMENDED 2026-08-18 from production — REFUTED in practice; drop the priority.** Across all 50 of
  the owner's check-in rows, checked against **every** answer column (including the six morning ones:
  `wake_mood`, `perceived_recovery`, `motivation`, `sleep_quality_feel`, `resting_soreness`,
  `illness_context`), **zero are truly empty** — 45 morning and 5 evening, all carrying answers. The
  route will write a hollow row if handed `{}`, but nothing in real use has done so.
  ⚠️ **A first version of that query said "45 of 50 entirely empty" and was WRONG** — it tested only
  the evening columns. Recorded so the false number is not picked up from anywhere it leaked.

### [platform] Q-456 — the owner's production user ID is baked into 18 committed migrations, and the documented process re-publishes it on every schema change

- **Branch:** `fix/claude-ro-owner-id-out-of-committed-migrations`
- **Added:** 2026-08-17 · review sweep (repo-migration architecture lens) ·
  [`docs/reviews/2026-08-17-repo-migration-architecture.md`](reviews/2026-08-17-repo-migration-architecture.md)
- **Placement:** upper-mid. Not urgent — nothing is exploitable today — but it **compounds**: the
  documented process adds another public copy on every schema change, so the cost of fixing it only
  goes up.
- **What.** `fe481797-4114-4f59-824d-223e0281823e` is the owner's production `users.id`. It is in
  **18 tracked files**: every `NNN_claude_ro_views*.sql` migration,
  `lib/data/postgres/__tests__/claude-ro-readonly-role.test.ts:41` (`OWNER_ID`), and
  `docs/superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md` (which spells out
  `CLAUDE_RO_OWNER_USER_ID=fe481797-…`). `scripts/generate-claude-ro-views.js` bakes it in as the
  row-scoping predicate and the generated SQL is committed. Invisible while the repo was private.
- **What it is NOT.** Not a credential. It grants nothing alone — `/api/admin/db-query` needs
  `CLAUDE_DB_QUERY_SECRET` **and** `requireAdmin`, and every other route is `auth()`-scoped. No
  health data, email or name is exposed with it. **Do not treat this as an incident.**
- **Why it is still worth fixing, in order:**
  1. **It is one half of a credential pair.** `WEBHOOK_USER_ID` (+ `HEALTH_CONNECT_INGEST_SECRET`)
     and `ADMIN_EXPORT_USER_ID` (+ `ADMIN_EXPORT_SECRET`) resolve to a user id that is almost
     certainly this one. If either secret leaks, the other half is no longer a guess.
  2. **It cannot be rotated cheaply** — 18 files plus the production row it identifies.
  3. **The process re-publishes it.** `CLAUDE.md` requires re-running the generator into a **new**
     migration number whenever a table is added, so every future schema change adds another public
     file containing it, indefinitely.
- **Fix shape (implementer's call).** Prefer killing the class over scrubbing 18 files: have the
  generator resolve the owner at **apply** time rather than **generate** time — views scoped on
  `current_setting('app.claude_ro_owner')`, or a single-row private lookup seeded out-of-band, the
  same way the `claude_readonly` role's password is already kept out of committed migrations. Then
  the 18 existing files can be superseded by one rebuild migration rather than edited. Note
  `CLAUDE.md`'s warning: `ensureSchema` tracks by filename, so **never edit an already-applied
  migration** — this has to land as a new number that DROPs and rebuilds the schema.
- **Lane A owns this** — it is migrations, and no other agent takes a migration number.
- **Related, not filed separately:** `private-paths.json` protects a third party's IP well, and
  nothing plays that role for this project's own users' identifiers. Whether that wants a second list
  or a widening of the existing one is a design decision; see the review's closing section.

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
> Journal: [`entries/2026-08-16-goal-label-association.md`](overview/history-2026-08-15.md).

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
> Journal: [`entries/2026-08-16-goal-invalidation-not-guardable.md`](overview/history-2026-08-15.md).

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
> Journal: [`entries/2026-08-16-invalidation-audit.md`](overview/history-2026-08-15.md).

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
     `_meta_withheld_columns`; regenerate into **migration 191** (a new number, never overwriting an
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
- **✅ Step 3 is unblocked. `ADMIN_SNAPSHOT_SECRET` was approved as a separate secret and set by the
  owner on 2026-08-17**, in both places it is needed: Railway (so the server accepts the token) and
  the Claude Code environment (so a session can send it). Reusing `ADMIN_EXPORT_SECRET` was
  considered and rejected — day-review returns 31 days of derived scores, this returns the database,
  so a leak of one must not be a leak of both.
  - **A session started before that change cannot see the variable** — the environment is injected at
    container start. If `echo ${#ADMIN_SNAPSHOT_SECRET}` prints 0, that is a stale container, not a
    missing secret; start a fresh session.
  - **Nothing has verified the Railway half yet, and nothing can until step 3 ships**, because no
    code reads the variable. The first real check is
    `curl -si …/api/admin/db-snapshot -H "Authorization: Bearer $ADMIN_SNAPSHOT_SECRET"` returning a
    200 and a manifest line. A 401 there means the two copies disagree; treat it as configuration
    before suspecting the route.
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
- **✅ The 4–8 week re-measurement this entry asked for, done 2026-08-17 (Lane B) — and it changes
  the finding.** 56 days of `exercise_logs` × `set_logs`, soft-deletes excluded, compared against the
  landmarks **as the app actually computes them**: the active program *Shikai* is `powerbuilding`, so
  `GOAL_MULTIPLIER` scales the table by **×0.8**. The §3 table above compared against the raw
  hypertrophy row (×1.0), which is not what any user is measured against.

  | muscle | sets/wk (8 wk) | MEV | MAV | MRV | verdict |
  |---|---|---|---|---|---|
  | glutes | 22.1 | 3 | 8 | 14 | **158% of MRV** |
  | hamstrings | 21.6 | 5 | 10 | 14 | **154% of MRV** |
  | triceps | 20.3 | 5 | 10 | 16 | **127% of MRV** |
  | shoulders | 14.9 | 6 | 13 | 18 | above MAV |
  | biceps | 14.0 | 5 | 11 | 18 | above MAV |
  | lower back | 9.4 | 3 | 6 | 10 | above MAV |
  | lats | 9.3 | 8 | 13 | 18 | **in range** |
  | upper back | 6.3 | 6 | 11 | 16 | **in range** |
  | calves | 2.8 | 6 | 11 | 16 | **47% of MEV** |

  **Two corrections to §3.** (a) It is not a quiet week — the pattern is persistent over eight. (b)
  **lats and upper back are NOT below MEV**; they only looked that way against the unscaled table.
  Calves are the one genuine deficit, and they are worse than a "quarter of MEV" reads once scaled.
- **The story is over-volume, not under-volume, and that is the opposite of how §3 framed it.**
  Three muscles sit above *max recoverable* volume and one sits below minimum effective. A surface
  built to say "you are not doing enough calves" would miss the larger half.
- **Push:pull replicates.** legs 458 (34%), push 382 (29%), pull 286 (22%), other 202 (15%) over the
  same 56 days — **push:pull 1.34**, against the 1.30 recorded over 60 days. Consistent, and the
  same mild push dominance rather than anything pathological.
- **Still open, and still the actual work:** the surface itself, plus the design question of whether
  Q-278 / Q-302 / Q-305 share one treatment. Nothing was built — this entry gated building on the
  re-measurement, and that is what was delivered.
- **Where it likely belongs:** the same screen that already shows weekly volume, rather than a new
  destination — see the IA cluster (Q-232…Q-239) before adding a surface.
- **A related check that came back CLEAN, recorded so it is not re-investigated:** `core` is tagged on
  exercises and absent from `MUSCLE_LANDMARKS`, which looks like a silent fall-through to
  `DEFAULT_LANDMARKS`. It is not — `muscles.ts:17` maps `core: 'abs'` and `volume-targets.ts:58`
  applies `normalizeMuscle` before the lookup. Working correctly.

### [platform] Q-458 — `.env.example` is the public configuration contract and it is wrong in both directions

- **Branch:** `fix/env-example-reconcile`
- **Added:** 2026-08-17 · review sweep (repo-migration architecture lens) ·
  [`docs/reviews/2026-08-17-repo-migration-architecture.md`](reviews/2026-08-17-repo-migration-architecture.md)
- **Placement:** mid. Mostly tidy-up, with one edge that names a security property the app does not
  have.
- **Method.** Differenced every `process.env.X` read under `lib app packages scripts
  instrumentation*` against the keys declared in `.env.example`.
- **Declared, read by no code — 8 keys:**

  | Key | Why dead |
  |---|---|
  | `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `OURA_REDIRECT_URI`, `OURA_WEBHOOK_CALLBACK_URL`, `OURA_WEBHOOK_VERIFICATION_TOKEN` | Oura **Cloud** integration deleted 2026-08-13 |
  | `GEMINI_API_KEY` | Retired at Q-189; `CLAUDE.md` already says nothing reads it |
  | `TOKEN_ENC_KEY` | Nothing reads it |
  | `AUTH_URL` | Nothing reads it |

- **The sharp edge is `TOKEN_ENC_KEY`.** It reads as the key that encrypts stored tokens. An operator
  will generate one, set it, and reasonably conclude tokens are encrypted at rest. Nothing reads it,
  so nothing is. **A dead variable that names a security property is worse than a dead variable** —
  fix this one even if the rest is deferred.
- **The second edge is the five Oura Cloud keys.** `CLAUDE.md` is emphatic that the Cloud integration
  must never be re-added (re-onboarding the official app risks a firmware update that breaks the
  reverse-engineered BLE protocol). The public onboarding file currently invites a contributor to go
  get credentials for exactly that. Two project files contradict each other, and the newcomer reads
  the wrong one first.
- **Read by code, undeclared — the real configuration** (excluding test/script knobs
  `OURA_CONSTANTS_DIR`, `RECORD_MODEL_FIXTURES`, `CHUNKS`, `RTT_MS`, `SERIAL`):
  `CLAUDE_RO_OWNER_USER_ID`, `LOCAL_DATABASE_URL`, `PG_POOL_MAX`, `RAILWAY_GIT_COMMIT_SHA`.
- **Do NOT "fix" the `AWS_*` keys.** They are absent from `.env.example` deliberately —
  `lib/exercise-storage.ts:4-24` reads `AWS_* ?? STORAGE_*` as an alias chain and
  `constants-delivery.ts:74` reuses that module, so documenting `STORAGE_*` alone is correct. This
  was checked and cleared; see the review.
- **Fix shape:** delete the eight, add the four. Consider a Custom Rules step that differences the
  two automatically — this drifted silently because nothing measured it, the same argument that
  produced the hex-literal and TTL-divergence ratchets.

### [platform][devices] Q-459 — the rolling APK release is delete-then-recreate, so the advertised public download URL 404s during every native merge

- **Branch:** `fix/apk-rolling-release-no-404-window`
- **Added:** 2026-08-17 · review sweep (repo-migration architecture lens) ·
  [`docs/reviews/2026-08-17-repo-migration-architecture.md`](reviews/2026-08-17-repo-migration-architecture.md)
- **Placement:** low. Short window, infrequent trigger.
- **What.** `.github/workflows/android.yml:122-127`:
  ```bash
  gh release delete apk-latest --yes --cleanup-tag 2>/dev/null || true
  gh release create apk-latest android/app/build/outputs/apk/debug/app-debug.apk …
  ```
  Between the two commands the release **and its tag** do not exist. `CLAUDE.md` advertises
  `…/releases/download/apk-latest/app-debug.apk` as *"always the newest `main` build, non-expiring,
  and genuinely no login required"*, and `/api/download-apk` resolves it via
  `/releases/tags/apk-latest` — a 404 in that window, surfacing as "Could not fetch release info".
- **The workflow comment explains the choice honestly** (`gh` cannot overwrite an existing asset of
  the same name in place), so this is a known trade-off, not an oversight. **The migration is what
  made it matter:** while the repo was private nobody could use that URL; it is now the documented
  distribution path.
- **Fix shape:** upload under a temporary asset name and swap, or delete only the **asset** rather
  than the release and tag, so the release id and tag survive the swap.

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

> **Fresh evidence, 2026-08-17.** After Q-536's clock repair the sleep table is clean apart from
> exactly **10 rows**, and all ten are this: daytime fragments of 0.0–1.4 h stored as sleep sessions
> (14:39–14:59 · 0.1 h; 11:03–11:33 · 0.0 h; 09:33–11:11 · 0.1 h; 16:47–18:32 · 1.4 h; …). They are
> the entire remaining deviation from a 19:00–23:00 bedtime distribution across 82 nights, so this
> entry is now the only thing standing between the sleep list and being correct end to end.

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
- **Do this before the calibration items (Q-500, Q-272, Q-505).** Each of those creates another
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
- **⚠️ Read [`docs/reviews/2026-08-17-body-battery-calibration.md`](reviews/2026-08-17-body-battery-calibration.md)
  (Q-502) before starting. It re-measured this entry (still true — 5.6× on 14 v5 days now) and found
  two things that change how to work it:** (a) **direction #1 above is refuted** — the charge window
  is reachable on a median 6.7% of waking samples (0.8% on 2026-08-14), so raising `CHARGE_RATE`
  scales a term that is barely active; `REST_THRESHOLD`/the reserve is the lever. (b) The stored
  snapshots are **partial days** (two of 14 carry under 3% of their available samples), and since rest
  is back-loaded into the evening this biases the ratio upward — treat 5.6× as an upper bound.

### [readiness] ✅ Q-500 — SHIPPED v1.320.0: Recovery Index anchor 6 h → 5 h

- **Shipped 2026-08-18** after the owner approved it (*"we will go with whatever your recommendation
  is"*). One constant in `packages/shared/src/health/readiness-composite.ts`.
  Evidence: [`docs/reviews/2026-08-17-readiness-calibration.md`](reviews/2026-08-17-readiness-calibration.md).
- Fitted against Oura's own `recovery_index` contributor over the 15 pre-re-key nights where both
  exist — the only external ground truth this app has. Our estimator tracks theirs at **r = +0.712**
  (beating every alternative tested — do **not** change the argmin) but carried a systematic
  **−10.2-point** bias. Zero-bias anchor **4.63 h**, LOO 4.40–5.14, RMSE flat 4.5–5.25; **5** sits on
  that floor and keeps a small negative bias so the term still errs toward under-scoring.
- **Thresholds deliberately NOT re-anchored, and this is the nuance in the rule.** The
  `LOW_SLEEP_SCORE` precedent says re-anchor when the *scale* changes, to preserve firing rates. This
  is not a scale change — it is a **bias correction** on one contributor. The 3 days that move 74 → 75
  become "recovered" because the measurement was under-reporting, which is the fix working, not a
  side-effect to cancel out. No day crosses the early-deload, Low/Moderate or low-readiness line.
- **`READINESS_MODEL_VERSION` bumped to `v3:ri5:2026-08-18`** so this shift stays attributable.
- **Follow-up (not blocking):** re-derive the anchor on ~15 BLE-era nights. This fit is Cloud-era and
  BLE overnight HR is ~2× noisier, so the anchor is conservative for current data rather than wrong.
### [activity] Q-505 — Activity Score: redesign as a daily effort meter with a target (decisions resolved, ready to build)

- **Branch:** `fix/activity-score-lane-weights` · **Lane:** A
- **No longer blocked.** All three decisions were resolved 2026-08-18 — the owner delegated them
  (*"we will go with whatever your recommendation is, knowing we are going for best practice + future
  proof"*). The reasoning is kept in the plan so it can be argued with, not just followed.
- **Added:** 2026-08-18 · Tuning ·
  [`docs/reviews/2026-08-18-activity-score-calibration.md`](reviews/2026-08-18-activity-score-calibration.md)
- **⚠️ Contributor-by-contributor audit added 2026-08-19 — read this before designing the replacement.**
  [`docs/reviews/2026-08-19-activity-contributor-audit.md`](reviews/2026-08-19-activity-contributor-audit.md).
  All six contributors measured over 90 days:

  | contributor | weight | mean | sd | at ceiling | verdict |
  |---|---|---|---|---|---|
  | steps | 18 | 53.6 | **33.4** | 16/90 | ✅ best in the score |
  | strengthVolume | 20 | 81.4 | **23.8** | 32/88 | ✅ Q-190's fix delivered |
  | strengthFreq | 25 | 95.0 | 13.1 | **69/88 (78%)** | 🟡 compressed **by design** |
  | moveHours | 12 | ~97 | — | **48/59** | ❌ saturated (Q-522) |
  | zoneMinutes | 10 | ~6 | — | **53/59 at zero** | ❌ floored (Q-523) |
  | activeEnergy | 15 | — | — | — | ❌ absent 43/51 days (Q-521) |

  With `activeEnergy` absent and `zoneMinutes` suppressed on strength days, the model renormalises
  over 75 → effective weights strengthFreq **33%**, strengthVolume **27%**, steps **24%**, moveHours
  **16%**. **51% of effective weight carries information; 49% does not, and the largest single
  effective weight is one of the inert ones.**
- **Do NOT "fix" `strengthFreq` by raising the goal or extending the curve.** `daily-goals.ts` sets
  the goal *at* the owner's typical deliberately — more sessions is not monotonically better, the
  ACWR taper already handles over-reach, and *"a goal of 6 would have one part of the model rewarding
  what another punishes."* That reasoning holds. **Treat the 33% as a constraint the redesign must
  work around, not a defect it can remove** — if the new model wants range, it has to come from
  elsewhere.
- **Q-137/Q-190 did work, and stored history hides it.** Stored `activity_score` sd **5.0 → 7.4**
  across the 2026-08-11 goal change (range 66–81 → 64–91). n = 8 post-fix, so directional; and 15 of
  the 23 stored days are still scored under the old goals because history is not back-filled — the
  same trap the sleep recalibration hit. Reconstructing from contributors at effective weights
  predicts a ceiling of **sd ≈ 10.2** under current goals (steps ⟂ strengthVolume, r = −0.016).
- **⚑ OWNER QUESTION 2026-08-19 reshapes the redesign — read before building.**
  [`docs/reviews/2026-08-19-daily-vs-weekly-windows.md`](reviews/2026-08-19-daily-vs-weekly-windows.md).
  Owner: *"the goal being x heart minutes per day to depict healthy heart usage through the day —
  but you also gotta count for weekly targets. How handle this?"*
  - **`DEFAULT_ZONE_MINUTES_GOAL = 22` is WHO's 150 min/week ÷ 7**, and that division does not
    preserve the guideline: 150 minutes taken in three sessions satisfies WHO and fails the daily
    goal four days in seven.
  - **The rule: match each contributor's window to its guideline's own unit.** Applied across all
    six, **exactly one is wrong** — `zoneMinutes` (WHO is weekly, window is daily). `steps` (Paluch,
    daily), `moveHours` (daily), `strengthFreq`/`strengthVolume` (weekly, already rolling-7d) are all
    correct. The precedent is in the same file: the strength block is commented *"rolling 7-day, so a
    rest day still scores off recent training."*
  - **Recommendation — split into two numbers.** **Today:** `steps`, `moveHours`, session-happened.
    **This week:** rolling-7d active minutes vs **WHO 150**, `strengthFreq` vs ≥2/wk, weekly tonnage.
    Every number then answers one question, and a rest day inside a strong week reads as *rest today,
    on track this week* rather than one blended number that is neither.
  - **This retires the `strengthFreq` ceiling as a defect.** 100 on 78% of days reads wrong in a daily
    score and reads *correct* in a weekly compliance number — *"you met the strength guideline in 78%
    of trailing weeks."* **Its ceiling was never the problem; its scorecard was.** Supersedes the
    "constraint the redesign must work around" framing added earlier the same day.
  - **Q-522 rises in priority under this design** — the daily number leans on `steps` and
    `moveHours`, so a saturated `moveHours` stops being one inert contributor of six and becomes half
    of the daily score.
  - **Measured (rolling 7-day ÷ 150, under Q-523's corrected threshold):** contributor mean **79.2**,
    sd 26.7, **zero days 0/59** (against daily ÷ 22: mean 63.8, sd 38.7, 6 zero days). Weekly total
    mean **164.4 min**, range 12–378, meeting WHO on 26 of 59 days.
  - **⚠️ Do not read "60% of weight is rolling" as "the score is a weekly number".** The rolling
    terms carry most of the weight and almost none of the *variance* (they saturate), so they set the
    **level** while same-day steps move it slightly: score ↔ same-day steps **r = +0.324**, ↔
    sessions7d +0.186, ↔ volume7d +0.026 (n = 23, directional). That is the mechanism behind this
    entry's own headline anomaly — 76 on 828 steps vs 64 on 8,935.
  - **Depends on Q-523 landing first.** Under today's shipped threshold the weekly total is near zero,
    so every figure above assumes the corrected WHO band.
- **⛔ Do Q-526 FIRST.** `activity_contributors` currently stores the blend wrapper, not the six
  components, so the old model's contributor history is not recorded anywhere. Land the redesign
  first and that history is lost permanently — and the before/after comparison that would show
  whether the redesign worked cannot be made. Q-526 is one line at an existing persist site.
- **This entry absorbs Q-277**, whose investigation is complete (see the review's §1 and §4).
- **Measured.** n=22: range 56–91, mean 74.6, **sd 7.2**, with 11 of 22 days in the 70s. Against
  same-day steps **r = +0.417** — and **2026-08-12 scored 76 on 828 steps while 2026-08-16 scored 64
  on 8,935**. Steps span 29x across the window; the score moves 25 points.
- **Why (three measured causes):**
  1. `strengthFreq` (25) + `strengthVolume` (20) are **45 of 100** and both roll over 7 days. The
     owner has logged **exactly one session/day for 27 consecutive days**, so `strengthFreq` is
     near-constant by construction.
  2. `activeCalories` is non-null on **1 of 47 days** and zone-2+ minutes are **0 on 22 of 27**. Both
     get excluded and the weights renormalise, leaving roughly **steps 24% · moveHours 16% ·
     strengthFreq 33% · strengthVolume 27%** — 60% on the near-constant terms.
  3. `adjustment` is **0 on all 22 days**: `ACWR_TAPER_START = 1.5` has never been reached, so the
     only place ACWR enters this score is inert.
- **A range calibration is NOT the fix here, unlike Sleep (Q-503).** Stretching preserves ranking, so
  it would make the "828 steps beat 8,935 steps" ordering *more* emphatic. Do not copy the Sleep
  technique onto this pillar.
- **DECIDED 2026-08-18 — the owner chose (a): it scores TODAY.** Design proposal with the measured
  input audit:
  [`docs/superpowers/plans/2026-08-18-activity-score-redesign.md`](superpowers/plans/2026-08-18-activity-score-redesign.md).
  Brief: steps/day, movement distribution, zone minutes (daily + against a weekly target), exercise
  minutes, a weekly-to-daily target split; hitting everything = 100; doubles as guidance
  ("keep it under X today on a deload").
- **The three resolved decisions:** (1) over-exertion is **fitted** against next-day HRV/RHR rather
  than invented — if there is no correlation, ship a deliberately small weight and say so in the
  comment; (2) bands go **target-relative**, with Activity getting its **own** band function so the
  shared `scoreBand()` stays absolute for Sleep and Readiness; (3) the zone lane scores against
  **`targetAnchorMax`**, the existing named answer for reachable targets.
- **⚠️ CORRECTION 2026-08-18 — the zone HRmax is NOT a One-Formula-One-Place violation.** This entry
  previously said two parts of the app disagreed about the owner's max HR and called it a bug to fix
  first. Wrong: `resolveHrProfile` (`packages/shared/src/health/hr-profile.ts`) is already canonical
  and deliberately returns `maxHr` (the ceiling) **and** `targetAnchorMax` (the reachable-target
  anchor), with `resolveBatteryHrMax` a third for the battery's reserve. Its own comment explains why
  the ceiling must not be the observed max. **A change was implemented and then reverted on reading
  that.**
- **What is true, and still gates the zone lane:** at the 187 ceiling zone 2 starts ~133 bpm, and over
  **52,647** HR samples since 2026-07-07 only **134 (0.25%)** reach it — observed max **166**. Zone 2+
  really is ~1 min/day for this training style; the reading is honest, not broken. Decision 3 resolves
  it: score the lane against **`targetAnchorMax`**, which puts zone 2 near ~122 bpm (7% of samples
  already exceed 110). **Measure the resulting distribution before assigning the lane a weight.**
- **"Steps per hour" has no source** — `step_live_windows` holds **11 rows total**. Use the existing
  HR-derived `moveHours` proxy (`packages/shared/src/health/hourly-movement.ts`), which exists for
  exactly this reason; do not build hourly step ingest for it.
- **If (a):** re-weight first, then measure the new distribution, then apply a range calibration only
  if still compressed — and re-anchor any threshold on the activity scale in the same PR (Q-503's §5
  is the worked example).
- **Related, not fixed by this:** Q-278 (the score is absent on more than half of days and the UI does
  not distinguish that from a real score) and Q-505 (which absorbed Q-277's discrimination finding,
  now answered by the 2026-08-19 contributor audit). Also worth
  doing regardless: **persist the contributor sub-scores** — `activity_contributors` carries only
  `base`/`trained`/`adjustment`, so the weight arithmetic above had to be derived rather than read.

### [readiness] Q-504 — REFUTED: readiness should NOT get a range calibration; fix Q-500 instead

- **Added:** 2026-08-18 · **Resolved the same day, by implementing it and finding it wrong.**
  [`docs/reviews/2026-08-18-readiness-range-refuted.md`](reviews/2026-08-18-readiness-range-refuted.md)
- **What this entry used to say:** readiness has Sleep's compression problem and the same
  `SCORE_CALIBRATION` fix is measured and ready (mean 66.8, sd 19.1, range 15–99), held only on the
  blast radius of five action thresholds. **Both halves of that are wrong.**
- **Why the calibration is wrong here, not just risky.** It was implemented and the suite failed on
  7 tests across 4 files. Three encode invariants the composite genuinely holds, and a post-hoc
  transform on the blend breaks all three: **contributions no longer sum to the displayed score**
  (the score-audit panel's whole job), **all-neutral input stops mapping to 50** (it gave 35), and
  **skipping the check-in can reach 100** (a deliberate cap defeated). The first is disqualifying on
  its own — readiness drives every training recommendation, and making its explanation panel stop
  adding up is a worse outcome than a narrow range.
- **Why the in-model lever fails too.** `Z_POINTS_PER_UNIT` would widen spread while preserving all
  three invariants (z=0 → 50 at any slope). But the z-based contributors are **already wide and
  already saturating**: `hrvBalance` sd **27.1** with a median implied |z| of **1.26** against a
  ceiling at 1.5; `sleepBalance` sd **32.3**, both reaching the 0 and 100 rails. Raising the slope
  pushes more days onto the rails and compresses the ends.
- **There is no compression bug.** Contributors carry sd 17–32; the composite carries sd ~11–13.
  Treating the weighted sds as independent predicts **7.7** — so readiness is already extracting
  *more* spread than independence would give. Against the owner's test it is the healthiest pillar
  (range 29–87, sd 13.0, with genuinely low days), unlike Sleep's 27-of-35 above 85.
- **Its real weakness is the CEILING** — 1 of 34 days reaches 85 — and the term dragging it down is
  `recoveryIndex`, **mean 35.3**, the lowest of the nine by 20 points. **That is Q-500.** This session
  had demoted Q-500 to "lower priority since Q-504 fixes the range wholesale"; that is corrected —
  **Q-500 is the readiness fix.**
- **Also note:** readiness moves on its own from v1.319.0. `previousNight` is 16% of the weight and
  the Sleep Score's mean fell ~87 → ~70, so readiness's mean drops roughly **1.8 points** with nothing
  else changed. Re-measure before drawing conclusions from the new numbers.
- **Shipped from this entry:** the readiness `model_version` stamp (Q-273's readiness half) — merged
  into the shared `model_versions` JSONB rather than replacing it, so `bodyBattery`'s stamp survives.
  Sleep shipped without one and left an unmarked step in its trend chart; readiness will not.

### [readiness][platform] Q-501 — a stored readiness score cannot be re-derived from the inputs stored beside it

- **Branch:** `fix/readiness-derived-recompute`
- **Plan:** none yet
- **Added:** 2026-08-17 · Tuning agent · found while measuring Q-500 ·
  [`docs/reviews/2026-08-17-readiness-calibration.md`](reviews/2026-08-17-readiness-calibration.md) §6
- **⚠️ SECOND live demonstration, 2026-08-18, and it is the more damaging one.** After the Sleep
  (v1.319.0) and Readiness (v1.321.0) recalibrations deployed (production reports **1.321.1**), a
  bulk job at **03:55:01** bumped `updated_at` on essentially every `oura_daily_derived` row **without
  rewriting any score**. Result, measured: **0 of 96 rows carry a `readiness` model version**, and
  every stored sleep/readiness score is still pre-recalibration (2026-08-17 stores **78** for a
  7.58 h / 90% / 0.75 h-deep night — an old-model value). Every one of those rows was *created*
  before the deploy.
  **So `updated_at` is not evidence of which model wrote a row** — it moves for reasons unrelated to
  the score. Anyone auditing "did the recalibration land?" by timestamp gets the wrong answer, and
  this is exactly why the `model_version` stamp matters more than it looks.
- **✅ RESOLVED for the "did it land" question, 2026-08-18 ~05:00 UTC** — the prediction below came
  true within the hour. **1 of 96** rows now carries `{"bodyComp": "atlas_2_1_0", "readiness":
  "v3:ri5:2026-08-18"}` (so the JSONB **merge** held in production, not just in review), and sleep —
  which has no stamp — was verified by recomputation instead: 2026-08-17 stores **78** against a raw
  blend of **77.91** (old model), 2026-08-18 stores **92** against a calibrated **92** (new model,
  raw blend 86.07). The trend step falls between those two days.
  [`docs/reviews/2026-08-18-recalibrations-live-verified.md`](reviews/2026-08-18-recalibrations-live-verified.md).
  **This entry's own substance is unaffected** — a stored derived row still cannot be re-derived from
  the inputs beside it, and `updated_at` still does not identify the writing model; the sleep check
  worked only because that pillar's *contributors* happen to be persisted.
- **Consequence worth knowing:** stored scores are only rewritten when the readiness route recomputes,
  which happens on app open. Placeholder rows already exist through **2026-08-22** with null scores,
  so the first row to carry new-model values *and* the `v3:ri5:2026-08-18` stamp will be the next day
  actually scored — that is where the trend step falls, and the stamp is what will mark it.
- **Demonstrated live 2026-08-17:** the 08-13 summary was re-rolled mid-session (hours 1.20 → 5.78,
  a Q-274 fragment night resolving itself) and the derived readiness row did not follow — that day's
  persisted score is now **7 points** off a fresh recompute at the unchanged anchor.
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

### [devices][readiness] Q-506 — the illness radar cannot fire: the temperature baseline's deviation is 18.7× too large

- **Branch:** `fix/temperature-baseline-cold-start`
- **Plan:** none yet — **Lane A implements; Tuning proposes only.** This is a baseline/data fix, not
  a scoring-constant change.
- **Added:** 2026-08-18 · Tuning agent ·
  [`docs/reviews/2026-08-18-illness-radar-calibration.md`](reviews/2026-08-18-illness-radar-calibration.md)
- **Measured** over `claude_ro.oura_daily_derived`, n = 46 days with an illness score: range **0–38**,
  median 7.5, sd 7.17. Flags: `normal` 33, `learning` 13, and **zero** `watch` / `elevated` / `fever`.
  `ILLNESS_WATCH_SCORE = 40`, so the score has peaked **two points short** of the lowest threshold and
  never crossed it.
- **Cause — one biomarker of four is dead, and it carries 40% of the weight.** Observed z ranges:

  | biomarker | weight | z range (n = 31–33) | days z ≥ 1.2 |
  |---|---|---|---|
  | **temperature** | **0.40** | **0.07 – 0.47** | **0** |
  | breathing | 0.25 | −1.37 – 1.88 | 6 |
  | restingHeartRate | 0.20 | −1.22 – 1.18 | 0 |
  | hrvBalance | 0.15 | −2.51 – 3.77 | 17 |

  Three look like z-scores. Temperature is one-sided, always positive, and spans 0.4 in total — at its
  observed maximum it contributes **6** of the 40 points its weight allows. The best day on record
  (2026-07-26, score 38) had a −2.5σ HRV drop *with* elevated breathing *and* elevated resting HR and
  still fell short, because the heaviest term was asleep.
- **The defect is the baseline, not the thresholds.** Stored baseline deviation against the true
  night-to-night sd of the same rows: temperature **253.7 vs 13.5 = 18.7×**; hrv 0.6×, rhr 1.4×,
  breath 1.4×. Since `tempZ = (value − mean) / dev`, every temperature z is divided by ~19× too much.
  It is a **cold start**: the EMA mean began at **1791** centi-°C (17.9 °C) on 2026-07-08 against true
  values of ~3584, so the first nights produced residuals ~130× the true sd, and the dev term is still
  carrying them 40 nights later (332 → 196, with an order of magnitude to go). It hit temperature and
  not the others purely because of scale — centi-°C is ~3,500 where HRV is ~50 ms.
- **`FEVER_TEMP_Z = 2.5` is unreachable, not merely unused** — against an observed max of 0.47 a fever
  would need a nightly skin temperature roughly **5 °C** above baseline.
- **Second consumer.** The same `tempZ` feeds readiness's `temperature` contributor at 10% weight
  (`closer-better`, `100 − |z| × 66.7`). With |z| pinned near 0.3 it returns ~80 essentially every day
  — measured mean 70.5, sd 17.3, **0 of 33 days with |z| ≥ 1.2**. A contributor meant to catch fever is
  close to a constant.
- **Do NOT lower the thresholds.** `watch = 40`, `elevated = 65` and `FEVER_TEMP_Z = 2.5` are all
  defensible *given a correct z*; moving them fits the threshold to a broken input — the mistake this
  session made once on readiness and reverted (Q-504).
- **First action**, in preference order: (1) re-seed the temperature baseline from the observed
  distribution (mean 3584, sd 13.5 over 40 nights) rather than waiting out the EMA — cheapest, fixes
  both consumers; (2) the durable fix — seed a first observation and a sane prior dev instead of zero,
  or hold the dev term through a warm-up, **because every new user repeats this and the app has other
  users**; (3) failing both, gate the radar on temperature baseline maturity so it reports `learning`
  rather than a confident `normal` built on a dead biomarker.
- **Re-measure the whole biomarker table afterwards** — every z in it moves by ~19×, and it is entirely
  possible the radar then fires *too* often. That is the next calibration question, not this one.
- **Worth checking in the same pass:** whether the other baselines cold-start the same way and simply
  recover faster because their scale is small. The ratios above say they are fine *now*, at 40 nights;
  they say nothing about night 5.

### [readiness][activity] Q-507 — the stress override fires on the best days: high-stress minutes correlate +0.40 with readiness

- **Branch:** `fix/stress-override-input`
- **Plan:** none yet — **Lane A implements; Tuning proposes only.**
- **Added:** 2026-08-18 · Tuning agent ·
  [`docs/reviews/2026-08-18-stress-resilience-calibration.md`](reviews/2026-08-18-stress-resilience-calibration.md) §1
- **What it drives.** `STRESS_HIGH_DAY_THRESHOLD_MIN = 120` raises a stress override in
  `computeAiDynamicNextSession`, easing the day's prescribed session. The constant is flagged in
  source as a judgement call (*"tune here, nowhere else"*) and has never been calibrated.
- **The firing rate is fine.** Over n = 25 days carrying `stress_high_minutes`: mean 58.8, median 60,
  sd 47.0, and the override fires on **4 of 25 days (16%)**.
- **The signal points the wrong way.** `corr(stress_high_minutes, readiness_score)` = **+0.400**:

  | group | days | mean readiness | mean sleep | worst readiness |
  |---|---|---|---|---|
  | **fires (≥ 120)** | 4 | **79.0** | 92.8 | 69 |
  | quiet (< 120) | 21 | **65.0** | 84.9 | **29** |

  The four days that would ease training are 2026-07-17 (readiness 69), 07-23 (80), 07-24 (84) and
  07-27 (83). The two genuinely bad days — 07-21 (readiness 37, sleep score 31) and 07-26
  (readiness 29) — carry 0 and 30 minutes and never fire.
- **Two explanations tested and rejected.** *Not exercise*: 19 of 25 are completed-workout days,
  spread evenly (4 of 4 at 0 minutes, 3 of 4 at ≥ 120). *Not purely wear coverage*: it is a partial
  confound (`corr(stress_high, recovery_high)` = +0.304, and both zero-days are zero on **both**
  counts) but net stress still correlates **+0.379** with readiness. For contrast
  `daytime_stress_scaled` — the day's mean level rather than a bucket count — correlates **−0.111**,
  the right sign and no magnitude.
- **Do NOT tune the threshold.** Moving a constant that sits on a signal pointing backwards changes
  *which* good days get eased, not whether the right ones do. Same shape as Q-506, failure inverted:
  there the input was dead, here it is alive and anti-correlated.
- **A precision illusion to know about.** `STRESS_BUCKET_MS` is 30 min, so the value is always a
  multiple of 30 — observed set is exactly `{0,30,60,90,120,150,180}`. The threshold has **seven**
  meaningful positions and 120 sits on an atom: `>= 121` halves the firing rate (4 days → 2). Express
  and justify any future change in **buckets**, not minutes.
- **First action**, in preference order: (1) explain the sign before touching the constant; (2)
  consider `daytime_stress_scaled` as the override input instead — right sign, a mean so coverage
  cancels, already persisted, and it needs its own threshold from scratch (its range is −0.14 to
  +0.23, nothing like 120); (3) failing both, gate the override on daytime coverage, which removes the
  measurable confound without removing the feature.
- **n = 25 is small** — at that size r = +0.40 sits near the conventional significance boundary, so the
  strength is provisional. The group means are the durable part. Re-measure at n ≈ 60.

### [readiness] Q-508 — resilience has emitted exactly one value in its lifetime (level 5, granular pinned at the 5.99 clamp)

- **Branch:** `fix/resilience-longterm-sleep-recovery`
- **Plan:** none yet — **Lane A implements; Tuning proposes only.** Blocked on a question this repo
  cannot answer (see first action).
- **Added:** 2026-08-18 · Tuning agent ·
  [`docs/reviews/2026-08-18-stress-resilience-calibration.md`](reviews/2026-08-18-stress-resilience-calibration.md) §2
- **Measured.** `resilience_level` is present on **13 of 96 rows**, and on every one of them
  `resilience_level` = **5** (min = max) and `resilience_granular` = **5.99** (min = max), with
  confidence ≤ 0.57. **5.99 is the clamp bound** — `findGranularResilienceLevel` ends in
  `Math.max(1.01, Math.min(5.99, …))`, so that exact value is what it returns when the computation
  runs off the top of the scale. The score has never produced an informative reading and is surfaced
  as a band label.
- **The port is not hard-wired.** The pinned golden (`stress_resilience_2_2_1.golden.json`) produces
  level **1.0** / granular **1.01** — the *bottom* clamp. The pinning is input-driven.
- **Mechanism.** `longTermStress` and `longTermRestorativeTime` are weighted means;
  `longTermSleepRecovery` is not — it replicates a `[N,1] × [N]` broadcast from the `.pt` and reduces
  to `(Σ all weights × Σ list) / Σ used weights`, i.e. **the plain sum of the window** when every day
  is valid. Verified exactly against the golden: its list is 13 × 0.6 and today's index is 29.99013,
  and `13 × 0.6 + 29.99013 = 37.79013` = `out_7` to every stored digit. Solving the golden's own
  outputs for the recovery weights (`out_8 = w_d·out_6 + w_s·out_7`, summing to 1) gives
  **w_d = 0.30, w_s = 0.70** — so 70% of `longTermRecovery` is a quantity that grows with the number
  of valid days. Production per-day indices run **0.0 – 55.6**, so a 5–7 day window sum lands around
  **130–240** against the golden's 37.79 — above every band boundary, every day.
- **The golden cannot catch this**, and that is the transferable lesson: its list is 13 *identical*
  values of 0.6, two orders of magnitude below production, so the fixture pins the arithmetic without
  ever exercising the sum's scale. A golden proves a port computes the same function; it says nothing
  about whether the inputs are on the scale it was captured at.
- **Second oddity, observed not diagnosed.** `resilience_daily_sleep_recovery` barely tracks sleep:
  sleep score 93 → **0.0**, 87 → 12.8, 83 → 10.2, 80 → 9.9, 78 → 13.5, while sleep score **31 → 17.3**.
  `dailySleepRecovery = clamp(polyval(sleepRecoveryScalerCoef, sr))` where `sr` blends our sleep score,
  hrvBalance, recoveryIndex and RHR contributors — a vendor polynomial fitted against *Oura's*
  distribution fed *our* contributors is the obvious suspect, but this was not chased down.
- **It is also dormant.** The 2026-08-05 review recorded `resilience_level` on **13 of 79** rows;
  today it is **13 of 96** — the same 13, with the newest dated **2026-08-05**, while
  `daytime_stress_scaled` grew 11 → 25 over the same period. Likely the daily-index gate: only **12 of
  96** rows carry a `resilience_daily_stress` and they cluster (07-20 → 07-27, then 08-09, 08-10,
  08-16, 08-21), and a level needs `validCount >= windowMinLength` inside the 14-day window.
  **Unconfirmed** — `/api/admin/db-query` began returning `Forbidden` to every query before the
  per-gate coverage could be pulled. Check which of `contributorsOk`'s four inputs is missing on
  recent days first.
- **Do NOT touch the algorithm or the constants** — the file says so and the golden is the contract.
- **First action:** establish whether the sum is **faithful to the vendor**. If it is, Oura feeds a
  per-day index on a far smaller scale than ours and the defect is in what we supply; if not, it is a
  port bug. **This repo cannot settle it** — the vendor source is in the private archive — and that
  decision gates everything else. Then: add a golden case with realistic list magnitudes (the current
  fixture passes under either reading); and **until the level varies, stop surfacing it as a band** — a
  score that has returned "strong" on 100% of days is worse than absent, because it reads as a
  measurement.
- **Re-measure after both recalibrations reach stored rows.** The call site passes our `sleepScore`
  *and* `comp.contributors.recoveryIndex.score`, so v1.319.0 (sleep mean 84.1 → 69.5) and v1.321.0
  (Recovery Index anchor) both feed `sr`. All 13 rows predate both, and the direction is *downward* on
  the term that is currently saturating. See Q-501 for why stored rows have not moved yet.

### [devices][readiness] Q-509 — the BLE-era Recovery Index refit lands at 3.31 h against a shipped anchor of 5: the input moved, not the physiology

- **Branch:** `fix/ble-recovery-index-hours-bias`
- **Plan:** none yet — **Lane A implements; Tuning proposes only.** This is a `devices` finding by the
  readiness code's own pre-registered rule, **not** a scoring change.
- **Added:** 2026-08-18 · Tuning agent ·
  [`docs/reviews/2026-08-18-ble-era-input-drift.md`](reviews/2026-08-18-ble-era-input-drift.md) §1
- **The rule this fires.** `readiness-composite.ts` says above the constant: *"If a BLE-only refit
  lands well below 5, the input changed and that is a `devices` finding, not a scoring one."* Written
  when only 15 Cloud-era nights existed; there are now **42 BLE-era nights**, so the refit is runnable.
- **The refit.** BLE-era `recovery_index_hours`, n = 42 (07-07 → 08-18): mean **2.657 h**, median
  **2.377**, sd 1.591, range 0.35–8.28. Same zero-bias procedure as Q-500 (solve for the anchor at
  which our mean sub-score equals Oura's 15-night mean of 69.0, same clamping):

  | fit | window | n | anchor |
  |---|---|---|---|
  | Q-500 (shipped basis) | Cloud-era 06-23 → 07-07 | 15 | **4.63 h** |
  | this refit | BLE-era 07-07 → 08-18 | **42** | **3.31 h** |

- **The check that makes it convincing — anchor and input moved by the SAME factor:** mean hours
  3.59 → 2.657 (**0.74×**), median 3.28 → 2.377 (**0.72×**), zero-bias anchor 4.63 → 3.31 (**0.715×**).
  A genuine physiological shift moves the hours while leaving the correct anchor where it is. An anchor
  that must shrink by exactly the factor its input shrank by is absorbing a **multiplicative bias in
  the estimator**. Mechanism already measured in Q-500's review: at matched sampling density (107 vs
  108 samples/night) the BLE series is ~**2× noisier** (median sample-to-sample |Δbpm| 1.0 → 2.0).
- **A level shift, not a drift.** 2026-07: n 24, mean 2.73, median 2.35, 2 nights ≥ 5 h. 2026-08: n 18,
  mean 2.56, median 2.48, 1 night ≥ 5 h. Flat across both BLE months — the step is at the re-key.
- **Cost today.** At the shipped anchor of 5 the contributor is mean **50.8**, median 47.5, reaching
  100 on **3 of 42** nights. At the old anchor of 6 it was mean 43.4 and 1 of 42 — so **Q-500 worked**
  (+7.4 points) and nothing here argues against it.
- **Do NOT move `RECOVERY_INDEX_OPTIMAL_HOURS`.** A second anchor change inside two days, same
  direction, fitted to an input that moved for measurement reasons, is how a scoring constant gets
  quietly re-purposed into a bias correction.
- **First action:** treat the hours estimator's BLE behaviour as the work item. It is a global argmin
  over an overnight HR series; at 2× the sample-to-sample noise it settles at a systematically
  different point. **Concrete experiment:** smooth the BLE series to Cloud-like noise *before* the
  argmin and re-measure the ratio — if it goes to ~1.0 the estimator is fine and the input needed
  conditioning. Re-run the refit after any HR-smoothing change; the ratio above is the pass test.
- **Caveat.** The two fits are different windows and sizes (15 Cloud vs 42 BLE, six weeks apart), so a
  real seasonal/behavioural change is not excluded by this data alone — the flat BLE-era level and the
  anchor-tracks-input result argue against it without proving it. The smoothing experiment does not
  depend on the comparison at all, which is why it is the first action.

### [devices][readiness] Q-510 — resilience's missing days are the daytime-stress coverage gate, and that coverage is not persisted anywhere

- **Branch:** `feat/persist-daytime-stress-coverage`
- **Plan:** none yet — **Lane A implements; Tuning proposes only.** Closes the lead Q-508 left open.
- **Added:** 2026-08-18 · Tuning agent ·
  [`docs/reviews/2026-08-18-ble-era-input-drift.md`](reviews/2026-08-18-ble-era-input-drift.md) §2
- **It is NOT the contributor gate.** Over 2026-08-01 → 08-18, from `oura_daily_summary`:
  `recovery_index_hours` **18/18**, `hrv_avg_ms` **18/18**, `rhr_avg_bpm` **18/18**,
  `hrv_baseline_mean_x8` **18/18**. A daytime stress series exists on 14/18 (from 08-05). A resilience
  daily index is produced on **3/18** (08-09, 08-10, 08-16). All four `contributorsOk` inputs pass
  every single day, so the blocker is inside `preprocessStress` — and since `daytime_stress_scaled` is
  non-null on those days, `final_check_stress_coverage`
  (`resolutionMinutes × nonNaN >= minDaytimeStressHours × 60`) is the live candidate.
- **It cannot be confirmed from the database.** Neither side of that inequality is persisted:
  `minDaytimeStressHours` is a vendored constant and the per-day non-NaN bucket count is never stored.
  The stored extreme-bucket counts do not separate the cases — 08-07, 08-13 and 08-17 all carry 90
  minutes of extremes and produce no index, while 08-16 carries the same 90 and does.
- **`worn_hours_ble` is NULL on all 96 rows** — recorded as 0 of 79 in the 2026-08-05 review, and 13
  days later still empty. It is the field an auditor would look in first for this answer.
- **First action:** persist the daytime-stress coverage on the derived row (non-NaN bucket count, or
  the hours it implies). One number, already computed inside `preprocessStress`, and without it "why
  did resilience produce nothing today" is unanswerable from data. Then: **populate `worn_hours_ble`
  or drop the column** — a field that has never held a value on any row reads as an available signal
  in every column-listing audit.
- **Only after that**, decide whether `minDaytimeStressHours` is too strict for this wear pattern.
  That *is* a calibration question and it is Tuning's — but it cannot be asked until the coverage is
  visible, and it must not be answered by lowering the constant until the score fires, which is the
  Q-506 mistake.

### [body][sleep] Q-511 — the Body Battery anchor flip is worth 17.7 points, and the sleep recalibration removed 82% of it

- **Branch:** `feat/instrument-provisional-anchor` (low priority; **nothing to change in scoring**)
- **Plan:** none yet — **Lane A implements; Tuning proposes only.**
- **Added:** 2026-08-18 · Tuning agent ·
  [`docs/reviews/2026-08-18-battery-anchor-discontinuity.md`](reviews/2026-08-18-battery-anchor-discontinuity.md)
- **Why it exists:** the audit of "did the sleep recalibration miss any consumer of the sleep scale?"
  **Answer: no.** There is exactly **one** comparison threshold on the sleep scale in the whole
  codebase (`rest-day-guidance.ts`'s `LOW_SLEEP_SCORE`) and it was re-anchored in the same PR. The
  other consumers take the score as a *value* and inherit the shift directly.
- **What the audit turned up instead.** `body-battery/anchor.ts` uses `ownSleepScore` as the day's
  anchor **raw** (clamped 0–100), and a provisional sleep anchor can upgrade to readiness mid-morning.
  Its own docstring records the consequence — *"shifted the ENTIRE day's curve … the number visibly
  jumped"*, an **owner report from 2026-08-02**. The jump is `readiness − sleepScore`, and it had
  never been measured. Over the 33 days carrying both: mean sleep 87.2, mean readiness 69.5,
  **mean jump −17.7**, sd 10.2, range **−51 … +6**, mean |jump| 18.1.
- **The recalibration mostly fixed it, as a side effect.** The review's 65-night replay moved sleep
  84.1 → 69.5 (**−14.6**), so the gap goes −17.7 → **≈ −3.1**: the two anchor sources were ~18 points
  apart and are now ~3. Nothing targeted Body Battery; it fell out of putting sleep on a realistic
  range, because readiness already was.
- **⚠️ PROTECT THIS.** If a later session reads the new sleep distribution as "too harsh" and lifts it
  back toward the old mean, **it re-opens an owner-reported bug in a different pillar.** The sleep and
  readiness scales being comparable is now load-bearing for Body Battery.
- **What did NOT go away:** the per-day disagreement (sd 10.2). The scores agree *on average*, which
  is not the same as agreeing. ±10-point flips remain routine, so **the freeze-once rule stays
  load-bearing and must not be relaxed** on the grounds that the scores now agree.
- **The flip RATE is not observable.** `body_battery_daily` has **never** persisted
  `anchor_source = 'sleep'` (41 days `readiness`, 9 `default`, 0 `sleep`) because a sleep anchor is
  provisional and gets overwritten. So the end-state table cannot separate "the flip happens daily"
  from "readiness is always there first". Magnitude is solid; frequency is unknown. The owner's report
  proves it fires at least sometimes.
- **First action:** none in scoring. If the flip is reported again, **instrument the provisional
  anchor** — record it and its source when first written, not only the final one; that turns an
  unmeasurable rate into a measurable one. Otherwise low priority.
- **Recorded, not filed:** nine days (2026-07-08 → 07-16, right after the re-key) anchored at a flat
  **50** (`anchor_source = 'default'`) — no readiness and no sleep score existed, so Body Battery
  started each of those days at a fixed midpoint regardless of recovery. Last occurrence was over a
  month ago, so it reads as a post-re-key coverage gap that closed on its own. *Something that stopped
  is not something that was fixed* — noted as unexplained rather than closed.

### [workouts] Q-512 — `health-insight`'s ACWR is structurally null on every day (110/110)

- **Branch:** `fix/health-insight-acwr-window`
- **Plan:** none — a one-line fix either way. **Lane A implements; Tuning proposes only.**
- **Added:** 2026-08-18 · Tuning agent ·
  [`docs/reviews/2026-08-18-acwr-calibration.md`](reviews/2026-08-18-acwr-calibration.md) §2
- **Mechanism.** `app/api/ai/health-insight/route.ts` calls `computeVolumeAcwr` with
  `getWorkoutSessionsFrom(userId, subDays(new Date(), 7))` — a **7-day** list. The helper gates on
  `spanDays >= minSpanDays` (**21**), and `spanDays` is measured from the earliest session *in the list
  passed to it*. **A 7-day list can never span 21 days**, so the gate can never pass.
- **Confirmed by replay over 110 days: 0 non-null.** Not a coverage problem more history would fix —
  structural. The route computes the load object and reads `.acwr` from it every time, always `null`.
- **First action:** either widen the fetch to **28 days** to match `signals.ts` (if the insight is meant
  to mention training load), or drop the `computeVolumeAcwr` call and the `.acwr` read (if it is not).
- **Do NOT lower `minSpanDays`** to rescue this caller — that degrades *every* caller's ACWR to fix one
  that is mis-wired.

### [workouts][platform] Q-513 — the score-audit panel and the next-session engine disagree on the ACWR band on 38% of days

- **Branch:** `fix/build-day-audit-acwr-window`
- **Plan:** none — a window change. **Lane A implements; Tuning proposes only.**
- **Added:** 2026-08-18 · Tuning agent ·
  [`docs/reviews/2026-08-18-acwr-calibration.md`](reviews/2026-08-18-acwr-calibration.md) §3
- **Three callers, three windows**, all feeding one `computeVolumeAcwr` and all banded with the same
  `ACWR_THRESHOLDS`: `signals.ts` **28 days** (the intended 7:28, drives the engine),
  `health-insight` **7 days** (always null, Q-512), `score-audit/build-day-audit.ts` **all history**
  (chronic becomes the **lifetime** weekly average).
- **Measured** over the same days:

  | | 28-day (engine) | all-history (audit panel) |
  |---|---|---|
  | mean | 0.99 | **1.07** |
  | `optimal` share | **69.3%** | 49.4% |
  | `high` share | 12.5% | **29.2%** |
  | `very_high` share | 0% | **3.4%** |
  | days > 1.5 (emergency-deload line) | **0** | **3** |

  Mean |difference| **0.150**, max **0.395**, **different band on 33 of 88 days (38%)**.
- **Mechanism, and it worsens over time.** The lifetime weekly average is *lower* than the recent
  baseline — 20,572 kg/wk lifetime vs 23,239 kg/wk over the last 28 days (**1.13×**) — so the smaller
  denominator inflates the ratio (observed inflation 1.08). **Any sustained volume increase widens the
  gap indefinitely**; it is not a fixed offset that could be tolerated.
- **Why it matters.** `build-day-audit` *is* the score-audit panel, whose whole contract is to show a
  score beside **the inputs that produced it**. On 38% of days it shows a training-load band the engine
  never saw, and on three days it shows `very_high`/past the emergency-deload line while the engine saw
  at most `high`.
- **First action:** pass a **28-day** window in `build-day-audit`, matching `signals.ts`. If a lifetime
  view is independently wanted it needs a different name — it is not ACWR. Then re-measure.
- **Upper bound caveat:** `build-day-audit`'s `programTooNew` gate can null its ACWR independently, so
  38% bounds the days the panel actually renders a band.

### [workouts] Q-514 — 64% of the engine's back-off load cuts are an expected-RPE clamp artefact

- **Branch:** `fix/expected-rpe-clamp-exclusion`
- **Plan:** none — a predicate plus a filter. **Lane A implements; Tuning proposes only.**
- **Added:** 2026-08-18 · Tuning agent ·
  [`docs/reviews/2026-08-18-rpe-autoregulation-calibration.md`](reviews/2026-08-18-rpe-autoregulation-calibration.md)
- **`RPE_DEAD_BAND = 1.5` is correctly placed — do NOT move it.** Sensitivity over 377 per-exercise
  windows: 0.5 → 48.3%, 1.0 → 29.4%, 1.25 → 20.7%, **1.5 → 17.5%**, 2.0 → 14.9%. It sits on a flat part
  of the curve and the delta distribution is centred (mean −0.05). **The input is what is biased.**
- **The floor clamp splits the data in two.** `expectedRpe` clamps to the 5–10 slider range. The
  **ceiling never binds** (raw expected tops out at exactly 10.0, 0 sets clamped); the **floor binds on
  37 of 570 sets (6.5%)**, hiding raw values as low as **−10.4**. Those are not warm-ups —
  `intensity_pct` **49.6–66.7** (median 54.3) at **7–13 reps** (median 10), ordinary accessory work. At
  54.3% reps-to-failure is ~19, so a 10-rep set has ~9 RIR and a "true" expected RPE near 0.6; the model
  can only say **5**, and the owner reports **6.9**.

  | population | n | mean delta |
  |---|---|---|
  | floor-clamped | 37 | **+1.89** |
  | everything else | 533 | **−0.34** |

  A **2.2-point systematic offset**, in the direction the back-off arm reads as "RPE ran high".
- **Cost, replaying the shipped grouping** (per exercise, trailing 3 sessions, ≥3 sets, threshold 1.5):

  | | shipped | excluding floor-clamped |
  |---|---|---|
  | back-off (≥ +1.5) | **39 (10.3%)** | **14 (4.1%)** |
  | push (≤ −1.5) | 27 (7.2%) | **27 (7.9%)** |
  | sd of delta | 1.16 | 0.96 |

  **25 of 39 back-off triggers vanish — 64%** — while the push arm is *untouched*. That asymmetry is
  what makes it a bias fix rather than a de-sensitisation. 64% of back-off windows contain ≥1
  floor-clamped set. Each trigger is a **5–10% load cut**.
- **First action:** exclude sets whose **raw (pre-clamp)** expected RPE falls outside the slider range
  from the autoregulation delta. They carry no information — the model cannot state its expectation, so
  the gap to the reported value measures nothing. Matches the codebase's existing principle of passing
  `null` rather than fabricating a neutral (`computeResilienceForDay`). Contained: one predicate beside
  `expectedRpe`, plus a filter in `signals.ts`'s `perExRpeDelta` loop (~line 293). **No curve change.**
- **Corroborated by the app's own other model.** `ACCESSORY_SPEC` (`goal-ranges.ts`) prescribes
  accessory work to **RPE 7.5–8.5** (*"ALL genuinely challenging (>= RPE 7.5)"*). The floor-clamped sets
  report a mean actual RPE of **6.89** — below every target in that table and below the dataset mean of
  7.49. **By the app's other model these sets are easy**, while the autoregulation delta reads them at
  +1.89 and cuts load. Two models in one codebase disagreeing in *sign* about the same sets.
  (A stronger version — attributing the clamped sets to the `accessory` role — was **abandoned as
  unsound**: exercise names map to more than one role across programs, so a name-based join fans out.)
- **Do NOT widen the clamp** to allow expected RPE below 5 — an expectation of 0.6 against an owner who
  never reports below 6 gives a delta of **+6.3**, worse. The set is unrepresentable either way.
- **Re-measure after.** Back-off 4.1% vs push 7.9% is asymmetric the other way; whether that is right is
  the next question, and it must be asked against unbiased input.
- **Caveat that bounds the counts — read this with the 64%.** The back-off arm needs a second signal
  (`rm1Trend === 'down'` OR `repCompletionRate < 0.95`), which the replay does **not** model. Measured:
  the owner is short of the prescribed reps on only **14 of 196 sets (7.1%)**, exact on 75%, over on
  17.9%, mean completion **1.046** — so `missedReps` is rarely the corroborator and most back-offs must
  come via a falling 1RM. **The number of cuts actually issued is well below 39, and the number the fix
  prevents is well below 25.** The defect is real and one-directional, but "64% of back-off *triggers*"
  is not "64% of load cuts on your training". The ratio is the finding; sizing the absolute impact needs
  `rm1Trend` modelled, which this review does not do. Only sets carrying
  both `rpe` and `intensity_pct` are visible (570 of 1,029 set logs).
- **Related, recorded not filed:** `calcAmrap1RM` / `amrapScaleFactor` (the 1.0/0.97/0.93/0.88/0.82
  rep-band table) have **no production call site** — tests only. Calibrating a function nothing calls
  would be wasted; removing it is a Review-lane call.

### [heart-rate][body] Q-515 — the rest/active boundary shrank 3× because the owner got fitter

- **Branch:** `fix/hr-rest-threshold-anchor`
- **Plan:** none yet — a constant plus a baseline source. **Lane A implements; Tuning proposes only.**
- **Added:** 2026-08-18 · Tuning agent ·
  [`docs/reviews/2026-08-18-hr-rest-threshold-calibration.md`](reviews/2026-08-18-hr-rest-threshold-calibration.md)
- **Blast radius.** `HR_REST_THRESHOLD = 0.05` is the single rest/active boundary shared by **Body
  Battery's charge/drain** and the **Activity Score's "moved this hour"** signal — it propagates into
  two pillars.
- **Measured** over 12,471 BLE ring samples, waking hours (07:00–21:59), joined per day to that day's
  own stored profile:

  | month | resting HR | hr_max | boundary | median % of waking samples below it |
  |---|---|---|---|---|
  | 2026-07 | 62.9 | 187.0 | **69.1 bpm** | **26.5%** |
  | 2026-08 | 54.4 | 171.2 | **60.2 bpm** | **8.2%** |

  **A 3.2× collapse in one month at identical sample density (184/day).**
- **Every input behaved correctly.** Resting HR 62.9 → 54.4 is a genuine fitness gain; `hr_max`
  187 → 168 is the profile maturing from the age formula to a corroborated observed ceiling (the chest
  strap's max is 166 over 40,230 samples) — `resolveHrProfile` working as designed. Waking HR also fell,
  77.5 → 73.3.
- **The trap is a RATE difference.** Resting HR fell **8.5 bpm**; waking HR fell only **4.2**. Resting
  HR is the more responsive fitness marker, so a boundary pinned to it moves ~2× as fast as the
  distribution it classifies. Decomposed: resting HR explains ~8.1 of the 8.9 bpm boundary drop, the
  `hr_max` maturation ~0.9. **The owner got fitter and was rewarded with less recovery credit.**
- **No fraction fixes it** — sweeping the constant, July vs August medians: 0.05 → 26.5/8.2 (3.2×),
  0.08 → 38.5/22.7, 0.10 → 47.8/29.8, 0.12 → 59.6/35.2, 0.15 → 72.8/50.6 (1.4×). The gap narrows but
  never closes. **Tuning this constant is not the fix** — fourth instance of that pattern today
  (Q-506, Q-512, Q-514, Q-515).
- **Two separable questions; only one is answered here.** *(a) Is it stable?* No — a defect regardless
  of taste. *(b) Is 8.2% the right level?* **Unknown** — ~1.2 h of a 15 h day is not obviously wrong,
  and whether Body Battery should charge more in daylight is an owner question. **Fix (a) alone**; if
  the fraction is raised at the same time the two effects become inseparable and neither is verifiable.
- **First action — recommendation:** anchor the boundary to a **slow-moving** resting baseline (90-day
  trailing, or a fixed offset re-derived quarterly) so a month of fitness improvement cannot move the
  classifier under its own data. Keeps personalisation, removes the month-scale feedback. Reversal cost
  is low and the effect is observable within a week of BLE data.
- **Rejected alternative:** a percentile of the owner's own recent *waking* HR (trailing-28-day p25).
  Stable by construction — which is the objection: Body Battery charge would go near-constant and a
  genuinely restful day could not read as one. The codebase already names this "the treadmill" and
  removed it from the activity-goal volume lane (Q-190). **Self-referential boundaries are fine for a
  pure classifier and wrong for anything feeding a score — this one feeds two.**
- **Re-measure both consumers afterwards**: Body Battery's charge/drain balance (currently mean charged
  23.1 vs drained 36.0) and the Activity Score's movement signal.
- **On Q-272:** its "median 6.7% of waking samples" could not be reproduced — the same statistic on
  current data gives **15.0%** pooled over 42 days. **Not filed as an error there**; the month split
  (26.5% / 8.2%) suggests it was measured on recent data alone, and the drift documented here explains
  the difference.
- **Still unreviewed in this pillar:** `PEAK_BANDS` (its "stable per-bucket sample sizes" justification
  is an empirical claim nobody has measured) and the Karvonen zone boundaries (0.6/0.7/0.8/0.9).

### [heart-rate] Q-516 — `PEAK_BANDS` is calibrated for a heart-rate range strength training never reaches

- **Branch:** `fix/hr-recovery-peak-bands`
- **Plan:** none yet — re-banding is cheap; **the honesty change in "first action" is the real work.**
  Lane A implements; Tuning proposes only.
- **Added:** 2026-08-18 · Tuning agent ·
  [`docs/reviews/2026-08-18-hr-rest-threshold-calibration.md`](reviews/2026-08-18-hr-rest-threshold-calibration.md) Part 2
- **The claim under test.** `hr-recovery-profile.ts` justifies its bands as *"Bands, not exact bpm, for
  stable per-bucket sample sizes (spec §3)."* That is empirical, and it is **false** for this athlete.
- **Observed range**, 208 episodes with `coverage_ok` (2026-05-27 → 08-17): min 59, p25 93.8,
  **median 102**, p75 110, p95 121, **max 132**.

  | band | episodes | share | mean `drop_60s` |
  |---|---|---|---|
  | **`<110`** (spec: *low-signal, de-emphasise*) | **149** | **71.6%** | **3.0** |
  | `110–129` | 57 | 27.4% | **14.9** |
  | `130–149` | **2** | 1.0% | 13.5 |
  | `150–169` | **0** | 0% | — |
  | `170+` | **0** | 0% | — |

  The highest set-peak ever recorded is **132**, so the top two bands are **structurally unreachable**,
  not merely sparse. `LOW_SIGNAL_BAND_LABEL = '<110'` sits at the **p75**, so the profile de-emphasises
  three quarters of its own data. **One usable bucket** (`110–129`, n = 57).
- **The de-emphasis is CORRECT, which makes it worse.** Mean `drop_60s` is **3.0** below 110 against
  **14.9** above it — the spec's "near-meaningless … mostly measurement noise" is **supported**. So
  re-banding does not recover hidden signal: **peak HR during a lifting set mostly does not reach the
  range where HR recovery is informative.** These bands read as designed for cardio/interval work.
- **Also:** `coverage_ok` is true on only **212 of 691** rows (31%) — two thirds of set-HR rows are
  discarded before banding. Not investigated; recorded so 208 is not mistaken for the full sample.
- **First action:** (1) re-band to the observed range (e.g. `<90 · 90–104 · 105–119 · 120+`) so four
  buckets populate and the 110–129 signal is not diluted; **(2) — the important one — state plainly in
  the feature and the docs that HR recovery is informative for roughly the 28% of sets peaking above
  110.** A re-banded profile that averages noise into four buckets is **worse** than one honest bucket,
  because it looks like it is working. **Do not ship (1) without (2).**
- **Owner-facing question behind it:** if HR recovery is meant to track conditioning, the range exists
  in cardio and chest-strap data (max 166 over 40,230 samples), not strength sets. Whether the feature
  is targeted correctly is a product decision, not a constant.
- **Caveat:** nothing about the recovery *math* (`drop_30s`…`drop_120s`, `sec_to_hrr50`) was checked —
  only the banding and its populations. Cardio/chest-strap **episodes** were not examined; the claim
  that the range exists there comes from raw `oura_heartrate`, since `set_hr_stats` is strength-derived
  by construction.

### [nutrition] Q-517 — adaptive-TDEE can hand the user a maintenance below their own BMR

- **Branch:** `fix/adaptive-tdee-bmr-floor`
- **Plan:** none — one constant becomes a computed value. **Lane A implements; Tuning proposes only.**
- **Added:** 2026-08-18 · Tuning agent ·
  [`docs/reviews/2026-08-18-nutrition-tdee-calibration.md`](reviews/2026-08-18-nutrition-tdee-calibration.md)
- **`adaptive-tdee.ts` already anticipated this.** Its header warns an ungated estimate *"would tell
  the user their maintenance is 1200 kcal — actively harmful advice"*. This measures whether the gates
  hold. **They hold 75% of the time; the lowest value that gets through is 1,052 kcal.**
- **Input condition (not a defect, nothing filed):** the food log captures **~50%** of actual intake —
  44 logged days of 110, mean **1,223 kcal**, 43% of logged days under 1,200, 4.8 entries/day. Against
  75 weigh-ins over 109 days (slope **+8.0 g/day** = **+62 kcal/day** balance) and a Cunningham BMR of
  **1,547** × 1.55 = predicted TDEE **2,397**, implied actual intake is **~2,459**. Taking the log at
  face value implies maintenance **1,161 — below BMR**, which is arithmetic proof of under-logging.
  *(Corrected 2026-08-19: first filed as 1,698 / 2,632 / 2,694 / 45%, computed from the textbook
  Cunningham `500 + 22×LBM` **from memory**. The app uses `cunninghamBmr = ffm×21.6 + 370`
  (`body-composition.ts`), matched to Oura's `atlas`. Conclusion unchanged; magnitudes overstated.)*
- **Replay of the shipped gates**, every rolling window:

  | outcome | 14-day (97) | 28-day (83) |
  |---|---|---|
  | blocked, coverage/span | 72 | 61 |
  | `implausible_result` | 2 | 0 |
  | **PASSED** | **23 (24%)** | **22 (27%)** |
  | passing range | **1,052–2,219** | **1,246–1,889** |

- **`MIN_PLAUSIBLE_MAINTENANCE = 1000` sits just below the artefact** — this owner's lands at **1,052**,
  clearing it by 52 kcal. The module's own comment predicted the failure at 1,200; the floor was set
  200 below that prediction and the real value slipped between them.
- **The values are also unstable** — 1,052–2,219 for the same person within weeks (a 1,167 kcal range).
- **Why the coverage gates cannot catch it:** `MIN_LOGGED_FRACTION` counts **days carrying a log**, not
  whether each day's log is **complete**. A day with only breakfast counts as fully logged — exactly
  this owner's pattern — so a 50%-complete record sails through a 70%-coverage gate. **The gates
  measure the wrong kind of incompleteness.**
- **It reaches the user's target.** `TdeeAdaptationCard` writes the accepted value through
  `PUT /api/nutrition/targets`, which its own docstring calls the source of truth for the daily target,
  mirroring into `users.calorie_goal`. A 1,052 maintenance is one tap from becoming the calorie goal of
  someone whose BMR is 1,547.
- **First action: replace `MIN_PLAUSIBLE_MAINTENANCE` with the user's own BMR.** Maintenance below BMR
  is impossible *by definition*, not implausible by taste, and `cunninghamBmr` is already imported in
  the same package. Measured **at the app's own BMR of 1,547**: 14-day passing 23 → **13**, range
  **1,592–2,219**; 28-day 22 → **13**, range **1,565–1,889**. Every harmful value blocked.
  *(Corrected 2026-08-19 from a 1,698 floor, which blocked more than the app's BMR would — 11 and 10
  passing. The proposal is unaffected; it simply blocks fewer windows than first stated.)*
- **✚ ADDENDUM 2026-08-19 — the BMR is already persisted, so read it rather than recompute.**
  `body_comp.bmr_kcal` carries the day's own BMR on **71 of 96** rows, computed by the same
  `cunninghamBmr`. Reading it makes the floor **the day's** BMR rather than a window mean (the stored
  series moves with weight/body fat — 1,522 and 1,524 on consecutive days) and **cannot drift from what
  the body-composition card renders**, because it is the same number. **Fallback matters:** 25 of 96
  rows have no `body_comp` (no body-fat reading, and `bodyComposition()` returns null rather than
  fabricating) — on those days fall back to the **most recent snapshot**, never to the universal 1,000.
  A stale BMR is far closer to the truth than a number ~500 kcal below it.
  [`docs/reviews/2026-08-19-body-derived-scores-closeout.md`](reviews/2026-08-19-body-derived-scores-closeout.md) §3
- **It makes the estimate SAFE, not CORRECT.** Survivors still sit well under the formula's 2,397
  — residual under-logging showing through. Do not describe the floor as a fix for accuracy.
- **Two things NOT to do:** (1) **do not raise `MIN_LOGGED_FRACTION`** — it already refuses 75% of
  windows and structurally cannot see within-day incompleteness, so raising it drops good windows and
  keeps bad ones; (2) **do not scale logged intake up** by an under-logging multiplier inferred from
  the weight trend — that is circular, since maintenance is derived from the same trend, and would
  reproduce the assumed TDEE as if measured.
- **Durable fix, larger and separate:** detect within-day incompleteness (expected vs logged meals, or
  an intake floor relative to BMR) and treat such a day as **unlogged** rather than low. A feature, not
  a constant.
- **Recorded, not filed:** `tdeeAdjustment` (`tdee-adaptation.ts`) is **dead code** — referenced only by
  its tests and by a comment in `TdeeAdaptationCard` explaining it was replaced. Same trap as
  `amrapScaleFactor` (Q-514); do not calibrate it.

### [platform][readiness] Q-518 — the readiness model stamp survived 5h40m, then a sibling writer erased it

- **Branch:** `fix/model-versions-jsonb-merge`
- **Plan:** none — one conflict-arm expression. **Lane A implements; Tuning proposes only.**
- **Added:** 2026-08-18 · Tuning agent ·
  [`docs/reviews/2026-08-18-model-version-clobber.md`](reviews/2026-08-18-model-version-clobber.md)
- **⚠️ This INVALIDATES a claim published today.** PR #85 reported the shared `model_versions` merge
  *"held in production"*. It held for the readiness write and **does not survive the next
  body-composition backfill**.
- **Observed, same row (`oura_daily_derived`, day 2026-08-18), twice in one session:**

  | read at | `model_versions` | `readiness_score` |
  |---|---|---|
  | **04:38:27** | `{"bodyComp": "atlas_2_1_0", "readiness": "v3:ri5:2026-08-18"}` | 76 |
  | **10:18:40** | `{"bodyComp": "atlas_2_1_0"}` | 77 |

  Rows 08-16/17/18 all carry `updated_at = 10:18:40`, so one job rewrote all three. Stamped rows across
  the table went **1 → 0** (they had gone 0 → 1 earlier the same session, which is how it was noticed).
- **Mechanism — `COALESCE` does not merge JSON.** `upsertOuraDailyDerived` sets every column as
  `COALESCE(excluded.col, oura_daily_derived.col)`. Correct for scalars; for a `jsonb` column it picks
  the first non-null **document whole**, so a non-null incoming value replaces the stored one entirely.
  The merge is therefore left to each caller, and **only one of two callers does it**:

  | writer | passes | merges? |
  |---|---|---|
  | `lib/health/readiness-payload.ts:544` | `{ ...existingVersions, readiness: … }` (reads the row first) | **yes** |
  | `lib/data/postgres/slices/oura.ts:1664` | `{ bodyComp: BODY_COMP_MODEL_VERSION }` (flat literal) | **no** |

  **The readiness code did nothing wrong** — it is the only participant honouring a convention the
  shared writer does not enforce.
- **Cost.** (1) **Q-501's purpose is defeated** — the stamp was the fix for "did this score move because
  the inputs changed or the model did", and it does not survive a backfill. (2) Readiness was supposed
  to be the pillar that *had* a stamp where sleep does not; in stored data it now does not either.
  (3) Every future pillar that stamps has the same exposure — the next agent will copy readiness's
  correct merge and still be clobbered.
- **First action: move the merge into `upsertOuraDailyDerived`**, not into the bodyComp caller. For
  `model_versions` the conflict arm should be
  `COALESCE(existing.model_versions,'{}'::jsonb) || COALESCE(excluded.model_versions,'{}'::jsonb)` —
  keeping every existing key and letting an incoming key win on collision, which is what both callers
  already assume. **This is the pattern the codebase already chose one column over**:
  `upsertOuraHeartrate`'s comment — *"this makes the guarantee the function's own, so every caller gets
  it rather than each one remembering"* — and **Q-280 exists because two of its siblings missed it**.
  Identical shape; fix it the same way.
- **Do NOT patch the bodyComp caller alone** — that restores today's stamp and leaves the next writer to
  rediscover the rule, which is how this happened.
- **Re-verify by observation, not reasoning:** stamp a row via the readiness route, run the
  body-composition backfill, re-read. Reasoning about this is what produced the wrong claim.
- **Caveats.** The `||` expression above was **written, not run** — no test, no local DB. **The job that
  ran at 10:18:40 was not identified directly**: the bodyComp backfill is the only `model_versions`
  writer passing a flat object and its payload matches the surviving document exactly, but no
  scheduler/trigger was traced, so **its cadence is unknown** and "short half-life" is an inference from
  one observation. `readiness_score` also moved 76 → 77 between reads and **that is not explained here**.

### [sleep] Q-519 — manual bedtime entry for a night the ring missed, writing exactly one column

- **Branch:** `feat/manual-bedtime-entry`
- **Plan:** none needed — contained, and it reuses the existing per-field merge.
- **Added:** 2026-08-19 · Tuning agent, from an **owner report** ·
  [`docs/reviews/2026-08-19-partial-night-manual-bedtime.md`](reviews/2026-08-19-partial-night-manual-bedtime.md)
- **The report.** The owner forgot to put the ring on before bed and fitted it at ~4 am. The session
  reads **4:23–8:03 am, 3h 5m, 84% efficiency, 30m latency** against trailing averages of 8h and 92%.
  Their stated concern: *"I don't want it to change estimated bed time values."*
- **Quantified.** `GET /api/user/bedtime-estimate` averages sleep starts over **14 days**.
  `minutesFromNoon(04:23)` = **983** vs ~**660** for an 11 pm bedtime, so one such night moves the mean
  to 683 — **the estimated bedtime reads ~23 minutes later for two weeks**. `nightSessions()` cannot
  help: it reassembles a night split by a wake-up (Q-76) and needs an earlier fragment, which does not
  exist when the ring was off.
- **The design (owner's proposal, and better than a flag alone).** `lib/data/health-source.ts` merges
  **per field, not per row** — its own comment: *"a manual weight must not stop the ring's HRV … from"*
  being kept. `manual` is rank 5, `oura_ble` rank 3. So writing **only `sleep_start`** at `manual`:

  | column | source after | value |
  |---|---|---|
  | `sleep_start` | **manual (5)** | the real bedtime |
  | `duration_hours`, `efficiency`, `average_hrv_ms`, `lowest_heart_rate`, `respiratory_rate` | oura_ble (3) — **untouched** | as measured |

  **No new schema, no new merge logic.**
- **⚠️ THE INVARIANT THIS RESTS ON.** `duration_hours`, `time_in_bed_hours` and `efficiency` are
  **stored columns, not derived from `sleep_end − sleep_start`.** That is the *only* reason this is
  safe. **If anyone later recomputes duration or efficiency from the span, this silently produces a
  9-hour night at 34% efficiency.** Say so in a comment beside the write.
- **Manual bedtime writes `sleep_start` and NOTHING else** — not duration, not efficiency, not a
  synthesised `sleep_end`.
- **What it does not fix:** the 3h 5m still reaches the sleep score, readiness's `previousNight`
  contributor, resilience's `sr`, and the Body Battery anchor. That is Q-520, deliberately separate.
- **Before relying on it, prove the merge with a test** — that writing `sleep_start` at `manual` leaves
  `average_hrv_ms` at `oura_ble`. This review read that behaviour from the source and its comments and
  **did not demonstrate it**. Also **audit whether any consumer recomputes duration/efficiency from the
  span**; that audit is part of this item, not a finding of the review.
- **Reversal cost:** low — it is one column written by one new path.

### [sleep] Q-520 — a partial-night flag, so an unworn night stops distorting the scores

- **Branch:** `feat/partial-night-flag`
- **Plan:** none yet. **Do Q-519 first** — it removes the timing noise, and whether this is worth
  building is easier to judge afterwards.
- **Added:** 2026-08-19 · Tuning agent ·
  [`docs/reviews/2026-08-19-partial-night-manual-bedtime.md`](reviews/2026-08-19-partial-night-manual-bedtime.md) §4
- **The problem Q-519 leaves behind.** A genuinely-measured-but-incomplete night reads as a bad night
  to the **sleep score**, **readiness's `previousNight`**, **resilience**, the **Body Battery anchor**,
  and the trailing "vs recent nights" baselines.
- **Shape:** a nullable marker on the session excluding the **duration-derived** metrics (time asleep,
  efficiency, latency, restless periods) from the score and the baselines, while the **physiological**
  columns keep flowing — HRV, HR, breathing are real measurements of real sleep in the observed window,
  and the EMA baselines need them (Q-506 showed how fragile those already are).
- **Make it MANUAL, not auto-detected.** An automatic "looks partial" rule would eventually suppress a
  genuinely bad short night — exactly what the recalibrated sleep score (Q-503) exists to surface. The
  cost of wrongly hiding a real bad night exceeds the cost of a tap.
- **Do not implement this as "delete the night".** That discards valid physiology; on the reported night
  HRV read 61 ms against a 59 ms average and lowest HR read 53 — *exactly* the trailing average.
- **Reversal cost:** low — a nullable column plus filters; unset it and the night returns.

### [activity][nutrition] Q-524 — two different step goals, and the personalised one contradicts the evidence its own file cites

- **Branch:** `fix/reconcile-step-goals`
- **Plan:** none — **this needs an owner decision first** (which number wins), then a one-line change.
  Evidence: [`docs/reviews/2026-08-19-activity-contributor-audit.md`](reviews/2026-08-19-activity-contributor-audit.md) §3.
- **Added:** 2026-08-19 · Tuning agent, found while auditing the Activity Score's `steps` contributor.
- **The app shows the owner's step progress against two targets at once.** `users.steps_goal` is
  **7,000** (the owner set it); `getDailyGoals()` ignores that column and derives **10,000** from
  `activity_level = 'moderate'` via `STEP_GOAL_BY_ACTIVITY`.

  | surface | goal used |
  |---|---|
  | `components/health/goals-progress-card.tsx` | **7,000** (profile) |
  | `app/api/daily-digest/route.ts` — *"Steps: N/7000 today"* | **7,000** (profile) |
  | Activity Score `steps` contributor (weight 18) | **10,000** (derived) |
  | `app/health/activity/activity-content.tsx` progress bar `max` | **10,000** (derived) |
  | `app/api/cardio-week` weekly target | **70,000** (derived × 7) |
  | AI `health-insight` prompt — *"goal 10000"* | **10,000** (derived) |

  On a 7,200-step day the Goals Progress card and the daily digest say the goal is met while the
  Activity screen's own bar reads 72%.
- **The sharper half: the derived value disagrees with its own evidence base.** `daily-goals.ts`
  cites Paluch 2022 (step benefit plateaus ~7–8k/day) and sets `DEFAULT_STEP_GOAL = 8000` accordingly
  — but the *personalised* path returns **10,000** for `moderate`. **The fallback used when the
  profile is empty is better calibrated than the personalised value that replaces it.**
- **Measured:** 10,000 is reached on **16 of 90 days (18%)**; the owner's own 7,000 on **31 of 90
  (34%)**; mean 6,044 steps (sd 4,715, range 464–23,740).
- **✅ OWNER DECIDED 2026-08-19:** *"We need to use 1 number here. The AI should be able to define
  the number and allow for manual entry."* → **`users.steps_goal` becomes the single source.**
  `getDailyGoals()` reads that column instead of deriving from `activity_level`, falling back to the
  derived value only when it is unset. **The AI half already exists and needs no new work** —
  `/api/nutrition-goals/recommend` computes a recommended steps goal and
  `components/profile/goal-recommendation-sheet.tsx` writes it to exactly that column, with manual
  entry alongside it in `goals-section.tsx`. So this is a read-side change plus a fallback, not a new
  feature. **Sequencing note:** once `getDailyGoals` reads the profile, the Activity Score's steps
  contributor changes for every historical day it is recomputed on — expected, and worth stating in
  the changelog because the owner reads that number daily.
- **Superseded — the three options as originally posed.** Kept for the reasoning, not the choice:
  (1) the profile value wins everywhere — the owner set it, and it matches Paluch; (2) the derived
  value wins everywhere and the profile field becomes display-only or is removed — but then the
  activity-level map should be re-checked against Paluch, since 10,000 is above the cited plateau;
  (3) they are different things (a personal target vs an evidence-based benchmark) and every surface
  must label which it is showing. **Do not silently pick one** — whichever wins changes a number the
  owner sees daily.
- **Pass test:** one step goal reaches every surface, or each surface states which of the two it is
  showing. `grep -rn 'stepGoal\|stepsGoal' app components lib packages` should not turn up two
  unreconciled sources for the same metric.
- **Caveats:** one user, one activity level. The map's other tiers (`sedentary` 7,000, `light` 8,500,
  `active`/`extra_active` 12,000) are unmeasured here — only `moderate` was exercised.

### [platform][activity] Q-526 — the Activity Score stores the blend wrapper where its contributors should go

- **Branch:** `fix/persist-activity-contributors` · **Lane:** A
- **Plan:** none needed — **one line at an existing persist site.** Evidence:
  [`docs/reviews/2026-08-19-score-audit-trail.md`](reviews/2026-08-19-score-audit-trail.md) §1.
- **Added:** 2026-08-19 · Tuning agent, found while checking whether each score can be re-audited.
- **What is stored.** `lib/health/readiness-payload.ts` writes
  `{ base: activityBlend.base, adjustment: activityBlend.adjustment, trained: … }` into
  `oura_daily_derived.activity_contributors`. That is the **blend wrapper**, not
  `computeActivityScore`'s six components (`steps`, `activeEnergy`, `zoneMinutes`, `moveHours`,
  `strengthFreq`, `strengthVolume`). **The components are already in memory on the same request** —
  `activityResult.components`, which the same function serves to the client. They are simply not
  written.
- **Activity is the only score with this gap.** Over 96 rows: sleep stores 10 real sub-scores (36
  rows), readiness stores its contributors **plus `provisional` flags** (35), illness stores all four
  biomarker z-scores on **every** scored row (46). Activity stores the wrapper on all 23.
- **It has already cost a measurement.** The 2026-08-19 contributor audit had to rebuild all six
  contributors from raw inputs, and could only do so **at today's goals** — `strengthFreqGoal` went
  3 → 5 and the volume target changed basis on **2026-08-11**. So *"what did `strengthFreq` score on
  2026-08-02?"* is **unanswerable**, and the audit reported a *predicted* sd ceiling (≈ 10.2) instead
  of the real historical spread. Sleep and readiness had no such problem on the same days.
- **It compounds with the no-backfill trap.** Stored history is not rewritten after a model change,
  so each recalibration adds a segment — and without a trail there is no way to tell later which
  segment a day belongs to. `model_versions` is on 71 of 96 rows and Body Battery is still the only
  score that stamps one (Q-273).
- **Do this BEFORE Q-505 (the Activity redesign), not after.** The redesign changes the contributor
  set; landing it first means the old model's contributor history is lost permanently, and the
  before/after comparison that would show whether the redesign worked cannot be made.
- **Pass test:** `activity_contributors` holds the six component keys, and a day's stored sub-scores
  reproduce its stored `activity_score` under the weights in force that day.
- **Caveats:** keep `base`/`adjustment`/`trained` — the blend wrapper is real information (it is how
  a Cloud-era adjustment is distinguished from our own base) and something may read it. Merge, do not
  replace.

### [devices][readiness] Q-525 — chronic stress has never produced a value, and an incremental rollup can never make it

- **Branch:** `fix/chronic-stress-gate` · **Lane:** A
- **Plan:** none yet — **the question is whether to trigger the wide pass or relax the gate**, and the
  first is owner/device-gated. Evidence:
  [`docs/reviews/2026-08-19-score-audit-trail.md`](reviews/2026-08-19-score-audit-trail.md) §2.
- **Added:** 2026-08-19 · Tuning agent.
- **Measured:** `chronic_stress_score` and `chronic_stress_contributors` are **NULL on all 96 rows**.
  Never produced once. This is the **third dormant score**, after the illness radar (Q-506 — no
  action-bearing flag in 46 days) and resilience (Q-508 — one value, level 5, on all 13 rows).
- **Mechanism — the gate is stricter than it reads.** `adapter.ts`'s `chronic_stress` step returns
  early below `CHRONIC_STRESS_MIN_DAYS`, then `computeChronicStress` runs the golden-verified
  `cumulative_stress_1_2_2` port, which needs **21 complete nights of granular BLE signals in a
  trailing 31-night window**. The step's own comment names the binding constraint: *"the intermediate
  history is built from THIS pass's stashed signals, so the first score requires a wide/full rollup
  pass covering ≥21 nights of real ring data (owner/device-gated)."* **It is not enough for 21 good
  nights to exist — they must be present in ONE pass**, so a nightly incremental rollup can never
  satisfy it however long it runs.
- **First action:** confirm whether ≥21 qualifying nights exist in the data at all before touching the
  gate. If they do, this is a *trigger* problem (run the wide pass) and needs no code. If they do not,
  it is a coverage problem and belongs with Q-510, which found daytime-stress coverage is not
  persisted anywhere.
- **Do NOT merge with Q-507.** That is `STRESS_HIGH_DAY_THRESHOLD_MIN` — *daytime* stress minutes
  driving the session override, which does fire, on the wrong days. This is the separate vendored
  *cumulative* model. They share a word and nothing else.
- **Caveats:** a dormant score is not a broken one — the gate may be correctly refusing to score on
  insufficient data, which is what the first action distinguishes. Do not relax a gate before knowing
  which.

### [body][platform] Q-527 — one corrupt body-composition row, and it becomes load-bearing the moment Body Battery uses BMR

- **Branch:** `fix/body-comp-plausibility-guard` · **Lane:** A
- **Plan:** none needed — a plausibility guard at the write site. Evidence:
  [`docs/reviews/2026-08-19-body-battery-drain-model.md`](reviews/2026-08-19-body-battery-drain-model.md) §2.
- **Added:** 2026-08-19 · Tuning agent, found while checking the owner's *"BMR draining should
  naturally go up too"* premise against the data.
- **Measured.** `body_comp` holds 71 daily snapshots. **One is impossible: 2026-07-29 records body fat
  **3.0%**, fat-free mass **70.4 kg of 72.6 kg** bodyweight, and BMR **1,890** — against ~24% body fat
  and ~1,520 BMR on the surrounding days.** Three per cent is below the essential-fat floor for a male;
  this is a bad scale reading propagated through `cunninghamBmr` into a stored BMR **24% above
  baseline**. One row of 71, so ~1.4% — rare, not impossible.
- **Why it matters now and did not before.** Nothing currently keys a user-visible number off stored
  BMR. **Q-521's drain model makes baseline drain proportional to it** (`baseline = 25 × bmrToday /
  bmrReference`), so this single row becomes a day that drains a quarter faster for no reason the
  owner can see or explain.
- **First action:** a plausibility guard at the `body_comp` write site — reject or clamp a snapshot
  whose body fat falls outside a physiologically possible band, or whose fat-free mass exceeds a
  plausible share of bodyweight. **Guard the input, not the output**: BMR is derived, so a BMR range
  check would catch this case and miss the next one.
- **Also decide what a rejected snapshot does.** Dropping the row leaves a gap; carrying the previous
  day forward hides that the scale misread. Prefer storing it flagged over storing it silently, so a
  future audit can see the reading happened — the same reasoning behind readiness's `provisional`
  flags, which are the reference for this (Q-526).
- **Do this BEFORE Q-521.** A guard added afterwards leaves already-stored bad rows driving drain.
- **Caveats:** one athlete, one bad row, 71 snapshots — the *rate* here is not a population estimate.
  The band itself is a published physiological range, not a fit to this data.

### [activity][heart-rate] Q-522 — the movement-per-hour contributor is saturated: it measures ring wear, not movement

- **Branch:** `fix/move-hours-rest-boundary`
- **Plan:** none yet — needs a candidate boundary, not just a code change. Evidence:
  [`docs/reviews/2026-08-19-zone-minutes-move-hours-coverage.md`](reviews/2026-08-19-zone-minutes-move-hours-coverage.md) §2.
  **Do Q-515 first** — same boundary, same root cause. Lane A implements; Tuning proposes only.
- **Added:** 2026-08-19 · Tuning agent, from the owner's direct ask (*"check zone minutes and
  movement per hour coverage"*), deferred by Q-521's closing caveat.
- **Measured** over 59 days with waking-hour HR (07:00–21:59 Brisbane), `claude_ro` row-scoped to the owner:

  | | |
  |---|---|
  | waking hours with any HR data | 857 |
  | of those, counted as "moved" | **856** (99.9%) |
  | days scoring exactly 100 | **48 of 59** |
  | days scoring ≥ 93 | 55 of 59 |

  The only source of variance is **hours the ring was off the finger**. `W_MOVE_HOURS = 12`.
- **Mechanism.** `computeMovedHours` counts an hour if any sample exceeds `HR_REST_THRESHOLD = 0.05`
  of reserve — **59.7 bpm** at `hrMaxFromAge(33) = 187` / resting 53. The owner's waking HR is ring
  p50 **69**, p90 **88**; it is essentially never below the boundary while awake.
- **This is Q-188 returning through the other half of the fraction.** `hourly-movement.ts`'s own
  comment records Q-188 fixing this same contributor for being *"pinned at 100… it could never carry
  information"* — that fix corrected the **denominator** (the goal window). The **numerator** now
  saturates for an unrelated reason, so the earlier fix could not have prevented this. Same symptom,
  different half.
- **Open question for the fix — this is the whole difficulty.** A boundary that is a fixed fraction
  of reserve re-saturates as soon as the owner's resting HR drops again (which is exactly what Q-515
  measured happening). Candidates, none yet fitted: a **personal EMA of waking HR** rather than
  resting HR; a **per-hour delta** against that day's own quiet hours; or dropping HR entirely and
  keeping the hour if it carries steps. The last is the only one immune to fitness drift, and steps
  have full coverage (Q-521).
- **Pass test:** the "moved" fraction of waking hours with data must fall well below 1.0, and the
  contributor's day-to-day spread must survive when days with full ring wear are considered alone —
  i.e. the variance must stop coming from missing data.
- **Caveats:** n = 59 days, one athlete. A boundary fitted here is fitted to one person's HR profile
  and must be re-checked before any second user relies on the Activity Score.

### [activity][heart-rate] Q-523 — zone minutes read 0 on 90% of days: the Zone 2 floor sits above where strength training lives

- **Branch:** `fix/zone-minutes-floor-and-gap-cap`
- **Plan:** none yet — the threshold question needs the owner's labels (below). Evidence:
  [`docs/reviews/2026-08-19-zone-minutes-move-hours-coverage.md`](reviews/2026-08-19-zone-minutes-move-hours-coverage.md) §3–4.
  Lane A implements; Tuning proposes only.
- **Added:** 2026-08-19 · Tuning agent, same ask as Q-522.
- **Measured** over the same 59 days, computed as the runtime computes it (Z2 min + 2 × Z3+ min):

  | active minutes | days |
  |---|---|
  | **0** | **53** |
  | 1–4 | 3 |
  | 5–14 | 1 |
  | ≥ 15 | 2 |

  Mean **1.39 min/day** against `DEFAULT_ZONE_MINUTES_GOAL = 22` → a contributor pinned at **~6/100**.
  `W_ZONE_MINUTES = 10`.
- **It is not a sampling artefact — the training does not reach the floor.** The chest strap is worn
  for workouts and samples at ~1 Hz; its **p99 is 121 bpm** against a Zone 2 floor of **133** (60% of
  reserve). Only **0.29%** of strap samples reach Z2, 0.11% reach Z3. **This is Q-516 (`PEAK_BANDS`
  is calibrated for a heart-rate range strength training never reaches) in a second consumer of the
  same banding** — resolve them together or the two will drift apart.
- **The existing guard covers the wrong half of the calendar.** `activity-score.ts:144` suppresses
  the contributor when `zoneMinutes === 0 && strengthSessionToday`. It fires on 40 of 44 strength
  days — but **13 of 15 non-strength days score a hard 0**, costing 10 points of weight on the days
  the metric has nothing to say about. (Both group means are indistinguishable from zero at n = 15;
  do not read non-strength 2.80 vs strength 0.91 as an inversion.)
- **Second, separable defect — the gap cap does not match the ring's cadence.**
  `DEFAULT_MAX_GAP_SEC = 120`, and its comment says a ring "samples ~1/min". **This ring samples on
  an exact 300 s cadence** (p50 = p90 = 300.0 s), so **80.1% of its intervals are truncated** and it
  keeps **35%** of elapsed time against the strap's **84%**. The same minute of the same effort is
  worth **0.4 min on a ring-only day and 0.84 min on a strap day**, and
  `activeMinutesFromZoneSeconds` then doubles vigorous minutes, doubling the gap with it. Only 26 of
  59 days have strap data. **Fixing the floor without fixing this leaves zone minutes
  non-comparable across days** — derive the cap from the observed source cadence.
- **✅ ANSWERED 2026-08-19 — no owner labels were needed, and the ask for them was withdrawn.**
  [`docs/reviews/2026-08-19-active-minutes-who-threshold.md`](reviews/2026-08-19-active-minutes-who-threshold.md).
  **Two changes, and the second is the big one.**
  1. **Anchor active-minutes on `targetAnchorMax`, not `maxHr`** (owner instruction: *"use current
     recorded high and set a % off it… make it dynamic so as max HR increases the zones can too"*).
     `resolveHrProfile` **already computes both**: `estimatedMax` = 187 (220 − 33), corroborated
     `observedMax` = **167** (5th-highest of 72,519 readings over 90 days, so a spike cannot move it).
     `maxHr` deliberately refuses to drop below the age prediction — correct for %-of-max effort math,
     wrong for this. It is dynamic by construction: a rolling 90-day order statistic.
  2. **`activeMinutesFromZoneSeconds`'s WHO mapping is shifted one band.** Its comment says Zone 2
     (**≥60% reserve**) is *"WHO moderate"*. **WHO/ACSM moderate is 40–59% of reserve; 60% is where
     *vigorous* begins.** So what the code counts once as moderate is actually vigorous, and
     **moderate intensity — brisk walking, stairs, carrying things — maps to no zone at all and earns
     nothing.** It has been scoring zero by construction.
  - **Proposed rule:** moderate = **[0.40, 0.60) of reserve ×1**, vigorous = **≥0.60 ×2**, both off
    `targetAnchorMax`. For this athlete today: **99–121 bpm ×1, ≥121 ×2.**

  | contributor `zoneMinutes` (weight 10) | shipped | observed-max only | **proposed** |
  |---|---|---|---|
  | days reading **zero** | **53/59** | 38/59 | **6/59** |
  | mean active minutes | 1.4 | 2.6 | **24.7** |
  | days hitting the 22-min goal | ~2 | 2 | **23/59** |
  | sub-score mean / sd | ~6 / ~0 | — | **63.8 / 38.7** |

  **That makes it the highest-variance contributor in the Activity Score**, above `steps` (sd 33.4).
  The published threshold is not a guess: the sweep is smooth around 0.40, so a small error in the max
  estimate does not swing it.
- **The GOAL's window is a separate question from the threshold, and it is also wrong** — see
  [`2026-08-19-daily-vs-weekly-windows.md`](reviews/2026-08-19-daily-vs-weekly-windows.md), folded
  into Q-505. `DEFAULT_ZONE_MINUTES_GOAL = 22` is WHO's 150/week ÷ 7; the contributor should be scored
  over a **rolling 7-day window against 150**, as the strength lane already is. **Fix the threshold
  here; the window belongs to Q-505's split.** Doing the window without the threshold changes nothing
  (the weekly total is near zero today), which is why this entry stays first.
- **Do NOT re-cut `ZONE_DEFS`.** Zones 1–5 are *training* zones for cardio prescription and are not
  wrong; the defect is in the roll-up that borrows them for a *public-health* question. Add the WHO
  bands alongside. Likewise `maxHr` stays conservative — only the active-minutes path moves.
- **Re-measure the strength-day suppression guard after this lands.** It exists because a lifting day
  scored a structural zero; at a 99 bpm floor lifting days will not be zero, so the guard may become
  unnecessary or actively wrong.
- **Pass test:** zero-zone-minute days must fall from 53/59 to something that tracks the owner's own
  sense of an active day, and ring-only vs strap days must produce comparable minutes for comparable
  effort.
- **Caveats:** n = 59, one athlete, and zone floors are the single most person-specific constant in
  the app.

### [body] Q-521 — Body Battery's drain tracks how long the ring was worn, not what the owner did

- **Branch:** `feat/exertion-integrated-battery-drain`
- **Plan:** the design brief is
  [`docs/reviews/2026-08-19-body-battery-drain-and-roadmap.md`](reviews/2026-08-19-body-battery-drain-and-roadmap.md) §3.
  **Do Q-515 first** (see sequencing). Lane A implements; Tuning proposes only.
- **Added:** 2026-08-19 · Tuning agent, from an **owner brief** (*"body battery still doesn't seem
  that good… id like that type of granular drain"*)
- **Measured** over 51 days, joined to steps and completed workouts:

  | relationship | measured | should be |
  |---|---|---|
  | `corr(hr_sample_count, total_drained)` | **+0.518** | — |
  | `corr(steps, total_drained)` | **−0.153** | strongly **positive** |
  | `corr(steps, end_value)` | **+0.112** | strongly **negative** |
  | `corr(total_drained, end_value)` | −0.674 | negative ✓ |

  **The strongest predictor of ending low is how many HR samples were recorded — i.e. ring wear time.**
  Steps are *negatively* associated with drain.
- **A workout barely registers:** `end_value` averages **50.6** on 37 workout days vs **50.0** on 14
  non-workout days — a **0.6-point** difference.
- **The days that hit 0 are the quiet ones.** Four days ended at exactly 0 on **828–4,152 steps**
  (median 3,020), while **16 of 51 days cleared the 8,000-step goal** and did *not* end lower. So `0`
  currently means *"you wore the ring a long time"* and the owner wants it to mean *"you did
  everything"* — close to opposites.
- **Mechanism.** Drain is `-DRAIN_RATE × (hrr − REST_THRESHOLD) × dt`, purely HR-driven; steps,
  workouts, zone minutes and calories enter only via their HR effect. With **Q-515**'s boundary having
  fallen to ~60 bpm, nearly every waking sample drains, and `(hrr − threshold)` varies far less than
  wear duration — so **drain ≈ rate × time worn**, which is what +0.518 says. **Q-521 is downstream of
  Q-515**: fixing the boundary does not fix this, but leaving it broken re-poisons any replacement.
- **✅ OWNER CONFIRMED + MODEL FITTED 2026-08-19 — this supersedes the sketch below.**
  [`docs/reviews/2026-08-19-body-battery-drain-model.md`](reviews/2026-08-19-body-battery-drain-model.md).
  Owner: *"the fitter we get, the more workout stimulus we should need for draining, outside of BMR
  draining which should naturally go up too."* → **goal-normalised, plus a BMR-proportional baseline.**

  ```
  c = 0.5 × min(1, workoutVolume / sessionVolumeGoal) + 0.5 × min(1, steps / stepGoal)
  endValue = max(0, 100 − baseline − (100 − baseline) × c^2.0)
  baseline = 25 × (bmrToday / bmrReference)          // rolling median of own BMR
  ```

  | day | end value | brief it satisfies |
  |---|---|---|
  | everything hit (`c = 1`) | **0** | *"a day where I have done everything — I'd expect to see 0"* |
  | workout only, no walking | **~30** | *"a bit of reserve battery at the end of the day"* |
  | nothing done (`c = 0`) | **75** | depleted by being awake, but only a little |
  | typical day | **~44** | readable, rather than always empty |

- **⚠️ A LINEAR split cannot satisfy the brief — do not try it first.** Every linear allocation lands
  mean 26–34 / sd 16–22 with a max of 58–77, because a *typical* day is ~58% of a *full* day, so
  putting a full day at 0 puts a typical day next to it. **Not a saturation problem** — both inputs
  vary well (workout completion sd **0.403**, 16 days at ceiling and 29 at zero; steps sd **0.346**).
  The concave exponent is what reconciles everything-hit → 0 with typical → mid-range.
- **Expect LESS spread than today, and that is correct.** Shipped: mean 50.3, sd **30.1**, range
  0–100. Proposed: mean ~44, sd **~22.6**, range 0–75. Today's spread is largely ring **wear time**
  (`corr(hr_sample_count, drained) = +0.518`). Twenty-two points driven by what the owner did beats
  thirty driven by an artefact. The 75 ceiling is inherent to having a baseline term: remove it and a
  sedentary day ends at 100, which contradicts the term the owner asked for.
- **Sequencing: do Q-515 AND Q-527 first.** Q-515 because a rest boundary that moves with fitness
  re-poisons anything built over it. **Q-527 because BMR becomes load-bearing the moment this lands**,
  and there is already one corrupt `body_comp` row (2026-07-29: 3% body fat, BMR 1,890 vs ~1,520
  around it) that would silently drain a quarter faster.
- **Pass tests:** `corr(steps, drained)` clearly positive; `corr(hr_sample_count, drained)` toward
  zero; workout vs non-workout `end_value` separating by far more than 0.6 points; a 90-day replay
  landing mean **40–48**, sd **≥ 20**, and **≤ ~15%** of days under 5 — a model that empties most days
  is as uninformative as one that never does.
- **BMR is flat so far — build for it, don't promise it.** 71 snapshots over 3.5 months: monthly BMR
  1,529 / 1,514 / 1,582 / 1,522, trend **r = +0.080**. The baseline term *should* scale with BMR as
  the owner asked; it will not move much soon, and UI copy should not imply otherwise.

- ~~**First action — exertion-integrated drain**~~ *(superseded by the fitted model above; kept for
  the reasoning)* (§3): keep the morning anchor; replace time-integrated
  HR drain with exertion combining steps/movement, HR above rest, workout load and zone minutes;
  **normalise against that day's `getDailyGoals`** so "everything hit" lands near empty; **floor at 0
  and route the overshoot to an overreach signal** rather than below empty (the same resolution the
  owner chose for Activity).
- **⚠️ Two constraints the data imposes.** (1) **`active_calories` is unusable as a load-bearing
  input — present on 8 of 51 days**; steps are on all 51, and any design needing calories silently
  degrades to the HR-only model being replaced. (2) Normalising to targets means **a fitter person
  drains less for the same absolute work** — correct for "did I do my day", wrong for "how depleted am
  I". The owner's brief chooses the former; **write that into the model's comment so it is not
  silently reversed.**
- **This model must NOT be asked to detect overreaching.** On a target-hitting day a well-recovered and
  an overreached athlete both read 0. Overreach lives in ACWR/readiness/illness. This arguably resolves
  **Q-276** by making Body Battery explicitly *not* a recovery number.
- **Pass test:** re-run the four correlations above. `corr(steps, total_drained)` must become clearly
  positive, and workout vs non-workout `end_value` must separate by far more than 0.6 points.
- **⚠️ Coverage check done 2026-08-19 — two of the four proposed inputs are unusable (Q-522, Q-523).**
  `moveHours` is **saturated**: 856 of 857 waking hours with data qualify as "moved", 48 of 59 days
  score exactly 100. `zoneMinutes` is **floored**: 0 on 53 of 59 days, because the Zone 2 boundary
  (133 bpm) sits above where the owner's strength training reaches (strap p99 **121 bpm**). Put into
  a drain model as they stand, they would enter as a constant ≈ 1.0 and a constant ≈ 0 while reading,
  in review, as working movement and intensity terms. **Build the first slice on steps + workout load
  only**, and add the other two once Q-522/Q-523 land. Evidence:
  [`docs/reviews/2026-08-19-zone-minutes-move-hours-coverage.md`](reviews/2026-08-19-zone-minutes-move-hours-coverage.md).
- **Caveats:** n = 51, one athlete, Pearson on daily aggregates — the weak values (+0.112, −0.153) mean
  *"no relationship"* rather than a precise signed effect.

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
- **✅ OWNER DECIDED 2026-08-19 — outcome (1): they are different questions, and both now have a
  definition.** *"Body battery should be more like 'how much energy I have left'. Readiness should
  just be a starting number based on your previous day + sleep, so you can see how your day is
  typically based on data."*
  - **Body Battery = energy remaining right now.** Intraday, depletes through the day, floors at 0.
    This is consistent with — and now the stated purpose behind — Q-521's exertion-integrated drain.
  - **Readiness = a morning starting number from the previous day and the night's sleep.** Set once,
    static for the day.
  - **Readiness needs NO model change to match that definition — checked, not assumed.** All nine
    `READINESS_WEIGHTS` contributors are overnight or previous-day measures: `previousNight` 0.16,
    `restingHeartRate` 0.15, `hrvBalance` 0.15, `temperature` 0.10, `sleepBalance` 0.10, `checkin`
    0.10, `prevDayActivity` 0.09, `recoveryIndex` 0.09, `activityBalance` 0.06. **Nothing reads
    today's activity.** It is already the number the owner described.
  - **So this resolves to a presentation change, not a modelling one:** label the two so a reader
    cannot mistake them for the same question, and stop placing them adjacent without that framing.
    **That makes it Lane B's, not Lane A's**, and it unblocks now rather than after Q-272.
  - **The drain model implementing this is fitted** —
    [`2026-08-19-body-battery-drain-model.md`](reviews/2026-08-19-body-battery-drain-model.md), folded
    into Q-521. Owner added a **BMR-proportional baseline** on top of goal-normalised activity drain:
    *"the fitter we get, the more workout stimulus we should need for draining, outside of BMR draining
    which should naturally go up too."*
  - **The +0.12 end-of-day correlation is no longer a defect.** Two numbers answering different
    questions are not required to agree; the earlier framing assumed they should. What remains worth
    watching is only that the anchor **starts** at readiness (+0.93) — i.e. the day begins where
    readiness says and then diverges as energy is spent, which is exactly the intended behaviour.
- **Superseded — the three options as originally posed.** Kept for the reasoning, not the choice:
  1. **They are different questions** → the UI must label them as such, and they should probably
     never be adjacent without that framing.
  2. **They should agree** → the intraday model needs to preserve the anchor's information (which
     overlaps heavily with Q-272's charge/drain rebalance).
  3. **One is redundant** → drop it and reclaim the screen space. §2.4 argues *against* adding a
     sixth score for exactly this reason; the same logic applies to keeping a fifth.
- ~~**Do not action this in isolation.** Q-272 changes the intraday curve and will move this
  correlation on its own; re-measure after it lands before deciding.~~ **No longer applies** — the
  owner decided the *question* each score answers, which does not depend on where the correlation
  settles. The labelling work can proceed now; Q-272 and Q-521 change Body Battery's behaviour
  underneath it without changing what it is for.

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
- **⚠️ Two of this entry's premises are wrong, measured by Q-281's audit 2026-08-17
  ([doc](reviews/2026-08-17-score-presentation-audit.md) §3–§4). Read them before planning:**
  1. **"What a user sees today … typically a gap, a carried-forward value, or nothing, depending on
     the surface" is not what the code does.** Every surface audited independently arrived at the
     same behaviour: Home and day-detail render `—`; the detail hero renders `—` with a muted ring
     **and suppresses the band label** so a null cannot borrow "Low"; the timeline, day-sections,
     sleep card and stress tiles hide the element entirely. **No surface renders a null as 0, and
     none carries yesterday's value forward.** What is missing is only the *why*. That makes this a
     one-layer addition, not a defect sweep — a much smaller job than the entry implies.
  2. **Two of the five "pillars" have no score surface to fix.** Daytime stress appears only as two
     *minute* tiles inside `/health/activity`; resilience only as one conditional tile in
     `/health/readiness`. Decide whether they are pillars before generalising a coverage
     representation over five of them — the table above may be measuring three pillars and two
     derived values.
  - Scope item 1 ("generalise `ScoreAvailability`") has exactly **one** migration site,
    `components/health/readiness-breakdown.tsx`, so it is cheaper than it reads.

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
- **Sequencing:** this is presentation over numbers that Q-500/Q-272/Q-275/Q-505 are all about to
  change. Do the **audit** now (it is cheap and its output is durable); hold the **UI work** until
  the model changes settle, or it gets done twice.
- **✅ The audit is DONE (2026-08-17, Lane B) —
  [`docs/reviews/2026-08-17-score-presentation-audit.md`](reviews/2026-08-17-score-presentation-audit.md).**
  Fourteen surfaces, each scored for contributors / trend / action. **Nine of fourteen render a score
  with no contributors and no trend**, and exactly one surface has all three. The
  colour-only-state first pass shipped with it (v1.318.10): the Home "accentring" style's band dot
  now carries its word, guarded by a mutation-checked `e2e/score-band-not-colour-only.spec.ts`.
  **`FactorBar` is a literal match for the rule and was deliberately NOT changed** — the sub-score is
  rendered as text beside the bar, so the state is already in a non-colour channel; the doc records
  why, so it is not re-filed as a violation.
- **Three corrections the audit made to this entry's own premises, worth reading before planning:**
  (a) `packages/shared/src/health/score-audit/` has **zero user-facing consumers** (two admin routes,
  one admin tab, one producer) — a plan that says "wire up the existing layer" is building the first
  consumer, not the second; (b) `scoreAvailability` has exactly **one** consumer,
  `readiness-breakdown.tsx`; (c) **daytime stress and resilience have no score surface at all** —
  stress is two *minute* tiles nested in `/health/activity`, resilience is one conditional tile in
  `/health/readiness`. The five pillars are not five peers.
- **What is LEFT here is the UI work only, and it stays held** per the sequencing above. The audit's
  own recommendation: **trend is the missing dimension, not contributors** (contributors are
  genuinely inapplicable to a chip or a timeline row; a 7-day sparkline is not).

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

### [app-shell] Q-354 — the date-swipe `useDrag` swallows MOUSE clicks on Nutrition (touch is fine)

- **Branch:** `fix/nutrition-mouse-click-swallowed`
- **Added:** 2026-08-17 as the residue of Q-309 · **cause located and proven 2026-08-17**
- **Priority: low, and that is a considered position rather than a shrug.** The supported target is
  a touch-only APK and **touch works** — verified repeatedly. No supported user produces mouse input.
  This is filed because it is now *understood*, not because it needs doing.
- **Proven cause: the date-swipe `useDrag` binding** on the scrolling container
  (`nutrition-content.tsx:513`, spread at `:575`). Removing `{...bindDateSwipe()}` and re-running the
  probe makes **every** input method work:

  | Input | with binding | binding removed |
  |---|---|---|
  | `locator.click()` | ✗ | ✓ |
  | raw `page.mouse.click()` | ✗ | ✓ |
  | mouse down+up, 0 ms gap | ✗ | ✓ |
  | `touchscreen.tap()` | ✓ | ✓ |
  | `element.click()` in page context | ✓ | ✓ |

- **This corrects Q-309's write-up, and the correction matters.** Q-309 blamed this binding;
  the Q-309 closing note then said it could not be the cause, reasoning that the failing input
  produces no touch events for `filterTaps` to filter. That reasoning was about the *touch* path.
  `useDrag` also binds mouse/pointer, and the mouse path is what it breaks — so the original
  suspect was the right component and the wrong mechanism. **Both halves are now measured**: touch
  taps genuinely work, and the binding genuinely swallows mouse clicks.
- **`pointer: { touch: true, mouse: false }` does NOT fix it** — tried, measured, reverted. All three
  mouse paths still fail with it set. Whatever suppresses the click is not that switch, so a real fix
  means going into use-gesture's tap/click-suppression behaviour or restructuring the binding.
- **Recommendation: do not pursue without a reason.** The only working path is the one that matters,
  a rewrite risks it, and there is no user on the supported runtime who benefits. Revisit if the app
  ever gets genuine desktop use, or if an automated accessibility/interaction scanner (Q-282) starts
  driving mouse input.

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

- **⚑ 2026-08-19 — the yardstick question is answered, and the obvious next move was the wrong one.**
  [`docs/reviews/2026-08-19-sleep-validation-targets.md`](reviews/2026-08-19-sleep-validation-targets.md).
  This entry says *"whatever closes this needs a better yardstick first: more spread in the ratings, a
  different outcome to predict, or a rank-based measure."* All three were tested.
  - **More spread in the ratings: NO — and the ask was withdrawn.** The owner explains the flatness
    (*"upon waking I don't feel instantly super rested or not rested… generally it's a mid"*), and
    measurement backs them: `sleep_quality_feel` (sd ~0.8, 5 values used) is the **most** variable
    self-report in the app. `perceived_recovery` sd 0.36 / 2 values; `motivation` 0.34; `wake_mood`
    0.39; **`resting_soreness` sd 0.00 — exactly 3 in all 20 entries.** Asking for performative spread
    would also invalidate the 46 nights already collected.
  - **A different outcome: only one candidate, and it is weak.** Against raw sleep measures (not the
    composite, per the Q-511 rule): **steps r = +0.210**; training volume **+0.028** and mean RPE
    **−0.023**. The latter two are **structurally disqualified** — volume is *prescribed by the app*
    (adherence 73.6% actual vs 73.1% planned, Q-514), so it cannot respond to sleep, and
    `RPE_DEAD_BAND = 1.5` makes RPE deliberately insensitive.
  - **The rating is better than any alternative anyway:** `sleep_quality_feel` (sign-corrected) vs
    efficiency **+0.316**, vs duration +0.220 — against `mood_logs.energy_level`'s −0.114 and +0.107.
    Low variance is not no information. `energy_level` still has the best *spread* (75 entries, ok 35 /
    good 34 / low 4 / drained 2 — categorical labels get answered where abstract magnitudes get a 3)
    and is worth adding as a **secondary** target.
  - **So do the rank measure, and re-run after the recalibration.** Two groups — the 6 nights rated
    1/4/5 against the 40 rated 2/3 — answers "do flagged-unusual nights score differently?", which 6
    nights *can* support and a coefficient cannot. **And every correlation here predates v1.319.0**
    (mean 84.1 → 69.5, sd 15.9 → 16.6): a rating cannot agree with a score that barely moved. Blocked
    only on ~3 weeks of nights accumulating under the new model, since history is not back-filled.
  - **⚠️ Do not quote `energy_level` ↔ HRV = −0.424 as a finding.** It is the largest coefficient in
    that review and points the wrong way; Pearson on a 4-level ordinal with 92% of mass in two adjacent
    levels manufactures exactly this. Needs a rank measure and a training-day confound check first.

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

- **⚠️ Task 3 does NOT close this entry, and it reads as if it does. Re-checked 2026-08-17 (Lane B).**
  Task 3 measured **home cold start** — FCP 472 ms, of which 439 ms is the document round trip and
  ~15 ms is JavaScript. That is a sound result *about home*. The callout at the top of this entry is
  about a **different screen and a different number**: first mount of `/workout`, measured warm at
  **1086 ms and 1348.7 ms with `rscCount: 0`**, i.e. entirely client-side. Nothing has measured that
  one. "There is no JavaScript problem to solve on this screen" is true of the screen Task 3 looked
  at and unproven of the screen the callout implicates.
- **The file sizes are still the premise, and they have grown**, re-measured 2026-08-17 on `main`:
  `components/workout-screen.tsx` **1,831** (entry says 1,815) and
  `app/session-select/session-select-content.tsx` **1,457** (entry says 1,453/1,414/1,417 in three
  places). Both remain the two largest `.tsx` in the app; the next three are `config-screen.tsx`
  (997), `config/program-editor-sheet.tsx` (963) and `health/health-content.tsx` (911).
- **What is actually left here is a large refactor with a contested justification, and it should be
  scoped before it is started.** Splitting the workout orchestrator touches the app's core flow, has
  **no automated component-test route** (both vitest projects are node-only) and is **device-only to
  verify**. Task 1 already found that extraction moves *zero* bytes (a static child shares its
  parent's chunk), so the readability case is the honest one and the perf case needs the /workout
  first-mount measurement above before anyone commits. **Do the measurement first** — the same
  mistake this entry made once already is assuming which cost is where.

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

### [platform] 🟢 Q-543 — every concurrent PR conflicts on the doc-index BASELINE object

`scripts/check-doc-index-size.js` holds three numbers — `projectOverview.md`,
`docs/implementation-backlog.md`, `CLAUDE.md` — in one object literal, under ~170 lines of
accumulated raise-history commentary. Every lane that raises a baseline edits the same few lines of
the same file on the same day, so the ratchet has become the repo's most reliable merge conflict.

**Measured on this branch, 2026-08-18:** one docs-only PR (#69, a single `CLAUDE.md` row) took four
CI rounds. One was a genuine ratchet failure and correct. The other three were base collisions with
#68, then #65/#71, then #75 — **all three on this file, none on the content being changed.** The
file's own comments record the same thing happening to other lanes repeatedly, describing "the
fourth same-day ratchet collision on this branch" and warning in five separate places that splicing
a conflict hunk silently un-does the other lane's raise. That warning exists because it has been got
wrong before.

**This is the same problem `docs/overview/entries/` already solved.** Per-entry journal files took
the journal-prepend conflict class to zero on the reasoning that two PRs writing *different files*
cannot conflict. The baselines are the remaining shared-line edit that every PR touches.

**Shape worth considering** (not a spec — the decision is which, and it is cheap to reverse):

- **Per-file baseline fragments** — `scripts/doc-baselines/<slug>.json` or similar, one file per
  ratcheted doc, read and merged by the check. Directly mirrors the entries-directory fix. Costs a
  small loader; removes the conflict class outright.
- **Move the raise-history prose out of the source file** into a log the check does not parse. Much
  smaller change, and it shrinks the conflict window without closing it — two lanes raising the same
  file the same day still collide, they just collide on one line instead of thirty.

**Do not** solve it by dropping the history commentary wholesale. Several of those notes are the
only record of *why* a number moved, and at least one documents a real near-miss where a splice
would have reverted another lane's raise.

**Not urgent.** It costs minutes per PR, never correctness — the check itself works exactly as
intended, and caught a real overrun on #69. Filed per "no orphaned findings" rather than taken,
because restructuring a CI gate mid-merge is not a docs change.

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
