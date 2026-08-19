# 2026-08-19 — `oura_daily_summary` holds 1 row against 198,223 raw samples (Q-528)

**Agent:** Tuning 🎶 · **Branch:** `tuning/empty-backup-tables` · **Docs-only.**

Found while running Q-525's own first action — *"confirm whether ≥21 qualifying nights exist at all
before touching the gate."* They may well exist. The table that would hold them does not.

## The measurement

`pg_stat_user_tables`, which is **not** row-scoped, so these are whole-database counts:

| table | live rows |
|---|---|
| `oura_raw_samples` | **198,223** |
| **`oura_daily_summary`** | **1** |
| `oura_bucket` | **0** |
| `step_live_windows` | **0** |

Meanwhile `oura_daily_derived` holds 96 rows, **46 carrying illness scores computed from the very
`summaryRows` array that `oura_daily_summary` is the persisted copy of.**

## The mechanism

```ts
export async function replaceOuraDailySummary(db, userId, rows) {
  await db.delete(s.ouraDailySummary).where(eq(s.ouraDailySummary.userId, userId))
  if (rows.length === 0) return          // ← guards the INSERT, not the DELETE
  await db.insert(...)
}
```

**The delete is unconditional and runs first.** A full-history pass producing few or zero rows
replaces the whole history with whatever it computed and **returns successfully** — no error, no log,
and nothing downstream can distinguish "recomputed to one day" from "history destroyed".

Only the `fullHistory` branch calls it; the incremental path is a per-day `onConflictDoUpdate` that
never deletes. That is why it survived — it is the rarely-taken branch.

**Why the illness scores lived and the summaries died:** illness writes to `oura_daily_derived`
through a COALESCE upsert. Same input array, different durability. That asymmetry is the clearest
evidence the input existed and the storage lost it.

## It corrects a diagnosis I filed this morning

Q-525 said chronic stress has never fired because its gate needs 21 granular nights in one pass, and
that a nightly rollup can never satisfy it. That still describes the gate — but as a *cause* it was
too confident. **With the summary table at one row, nothing can be concluded from stored data about
whether 21 qualifying nights exist.** The gate may be fine and the history adequate; the evidence was
destroyed rather than never created. Q-525 now says: fix Q-528, rebuild from `oura_raw_samples`, then
ask again.

## And it changes what Q-522 should be fitted against

`oura_bucket` is *"the durable server backup of the on-device `oura_bucket`"* and carries `met_mean`,
`met_minutes` and `motion_mad`. **MET and motion do not drift with fitness** — they measure effort
rather than the body's response to it, so a MET of 3.0 is 3.0 at any training age. That is the
principled answer to Q-522's whole difficulty, which is that every heart-rate boundary drifts as the
owner adapts (Q-515).

**It has zero rows.** So the best available fix is blocked on a sync path that has never delivered,
and until it does, Q-522 has to be fitted against heart rate or steps — and will inherit the drift.
Recorded in Q-522 so nobody fits an HR boundary without knowing a better basis exists.

## Files

- `docs/reviews/2026-08-19-daily-summary-replace-wipe.md` (new)
- `docs/implementation-backlog.md` — Q-528 filed; Q-525's diagnosis corrected; Q-522 gains the
  MET/motion note
- `docs/domains/devices/README.md`, `docs/domains/platform/README.md`
- `scripts/check-doc-index-size.js` — backlog baseline **ratchets down** 11374 → 11236

## Not exercised

Docs-only; no code path changed. **The wipe mechanism is read from source and matches the observed
state — it is not reproduced.** A dev-DB repro (populate summaries, run a full-history pass over one
night, count rows) would settle it and belongs with the fix. The alternative explanation — that a
full-history pass has simply never run over more than one night of input — is not excluded by
anything here. The row counts themselves are exact and system-wide, unlike every `claude_ro` read.
