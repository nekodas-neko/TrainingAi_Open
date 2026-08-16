# Handoff — 2026-07-30 · Public-repo migration plan, now gated on the APK-offline-build effort

_Domain: `platform` (also touches `devices` — the vendored Oura models, and `app-shell` — Phase 3
bundle-into-APK) · Branch: `claude/github-public-migration-0u4r7m` · PR: none yet (docs-only, all
commits pushed to the branch)_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/platform/README.md`, then `docs/implementation-backlog.md`. This file
> covers only what *this* session did and what it leaves behind.
>
> **Renumbered 2026-07-30 (consolidation pass).** This session's Q-29 (D8) and Q-30 (DB volume)
> collided with backlog numbers independently claimed the same day by a different session. The
> canonical backlog now has this content at **Q-31 (D8)** and **Q-30 (DB volume, unchanged
> number, but with a new cross-reference to the Oura on-device program's D4 decision added)** — see
> `docs/implementation-backlog.md`. A **Q-29** now also exists pointing at the pre-existing Oura
> on-device program (D0–D7, `docs/oura-ondevice-hybrid-handover.md`), which this session's own audit
> did not find — read it, it changes the sequencing below in one way: the Oura on-device migration is
> not a future unplanned effort, it is ~40% shipped and blocked on one owner action. Everything else
> in this handoff (the vendored-IP audit, the D8 scope, the repo-cut mechanics) still stands as
> written below.

## Goal

The owner wants the GitHub repo (`nekodas-neko/TrainingAI`) flipped from private to public. This
session's job was to figure out what's actually blocking that (proprietary Oura IP vendored in the
repo) and plan a path to it. Partway through, the owner connected this to a second, larger effort
already under way — "bundle the shell into the APK" (Phase 3 of the native-feel roadmap, Q-1 in the
backlog), the architecture change that removes the Railway server deploy entirely — and decided the
public-repo release should wait until that lands, with a Postgres volume cleanup sequenced alongside
it. The owner's stated intent: **stop running this as several parallel, uncoordinated sessions and
consolidate everything touching the APK-offline-build goal into one dedicated agent.** This handoff
exists so that consolidated effort inherits full context on the public-repo/Oura-IP thread
specifically, without re-deriving it.

## Current status

- **Build/test: not run this session.** Everything shipped was docs/planning — no application code
  was changed, so `tsc`/lint/`pnpm build`/`pnpm dev` were not exercised and there is nothing to verify
  functionally.
- **Device-verified:** n/a — no code shipped.
- Branch `claude/github-public-migration-0u4r7m` has 3 commits, all docs-only, no PR opened.

## What shipped

- **Full audit of `lib/oura-models/` + `scripts/oura-models/`.** Confirmed this is not just
  reverse-engineered BLE protocol notes — it's ~90MB of literal extracted proprietary Oura IP: trained
  neural-network weights, ONNX graphs, decompiled Python model source
  (`scripts/oura-models/_source/**/*.py`), and golden test vectors for 31 of Oura's on-device ML
  models. Also found in the same sweep: an orphaned remote branch
  `docs/preserve-pt-originals-and-goldens` on `origin` still holds the raw decrypted `.pt` originals
  (52MB), and `lib/data/postgres/migrations/006_admin_flag.sql` hardcodes the owner's real email —
  both need handling whenever the public cut actually happens.
- **Import-graph audit narrowed the real live dependency to two files**, not eight:
  `lib/health/stress-resilience.ts:7` (`getResilienceConstants()`) and
  `lib/health/workout-energy.ts:15` (the vendored 82-activity MET table,
  `energy-expenditure-features.json`). The other 6 `lib/oura-models/*.ts` ports
  (`cumulative-stress`, `daily-baselines`, `meal-timing`, `astd-event-detection`,
  `steps-motion-decoder`, `sleepnet-assemble`) have **zero live consumers** — confirmed by grepping
  every import site, and cross-checked against the pre-existing 2026-07-21
  keep/cull/calculate matrix, which independently flagged the same six as dormant.
- **Wrote plan D8** —
  [`docs/superpowers/plans/2026-07-30-d8-own-resilience-and-energy-constants.md`](superpowers/plans/2026-07-30-d8-own-resilience-and-energy-constants.md):
  replace those two proprietary-constant imports with independently-derived values, calibrated (not
  copied) against Oura's own official Cloud-API scores via the existing `lib/oura-comparison-harness.ts`
  (already built for exactly this pattern in D5/D6). Once both land, the entire vendored tree has no
  live consumer anywhere and can be deleted outright.
- **Backlog Q-29** (D8) and **Q-30** (DB volume cleanup) added to
  [`docs/implementation-backlog.md`](implementation-backlog.md). Q-30 was corrected mid-session —
  it originally guessed at a cold-storage-archival approach until a much more thorough existing
  investigation was found (see Gotchas below).
- **Owner decision (2026-07-30, load-bearing):** the public-repo release itself does not start until
  (1) Phase 3 (bundle-into-APK, Q-1) ships and (2) the DB volume fix lands. Both are now recorded as
  the gate on Q-29 in the backlog.
- **Resolved how SleepNet/`step_counter` get handled**, once Phase 3 changes the deploy model: these
  two Oura models were previously decided (2026-07-21 strategy doc) to be kept *forever* because our
  own heuristics are measurably worse. With no public server deploy cloning a fresh checkout to build
  and serve the app (Phase 3's whole point), their asset files can simply move to `.gitignore` and
  live only on the owner's private build machine — the public repo ships the loader/inference code
  (generic, not proprietary) but never the weight files or the comments describing how they were
  obtained. This is **simpler than what I initially proposed** — see Gotchas.

## Deliberately NOT done

- No code changes at all — scoped as planning/audit only, per the owner's stated sequencing.
- D8 is not implemented. Per owner preference it should be built once the new public repo exists (not
  duplicated across two repos) — see the plan's sequencing section.
- The public repo has not been created. No exclusion list applied, no stubs written, no BLE-protocol
  docs rewritten in "our own words" yet — all of that is real work still to do, just deferred.
- The DB volume structural fix (`body_hex` TEXT→bytea migration) is not implemented — fully scoped in
  `docs/db-volume-cleanup-handover.md` §5-6, not started.
- Did not touch Phase 3 itself in any way — that's `docs/handoff-phase-3-bundled-shell.md`'s territory,
  linked below, not duplicated here.

## Key decisions (with rationale)

- **Public repo = a fresh, history-free snapshot**, not a `git filter-repo` scrub of this repo's
  ~900-commit history. Too easy to miss a trace of the vendored weights across that much history; a
  fresh snapshot simply has no history to leak from.
- **Two IP categories need different treatment.** The vendored *model weights* (bucket 1) can't be
  fixed by rewriting docs — the artifact itself is the IP, so it's removal or (for the two permanently-
  kept models) gitignore-and-keep-privately, never a rewrite. The BLE *protocol* docs (bucket 2 —
  `lib/oura-ble/`, `android/.../oura/*.kt`, `docs/oura-ble-*.md`) genuinely can be rewritten in our own
  words for public consumption — that work is still pending, deferred along with everything else.
- **Model-provenance comments/docs get stripped even for the gitignored files.** The loader code
  (generic ONNX-inference logic) is fine to publish; text describing "extracted from Oura's decrypted
  `.pt`, sha256 X" is not, regardless of whether the weight file itself is present.
- **Sequencing:** public-repo release waits on Phase 3 + the DB fix, per explicit owner direction this
  session, because the owner considers the offline-APK goal and the public-repo goal entangled and
  wants one consolidated effort driving them rather than parallel uncoordinated sessions.

## Gotchas / what did NOT work

- **Initial framing was wrong: "replace 8 models."** The real scope is 2 live files; the other 6 are
  dormant. Don't restart from "replace everything in `lib/oura-models`" — check the import graph first.
- **Initially proposed a private-S3-bucket + Railway-build-time-fetch mechanism** for SleepNet/
  `step_counter` before learning the end-state architecture has no public server deploy at all. That
  mechanism is unnecessary complexity for the actual target — plain `.gitignore` + a private build
  machine suffices. Only reach for the bucket-and-build-step version if some future decision has
  Railway serving the public repo directly (it currently will not, per Phase 3's whole purpose).
- **Local dev Postgres has zero rows in `oura_raw_samples`/`oura_heartrate`/`oura_bucket`** (seed data
  doesn't include real ring data) — don't try to extrapolate real prod byte-per-row numbers from the
  sandbox seed; it's empty for these tables.
- **Sandbox cannot reach production Postgres directly** (network policy blocks the DB port,
  re-confirmed this session) — any real DB sizing needs the Railway console or the admin
  `/api/admin/db-query` endpoint, not a sandbox `psql`.
- **Nearly wrote a duplicate DB-cleanup investigation from scratch** before finding
  `docs/db-volume-cleanup-handover.md`, which already has real production numbers from 2026-07-21 and
  a scoped fix. Always check for an existing handover doc before re-deriving analysis — this one
  specifically would have produced a *worse* recommendation (cold-storage-first instead of the
  cheaper, non-destructive bytea conversion).

## Files to look at

- [`docs/superpowers/plans/2026-07-30-d8-own-resilience-and-energy-constants.md`](superpowers/plans/2026-07-30-d8-own-resilience-and-energy-constants.md) — the D8 plan; read the 2026-07-30 sequencing update at the bottom, it supersedes the original sequencing text above it
- [`docs/implementation-backlog.md`](implementation-backlog.md) Q-29 (blocked), Q-30 (DB volume) — current queue state
- [`docs/db-volume-cleanup-handover.md`](db-volume-cleanup-handover.md) — the DB volume diagnosis with real prod numbers + the recommended bytea fix; do not re-investigate, extend this
- [`docs/handoff-phase-3-bundled-shell.md`](handoff-phase-3-bundled-shell.md) — the existing Phase 3 handoff. Task 3 (move auth client-side) is ready to start now; Task 4 is an unresolved owner gate (pick build-split option A/B/C) that blocks Phase 3 completion, which blocks everything in *this* handoff
- `docs/superpowers/plans/2026-07-28-native-feel-roadmap.md`, `2026-07-28-native-feel-phase-3-bundled-shell.md` — the Phase 3 plan itself
- `docs/superpowers/plans/2026-07-21-oura-decoupling-and-own-models-strategy.md`,
  `2026-07-21-oura-data-requirements-keep-cull-calculate-matrix.md`,
  `2026-07-21-oura-ondevice-hybrid-master-plan.md` — the master Oura-decoupling strategy D8 builds on;
  read before touching anything Oura-model-related
- `lib/oura-models/`, `scripts/oura-models/` — the vendored tree in question (~90MB, do not casually re-open/re-vendor)
- `lib/health/stress-resilience.ts:7`, `lib/health/workout-energy.ts:15` — the two live proprietary-constant imports D8 replaces
- Remote branch `docs/preserve-pt-originals-and-goldens` (not a file — `git ls-remote --heads origin`) — holds the raw `.pt` originals, needs deleting whenever this work resumes
- `lib/data/postgres/migrations/006_admin_flag.sql` — hardcodes the owner's real email, needs fixing before any public cut

## Open questions / blockers

- **Pre-existing OWNER GATE, not new: Phase 3 Task 4** — pick build-split option A/B/C (costed in the
  Phase 3 plan). Blocks Phase 3 completion, which blocks everything in this handoff. This is the
  single biggest thing standing between "now" and the public-repo release.
- **DB volume:** confirm whether the WAL-trim + Postgres-restart step from the 2026-07-21 handover
  ever actually happened (it was left "recommended, not yet confirmed done") — that alone might
  explain "still over 900MB" without any new growth. Then scope and ship the `body_hex` TEXT→bytea
  migration (§5-6 of that doc).
- **New public repo name + which GitHub account** — asked, never answered. Not urgent until Phase 3
  lands, but needed before the actual repo-creation step.
- **This branch has no PR.** It's pure docs (plan + backlog entries + this handoff) so per CLAUDE.md it
  can merge with zero ceremony whenever a PR is opened — nobody has asked for that yet, so it wasn't
  done unilaterally.

## Pickup prompt

```
Check out branch `claude/github-public-migration-0u4r7m` in the TrainingAI repo (or merge it to
`main` first if it's easiest to work from `main` — it's docs-only: a D8 plan, two backlog entries,
and this handoff, nothing else, no PR opened yet).

Read in this order:
1. projectOverview.md — current status + Known Issues
2. docs/handoff-2026-07-30-platform-public-repo-migration-gated-on-apk-offline-build.md (this file)
   — the public-repo/Oura-IP thread, what's decided, what's still open
3. docs/handoff-phase-3-bundled-shell.md — the APK-bundling effort's own handoff; Task 3 is ready to
   start, Task 4 is an owner gate (pick build-split option A/B/C)
4. docs/superpowers/plans/2026-07-28-native-feel-roadmap.md and
   2026-07-28-native-feel-phase-3-bundled-shell.md — the Phase 3 plan itself
5. docs/db-volume-cleanup-handover.md — the DB volume diagnosis with real prod numbers

Context: the owner wants one consolidated agent/session driving everything touching the
"APK offline build" goal, instead of the several separate threads that have been running (Phase 3
itself, a Postgres volume cleanup, and a public-GitHub-repo migration that got blocked once it
turned out to depend on Phase 3's architecture). This session's job produced the public-repo side
of that picture; it did not touch Phase 3 or the DB work directly.

The three things genuinely need to land in this order, and none of them can be skipped:
1. Phase 3 (bundle the shell into the APK, no more Railway server deploy) — currently blocked on
   an owner decision (Task 4, A/B/C) that has been sitting open across sessions. Task 3 (move auth
   client-side) does NOT need to wait on that gate and can start now if the owner hasn't decided yet.
2. The Postgres volume fix — confirm the WAL-trim/restart step from the 2026-07-21 handover actually
   happened, then scope and ship the body_hex TEXT→bytea migration.
3. Only then: cut the public repo. Exclude lib/oura-models/ + scripts/oura-models/ wholesale from a
   fresh, history-free snapshot; gitignore (don't delete) SleepNet/step_counter's asset files and
   keep them only on the owner's private build machine, since Phase 3 means no public server deploy
   needs them; implement D8 (docs/superpowers/plans/2026-07-30-d8-own-resilience-and-energy-constants.md)
   as real feature work in the new repo; rewrite the BLE-protocol docs in our own words; fix the
   hardcoded email in migration 006; delete the orphaned docs/preserve-pt-originals-and-goldens
   remote branch.

Ask the owner directly which of the three (Phase 3 Task 4, DB volume confirmation, or something
else) they want tackled first in this consolidated session before starting work.
```
