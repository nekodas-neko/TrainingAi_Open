# BF-69 — dosed substances as an analysable exposure variable

**Status:** plan only. Nothing here is built. The storage model was decided by the owner on
2026-08-30 and is not re-litigated; what this document adds is **the sequence**, the presence model,
and the split between the lanes.

---

## 1. The measurement that reframes this entry

BF-69 says *"the storage is done. There is no reader."* Both halves were checked against production
before planning, and the second half understates the problem:

| | measured 2026-09-01 |
|---|---|
| supplements defined | **2** — Fish Oil, Vitamin D, both created 2026-06-18 |
| `default_amount` / `unit` set on either | **neither** — the BF-3 columns are empty |
| `supplement_logs` rows, all time | **1** — Vitamin D, 2026-06-21, `amount` NULL |
| retatrutide, the drug this entry is about | **not in the table** |

So there is no reader *and* essentially nothing to read. **The trends overlay cannot be the first
deliverable**: built today it would render an empty chart, which is the "table nothing reads" failure
mode inverted — a reader with nothing to read, and no way to tell a broken query from an empty one.

**What the sequence has to be, and why.** The owner's request was *"this week I will put it as
Reta = 0 so it has a baseline — then next week add a dosage"*. That is a request to **log a number on
a date**, repeatedly, and nothing in the app does that yet: a supplement is a tick, and the amount
columns BF-3 added have never been written. Make logging a dose possible and habitual first; a
correlation over four weeks of real doses is worth more than a correlation surface over one row.

---

## 2. The presence model — `started_on` / `stopped_on`, and `unknown` is a real answer

This is the decision the entry says has to come first, and it is the one that decides whether every
number downstream is honest. Today a row exists only on days something was logged, so *"did not take
it"* and *"forgot to log it"* are the same absence.

**Recommendation: option 1 — a window per substance.** `supplements` gains `started_on` and
`stopped_on` (both nullable dates):

- a date **outside** the window is a **true zero** — the substance was not being taken;
- a date **inside** the window with no contribution is **unknown**, not zero;
- `unknown` is **excluded** from any correlation, never coerced.

**Why not the alternatives.** An explicit "not today" row (option 2) is honest but needs daily
discipline the log above says is not there — one row in ten weeks. Treating unlogged-inside-window as
zero (option 3) manufactures effects: a run of forgotten days becomes a run of zeros, and this repo
has already published a false coefficient from a data-shape mistake and left it standing for eleven
days (**A Correlation Across a Model Change Is Not Evidence**).

**The window is also what makes the owner's baseline week work.** *"Reta = 0 so it has a baseline"*
is a `started_on` before the first dose with no contributions in between — real zeros, by
construction, with no daily logging required.

**Reversal cost is low and asymmetric in the right direction:** two nullable date columns, and a
consumer that ignores them behaves exactly as it does today. Going the other way — inferring which
absences were true zeros after the fact — is not recoverable.

---

## 3. The contributions schema (Lane A, one PR, never batched)

The owner decided the shape on 2026-08-30 and it is transcribed here rather than re-argued: **a
day's exposure is an AMOUNT, derived from CONTRIBUTIONS.** Each act of taking something is its own
row carrying its amount/unit and where it came from; the day's figure is the sum, computed on read.

```
supplement_logs                    -- the same table; the CONSTRAINT is what changes
  DROP  unique (supplement_id, log_date)
  ADD   source      text not null default 'manual'   -- 'manual' | 'meal'
  ADD   source_ref  uuid                             -- the food_logs row, when source = 'meal'

supplements
  ADD   started_on  date
  ADD   stopped_on  date
  ADD   dose_prompt boolean not null default false   -- "ask me when logging" (§5)
```

**Existing rows migrate forward as one `manual` contribution each**, preserving the BF-3 dose
snapshot. One row today, so the migration is trivially safe — but write it to be correct at any
volume, because that is not why it is safe.

**Why the unique constraint has to go, and why it must not be replaced by a narrower one.** Two
doses on one day are independent events that **add**. A partial unique on
`(supplement_id, log_date, source)` would look tidier and would break the case that motivates the
feature: a meal logged twice is two doses, correctly.

