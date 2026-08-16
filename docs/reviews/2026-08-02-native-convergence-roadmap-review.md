# Roadmap Review — does the plan actually end up with a native app?

_2026-08-02 · Domain: `platform` · Scope: the native-convergence roadmap and the docs that feed it,
reviewed against source on `main` (b7ecb15)._

**Documents reviewed:** [`superpowers/plans/2026-08-02-native-convergence-goal-layout.md`](../superpowers/plans/2026-08-02-native-convergence-goal-layout.md)
· [`offline-first-target-architecture.md`](../offline-first-target-architecture.md)
· [`device-agnostic-source-architecture.md`](../device-agnostic-source-architecture.md)
· [`implementation-backlog.md`](../implementation-backlog.md)
· [`handoff-2026-08-02-platform-batch-queue-drain.md`](../handoff-2026-08-02-platform-batch-queue-drain.md)
· [`handoff-phase-3-bundled-shell.md`](../handoff-phase-3-bundled-shell.md)
· [`public-launch-checklist.md`](../public-launch-checklist.md)
· [`planned_upgrades.md`](../planned_upgrades.md) · `projectOverview.md` · `CLAUDE.md`.

---

> **Update, same day — this review is superseded in two places by work that landed after it was
> written.** (1) **F6 and part of F1 are actioned**: the owner reported that the private repo has a
> running daily cost, and the public-repo cut was resequenced to the front with its Q-1/Q-30 gates
> released — see [`2026-08-02-public-repo-migration-roadmap.md`](../superpowers/plans/2026-08-02-public-repo-migration-roadmap.md)
> and backlog **Q-49**. (2) **The Q-31 correction below was independently reached and gone past by
> #999**, whose [`2026-08-02-oura-ip-triage.md`](../superpowers/plans/2026-08-02-oura-ip-triage.md)
> is the authority on the module-by-module verdicts. What this review contributed that survives is
> the *delivery* problem — those models run server-side, so gitignoring them silently kills the
> hypnogram — which is now Q-49 Phase A1. **F2, F3, F4, F5 and F7 stand unaddressed** and are tracked
> as backlog **Q-48** (renumbered from Q-46, which run-1 claimed the same day).

## Verdict

The roadmap converges on **a native-data Android app on the owner's device**. It does not currently
converge on **a shippable Android product**, which is what the 2026-08-02 device-agnostic directive
(other users today, Play Store intent) now asks for. Those are about one stage apart, and that stage
is unwritten.

The engineering spine is sound. Stages 1→7 are correctly ordered, each ships a working app, the
rewrite-vs-converge decision is argued from measurement rather than taste, and the expensive
mechanical step (`@trainingai/shared`) already landed. The gaps are at the edges: **how updates reach
a device after Stage 2**, **what "the schema standard" actually is**, **how the Kotlin sync port is
kept honest**, and **distribution/notifications**, none of which any stage owns.

Eight findings below, ordered by how much each one threatens the native endpoint.

---

## What is solid (not re-litigated below)

- **§2's decision record is the best artefact in the docs.** It measures what a rewrite would
  re-derive (111,893 lines, 199 routes, ~8,200 lines of sync), names the condition that would reverse
  the call (target surface shrinking to ~10 screens), gets that condition answered, and records the
  answer. That is how a decision stays decided.
- **The corroborating evidence is real, not hopeful.** `pnpm-workspace.yaml` and `packages/shared`
  exist on `main`; #962 reverted only the `shell/`+`api/` split. The bulkiest convergence step has
  been in production for days.
- **Gate B was cleared with evidence** (694 batches, `bytesLeft=0`, kill-mid-drain resume), and the
  two inferred sub-checks are labelled as inferences rather than passed off as observations.
- **Oura BLE Kotlin is genuinely unaffected by every stage** — one 316-line Capacitor bridge over
  ~1,800 lines of pure native. The plan is right to give it zero weight in the architecture decision.
