# 2026-08-14 — Stale sleep window traced to a full local repro; sharper DB-pool-contention evidence

**Domain:** sleep · devices · platform — docs-only, no code shipped this session

## What happened

Owner reported the app's displayed bedtime for the night of Aug 12→13 (1:15am) looked far too late —
they were certain they'd been asleep earlier, with brief wake-ups from overheating. This came right
after Q-71 (the anchor-lag fix) merged, but the size didn't fit: Q-71 tops out at a ~3 minute
correction, and this was a 2h35min gap between the stored value and what the ring's actual data
supports.

## Investigation method

Rather than keep hand-tracing the window-detection code (`clampToDenseSensing` /
`denseSensingSpan` in `lib/sleep/sensing-span.ts`, the sleepSignal clustering in
`aggregateOuraRawSamples`), which kept producing contradictory results against manual reconstruction,
built a full local reproduction:

1. Pulled all of that night's real raw ring samples (11,208 rows across 9 tags) and the real
   per-user clock anchors (3,000 rows) from production via the `claude_ro` read-only endpoint,
   paginated.
2. Loaded them into the local dev Postgres under a throwaway test user (CSV + `\copy`).
3. Ran `repo.aggregateOuraRawSamples(...)` — the actual shipped function, completely unmodified —
   directly against that data, both with `fullHistory: true` + `debugDate` (to get the per-epoch
   diagnostic dump) and as a bare incremental call.

Both runs produced the identical, correct result: sleep 22:40pm→8:05am (8.5h), onset 10 minutes,
with the neural sleep-stage classifier correctly flagging a brief HR-up/movement epoch around
00:50am as `awake` — i.e. exactly the owner's account (real sleep, brief overheating wake bouts
folded into the session rather than treated as delaying sleep onset). The mechanism the owner
suspected ("shouldn't this clamp from first sleep and treat other moments as awake time") already
exists in the code and works correctly when given the real data.

**What's live in production does not match this.** The stored row (`oura_id: ble:33100097`,
`sleep_start` 1:15am) is stale/wrong by every check run against it:
- No gap over 2 hours anywhere in the night's raw `sleep_acm_period`/`sleep_temp` stream (biggest
  gap found: 17 minutes) — rules out the clustering step splitting the night.
- No `bedtime_period` (0x76) ring event exists for this night — rules out a bedtime-event override.
- Every raw sample for the night has `decoded IS NULL` — rules out a stale persisted-decode value
  (Lever 1 already applies uniformly; everything re-decodes fresh from `body_hex`).
- The ds→wall-clock offset used matches the app's own displayed wake time exactly (verified against
  the screenshot), so this isn't a second, undiscovered clock issue.

## Leading theory: DB connection pool contention

Checked `error_events` for the surrounding window and found a much sharper burst signature than the
standing `[platform]` Q-107 finding (DB-pool contention, open since 2026-08-05) had previously
measured: a chronic background rate of 1–9 timeout/connection-terminated errors per hour sustained
for 3+ days, plus two much sharper bursts — 23 errors in one hour, 15 in another — each hitting
15-20+ unrelated routes within a ~20-minute window (not just sleep/Oura routes: workout sessions,
nutrition, sync/pull, readiness score, and more). That's the shape pool exhaustion predicts
(everything competing for a connection fails together), stronger than the 2026-08-08 measurement on
the same fault found (max burst there was 5). The now-live `cause` capture (Q-142) confirms the
actual mechanism: `[cause: timeout exceeded when trying to connect]` on the app's own `pool.max: 10`,
not a Postgres-side `statement_timeout`. Postgres itself has plenty of headroom (`max_connections`
500, only 11 in use when checked) — this is an app-pool-sizing problem under burst load, not a
database capacity problem.

The stale sleep row was last written a few hours after the second burst ended. That's a plausible
downstream mechanism (a rollup run completing overall while one of its internal reads silently saw
a partial view during contention) but not a proven causal chain — recorded as a lead, not a fact.

## What shipped this session

Nothing to the app — this was pure investigation. Two doc updates:
- `docs/implementation-backlog.md` — new entry **Q-225** (the stale-window bug, with the full
  reproduction method documented so a fix session doesn't have to re-derive it) and an amendment to
  the existing **Q-107** entry with the sharper burst evidence.
- `projectOverview.md` — a new Known-Issues row for Q-225, an amendment to the existing Q-107 row,
  and a Current Status pointer entry.

## What's NOT done

- The stale row in production has not been corrected — that needs an admin Redecode
  (`fullHistory: true`) run against the owner's real account, which is session-gated and needs the
  owner's own login (same constraint as Q-71's historical backfill).
- Other recent nights weren't checked for the same bug — the local-repro harness built for this
  investigation (raw-sample + anchor export → local DB load → direct function call) is reusable for
  that sweep without re-deriving the method.
- The pool-contention → stale-row causal link is unconfirmed, not just unproven-but-likely.
- No code fix was written for either the pool sizing or the rollup's apparent lack of a
  self-healing recompute when a night's data arrives incrementally across a contention window.

## Pickup prompt

```
Read projectOverview.md, then docs/domains/sleep/README.md and docs/domains/platform/README.md,
then this handoff doc, then docs/implementation-backlog.md's Q-225 and Q-107 entries in full.

Q-225 (sleep, stale window) and the Q-107 amendment (platform, DB pool contention) are both
diagnosed but not fixed. Two independent next actions, either can go first:

1. Ask the owner to run an admin Redecode (fullHistory) on their account via the oura-ble
   admin tester, to correct the stale night investigated here (and check whether other
   recent nights need the same). The Q-225 entry's local-repro method (pull raw samples +
   anchors from claude_ro, load into local Postgres, call aggregateOuraRawSamples directly)
   is reusable to check other nights first, without needing the owner's session.

2. Confirm the pool-contention → stale-row causal link before building a fix — Q-107's own
   history shows this exact theory looked strong once before (2026-08-05/06) and was then
   found weaker on closer measurement (2026-08-08). Don't skip that step this time either.
   If confirmed, the two candidate fixes are named in the Q-107 entry: chunk getSyncDelta's
   fan-out, or raise pool.max (Postgres has headroom to 500 connections) — the latter touches
   the load-bearing pool config CLAUDE.md flags, so treat it with the same care as the
   timeout/error-handler settings next to it.
```
