# `oura_daily_summary` holds 1 row against 198,223 raw samples

**Date:** 2026-08-19 · **Agent:** Tuning 🎶 · **Pillars:** `[devices]` `[platform]` `[readiness]`
**Found while** answering Q-525's first action — *"confirm whether ≥21 qualifying nights exist at all
before touching the gate."* They may well exist; the table that would hold them does not.
**Corrects Q-525's diagnosis.**

---

## 1. The measurement

Via `pg_stat_user_tables`, which is **not** row-scoped, so these are whole-database counts:

| table | live rows | size |
|---|---|---|
| `oura_raw_samples` | **198,223** | 56 MB |
| **`oura_daily_summary`** | **1** | 112 kB |
| `oura_bucket` | **0** | 32 kB |
| `step_live_windows` | **0** | 64 kB |

For contrast, `oura_daily_derived` holds 96 rows, of which **46 carry illness scores and biomarkers**
— and those are computed from the very `summaryRows` array that `oura_daily_summary` is the persisted
copy of.

---

## 2. The mechanism — the emptiness guard is on the wrong side of the delete

`replaceOuraDailySummary` (`lib/data/postgres/slices/oura.ts`):

```ts
export async function replaceOuraDailySummary(db, userId, rows) {
  await db.delete(s.ouraDailySummary).where(eq(s.ouraDailySummary.userId, userId))
  if (rows.length === 0) return          // ← guards the INSERT, not the DELETE
  await db.insert(s.ouraDailySummary).values(rows.map(...))
}
```

**The DELETE is unconditional and runs first.** A full-history pass that produces few rows — or none —
wipes every persisted summary and replaces it with whatever it computed, then returns successfully.
There is no error, no log, and nothing downstream can tell the difference between "recomputed to one
day" and "history destroyed".

The call site (`adapter.ts`) branches on `fullHistory`:

```ts
if (fullHistory) await this.replaceOuraDailySummary(userId, summaryRows)
else await oura.upsertOuraDailySummary(this.db, userId, summaryRows)
```

The windowed path is safe — a per-day `onConflictDoUpdate` that never deletes. **Only the
full-history path can do this, which is why it has gone unnoticed: it is the rarely-taken branch.**

**Why the illness scores survived and the summaries did not:** illness writes to
`oura_daily_derived` through a COALESCE upsert. Same source array, different durability. That
asymmetry is the clearest evidence the input existed and the storage lost it.

---

## 3. What this corrects

**Q-525 said chronic stress has never fired because its gate needs "21 granular nights in one pass"
and a nightly incremental rollup can never satisfy it.** That framing survives as a description of
the gate, but the conclusion was too confident: with the summary table at one row, **nothing can be
concluded from stored data about whether 21 qualifying nights exist.** The gate may be fine and the
history may be adequate; the evidence was destroyed rather than never created.

Q-525's first action is unchanged in intent and changes in method: **do not check the summary table
to decide whether the gate is too strict.** Rebuild it first — from `oura_raw_samples`, which still
holds 198,223 rows and is the archival source of truth — then ask the question again.

---

## 4. Two adjacent tables at zero, which is a separate question

`oura_bucket` and `step_live_windows` are both **empty system-wide**. `oura_bucket` is described in
source as *"the durable server backup of the on-device `oura_bucket`"* and carries `met_mean`,
`met_minutes` and `motion_mad`.

**That matters to Q-522 specifically.** The open question there is what to anchor "did I move this
hour" on, given that every heart-rate boundary drifts as the owner gets fitter (Q-515). **MET and
motion do not drift with fitness** — they measure the effort, not the body's response to it, so a MET
of 3.0 is 3.0 at any training age. That is the principled basis for the fix, and **it is unavailable**
because the table has never received a row.

This review does not diagnose why. It records that the best available answer to Q-522 is blocked on a
sync path that has never delivered, so Q-522's fix has to come from heart rate or steps until it does.

---

## 5. Filed

- **Q-528** — the unconditional delete, and the two empty backup tables.
- **Q-525 amended** — its diagnosis is downgraded from "the gate is unsatisfiable" to "the evidence
  is missing"; rebuild the summaries before judging the gate.
- **Q-522 amended** — MET/motion is the drift-proof anchor and is currently unavailable.

**Caveats.** `pg_stat_user_tables` counts are exact and system-wide, unlike everything else this agent
reads. **The wipe mechanism is read from source and matches the observed state; it is not
reproduced.** A dev-database repro — populate summaries, run a full-history pass over a narrow input,
observe the row count — would settle it, and belongs with whoever implements the fix. The alternative
explanation, that a full-history pass has simply never run with more than one night of input, is not
excluded by anything here.
