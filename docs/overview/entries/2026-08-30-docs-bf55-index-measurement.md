# 2026-08-30 — BF-55's measurement, and what it falsified (Lane A)

**Branch:** `docs/bf55-index-measurement` · **Lane A** · docs only, no code, no migration.

BF-55 opened on an exact reading — 84 MB of index against 63 MB of heap — and said its first move is
**measurement, not a VACUUM**. That measurement is now done, against production. It produced one
18 MB answer and falsified the rule it was taken under.

## The eight indexes over 1 MB

| Table | Index | `idx_scan` | Size |
|---|---|---|---|
| `oura_heartrate` | **`oura_heartrate_user_updated`** | **0** | **18 MB** |
| `oura_raw_samples` | `…_user_id_ring_timestamp_ds_tag_body_hex_key` | 3,546 | 17 MB |
| `oura_raw_samples` | `oura_raw_samples_user_tag_ts` | 251 | 15 MB |
| `oura_heartrate` | `oura_heartrate_user_id_timestamp_key` | 5,991 | 9.4 MB |
| `oura_raw_samples` | `oura_raw_samples_pkey` | 3,618 | 5.3 MB |
| `oura_heartrate` | `oura_heartrate_pkey` | 0 | 4.4 MB |
| `rr_intervals` | `rr_intervals_user_id_at_key` | 0 | 3.5 MB |
| `rr_intervals` | `rr_intervals_pkey` | 0 | 3.5 MB |

Totals re-confirmed the same day: **206 MB total, 63 MB heap, 84 MB index** — unchanged from what the
entry opened on.

## The entry's own rule is wrong for three of those four zeros

*"An index never scanned is a candidate to drop."* `idx_scan` counts **reads**, not constraint
enforcement. `oura_heartrate_pkey`, `rr_intervals_pkey` and `rr_intervals_user_id_at_key` are PRIMARY
KEY / UNIQUE indexes consulted on **every insert** to reject a duplicate, and that work never touches
this counter. Dropping one drops the constraint. Acting on the rule as written would have removed
11.4 MB of dedup guarantees on the ring's two highest-volume tables.

## The one real candidate belongs to a decision that predates the measurement

`oura_heartrate_user_updated` is `(user_id, updated_at, id)` from migration 130 — the keyset
pagination index for `getOuraTimeseriesDelta`. That method's own doc comment records **Q-180**
(decided 2026-08-14): it has no production caller, and is kept deliberately, because intraday HR
reaches a fresh device by no other path, the server is the archive, and — in as many words — *"It
costs nothing at runtime."*

**It does not cost nothing.** 18 MB is **21 % of the database's entire index budget**, for a code path
nothing calls, plus write amplification on every HR insert — the highest-volume write in the app, at
87,021 rows. `oura_heartrate` carries 32 MB of index on 9 MB of data, and this is most of it.

Q-180 weighed the *method*, which genuinely does cost nothing while uncalled. The index was never in
that accounting. So this is not a disagreement with the decision; it is a number the decision did not
have.

**Left to the owner, with a recommendation to drop it** and to record in
`getOuraTimeseriesDelta`'s comment that the restore driver must recreate it. Reversal is one
`CREATE INDEX` over 9 MB of heap — seconds — and the driver that would need it has not been written
in the two weeks since Q-180, so nothing can regress meanwhile.

## Not exercised

- **Nothing was changed.** No index was dropped, no VACUUM run, no code touched. BF-55 stays in the
  queue carrying its measurement and the one decision it now needs.
- The growth half of BF-55 (**+35 MB in 12 days against a ~0.4 MB/day expectation**) is **not**
  explained by any of this — an unused index does not grow on its own. That remains open.
