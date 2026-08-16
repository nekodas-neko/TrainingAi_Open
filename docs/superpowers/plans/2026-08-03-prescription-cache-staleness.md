# Prescription Cache Staleness After a Mutation (Q-53)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two related cache-staleness bugs found in
`docs/reviews/2026-08-03-cross-domain-bug-review.md` (§1-2), both in the workout-prescription flow,
both variants of a bug class the project already fixed once this cycle
(`GET /api/running-plan`, v1.246.0): a bare `fetch()` of a `Cache-Control: max-age` route can be
served a stale response by the **browser's own HTTP cache** even when the app's own
`cachedFetch`/cache-group invalidation ran correctly — the two systems don't know about each other.

**Tech stack:** Next.js 15 / React, `lib/sqlite/cache.ts` (`cachedFetch`/`invalidatePrescriptionChanged`),
`components/workout-screen.tsx`, `components/workout/ai-prescription-card.tsx`,
`components/mood-checkin-sheet.tsx`.

## Evidence

| # | Symptom | Root cause (file:line) | Verified how |
|---|---|---|---|
| a | Phase transition can show stale pre-transition prescription for up to 60s | `workout-screen.tsx:1652`, `onPhaseChanged`'s bare `fetch(...)` — no `cache: 'no-store'` override, unlike the sibling `loadPeriodization({afterWrite:true})` path at `:497` | Source read; the fix pattern already exists in the same file for the sibling call site |
| b | Session-select can repaint stale pre-transition phase/confidence text after backing out of a session whose prescription auto-applied a transition | `workout-screen.tsx:550-563`, the `aiPrescriptionPending` effect never calls `invalidatePrescriptionChanged(programSessionId)`, unlike every other trigger site (`:497`, `:508`, `:1524-1526`, `ai-prescription-card.tsx:93,112`) | Source read — diffed against every sibling call site that does call it |
| c (medium confidence) | `mood-checkin-sheet.tsx`'s duplicate duration-preset handler may also serve stale data | `mood-checkin-sheet.tsx:117-144` POSTs then only calls `invalidatePrescriptionChanged()` — no `afterWrite`-aware refetch available to it | Source read; not traced to a concrete downstream repaint, flag for the implementer to confirm before fixing |

## Tasks

- [ ] **Task 1 — fix (a).** In `workout-screen.tsx`'s `onPhaseChanged` callback (~line 1649-1660),
      change the bare `fetch(...)` to match the `loadPeriodization({afterWrite:true})` pattern used
      by `handleDurationPresetChange` — either call `loadPeriodization({afterWrite:true})` directly
      if it fits the callback's needs, or add the same `{ cache: 'no-store' }` override to the
      existing fetch call. Confirm on the local dev server: trigger a phase transition, reload the
      prescription view within 60s, confirm it shows the transitioned state not the pre-transition
      one (network tab should show the fetch bypassing HTTP cache).
- [ ] **Task 2 — fix (b).** Add `invalidatePrescriptionChanged(programSessionId)` to the success path
      of the `aiPrescriptionPending` effect (`workout-screen.tsx:550-563`), matching every sibling
      trigger site. Confirm on the local dev server: force an auto-applied transition (or simulate
      via the API), back out to session-select within `TTL_LONG`, confirm the session card shows the
      post-transition phase/confidence text, not stale cached text.
- [ ] **Task 3 — investigate and fix (c) if confirmed.** Trace what actually re-reads
      `ai-periodization-session:${sessionId}` after `mood-checkin-sheet.tsx`'s duration-preset POST.
      If it's a bare fetch reachable within the 60s window, apply the same `cache: 'no-store'` /
      `invalidatePrescriptionChanged` fix. If it turns out the sheet always closes/unmounts before
      any stale read could surface, note that in the PR and skip the code change — don't force a fix
      for an unreachable path.
- [ ] Run the full test suite + lint. Local dev-server pass on the workout flow (start session →
      trigger a transition → back out → confirm session-select — CLAUDE.md testing bar).
- [ ] Remove this entry from `docs/implementation-backlog.md`, add the journal entry + `projectOverview.md`
      update in the same PR.

## Out of scope

The broader Cache-Control sweep (checked ~70 other `max-age` routes) found no other candidates —
don't re-sweep the whole app as part of this fix.
