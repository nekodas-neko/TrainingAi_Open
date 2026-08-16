# Goal Layout — Native Convergence

_Owner-directed, 2026-08-02. This states the **destination and the order of attack**. It is not an
implementation plan — individual stages have (or get) their own plans in
`docs/superpowers/plans/` and their own backlog entries._

> **Relationship to existing docs.** This does **not** replace
> [`docs/offline-first-target-architecture.md`](../../offline-first-target-architecture.md) (owner
> directive, 2026-07-30) — it extends it. That doc settled *where the data lives* (device-primary,
> Railway as finished-form backup). This one settles *where the UI eventually lives* (native), and
> folds the public-repo cut (Q-32) into a single ordering. Everything that doc says about the data
> layer still holds and is not re-litigated here.

---

## 1. The destination

A single-user Android app on the S25 Ultra that:

- **Renders without the network.** Opening the app, logging a workout, and seeing today's and recent
  sleep/readiness/activity all work with the radio off. (Sanctioned exceptions, unchanged from the
  2026-07-30 directive: AI calls, and older/archival data fetched on demand.)
- **Owns its data natively.** The on-device store, the sync engine, and the BLE pipeline are native
  Kotlin. Railway keeps the Postgres DB for durable storage, cross-device sync and backup — it stops
  being something the app *waits on* to render.
- **Renders natively where it matters.** The screens touched daily are Jetpack Compose reading the
  local DB reactively. Low-frequency screens may remain WebView indefinitely — that is a deliberate
  endpoint, not an unfinished migration.
- **Lives in a clean public repo** with no vendored proprietary weights and no history carrying them.

The through-line: **the local database schema is the spine.** It outlives every UI layer this app
will ever have. Investment there compounds; investment in any given render layer does not.

---

## 2. Decision record — why converge incrementally, not rewrite

Recorded so it is not re-litigated. A full clean-slate rewrite (fresh repo, Kotlin/Compose/Room from
zero) was seriously considered on 2026-08-02 and rejected on scope, not on principle.

**Measured scope of what a big-bang rewrite would re-derive:**

| Surface | Size (measured 2026-08-02) |
|---|---|
| `app/` + `components/` + `lib/` TS/TSX, excl. tests | **111,893 lines** |
| Screens (`page.tsx`) | **38** (40 as of 2026-08-02 — a measured figure that drifts; the argument is unaffected) |
| Component files | **337** (`components/`, 50,483 lines) |
| API routes | **199** `route.ts` |
| Local store (`lib/local-store/`) | **~4,500 lines**, 37 local tables (`sqlite-backend.ts` alone is 2,557) |
| Full sync subsystem (store + engine + cache groups + adapter slice) | **~8,200 lines**, 18 outbox domains, 11 sync-domain flags, 29 cache-invalidation groups across 47 importing files |
| Oura BLE Kotlin | **~2,100 lines** (2,375 with tests) |

**Why the rewrite was rejected:**

- The scope above is a solo multi-month-to-year project whose dominant risk is *stalling*, not
  failing. Every stage below ships a working app instead.
