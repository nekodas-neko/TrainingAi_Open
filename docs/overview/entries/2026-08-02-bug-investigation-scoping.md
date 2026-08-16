## 2026-08-02 — owner bug batch: investigation + scoping (planning session, docs-only)

**Branch:** `claude/bug-investigation-scoping-86cska` · **Type:** planning PR (PR 1 of 2 per the
backlog-driven protocol — no implementation).

The owner reported five bugs against production with DevTools screenshots. This session traced all
five to source and wrote the implementation plan; **nothing was fixed**.

### What was found

| Report | Root cause | Confidence |
|---|---|---|
| Pull-to-sync errors | Two independent causes — a dead-lettered `activity_logs` mutation (below), and `applyDelta` sitting **outside** `pullPage`'s try block (`lib/local-store/sync-engine.ts:531`) so a device-side schema fault surfaces as the same generic toast as a network failure. The device console shows the local schema *is* broken. | Source-verified |
| Guided walk missing from the training calendar | `computeWalkSegmentStats` rounds segment mean HR to 1dp (`lib/walk/segment-stats.ts:23`); `WalkSegmentStatSchema.avgHr` is `z.number().int()`. One fractional mean rejects the **entire** payload on both write paths → dead-letter. The walk renders locally (local-first read) while absent from Postgres, and `getCalendarData` reads Postgres. | **Reproduced** — Vitest against the real schema: `{path: ["segments",0,"avgHr"], "expected int, received number"}` |
| Body Battery anchoring on readiness, "sometimes sleep" | `app/api/body-battery/route.ts:140` re-picks the anchor on every read; the `oura_daily_derived` row only exists once `/api/readiness-score` has run that day, so the anchor — and the whole day's curve — switches source part-way through the morning. | Source-verified |
| Prescription vanished after accepting the Intensification transition | `advancePhase` clears the prescription and the route writes `prescriptionStatus: 'none'`; `isAiPrescriptionPending` keys on `'consumed'`, so no placeholder, no poll, no regeneration trigger. The only regeneration is a fire-and-forget server self-fetch — the pattern `workout-screen.tsx:1519` already documents as unreliable in prod. | Source-verified |
| Polar strap permanently "Connecting…" | The label comes from two booleans; `active` is true from app start because ambient mode runs all day, so every non-`ready` state collapses into "Connecting…". `PolarStrapService.kt:159` also calls `stopSelf()` after ~4 min of failed attempts **without emitting a final status**. | Source-verified |

Two incidental findings, both fixed inline in this docs PR: WAL has **never actually been enabled**
on the device (`PRAGMA journal_mode=WAL` is sent through `execute()`, which cannot return rows), and
the backlog's "Local SQLite is at v20" line was stale (the test asserts v21).

### What landed

- `docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md` — one plan,
  five independent, separately-mergeable workstreams (A–E) with per-task TDD steps.
- `docs/implementation-backlog.md` — **Q-36 … Q-40** inserted above Q-1 (Q-1's next step is blocked
  on an owner infra action, and Q-36/Q-37 are actively losing data), plus **Q-41/Q-42** for the
  follow-ups the investigation surfaced but the fixes deliberately leave out. v20→v21 corrected.
- `projectOverview.md` — a Known-Issues entry covering all five, tagged and explicitly marked NOT
  fixed.
- Domain indexes updated: `activity`, `platform`, `readiness`, `workouts`, `devices`.

### Not exercised

Nothing was implemented, so nothing needed device verification. The reproduction that *was* run
(the segment-schema Vitest) is pure-logic and sandbox-safe. When Workstream B is implemented it
carries a hard device gate — `getLocalStore` returns `null` in the sandbox, so none of the local-DB
open path is reachable by `pnpm dev`.

### Owner action pending

Once Q-36 ships, tap **Retry** on the "1 change failed to sync" card in More → Profile. The stranded
2026-08-01 activity is dead-lettered and the outbox will not re-attempt it on its own.

No version bump — docs-only, no user-visible change.
