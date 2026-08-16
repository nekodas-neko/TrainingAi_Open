# Handoff — 2026-08-02 · Native-roadmap review and the public-repo migration plan

_Domain: `platform` (also touches `app-shell`, `devices`) · Branch: merged to `main` via **#1005**
(`d87152a`) · PR: merged, head branch deleted_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> [`docs/domains/platform/README.md`](domains/platform/README.md), then
> [`docs/implementation-backlog.md`](implementation-backlog.md) (the queue). This file covers only
> what *this* session did and what it leaves behind.

> **If you are the agent working the batch queue drain** — your run-list lives in
> [`handoff-2026-08-02-platform-batch-queue-drain.md`](handoff-2026-08-02-platform-batch-queue-drain.md)
> with runs 1 and 2 recorded in their own files. **Nothing in this session's work changes that
> run-list or your device checklist.** What changed underneath you: new entries now sit above
> everything you have left (**Q-51**, **Q-49**), and the **Q-31/Q-32 gates are released**. Skip to
> "What this means for the queue-drain agent" if that is all you need.

> ## 🆕 UPDATED end of session — read this before the body below
>
> The body was written at the session's midpoint and is stale in three places. Corrections, in
> order of how much they matter:
>
> **1. There is now an owner-approved sequence, and Phase 3 is measurement-gated.** The owner named
> where the app actually feels slow — *"it's not the workout screen that needs the native feel for
> me, it's the home screen and switching tabs and navigating through the app"* — and approved:
> **Q-51 → Q-49 → Stage 3 → measure again → Stage 5 → Phase 3 and Compose only if a gap remains.**
> **Q-1/Phase 3 is not cancelled or downgraded**; its architecture rationale stands and Gate A stays
> unspent. Only its *trigger* changed: it waits on Q-51's cold-start profile, because its own sizing
> note says it will not make navigation faster. Recorded in `projectOverview.md`, the goal layout §4
> and the Q-1 entry.
>
> **2. The queue head is Q-51, not Q-49.** [`docs/implementation-backlog.md`](implementation-backlog.md)
> order today: **Q-51 → Q-49 → Q-50 → Q-48 → Q-44 → Q-1**. Q-50 is *not* mine — another session
> claimed it in parallel for the vendored-model deletion decisions, and my perf entry moved to Q-51.
> The file now carries a "claim Q numbers against open PRs" note, because this collided twice in one
> day (Q-46, Q-50).
>
> **3. Q-49 Phase A is part-built already** — #1015 shipped A0 (the dormancy sweep) and #1017 shipped
> A1 step 5 (the boot assertion, `lib/oura-models/required-models.ts` + `instrumentation-node.ts`).
> So "no code, A1 is specified not built" below is out of date. What remains on A1 is the asset move
> and the build-time fetch itself.
>
> **Also corrected by #1014:** my ONNX figures were wrong — **10 files / 23 MB**, not 46 / 31 MB. I
> counted with a grep that matched every path containing "onnx", including the `__fixtures__`
> goldens. The plan is unaffected; the numbers in it are now right.

## Goal

The owner asked for a review of the app's road plan against the goal of ending up as a native APK,
then for the public-repo migration to be planned and slotted into it. Information-writing only — no
code was intended or written.

## Current status

- **Build/test:** CI green on #1005 (Lint, Tests, Build, Custom Rules, Migration Check).
  `scripts/check-doc-links.js` passes. **`pnpm dev` was NOT run** and needed no run — the diff is
  eleven documentation files, zero source files.
- **Device-verified:** N/A, nothing to verify. No device, no APK, no Kotlin compile, no production
  queries were used in this session. Every claim below is source- or documentation-level, with
  file:line references checked against `main` at `e6ae0a6`/`3580cf0`.

## What shipped

| Artefact | Path | What it is |
|---|---|---|
| Roadmap review | [`docs/reviews/2026-08-02-native-convergence-roadmap-review.md`](reviews/2026-08-02-native-convergence-roadmap-review.md) | Eight findings (F1–F8) against the native-convergence goal layout and the docs feeding it |
| Migration plan | [`docs/superpowers/plans/2026-08-02-public-repo-migration-roadmap.md`](superpowers/plans/2026-08-02-public-repo-migration-roadmap.md) | Backlog **Q-49**. Phase A (model delivery) + Phase B (the cut) |
| Journal entry | [`docs/overview/entries/2026-08-02-app-review-native-roadmap.md`](overview/entries/2026-08-02-app-review-native-roadmap.md) | The session record |

Backlog and doc changes in the same PR:

