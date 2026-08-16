# 2026-08-06 — Running-plan overrides now write through the local store (Q-98, bug-fix half)

**Domain:** cardio — v1.267.7, JS-only (no APK rebuild), **on-device verification pending**

## The report

Q-98 (owner UI-bug batch): tapping "Skip" on the Running pre-run screen leaves no way to pick a
different run type — only "Back to Cardio," even though the run-type carousel above is still
swipeable.

## Two separate problems, only one shipped this session

The plan traced this to two independent things: a real APK-only bug, and a redesign request. Only
the bug fix ships in this PR — the redesign (per-run-type imagery, folding Start into each
carousel slide, removing `PrescribedRunCard`/the Skip button) stays open, split off to
`docs/implementation-backlog.md` **Q-98-followup**. The plan itself said both are independently
shippable and the bug fix shouldn't wait on the redesign being resourced.

## Root cause

`markRun` (the plain Skip/Complete path) writes through both the local SQLite store
(`store.upsertPrescribedRun`) and the outbox (`store.queueMutation`) before hitting the server.
`applyOverride` (the swipe-to-pick-a-different-run-type path) only did a bare `fetch` to
`/api/running-plan/override` — no local-store write at all.

On a device with a real local store, this creates a race: `applyOverride`'s success handler calls
`setLocalStatus('pending')` optimistically, but that state update triggers a re-render, which
re-runs the screen's "local-first read of today's prescribed-run status" effect (it depends on
`[userId, data]`, and `data` just changed via `applyOverride`'s own `setData` call). That effect
unconditionally re-reads `store.getPrescribedRuns()` and overwrites `localStatus` with whatever it
finds — the **stale `'skipped'` row `markRun` left behind**, since `applyOverride` never touched
the local store to correct it. The optimistic `'pending'` is clobbered back to `'skipped'`
immediately, and the "Today's run skipped" dead-end panel never goes away no matter what you swipe
to.

On web, `getLocalStore()` returns `null`, so the local-first effect no-ops entirely and this race
doesn't exist — the exact "passes web, broken on APK" pattern this repo has hit before, and why the
bug survived past `pnpm dev` testing until an owner actually hit it on-device.

## The fix

`applyOverride` now writes the server's response (`updated.run` — the full `PrescribedRun` row,
already correctly `status: 'pending'` per the override route) through
`store.upsertPrescribedRun(...)` with `syncStatus: 'synced'` — no outbox mutation queued, since the
override already reached the server via the POST that produced this data. `PlanResponse.run`'s
type was widened from a narrow `{id, status}` shape to the actual full row both
`GET /api/running-plan` and `POST .../override` return (`Omit<PrescribedRun, 'userId' |
'updatedAt'> & { updatedAt: string }` — the Date becomes a string once JSON-serialized).

## Verification

Typecheck and lint clean. Full suite: 400/401 files green, one unrelated flake
(`cable-exercise-merge-migration.test.ts`, an exercise-name-merge migration test with zero relation
to running-plan/prescribed-run — passes cleanly alone, fails differently each full-suite run; this
is the documented pool-contention flake class from CLAUDE.md, not a regression from this change).

Ran `pnpm dev` with Playwright against a seeded running plan: reproduced the exact reported
sequence (skip today's run → dead-end panel appears), then tapped a different run type on the
carousel and confirmed the dead-end resolves correctly, with no console/page errors — the *web*
regression-free check, since `getLocalStore()` returning `null` there means this PR's actual new
code path (the local-store write) never executes on web at all.

**The real fix is not verified on-device.** This is a genuine APK-only bug — the failing path is
structurally unreachable in this sandbox (no native SQLite here), so there is no way to exercise
the local-store race this PR fixes without a physical device. Per this repo's Canonical Runtime
policy (`CLAUDE.md`), shipping with an explicit not-yet-device-verified note is the correct path
when no device is available in-session, rather than blocking the fix indefinitely. Flagging in
`projectOverview.md`'s Known Issues so the next session (or the owner) knows this needs a real
on-device swipe-to-pick-a-different-run-type check before it can be marked confirmed.
