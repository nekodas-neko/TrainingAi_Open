# 2026-08-19 — a date-shaped string that is not a real day (Q-496)

**Branch:** `fix/ingest-date-semantic-validation` · **Lane:** Implementation A

## The entry named one route. It was the wrong one.

Q-496 was filed against `health-connect/ingest`: `2026-13-45`, `2026-02-31` and `0000-00-00` each
returned **500** plus an `error_events` row (`[pg 22008]`) — a client input error recorded as a
server fault, in the very table every session is required to read.

**Q-494 had already closed that route** the same day, as a side effect of bounding the range. Verified
before touching anything: all three inputs now answer `200` with the date clamped to today, and
`error_events` stayed at 14.

So the entry looked closeable. **It was not.** Sweeping for the same shape — a date-shaped Zod regex
with no calendar check — found four other routes, and driving each one found the defect alive in two
places that the entry never named:

| site | before |
|---|---|
| `POST /api/day-checkin` | **500** + an `error_events` row |
| `POST /api/sync/push` (`MutationSchema.date`) | the entire failed **INSERT statement echoed to the caller** |
| `POST /api/food-logging-complete` | 400 — safe |
| `POST /api/sync-health` | 400 — safe |

`day-checkin` is the sharper find, because **the guard was already in the same file**: its `GET`
routes the param through `normalizeDateParamIso` and answers 400, three lines above a `POST` that
took `b.date` straight to `logDate`. A sibling-surface miss, not a missing concept.

The push path is the Q-320 leak class reached through a date rather than through a catch: the
mutation dead-lettered with a driver error as its message, and the client was handed the SQL.

## What shipped

- **`isCalendarDate(dateStr)`** in `packages/shared/src/date-utils.ts` — one predicate, both
  separators. `Date` will not refuse Feb 31 (it normalises to March 3), so the test is a round trip:
  a value that is not its own zero-day shift was never that day.
- **`MutationSchema.date`** gains `.refine(isCalendarDate)`. A mutation failing it is dropped and
  quarantined by the route's **existing** per-item handling — deliberately not a 400 on the batch,
  which would strand every valid mutation queued behind it.
- **`day-checkin` POST** routes `b.date` through `normalizeDateParamIso` and answers 400, matching
  its own GET.
- **`resolveIngestDate`** now calls the shared predicate instead of carrying a second copy of the
  round-trip test.

## Verified against running routes

| | before | after |
|---|---|---|
| `day-checkin` POST, all three inputs | 500 + `error_events` row | **400 `{"error":"Invalid date"}`**, no row |
| `day-checkin` POST, a real date | works | works — control |
| `sync/push`, malformed mutation date | full INSERT echoed | **`{"processed":0,"errors":[]}`** — dropped, nothing leaked |

`error_events` unchanged across the whole after-run (15 → 15). Full suite with `DATABASE_URL`:
**503 files, 4,273 tests, 0 failed.** `tsc` clean, `pnpm check:rules` **Ran 49 of 49**.

## Why the two sites answer differently, deliberately

`day-checkin` **400s** and the ingest route **clamps**. That is not an inconsistency:

- `day-checkin` is a session-authenticated interactive write. A malformed date is a broken client,
  the user is present, and its own GET already 400s — matching it is the consistent choice.
- `health-connect/ingest` is secret-gated and outbox-replayed. A 400 quarantines the mutation and
  loses a real reading over a bad clock, which is the argument `resolveMeasuredAt` already makes.

## Not exercised

Production, the real Tasker client, anything on device. `admin/timing-baseline` and
`ai/health-insight` also carry a shape-only date regex and were **not** driven — the first is
admin-gated, the second is a paid AI call. Neither is claimed clean; they were out of reach of a
cheap probe, and that is the honest state. No migration, no schema change, no auth change. Local
secrets used for the reproduction were written to `.env.local` and removed again.
