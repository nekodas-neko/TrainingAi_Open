# 2026-08-09 — Q-165 was a triage, not a sweep (and it uncovered a chart that never rendered)

**Branch:** `refactor/bare-fetch-to-cachedfetch` · **Domain:** `app-shell`, `platform`,
`heart-rate` · **v1.276.1**

## What the entry asked for, and what it actually was

Q-165 counted **62 client GETs using bare `fetch`** against 171 going through `cachedFetch`, and
named ~24 that "look like genuine render-path reads". It was honest about its own limit: those 24
were classified *from the route name plus the call window*, not by reading each call site.

Reading them changed the number a lot. **Three** were genuine.

| Called out | Reality | Converted? |
|---|---|---|
| `day-checkin` ×3 | The `else` arm of `store ? store.getDayCheckin(…) : fetch(…)` — the sanctioned web fallback that never runs on the APK | no |
| `supplements` ×2, `injuries` ×2, `saved-meals` | `DELETE`/`PATCH`, not GETs | no |
| `nutrition/food-logs` | Local-first read; the server call hydrates the local store *after* the local paint | no |
| `phase-sets` ×2 | Deliberate freshness re-reads with written reasons ("so order is always live", "so migration-added phases aren't wiped") | no |
| `workout-templates` ×2 | Post-write refreshes in `onApplied`/`onSaved`, not first paint | no |
| `session-explain/insight` | A **streamed** response, already hand-seeded with `readCacheSync` + `setCached` — `cachedFetch` cannot express it | no |
| `ai-periodization/session` | Same: already hand-seeded, plus a `cache: 'no-store'` after-write escape hatch and a 404 recovery branch | no |
| `achievements`, `exercise-history` | One-shot actions (XP delta after a workout; swapping an exercise) | no |
| `nutrition/food-items` ×2 | Search-as-you-type, unbounded key space | no |
| `oura/hr-window` ×3 | **Genuine** — a fixed, already-finished window, re-openable | **2 of 3** |
| — (not in the entry) | `coach/threads` — **genuine**, and the entry missed it | **yes** |

So the entry's ~24 was an over-count by roughly 8×, and it under-counted by one. Both directions
matter: the useful output here is the classification, not the diff.

## What changed

- `components/activity/activity-detail-sheet.tsx` and `components/activity/exercise-review-sheet.tsx`
  seed from `readCacheSync` and revalidate via `cachedFetch`, keyed `hr-window:<query>`. Keyed by the
  **window**, not the activity id — editing an activity's times misses the seed rather than painting
  the pre-edit trace.
- `components/coach/coach-history.tsx` likewise, keyed `coach-history`.
- New canonical TTLs: `HR_WINDOW_TTL` (MEDIUM) and `COACH_HISTORY_TTL` (LONG).
- Invalidation, in the same commit as the keys: `invalidateOuraSync()` now clears `hr-window:`, and a
  new `invalidateCoachHistory()` is called from all three writes that add a history row (thread save,
  and both apply paths).

`done-activity-screen`'s hr-window call is left alone on purpose: it is the screen shown once when an
activity has just finished, so there is no repeat visit to seed, and its HR is the data most likely
to still be landing.

## The thing that could not be verified, because it had never worked

Opening the activity detail sheet returned **400** from `/api/oura/hr-window`. Not a regression from
this change — the route's gate was `/^\d{2}:\d{2}$/`, and `activity_logs.start_time` is a Postgres
`time`, which serialises as **`HH:MM:SS`**. The sheet passes it through untouched.

That gate rejected **every** call that sheet has ever made. The HR chart, the zone breakdown and the
HR-coloured route line in the activity detail sheet have never rendered for any activity.

This is the schema/handler-agreement failure CLAUDE.md already records for the dash-vs-slash date
regex, one field along: the rejection happens *before* the handler, and the client swallows it
(`.catch(() => {})`), so the section just stays empty and looks like "no Oura data for that window".

Fixed by accepting optional seconds. Seconds are then dropped — the window already snaps to whole
minutes (the end takes `:59`). A DB-backed route test pins all three cases (HH:MM:SS accepted,
HH:MM still accepted, garbage still 400) and was **proven to fail against the old regex** before
being kept.

A comment in the sheet asserting `log.startTime/endTime are bare "HH:MM"` was corrected in the same
pass — a false premise sitting two lines from the bug is how it comes back.

## Verified

- Full gate: `tsc --noEmit` clean · **428 files / 3419 tests** green · all 14 custom-rule scripts pass
  · eslint clean (the one remaining warning in `activity-detail-sheet.tsx` is pre-existing on `main`,
  confirmed by stashing).
- Browser at 412×915 against `pnpm dev` and the local DB, with a seeded activity and 45 HR samples
  inside its window:
  - `/api/oura/hr-window?date=…&startTime=08:00:00&endTime=08:45:00` → **400 before, 200 after**
    (`avgHr 109`, `maxHr 119`, 45 readings).
  - Opening the sheet wrote `ta_cache:hr-window:date=…` plus its sessionStorage mirror; after a full
    page reload the seed was still present, so the next open paints from it.
  - `/coach` → History wrote `ta_cache:coach-history`, still present after navigating away and back.

**Watch out for this while verifying:** the same click looked like it made *no request at all* across
three runs. It was route compilation — `.next` had been deleted, and the first hit on a
not-yet-compiled API route took longer than the 8-second wait. Nothing was wrong. An 8s wait after an
interaction is not enough on a cold dev server; 35s was.

## Not exercised

The APK. Nothing here is device-verified: the native SQLite cache layer (`isSQLiteAvailable()` is
false in the sandbox, so every `setCached`/`readCacheSync` above went to localStorage, not the
`api_cache` table), Samsung WebView rendering of the now-actually-rendering HR chart, and the
offline path where the seed is all there is.

## Filed, not fixed

**Q-172** — `components/chat.tsx` has two sign-out buttons that post a bare `<form action={signOut}>`
with neither `clearAllCache()` nor `clearLocalStoreData()`, while More → Profile does both. The next
account on that device paints from the previous account's cache seeds. Found because deciding whether
a new cache key could leak across accounts required knowing whether sign-out clears the cache — and
the answer turned out to be "depends which button". Not fixed here: it is an auth-adjacent path and
a separate change.
