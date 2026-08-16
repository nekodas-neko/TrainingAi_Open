# Offline-First Target Architecture

_Owner directive, 2026-07-30. This states the **destination**; it is not an implementation plan.
Individual pieces get their own plans in `docs/superpowers/plans/` and their own backlog entries._

> **Extended 2026-08-02 —
> [`docs/superpowers/plans/2026-08-02-native-convergence-goal-layout.md`](superpowers/plans/2026-08-02-native-convergence-goal-layout.md).**
> This doc settles where the *data* lives (device-primary, Railway as finished-form backup); the
> goal layout extends it with where the *UI* eventually lives (native Compose, incrementally, by
> touch-frequency), folds in the public-repo cut (Q-32), and records why a clean-slate rewrite was
> considered and rejected. Everything below still holds unchanged — read this doc first, then the
> goal layout for the order of attack.

> **Consolidated 2026-07-30 (second pass).** This doc originated in an app-shell-focused session
> that framed the Oura rollup as an unplanned gap needing its own future plan. That was wrong — a
> parallel, much deeper effort (the **Oura on-device + own-analysis program**, D0–D7, planned
> 2026-07-21) already covers exactly this migration, in more depth than a fresh plan would produce,
> and is ~40% shipped. The "Oura rollup" section below is corrected to point at it instead of
> asking for a new plan. See `docs/oura-ondevice-hybrid-handover.md` for the full picture.

## The target, in the owner's words

> "App works fully offline (besides AI calls and older data if needed). Railway would just be used
> for the DB to store calculated data i.e. day rollups etc."

Read precisely, that is **not** "delete Railway". It is:

- **The device is self-sufficient for everything you do day to day.** Opening the app, logging a
  workout, seeing today's and recent sleep/readiness/activity, and the calculations behind them all
  work with the network off.
- **Railway keeps the DB**, holding *calculated* data — day rollups and similar — as durable storage,
  cross-device sync, and backup. It stops being a thing the app *waits on* to render.
- **Two sanctioned exceptions:** AI calls (chat, insights, digests) and **older/archival data** fetched
  on demand. Neither needs to work offline.

This matters because it settles a question that has been ambiguous: the goal is **independence from
the server at render time**, not the removal of the server. Cross-device sync and backup survive.

**This is also the same north star the Oura on-device program already committed to independently**
(2026-07-21, owner-directed): "make the app device-primary... Railway holds only a compact
finished-form backup that never computes." The two directives describe one destination reached from
two different starting conversations — treat them as the same requirement, not two.

## What already holds

The write path is done and should not be re-litigated:

- The on-device SQLite store (`lib/local-store/`) is the source of truth for writes; the mutation
  outbox syncs to Postgres (`pushMutations` in `lib/data/postgres/adapter.ts`).
- Most single-domain reads are already local-first — activity, mood, body metrics, injuries, food,
  supplements. See the read-site status in `CLAUDE.md`'s Offline-First section.
- **The Oura biometric pipeline is already ~40% migrated** — see below. This is further along than
  any other gap in this document.

## What does not hold yet

Each of these renders from the server today, so the screen is blank or stale with the network off.

| Gap | Where | Note |
|---|---|---|
| **The Oura BLE rollup** | `aggregateOuraRawSamples`, `lib/data/postgres/adapter.ts:4658–~5764` (**~1,100 lines**) | Already has a detailed, in-progress plan — see below, not "needs one" |
| Cross-session aggregates | `app/api/{weekly-stats,weekly-muscle-sets,weights-summary,muscle-recovery}/route.ts` | Server-computed *by design* today; each needs an on-device implementation or a stored rollup. **Not yet planned.** |
| The day timeline | `app/api/day-timeline/route.ts` | Sanctioned server-only exception today (session 287, SYNC-R3) — a cross-domain server-assembled aggregate. **Not yet planned.** |
| The app shell itself | `capacitor.config.ts` `server.url` | The WebView loads the Railway URL, so even the UI is a network fetch. This is Phase 3 (Q-1) — Task 4 decided (option B), workspace-split plan written 2026-07-30 |
| Auth | `middleware.ts`, `auth.ts` | Server-gated. Phase 3 Task 3 moves it client-side with a bearer token — PR #932 (a related but distinct fix, the 24h deactivation re-read) is open; Task 3 itself is queued after the workspace split |

**Phase 3 is step one and it is necessary, but it is not sufficient.** Bundling the shell stops the
*UI* being fetched; the *data* still comes from Railway afterwards. An app that boots instantly and
then waits on the network has not met the target.

## The Oura rollup — already planned and in progress, not a gap to plan from scratch

**Corrected 2026-07-30.** `aggregateOuraRawSamples` turns raw BLE ring samples into sleep sessions,
readiness, activity, nightly temperature, HRV/RHR baselines and chronic-stress signals. It runs only
on the server today, against Postgres — but migrating it on-device is the entire subject of the
**Oura on-device + own-analysis program** (owner-directed 2026-07-21), a seven-phase plan (D0–D7)
that is already sequenced, adversarially reviewed four times, and partly shipped:

- **Done and on `main`:** D0 (step_counter as primary steps), D1 (the full six-form durability/sync
  chain — server push + pull + client apply for every finished form, plus a full-history restore
  driver), D5 (own daytime-HRV, replacing an Oura ONNX model), D6 (Polar H10 comparison harness), and
  D2 Tasks 1–3 (local-store accessors + the native `oura_raw.db` raw store + its WebView bridge,
  built and sandbox-verified 2026-07-27).
