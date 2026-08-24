# The frame packer has a button (Q-316)

**Branch:** `feat/frame-packer-control` · **Lane B** · v1.363.3

## What shipped

A third control in `db-footprint-card.tsx`'s ① Data section, beside "Null historical decoded" and
"Reclaim disk — VACUUM FULL". It drives `GET`/`POST /api/oura-ble/samples/pack`, which existed and
could only be reached by curl.

- The `GET` count renders beside the button — *"1 bucket(s) packable"* / *"no sealed buckets to
  pack"* — so the number of presses left is visible, and the button disables at zero.
- After each press the footprint reloads, so `oura_raw_samples` shrinking and `oura_raw_packed`
  growing show up in the same table.

## The confirm copy is deliberately not the VACUUM copy

The VACUUM dialog says *"No data is lost"*. That is true of this one too — frames are moved, and the
packer refuses to delete a bucket it cannot prove equal after re-reading the blob. But this is the
**only control in the app that issues a DELETE against archival frames**, and copy that reads
identically to a lossless VACUUM trains the wrong instinct. So it says what it does: moves sealed
buckets older than 7 days into compact blobs, each blob re-read and its frames proved identical
before the originals are deleted, and names the fact that it deletes archival frames at all.

## A refusal is a finding, not a no-op

`refused > 0` means a bucket could not be proved equal and was left intact. The summary line carries
**"⚠ N refused and left intact"**, and each refused bucket is listed with its epoch, tag, ds bucket,
frame count and the server's reason. Without that it would read as "packed 0", which is the same
text a run with nothing to do produces.

## Verification

Driven in a browser against `pnpm dev` + local Postgres, with `oura_raw_samples` seeded so a sealed
bucket existed (40 frames at a low ds, one newest frame past the 7-day hot window, `recorded_at`
older than the 1-day quiet interval):

- **idle** — *"1 bucket(s) packable"*.
- **real pack** — *"packed 1 bucket(s) · 40 frames → 244 B · nothing left to pack · 0.0s"*;
  `oura_raw_samples` **242 → 202** rows, `oura_raw_packed` **0 → 1**, and the count line flipped to
  *"no sealed buckets to pack"* with the button disabled.
- **refusal rendering** — with the POST response replaced by a payload carrying one refused bucket:
  *"packed 1 bucket(s) · 12 frames → 88 B · ⚠ 1 refused and left intact · 3 still packable — press
  again · 1.2s"* over *"epoch 0 tag 134 bucket 1 (40 frames): verify mismatch: 39 of 40 frames
  matched"*.
- Zero page errors throughout.

`tsc --noEmit` clean · `eslint` **zero warnings introduced** (the one on this file, `runBackfill`'s
unnecessary `stats` dependency, is pre-existing — confirmed by linting the base copy) ·
`pnpm check:rules` **Ran 55 of 55**.

## Not exercised

**A genuine refusal was not produced** — only its rendering, by substituting the response. Forcing a
real verify mismatch means corrupting a blob between write and re-read, which is the server's own
path and was already proven by Lane A (251 frames → 10 blobs, API dump hashing identically before
and after). What this shipped is the client half, and that is what was driven.

**The card is reachable only from the APK.** `DbFootprintCard` renders inside `OuraBleDebug`, which
returns the native-unavailable banner and nothing after it whenever the plugin is absent — the same
gate BF-10 documented. Everything above was driven by mounting the card directly on a scratch route,
off the gated page. The button in its real home is owed an on-device check.

Nothing checked on the S25.
