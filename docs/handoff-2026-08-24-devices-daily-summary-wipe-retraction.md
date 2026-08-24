# Handoff — 2026-08-24 · retracting the daily-summary wipe, and narrowing why chronic stress never scores

_Domain: `devices` (also touches `readiness`, `platform`) · Branch: `claude/tuning-agent-0q9yl7` · PR: [#267](https://github.com/nekodas-neko/TrainingAi_Open/pull/267), **merged** as `51ae48c`_

> **⚠️ The measurement ran on 2026-08-20; the session then sat idle and closed on 2026-08-24.**
> Every production number here was pulled on the 20th, when ring data ended 2026-08-20 05:28, and
> `main` moved **105 commits** in the gap. The findings are about code and stored history that has not
> been touched since (Q-528, Q-525 and TN-1 were all still in the queue at close, unactioned), but
> **re-pull before quoting a number.**

> **Read first:** `projectOverview.md` (status + Known Issues), then
> [`docs/domains/devices/README.md`](domains/devices/README.md) and
> [`docs/domains/readiness/README.md`](domains/readiness/README.md), then
> `docs/implementation-backlog.md`. This file covers only what *this* session did and leaves behind.

## Goal

Tuning had no unblocked measurement work and no new owner report, so the session took the one thing
its own baton had parked: *"`oura_daily_summary` was wiped to 1 row — rebuild first, then judge
Q-525."* Checking whether the rebuild had happened is what turned up the real finding.

## Current status

- **Build/test:** `pnpm check:rules` — **Ran 50 of 50 Custom Rules steps, all passed**, on the base
  current at the time of each push (#267's merge base, and again on `427a236` for this wrap-up). `check-backlog-pointers` OK (211 entries, no duplicates, all tagged).
- **`pnpm dev` NOT run, and correctly so** — this session is docs-only and changed no runtime code.
- **Device-verified: n/a.** No native, safe-area, offline, gesture or notification path is touched.
- **Failure surfaces not exercised:** all of them. Nothing here executes.

## What shipped (PR #267, merged `51ae48c`)

| Change | Where |
|---|---|
| The retraction, with its measured replacement | `docs/reviews/2026-08-20-daily-summary-wipe-retracted.md` (new) |
| Retraction banner on the superseded review | `docs/reviews/2026-08-19-daily-summary-replace-wipe.md` |
| **Q-528 rewritten** — latent hazard, not an incident; rebuild half deleted | `docs/implementation-backlog.md` |
| **Q-525 un-suspended and sharpened** — both countable gates measured, both pass | `docs/implementation-backlog.md` |
| **TN-1 filed** — instrument the granular layer before relaxing any threshold | `docs/implementation-backlog.md` |
| Session-start size read now splits exact sizes from estimated row counters | `CLAUDE.md` |
| Baton rewritten at the top; the rule that caused the misread replaced in place | `docs/agents/state/tuning.md` |
| Journal entry | `docs/overview/entries/2026-08-20-tuning-retract-daily-summary-wipe.md` |
| Review linked from both pillar indexes | `docs/domains/{readiness,devices}/README.md` |

## The finding, in short

Yesterday's Tuning session reported `oura_daily_summary` holding **1 row** against 198,223 raw
samples and concluded a `fullHistory` rollup had wiped the history. **It holds 45 rows, and 43 of
them were created 2026-08-17 07:50** — they existed continuously through that reading. Nothing was
wiped, and there was never anything to rebuild.

The count came from `pg_stat_user_tables.n_live_tup`, which is a **planner estimate, not a count**.
`last_analyze` and `last_autovacuum` are NULL on every table in this database, so those estimates are
whatever a prior stats state left. Two measured counter-examples on the same day: `n_live_tup` reads
**0** against `oura_raw_packed`'s **764** real rows, and **0** against an `error_events` that returns
rows.

## Key decisions (with rationale)

- **Q-528 kept, not deleted.** The delete-before-guard shape in `replaceOuraDailySummary`
  (`lib/data/postgres/slices/oura.ts:1345`) is real; only the claim that it *fired* was wrong. It is
  a latent hazard on a hand-triggered path, so it drops in priority without reaching zero.
- **The rule was rewritten in place, not removed.** `pg_stat_user_tables` really is the one
  non-row-scoped read available here, and that is worth keeping. What needed saying is that its
  **size** columns are exact and its **row** counters are not.
- **TN-1 asks for a count, not a looser gate.** Relaxing `CHRONIC_STRESS_MIN_DAYS` before checking
  its input's distribution is precisely the Q-504 mistake, and Q-506 is the same class.
- **Q-522's half was preserved explicitly.** `oura_bucket` is genuinely 0 rows, re-checked. Only the
  `oura_daily_summary` line was misread, and sweeping away the whole day's work would have lost a
  sound finding along with the unsound one.

## What the chronic-stress measurement actually established

Three gates sit between the data and a score. Measured, in order:

1. **`summaryRows.length < 21`** (`adapter.ts:6251`) — on a routine pass `rollupCutoffDs` is
   `max(anchor − 35 d, watermark − 3 d)` and the watermark advances hourly, so a routine pass builds
   **~3 nights** and returns immediately. The 2026-08-17 `fullHistory` pass built **43**. **Passed.**
2. **Summary-field completeness over the trailing 31 nights** (2026-07-18 → 08-17) — **27 of 31
   complete**, six clear of the 21 needed. **Passed.**
3. **The granular per-night signals** (`signalsByDate`, `adapter.ts:5706` → `computeNightIntermediates`)
   — **the only remaining suspect.** That pass wrote 23 derived rows, scored illness on all 23 and
   chronic stress on **0**.

So the refusal is in the granular layer, and it cannot be seen from outside: the intermediates are
recomputed in memory by design and **nothing persists a reason for the null**.

## Deliberately NOT done

- **The granular decode itself.** Establishing which nights carry a usable hypnogram, IBI series and
  skin-temp run needs frame decoding, which is not reachable from SQL. That is exactly what TN-1 asks
  the pass to record.
- **No scoring change proposed or shipped.** Tuning proposes; the session found a false finding rather
  than a miscalibration, and manufacturing a formula change to justify the session would be worse than
  the retraction.
- **The 177 MB database read was not filed.** 49 MB is the `error_events` bloat already tracked as
  Q-315, and `oura_raw_samples` grows ~1.3 MB/day between packing runs (last packed 2026-08-18 04:32),
  so the trend against the 171 MB baseline is explained.

## Gotchas / what did NOT work

- **`git log --diff-filter=A` cannot date anything in this repo.** History was cut at the public-repo
  migration — **50 commits, oldest 2026-08-19** — so every file reads as "added" then. I nearly
  concluded the chronic-stress wiring shipped on 08-19 from exactly that. It also means whether that
  wiring was deployed during the 2026-08-17 pass is **unknown**, which makes that pass weak evidence
  rather than proof.
- **`oura_raw_samples` holding only a ~10-day window looks like data loss and is not.** The live table
  spans `measured_at` 2026-08-10 → 08-20 (221,499 rows); the older **941,233** frames sit packed in
  `oura_raw_packed` (764 blobs). The rollup reads through `readRawFrames`
  (`lib/data/postgres/slices/oura-raw-frames.ts`), the **two-tier** reader that consults both. I
  chased this as a starvation hypothesis for a while before checking the reader; do not repeat it.
- **The doc-size baseline conflicts on every parallel docs PR** (this is Q-424, already filed). Resolve
  by taking `git show origin/main:docs/doc-size-baseline.json` and re-applying your raises on top —
  never by splicing the conflict hunks. It happened once here and that is the procedure that worked.

## Files to look at

- `lib/data/postgres/slices/oura.ts:1345` — `replaceOuraDailySummary`, the delete-before-guard (Q-528).
- `lib/data/postgres/adapter.ts:6080` — its only production call site, `fullHistory`-gated.
- `lib/data/postgres/adapter.ts:5706` — where granular night signals are stashed (the TN-1 suspect).
- `lib/data/postgres/adapter.ts:6248` — the `chronic_stress` step and its early return.
- `packages/shared/src/health/chronic-stress-assembly.ts` — the 21-night gate and what "complete" means.
- `docs/reviews/2026-08-20-daily-summary-wipe-retracted.md` — the full measurement trail.

## Open questions / blockers

- **Nothing is blocked on the owner**, and no Tuning proposal is awaiting sign-off.
- **Sequencing worth honouring:** `fullHistory` is the **only** path that can ever produce a
  chronic-stress score, and it is the same flag arming Q-528's delete. **Q-528 and TN-1 should be one
  Lane A branch**, not two. Written into both entries.
- **The owner has a request coming** that had not been stated when this session closed. That is
  why the successor is told to orient and then stop.
- **This session's own numbers are four days old at close.** It measured on 2026-08-20 and wrapped on
  2026-08-24 without re-pulling, because nothing it filed was actioned in between and the findings are
  about code paths rather than a moving distribution. A successor asked about any of them should
  re-run the query rather than quote this doc.

## Pickup prompt

```
Read docs/agents/prompts/tuning.md and follow it verbatim.
Set this session's title to `🎶 Tuning Agent 🟢` — exactly, both emoji included. The leading
emoji is the role; the trailing light is your own status and you set it yourself (see
docs/agents/README.md §4). Flip it to 🔴 only at your own handover, after everything has landed.
Read your baton at docs/agents/state/tuning.md first, then
docs/handoff-2026-08-24-devices-daily-summary-wipe-retraction.md.

DO NOT START ANY WORK YET. The owner has a request coming and will send it. Do the
orientation reads, then stop and wait for their instruction. Do not pick an item off the
backlog, do not start a measurement, and do not propose a scoring change on your own
initiative — this session exists to receive that request.

Orientation reads, in order: docs/agents/state/tuning.md · docs/agents/README.md §1-2 and §4 ·
CLAUDE.md · projectOverview.md · docs/domains/readiness/README.md ·
docs/handoff-2026-08-24-devices-daily-summary-wipe-retraction.md. Do the two session-start
production reads (error_events and database size) via POST /api/admin/db-query while you
wait — they are cheap and the 30-day prune means a fault that stops is never recorded.

Constraints you would otherwise re-discover:
- Your entry IDs are TN-<n>, counting up forever, no band and no pointer. TN-1 is taken;
  find the next free with:
  grep -rhoE '\bTN-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1
- You propose; you do not ship. Any scoring change is the owner's sign-off and Lane A's to
  implement. Your PRs are docs-only and merge without asking.
- claude_ro views are row-scoped to ONE user and error_events prunes at 30 days. Every count
  is "the owner's, recently" — never "the system's". Write it that way.
- pg_stat_user_tables is NOT row-scoped, and its row counters are still only planner
  ESTIMATES — last_analyze is NULL on every table here. Its SIZE columns are exact; to ask
  whether a table is empty, run count(*). A predecessor filed a data-loss incident (Q-528)
  off n_live_tup that had never happened, and this session retracted it.
- git log cannot date anything before 2026-08-19: repo history was cut at the public-repo
  migration (50 commits total).
- Raw BLE frames older than ~10 days live packed in oura_raw_packed, not oura_raw_samples.
  That is NOT data loss — readRawFrames reads both tiers. Send owner reports about a score
  the same day where you can, though: the granular window is what it is.
- Nothing is waiting on the owner, and no proposal is pending their decision.
- Every production figure in that handoff was pulled 2026-08-20 and the session then sat idle
  until 2026-08-24. Re-pull before quoting one. Q-528, Q-525 and TN-1 were all still queued and
  unactioned at close.
```