- **Q-49 added at the top of the queue**; **Q-48** added below it (the review's unactioned findings).
  Q-48 was **renumbered from Q-46**, which run 1 claimed the same day for the restamp guard (#1003).
- **Q-31 and Q-32 re-scoped, their Q-1 + Q-30 gates released**, and Q-31's three stacked
  self-contradicting annotations reconciled (one still said "blocked — do not pick up" directly
  under a header saying the opposite).
- **Goal layout Stage 4 resequenced** to the front, with the reason recorded inline
  ([`2026-08-02-native-convergence-goal-layout.md`](superpowers/plans/2026-08-02-native-convergence-goal-layout.md)).
- **`offline-first-target-architecture.md`** sequencing note; **`docs/domains/platform/README.md`**
  links both new docs.
- **Five drifted doc claims corrected**, listed in the review's F8. One was actively wrong:
  `device-agnostic-source-architecture.md` §4c described `saveSleepSession` as taking no `source`,
  which Q-43 had already fixed (`lib/data/repository.ts:527`).
- **`CLAUDE.md`'s `body_hex` prune rule qualified as server-side** — the 14-day local retention
  decision needs that distinction, and the unqualified rule read as a blanket ban on the device
  pruner.
- Folded in what landed mid-session: migration **166 is spent** (#1004), so the next free number is
  **167**, and the `sleep_sessions.oura_id` collision is **closed**, not open.

## What this means for the queue-drain agent

1. **Your run-list is unaffected.** Items and the single owner device checklist are unchanged. Do
   not start a second checklist.
2. **Two entries now outrank everything you have left.** Q-49 is 🔴 and top; Q-48 is 🟠 below it.
   Whether you take Q-49 before your remaining items is the owner's call, not a queue-protocol
   question — it was placed by the owner's direction, not by my judgement of relative severity.
3. **Do not build Q-31 or Q-32 directly.** Q-32 is superseded by Q-49; Q-31's replacements are
   Q-49's "A2" and are explicitly **off** its critical path.
4. **Next free Postgres migration is 167.** Claim against the directory *and* open PRs.
5. **The pattern you named in run 2 — "three entries whose own premise was wrong" — has a fourth.**
   Q-32's premise ("gitignore the weights, Phase 3 means no public server deploy") is false for the
   reason in the next section. Your instinct to measure before building is the right one and it
   applies to the roadmap docs too, not only the bug entries.

## Key decisions (with rationale)

- **The public-repo cut moved to the front of the queue.** The owner reported that the private repo
  has a running daily cost the roadmap never weighed: `apk-latest` 404s unauthenticated, so
  `/api/download-apk` plus a PAT is the only distribution path and a second user cannot install at
  all; Actions minutes are metered. The Q-1 + Q-30 gates were 2026-07-30 sequencing preferences with
  no technical content, so they were released rather than waited out.
- **Model delivery is the real blocker, not Phase 3.** SleepNet, `step_counter` and
  `steps-motion-decoder` load through `onnxruntime-node`, are marked "Server-only" in their own
  headers, and `sleepNetStages5Min` runs inside `aggregateOuraRawSamples`
  (`lib/data/postgres/adapter.ts:5006`) — on Railway, which deploys from git. Phase 3 splits `api/`
  onto its own Railway service; it does not remove the server. Every loader returns `null` on
  failure by design, so gitignoring the assets **silently** kills the hypnogram and ring steps.
- **Owner chose build-time fetch from private storage** over accepting that degradation. Two facts
  make it cheap: `ONNX_DIR` (`lib/oura-models/inference/session.ts:12`) is a single choke point, and
  the WASM sibling `session-web.ts` already exists with byte-parity tests and zero callers, fed by
  the same directory once D2 Task 6 wires it.
- **One repo, not two.** The owner asked whether a second repo should hold the native APK. It should
  not: Stages 6–7 ship Compose screens and WebView screens in the *same* APK, so splitting them
  forces the clean-slate rewrite the goal layout §2 already rejected on measured grounds.
- **Snapshot minus the model tree; no dead-code sweep in the same cut.** A sweep is separable and
  belongs after the new repo has history to bisect against.
- **Repoint the existing Railway service** rather than create a new project. `capacitor.config.ts`
  hardcodes the domain, so keeping it means installed APKs keep working with no rebuild.

## Deliberately NOT done

- **No code.** Q-49 Phase A1 is specified, not built. No `.gitignore` line was written, nothing was
  moved, no fetch script exists.
- **The review's F2, F3, F4, F5, F7 were not actioned** — filed as Q-48 and left for an owner
  decision or a short planning pass. F1 and F6 are actioned by Q-49.
- **#999's triage was not redone.** That plan
  ([`2026-08-02-oura-ip-triage.md`](superpowers/plans/2026-08-02-oura-ip-triage.md)) is the authority
  on the per-module verdicts, and it is better than my first sketch — it found `inference/dhrv` is
  outright dead code. Q-49 consumes it.
- **The ported-logic question is untouched** — #999 flags that `lib/oura-ble/decode.ts` is the whole
  BLE protocol port and is a distinct legal question from vendored constants. Still open, still the
  owner's call, and it should be surfaced before Phase B2 (the last reversible moment).

## Gotchas / what did NOT work

- **I armed a CI monitor built on `curl` to `api.github.com` with `$GITHUB_TOKEN`.** That is the
  exact pattern `CLAUDE.md` documents as non-authenticating in this sandbox; against a private repo
  it 404s and the silence reads as "still running". Killed it and used the GitHub MCP tools. The
  rule is in `CLAUDE.md` and I still walked into it — worth re-reading before you monitor a PR.
- **Eight PRs landed mid-session and the branch had to be rebuilt.** A rebase onto fresh `main`
  tangled on replayed upstream commits; the clean fix was `git checkout -B <branch> origin/main`
  followed by cherry-picking the content commits. The remote branch then diverged from local, and
  rather than force-push (which `CLAUDE.md` gates on owner confirmation) I verified my tree was a
  strict superset and merged with `-s ours`. It left one merge commit, invisible after squash-merge.
> **Correction, 2026-08-02 (batch-drain agent).** The payload figures below originally read
> "31 MB is `.onnx` (46 files)" and "89 MB total". Re-measured against `git ls-files`: **10** tracked
> `.onnx` files totalling **23 MB**, and **87 MB** tracked overall. `constants/` (12 MB) and the
> goldens (3.9 MB) were right. The 46 was new drift — `2026-07-21-oura-raw-on-device-architecture.md:81`
> already recorded ~10 — while the 31 MB was inherited from those older docs and is itself ~35% high.
> Every conclusion survives: a fresh `git init` is still right with 10 committed files. Corrected
> here and in the plan's payload table.

- **The `du -sh lib/oura-models` figure is misleading** — 87 MB on disk includes gitignored `pt/`
  files. What is actually *tracked* is 87 MB total, of which 23 MB is `.onnx` (10 files), 12 MB is
  `constants/`, and 3.9 MB is `onnx/__fixtures__/*.golden.json`. **The goldens are ours and must
  stay** — CI needs them; only the weights and constants leave.
- **`.gitignore:45` covers only `lib/oura-models/pt/*.pt`.** The 10 `.onnx` files are committed. This
  is why the public repo must be a fresh `init` and not a history scrub, which #999 Task 1 already
  settled.

## Files to look at

- `lib/oura-models/inference/session.ts:12` — `ONNX_DIR`, the one-line choke point Q-49 A1 redirects.
- `lib/oura-models/inference/session-web.ts` — the WASM sibling, byte-parity-proven, **zero callers**.
- `lib/data/postgres/adapter.ts:5006` — `sleepNetStages5Min`, the server-side call that proves the
  models run on Railway.
- `app/api/download-apk/route.ts` — the session-gated proxy that exists only because the repo is
  private; `GITHUB_RELEASES_TOKEN` disappears at Q-49 B6.
- `lib/data/postgres/migrations/006_admin_flag.sql` — hardcodes the owner's real email; Q-49 B1.

## Open questions / blockers

- **Owner actions Q-49 needs:** a private storage bucket + one Railway build secret · create and
  name the new public repo · the Railway repoint · credential rotation · a read of #999's closing
  ported-logic section before Phase B2.
- **Q-48's five findings have no owner.** F2 (no OTA path after Phase 3 bundles the shell) is the
  one I would not let sit — Stage 6 is the highest-UI-churn period the app will ever have, and it
  sits *after* the stage that makes every UI change a manual sideload.
- **Q-49 B4 (the Railway repoint) is confirm-first** — the only step in the plan that can take
  production down. B3 (CI green in the new repo) precedes it; B5 (archive the old repo) follows, so
  a rollback target exists throughout.

## Pickup prompt

```
You are picking up platform work on TrainingAI.

The queue's top item is Q-51 (home-screen and tab-navigation performance) — the owner's
stated felt pain, three cheap tasks, sandbox-testable. Q-49, the public repo migration, is
second and is what the rest of this document covers; take it if Q-51 is done or blocked.

Owner-approved sequence, recorded 2026-08-02 in projectOverview.md, the goal layout §4 and
the Q-1 backlog entry:
  Q-51 -> Q-49 -> Stage 3 (device-primary data) -> MEASURE AGAIN -> Stage 5
  -> Phase 3 and Compose screens only if a gap remains.
Phase 3 (Q-1) is measurement-gated, NOT cancelled. Its architecture rationale stands, its
entry must not be deleted or called superseded, and Gate A stays unspent — do not provision
the second Railway api/ service. It waits on Q-51's cold-start profile, which is device-only
and owner-run.

Start each item on its own feature branch off freshly-fetched main:
git fetch origin main && git remote prune origin && git checkout -B <branch> origin/main

Read in this order:
1. projectOverview.md — current status and Known Issues
2. docs/handoff-2026-08-02-platform-native-roadmap-review-and-public-repo-plan.md — why the
   repo cut jumped the queue and what its real blocker is
3. docs/superpowers/plans/2026-08-02-public-repo-migration-roadmap.md — the plan (backlog Q-49)
4. docs/superpowers/plans/2026-08-02-oura-ip-triage.md — the per-module verdicts this consumes
5. docs/domains/platform/README.md

⚠️ UPDATED 2026-08-02: A0 is DONE (#1015) and A1 step 5 is DONE (#1017). Read the two journal
entries (docs/overview/entries/2026-08-02-oura-models-dormancy-sweep.md and
-model-asset-boot-check.md) before re-reading the steps below — several no longer apply.

A1's REMAINING steps are BLOCKED ON THE OWNER: moving the model files out of git needs a private
storage bucket (R2 preferred — a private release on a repo about to be archived is self-defeating)
and a Railway build secret. Do not start the file move without both; a deploy that cannot fetch
them degrades silently, which is the whole hazard. The boot check that catches it already exists
and currently LOGS; flipping it to fatal is one throw and belongs in the PR that moves the files.

Historical, for context — A0 as originally written said: script an
importer check over every file in lib/oura-models/, delete the unreferenced ones including
and assert the sweep in a test so the tree cannot silently re-accumulate dead vendored
files. NOTE: an earlier version of this prompt said to delete inference/dhrv — do not. Its
unreachability is deliberate (golden-tested until D7, see docs/module-map.md). A0 shipped
2026-08-02 without it. Pure subtraction, and it shrinks what every later task has
to reason about.

Then A1, which is the task the whole plan turns on: move the non-publishable payload into a
gitignored lib/oura-models/private/, redirect ONNX_DIR (lib/oura-models/inference/session.ts:12
— one line), fetch that directory at Railway build time via nixpacks.toml with a build secret,
and — the actual deliverable — add a boot-time assertion that every expected model file is
present and non-empty. Without that assertion a broken fetch is invisible: every loader returns
null on failure by design, so the hypnogram and daily steps degrade silently rather than
failing the build.

Constraints you would otherwise rediscover:
- The models are SERVER-side (onnxruntime-node; sleepNetStages5Min at adapter.ts:5006 inside
  aggregateOuraRawSamples) and Railway deploys from git. Phase 3 does not change this — it
  splits api/ onto its own Railway service. Gitignore alone breaks production silently.
- The public repo is a fresh git init, not a history scrub. 10 .onnx files are committed and
  .gitignore:45 covers only pt/*.pt.
- Keep lib/oura-models/onnx/__fixtures__/*.golden.json — they are our own test vectors and CI
  needs them. Only weights and constants leave.
- Q-31's replacements are Q-49's "A2" and are NOT on the critical path. Do not start swapping
  constants to unblock the cut; A1 is what unblocks it.
- Do not build Q-32 directly — it is superseded by Q-49.
- Next free Postgres migration number is 167. Claim against the directory AND open PRs.
- Q-49 B4 (the Railway repoint) is confirm-first. Everything before it is ordinary.
- Do NOT use bash curl against api.github.com to check CI — $GITHUB_TOKEN is a
  non-authenticating placeholder here and a private repo 404s, which reads as "still running".
  Use the GitHub MCP tools.
- Anything you cannot verify in-session ships with a Known-Issues row in projectOverview.md
  naming exactly which surface was not exercised.
- Merge policy: feature branch, CI green, then merge without asking — except
  destructive/irreversible changes, which are confirm-first.

If another agent is mid-way through the batch queue drain, its run-list and the single owner
device checklist are in docs/handoff-2026-08-02-platform-batch-queue-drain.md. Q-49 does not
change either. Do not start a second device checklist.
```