- The offline-first architecture — the genuinely expensive, hard-to-get-right part, and the thing
  that actually makes MyFitnessPal/Garmin-class apps feel fast — **is already built and hardened
  against real production incidents** (queue wedging #47/#74/#82, cursor pagination, epoch drift).
  A rewrite re-derives it; convergence keeps it and ports it in place.
- The Oura BLE module is already clean native Kotlin: only `OuraBlePlugin.kt` (316 lines) touches
  Capacitor at all. It is unaffected under *every* option, so it should carry zero weight in the
  decision — and it is untouched by every stage below.
- The two pieces of Phase 3 that look like "hybrid work" — splitting `api/` from the shell, and
  moving auth to a client-held bearer token — are **preconditions for a native client too.** A
  Kotlin app cannot consume server-side `auth()` in RSCs. This work is shared trunk, not a fork.

**What would change this call:** if the app's target surface shrinks drastically (38 screens → ~10).
Rewriting 10 screens natively is a different project from rewriting 38.

**Owner answer, 2026-08-02: the app keeps all ~38 screens** — "as far as I am aware we need every
screen we have". The condition that would re-open this decision therefore does not hold, and §2 is
settled. Do not re-litigate it without a new owner directive.

**Corroborating evidence found 2026-08-02 (after this section was first written):** the largest
mechanical piece of the convergence — extracting the isomorphic code into `@trainingai/shared` —
**already succeeded and is live on `main`** (#939, #941): 348 files, 36,450 lines, imported by 492
files, under a real `pnpm-workspace.yaml`. #962 reverted **only** #952's `shell/` + `api/` split, not
the shared-package extraction. The convergence path is not hypothetical — its bulkiest step is done
and has been running in production for days.

---

## 3. Owner gates

| Gate | What it is | Blocks | Status |
|---|---|---|---|
| **Gate A — provision `api/` on Railway** | Stand up a second Railway service for the `api/` app, confirm it serves `/api/**`, set `API_ORIGIN` in `shell/`'s environment. The workspace-split code is already written and tested; PR #952 broke production purely because this service did not exist (the `/api/*` rewrite fell back to `localhost:3001`) and was reverted in #962. | Stage 2 (Q-1 / Phase 3) and everything after it | **OPEN.** No repo-side trace of provisioning: no `railway.json`/`railway.toml`, no service split in `nixpacks.toml`, and `API_ORIGIN` appears only in prose describing the blocker. |
| **Gate B — D2 on-device verification** | Sideload the APK, drain the ring, confirm `rawStats()` counts, force-stop mid-drain and confirm the tail re-drains with no loss/dupes, confirm `rawStoreOpen: true`. | D2 Tasks 4–9, D3, D4 | **CLEARED 2026-07-30.** Full re-sync drained 694 batches (`bytesLeft=0`); force-stop mid-drain resumed cleanly with a monotonic cursor, no gaps, no repeats. Recorded in `projectOverview.md`, backlog Q-29 and `docs/oura-ondevice-hybrid-implementer-progress.md`. |

> **Gate B caveat — two sub-checks were inferred, not observed.** The admin console exposes no UI for
> `rawStats()`/`getUnrolledRaw()`/`markRolledUp()` or for `rawStoreOpen`/`lowDisk` (filed as Q-33).
> They were reasoned to be passing because an unopenable raw store falls back silently to the old
> server-gated cursor, which could not have produced the observed "batch committed locally" lines.
> That inference is sound but it is an inference — treat it as such if a raw-store bug surfaces.

Gate A is the only gate still blocking. It is not engineering work and unblocks Stage 2 plus
everything after it.

---

## 4. The order of attack

> **🆕 OWNER-APPROVED SEQUENCE, 2026-08-02.** The owner clarified where the app actually feels slow
> — *"it's not the workout screen that needs the native feel for me, it's the home screen and
> switching tabs and navigating through the app"* — and approved this order. It supersedes the
> stage numbering below wherever the two disagree.
>
> | # | What | Why here |
> |---|---|---|
> | 1 | **Q-51** — split the home component, prefetch tab chunks, **then profile cold start on the S25** | The owner's stated pain, and none of it needs an architecture decision |
> | 2 | **Q-49** — public repo migration | Daily distribution cost; Phase A0 shipped 2026-08-02 (#1015) |
> | 3 | **Stage 3** — device-primary data | Already active; the largest remaining "feels instant" win |
> | 4 | **Measure again, and decide** | The decision point this plan has repeatedly deferred |
> | 5 | **Stage 5** — native data layer | Justified on background sync alone; also what a watch companion would need |
> | 6 | **Stage 2 (Phase 3)** — *conditional* | Only if Q-51's profile shows the shell, not bundle parse/execute, is the residual gap |
> | 7 | **Stage 6** — Compose screens — *conditional* | Only if 1–5 did not close it. **Home first, not the workout screen** |
>
> **Two corrections to §4 and §6 below that this ordering encodes:**
> 1. **Stage 6's "session select (1,407)" is the Home tab.** `components/shell/tab-shell.tsx:97`
>    renders `SessionSelectContent` for the `home` key. Listing it by filename hid that it is the
>    most-touched screen in the app, which is why the workout screen was ranked above it. By Stage
>    6's own criterion — highest daily touch — home comes first.
> 2. **Phase 3 is no longer the gate everything queues behind.** It is measurement-gated (see the
>    Q-1 backlog entry). Not cancelled, not downgraded — waiting on evidence.

### Stage 0 — Clear the owner gates
Gate B is cleared. **Gate A remains** and still blocks Stage 2 onward. Stage 1 and Stage 3 do not
depend on it and can proceed in parallel.

### Stage 1 — Fix the schema standard (the spine)
Lock the Postgres **and** local SQLite schemas to the new standard before any repo cut or UI work.
This is the highest-compounding investment in the whole plan: it is the one artefact that survives
every subsequent stage unchanged.

Both open questions were answered by the owner on 2026-08-02.

#### 1a. Local retention — tiered, not a single window

Measured against production on 2026-08-02 (`/api/admin/db-query`, owner-scoped `claude_ro` views),
steady-state daily rates:

| Table | Rows/day | Bytes/day |
|---|---:|---:|
| `oura_raw_samples` (raw BLE frames) | ~25,200 | **3.2 MB** |
| `oura_heartrate` (decoded per-minute) | ~900 (range 240–2,900) | ~78 KB |
| All other device-local tables combined | ~20 | ~4 KB |

**One table is ~97% of the volume.** A naive uniform window is therefore the wrong shape:

| Window | Excluding raw samples | Including raw samples |
|---|---:|---:|
| 90 days | ~7 MB (≈14 MB with indexes) | ~295 MB |
| 1 year | ~30 MB (≈55 MB with indexes) | **~1.2 GB** |

**Decision — three tiers:**

| Tier | Data | Retention | Steady-state size |
|---|---|---|---:|
| 1 | `oura_raw_samples` (raw BLE frames) | **14-day rolling buffer** | ~45 MB |
| 2 | `oura_heartrate` (decoded per-minute) | **1 year** | ~38 MB |
| 3 | Daily rollups + all logs (sleep, workouts, sets, food, body, mood, activity) | **Full history, uncapped** | ~2 MB/year |

Total steady state **~85–100 MB** — negligible on the S25, and *cheaper than a uniform 90-day
window* while delivering a full year of everything the UI actually queries (year-review, seasonal
trends, all baseline math) offline.

Tier 1 is short **because it can be**: `oura_raw_samples.body_hex` is the permanent archival source
of truth **on the server** and is never pruned (per `CLAUDE.md`), and protocol fixes back-fill by
re-decoding stored hex server-side. The device needs raw frames only as transient input to its own
rollup. Retaining a year of them locally would cost 1.2 GB and buy nothing.

> **Constraint this places on Stage 3/D2.** The device-side rollup must be able to run, push, and
> then *release* raw frames within the 14-day window. A rollup that silently falls behind turns
> Tier 1 into unbounded growth — the local pruner and the "unrolled raw" backlog need a bound and a
> visible failure state, not a best-effort sweep.

#### 1b. Sync posture — multi-user and multi-device are permanent; the sync engine stays

**Owner answer (2026-08-02, corrected same day): cross-device sync and multi-user are both
permanent requirements.** The owner may run more than one phone over time, and other people —
friends — can and do create accounts. Railway is therefore a **full peer in a sync relationship**,
not a write-only backup target.

> **This reverses an earlier reading in this same document.** An initial answer of "I will only ever
> use the S25" was recorded as *single-device, permanently*, and the conclusion drawn was that
> cross-device conflict resolution and peer delta reconciliation could retire. **That conclusion was
> wrong and is withdrawn.** "One phone at a time" is not "one device ever" — a replaced handset, a
> second device, and other users all require the same machinery. Nothing in the ~8,200-line sync
> subsystem is retired on these grounds.

Consequences that hold:

- **The sync engine is maintained and extended, not reduced.** Outbox domains, cursor pagination,
  poison-pill quarantine, the pull-clobber gates, and per-user scoping on every UPDATE/DELETE all
  stay load-bearing. The `pushMutations`-mirrors-the-web-route rule in `CLAUDE.md` stays a hard
  invariant, not a transitional one.
- **Multi-user is already the status quo, not new work.** `users`, `invited_emails` and
  `friendships` exist and every write path is already user-scoped. The requirement here is to *not
  regress* it — in particular, Stage 5's native rewrite of the local store must carry the
  `user_id` scoping and ownership pre-checks forward, since a native port is exactly where an
  unscoped query would slip back in.
- **Per-device local state must stay per-device.** Retention tiers (§1a) are a *local cache* policy,
  not a statement about what exists. A device holding 14 days of raw frames and a year of HR must
  never let that horizon leak into a server-side delete or a sync decision — pruning is local-only.
- **The restore path needs a test regardless.** The D1 restore-proof check ("Restore from cloud")
  has been ready since #758 and has never been run. Under multi-device it is not a rare
  disaster-recovery path but a routine one.

### Stage 2 — Land Phase 3 (Q-1): shell bundled, API split, auth client-side
Unblocked by Gate A. The code exists. Re-merge the workspace split onto the provisioned service.

Exit criteria: the APK boots and renders its shell with the radio off; `/api/**` served from the
`api/` service; auth is a client-held bearer token; `middleware.ts` route protection replaced by a
**default-deny** client gate (per Task 2b's three load-bearing corrections — a naive "is there a
session" check lets deactivated users into every screen).

> Phase 3 is necessary but **not sufficient**. It stops the *UI* being fetched; the *data* still
> comes from Railway afterwards. An app that boots instantly and then waits on the network has not
> met the target. That is Stage 3.

### Stage 3 — Finish device-primary data (Oura D0–D7 + the remaining aggregates)
Unblocked by Gate B. This is the existing, already-sequenced, four-times-reviewed program — it does
not need a new plan, it needs its verification pass. Continue D2 Tasks 4–9 → D3 (read-flip to
local-first) → D4.

Then the aggregates the 2026-07-30 doc lists as **not yet planned** (no backlog entry exists for
these — one should be created): `weekly-stats`, `weekly-muscle-sets`, `weights-summary`,
`muscle-recovery`, and the `day-timeline` sanctioned exception. Each is small next to D0–D7 and can
be taken independently once D2's pattern exists.

### Stage 4 — Cut the clean public repo (Q-49)

> **🆕 RESEQUENCED 2026-08-02 — this stage moved to the front, and its blocker changed.** The owner
> reported that the private repo has a running daily cost the roadmap never weighed: the `apk-latest`
> release URL 404s unauthenticated, so `/api/download-apk` plus a PAT is the only distribution path
> and a second user cannot install without it; Actions minutes are metered. The Stages 2–3 gate was a
> 2026-07-30 sequencing preference, not a dependency, and **it is released**.
>
> The real blocker is not Q-1 — it is that the models #999 says to gitignore run **server-side on
> Railway**, which deploys from git, behind loaders that return `null` on failure. Gitignore alone
> silently kills the hypnogram and ring steps. **Owner chose a build-time fetch from private
> storage**, which is also what the eventual WASM path needs. Plan:
> [`2026-08-02-public-repo-migration-roadmap.md`](2026-08-02-public-repo-migration-roadmap.md),
> backlog **Q-49**. Triage of *what* to replace/gitignore/delete:
> [`2026-08-02-oura-ip-triage.md`](2026-08-02-oura-ip-triage.md) (#999).
>
> **New position: after Stage 1, in parallel with Stage 3, before Stage 2.** The argument is that the
> big native work (Stages 5–7) should happen in the repository you are going to keep — cutting after
> Stage 6 means migrating mid-flight; cutting now means it never has to move. **One repo, not two:**
> Stages 6–7 ship Compose and WebView screens in the same APK, so a separate "native repo" would
> force the clean-slate rewrite §2 rejected.

Mechanics are specified in Q-49's plan and Q-32's notes — not restated here, but the load-bearing
points:

- A **fresh, history-free snapshot**, not a `git filter-repo` scrub (too easy to miss a trace of
  vendored weights across ~900 commits).
- Q-31 first: replace the two live imports of Oura's extracted proprietary constants
  (`lib/health/stress-resilience.ts`, `lib/health/workout-energy.ts`) with independently-derived,
  *calibrated-not-copied* values, so the vendored tree can be **deleted** rather than merely excluded.
- Exclude `lib/oura-models/` + `scripts/oura-models/`; gitignore (don't delete) SleepNet/`step_counter`
  assets; strip model-provenance comments even for gitignored files; rewrite the BLE-protocol docs in
  our own words; fix `lib/data/postgres/migrations/006_admin_flag.sql` (hardcodes the owner's real
  email); delete the orphaned `docs/preserve-pt-originals-and-goldens` branch (52 MB of raw decrypted
  `.pt` originals, unmerged).
- **Archive the old repo private — do not delete it.** The documentation system references PR and
  session numbers throughout (`CLAUDE.md` alone cites #952, #962, sessions 104/165/271…); deleting
  the origin turns hundreds of those into dead links.
- **Rotate any credential that was ever committed and pushed**, independent of the snapshot. Purging
  history does not un-compromise a leaked secret.

### Stage 5 — Invert local-store ownership to native
Make the local store a **Kotlin/Room module** with the sync engine on **WorkManager**, exposed to the
WebView through a Capacitor plugin facade.

The pattern is already proven in this codebase: `OuraBlePlugin.kt` is a 316-line bridge over ~1,800
lines of pure native. Same shape, applied to the data layer. The sync design being ported is *already
framework-agnostic TypeScript* (zero React/Zustand imports in `sqlite-backend.ts`, `sync-engine.ts`,
`sync-helpers.ts`, or `packages/shared/`), so this is an algorithmic port, not a redesign.

After this stage the WebView is a client of a native data layer, and native screens can be added
without touching it.

### Stage 6 — Migrate screens to Compose by touch-frequency, highest first
Native Compose screens read Room directly and reactively; un-migrated WebView screens read the same
Room DB via the Stage 5 plugin. Both live in one APK.

Suggested order — highest daily touch and highest latency-sensitivity first:
1. **The workout screen** (`components/workout-screen.tsx`, 1,807 lines) — used mid-set, live timer
   and rest ring, where input latency is most felt, and already the biggest file in the repo.
2. Session select (1,407) → health (976) → config (997) / program editor (963).
3. Stop when it stops paying.

### Stage 7 — Stop deliberately
Admin, `year-review`, `stats`, `exercise-manager`, and other low-frequency screens stay WebView
indefinitely. This is the documented endpoint, not an unfinished migration — MyFitnessPal and Garmin
Connect both visibly ship webviews for low-frequency content for exactly this reason.

---

## 5. Preserved vs replaced

| Asset | Fate |
|---|---|
| Postgres schema / Drizzle / Railway backend | **Preserved** — stack-agnostic, unaffected by every stage |
| Oura BLE Kotlin (~2,100 lines) | **Preserved**, untouched. Only the 316-line Capacitor bridge is eventually replaced |
| Oura protocol knowledge (`oura-native-ble` skill, `docs/oura-ble-operations.md` 22-row failure matrix) | **Preserved** — the genuinely irreplaceable asset; survives every stage |
| Offline sync *design* (outbox, poison-pill quarantine, cursor pagination, invalidation groups) | **Preserved as design**; re-implemented in Kotlin/Room at Stage 5 |
| `lib/local-store/` TypeScript (~4,500 lines) | **Replaced** at Stage 5 by the native module |
| `components/sync-provider.tsx` (445 lines) + 47 `cache-groups` call sites | **Replaced** — React-specific glue, the only genuinely non-portable part |
| High-touch screens (workout, session-select, health) | **Replaced** at Stage 6 |
| Low-frequency screens (admin, stats, year-review) | **Preserved as WebView**, deliberately and indefinitely |
| Vendored Oura model weights (`lib/oura-models/`, `scripts/oura-models/`) | **Deleted** at Stage 4 |
| Git history (~900 commits) | **Archived private**, not carried into the public repo |

---

## 6. Invariants that hold throughout

These do not relax at any stage:

- **The schema is the contract.** When native and WebView screens disagree about everything else,
  they agree about data. Schema changes are the one thing that must stay coordinated.
- **One write path per domain** survives the native migration — the web route and the push branch
  calling one shared function (CI enforces this today via `scripts/check-push-mutations.js`; the
  native equivalent needs its own guard at Stage 5).
- **The device is the only real verification surface.** Green `pnpm dev` stays necessary and never
  sufficient. Every stage touching an offline-first domain, a native plugin, safe-area, gestures or
  notifications needs the on-device smoke run or an explicit Known-Issues row.
- **No stage may leave the app non-working.** If a stage cannot ship incrementally, it is scoped
  wrong — that constraint is what distinguishes this plan from the rejected rewrite.

---

## 7. Off-ramps

Deliberate decision points where the plan can legitimately stop or change:

- **After Stage 2 + 3:** the app boots and renders offline. If the residual "feels like a WebView"
  gap no longer bothers the owner in daily use, Stages 5–6 are optional. This is the honest
  measurement the rewrite decision was previously being made without.
- **After Stage 6.1 (the workout screen):** the first Compose screen answers empirically whether
  native rendering feels meaningfully better *on this app, on this device*. If it does not, stop —
  the native data layer from Stage 5 is still a win on its own.
- **If the target surface shrinks to ~10 screens:** re-open the clean-slate rewrite decision in §2.

---

## 8. Owner questions — answered 2026-08-02

| # | Question | Answer |
|---|---|---|
| 1 | How much history must be local? | **Tiered** — 14d raw BLE / 1y decoded HR / uncapped rollups+logs. See §4 Stage 1a for the measured basis. |
| 2 | Cross-device sync + backup permanent? | **Yes — both permanent.** Multiple phones over time, plus other users with their own accounts. The sync engine is maintained and extended, **not** reduced (§4 Stage 1b). An earlier "single-device" reading was recorded and withdrawn the same day. |
| 3 | New public repo name + GitHub account | **Still open.** Owner: "don't have this yet; will make when the new Railway is needed." Needed before Stage 4 only. |
| 4 | Keep ~38 screens or drastically fewer? | **Keep all ~38.** §2's rewrite decision is therefore settled, not conditional. |

Only #3 remains open, and it does not block Stages 1–3.

---

## 9. Order of attack, restated after the 2026-08-02 answers

The answers above change what is startable *now*, and de-serialise the plan — Gate A no longer
blocks everything, because Stages 1 and 3 do not depend on it.

| Stage | Startable now? | Why |
|---|---|---|
| **3 — device-primary data (Oura D2 T5 → D3 → D4)** | **Yes — this is the active work** | Gate B cleared 2026-07-30 |
| **1 — schema standard** | **Yes** | Both inputs now answered; independent of Gate A |
| ~~Sync-engine reduction~~ | **Withdrawn** | Was proposed off the single-device reading; multi-device + multi-user are permanent, so nothing retires (§1b) |
| **2 — Phase 3 shell/API split** | **No — blocked on Gate A** | Owner action, not engineering |
| **4 — public repo cut (Q-49)** | **Yes — resequenced to the front 2026-08-02** | Gates released; the blocker is now model *delivery*, which Phase A1 supplies. Repo home answered (same account, new public repo); name still chosen at Phase B |
| **5–7 — native data layer, Compose screens** | No | Downstream of 2–3 |

**Known risk carried into Stage 3:** D2 Task 4's `measured_at` clock-anchor output (#953) is
**not device-verified** — it compiles and its JVM tests pass, but there is no Robolectric coverage
of the SQLite path and no observed run against a real drain. Task 5 consumes those anchors, so its
fidelity tests can only prove *port parity against the server implementation*, not correctness
against real ring data. Both need an owner on-device pass before either is called done.
