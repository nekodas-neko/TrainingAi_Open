# Plan — Health Connect as a first-class source tier

_Created 2026-08-02. Implements tiers 1–2 of
[`docs/device-agnostic-source-architecture.md`](../../device-agnostic-source-architecture.md).
Backlog entry: **Q-41**._

**Branch:** `feat/health-connect-source-tier`

## Why now

A friend is using the app today. Every score card on their Home and Health screens reads
`oura_daily` / `oura_daily_derived` with no fallback, so they render blank. The owner asked for
"whatever is possible from Health Connect" and explicitly capped the effort: *"do what you can but
don't spend too much time on it. Try get it to a working state with HC."*

That cap shapes this plan. It closes the two things that make the app look broken for a non-Oura
user, fixes one real data-quality bug, and stops there.

## Constraint that shapes every task

**The owner has Health Connect switched off**, and there is no second device in the sandbox. So
this work cannot be verified end-to-end by the person writing it. Every task below is therefore
built to be **provable from unit tests against real fixtures**, with the device pass listed
separately as an explicit gap. Do not claim tier 2 works; claim the tests pass and name what is
unverified.

---

## Task 1: Route Health Connect sleep through the provenance layer

The bug: `repo.saveSleepSession()` takes no `source` and skips `sourceMap`
(`lib/data/postgres/adapter.ts:2401–2415`), so HC sleep lands with rank-0 provenance and
first-write-wins. Every other health write goes through `mergeSet`. Harmless while HC is off; a
silent data-quality bug the moment it is on.

**Files**
- Modify: `lib/data/repository.ts` (add `source` to the `saveSleepSession` signature)
- Modify: `lib/data/postgres/adapter.ts:2401–2415`
- Modify: `app/api/sync-health/route.ts:167` (pass `'health_connect'`)
- Test: `lib/data/postgres/__tests__/` — new file

**Steps**
1. Write a failing DB-backed test: write a sleep row as `health_connect`, then the same night as
   `oura_ble`; assert the ring values win per-field and `source_map` records it. Then reverse the
   order and assert the same outcome — that is what distinguishes rank-merge from first-write-wins.
2. Add the optional `source` parameter, defaulting to `'unknown'` so existing callers compile
   unchanged.
3. Switch the implementation to `mergeSet('sleep_sessions', …)`, matching `upsertOuraSleep`
   (`lib/data/postgres/slices/oura.ts:371–379`).
4. Pass `'health_connect'` from the sync-health route.
5. **Sibling sweep** (`CLAUDE.md`): grep every `saveSleepSession` caller and give each an explicit
   source. A caller left on the default is a silent rank-0 writer.
6. Run the file alone first (the DB suite is flaky in parallel), then the full suite.

---

## Task 2: Make the score reads degrade instead of vanishing

**Files**
- Modify: `app/api/readiness-score/route.ts` (~154–248)
- Modify: `app/api/health/trends/route.ts:97–103`
- Modify: `app/api/day-timeline/route.ts:111–112`
- Modify: `app/api/health-trends/route.ts:124–126,198`
- Test: new route tests per file

**Steps**
1. Add a shared helper — `lib/health/score-availability.ts` — returning which inputs a given user
   has for a date, and a `confidence` band derived from that. **Deterministic, in `lib/`, one
   place** (One Formula One Place). Do not inline this per route.
2. In each route, when the Oura-specific row is absent, compute from the generic tables
   (`body_metrics`, `sleep_sessions`) instead of returning `null`, and return an explicit
   `inputsAvailable` / `limited: true` alongside the score.
3. Reuse the existing readiness composite rather than writing a second one — if it can't be reached
   without the `oura_daily_derived` row, extract it (the batch plan already lists that extraction as
   a follow-up; do it here rather than duplicating the math).
4. Boundary tests: no Oura row at all; partial inputs (sleep but no HRV); full inputs — assert the
   full-input result is **unchanged** from today, so tier-1 users see no drift.

**Explicitly not in scope:** re-tuning what the score *means* on reduced inputs. A labelled
lower-confidence score using the existing formula is the deliverable. Re-banding is a separate
question and needs real multi-user data to answer.

---

## Task 3: Surface the limitation in the UI

**Files**
- Modify: the score cards consuming the routes above
- Follow `docs/domains/` for the per-pillar component list

**Steps**
1. When `limited: true`, render the score with a short qualifier. Use an existing `components/ui/`
   primitive — grep before building anything (`CLAUDE.md`).
2. **Colour is not the signal.** Per the colour-only-state rule, pair any visual treatment with
   text or an icon.
3. No new user-visible string may contain "Oura" (see the de-Oura plan).

---

## Task 4: Keep the hypnogram HC already gives us

`lib/health-connect-sync.ts:401–407` reduces the stage intervals to four totals and discards the
structure. The plugin hands us a full hypnogram.

**Steps**
1. Carry the interval array through to `sleep_sessions.sleepPhase5Min` (or the nearest existing
   representation — **check what the Oura path writes and match it**, do not invent a second shape).
2. Test against a realistic multi-interval fixture including an `AWAKE` block mid-night.
3. If the existing column's encoding can't represent HC's intervals cleanly, **stop and write that
   down** rather than forcing a lossy mapping. Half a hypnogram is worse than four honest totals.

---

## Verification

- Full suite green; DB-backed files re-run individually on failure (documented flake).
- `pnpm dev`: exercise every changed route with the seeded user.
- **Cannot be verified in-session:** the actual HC ingest path (owner has it off, no second device).
  Ship with a Known-Issues row saying tier 2 is unexercised against a real Health Connect provider.

## Follow-ups deliberately excluded

- Multi-user tier-1 (a friend using their own ring) — see architecture doc §7.2.
- Play Store Health Connect declared-use-case review — §7.1, gating for real tier-2 users.
- The `oura_*` table rename — its own plan.
