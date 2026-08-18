# 2026-08-18 — the frame packer (Q-541 Task 4)

**Lane A** · branch `perf/oura-frame-packer` · no migration, no Kotlin, no APK.

The first code in this project that **deletes an archival frame**. `CLAUDE.md` makes the server-side
`body_hex` the source of truth and says a protocol fix ships as a decoder change plus a redecode —
never as a re-drain, because the ring's history buffer is finite and the cursor only moves forward.
So a frame deleted in error is gone for good, and everything below is about the conditions under
which the delete is allowed to happen.

## What shipped

`lib/data/postgres/slices/oura-raw-pack.ts` and `GET|POST /api/oura-ble/samples/pack`. Admin-gated,
bounded (default 25 buckets, cap 200), idempotent, resumable, POST rate-limited to 10/min. **Never
automatic on deploy** — same posture as the other culling levers. `GET` reports what is packable
without touching anything.

Three phases per bucket, deliberately not in one transaction (plan §6): **seal → insert and re-read
and prove equal → delete**. The verify reads what is *committed*, not what was sent.

## Four decisions the plan left open

**The hot window anchors to `max(ring_timestamp_ds)`, not to `now()`.** A ring that has not synced
for a month must not become fully packable just because time passed. Phase 1's entire point is that a
bucket the ring may still deliver into stays hot, and a wall-clock anchor inverts that exactly when
the ring is least healthy.

**A wall-clock quiet guard sits on top of the ds guard** — `max(recorded_at) < now() - 1 day`. The ds
guard alone is not enough: `ring_timestamp_ds` records when the ring *captured* a frame, not when we
received it, and a re-drain delivers week-old ds values today. Without this, a bucket in the middle
of being re-drained looks eligible on its ds and gets sealed mid-delivery.

**`body_sha256` hashes the frame *sequence*, not the blob.** Hashing the blob going in and re-hashing
the same blob coming out proves only that Postgres stored the bytes — which the re-read already
proves. Hashing `ds:hex` per frame makes it an independent check, so a codec bug that faithfully
round-trips a blob while mangling a frame cannot pass both. There is a test for precisely that: a
blob that unpacks cleanly, whose count is right, and whose stored hash matches its own contents,
while holding different frames from the rows that were read.

**`ON CONFLICT DO NOTHING`, never `DO UPDATE`.** An existing blob for a bucket is either already
verified — in which case the re-read confirms it and the hot rows can go — or the residue of a failed
verify, in which case it must be re-examined rather than silently overwritten.

A refused bucket is returned in the result rather than thrown. One bad bucket must not stop the ones
behind it, and what prevents the real hazard is the verify, not aborting the run.

## Verification

- **13 tests.** The ones that matter are the refusals: a bucket inside the hot window, a bucket
  written to recently however old its ds, a corrupted stored blob, a missing row, a wrong
  `frame_count`, an unparseable blob, a hash that does not describe its blob, and the self-consistent
  blob holding different frames. Plus idempotency, the per-call bound, and user scoping. **The
  refuse-to-delete guard is mutation-checked** — making the verify unconditional turns the corruption
  test red.
- **Driven live through the route on `pnpm dev`**, which is the part a test suite cannot stand in
  for: 251 seeded frames across 10 buckets → 250 moved into **2,800 bytes of blob** (≈29× against
  ~328 B/row), bounded 3-then-7 with `remaining` correct, idempotent on a second press, and the API's
  **full frame dump hashes identically before and after** (251 rows, same SHA over
  `ds:tag:bodyHex`).
- `tsc --noEmit` clean, `pnpm check:rules` 38 of 38, full suite green.

## Failure surfaces NOT exercised

- **Nothing in production has been packed.** The route exists there after this deploys but has not
  been called, so the database has not shrunk by a byte. Task 5 (the backfill) is what reclaims the
  space, and the plan's gate stands: **a verified backfill on a copy of production before the real
  one.**
- **The largest bucket tested is 25 frames; production's largest is 9,236.** The blob for one of
  those is ~30 kB, comfortably TOASTed, but it has not been built.
- **No concurrency test.** The packer assumes it is the only writer of a given bucket; nothing
  enforces that beyond it being admin-triggered and rate-limited.
- **No device, no Kotlin, no APK** — server/JS only, reaching the S25 through the Railway deploy.

## Deliberately not done

**The admin button.** `components/oura-ble/db-footprint-card.tsx` is Lane B's territory, so the
affordance is filed as **Q-316** rather than written across the lane boundary. The route is fully
usable without it. The item carries the warning that matters: its confirm copy must not read like the
lossless VACUUM beside it, because this is the one control in the app that deletes archival frames.
