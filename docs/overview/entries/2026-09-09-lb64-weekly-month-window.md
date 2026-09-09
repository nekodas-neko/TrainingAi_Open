# 2026-09-09 — a monthly window for the weekly recap (LB-64)

**PR:** `lane-a/lb64-weekly-month-window` · **Lane A** · no migration, no client change.

## What it is

`GET /api/weekly-review/month-window` — five weekly buckets of the four metrics
`/api/day-review/week-window` already serves daily (resting HR, steps, session volume, weight),
plus `priorAverages` over the four completed weeks before the judged one.

## Why a new route rather than widening `weekly-digest`

LB-64's own recommendation, and it held up on re-verification against `main`. `/api/weekly-digest`
computes all these numbers and throws them away, returning `{ digest, weekStart }` — so returning
them beside the prose is genuinely the cheaper change. It was still the wrong one: that route is a
**POST that runs an LLM**, rate-limited and cached as prose, and Q-293's own source comment says the
digest is deliberately re-derived because a late ring back-fill changes its inputs. A chart wants
freshness on a different clock from a paragraph. So: a cacheable GET with its own TTL, no model in
the path, `Cache-Control: private, no-store` like every sibling.

## The two rules that are easy to get backwards

- **Daily metrics are meaned across the week; session volume is summed.** Several sessions share a
  week, so a `Map.set` per session is last-write-wins — it reports the *last* session's volume as the
  week's. Mutation-verified: last-write-wins reads 500 where the week is 1500.
- **A week with no rows is `null`, never `0`.** Zero steps and no recorded steps are different
  claims, and the render draws them differently.

`weekStart` snaps any day to its Monday, defaults to the **last completed** week (never the
in-progress one, which would average a partial week against four full ones), and goes through
`normalizeDateParamIso` — a malformed param is a 400, never a silent substitution.

## Verification

Eight cases, mutation-tested with eight mutants: seven caught, one control. The control —
a second `inWindow.has(key)` guard on the volume loop — survived because it was genuinely dead:
the explicit `day < from || day > to` check above it already bounds the window, and `from` is a
Monday by construction, so every day in range maps to a known key. It was **deleted, not kept**.

One mutant (M5, the volume-summing rule) first reported `SKIP: anchor count 0` — an indentation
mismatch in the anchor string, not a passing mutant. A skipped mutant is not a caught one; it was
re-run with a corrected anchor and caught. Worth stating because the summary line looks the same
either way at a glance.

The test file pins `TZ = 'Etc/GMT-10'`, a fixed offset, so the week-bucketing case fires on every CI
run rather than only inside some window of the day.

**Not exercised:** nothing on-device — this is a server route with no client reader yet. Q-112e is
the consumer and is Lane B's.
