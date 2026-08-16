# Fix: dead-route / dead-field cleanup batch

**Source:** `docs/reviews/2026-07-20-wiring-caching-perf-audit.md` §5. Branch:
`fix/dead-route-field-cleanup`.

## Problem

A full sweep of all ~85 API routes (this session, combined with the already-audited 2026-07-18
batch) found 8 wiring-hygiene gaps: one user-visible fake-data bug (leaderboard streak), two fully
dead routes (one of which received real bug-fix effort today despite being unreachable), and five
computed-but-never-rendered fields.

## Findings & fixes

1. **Leaderboard "Streak" tab shows fake 0d for everyone (HIGH).**
   `app/api/friends/leaderboard/route.ts:75,78` hardcodes `weeklyStreak`/`allTimeStreak` to `0`.
   `components/more/friend-leaderboard.tsx` has a full "Streak" ranking mode wired to these fields
   (lines 17, 22, 27, 71-79). Fix: compute real streaks server-side, reusing the canonical streak
   logic already in `app/api/streak-data/route.ts` (One-Formula-One-Place — do not write a second
   streak implementation), joined into the leaderboard query per-friend. If computing weekly AND
   all-time streaks per-friend turns out to be materially expensive at query time, an acceptable
   fallback is removing the "Streak" tab until it can be built properly — but prefer wiring it up.

2. **`app/api/sync-workout/route.ts` is entirely dead (MEDIUM).** Zero callers anywhere in the repo
   (app/components/lib/android), confirmed by grep — yet was edited today (commit `30200c0`,
   WK-15) fixing a real bug inside unreachable code. Confirm `sync/push`'s generic `MutationSchema`
   envelope (`workout_log` domain) genuinely supersedes this route's functionality, then delete the
   route and correct the stale references in `docs/module-map.md:122,401`.

3. **`app/api/running-plan/explain/route.ts` is dead — built but never wired (MEDIUM).** The route
   works (Gemini-narrated rationale) but `components/running/prescribed-run-card.tsx:32,52,54-67`
   renders the raw deterministic `rationale`/`gateReasons` directly and never fetches `/explain`.
   Fix: wire it in — fetch `/explain` from `prescribed-run-card.tsx` (or `running-plan-content.tsx`)
   and render the warmer narration in place of (or alongside) the raw fields, matching how
   session-explain's insight narration is surfaced elsewhere. This is real, already-built value;
   prefer wiring over deleting unless the implementer judges the UX addition isn't worth the extra
   AI call.

4. **`GET /api/program-phases` is orphaned with a misleading comment (MEDIUM).** Every real caller
   (`workout-data`, `weights-summary`, `readiness-score`, `nutrition-goals/recommend`,
   `program-week`, `sync-workout`, `daily-digest`) calls `repo.listProgramPhases()` directly. Fix:
   delete the route (confirm zero client callers first, same grep method as finding 2).

5. **`AiPrescription.weeklyVolumeContribution` is dead (MEDIUM).** Computed in
   `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts:84-92,100,414-423,443`,
   persisted, never read by `components/workout/ai-prescription-card.tsx`. Fix: surface a
   per-muscle delta on the card (mirror `workout-review-sheet.tsx:202-216`'s existing
   `weeklyImpact` UI pattern) — or drop the field if the implementer judges it's not worth a UI
   addition. Prefer surfacing since the computation already exists and is non-trivial.

6. **`readiness-score` route ships 3 unread fields (LOW/MEDIUM).**
   `ownReadinessContributors`/`recoveryIndexHours`/`baselineNights` (`route.ts:443-445`) are never
   destructured anywhere except a client-side placeholder that nulls them out
   (`health-score-detail.tsx:146`). The route's own comment says `recoveryIndexHours` is "display
   only," implying a planned surface that never shipped. Fix: either add a small display for these
   on the Readiness detail screen (contributors breakdown, recovery-index hours, baseline maturity)
   or strip them from `ReadinessScoreResponse` if not wanted. Low priority — fold into whichever
   side of this batch the implementer reaches first.

7. **`ExerciseHistoryEntry.sessionName`/`.isDeload` dead (LOW/MEDIUM).** Computed with a
   nontrivial join (`app/api/exercise-history/route.ts:23-25,41-51`, `isDeloadRow()`), never
   rendered — `components/exercise-history-sheet.tsx`'s "Session Log" table reads both into state
   but displays neither. Fix: add a deload badge to the session-log row (small UI addition) — or
   drop the fields if not wanted.

8. **workout-review response `.phase` unused (LOW, trivial).**
   `app/api/workout-review/session/[sessionId]/route.ts:142` returns `phase`,
   `workout-review-sheet.tsx` types and stores it but never reads it. Fix: drop the field from the
   response type (no UI addition warranted for this one — it's genuinely unneeded).

## Files touched

`app/api/friends/leaderboard/route.ts`, `app/api/streak-data/route.ts` (read only, for the
canonical logic), `app/api/sync-workout/route.ts` (delete), `docs/module-map.md`,
`app/api/running-plan/explain/route.ts`, `components/running/prescribed-run-card.tsx`,
`app/api/program-phases/route.ts` (delete), `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`,
`components/workout/ai-prescription-card.tsx`, `app/api/readiness-score/route.ts`,
`components/health/health-score-detail.tsx`, `app/api/exercise-history/route.ts`,
`components/exercise-history-sheet.tsx`, `app/api/workout-review/session/[sessionId]/route.ts`,
`components/workout/review/workout-review-sheet.tsx`.

## Verification

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` green after each sub-fix.
- `pnpm dev`: verify the leaderboard Streak tab shows real, non-zero values matching
  `streak-data`'s own numbers for the same user; verify deleting `sync-workout`/`program-phases`
  doesn't break any route that was silently depending on them (full route-level smoke: hit every
  route that used to call `repo.listProgramPhases()` via the deleted route, confirm still 200s via
  direct repo calls).
- `pnpm dev`: confirm the running-plan explain narration (if wired) renders correctly on the
  Running tab; confirm the AI-prescription card's weekly-volume delta (if surfaced) matches the
  computed value; confirm the exercise-history deload badge (if added) shows on a known deload-week
  session.
- No native/device-only behavior for any of these — server/JS + UI only.

## Rollback

Each of the 8 items is independent and can be reverted individually. Route deletions (2, 4) are
the only irreversible-feeling steps — but since both are confirmed zero-caller dead code, deletion
is safe; if a hidden caller is later discovered, re-add from git history.