**`source_map` was considered and rejected, and this is worth restating** because it is the reflex
answer to "multiple writers" in this codebase. The ranked per-field merge in
`lib/data/health-source.ts` resolves **competing claims about one truth** — which scale is right. Two
doses are not rivals; a rank ladder would discard one of them.

**No stored daily total.** Every stored counter in this project has drifted. The day's amount is
`SUM(amount) WHERE deleted_at IS NULL`, derived on read, per the Stored Counters rule.

### The chain that moves with it, in the same PR

`supplement_logs` is a **synced** domain, so the schema change is not the work — the chain is:

| link | what changes |
|---|---|
| Postgres migration | the constraint drop + three columns above |
| `lib/sqlite/migrations.ts` | the same columns, a new version, **and** `RECONCILE_COLUMNS` rows |
| `lib/local-store/types.ts`, `sqlite-backend.ts` | both upsert arms + the offline read |
| `getSyncDelta` / `pullDelta` / `applyDelta` | `source`, `source_ref`, and the two window columns |
| outbox payload + `pushMutations` branch | every field the web route accepts |
| `logSupplement` / `unlogSupplement` | **contribution-scoped** — see below |

**`unlogSupplement` is the one that can lose data.** Unlogging from the supplements page must remove
the **`manual`** contribution only; deleting a meal must remove **that meal's** contribution only.
Neither may soft-delete a day wholesale again — that is the deletion bug the contribution rows exist
to fix, and it is the assertion a reviewer should look for first.

---

## 4. The meal attachment is an ENTRY POINT, never a second store

Owner, 2026-08-30: *"in a food log or when you create a saved meal you can add 'supplements' to it —
it means when the meal gets logged it treats it as the supplement being hit."*

**The rule that makes this work: a supplement attached to a meal writes a `supplement_logs` row and
never a `food_items` row.** The moment the food log becomes a second *store* of exposure rather than
a second *entry point*, the double-count is back — and it is already latent, since the owner's food
log contains a `ZMA Complex Supplement` row today with nothing linking it to the supplements table.

Attachment lives on the saved meal (`saved_meal_supplements`: meal id, supplement id, optional fixed
amount, `dose_prompt`). Logging that meal writes one contribution per attachment with
`source = 'meal'`, `source_ref = <food_log id>`.

---

## 5. Variable dose is one flag, not a second flow

Creatine is 5 g every time; retatrutide changes on a titration schedule. So an attachment carries
either a fixed amount or **`dose_prompt`** — the owner's *"selection first to choose dosage"* — which
is a boolean on the attachment, not a separate feature. A prompted log is still one contribution row;
only where the number comes from differs.

---

## 6. Split of work

| stage | lane | what | gate |
|---|---|---|---|
| 1. contributions + windows + the sync chain | **A** | §3 | none — build it first |
| 2. an amount on the supplements page, and `dose_prompt` | **B** | logging a real number, which is the thing that does not exist today | `Needs:` stage 1 |
| 3. meal attachment UI | **B** | §4 | `Needs:` stage 2 |
| 4. the exposure series + trends overlay | **A** | the reader BF-69 is named for | **`Gate:` data** — see below |

**Stage 4 is gated on data, not on effort.** It needs a series: several weeks of contributions with
real amounts inside a window. Building it before that is building a chart of one point. The gate
lifts when the owner has been logging doses for ~4 weeks — which stages 2 and 3 are what make
possible.

---

## 7. Verification

- Two contributions on one day sum, and **deleting the meal leaves the hand-logged dose intact** —
  the case the old unique constraint made impossible.
- A meal logged twice on one day counts **twice**.
- A date outside `[started_on, stopped_on]` reads as a true **zero**; a date inside it with no
  contribution reads as **unknown** and is **excluded** from any aggregate rather than summed as 0.
  Assert the exclusion directly: an aggregate over a window with gaps must not equal the aggregate
  over the same window with those gaps filled with zeros.
- The full offline chain: local table columns = server payload fields = `getSyncDelta` output =
  `pullDelta` mapping = `applyDelta` upsert columns, verified in one pass.
- A supplement attached to a meal produces **no** `food_items` row.
- **On the APK**, since this is an offline-first domain: log a dose offline, kill the app, reopen —
  the contribution is still there and pushes when the network returns.
