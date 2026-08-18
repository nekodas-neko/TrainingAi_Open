## 2026-08-17 — the packed-frame table and codec, additively (Q-541 Tasks 0–2, v1.318.11)

The owner set a deadline: the 5 GB volume is temporary and must be **deprecated by end of week**,
with all work aimed at returning to the stock 500 MB. Q-541 is the only step that makes 500 MB a home
rather than somewhere the database passes through — `VACUUM FULL` alone re-crosses it in ~5 days,
Q-534 + Q-540 in ~7 weeks, packing in ~3.7 years. So this is the item, and this is its first,
deliberately additive slice.

**Nothing reads or writes the new table yet, and no row has moved.** `oura_raw_samples` and the
ingest path are untouched, which is the whole architecture: the cursor's safety rests on that path
and a botched change loses drained spans forever (ops-doc I18, I21).

### Task 0 — answered structurally, and the plan's own method is now wrong

The question was whether two rows can share `(user_id, ring_timestamp_ds, tag, body_hex)` across
different epochs. **They cannot: that tuple *is* the unique constraint**, and it excludes `epoch` —
`oura_raw_samples_user_id_ring_timestamp_ds_tag_body_hex_key`, confirmed against production and
`schema.ts:1064`. A second such row was never insertable. The bucket key keeps `epoch`, which is
there for time-derivation correctness rather than dedup, so §3's note resolves with no change.

⚠️ **The plan proposed answering this by counting, and that would now mislead.** Migration 190
(Q-536, earlier today) collapsed every one of the owner's samples to `epoch = 0` — so a cross-epoch
duplicate count returns "none" **because there is only one epoch left to be cross**, not because the
property holds. It would read as confirmation and be evidence of nothing. The plan now says so.

### What shipped

- **Migration 191** — `oura_raw_packed`, one sealed blob per `(user_id, epoch, tag, ds_bucket)`, plus
  a `(user_id, ds_bucket)` index for the range-across-tags read the PK cannot serve (it orders `tag`
  ahead of `ds_bucket`). `event_name`, `measured_at` and `decoded` are deliberately **not** columns —
  derivable from `tag`, from the clock anchors, and from the body. Dropping stored `measured_at` is
  what removes the full-table re-stamp that caused the `disk_full` outage.
- **Migration 192** — regenerated `claude_ro` views. A new table requires it: the schema is
  default-deny, and `claude-ro-readonly-role.test.ts` went red on the coverage count (81 views
  against 82 tables) until it landed. Filename pin re-pointed in the same commit, per `CLAUDE.md`.
- **`lib/oura-ble/frame-pack.ts`** — the codec, pure and dependency-free so it can be property-tested
  in isolation. It is the piece the archival guarantee rests on: packing is only legitimate because
  it is byte-for-byte reversible.

### Two things the codec learned from its own tests

- **`packFrames` sorts rather than trusting the caller.** The delta encoding needs ascending `ds`; an
  unsorted list would otherwise encode a negative delta and unpack to *different data* rather than
  failing — silent corruption of an archive, which is the one outcome this must not have.
- **A zero delta is legal.** Two frames can share a `ds`, because the dedup key includes `body_hex`.
  A codec that rejected or collapsed duplicates would lose frames that are legitimately distinct.

### Verification

7 codec tests — 200 seeded round-trips, the edges (empty list, empty body, the 1,024-byte Zod
ceiling, a 40 M-ds gap, duplicate `ds`), an unsorted input, malformed-blob rejection in four shapes,
the hex helpers. Plus **2 DB-backed tests** proving a blob survives the `bytea` column and the pg
driver byte for byte — the join where a byte-level format usually breaks, and one the in-memory
tests structurally cannot cover.

On the pinned production vector (the owner's five oldest tag-0x76 frames): **63 bytes packed against
~1,640 as rows** — the 26× the plan projected from a 27× measured overhead.

`npx tsc --noEmit` clean · `pnpm build` green · `pnpm check:rules` **Ran 38 of 38** · suite
**483 files / 3,927 tests passed**, 2 files / 54 skipped.

### Not exercised, and what is still owed

- **No production data has been packed.** Tasks 3–7 remain: the two-tier reader, the packer, the
  backfill, the hot-window prune, the `measured_at` range-query sweep. The packer's delete is the
  only destructive statement in the plan and is gated on a proven-equal re-read (§6); it is not
  written.
- **The projected ~70 MB is projected**, from production measurements, not observed. Nothing in this
  PR changes the database's size by more than an empty table.
- **The codec has never seen a full production bucket** — the largest fixture here is 60 synthetic
  frames against a real maximum of 9,236. The plan's gate stands: a verified backfill on a copy of
  production before the real one.
- No device, no Kotlin, no APK. Server/JS only.
