# 2026-09-01 · Lane A — a chosen rest day becomes a stored fact (BF-84, engine half)

Branch `lane-a/rest-day-stored`. Migration **247** (`rest_days`) + **248** (`claude_ro` views).
New outbox domain `rest_days`. No native change, so no APK — this reaches the device through
Railway. **Not device-verified.**

## What the feature actually was

`lib/home/rest-day.ts` — a `localStorage` key, and its own comment was the finding:

> `/api/log-rest-day` persists nothing (rest days are inferred from gaps in workout history), so
> refetching `/api/next-session` after choosing rest just recomputes the prompt and reverts the
> selection.

Three consequences followed. The second device never saw the choice. It died on a reinstall. And
any refetch undid it — which is the one the owner would have hit first, because the control is one
tap away from a screen that refetches.

The route existed and returned `{ ok: true }`. Reading a 200 as "saved" is the shape of this bug.

## The owner settled it as a fact, and the criterion is the reason

Asked *fact or hint?*, the owner answered *"whatever would be better in the long run"* — so the
call came back with the criterion attached:

- **Rest days are training data.** As a display condition only, training load, weekly cadence and
  phase counting all read a chosen rest as a *missed* session rather than a taken one.
- **"No workouts logged" is not the same claim as "I chose to rest."** A day with no logs is also a
  day you forgot, were ill, or logged late. No display logic recovers a distinction that was never
  written down.

## What shipped

`rest_days (id, user_id, date, created_at, updated_at, deleted_at)`, unique on `(user_id, date)`.

**A tombstone rather than a hard delete**, and the reason is specific to this domain rather than
inherited from the convention: the old marker expired at midnight, so a mistap cost you an hour.
Stored, a mistap is durable, and the undo has to be as reliable as the mark. Re-choosing resurrects
the same row.

**Deliberately not a row in `day_checkins`.** Every column there is a self-report scale keyed by
`(user_id, log_date, phase)`, and the calibration queries filter on those. A rest choice is not an
answer to a check-in question; putting it there means a row with every scale NULL under an invented
phase.

`getNextSession` prefers the stored row over inference, **after** the already-trained branch and
**before** the readiness/AI one:

- After already-trained, because logging a workout is a stronger statement than having said earlier
  that you would rest. The row survives that, so deleting the session tomorrow does not lose the
  choice.
- Before readiness, because that branch is the expensive one *and* the one that would otherwise
  offer a deload prompt on a day the user has already said they are resting.

`/api/log-rest-day` and the `rest_days` push branch both call one `setRestDay`. The client goes
through `chooseRestDay`, which queues the outbox row when the local store is there and POSTs when it
is not — so a choice made offline is carried rather than lost.

## No local SQLite table, and this was a decision

Every one of the entry's three failures is fixed by the server row alone: the second device reads
`/api/next-session`, a reinstall reads it too, and a refetch now agrees instead of reverting. The
only thing a local table would add is reading *historical* rest days offline, which nothing does —
`withRestDayOverride` only ever cares about today, and cadence and prescription are server-computed.

So the `localStorage` marker stays, with its job changed: it is the optimistic echo between the tap
and the next fetch, and the offline view of today's choice. That is a legitimate client cache. What
it could never be was the only copy. Adding a local table later is additive and cheap; standing one
up now for a reader that does not exist is not.

## The timezone bug found on the way

Every function in `rest-day.ts` took `todayInTz()`'s default — the owner's zone — while the seed
path calling it stamped its cache with `todayInTz(tz)`. For a user outside that zone the marker and
the seed disagreed about which day it was, for hours a day. `tz` is threaded through all four
functions and all five call sites now.

## Mutation testing, and the two that survived first

Fifteen mutations, each killed by the case named for it in the test file's header — dropping the
`restChosen` branch, moving it above already-trained, making the withdrawal a no-op, hard-deleting
instead of tombstoning, unscoping each read, defaulting a missing `resting` to a withdrawal, and a
dash-only date regex.

Two survived a first draft and are worth recording because both were tests that could not fail:

1. **The push branch's slash→dash replace.** Removing it failed nothing: `date` is a DATE column and
   Postgres parses `2026/08/22` to the same day. It stays for shape-consistency with the other
   nineteen branches, and the code now says it is not load-bearing rather than implying it is.
2. **`tz` dropped from the marker write.** The test used a zone four hours from Brisbane, and four
   hours apart means agreeing twenty hours a day. Fixed by *deriving* the test zone at runtime from
   a pair 26 hours apart — always different days, so whichever of them disagrees with the default
   right now is the one used. That is the standing rule for this class: a test that waits for its
   window is a test that mostly does not run.

## What is not done

The **surface half**, which is Lane B's: the owner asked for the rest button to be available on
Home's card when the app has *not* suggested rest. `recommendation-card.tsx` already renders
`onRestDay` — inside the `deloadOrRestRecommended` branch — so it is a rendering condition plus a
`Moon`/`BedDouble` icon and `variant="secondary"`, not a new control. It is safe to ship second:
the storage exists now, so the new button cannot lose a choice. BF-84 stays in the queue as Lane B
with that half named.

Verified on `pnpm dev` against the local database. **Not exercised:** native SQLite/Capacitor (the
outbox path runs only on the APK), safe-area, Samsung WebView, prod data drift.
