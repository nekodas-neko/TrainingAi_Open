# Prescription-Generation Write Race Under Concurrent Triggers (Q-54)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close a concurrency gap found in
`docs/reviews/2026-08-03-cross-domain-bug-review.md` (§3): two prescription-generation calls for the
same session, reachable via different dedup keys, can interleave their writes and leave
`prescriptionStatus` mismatched against the prescription content actually stored.

**Tech stack:** `packages/shared/src/ai-periodization/generate-prescription.ts`,
`lib/data/postgres/slices/periodization.ts`, `packages/shared/src/ai-periodization/generation-dedup.ts`.

## Evidence

`generatePrescriptionForSession` (`generate-prescription.ts:628-654`) does three sequential,
non-transactional writes to the same `session_periodization` row: `advancePhase` →
`storePrescription` → conditional `updatePrescriptionStatus`. `storePrescription`
(`periodization.ts:109`) unconditionally resets `prescriptionStatus` to `'pending'`.

The dedup cache (`generation-dedup.ts`) only collapses calls sharing an **identical** key
(`userId:sessionId:day:excludeSessionId:durationPreset`). `handleDurationPresetChange`
(`workout-screen.tsx:481-497`, the Quick/Normal/Long picker) intentionally builds a different key
and passes `skipCooldown:true` (`generate-prescription.ts:160`) — by design, so a duration change
isn't blocked by an in-flight standard generation. But that also means it's never deduped against a
concurrent standard-key generation for the *same session* — e.g. the auto-fire that runs at
session-open time (`aiPrescriptionPending` effect). Two concurrent runs can interleave their three
writes: run A's `advancePhase` + `storePrescription` land, then run B's `updatePrescriptionStatus`
lands on top with a status describing run A's content but computed from run B's decision (or vice
versa). Not covered by `canAutoApplyTransition`'s existing unit tests — those exercise only the
single-call decision function, not the write sequence under concurrency.

## Tasks

- [ ] **Task 1 — reproduce.** Write a test (or a scripted scenario against the local dev DB) that
      fires a duration-preset-key generation and a standard-key generation for the same session
      concurrently, and asserts on the final `prescriptionStatus`/prescription-content pairing. Confirm
      the interleaving is real before designing the fix — this plan is based on source-reading, not an
      observed failure.
- [ ] **Task 2 — pick a fix.** Two reasonable options, pick whichever fits the existing
      `session_periodization` write patterns with the least new surface area:
      - Wrap the three-write sequence in a single DB transaction, so the whole sequence is atomic per
        call — doesn't prevent two calls from racing, but at least removes the risk of interleaved
        *partial* writes within a single call.
      - Broaden the dedup key (or add a session-level lock/mutex) so any generation for the same
        `userId:sessionId:day` collapses regardless of `durationPreset`/`excludeSessionId`, and let the
        duration-preset call explicitly cancel/supersede an in-flight standard-key one rather than
        running alongside it. Check whether `skipCooldown:true`'s original intent (not being blocked by
        an in-flight standard generation) survives a session-level collapse, or if it needs to become
        "supersede the earlier one" instead of "bypass dedup entirely".
- [ ] Add a regression test covering the interleaving scenario from Task 1.
- [ ] Run the full test suite + lint. Local dev-server pass exercising both the duration-preset
      picker and the auto-fire trigger.
- [ ] Remove this entry from `docs/implementation-backlog.md`, add the journal entry +
      `projectOverview.md` update in the same PR.
