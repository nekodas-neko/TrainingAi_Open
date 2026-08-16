# Handoff — 2026-08-02 · Owner bug batch: investigation and scoping

_Domain: `cross` (touches `activity`, `platform`, `workouts`, `readiness`, `devices`) · Branch: `claude/bug-investigation-scoping-86cska` · PR: see below_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/<pillar>/README.md` for whichever pillar you're working in, then
> `docs/implementation-backlog.md` (the queue — these are **Q-36 … Q-40**). This file covers only
> what *this* session did and what it leaves behind.

## Goal

The owner reported five bugs against production on 2026-08-02 with DevTools screenshots and asked
for them to be read, scoped, and turned into an implementation plan. **This was a planning session
(PR 1 of the two-PR backlog protocol) — no fixes were implemented.**

## Current status

- **Build/test:** docs-only change; no source touched, so nothing to build. One throwaway Vitest
  file was used to reproduce the Q-36 schema failure and then deleted — the reproduction is
  re-encoded as a real test in the plan (Task A1), not left in the tree.
- **Device-verified:** N/A — nothing was implemented. The work this plan queues *does* carry device
  gates: Workstream B (local SQLite open path) and Workstream E3 (Kotlin) are unreachable from
  `pnpm dev` and cannot be verified in the sandbox at all.
- **Nothing in this PR is claimed as fixed.** All five bugs are still live in production.

## What shipped

| Change | Where |
|---|---|
| The plan — five independent, separately-mergeable workstreams (A–E) with per-task TDD steps | `docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md` |
| Backlog entries **Q-36 … Q-40**, inserted above Q-1 | `docs/implementation-backlog.md` |
| Backlog entries **Q-41 / Q-42** for follow-ups the investigation surfaced but the fixes leave out | `docs/implementation-backlog.md` |
| Corrected the stale "Local SQLite is at **v20**" line → v21 (`lib/sqlite/__tests__/migrations.test.ts` asserts 21) | `docs/implementation-backlog.md` |
| Known-Issues entry covering all five, tagged and explicitly marked NOT fixed | `projectOverview.md` |
| Plan linked from five pillar indexes | `docs/domains/{activity,platform,readiness,workouts,devices}/README.md` |
| Session journal entry | `docs/overview/entries/2026-08-02-bug-investigation-scoping.md` |

## The five diagnoses (all traced to source — do not re-derive these)

1. **Q-36 · [activity] A guided walk can never sync, and so never reaches the training calendar.**
   `computeWalkSegmentStats` rounds a segment's mean HR to 1dp (`lib/walk/segment-stats.ts:23`, the
   `avg()` helper — `Math.round(x*10)/10`), but `WalkSegmentStatSchema.avgHr` is `z.number().int()`
   (`packages/shared/src/validation/activity-log.ts:17`). One fractional mean rejects the **whole**
   `activity_logs` payload — Zod validates the object, not the field — on both the web route and
   the `pushMutations` branch, so it dead-letters after 5 attempts.
   **This is the only one that was empirically reproduced**, with a Vitest run against the real
   schema: `{path: ["segments",0,"avgHr"], "expected int, received number"}`.
   It explains *two* of the owner's reports at once: the walk still renders in the Health list
   (local-first read) while being absent from Postgres, and `getCalendarData`
   (`lib/data/postgres/adapter.ts:1066`) reads `activity_logs` **from Postgres**.
2. **Q-37 · [platform] The local SQLite store fails its version upgrade on every launch.** Three
   separate faults visible in the owner's console: (a) the v13
   `ALTER TABLE mutations_outbox ADD COLUMN attempts` fails with "duplicate column name" every
   launch, because the fallback reopen at version 1 never stamps the version forward
   (`lib/sqlite/sqlite-service.ts:52-81`); (b) `PRAGMA journal_mode=WAL` is sent through
   `execute()`, which cannot return rows — **WAL has never actually been enabled on this device**;
   (c) a leaked connection registration (`Connection trainingai already exists`) is misdiagnosed as
   an upgrade fault. Separately, `applyDelta` sits **outside** `pullPage`'s try block
   (`lib/local-store/sync-engine.ts:531`), so a device-side schema fault surfaces as the same
   generic "Sync failed" toast as a network outage.
3. **Q-38 · [workouts] Accepting a phase transition empties the prescription card permanently.**
   `advancePhase` sets `prescription: null, prescriptionStatus: 'none'`
   (`lib/data/postgres/slices/periodization.ts:80-99`). `isAiPrescriptionPending` keys on
   `'consumed'` (`packages/shared/src/ai-periodization/prescription-pending.ts:28`), so `'none'`
   matches nothing the pre-workout screen watches — no "Preparing your AI workout…" placeholder, no
   bounded poll, no client-side regeneration trigger. The only regeneration is a fire-and-forget
   server self-fetch (`transition/route.ts:61`), the exact pattern `workout-screen.tsx:1519` already
   documents as unreliable in prod.
4. **Q-39 · [readiness] The Body Battery anchor flips between readiness and sleep mid-day.**
   `app/api/body-battery/route.ts:140-155` re-picks the anchor on **every** read. The
   `oura_daily_derived` row only exists once `/api/readiness-score` has run that day, so the anchor
   — and therefore the entire day's curve — switches source part-way through the morning and jumps
   by `readiness − sleepScore` points.
5. **Q-40 · [devices] The chest-strap card reads "Connecting…" forever.** The label is derived from
   two booleans (`components/settings/chest-strap-pairing.tsx:34-38`), and `active` is true from app
   start because ambient mode runs all day (`components/live-hr-ambient-provider.tsx:28`) — so every
   non-`ready` native state collapses into "Connecting…". The native service also calls `stopSelf()`
   after exhausting its backoff ladder (`PolarStrapService.kt:159-163`) **without emitting a final
   status**, so the WebView holds its last-seen state indefinitely.

## Deliberately NOT done

- **No implementation.** Per the backlog-driven protocol this is the docs-only planning PR; the
  fixes are PR 2 (or five of them). The owner explicitly asked to "read and scope these".
- **Q-39 does not rethink what a battery anchor should mean.** Readiness is a composite that already
  folds in sleep/HRV/RHR, so the two Home numbers are inherently close. That is a modelling
  question, not a bug — recorded as a design follow-up, not fixed by freezing the anchor.
- **Q-39 does not extract the readiness composite** so Body Battery could compute it inline (which
  would remove the sleep fallback entirely). `app/api/readiness-score/route.ts` is ~800 lines of
  inline computation; that refactor is its own project → **Q-42**.
- **The calendar's structural blind spot is not closed.** `getCalendarData` reads Postgres, so a
  locally-saved activity is invisible there until it syncs — the same shape as the sanctioned
  `home-day-timeline` exception. Q-36 removes the reason it was *stuck*; the gap remains → **Q-41**.

## Key decisions (with rationale)

- **Q-36 relaxes the wire schema *and* rounds at source — both, not either.** The owner's device is
  holding an already-serialised payload in its outbox. Rounding at source fixes future walks but
  cannot touch that frozen row; only a relaxed schema lets it drain. The DB column types these as
  plain `number | null` (`lib/data/postgres/schema.ts:326`), so a fractional value stores fine.
- **Q-38 writes `'consumed'` rather than adding a new status or a new UI state.** `'consumed'` is
  already the value that drives the "Preparing" placeholder, the bounded poll and the client-side
  prescribe trigger. Reusing it means the fix is two lines and no new machinery.
- **Q-38 deletes the server self-fetch instead of hardening it.** The codebase already moved the
  open-time and completion-time triggers client-side for exactly this reason, and says so in a
  comment. Leaving a third copy of the known-unreliable pattern would be the wrong call.
- **Five workstreams, five branches, not one big PR.** They share no files, and Workstream B alone
  carries a device gate that would otherwise hold the other four hostage.
- **Filed under `cross`, not a single pillar.** Five pillars, one report. Because the pillar indexes
  glob on `docs/handoff-*-<domain>-*.md`, this doc is linked explicitly from all five History
  sections rather than relying on the glob.

## Gotchas / what did NOT work

- **A Vitest file placed under `lib/__tests__/` cannot import `@trainingai/shared/...`** — the
  workspace alias does not resolve from there and the run fails with `Cannot find package`. The
  reproduction had to live under `packages/shared/src/validation/__tests__/` with a relative
  import. Worth knowing before writing any test that touches the shared package.
- **Do not assume "the walk is missing" means the walk wasn't saved.** It was saved — locally, and
  it renders in the Health list. Offline-first means "absent from a server-backed surface" and
  "not saved" are different failures, and only the outbox card distinguishes them.
- **"Invalid activity_logs payload (5 attempts)" names no field**, which is most of the cost of
  diagnosing one of these. Task A3 fixes that for `activity_logs`, `fitness_tests` and
  `prescribed_run` — worth doing even if the rest of Workstream A were dropped.
- **`projectOverview.md` is 334 KB and exceeds the Read tool's limit.** Read it with
  `offset`/`limit`, or `grep -n '^## '` for its four section anchors.

## Files to look at

- `docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md` — the plan.
  Every task has exact file:line targets, the actual code to write, and the command + expected
  output for each verification step.
- `docs/implementation-backlog.md` — Q-36 … Q-42, priority-ordered, each linking back to its
  workstream.
- `packages/shared/src/validation/activity-log.ts:11-23` — `WalkSegmentStatSchema`, the Q-36 defect.
- `lib/sqlite/sqlite-service.ts:37-121` — the Q-37 open path. **The most dangerous file in the app**
  (it has silently killed the local DB twice: WAL-in-transaction #27, non-idempotent ADD COLUMN #85).
- `app/api/body-battery/route.ts:108-156` — wake anchor + battery anchor, the Q-39 defect.
- `app/api/ai-periodization/session/[sessionId]/transition/route.ts` — Q-38.
- `lib/live-hr/chest-strap-source.ts:57-107` and `android/.../polar/PolarStrapService.kt:157-171` — Q-40.

## Open questions / blockers

- **Owner action, required once Q-36 ships:** open **More → Profile** and tap **Retry** on the
  "1 change failed to sync" card. The stranded 2026-08-01 activity is dead-lettered and the outbox
  will **not** re-attempt it on its own — the fix alone will not recover that walk.
- **Owner action, required for Q-37 and Q-40's Task E3:** an APK rebuild
  (`npx cap sync android && ./gradlew assembleDebug`). The sandbox has no Android SDK and Gradle
  downloads are proxy-blocked, so Kotlin is compile-gated at best and the local-store open path is
  entirely unverifiable here.
- **Unresolved, upstream of all of this:** whether Next.js + Capacitor is the right architecture at
  all — see `docs/handoff-2026-08-02-platform-offline-architecture-review.md`. None of Q-36 … Q-40
  is affected by that decision (all five are defects that would need fixing under any
  architecture), so they are safe to take regardless.

## Pickup prompt

```
Work the top of the implementation backlog: bug Q-36 from the owner's 2026-08-02 report.