- **§6's invariants and §7's off-ramps** are the two things most roadmaps of this size lack.

---

## F1 — Stage 2 fuses a permanent asset to a throwaway one, and the throwaway half is the expensive half

Phase 3 (Q-1) is two separable things:

| Piece | Fate under Stages 5–7 | Gated on | Cost |
|---|---|---|---|
| Split `api/` out; move auth to a client-held bearer token | **Permanent.** A Kotlin client cannot consume server-side `auth()` in an RSC — it needs exactly this. | Gate A (split), nothing (auth) | Task 3, ~21 sites |
| Static-export the shell and bundle it into the APK | **Dead** the moment a Compose screen replaces it. Stage 7 keeps some WebView screens, so partly live — but the *bundling* is only load-bearing for screens that never migrate. | Gate A | The half that broke production in #952 |

The goal layout makes this argument itself — "this work is shared trunk, not a fork" (§2) — and then
stages both halves as one unit in §4, so the durable half inherits the throwaway half's blocker.

Backlog Q-1 already records that Task 3 (client auth) is **unblocked** and needed under all three
Task-4 options. It is currently parked anyway, because the owner deferred "Phase 3" as a whole.

**Recommendation.** Split Q-1 into `Q-1a` (client-held bearer auth + an `apiUrl()` transport
abstraction — no Gate A, startable today, carried into a native client unchanged) and `Q-1b`
(workspace split + static export — Gate A, and worth re-costing once Stage 6's outcome is known).
This is the single cheapest way to make progress on the native endpoint while Phase 3 is deferred.

---

## F2 — Nothing says how a shell update reaches a device after Stage 2, and the assessment on record predates the answer that invalidates it

Today: JS/TS/server changes deploy to Railway and reach the APK with no rebuild — `capacitor.config.ts`
loads `https://trainingai-production.up.railway.app`, and its own comment says so.

After Stage 2, every UI change becomes an APK build → GitHub release → the user tapping through
`components/more/update-check-card.tsx` → `/api/download-apk` → a manual sideload install.

Verified: there is **no OTA path in the repo** — no `capacitor-updater`, no live-update plugin, in
`package.json` or `android/app/build.gradle`.

The backlog records this as *"not actioned, optional, low-priority… not worth doing now given how
rarely rebuilds happen today"* — written **2026-07-31**, one day before the owner confirmed that
multi-user and cross-device are permanent. Three things break that reasoning:

1. **Stage 6 is the highest-UI-churn period this app will ever have**, and it sits *after* Stage 2.
   Migrating the workout screen to Compose means iterating on a surface whose every change now costs
   a full manual reinstall.
2. **The friend with an account has no sideload workflow at all.** Sideloading is an owner-only
   affordance.
3. **A Play Store listing replaces the update card entirely** — you cannot ship `/api/download-apk`
   as an update mechanism through the Play Store.

**Recommendation.** Make update delivery a written precondition of Stage 2, with three named options:
OTA (`capacitor-updater` or equivalent), a Play Store internal-testing track, or keep the shell remote
until Compose replaces the screens that matter. Any of the three is fine; leaving it unanswered is not,
because Stage 2 is where the cost lands.

---

## F3 — Play Store and multi-user are now stated requirements and appear in no stage

Three same-day documents disagree about what is being built:

- Goal layout §1: *"A single-user Android app on the S25 Ultra."*
- `device-agnostic-source-architecture.md` §1: *"Other people use this… the long-term intent is
  production and a Play Store listing."*
- `CLAUDE.md` Canonical Runtime: APK-only, sideloaded, amended 2026-08-02 to say this is *"a current
  target, not a permanent one."*

`device-agnostic-source-architecture.md` §7 raises the contradiction as open question #1 — and no
queue entry points at it, which is the "No orphaned findings" rule applied to the roadmap itself.

What is actually gated behind it, scattered across four docs and queued nowhere:

| Item | Where it is recorded | Status |
|---|---|---|
| Health Connect **declared-use-case review** — gates tier 2, i.e. every non-owner user | device-agnostic §7 | not queued |
| Privacy policy + data-safety declarations | device-agnostic §7 | not queued |
| Map tile attribution (`attributionControl={false}` — an ODbL/Thunderforest violation for public use) | `public-launch-checklist.md` | queued nowhere; the checklist has exactly one item |
| Tier-1 BLE pipeline assumes one owner (foreground service, `WEBHOOK_USER_ID`, admin-only console) | device-agnostic §7 q2 | "not scoped here" |
| `006_admin_flag.sql` hardcodes the owner's real email | Q-32 | inside a blocked entry |

**Recommendation.** Pick one and write it into the goal layout: either *"Play Store is out of scope
for this roadmap; revisit after Stage 7"*, or add **Stage 8 — distribution**, and move the five rows
above into `public-launch-checklist.md` so that file becomes the real gate it claims to be. The
current state — an ambition stated in one doc, contradicted in another, and tracked in none — is the
one that costs a session later.

---

## F4 — Stage 1 is called the spine of the plan and defines no schema

Stage 1 says *"Lock the Postgres **and** local SQLite schemas to the new standard… the highest-
compounding investment in the whole plan… the one artefact that survives every subsequent stage
unchanged."* It then answers two policy questions — retention tiers (1a) and sync posture (1b) —
and stops. Neither is a schema, and no artefact anywhere states what "the new standard" is.

Measured on `main`: **70** `pgTable` definitions in `lib/data/postgres/schema.ts`, **37** distinct
local SQLite tables. Nothing records which of the 70 are device-resident, which are server-only by
design (`rate_limits`, `error_events`, `db_query_log`, `invited_emails`), which are derived and
re-computable, and which are simply not mirrored yet.

Why it matters more than it reads: **Stage 5 generates Room entities from that schema.** Porting
against an undefined target is exactly where a schema fork appears, and a fork between the Kotlin
local store and Postgres is the failure this plan's own §6 invariant ("the schema is the contract")
exists to prevent.

There is also an unsequenced collision. **Q-44 Phase 3** renames 22 `oura_*` tables. That has to land
*at* Stage 1 or never: after the Room port it is twice the work, and after Stage 4's history-free repo
cut it is a migration written into a fresh history against a schema the public repo inherited.

**Recommendation.** Stage 1's deliverable is one document — a **table-by-table residency matrix**:
for each of the 70, its residency (device / server / both), its writer, its retention tier, and
whether it is derived. Fold the `oura_*` rename go/no-go into the same document. Stage 5 does not
start before it exists.

---

## F5 — Stage 5 is the largest risk in the plan and has no plan, no gate, and no parity story

Stage 5 re-implements, in Kotlin/Room: ~4,500 lines of local store, 18 outbox domains, 11 sync-domain
flags, 29 cache-invalidation groups, cursor pagination, poison-pill quarantine, and the pull-clobber
gates. That is the subsystem with the worst incident history in the repo — the queue wedges (#47,
#74, #82), the `food_items` data-loss gap, epoch drift.

Three specific holes:

1. **The one CI invariant protecting it does not survive the port.**
   `scripts/check-push-mutations.js` enforces one-write-path-per-domain today. The goal layout notes
   *"the native equivalent needs its own guard at Stage 5"* — noted, unowned, unscheduled.
2. **The port creates a transitional third write path** (web route / TS `pushMutations` / Kotlin), and
   nothing describes how the TS local store is retired, or what happens on a device running both
   during the transition. `CLAUDE.md`'s hard rule is that these paths drift; two is already the
   documented failure mode.
3. **"Algorithmic port, not a redesign" is asserted, not proven.** The supporting evidence — zero
   React/Zustand imports in `sqlite-backend.ts`, `sync-engine.ts`, `sync-helpers.ts` — is real and
   checks out, and it does establish portability. It does not establish *equivalence* of the port.

**Recommendation.** Stage 5's **first task is a golden-vector parity harness**: fixture sets driving
both the TS and Kotlin implementations through the same delta/outbox scenarios, asserting identical
end state. It exists before any port code. Add a fourth off-ramp to §7 as well — Stage 5 under a
WebView-only UI still buys reactive Room reads and WorkManager sync, which is real but much smaller
than the stage's cost; if Stage 6 is not going to happen, Stage 5 should be re-costed on that
narrower benefit.

---

## F6 — Stage 4 is parked behind a deferred stage, and nothing says so

Q-31 and Q-32 are `⛔ blocked on Q-1 + Q-30`. Q-1 was deferred by the owner on 2026-08-02. So Stage 4
is now transitively deferred, indefinitely, and the backlog does not say that anywhere — a reader sees
"blocked on Q-1" and assumes Q-1 is moving.

Two things compound it:

- The Q-1 gate is a **2026-07-30 sequencing preference, not a technical dependency**. Nothing about
  cutting a clean repo requires the shell to be bundled first.
- **A Play Store listing does not require a public repo.** If the Play Store is the destination
  (F3), Stage 4 is not on that path at all — it is a separate goal that happens to be sequenced
  into the same list.

Q-31's own premise is already known false (seven live imports of Oura constants, not two), which the
backlog annotates honestly. Run-list item 6 — the docs-only triage plan — is correctly *not* blocked.

**Recommendation.** State the transitive deferral explicitly on Q-32, and decide whether the Q-1 gate
survives. The triage plan (item 6) is worth doing either way: it is the only thing standing between
"we have a public-repo plan" and "our public-repo plan is built on a false premise".

---

## F7 — No stage mentions notifications, and the current transport does not survive Stage 2 intact

Verified on `main`: push is **web-push/VAPID through the service worker** (`lib/push.ts`,
`web-push@^3.6.7`) plus `@capacitor/local-notifications` for client-scheduled reminders. There is **no
FCM and no Firebase** anywhere in `android/` or `package.json`.

Three collisions with the roadmap:

- `CLAUDE.md` states the service worker *is* the push transport for the APK and must not be deleted.
  Stage 2's `output: 'export'` **disables `next.config.ts` headers entirely** (per the Phase 3 handoff's
  measured gotchas) — the CSP and SWR headers are already known casualties; the SW's delivery path
  deserves the same explicit check before, not after.
- **E6 (the server-side scheduler) has never been built.** Everything "proactive" today is
  client-scheduled local notifications, so nothing can reach a user who has not opened the app that
  day. For a single owner that is a quirk; for other users it is a missing product feature.
- Stages 5–7 make **FCM** the natural transport, and "bundle-the-shell + native FCM push" sits in the
  backlog's *"Not yet queued — needs a planning session first"* section, i.e. outside the roadmap.

**Recommendation.** Add one line to Stage 2's exit criteria (push still delivers after the export) and
one decision point to Stage 5/6 (FCM vs web-push). Notifications do not need their own stage; they
need to stop being absent from every stage.

---

## F8 — Doc drift that will mislead the next session

Each verified against source this session:

| Claim | Where | Reality |
|---|---|---|
| `saveSleepSession` takes **no** `source` and is a bare `onConflictDoNothing` — *"a real data-quality bug the moment tier 2 is live"* | `device-agnostic-source-architecture.md` §4c | **Fixed by Q-43.** `lib/data/repository.ts:527` requires `source: HealthSource`; `adapter.ts:2406` delegates to the merge path. `CLAUDE.md` records the fix; this doc still lists it as a live gap. |
| *"Health Connect is dormant… HC verification items are parked"* | `projectOverview.md` | Q-43 shipped HC as the tier-2 source (v1.250.0) and the owner checklist carries an HC device check. |
| *"Never prune or mutate `body_hex`"* — no server/device qualifier | `CLAUDE.md:261` | Stage 1a mandates a **14-day rolling local** window. The goal layout draws the server/device distinction correctly; the rule text does not, and a session reading only `CLAUDE.md` will block the local pruner. Qualify it now rather than at D4. |
| Local SQLite **v20** | `planned_upgrades.md:20` | Backlog says **v21**, citing `lib/sqlite/__tests__/migrations.test.ts`. |
| **38** screens | goal layout §2 | **40** `app/**/page.tsx` today. Harmless for the argument; it is a measured figure that will keep drifting. |

---

## Recommended roadmap edits, in one table

| # | Change | Doc to edit | Size |
|---|---|---|---|
| 1 | Split Q-1 into `Q-1a` (client bearer auth + `apiUrl()`) and `Q-1b` (workspace split + export); mark 1a startable now | backlog, goal layout §4 Stage 2 | S |
| 2 | Make an update-delivery decision a precondition of Stage 2 (OTA / Play track / stay remote) | goal layout §4 Stage 2 | S to write, M to build |
| 3 | Resolve Play Store in or out; if in, add Stage 8 and populate `public-launch-checklist.md` with the five rows in F3 | goal layout §1, launch checklist | S |
| 4 | Give Stage 1 a real deliverable: the 70-table residency matrix; fold in the `oura_*` rename go/no-go | goal layout §4 Stage 1 | M |
| 5 | Stage 5 opens with a golden-vector parity harness; add the native one-write-path guard as a named task; add the "Stage 5 without Stage 6" off-ramp | goal layout §4 Stage 5, §7 | S to write |
| 6 | State Stage 4's transitive deferral on Q-32; decide whether the Q-1 gate survives | backlog Q-31/Q-32 | XS |
| 7 | Add push to Stage 2's exit criteria and a FCM decision point at Stage 5/6 | goal layout | XS |
| 8 | Fix the five drifted claims in F8 | four docs | XS |

Items 1, 6, 7 and 8 are edits, not projects — about one session in total. Items 2, 3, 4 and 5 each
want a short planning pass.

---

## Answering the question directly

**Does the roadmap end up with a native app?** For the data layer and the daily-touch screens, yes —
Stages 3, 5 and 6 are correctly ordered, correctly gated, and each leaves a working app. The
convergence-over-rewrite call is right, and it is right for reasons that are written down.

**Does it end up with a native *product*?** Not yet. The plan's destination sentence still describes
a single-user app on one device, while the same-day directive above it says other people use this
and the Play Store is the intent. Nothing between Stage 1 and Stage 7 delivers update distribution,
notifications that work without opening the app, or the multi-user surface that tier-2 users need.
Those are the finish line, and the plan currently stops just short of them.

**The one thing to fix first:** F2. Stage 2 is the point of no return for update delivery, it is the
stage everything else is sequenced behind, and the assessment on record was written under a premise
the owner reversed the next day.

---

## Verification — what this review did and did not exercise

**Done:** read the seven roadmap/handoff docs above plus `CLAUDE.md` and the relevant
`projectOverview.md` sections; verified against source on `main` (b7ecb15) — `capacitor.config.ts`
remote URL, absence of `railway.json`/`API_ORIGIN`/`shell/`/`api/`, presence of `pnpm-workspace.yaml`
+ `packages/shared`, `saveSleepSession`'s signature at `repository.ts:527` and `adapter.ts:2406`,
push stack (`lib/push.ts`, `web-push`, no FCM/Firebase), absence of any live-update plugin, 70
`pgTable` vs 37 local tables, 40 `page.tsx`, the >800-line component list, `CLAUDE.md:261`.

**Not done — no claim is made about any of these:** nothing was run on the S25 or on any APK; the app
was not started (`pnpm dev` was not exercised); the test suite was not run; no Kotlin was compiled;
production data was not queried; no runtime behaviour of Health Connect, BLE, safe-area insets or
Samsung WebView rendering was observed. Every finding above is a documentation/source-level analysis,
and the two that would most benefit from a device check are F2 (the real cost of a sideload update
cycle) and F7 (whether push survives an exported shell).
