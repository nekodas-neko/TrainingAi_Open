# 🚧 Implementation Agent (A) — baton

> **Successor sessions are titled `🚧 Implementation Agent (A) 🟢`** — exactly, emoji included. The title
> is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a
> perfect baton.

**Updated:** 2026-08-24 · **By:** the seventh session to run as Lane A · **Next ID:** `LA-22`
(`grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line)
**Migrations:** through 209; next free is **210**. Local SQLite **v28**, untouched this session.

## Now

**Nothing is in flight.** Every branch this session opened is merged. Start with
`node scripts/next-item.js --lane A` — not a hand-scan; the tool is the only thing that can tell you
whether the top entry is *startable*.

Narrative for the fifteen PRs, with the wrong turns:
[`docs/handoff-2026-08-24-platform-implementation-lane-a-engine-run.md`](../../handoff-2026-08-24-platform-implementation-lane-a-engine-run.md).

**The queue is no longer thin.** The previous baton's three-item blockage is resolved: LA-16 and
Q-324 closed, Q-555 still needs a device check and still must not be built blind. The Orchestrator's
first sweep (2026-08-24) re-classified lanes and cleared the completed-work baseline, so the tool's
output is now trustworthy in a way it was not two sessions ago.

## The habit that has now paid on ten consecutive entries

**Re-verify an entry's premise against current `main` before building it, and write down what you
checked.** It changed the work on four of six entries last session and on two of this one:

| entry | what it said | what was true |
|---|---|---|
| **Q-298** | three queries let a deload's zero become the previous 1RM | two already filtered `> 0`; the leak was the **third**, `listPrevious1rm`, gating on `IS NOT NULL` |
| **LA-21** | *(my own filing)* not a live corruption | production held **11 of 81 (13.6%)** at 534–845 min, with an empty gap from 92 min |

## Shipped

#345 Q-313 · #351 Q-456 · #356 LB-7 filing (**diagnosis wrong** — see below) · #360 Q-541 Task 6 ·
#362 + #378 Q-464 batches 2–3 · #363 Q-312 · #364 backlog-resurrection check · #365 BF-4 +
`payload_bytes` (migrations 208, 209) · #368 Q-420 · #371 LA-21 measured · #372 LA-21 cull ·
#374 LA-21 session-start ladder · #381 journal compaction (57 entries) · #385 Q-298.

## Standing constraints

- **The local gate is `pnpm check:rules`** — quote its `Ran N of N`, never the word "pass". It is
  **51 of 51** now. Do not hardcode it; the runner reads the count from `ci.yml`.
- **The clone is depth 1.** `git fetch --deepen=200 origin main` before any `git merge origin/main`,
  or it refuses as "unrelated histories". This cost several rounds before it was internalised.
- **`get_check_runs` is unreliable in both directions.** `total_count: 0` right after a push is
  **registration lag**, not a stale base — tell them apart by checking whether `origin/main` is an
  ancestor of your head. It also reports `in_progress` 16–30 min after a job passed. **Attempting the
  merge is the authoritative check.**
- **Green CI is not proof a CI-only path ran.** When the change *is* the CI behaviour, read the log.
- **Fixture MET constants now clear the floor (Q-312, #363).** `met_easy: 2, met_moderate: 4,
  met_hard: 6`, all above `estWorkoutKcal`'s 1.5. The previous baton's standing "every MET strength
  estimate is 0 under fixtures" trap is **retired** — a fixture-MET test is no longer vacuous, and
  the vacuity guards written for it can go when touched.
- **Nothing ran on the S25 for two sessions.** Anything touching offline-first, native, safe-area,
  gestures or notifications needs the device smoke run or an explicit Known-Issues row.

## Traps this session walked into, so you do not

- **A diagnosis reached from a config file is a guess.** I read `playwright.config.ts`
  (`workers: 1, fullyParallel: false`) and concluded LB-7 was accumulated suite state. Lane B found
  the real cause: `public/sw-template.js` re-issues **every** `/api/` request with no method filter,
  so once the service worker controls the page, `page.route` is bypassed — Playwright cannot
  intercept SW fetches. Fix is `test.use({ serviceWorkers: 'block' })`.
- **A severity claim from the local seed is not a severity claim.** LA-21 was filed "not a live
  corruption" from a dev fixture; production was 13.6%. Query production before writing severity.
- **A number justified in prose inside your own diff is not a measured number.** My autopack cap
  shipped at 8 with a comment asserting "2.8× the production rate"; it was 1.4×, ~12 days to clear
  the backlog. The measured figure (0.32 s/bucket) put it at 25.
- **Never slice a generated file by string index.** A header edit cut ~1,400 lines off migration 209
  because `s.index('DO $')` matched the grant block. Regenerate and prepend.
- **Commit, then push, then switch branches.** A commit was dropped on #374 by switching after
  committing; `git status` was clean and said nothing. Reading the PR's commit count found it.
- **Journal compaction has five traps, three new this session**, now in
  `docs/overview/entries/README.md`. Worst: **a concurrent PR can link an entry you already folded.**
  Three became cited by the Orchestrator's handoff mid-sweep and git surfaced only the one it also
  modified — two would have gone unnoticed (60 → 57 folded).
- **A stale remote branch from an earlier sweep is not yours to force-push.** Date the new one.
- **Inherited and still true:** `git reset --soft origin/main` does **not** merge — diff
  `--name-only` against `origin/main` before every push. A rebase replays conflict resolutions as new
  content; rebuild a shared doc from `origin/main` instead of replaying the hunk. `git checkout --`
  after a mutation test discards uncommitted work. A count that moves further than your change
  explains is the bug. Extracting a helper for testability without switching the caller over is
  worse than not extracting it. `psql -tAc` output carries a trailing newline; `fmtAest` strings do
  not sort.

## The database reclaim — half done, at last

| Step | Worth | State |
|---|---|---|
| Migration **193** drops `idx_oura_raw_samples_user_measured` | **136 MB** | ✅ landed |
| Pack the raw frames (Q-541) | **~630 MB** | ✅ **automatic now** (#360) and observed: 318,883 → 205,278 rows, 764 → 864 buckets, 0 faults |
| `VACUUM FULL oura_raw_samples` | **36 MB** | ✅ owner pressed it 2026-08-24 — 93 MB → **57 MB** (heap 44→28, idx 49→29) |
| `VACUUM FULL error_events` (Q-315) | **~49 MB** | ⛔ **still needs one press** |

Q-315 is the only piece left and there is **no button for it** — the admin UI's vacuum control
covers `oura_raw_samples`. It needs `POST /api/admin/vacuum {"table":"error_events"}` with an admin
session cookie. A sandbox session cannot authenticate to production. **Do not add a bearer path to
that route without an explicit yes — it is an auth change.** Runbook:
[`docs/handoff-2026-08-18-platform-database-reclaim.md`](../../handoff-2026-08-18-platform-database-reclaim.md).

## Waiting on the owner

- **Q-422** is Tuning-originated: *Tuning proposes → owner signs off → Lane A implements*. Not yours
  to start. (**Q-420 shipped** in #368 — the scale-mapping question it was blocked on is answered by
  `sessionEffort()` returning `{ rpe, source }`, so a derived value is never read as a self-report.)
- **Q-388 SpO₂ is not a code question and should not be built.** All 14 production days carry SpO₂
  frames (673–10,588/day). No baseline exists because `enableMeasurementSequence()` sets it AUTOMATIC
  on **every** connect; the missing datum is one night *without* it, which needs a Kotlin change and
  a new APK.
- Two Sentry checks on-device; a Railway-dashboard reading for **Q-549**.
- Device checks owed and accumulating: **Q-400** (also decides Q-411), **Q-413**, **Q-412**,
  **Q-405**, **Q-310**, plus everything shipped in the last two sessions.

## Claimed paths

- `scripts/lib/` (`base-ref.js`, `lane.js`), `lib/media/`,
  `android/app/src/main/java/com/trainingai/app/media/`, `lib/net/safe-fetch.ts`,
  `app/api/admin/vacuum/`, `app/api/oura-ble/rekey/`,
  `lib/data/postgres/slices/oura-raw-{frames,pack}.ts` — Lane A's.
- New this session: `packages/shared/src/workout/derive-session-rpe.ts`,
  `packages/shared/src/health/workout-energy.ts` (`isPlausibleSessionDuration` — **the** copy; three
  divergent ones were consolidated into it, so do not add a fourth).
- `components/nutrition/meal-label-*` is **Lane B's** — hand it back.

## Findings, so they are not re-derived

*Inherited on its fourth baton, and still recorded nowhere else. **Move the Oura half to
[`docs/oura-ble-operations.md`](../../oura-ble-operations.md) rather than carrying it a fifth time.***

- **Raw frames:** read only via `slices/oura-raw-frames.ts` (a hot-only read silently returns 7 days);
  an aggregate cannot use its dedupe — anti-join on `(epoch, tag, ds_bucket)`.
  `oura_raw_samples.measured_at` and `event_name` are **dead columns**, owner-gated to drop. A ds
  regression is **not** a ring-clock reset (Q-314) — a re-drain makes one. The packer's phase-3
  delete goes by **row id**, never by the bucket's ds range: a frame arriving between the select and
  the delete was previously removed having never been packed, i.e. in neither tier.
- **Security:** the `VACUUM FULL` allowlist is a boundary, not validation — `hasOwnProperty`, never
  `in`. **DNS rebinding is NOT closed in `fetchPublicUrl`**: the address is validated, then the
  hostname is connected to by name; closing it needs a pinned-IP connect undici does not expose.
- **`claude_ro` needs no manual step.** Views scope on
  `current_setting('app.claude_ro_owner', true)`, set at boot by `bootstrapClaudeRoOwner()` — no
  `ALTER ROLE`. Verified in production: setting configured, 85 views, rows returned. It is
  **row-scoped to one user**, so every count from `/api/admin/db-query` is *the owner's* — write
  findings as "none of the owner's", never "nothing is failing".
- **Sandbox limits:** `computeActiveEnergy` cannot run here via a complete-profile `energy-balance`
  request (a vendored constants file object storage will not serve) — true on `main` too. A stale
  local DB looks like a code defect: `setup.sh` will not re-seed a non-empty one, drop
  `/var/lib/postgresql/local-dev`. `npx next lint` is **not** `pnpm lint`. Drizzle will not marshal a
  JS array into `unnest(...)` in a raw `sql` template.