Read, in this order:
1. projectOverview.md — read it with offset/limit, it is 334 KB and exceeds the Read tool's
   limit. Its Known-Issues section has an entry covering all five bugs in this batch.
2. docs/domains/activity/README.md — the pillar index.
3. docs/handoff-2026-08-02-cross-owner-bug-batch-investigation.md — the investigation record:
   all five root causes with file:line, the decisions and their rationale, and the traps.
4. docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md —
   the plan. Q-36 is Workstream A, Tasks A1–A4.

Then:
  git fetch origin main && git remote prune origin && git checkout -B fix/activity-log-segment-validation origin/main

First concrete action: Task A1 — add the two failing cases to
packages/shared/src/validation/__tests__/plausibility.test.ts, run
`npx vitest run packages/shared/src/validation/__tests__/plausibility.test.ts` and confirm the
failure is `{path: ["segments",0,"avgHr"], "expected int, received number"}` before changing
any source.

Constraints you would otherwise rediscover:
- Relaxing the schema is load-bearing, not cosmetic. The owner's device holds an
  already-serialised outbox payload that only a relaxed schema can drain; rounding at source
  (Task A2) fixes future walks but cannot touch that frozen row. Do both.
- A test under lib/__tests__/ cannot import '@trainingai/shared/...' — the workspace alias does
  not resolve from there. Put shared-package tests under packages/shared/src/**/__tests__/ and
  import relatively.
- Before reporting any lib/data/postgres/__tests__/* file as failing, re-run that file ALONE.
  The DB-backed tests oversubscribe the local Postgres under parallel workers; this produced
  four false alarms in one session on 2026-07-28. Stop `pnpm dev` first.
- Verify on the local dev server before merging (CLAUDE.md): exercise POST /api/activity-logs
  with a segments array whose avgHr is fractional, and confirm the day shows an activity marker
  on /session-select at a ≤640px viewport. That calendar surface is the one the owner reported
  as empty.
- Bump package.json (patch) and add a packages/shared/src/changelog.ts entry in the same PR —
  this is a user-visible bug fix. Write them last, once the diff is final.
- Do NOT take Q-37 in the same PR. It is the second, independent cause of the same "Sync failed"
  toast, it touches lib/sqlite/sqlite-service.ts (the file that has killed the local DB twice),
  and it carries a hard on-device verification gate that would otherwise block this fix.

Owner action to report back, once Q-36 is merged and deployed: they must open More → Profile and
tap Retry on the "1 change failed to sync" card. The stranded 2026-08-01 activity is
dead-lettered and the outbox will not re-attempt it on its own.
```
