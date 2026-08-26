# 2026-08-26 — somewhere to put a measured RMR, and a rule for how it ages (BF-33)

**Branch:** `feat/measured-rmr` · **Lane A** · migrations **225** + **226**. No APK.

The owner has a DEXA + RMR test booked. Every resting rate the app used was **predicted** — Cunningham
when lean mass is known, Mifflin-St Jeor otherwise — and there was nowhere to put a measured one.
The entry is explicit that this gets built *before* the appointment, so the numbers have somewhere to
go on the day rather than afterwards.

## The decision the entry left open: how a measurement ages

A measurement cannot be trusted forever — an RMR measured at 71 kg is not the RMR at 78 kg, and a
stale number silently outranking a live estimate is worse than having no measurement. The entry named
two candidates: *a validity window, or re-scaling by lean mass.*

**Re-scaling, and the reason is not preference.** A validity window fails at both ends: full trust the
day before expiry, total discard the day after — while the thing that actually invalidates the
measurement is a change in body composition, which has no fixed relationship to elapsed time. Someone
weight-stable for two years has a better measurement than someone who gained 8 kg in three months.

Cunningham is **linear in fat-free mass** (`ffm·21.6 + 370`), so a measurement carries exactly one
thing the prediction does not: **this person's residual from it.** Keep the residual, re-apply it at
today's fat-free mass. The measurement then ages by how much the body changed rather than by the
calendar, degrades smoothly instead of falling off a cliff, and a second test simply supplies a
better residual. That is `personalRmr` in `packages/shared/src/health/body-composition.ts`, beside
`cunninghamBmr` — one place, because **two** call sites compute a resting rate today
(`goal-recommendation.ts` and `energy-balance-service.ts`).

Without a fat-free mass from the test there is no residual, so the raw measurement is returned
unchanged. That is honest about what was measured; re-scaling it anyway would invent precision.

## Its own table, not a column on `body_metrics`

`body_metrics` is one row per calendar day of ordinary readings. A clinical measurement is a
different kind of thing — a handful of events, each with a provider and a method — and the entry is
explicit that **a second test must sit beside the first**, because two measurements at different body
compositions are how you learn whether the first still describes this person. A column on a daily
table is overwritten by the next day's upsert and has nowhere to record who measured it. `UNIQUE
(user_id, measured_on)` makes "beside, not over" true at the schema level: same date corrects a typo,
a later date is a new row.

## Verified

- **13 new tests, all green.** Eight pin the ageing rule — that the measurement reproduces exactly at
  the FFM it was taken at, carries its residual up *and* down by Cunningham's slope, returns the raw
  value when either FFM is unknown, and refuses junk rather than propagating it. Five are DB-backed:
  storage round-trip, a second test sitting beside the first, same-date correction, user scoping, and
  **the entry's actual bar — that `calculateBaseline` returns a different calorie target with the
  measurement than without.** Storing it and not moving the goal would have been the failure mode.
- **Full suite 602 files / 4,921 tests green** — exactly +13. `tsc --noEmit` clean ·
  `pnpm check:rules` **Ran 59 of 59**.
- Both migrations applied to the local DB and the views regenerated **after** it, since the generator
  reads the live schema rather than `schema.ts` — the first run produced 85 views without the new
  table for exactly that reason.

## Three gates caught things a review would have had to

Worth recording because each is a rule that fired rather than prose that was remembered:
`check-export-coverage` refused a new table classified in neither EXPORTED nor EXCLUDED;
`check-strict-request-schemas` refused the route's Zod schema without `.strict()`;
`check-dead-repo-methods` — the guard shipped yesterday — refused `getLatestMeasuredRmr` while it
had no caller, which is what made the wiring into `goal-recommendation` part of *this* PR instead of
a follow-up nobody files.

## Two stale details in the entry, corrected

`HEALTH_SOURCES`' warning that the TS ladder and "the inlined SQL `CASE` at line 45" must move
together is **already fixed** — `RANK_WHENS` is generated from `SOURCE_RANK`, so they cannot drift.
And a measured RMR does not join that ladder at all: it is its own table, not a `body_metrics` column
merge.

## What is NOT done — BF-33 stays in the queue

- **No way to enter it yet.** The API route exists (`POST /api/measured-rmr`) and nothing calls it.
  The typed-number field and the AI results-sheet photo path are scope item 3; the 2×2 panel is item
  4 and is Lane B's.
- **The AI path's constraint, so it is not lost:** `generateObject` with a schema, never
  `JSON.parse` of model text, and **no parsed number shown as fact until the owner confirms it** —
  a model handed a score of 80 once called it *"perfect"*.
- **No version bump and no changelog entry**: nothing user-visible ships until there is an input.

## Not exercised

Neither migration has run against production — that happens on the Railway deploy; both are additive
(a new table, a view rebuild) with no data loss. Nothing native, offline-first, safe-area or
gesture-related, so **no device smoke run is owed**.
