# 2026-08-20 — the daily-summary wipe never happened, and chronic stress refuses somewhere else

**Branch:** `claude/tuning-agent-0q9yl7` · **Agent:** Tuning 🎶 · **Pillars:** `[devices]` `[platform]` `[readiness]`
Docs-only. No scoring change ships from this session.

## What happened

Yesterday's Tuning session filed **Q-528**: `oura_daily_summary` holds 1 row against 198,223 raw
samples, so a `fullHistory` rollup must have wiped the history. That finding then suspended **Q-525**
(chronic stress has never scored) with *"nothing can be concluded from stored data — rebuild first,
then judge"*, and re-framed part of Q-522.

The table holds **45 rows**, and **43 of them were created 2026-08-17 07:50** — they existed
continuously through yesterday's reading. Nothing was wiped. The count had come from
`pg_stat_user_tables.n_live_tup`, which is a **planner estimate, not a count**: `last_analyze` and
`last_autovacuum` are NULL on every table in this database, and the same field reads **0** against
`oura_raw_packed`'s **764** real rows.

## What changed

- **Q-528 rewritten.** The code shape is real — `replaceOuraDailySummary`
  (`lib/data/postgres/slices/oura.ts:1345`) deletes before it checks for emptiness — but its only
  production call site is `fullHistory`-gated and **it has not fired**. It is a latent hazard worth one
  reordering, not an incident, and the "rebuild the summaries" half is deleted as unnecessary work
  against an intact table.
- **Q-525 un-suspended and sharpened.** Both gates that can be counted from stored data were measured
  and **both pass**: the 2026-08-17 pass built 43 summary rows against a threshold of 21, and 27 of the
  31 nights in the trailing window are complete at the summary level. That pass scored illness on all
  23 derived rows it wrote and chronic stress on **0**. The refusal is inside the granular layer.
- **TN-1 filed** — the granular layer persists no reason for a null, so the question cannot be answered
  from outside the pass. First action is a count, not a relaxed threshold.
- **CLAUDE.md amended** — the session-start size read now separates `pg_stat_user_tables`' exact size
  columns from its estimated row counters, with both measured counter-examples.
- **`oura_bucket` re-checked and genuinely empty**, so the part of yesterday's work that rests on that
  still stands. Only the `oura_daily_summary` line was misread.

## Session-start reads

`error_events`: nothing new of the owner's — the newest entries are the known Samsung
`SpeechRecognition` plugin notices and one chunk-load error on 2026-08-19. Database **177 MB** against
the 171 MB baseline of 2026-08-18; 49 MB of that is the `error_events` bloat already tracked as Q-315,
and `oura_raw_samples` grows ~1.3 MB/day between packing runs (last packed 2026-08-18 04:32), so the
trend is explained. No Known-Issues row needed.

## Not done

The granular decode itself was not measured — establishing which nights carry a usable hypnogram, IBI
series and skin-temp run needs frame decoding, which is not reachable from SQL. That is exactly what
TN-1 asks the pass to record. Whether the chronic-stress wiring was deployed during the 2026-08-17
pass is also unknown: repo history was cut at the public-repo migration, so no file can be dated
before it.
