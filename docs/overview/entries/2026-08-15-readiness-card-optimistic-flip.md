# 2026-08-15 — the readiness card that said "saved" and stayed on the prompt

Q-248, the owner's top-of-queue item ("add this to the top of the queue - doing the readiness did
not progress it"). v1.317.1.

## What was wrong

The screenshot showed a "Readiness saved" toast sitting on top of an unchanged "EXERCISE READINESS /
How are you feeling? / Log Readiness" prompt. `session-select-content.tsx` gates the whole
recommendation section on `moodLog`: while it is `null` or `undefined` it renders
`ReadinessCheckinCard`, and once populated it renders `RecommendationCard` — a different card, not a
re-skin. So "did not progress" means the parent's `moodLog` never flipped.

In `components/mood-checkin-sheet.tsx` the toast and the sheet close fire synchronously on the tap,
before any await. The callback that flips `moodLog` did not: it sat after `await localWrite`. The
comment directly above that write, added 2026-08-13, already documents the failure — the Capacitor
SQLite plugin holds one connection, so a write landing during a sync pull's `applyDelta` transaction
queues behind the whole delta, and that stalled for ~2 minutes once. That fix stopped the *sheet*
from awaiting the write. It left the *screen behind the sheet* still gated on it.

## The fix, and the constraint it had to respect

An `onOptimisticSave` callback now fires on the same beat as the toast and the close, carrying the
optimistic log the component already built (and already caches under `mood:<date>`).

`onSaved` deliberately did **not** move. It triggers the prescription refetch, and a refetch that
starts before `invalidateCheckinAffectsPrescription()` reads the stale `workout-data` cache straight
back — the session-164 ordering rule, called out in a comment in that function. Hoisting the whole
callback to fix Q-248 would have traded one bug for another. Splitting it means the state the user
is watching flips immediately while everything that refetches stays correctly ordered.

**Home passes the raw `setMoodLog` setter, not a new handler.** Three reasons: a setState function
is already stable, so no `useCallback` is needed; a handler would have added lines to a file that is
on the component-size baseline (it grew 1458 → 1460 on the first attempt and the gate failed it,
correctly); and a setter structurally *cannot* grow a `fetchWorkoutData()` call later, which is the
exact regression that would silently reintroduce the session-164 read. The file is now 1457 lines
and the baseline was lowered to match, since it is shrink-only.

Verified there is only one `MoodCheckInSheet` render site (`session-select-content.tsx`, dynamically
imported) — Home's mood card reaches it through `setMoodSheetOpen` passed down, so there is no
sibling surface needing the same wiring.

Also checked that no consumer of `moodLog` reads `.id`: `rest-day-card`, `readiness-checkin-card`
and `home-card-widget` read `energyLevel`, `sleepQuality` and `soreMuscles` only. The optimistic log
carries all three, and its empty `id` was already being written to the `mood:<date>` cache and read
back on the next mount before this change, so nothing new is exposed to it.

## Verification

`components/__tests__/readiness-save-optimistic-flip.test.ts` guards the arrangement, following the
source-reading pattern of `carousel-dot-hit-area.test.ts` — this project's vitest runs
`environment: 'node'` with no JSX transform, so a `.tsx` component cannot be imported and rendered.
Three mutations, each caught by the intended test: removing the optimistic callback, moving it
behind `await localWrite`, and hoisting `fetchWorkoutData()` into the optimistic handler.

Local `pnpm dev`: `POST /api/mood` returned 200 with a real row; `/` and `/session-select` both 200
with no errors in the dev log. `pnpm build` · `npx tsc --noEmit` · `pnpm lint` (0 errors) ·
`pnpm check:rules` — **35 of 35** · full suite **477 files / 3,935 tests, none skipped** under the
TCP `DATABASE_URL`.

## What was not done, and why it matters here

**The entry's step 1 was "reproduce on device with a sync pull in flight before changing
anything", and that did not happen** — there is no device in this session. So what is shipped is a
fix for the cause the code evidences, not a fix confirmed against the observed failure.

The distinction is real: the screenshot cannot separate "still mid-stall" from "`onSaved` never
fired at all for some other reason". If it was the latter, this change makes the card flip anyway
(the flip no longer depends on the write), so the owner's symptom should still be gone — but the
underlying write would still be failing silently, and that would show up later as a readiness log
that never syncs. **If the card now flips but a day's readiness turns out to be missing from the
server, that is the second cause and it is still open.**

The stall theory itself remains unconfirmed. The device check that would settle it: trigger a sync
pull, log readiness mid-pull, and watch both whether the card flips immediately (it should now) and
whether the log reaches the server afterwards.
