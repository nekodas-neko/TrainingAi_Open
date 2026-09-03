# 2026-09-03 — a 19-hour night, from bytes past the end of the record

Branch `fix/colmi-sleep-trailing-junk` · migration 260 (corrective delete)

## What it was

The V2 sleep frame carries a per-day byte count, and `decodeSleep` trusted it. **That count can
over-count.**

Two captures of the same night, 32 minutes apart, both in `colmi_raw_frames`:

| Capture | Declared stage-bytes | Real |
|---|---|---|
| 06:33 | 42 | 42 |
| 07:05 | **60** | 42 |

The first 42 bytes are byte-identical between them. The extra 18 are
`00 ff 00 ff 00 ff 00 aa 03 01 00 ff 00 ff 00 02 02 06`, and the decoder read them as spans: three
of **stage 0 lasting 255 minutes**, running 06:25 → 19:10 through a working day. An 8.9-hour night
was stored as **19.1 hours**.

The existing guard was `if (minutes > 0)`, which keeps a 255-minute span happily. Nothing checked
the stage.

## The fix

A stage series is contiguous, so **the first byte that is not a stage is the end of it** — and 0 is
not a stage. The parse stops there.

Two details that matter more than the one-line rule:

- **`i` still advances by the declared length.** Breaking out mid-block and leaving the cursor there
  would shift every following day. The junk is dropped; the alignment is not.
- **The check is the stage, not the duration.** Capping minutes would have worked on this capture
  and failed on the next one, because a long light-sleep block is legitimately long. `stage 0` is
  impossible in a way that `255 minutes` only looks impossible.

## Verified against the bytes, not a reconstruction

`sleep-trailing-junk.test.ts` holds **both real captures** and asserts the strongest property
available: the junk frame and the clean frame decode to **identical** stage series. It also pins the
total at 533 minutes, so a regression that merely changes the number is caught rather than passing a
range check.

Migration 260 removes the rows already written, identified by shape (`stage = 0 OR minutes = 255`)
rather than by date, so a junk span from any night is caught. Both conditions are impossible for a
real segment. `colmi_sleep_segments` is learning-mode storage and every deleted row is re-derivable
from the ring or the raw archive.

## The wider point

This is the third Colmi defect found by reading archived bytes rather than inferring from row counts
— after the ten-hour heart-rate anchor and the rejected-sample question. Before `colmi_raw_frames`
shipped, four diagnoses were made from row counts and three were wrong. Since it shipped, three have
been made from bytes and none has been.

## Verified, and not

Verified: 78 Colmi tests, `pnpm check:rules` 67 of 67, migration applies locally.

**Not verified: a sync after the fix.** The decoder is proven against captured bytes; the delete is
proven against the local database. The check is one more night showing a plausible duration with no
stage-0 rows.
