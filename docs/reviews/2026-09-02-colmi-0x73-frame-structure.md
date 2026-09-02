# PS-20: the 0x73 frame is a container, and byte 4 wraps

**2026-09-02 · Lane A · decode from stored bytes, no new capture, no decoder shipped.**

PS-20 was filed against **three** archived frames. There are now **45** (`colmi_raw_frames`, tag 115,
2026-08-29 → 09-01). The larger sample changes the structure and **overturns the entry's central
inference**.

## 1. `0x73` is a container, not a record type

Byte 1 is a sub-type. Six values appear:

| byte 1 | frames | payload |
|---|---|---|
| **18 (0x12)** | 39 | the only one carrying data |
| 1, 4, 12, 43, 44 | 6 | **all bytes zero** |

The entry describes the three frames as *"identical structure … one record type, not three"*. That is
right about those three and wrong about `0x73`: they were all sub-type 18. Any decoder must switch on
byte 1 before reading anything.

## 2. Byte 4 wraps at 256 — directly observed

Within the 2026-08-31 burst, byte 4 runs:

```
230 243 245 247 249 250 252 254 255   1   3   4   6  18  20
```

It is a mod-256 counter, and byte 5 does **not** carry (it stays 0 across the wrap; it is 1 for the
whole 09-01 burst, so it is a separate low-cardinality field rather than a high byte).

**This retires the entry's key ratio.** It reads *"byte 10 over byte 4 is ~0.77 in all three — so they
scale together"*. Across all 45 frames that ratio spans **0.33 to 0.78**, because the entry's three
frames happened to sit in one unwrapped run. The constancy was an artefact of the sample size.

## 3. The real invariant: `u16(6,7)` is exactly linear in the counter

Big-endian `u16` over bytes 6–7 advances by a fixed amount per counter step, within every burst, with
no residual:

| burst | byte 9 | step per counter tick |
|---|---|---|
| 08-29 07:27 | 0 | **36** |
| 08-29 17:56 | 4 | **36** |
| 08-30 17:31 | 4 | **27** |
| 08-31 08:39 | 1 | **27** |
| 09-01 19:58 | 6 | **27** |

Exact across the 08-31 wrap too: 255 → 1 is two ticks and `u16` advances 54 = 2 × 27.

Only two multipliers ever appear, and **byte 9 does not select between them** — it is 4 for one burst
of each. Whatever picks 27 versus 36 is not in the frame, or is not a field identified here.

Byte 10 tracks the same quantity at **`u16` / 42–44** in every burst.

## 4. Bytes that are always zero

Across all 45 frames: bytes **8, 11, 12, 13, 14**. Byte 15 is the checksum (all valid).

## What this does NOT establish

**The semantics.** The values do not match Colmi's own `colmi_readings` for the same days — daily
steps run 1,636–5,418 and calories 3,588–7,080, while `u16` reaches 47,024–49,821 on 08-29/30 and then
*falls* to 14,539 on 08-31, so it is not a daily total and not a simple lifetime counter either.

**A hypothesis worth testing, stated as one:** 27 and 36 are plausible **centimetres per step**, which
would make the counter steps and `u16` distance. It is untested and I am not shipping a decoder on it.
The test is a deliberate walk of a counted number of steps followed by a sync, so the counter's
increment is known — that needs the device and the owner, not another database read.

**No decoder ships from this.** Structure without semantics is worth writing down; a decoder that
names fields on a guess is how a wrong number reaches a screen.

## Reproducing

`SELECT hex FROM claude_ro.colmi_raw_frames WHERE tag = 115 ORDER BY received_at` — 45 rows. Group by
the burst timestamp, take byte 1 as sub-type, byte 4 as a mod-256 counter, bytes 6–7 big-endian.