- **✅ That blocking gate CLEARED 2026-07-30.** The owner ran the on-device pass: a Full re-sync
  drained 694 batches clean (`bytesLeft=0`), and a force-stop mid-drain resumed with no gaps, no
  repeats, no errors. D2 Tasks 4–9, D3, D4 and D7 are unblocked. Task 4 (clock anchor) merged as
  **#953**; **Task 5 is the active work**. Two sub-checks (`getUnrolledRaw`/`markRolledUp`,
  `rawStoreOpen`/`lowDisk`) have no admin UI and were *inferred* passing from the drain log —
  see backlog Q-33.
- **The plan already settles every question a fresh plan would need to answer:** which derivations
  run on-device vs stay server-side for backfill (D2 Task list + the keep/cull/calculate matrix);
  how a device-computed rollup and a server-computed one reconcile without becoming two
  implementations of the same metric (D3's single-writer flip — the server rollup is explicitly
  demoted to reader once the device rollup is proven, `COALESCE(EXCLUDED,existing)` first-writer-wins
  is called out as a divergence-masking hazard to avoid); where shared derivation code lives (already
  factored into `lib/health/*`, consumed by both today's server rollup and the eventual device one);
  and the archival-hex constraint (`oura_raw_samples.body_hex` never pruned/mutated until D4's
  owner-confirmed, gate-enforced cutover, which also rewrites that CLAUDE.md rule in the same PR).

Read `docs/oura-ondevice-hybrid-handover.md` (planning baton) →
`docs/oura-ondevice-hybrid-implementer-progress.md` (live state, exact next tasks) →
`docs/superpowers/plans/2026-07-21-oura-ondevice-hybrid-master-plan.md` (the D0–D7 plan, read its
Review Outcome block first) before touching any of this. Do not write a second plan for it.

**Cross-reference correction found in this pass:** the DB-volume cleanup (Q-30,
`docs/db-volume-cleanup-handover.md`) recommends a `body_hex` TEXT→bytea migration as the first
structural fix. The Oura on-device master plan's own owner-decision table (§3, O1) already
addresses this exact column: **"Server raw: drop-after-pull (D4) vs `bytea` migration — mutually
exclusive. Recommendation: drop (raw belongs on device); bytea only if D4 slips."** The two docs
were written by different sessions eleven days apart and never cross-referenced each other. This is
not yet resolved — see the backlog Q-30 entry for the current state of that tension.

## Sequencing

> **🆕 Amended 2026-08-02 — the public repo cut (Q-49) now comes first.** It is not part of *this*
> doc's data-layer question, but it re-orders the list below: the private repo's daily cost (the
> `apk-latest` URL 404s unauthenticated; a second user cannot install; metered CI) outweighs the
> sequencing preference that put it last, and cutting it now means Stages 5–7's native work never has
> to migrate repositories. Item 2 below (the Oura on-device program) is **unaffected and continues in
> parallel** — it is the item that actually makes the app render without the network. See
> [`superpowers/plans/2026-08-02-public-repo-migration-roadmap.md`](superpowers/plans/2026-08-02-public-repo-migration-roadmap.md).

1. **Phase 3 — bundle the shell** (Q-1). Decided: option B, two apps in a workspace. Workspace-split
   plan written 2026-07-30
   ([`docs/superpowers/plans/2026-07-30-phase-3-workspace-split.md`](superpowers/plans/2026-07-30-phase-3-workspace-split.md)).
   Nothing else in this document can start until the shell runs without the server, but the Oura
   on-device program below is independent of it and already unblocked on its own track.
2. **The Oura on-device program (D0–D7).** In progress since 2026-07-21, ~40% shipped. Currently
   blocked on one owner action (on-device APK verification of D2 Tasks 2–3). This is the largest
   single piece of the offline-first direction and does not need a new plan — it needs the owner's
   S25 verification pass to unblock the next several tasks.
3. **The remaining server-computed aggregates** (weekly-stats, weekly-muscle-sets, weights-summary,
   muscle-recovery, day-timeline). Each is small next to (2) and can be taken independently once the
   pattern from (2) exists. **Not yet planned — no backlog entry exists for these specifically.**

## Open questions for the owner

**All three were answered on 2026-08-02** — recorded in full, with the measured basis, in
[`docs/superpowers/plans/2026-08-02-native-convergence-goal-layout.md`](superpowers/plans/2026-08-02-native-convergence-goal-layout.md)
§4 Stage 1 and §8. In brief:

- **Backup and cross-device.** **Both permanent.** The owner may run more than one phone over time,
  and other users (friends) have their own accounts. Railway stays a **full sync peer**, not a
  write-only backup. The sync engine is maintained and extended — nothing in it retires. *(An
  initial "S25 only" answer was recorded here and corrected the same day; the conclusion that peer
  conflict resolution could retire is withdrawn.)* The D1 restore-proof check, unrun since #758, is
  a routine path under multi-device, not a rare one.
- **How much history must be local?** **Tiered**, because one table is ~97% of the volume:
  raw BLE frames **14 days** (~45 MB), decoded per-minute HR **1 year** (~38 MB), daily rollups and
  all logs **uncapped** (~2 MB/yr). ~85–100 MB total — cheaper than a uniform 90-day window, and a
  full year of everything the UI queries.
- **The D2 on-device verification pass** — ✅ **done 2026-07-30**, see above.
